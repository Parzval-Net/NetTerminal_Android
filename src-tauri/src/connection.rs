//! Conexiones activas: shell local y SSH (sobre PTY), Telnet (TCP nativo) y Serial.
//! Cada conexión empuja bytes crudos al frontend por un `Channel`, opcionalmente los
//! registra en un log de texto plano y mantiene un historial limpio que leen los
//! scripts y los agentes de IA (MCP).

use crate::models::{Session, SessionType};
use crate::telnet::{self, TelnetShared};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::ipc::{Channel, InvokeResponseBody};

const HISTORY_MAX: usize = 256 * 1024;

/// Salida en texto limpio: historial acotado + suscriptores en vivo (scripts, MCP).
#[derive(Default)]
struct Mirror {
    stripper: AnsiStripper,
    history: String,
    taps: Vec<Sender<String>>,
}

impl Mirror {
    fn push(&mut self, bytes: &[u8]) {
        let text = String::from_utf8_lossy(&self.stripper.strip(bytes)).into_owned();
        if text.is_empty() {
            return;
        }
        self.taps.retain(|t| t.send(text.clone()).is_ok());
        self.history.push_str(&text);
        if self.history.len() > HISTORY_MAX {
            let mut cut = self.history.len() - HISTORY_MAX;
            while !self.history.is_char_boundary(cut) {
                cut += 1;
            }
            self.history.drain(..cut);
        }
    }
}

/// Destino de los datos recibidos: frontend + log opcional + espejo de texto.
#[derive(Clone)]
pub struct Sink {
    data: Channel<InvokeResponseBody>,
    exit: Channel<String>,
    exited: Arc<AtomicBool>,
    log: Arc<Mutex<Option<LogWriter>>>,
    mirror: Arc<Mutex<Mirror>>,
}

impl Sink {
    pub fn push(&self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        if let Some(log) = self.log.lock().unwrap().as_mut() {
            log.write(bytes);
        }
        self.mirror.lock().unwrap().push(bytes);
        let _ = self.data.send(InvokeResponseBody::Raw(bytes.to_vec()));
    }

    /// Notifica el cierre una sola vez, venga de donde venga.
    pub fn close(&self, reason: impl Into<String>) {
        if !self.exited.swap(true, Ordering::SeqCst) {
            let _ = self.exit.send(reason.into());
        }
    }
}

/// Quita secuencias ANSI, retornos de carro y caracteres de control sueltos.
/// Conserva el estado entre llamadas porque una secuencia puede venir partida.
#[derive(Default)]
struct AnsiStripper {
    state: u8, // 0 normal, 1 ESC, 2 CSI, 3 OSC
}

impl AnsiStripper {
    fn strip(&mut self, bytes: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(bytes.len());
        for &b in bytes {
            match self.state {
                0 => match b {
                    0x1b => self.state = 1,
                    b'\r' | 0x07 | 0x00 => {}
                    0x08 => {
                        out.pop();
                    }
                    _ => out.push(b),
                },
                1 => {
                    self.state = match b {
                        b'[' => 2,
                        b']' => 3,
                        _ => 0,
                    }
                }
                2 => {
                    if (0x40..=0x7e).contains(&b) {
                        self.state = 0;
                    }
                }
                _ => {
                    if b == 0x07 || b == b'\\' {
                        self.state = 0;
                    }
                }
            }
        }
        out
    }
}

/// Log en texto plano, con la hora al inicio de cada línea si se pide.
struct LogWriter {
    file: File,
    stripper: AnsiStripper,
    timestamps: bool,
    line_start: bool,
}

impl LogWriter {
    fn new(file: File, timestamps: bool) -> Self {
        Self {
            file,
            stripper: AnsiStripper::default(),
            timestamps,
            line_start: true,
        }
    }

    fn write(&mut self, bytes: &[u8]) {
        let clean = self.stripper.strip(bytes);
        let mut out = Vec::with_capacity(clean.len() + 32);
        for b in clean {
            if self.timestamps && self.line_start {
                let ts = chrono::Local::now().format("[%Y-%m-%d %H:%M:%S] ");
                out.extend_from_slice(ts.to_string().as_bytes());
            }
            self.line_start = b == b'\n';
            out.push(b);
        }
        let _ = self.file.write_all(&out);
    }
}

