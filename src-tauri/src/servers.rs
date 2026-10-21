//! Servidores locales para el trabajo con equipos: TFTP (RFC 1350 + blksize/tsize),
//! HTTP de solo lectura y Syslog (UDP). Apagados por defecto; escuchan solo mientras
//! el usuario los mantiene activos.

use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::{SocketAddr, UdpSocket};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct Servers {
    flags: Mutex<HashMap<&'static str, Arc<AtomicBool>>>,
    http: Mutex<Option<Arc<tiny_http::Server>>>,
}

#[derive(Serialize, Clone)]
struct TransferEvent {
    id: String,
    proto: &'static str,
    client: String,
    file: String,
    dir: &'static str, // "get" (equipo descarga) | "put" (equipo sube)
    bytes: u64,
    total: Option<u64>,
    done: bool,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct SyslogMsg {
    ts: i64,
    src: String,
    severity: u8,
    facility: u8,
    msg: String,
}

/// Ruta segura dentro de `root`: sin "..", sin rutas absolutas ni unidades.
pub fn safe_path(root: &Path, requested: &str) -> Option<PathBuf> {
    let req = requested.replace('\\', "/");
    let mut out = root.to_path_buf();
    for comp in Path::new(req.trim_start_matches('/')).components() {
        match comp {
            Component::Normal(c) => out.push(c),
            Component::CurDir => {}
            _ => return None, // ParentDir, RootDir, Prefix (C:\)
        }
    }
    (out != root).then_some(out)
}

/// Verifica que la ruta real (tras resolver enlaces) siga dentro de `root`.
fn inside_root(root: &Path, path: &Path) -> bool {
    let Ok(root) = root.canonicalize() else { return false };
    let target = if path.exists() { path.canonicalize() } else { path.parent().map(|p| p.canonicalize()).unwrap_or(Err(std::io::ErrorKind::NotFound.into())) };
    target.map(|t| t.starts_with(&root)).unwrap_or(false)
}

impl Servers {
    fn flag(&self, name: &'static str) -> Arc<AtomicBool> {
        let f = Arc::new(AtomicBool::new(true));
        if let Some(old) = self.flags.lock().unwrap().insert(name, f.clone()) {
            old.store(false, Ordering::SeqCst);
        }
        f
    }

    pub fn stop(&self, name: &str) {
        if let Some(f) = self.flags.lock().unwrap().remove(name) {
            f.store(false, Ordering::SeqCst);
        }
        if name == "http" {
            if let Some(s) = self.http.lock().unwrap().take() {
                s.unblock();
            }
        }
    }

    pub fn running(&self) -> Vec<String> {
        let mut v: Vec<String> = self.flags.lock().unwrap().keys().map(|k| k.to_string()).collect();
        if self.http.lock().unwrap().is_some() {
            v.push("http".into());
        }
        v
    }

    // ---------- TFTP ----------

    pub fn start_tftp(&self, app: AppHandle, root: PathBuf, port: u16, allow_write: bool) -> Result<String, String> {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        self.stop("tftp");
        let sock = bind_udp(port).map_err(|e| bind_error("TFTP", port, e))?;
        sock.set_read_timeout(Some(Duration::from_millis(400))).ok();
        let flag = self.flag("tftp");
        std::thread::spawn(move || {
            let mut buf = [0u8; 2048];
            // Sesiones activas por equipo: descarta pedidos retransmitidos (el mismo RRQ dos
            // veces abriría dos envíos en paralelo) y limita los hilos ante un flood UDP.
            let active: Arc<Mutex<std::collections::HashSet<SocketAddr>>> = Arc::default();
            while flag.load(Ordering::SeqCst) {
                let Ok((n, peer)) = sock.recv_from(&mut buf) else { continue };
                {
                    let mut set = active.lock().unwrap();
                    if set.contains(&peer) || set.len() >= TFTP_MAX_SESSIONS {
                        continue;
                    }
                    set.insert(peer);
                }
                let req = buf[..n].to_vec();
                let (app, root, flag, active) = (app.clone(), root.clone(), flag.clone(), active.clone());
                std::thread::spawn(move || {
                    tftp_session(app, root, allow_write, peer, req, flag);
                    active.lock().unwrap().remove(&peer);
                });
            }
        });
        Ok(format!("TFTP escuchando en UDP {port}"))
    }

