//! Espera de salida al estilo "expect": hasta un patrón o hasta que el equipo deja de
//! enviar datos. Lo usan los scripts y las herramientas MCP.

use regex::Regex;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

/// Acumula salida hasta que `re` coincide. Error con lo recibido si vence el plazo.
pub fn wait_for(rx: &Receiver<String>, re: &Regex, timeout: Duration, buf: &mut String) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    loop {
        if re.is_match(buf) {
            return Ok(std::mem::take(buf));
        }
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err(std::mem::take(buf));
        }
        match rx.recv_timeout(left) {
            Ok(chunk) => buf.push_str(&chunk),
            Err(RecvTimeoutError::Timeout) => return Err(std::mem::take(buf)),
            Err(RecvTimeoutError::Disconnected) => return Err(std::mem::take(buf)),
        }
    }
}

/// Acumula salida hasta que pasan `idle` sin datos nuevos o se cumple `timeout`.
pub fn collect(rx: &Receiver<String>, idle: Duration, timeout: Duration) -> String {
    let deadline = Instant::now() + timeout;
    let mut out = String::new();
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return out;
        }
        match rx.recv_timeout(idle.min(left)) {
            Ok(chunk) => out.push_str(&chunk),
            Err(_) => return out,
        }
    }
}

/// Descarta lo pendiente en el canal.
pub fn drain(rx: &Receiver<String>) {
    while rx.try_recv().is_ok() {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;
    use std::thread;

    #[test]
    fn waits_for_prompt_across_chunks() {
        let (tx, rx) = channel();
        thread::spawn(move || {
            for part in ["show ver\nCisco IOS", " XE\nRouter", "#"] {
                thread::sleep(Duration::from_millis(20));
                tx.send(part.to_string()).unwrap();
            }
        });
        let re = Regex::new(r"[#>]\s*$").unwrap();
        let mut buf = String::new();
        let out = wait_for(&rx, &re, Duration::from_secs(2), &mut buf).unwrap();
        assert!(out.ends_with("Router#"));
    }

    #[test]
    fn times_out_with_partial_output() {
        let (tx, rx) = channel();
        tx.send("parcial".to_string()).unwrap();
        let re = Regex::new("nunca").unwrap();
        let mut buf = String::new();
        let err = wait_for(&rx, &re, Duration::from_millis(80), &mut buf).unwrap_err();
        assert_eq!(err, "parcial");
        drop(tx);
    }

    #[test]
    fn collect_stops_when_idle() {
        let (tx, rx) = channel();
        tx.send("a".into()).unwrap();
        tx.send("b".into()).unwrap();
        let start = Instant::now();
        assert_eq!(collect(&rx, Duration::from_millis(50), Duration::from_secs(5)), "ab");
        assert!(start.elapsed() < Duration::from_secs(1));
        drop(tx);
    }
}