/// Resumen de una conexión abierta (para MCP y scripts).
#[derive(serde::Serialize, Clone)]
pub struct ConnInfo {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: SessionType,
    pub target: String,
}

enum Transport {
    Pty {
        master: Box<dyn MasterPty + Send>,
        writer: Box<dyn Write + Send>,
        killer: Box<dyn ChildKiller + Send + Sync>,
    },
    Telnet {
        stream: TcpStream,
        shared: Arc<Mutex<TelnetShared>>,
    },
    Serial {
        port: Box<dyn serialport::SerialPort>,
        stop: Arc<AtomicBool>,
    },
}

struct Connection {
    transport: Transport,
    sink: Sink,
    name: String,
    session: Session,
}

#[derive(Default)]
pub struct ConnectionManager {
    conns: Mutex<HashMap<String, Connection>>,
}

impl ConnectionManager {
    pub fn connect(
        &self,
        id: String,
        session: &Session,
        cols: u16,
        rows: u16,
        data: Channel<InvokeResponseBody>,
        exit: Channel<String>,
    ) -> Result<(), String> {
        // Una reconexión reutiliza el id: se cierra lo anterior primero.
        self.disconnect(&id);

        let sink = Sink {
            data,
            exit,
            exited: Arc::new(AtomicBool::new(false)),
            log: Arc::new(Mutex::new(None)),
            mirror: Arc::new(Mutex::new(Mirror::default())),
        };

        let transport = match session.session_type {
            SessionType::Local => spawn_pty(local_shell(), cols, rows, &sink)?,
            SessionType::Ssh => spawn_pty(ssh_command(session)?, cols, rows, &sink)?,
            SessionType::Telnet => open_telnet(session, cols, rows, &sink)?,
            SessionType::Serial => open_serial(session, &sink)?,
        };

        self.conns.lock().unwrap().insert(
            id,
            Connection {
                transport,
                sink,
                name: session.name.clone(),
                session: session.clone(),
            },
        );
        Ok(())
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let mut map = self.conns.lock().unwrap();
        let conn = map.get_mut(id).ok_or("Sesión no conectada")?;
        let res = match &mut conn.transport {
            Transport::Pty { writer, .. } => writer.write_all(data).and_then(|_| writer.flush()),
            Transport::Telnet { stream, .. } => stream.write_all(&telnet::encode_input(data)),
            Transport::Serial { port, .. } => port.write_all(data).and_then(|_| port.flush()),
        };
        res.map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let mut map = self.conns.lock().unwrap();
        let Some(conn) = map.get_mut(id) else {
            return Ok(());
        };
        match &mut conn.transport {
            Transport::Pty { master, .. } => master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| e.to_string()),
            Transport::Telnet { stream, shared } => {
                let mut s = shared.lock().unwrap();
                s.cols = cols;
                s.rows = rows;
                if s.naws {
                    let _ = stream.write_all(&telnet::naws(cols, rows));
                }
                Ok(())
            }
            Transport::Serial { .. } => Ok(()),
        }
    }

    pub fn send_break(&self, id: &str) -> Result<(), String> {
        let map = self.conns.lock().unwrap();
        let conn = map.get(id).ok_or("Sesión no conectada")?;
        match &conn.transport {
            Transport::Serial { port, .. } => {
                port.set_break().map_err(|e| e.to_string())?;
                thread::sleep(Duration::from_millis(300));
                port.clear_break().map_err(|e| e.to_string())
            }
            Transport::Telnet { stream, .. } => {
                (&*stream)
                    .write_all(&[telnet::IAC, telnet::BRK])
                    .map_err(|e| e.to_string())
            }
            Transport::Pty { .. } => Err("Break solo aplica a Serial y Telnet".into()),
        }
    }

    /// Activa o desactiva el log. Devuelve la ruta del archivo cuando se activa.
    pub fn set_logging(
        &self,
        id: &str,
        enabled: bool,
        timestamps: bool,
        dir: &Path,
    ) -> Result<Option<String>, String> {
        let map = self.conns.lock().unwrap();
        let conn = map.get(id).ok_or("Sesión no conectada")?;
        let mut log = conn.sink.log.lock().unwrap();
        if !enabled {
            *log = None;
            return Ok(None);
        }
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let safe: String = conn
            .name
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
            .collect();
        let path: PathBuf = dir.join(format!(
            "{}_{}.log",
            safe,
            chrono::Local::now().format("%Y%m%d-%H%M%S")
        ));
        let file = File::create(&path).map_err(|e| e.to_string())?;
        *log = Some(LogWriter::new(file, timestamps));
        Ok(Some(path.to_string_lossy().into_owned()))
    }

    pub fn list(&self) -> Vec<ConnInfo> {
        let map = self.conns.lock().unwrap();
        let mut list: Vec<_> = map
            .iter()
            .filter(|(_, c)| !c.sink.exited.load(Ordering::SeqCst))
            .map(|(id, c)| ConnInfo {
                id: id.clone(),
                name: c.name.clone(),
                kind: c.session.session_type.clone(),
                target: match c.session.session_type {
                    SessionType::Serial => c.session.serial_port.clone().unwrap_or_default(),
                    SessionType::Local => "local".into(),
                    _ => format!(
                        "{}{}",
                        c.session.username.as_deref().map(|u| format!("{u}@")).unwrap_or_default(),
                        c.session.host.clone().unwrap_or_default()
                    ),
                },
            })
            .collect();
        list.sort_by(|a, b| a.id.cmp(&b.id));
        list
    }

    pub fn info(&self, id: &str) -> Option<(ConnInfo, Session)> {
        let info = self.list().into_iter().find(|c| c.id == id)?;
        let session = self.conns.lock().unwrap().get(id)?.session.clone();
        Some((info, session))
    }

    /// Últimos `max` caracteres de salida en texto limpio.
    pub fn history(&self, id: &str, max: usize) -> Option<String> {
        let map = self.conns.lock().unwrap();
        let mirror = map.get(id)?.sink.mirror.lock().unwrap();
        let h = &mirror.history;
        let mut start = h.len().saturating_sub(max);
        while !h.is_char_boundary(start) {
            start += 1;
        }
        Some(h[start..].to_string())
    }

    /// Suscripción a la salida en vivo; se cancela sola al soltar el receptor.
    pub fn tap(&self, id: &str) -> Option<std::sync::mpsc::Receiver<String>> {
        let map = self.conns.lock().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        map.get(id)?.sink.mirror.lock().unwrap().taps.push(tx);
        Some(rx)
    }

    pub fn disconnect(&self, id: &str) {
        let Some(conn) = self.conns.lock().unwrap().remove(id) else {
            return;
        };
        // Marcado como cerrado para que los hilos no notifiquen un cierre "inesperado".
        conn.sink.exited.store(true, Ordering::SeqCst);
        match conn.transport {
            Transport::Pty { mut killer, .. } => {
                let _ = killer.kill();
            }
            Transport::Telnet { stream, .. } => {
                let _ = stream.shutdown(Shutdown::Both);
            }
            Transport::Serial { stop, .. } => stop.store(true, Ordering::SeqCst),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::LogWriter;

    #[test]
    fn rejects_argument_injection() {
        assert!(super::safe_target("-oProxyCommand=sh", "host").is_err());
        assert!(super::safe_target("10.0.0.1 -v", "host").is_err());
        assert_eq!(super::safe_target(" router.lab ", "host").unwrap(), "router.lab");
        let bad = |s: &str| super::check_extra_args(&super::split_args(s)).is_err();
        assert!(bad("-oProxyCommand=curl x|sh"));
        assert!(bad("-o ProxyCommand=nc %h %p"));
        assert!(bad("-o 'LocalCommand id'"));
        assert!(bad("-F /tmp/evil_config"));
        assert!(bad("-o KnownHostsCommand=/bin/x"));
        assert!(!bad("-L 8443:10.0.0.1:443 -A -o StrictHostKeyChecking=accept-new"));
        assert!(!bad("-f -N -D 1080"));
    }

    #[test]
    fn splits_ssh_args_with_quotes() {
        assert_eq!(
            super::split_args(r#"-L 8443:10.0.0.1:443 -o "ProxyCommand=nc -X 5 %h %p" -A"#),
            vec!["-L", "8443:10.0.0.1:443", "-o", "ProxyCommand=nc -X 5 %h %p", "-A"]
        );
        assert!(super::split_args("   ").is_empty());
    }

    #[test]
    fn legacy_options_only_use_supported_algorithms() {
        let opts = super::legacy_options();
        // En OpenSSH >= 10 ssh-dss ya no existe y no debe pedirse.
        let ver = std::process::Command::new("ssh").arg("-V").output();
        if let Ok(v) = ver {
            if String::from_utf8_lossy(&v.stderr).contains("OpenSSH_10") {
                assert!(opts.iter().all(|o| !o.contains("ssh-dss")));
            }
        }
        for o in opts {
            let ok = std::process::Command::new("ssh").args(["-G", "-o", o, "x"]).output().unwrap();
            assert!(ok.status.success(), "ssh rechazó {o}");
        }
    }

    #[test]
    fn log_strips_ansi_and_stamps_lines() {
        let path = std::env::temp_dir().join(format!("nt-log-{}.log", std::process::id()));
        let mut w = LogWriter::new(std::fs::File::create(&path).unwrap(), true);
        w.write(b"\x1b[32mRouter#\x1b[0m show ver\r\nCisco");
        w.write(b" IOS\r\n");
        drop(w);
        let text = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<_> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].starts_with('[') && lines[0].ends_with("] Router# show ver"));
        assert!(lines[1].ends_with("] Cisco IOS"));
        let _ = std::fs::remove_file(path);
    }
}