    // ---------- HTTP ----------

    pub fn start_http(&self, app: AppHandle, root: PathBuf, port: u16) -> Result<String, String> {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        self.stop("http");
        let server = Arc::new(
            tiny_http::Server::http(("0.0.0.0", port)).map_err(|e| format!("No se pudo abrir el puerto HTTP {port}: {e}"))?,
        );
        *self.http.lock().unwrap() = Some(server.clone());
        std::thread::spawn(move || {
            let active = Arc::new(AtomicUsize::new(0));
            for req in server.incoming_requests() {
                let (app, root) = (app.clone(), root.clone());
                if let Err(req) = spawn_limited(&active, HTTP_MAX_CLIENTS, req, move |req| http_serve(app, root, req)) {
                    let _ = req.respond(tiny_http::Response::empty(503));
                }
            }
        });
        Ok(format!("HTTP escuchando en TCP {port} (solo lectura)"))
    }

    // ---------- Syslog ----------

    pub fn start_syslog(&self, app: AppHandle, port: u16, save_dir: Option<PathBuf>) -> Result<String, String> {
        self.stop("syslog");
        let sock = bind_udp(port).map_err(|e| bind_error("Syslog", port, e))?;
        sock.set_read_timeout(Some(Duration::from_millis(200))).ok();
        let flag = self.flag("syslog");
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let mut batch: Vec<SyslogMsg> = Vec::new();
            let mut last_flush = Instant::now();
            let mut file: Option<(String, File)> = None;
            while flag.load(Ordering::SeqCst) {
                if let Ok((n, peer)) = sock.recv_from(&mut buf) {
                    let msg = parse_syslog(&String::from_utf8_lossy(&buf[..n]), peer);
                    if let Some(dir) = &save_dir {
                        let day = chrono::Local::now().format("%Y-%m-%d").to_string();
                        if file.as_ref().map(|(d, _)| d != &day).unwrap_or(true) {
                            let _ = fs::create_dir_all(dir);
                            file = fs::OpenOptions::new()
                                .create(true)
                                .append(true)
                                .open(dir.join(format!("syslog_{day}.log")))
                                .ok()
                                .map(|f| (day, f));
                        }
                        if let Some((_, f)) = file.as_mut() {
                            let _ = writeln!(f, "{} {} <{}.{}> {}", chrono::Local::now().format("%H:%M:%S"), msg.src, msg.facility, msg.severity, msg.msg);
                        }
                    }
                    batch.push(msg);
                }
                // Envío por lotes para no saturar la interfaz con ráfagas de logs.
                if !batch.is_empty() && (last_flush.elapsed() > Duration::from_millis(250) || batch.len() >= 500) {
                    let _ = app.emit("syslog", std::mem::take(&mut batch));
                    last_flush = Instant::now();
                }
            }
        });
        Ok(format!("Syslog escuchando en UDP {port}"))
    }
}

/// Descargas HTTP simultáneas como máximo (un hilo por cliente).
const HTTP_MAX_CLIENTS: usize = 32;

/// Atiende `item` en un hilo propio si hay cupo; si no, lo devuelve para rechazarlo. Evita
/// que una ráfaga de peticiones cree hilos sin límite.
pub fn spawn_limited<T: Send + 'static>(
    active: &Arc<AtomicUsize>,
    max: usize,
    item: T,
    f: impl FnOnce(T) + Send + 'static,
) -> Result<(), T> {
    if active.fetch_add(1, Ordering::SeqCst) >= max {
        active.fetch_sub(1, Ordering::SeqCst);
        return Err(item);
    }
    struct Slot(Arc<AtomicUsize>);
    impl Drop for Slot {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
        }
    }
    let slot = Slot(active.clone());
    std::thread::spawn(move || {
        let _slot = slot;
        f(item);
    });
    Ok(())
}

