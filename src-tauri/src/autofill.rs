//! Autocompletado de la contraseña guardada al conectar. Mira solo la línea final de la
//! salida limpia (texto sin ANSI) y responde una única vez por conexión. Ante cualquier
//! señal de fallo o de un flujo distinto al login normal, se detiene para no bloquear
//! cuentas (TACACS/RADIUS) ni entregar la contraseña a un segundo prompt.

use std::time::{Duration, Instant};
use zeroize::Zeroizing;

/// Ventana desde la conexión en la que se acepta el prompt.
pub const WINDOW: Duration = Duration::from_secs(60);
const LINE_MAX: usize = 512;

/// Textos que cancelan el autocompletado: credencial rechazada o posible MITM.
const ABORT: [&str; 8] = [
    "permission denied",
    "access denied",
    "authentication failed",
    "% login invalid",
    "login incorrect",
    "% bad passwords",
    "remote host identification has changed",
    "possible dns spoofing",
];

/// Prompts de contraseña que no son el login: cambio de clave vencida, confirmaciones.
const NOT_LOGIN: [&str; 6] = ["new ", "old ", "current", "retype", "again", "confirm"];

const HOSTKEY: &str = "are you sure you want to continue connecting";

pub struct AutoFill {
    secret: Zeroizing<String>,
    /// Usuario para Telnet/Serial/TCP (SSH lo pasa con -l).
    user: Option<String>,
    newline: &'static str,
    started: Instant,
    line: String,
    user_sent: bool,
    done: bool,
    /// Con salto por un bastión (ProxyJump), host de destino que debe nombrar el prompt.
    /// El bastión pide su propia contraseña antes ("noc@bastion's password:") y no debe
    /// recibir la del equipo.
    only_host: Option<String>,
}

impl AutoFill {
    pub fn new(secret: Zeroizing<String>, user: Option<String>, newline: &'static str, started: Instant) -> Self {
        AutoFill { secret, user, newline, started, line: String::new(), user_sent: false, done: false, only_host: None }
    }

    /// Responde solo prompts de OpenSSH que nombran este host ("u@host's password:" o
    /// "(u@host) Password:"). Uno de otro host se deja al operador sin cancelar.
    pub fn only_host(mut self, host: Option<String>) -> Self {
        self.only_host = host.map(|h| h.trim().to_lowercase()).filter(|h| !h.is_empty());
        self
    }

    pub fn done(&self) -> bool {
        self.done
    }

    fn stop(&mut self) {
        self.done = true;
        self.line.clear();
    }

    /// Procesa texto limpio. Devuelve los bytes a enviar al equipo, si corresponde.
    pub fn feed(&mut self, text: &str, now: Instant) -> Option<Zeroizing<Vec<u8>>> {
        if self.done {
            return None;
        }
        if now.duration_since(self.started) > WINDOW {
            self.stop();
            return None;
        }
        for c in text.chars() {
            if c == '\n' {
                if aborts(&self.line) {
                    self.stop();
                    return None;
                }
                self.line.clear();
            } else {
                self.line.extend(c.to_lowercase());
            }
        }
        if self.line.len() > LINE_MAX {
            let mut cut = self.line.len() - LINE_MAX;
            while !self.line.is_char_boundary(cut) {
                cut += 1;
            }
            self.line.drain(..cut);
        }
        let line = self.line.trim_end();
        if aborts(line) {
            self.stop();
            return None;
        }
        // Confirmación de llave de host pendiente: nunca se responde.
        if line.contains(HOSTKEY) {
            return None;
        }
        if line.ends_with("password:") || line.ends_with("contraseña:") {
            if line.contains("passphrase") || NOT_LOGIN.iter().any(|w| line.contains(w)) {
                self.stop();
                return None;
            }
            if let Some(host) = self.only_host.as_deref() {
                if !names_host(line, host) {
                    return None;
                }
            }
            let mut out = Zeroizing::new(Vec::with_capacity(self.secret.len() + 2));
            out.extend_from_slice(self.secret.as_bytes());
            out.extend_from_slice(self.newline.as_bytes());
            // Una sola vez: un segundo prompt (enable, reintento, prompt falso) no se responde.
            self.stop();
            return Some(out);
        }
        if let Some(user) = self.user.as_deref() {
            if ["username:", "login:", "user name:", "usuario:"].iter().any(|p| line.ends_with(p)) {
                if self.user_sent {
                    // Volvió a pedir usuario: el login anterior falló.
                    self.stop();
                    return None;
                }
                self.user_sent = true;
                self.line.clear();
                return Some(Zeroizing::new(format!("{user}{}", self.newline).into_bytes()));
            }
        }
        None
    }
}

/// El prompt de contraseña es de OpenSSH para `host` (ya en minúsculas).
fn names_host(line: &str, host: &str) -> bool {
    let line = line.trim_start();
    line.ends_with(&format!("@{host}'s password:"))
        || (line.starts_with('(') && line.ends_with("password:") && line.contains(&format!("@{host}) ")))
}