// ---------- PTY (local y SSH) ----------

fn local_shell() -> CommandBuilder {
    if cfg!(windows) {
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.arg("-NoLogo");
        if let Some(home) = std::env::var_os("USERPROFILE") {
            cmd.cwd(home);
        }
        cmd
    } else {
        // Shell de login del usuario, en su home.
        CommandBuilder::new_default_prog()
    }
}

/// Host o destino seguro para pasar a ssh: sin espacios, sin control y sin empezar con
/// "-" (evita que un valor como "-oProxyCommand=..." se interprete como opción).
fn safe_target(value: &str, field: &str) -> Result<String, String> {
    let v = value.trim();
    if v.is_empty() {
        return Err(format!("Falta {field}"));
    }
    if v.starts_with('-') || v.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(format!("{field} inválido: {v}"));
    }
    Ok(v.to_string())
}

/// Opciones de ssh que ejecutan comandos locales. No se aceptan en "argumentos extra"
/// (que pueden venir de sesiones importadas); quien las necesite usa ~/.ssh/config.
const BLOCKED_SSH_OPTIONS: [&str; 6] =
    ["proxycommand", "localcommand", "permitlocalcommand", "knownhostscommand", "match", "remotecommand"];

fn check_extra_args(args: &[String]) -> Result<(), String> {
    for (i, a) in args.iter().enumerate() {
        let lower = a.to_ascii_lowercase();
        // Formas: "-oProxyCommand=x", "-o ProxyCommand=x", "-o" "ProxyCommand x"
        let opt = if lower == "-o" {
            args.get(i + 1).map(|n| n.to_ascii_lowercase()).unwrap_or_default()
        } else {
            lower.strip_prefix("-o").unwrap_or("").to_string()
        };
        let name = opt.split(['=', ' ']).next().unwrap_or("").trim();
        if BLOCKED_SSH_OPTIONS.contains(&name) {
            return Err(format!(
                "Opción no permitida en argumentos extra: {name}. Configúrala en ~/.ssh/config si la necesitas."
            ));
        }
        // -F permitiría cargar un archivo de configuración arbitrario con esas opciones.
        if a.starts_with("-F") {
            return Err("La opción -F no está permitida en argumentos extra".into());
        }
    }
    Ok(())
}