/// Al reiniciar un servidor, el hilo anterior suelta el puerto en hasta ~400 ms.
fn bind_udp(port: u16) -> std::io::Result<UdpSocket> {
    let mut last = None;
    for _ in 0..10 {
        match UdpSocket::bind(("0.0.0.0", port)) {
            Ok(s) => return Ok(s),
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
                last = Some(e);
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(e) => return Err(e),
        }
    }
    Err(last.unwrap())
}

fn bind_error(what: &str, port: u16, e: std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::PermissionDenied && port < 1024 {
        format!("{what}: el puerto {port} requiere privilegios en este sistema. Usa un puerto mayor a 1024 (ej. {}).", port as u32 + 1000)
    } else if e.kind() == std::io::ErrorKind::AddrInUse {
        format!("{what}: el puerto {port} ya está en uso por otra aplicación")
    } else {
        format!("{what}: {e}")
    }
}

pub fn parse_syslog(raw: &str, peer: SocketAddr) -> SyslogMsg {
    let raw = raw.trim_end_matches(['\n', '\r', '\0']);
    let (pri, rest) = raw
        .strip_prefix('<')
        .and_then(|r| r.split_once('>'))
        .and_then(|(p, rest)| p.parse::<u16>().ok().filter(|p| *p <= 191).map(|p| (p, rest)))
        .unwrap_or((13, raw)); // user.notice por defecto (RFC 3164)
    SyslogMsg {
        ts: chrono::Utc::now().timestamp_millis(),
        src: peer.ip().to_string(),
        severity: (pri & 7) as u8,
        facility: (pri >> 3) as u8,
        msg: rest.trim().chars().take(4000).collect(),
    }
}

// ---------- TFTP: una transferencia ----------

const OP_RRQ: u16 = 1;
const OP_WRQ: u16 = 2;
const OP_DATA: u16 = 3;
const OP_ACK: u16 = 4;
const OP_ERROR: u16 = 5;
const OP_OACK: u16 = 6;
const RETRIES: u32 = 5;

fn tftp_error(sock: &UdpSocket, peer: SocketAddr, code: u16, msg: &str) {
    let mut p = vec![0, OP_ERROR as u8];
    p.extend(code.to_be_bytes());
    p.extend(msg.as_bytes());
    p.push(0);
    let _ = sock.send_to(&p, peer);
}

/// Sesiones TFTP simultáneas como máximo.
const TFTP_MAX_SESSIONS: usize = 16;
/// Tamaño máximo de un archivo recibido por TFTP (imágenes de firmware grandes incluidas).
const TFTP_MAX_UPLOAD: u64 = 8 * 1024 * 1024 * 1024;