fn aborts(line: &str) -> bool {
    ABORT.iter().any(|a| line.contains(a))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn af(user: Option<&str>) -> (AutoFill, Instant) {
        let t = Instant::now();
        (AutoFill::new(Zeroizing::new("S3cret".into()), user.map(Into::into), "\r", t), t)
    }

    fn sent(v: Option<Zeroizing<Vec<u8>>>) -> Option<String> {
        v.map(|b| String::from_utf8(b.to_vec()).unwrap())
    }

    #[test]
    fn fills_ssh_prompt_once() {
        let (mut a, t) = af(None);
        assert_eq!(sent(a.feed("Warning: banner\nnoc@10.0.0.1's pass", t)), None);
        assert_eq!(sent(a.feed("word: ", t)).as_deref(), Some("S3cret\r"));
        assert!(a.done());
        // Segundo prompt (enable, reintento o prompt falso): nada.
        assert_eq!(sent(a.feed("\nrouter>enable\nPassword: ", t)), None);
    }

    #[test]
    fn spanish_prompt_and_case() {
        let (mut a, t) = af(None);
        assert_eq!(sent(a.feed("CONTRASEÑA: ", t)).as_deref(), Some("S3cret\r"));
    }

    #[test]
    fn never_after_denied() {
        for denied in [
            "Permission denied, please try again.\n",
            "% Login invalid\n\n",
            "Access denied\n",
            "Authentication failed.\n",
        ] {
            let (mut a, t) = af(None);
            assert_eq!(sent(a.feed(denied, t)), None);
            assert_eq!(sent(a.feed("Password: ", t)), None, "{denied}");
        }
    }

    #[test]
    fn never_on_key_passphrase_or_hostkey() {
        let (mut a, t) = af(None);
        assert_eq!(sent(a.feed("Enter passphrase for key '/home/u/.ssh/id_ed25519': ", t)), None);
        let (mut a, t) = af(None);
        assert_eq!(
            sent(a.feed("Are you sure you want to continue connecting (yes/no/[fingerprint])? ", t)),
            None
        );
        assert!(!a.done());
        // Tras responder (línea completa), el prompt de contraseña sí se completa.
        assert_eq!(sent(a.feed("yes\nWarning: Permanently added.\nPassword: ", t)).as_deref(), Some("S3cret\r"));
        // Cambio de contraseña vencida: no se responde.
        let (mut a, t) = af(None);
        assert_eq!(sent(a.feed("(current) UNIX password: ", t)), None);
        assert!(a.done());
    }

    #[test]
    fn jump_host_prompt_is_not_answered() {
        let t = Instant::now();
        let mut a = AutoFill::new(Zeroizing::new("S3cret".into()), None, "\r", t).only_host(Some("10.0.0.1".into()));
        // El bastión pide su contraseña primero: no recibe la del equipo y no se cancela.
        assert_eq!(sent(a.feed("noc@bastion.example's password: ", t)), None);
        assert_eq!(sent(a.feed("\n(noc@bastion.example) Password: ", t)), None);
        assert!(!a.done());
        // Un "Password:" sin host (o de otro) tampoco.
        assert_eq!(sent(a.feed("\nPassword: ", t)), None);
        assert_eq!(sent(a.feed("\nnoc@10.0.0.10's password: ", t)), None);
        assert_eq!(sent(a.feed("\nnoc@10.0.0.1's password: ", t)).as_deref(), Some("S3cret\r"));
        // Keyboard-interactive de OpenSSH con prefijo (usuario@host).
        let mut a = AutoFill::new(Zeroizing::new("S3cret".into()), None, "\r", t).only_host(Some("Router1".into()));
        assert_eq!(sent(a.feed("(noc@router1) Password: ", t)).as_deref(), Some("S3cret\r"));
    }

    #[test]
    fn never_after_window() {
        let (mut a, t) = af(None);
        assert_eq!(sent(a.feed("Password: ", t + WINDOW + Duration::from_secs(1))), None);
        assert!(a.done());
    }

    #[test]
    fn telnet_username_then_password() {
        let (mut a, t) = af(Some("noc"));
        assert_eq!(sent(a.feed("\r\nUser Access Verification\n\nUsername: ", t)).as_deref(), Some("noc\r"));
        assert_eq!(sent(a.feed("noc\n", t)), None);
        assert_eq!(sent(a.feed("Password: ", t)).as_deref(), Some("S3cret\r"));
        // Login fallido: vuelve a pedir usuario y no se reintenta.
        let (mut a, t) = af(Some("noc"));
        a.feed("login: ", t);
        assert_eq!(sent(a.feed("noc\nlogin: ", t)), None);
        assert!(a.done());
        // Sin usuario configurado, el prompt de usuario se deja al operador.
        let (mut a, t) = af(None);
        assert_eq!(sent(a.feed("Username: ", t)), None);
        assert!(!a.done());
    }
}