fn ssh_command(s: &Session) -> Result<CommandBuilder, String> {
    let host = safe_target(s.host.as_deref().unwrap_or(""), "el host")?;
    let mut cmd = CommandBuilder::new(SSH_BIN);
    cmd.args(["-o", "ServerAliveInterval=30", "-o", "ConnectTimeout=15"]);
    if let Some(port) = s.port.filter(|p| *p != 22) {
        cmd.args(["-p", &port.to_string()]);
    }
    if let Some(user) = s.username.as_deref().filter(|u| !u.is_empty()) {
        cmd.args(["-l", user]);
    }
    if let Some(key) = s.identity_file.as_deref().filter(|k| !k.is_empty()) {
        cmd.args(["-i", key]);
    }
    if let Some(jump) = s.jump_host.as_deref().filter(|j| !j.trim().is_empty()) {
        cmd.args(["-J".to_string(), safe_target(jump, "el jump host")?]);
    }
    if s.legacy_ssh.unwrap_or(false) {
        for opt in legacy_options() {
            cmd.args(["-o", opt]);
        }
    }
    if let Some(extra) = s.ssh_args.as_deref() {
        let extra = split_args(extra);
        check_extra_args(&extra)?;
        cmd.args(extra);
    }
    // "--" cierra las opciones: el host nunca se interpreta como opción.
    cmd.arg("--");
    cmd.arg(host);
    Ok(cmd)
}