fn tftp_session(app: AppHandle, root: PathBuf, allow_write: bool, peer: SocketAddr, req: Vec<u8>, flag: Arc<AtomicBool>) {
    let Ok(sock) = UdpSocket::bind(("0.0.0.0", 0)) else { return };
    if req.len() < 4 {
        return;
    }
    let op = u16::from_be_bytes([req[0], req[1]]);
    let fields: Vec<String> = req[2..].split(|b| *b == 0).map(|s| String::from_utf8_lossy(s).into_owned()).collect();
    let (Some(name), Some(mode)) = (fields.first().cloned(), fields.get(1)) else { return };
    if !mode.eq_ignore_ascii_case("octet") && !mode.eq_ignore_ascii_case("netascii") {
        return tftp_error(&sock, peer, 0, "Modo no soportado");
    }
    let mut opts: HashMap<String, String> = HashMap::new();
    let mut i = 2;
    while i + 1 < fields.len() {
        if !fields[i].is_empty() {
            opts.insert(fields[i].to_lowercase(), fields[i + 1].clone());
        }
        i += 2;
    }

    let id = uuid::Uuid::new_v4().to_string();
    let Some(path) = safe_path(&root, &name) else {
        return tftp_error(&sock, peer, 2, "Ruta no permitida");
    };
    let blksize = opts.get("blksize").and_then(|v| v.parse::<usize>().ok()).map(|b| b.clamp(8, 65464));
    let timeout = opts.get("timeout").and_then(|v| v.parse::<u64>().ok()).map(|t| t.clamp(1, 255));
    sock.set_read_timeout(Some(Duration::from_secs(timeout.unwrap_or(3)))).ok();
    let block = blksize.unwrap_or(512);

    let report = |bytes: u64, total: Option<u64>, done: bool, error: Option<String>, dir: &'static str| {
        let _ = app.emit(
            "transfer",
            TransferEvent { id: id.clone(), proto: "tftp", client: peer.to_string(), file: name.clone(), dir, bytes, total, done, error },
        );
    };

    match op {
        OP_RRQ => {
            if !path.is_file() || !inside_root(&root, &path) {
                report(0, None, true, Some("Archivo no encontrado".into()), "get");
                return tftp_error(&sock, peer, 1, "Archivo no encontrado");
            }
            let Ok(mut file) = File::open(&path) else {
                return tftp_error(&sock, peer, 2, "Acceso denegado");
            };
            let total = file.metadata().map(|m| m.len()).ok();
            // Opciones aceptadas -> OACK y esperar ACK 0
            let mut oack = Vec::new();
            if let Some(b) = blksize {
                oack.push(("blksize".to_string(), b.to_string()));
            }
            if opts.contains_key("tsize") {
                oack.push(("tsize".to_string(), total.unwrap_or(0).to_string()));
            }
            if let Some(t) = timeout {
                oack.push(("timeout".to_string(), t.to_string()));
            }
            if !oack.is_empty() && !send_oack(&sock, peer, &oack, 0) {
                return report(0, total, true, Some("El cliente no confirmó opciones".into()), "get");
            }
            let mut buf = vec![0u8; block];
            let mut blockno: u16 = 1;
            let mut sent: u64 = 0;
            let mut last_report = Instant::now();
            loop {
                if !flag.load(Ordering::SeqCst) {
                    tftp_error(&sock, peer, 0, "Servidor detenido");
                    return report(sent, total, true, Some("Servidor detenido".into()), "get");
                }
                let n = read_full(&mut file, &mut buf);
                let mut pkt = vec![0, OP_DATA as u8];
                pkt.extend(blockno.to_be_bytes());
                pkt.extend(&buf[..n]);
                if !send_and_wait_ack(&sock, peer, &pkt, blockno) {
                    return report(sent, total, true, Some("Tiempo agotado esperando al equipo".into()), "get");
                }
                sent += n as u64;
                if last_report.elapsed() > Duration::from_millis(300) {
                    report(sent, total, false, None, "get");
                    last_report = Instant::now();
                }
                if n < block {
                    return report(sent, total, true, None, "get");
                }
                blockno = blockno.wrapping_add(1);
            }
        }
        OP_WRQ => {
            if !allow_write {
                report(0, None, true, Some("Escritura deshabilitada".into()), "put");
                return tftp_error(&sock, peer, 2, "Escritura deshabilitada en el servidor");
            }
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if !inside_root(&root, &path) {
                return tftp_error(&sock, peer, 2, "Ruta no permitida");
            }
            let total = opts.get("tsize").and_then(|v| v.parse::<u64>().ok());
            if total.is_some_and(|t| t > TFTP_MAX_UPLOAD) {
                return tftp_error(&sock, peer, 3, "Archivo demasiado grande");
            }
            // Temporal único: dos subidas a la vez (ios.bin e ios.txt) no deben pisarse.
            let fname = path.file_name().and_then(|f| f.to_str()).unwrap_or("archivo");
            let tmp = path.with_file_name(format!(".{fname}.{}.part", uuid::Uuid::new_v4().simple()));
            let Ok(mut file) = File::create(&tmp) else {
                return tftp_error(&sock, peer, 2, "No se pudo crear el archivo");
            };
            let mut oack = Vec::new();
            if let Some(b) = blksize {
                oack.push(("blksize".to_string(), b.to_string()));
            }
            if let Some(t) = total {
                oack.push(("tsize".to_string(), t.to_string()));
            }
            let first_ack = if oack.is_empty() {
                let _ = sock.send_to(&[0, OP_ACK as u8, 0, 0], peer);
                true
            } else {
                let mut p = vec![0, OP_OACK as u8];
                for (k, v) in &oack {
                    p.extend(k.as_bytes());
                    p.push(0);
                    p.extend(v.as_bytes());
                    p.push(0);
                }
                sock.send_to(&p, peer).is_ok()
            };
            if !first_ack {
                return;
            }
            let mut expected: u16 = 1;
            let mut got: u64 = 0;
            let mut buf = vec![0u8; block + 4];
            let mut last_report = Instant::now();
            let mut retries = 0;
            loop {
                match sock.recv_from(&mut buf) {
                    Ok((n, from)) if from == peer && n >= 4 && u16::from_be_bytes([buf[0], buf[1]]) == OP_DATA => {
                        let bno = u16::from_be_bytes([buf[2], buf[3]]);
                        if bno == expected {
                            if file.write_all(&buf[4..n]).is_err() {
                                return tftp_error(&sock, peer, 3, "Disco lleno o error de escritura");
                            }
                            got += (n - 4) as u64;
                            if got > TFTP_MAX_UPLOAD {
                                drop(file);
                                let _ = fs::remove_file(&tmp);
                                report(got, total, true, Some("Archivo demasiado grande".into()), "put");
                                return tftp_error(&sock, peer, 3, "Archivo demasiado grande");
                            }
                            expected = expected.wrapping_add(1);
                            retries = 0;
                        }
                        let mut ack = vec![0, OP_ACK as u8];
                        ack.extend(bno.to_be_bytes());
                        let _ = sock.send_to(&ack, peer);
                        if last_report.elapsed() > Duration::from_millis(300) {
                            report(got, total, false, None, "put");
                            last_report = Instant::now();
                        }
                        if n - 4 < block && bno.wrapping_add(1) == expected {
                            drop(file);
                            let _ = fs::rename(&tmp, &path);
                            return report(got, total, true, None, "put");
                        }
                    }
                    Ok(_) => {}
                    Err(_) => {
                        retries += 1;
                        if retries > RETRIES || !flag.load(Ordering::SeqCst) {
                            let _ = fs::remove_file(&tmp);
                            return report(got, total, true, Some("Transferencia interrumpida".into()), "put");
                        }
                    }
                }
            }
        }
        _ => tftp_error(&sock, peer, 4, "Operación TFTP no válida"),
    }
}