const SSH_BIN: &str = if cfg!(windows) { "ssh.exe" } else { "ssh" };

/// Algoritmos que OpenSSH deshabilita por defecto pero que equipos antiguos aún exigen.
/// Solo se piden los que el OpenSSH instalado soporta: si se nombra uno inexistente
/// (p. ej. ssh-dss en OpenSSH 10), ssh rechaza la conexión completa.
fn legacy_options() -> &'static [String] {
    static OPTS: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    OPTS.get_or_init(|| {
        let wanted: [(&str, &str, &[&str]); 5] = [
            (
                "KexAlgorithms",
                "kex",
                &["diffie-hellman-group-exchange-sha1", "diffie-hellman-group14-sha1", "diffie-hellman-group1-sha1"],
            ),
            ("HostKeyAlgorithms", "key", &["ssh-rsa", "ssh-dss"]),
            ("PubkeyAcceptedAlgorithms", "key", &["ssh-rsa", "ssh-dss"]),
            ("Ciphers", "cipher", &["aes128-cbc", "aes192-cbc", "aes256-cbc", "3des-cbc"]),
            ("MACs", "mac", &["hmac-sha1", "hmac-sha1-96", "hmac-md5", "hmac-md5-96"]),
        ];
        wanted
            .iter()
            .filter_map(|(opt, query, algs)| {
                let mut q = std::process::Command::new(SSH_BIN);
                q.args(["-Q", query]);
                #[cfg(windows)]
                {
                    // Sin ventana de consola al consultar desde la app gráfica.
                    use std::os::windows::process::CommandExt;
                    q.creation_flags(0x0800_0000);
                }
                let out = q.output().ok()?;
                let supported: std::collections::HashSet<_> =
                    String::from_utf8_lossy(&out.stdout).lines().map(str::to_owned).collect();
                let list: Vec<_> = algs.iter().filter(|a| supported.contains(**a)).copied().collect();
                (!list.is_empty()).then(|| format!("{opt}=+{}", list.join(",")))
            })
            .collect()
    })
}

/// Divide argumentos como una shell simple: respeta comillas simples y dobles.
fn split_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut has = false;
    for c in s.chars() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => cur.push(c),
            (None, '"' | '\'') => {
                quote = Some(c);
                has = true;
            }
            (None, c) if c.is_whitespace() => {
                if has || !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
                has = false;
            }
            (None, c) => cur.push(c),
        }
    }
    if has || !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn spawn_pty(mut cmd: CommandBuilder, cols: u16, rows: u16, sink: &Sink) -> Result<Transport, String> {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    // Apps GUI en macOS no heredan LANG: sin esto zsh/ssh rompen los caracteres UTF-8.
    if std::env::var_os("LANG").is_none() && !cfg!(windows) {
        cmd.env("LANG", "en_US.UTF-8");
    }

    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("No se pudo crear la PTY: {e}"))?;

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| {
        format!("No se pudo iniciar el proceso: {e}. Si es SSH, verifica que OpenSSH esté instalado.")
    })?;
    drop(pair.slave);

    let killer = child.clone_killer();
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let s = sink.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            s.push(&buf[..n]);
        }
    });

    // El fin del proceso se detecta con wait(): en Windows (ConPTY) el lector no recibe EOF.
    let s = sink.clone();
    thread::spawn(move || {
        let status = child.wait();
        thread::sleep(Duration::from_millis(150)); // deja drenar la salida pendiente
        let msg = match status {
            Ok(st) if st.success() => "Sesión finalizada".to_string(),
            Ok(st) => format!("Proceso terminado (código {})", st.exit_code()),
            Err(e) => format!("Proceso terminado: {e}"),
        };
        s.close(msg);
    });

    Ok(Transport::Pty {
        master: pair.master,
        writer,
        killer,
    })
}

// ---------- Telnet ----------

fn open_telnet(s: &Session, cols: u16, rows: u16, sink: &Sink) -> Result<Transport, String> {
    let host = s
        .host
        .as_deref()
        .map(str::trim)
        .filter(|h| !h.is_empty())
        .ok_or("Falta el host")?;
    let port = s.port.unwrap_or(23);
    let addrs: Vec<_> = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("No se pudo resolver {host}: {e}"))?
        .collect();

    let mut last_err = String::from("sin direcciones");
    let stream = addrs
        .iter()
        .find_map(|a| match TcpStream::connect_timeout(a, Duration::from_secs(10)) {
            Ok(st) => Some(st),
            Err(e) => {
                last_err = e.to_string();
                None
            }
        })
        .ok_or_else(|| format!("No se pudo conectar a {host}:{port}: {last_err}"))?;
    let _ = stream.set_nodelay(true);

    let shared = Arc::new(Mutex::new(TelnetShared::new(cols, rows)));
    let mut reader = stream.try_clone().map_err(|e| e.to_string())?;
    let mut replier = stream.try_clone().map_err(|e| e.to_string())?;
    let sh = shared.clone();
    let s = sink.clone();

    thread::spawn(move || {
        let mut parser = telnet::Parser::default();
        let mut buf = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    s.close("Conexión cerrada por el host remoto");
                    break;
                }
                Ok(n) => {
                    let (data, reply) = parser.feed(&buf[..n], &sh);
                    if !reply.is_empty() {
                        let _ = replier.write_all(&reply);
                    }
                    s.push(&data);
                }
                Err(e) => {
                    s.close(format!("Conexión perdida: {e}"));
                    break;
                }
            }
        }
    });

    Ok(Transport::Telnet { stream, shared })
}

// ---------- Serial ----------

fn open_serial(s: &Session, sink: &Sink) -> Result<Transport, String> {
    use serialport::{DataBits, FlowControl, Parity, StopBits};

    let path = s
        .serial_port
        .as_deref()
        .filter(|p| !p.is_empty())
        .ok_or("Falta el puerto serial")?;
    let data_bits = match s.data_bits.unwrap_or(8) {
        5 => DataBits::Five,
        6 => DataBits::Six,
        7 => DataBits::Seven,
        _ => DataBits::Eight,
    };
    let stop_bits = if s.stop_bits == Some(2) { StopBits::Two } else { StopBits::One };
    let parity = match s.parity.as_deref() {
        Some("odd") => Parity::Odd,
        Some("even") => Parity::Even,
        _ => Parity::None,
    };
    let flow = match s.flow_control.as_deref() {
        Some("software") => FlowControl::Software,
        Some("hardware") => FlowControl::Hardware,
        _ => FlowControl::None,
    };

    let port = serialport::new(path, s.baud_rate.unwrap_or(9600))
        .data_bits(data_bits)
        .stop_bits(stop_bits)
        .parity(parity)
        .flow_control(flow)
        .timeout(Duration::from_millis(50))
        .open()
        .map_err(|e| format!("No se pudo abrir {path}: {e}"))?;

    let mut reader = port.try_clone().map_err(|e| e.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let st = stop.clone();
    let sk = sink.clone();

    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while !st.load(Ordering::SeqCst) {
            match reader.read(&mut buf) {
                Ok(n) => sk.push(&buf[..n]),
                Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                Err(e) => {
                    sk.close(format!("Puerto desconectado: {e}"));
                    break;
                }
            }
        }
    });

    Ok(Transport::Serial { port, stop })
}

pub fn list_serial_ports() -> Vec<crate::models::SerialPortInfo> {
    use serialport::SerialPortType;
    let mut ports: Vec<_> = serialport::available_ports()
        .unwrap_or_default()
        .into_iter()
        // En macOS cada puerto aparece como tty.* y cu.*; cu.* es el correcto para salir.
        .filter(|p| !p.port_name.starts_with("/dev/tty.") || cfg!(not(target_os = "macos")))
        .map(|p| crate::models::SerialPortInfo {
            port_type: match p.port_type {
                SerialPortType::UsbPort(info) => info
                    .product
                    .map(|n| format!("USB · {n}"))
                    .unwrap_or_else(|| "USB".into()),
                SerialPortType::PciPort => "PCI".into(),
                SerialPortType::BluetoothPort => "Bluetooth".into(),
                SerialPortType::Unknown => "Serial".into(),
            },
            port_name: p.port_name,
        })
        .collect();
    ports.sort_by(|a, b| a.port_name.cmp(&b.port_name));
    ports
}