fn read_full(file: &mut File, buf: &mut [u8]) -> usize {
    let mut n = 0;
    while n < buf.len() {
        match file.read(&mut buf[n..]) {
            Ok(0) | Err(_) => break,
            Ok(r) => n += r,
        }
    }
    n
}

fn send_oack(sock: &UdpSocket, peer: SocketAddr, opts: &[(String, String)], expect_ack: u16) -> bool {
    let mut p = vec![0, OP_OACK as u8];
    for (k, v) in opts {
        p.extend(k.as_bytes());
        p.push(0);
        p.extend(v.as_bytes());
        p.push(0);
    }
    send_and_wait_ack(sock, peer, &p, expect_ack)
}

fn send_and_wait_ack(sock: &UdpSocket, peer: SocketAddr, pkt: &[u8], blockno: u16) -> bool {
    let mut buf = [0u8; 516];
    for _ in 0..RETRIES {
        if sock.send_to(pkt, peer).is_err() {
            return false;
        }
        let deadline = Instant::now() + sock.read_timeout().ok().flatten().unwrap_or(Duration::from_secs(3));
        while Instant::now() < deadline {
            match sock.recv_from(&mut buf) {
                Ok((n, from)) if from == peer && n >= 4 => {
                    let op = u16::from_be_bytes([buf[0], buf[1]]);
                    if op == OP_ERROR {
                        return false;
                    }
                    if op == OP_ACK && u16::from_be_bytes([buf[2], buf[3]]) == blockno {
                        return true;
                    }
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
    }
    false
}

// ---------- HTTP de solo lectura ----------

fn http_serve(app: AppHandle, root: PathBuf, req: tiny_http::Request) {
    let peer = req.remote_addr().map(|a| a.to_string()).unwrap_or_default();
    if *req.method() != tiny_http::Method::Get && *req.method() != tiny_http::Method::Head {
        let _ = req.respond(tiny_http::Response::empty(405));
        return;
    }
    let url = req.url().split('?').next().unwrap_or("/").to_string();
    let decoded = percent_decode(&url);
    if decoded == "/" {
        let mut names: Vec<String> = fs::read_dir(&root)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.path().is_file())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        let items: String = names
            .iter()
            .map(|n| {
                let esc = n.replace('&', "&amp;").replace('<', "&lt;").replace('"', "&quot;");
                format!("<li><a href=\"/{}\">{esc}</a></li>", percent_encode(n))
            })
            .collect();
        let html = format!("<!doctype html><meta charset=utf-8><title>NetTerminal</title><h3>Archivos</h3><ul>{items}</ul>");
        let resp = tiny_http::Response::from_string(html)
            .with_header(tiny_http::Header::from_bytes("Content-Type", "text/html; charset=utf-8").unwrap());
        let _ = req.respond(resp);
        return;
    }
    let path = match safe_path(&root, &decoded) {
        Some(p) if p.is_file() && inside_root(&root, &p) => p,
        _ => {
            let _ = req.respond(tiny_http::Response::empty(404));
            return;
        }
    };
    let Ok(file) = File::open(&path) else {
        let _ = req.respond(tiny_http::Response::empty(403));
        return;
    };
    let total = file.metadata().map(|m| m.len()).ok();
    let id = uuid::Uuid::new_v4().to_string();
    let name = decoded.trim_start_matches('/').to_string();
    let _ = app.emit(
        "transfer",
        TransferEvent { id: id.clone(), proto: "http", client: peer.clone(), file: name.clone(), dir: "get", bytes: 0, total, done: false, error: None },
    );
    let resp = tiny_http::Response::from_file(file)
        .with_header(tiny_http::Header::from_bytes("Content-Type", "application/octet-stream").unwrap());
    let result = req.respond(resp);
    let _ = app.emit(
        "transfer",
        TransferEvent {
            id,
            proto: "http",
            client: peer,
            file: name,
            dir: "get",
            bytes: if result.is_ok() { total.unwrap_or(0) } else { 0 },
            total,
            done: true,
            error: result.err().map(|e| e.to_string()),
        },
    );
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn percent_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_path_blocks_traversal() {
        let root = Path::new("/srv/tftp");
        assert_eq!(safe_path(root, "ios.bin"), Some(root.join("ios.bin")));
        assert_eq!(safe_path(root, "/flash/ios.bin"), Some(root.join("flash/ios.bin")));
        assert_eq!(safe_path(root, "../etc/passwd"), None);
        assert_eq!(safe_path(root, "a/../../x"), None);
        assert_eq!(safe_path(root, "..\\..\\windows\\win.ini"), None);
        assert_eq!(safe_path(root, ""), None);
    }

    #[test]
    fn spawn_limited_caps_concurrency() {
        let active = Arc::new(AtomicUsize::new(0));
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        let rx = Arc::new(Mutex::new(rx));
        for i in 0..3 {
            let rx = rx.clone();
            assert!(spawn_limited(&active, 3, i, move |_| {
                let _ = rx.lock().unwrap().recv();
            })
            .is_ok());
        }
        assert_eq!(spawn_limited(&active, 3, 99, |_| {}), Err(99));
        for _ in 0..3 {
            tx.send(()).unwrap();
        }
        for _ in 0..100 {
            if active.load(Ordering::SeqCst) == 0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(spawn_limited(&active, 3, 1, |_| {}).is_ok());
    }

    #[test]
    fn parses_syslog_priority() {
        let peer: SocketAddr = "10.0.0.1:514".parse().unwrap();
        let m = parse_syslog("<187>%LINK-3-UPDOWN: Interface Gi0/1, changed state to down\n", peer);
        assert_eq!((m.facility, m.severity), (23, 3));
        assert_eq!(m.src, "10.0.0.1");
        let raw = parse_syslog("sin prioridad", peer);
        assert_eq!(raw.severity, 5);
    }

    #[test]
    fn tftp_end_to_end_read_with_blksize() {
        // Servidor real en un puerto efímero y cliente TFTP mínimo.
        let dir = std::env::temp_dir().join(format!("nt-tftp-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let data: Vec<u8> = (0..20_000u32).map(|i| (i % 251) as u8).collect();
        fs::write(dir.join("fw.bin"), &data).unwrap();

        let server = UdpSocket::bind("127.0.0.1:0").unwrap();
        let addr = server.local_addr().unwrap();
        let root = dir.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 600];
            let (n, peer) = server.recv_from(&mut buf).unwrap();
            // Igual que tftp_session pero sin AppHandle: se prueba el núcleo de envío.
            let sock = UdpSocket::bind("127.0.0.1:0").unwrap();
            sock.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let fields: Vec<String> = buf[2..n].split(|b| *b == 0).map(|s| String::from_utf8_lossy(s).into_owned()).collect();
            let path = safe_path(&root, &fields[0]).unwrap();
            let mut f = File::open(path).unwrap();
            assert!(send_oack(&sock, peer, &[("blksize".into(), "1428".into())], 0));
            let mut b = vec![0u8; 1428];
            let mut no: u16 = 1;
            loop {
                let n = read_full(&mut f, &mut b);
                let mut pkt = vec![0, 3];
                pkt.extend(no.to_be_bytes());
                pkt.extend(&b[..n]);
                assert!(send_and_wait_ack(&sock, peer, &pkt, no));
                if n < 1428 {
                    break;
                }
                no += 1;
            }
        });

        let client = UdpSocket::bind("127.0.0.1:0").unwrap();
        client.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let mut rrq = vec![0, 1];
        rrq.extend(b"fw.bin\0octet\0blksize\01428\0");
        client.send_to(&rrq, addr).unwrap();
        let mut got: Vec<u8> = Vec::new();
        let mut buf = vec![0u8; 1432];
        loop {
            let (n, from) = client.recv_from(&mut buf).unwrap();
            let op = u16::from_be_bytes([buf[0], buf[1]]);
            let no = u16::from_be_bytes([buf[2], buf[3]]);
            if op == 6 {
                client.send_to(&[0, 4, 0, 0], from).unwrap();
                continue;
            }
            assert_eq!(op, 3);
            got.extend(&buf[4..n]);
            let mut ack = vec![0, 4];
            ack.extend(no.to_be_bytes());
            client.send_to(&ack, from).unwrap();
            if n - 4 < 1428 {
                break;
            }
        }
        assert_eq!(got, data);
        let _ = fs::remove_dir_all(dir);
    }
}
