//! Piezas criptográficas compartidas por la bóveda de credenciales y las notas protegidas:
//! derivación Argon2id, cifrado XChaCha20-Poly1305 con la cabecera como AAD, escritura
//! atómica con permisos 600 y espera exponencial tras contraseñas incorrectas.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::rand_core::RngCore;
use chacha20poly1305::aead::{Aead, KeyInit, OsRng, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use std::path::Path;
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

/// Parámetros de Argon2id (memoria en KiB).
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Kdf {
    pub m: u32,
    pub t: u32,
    pub p: u32,
}

/// Recomendación OWASP para Argon2id con 64 MiB (m=64 MiB, t=3, p=1).
pub const KDF_DEFAULT: Kdf = Kdf { m: 64 * 1024, t: 3, p: 1 };

impl Kdf {
    /// Límites al leer un archivo: uno manipulado no debe pedir gigas de memoria.
    pub fn sane(&self) -> bool {
        (8..=1024 * 1024).contains(&self.m) && (1..=10).contains(&self.t) && (1..=8).contains(&self.p)
    }

    pub fn encode(&self, out: &mut [u8]) {
        out[..4].copy_from_slice(&self.m.to_le_bytes());
        out[4..8].copy_from_slice(&self.t.to_le_bytes());
        out[8..12].copy_from_slice(&self.p.to_le_bytes());
    }

    pub fn decode(b: &[u8]) -> Kdf {
        let u = |i: usize| u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]);
        Kdf { m: u(0), t: u(4), p: u(8) }
    }
}

pub fn random<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    OsRng.fill_bytes(&mut b);
    b
}

pub fn derive(password: &str, salt: &[u8], kdf: Kdf) -> Result<Zeroizing<[u8; 32]>, String> {
    let params = Params::new(kdf.m, kdf.t, kdf.p, Some(32)).map_err(|e| e.to_string())?;
    let mut key = Zeroizing::new([0u8; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, key.as_mut())
        .map_err(|e| e.to_string())?;
    Ok(key)
}

/// Cifra `plain` autenticando también `aad` (la cabecera, que incluye el nonce).
pub fn encrypt(key: &[u8; 32], nonce: &[u8; 24], plain: &[u8], aad: &[u8]) -> Result<Vec<u8>, String> {
    XChaCha20Poly1305::new(key.into())
        .encrypt(XNonce::from_slice(nonce), Payload { msg: plain, aad })
        .map_err(|_| "No se pudo cifrar".to_string())
}

/// Descifra; Err(()) si la llave es incorrecta o el archivo fue alterado (no se distinguen).
pub fn decrypt(key: &[u8; 32], nonce: &[u8; 24], ct: &[u8], aad: &[u8]) -> Result<Zeroizing<Vec<u8>>, ()> {
    XChaCha20Poly1305::new(key.into())
        .decrypt(XNonce::from_slice(nonce), Payload { msg: ct, aad })
        .map(Zeroizing::new)
        .map_err(|_| ())
}

/// Escritura atómica con permisos 600 desde la creación (Unix). El temporal (`<archivo>.tmp`)
/// recibe los mismos bytes que el destino: solo se usa con contenido ya cifrado.
pub fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".tmp");
    let tmp = path.with_file_name(name);
    let _ = std::fs::remove_file(&tmp);
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let result = (|| {
        let mut f = opts.open(&tmp).map_err(|e| e.to_string())?;
        f.write_all(data).and_then(|_| f.sync_all()).map_err(|e| e.to_string())?;
        drop(f);
        std::fs::rename(&tmp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Espera exponencial tras intentos fallidos de contraseña (1, 2, 4… hasta 60 s).
#[derive(Default)]
pub struct Throttle {
    failures: u32,
    pub(crate) retry_at: Option<Instant>,
}

impl Throttle {
    pub fn check(&self) -> Result<(), String> {
        if let Some(at) = self.retry_at {
            let now = Instant::now();
            if now < at {
                return Err(format!("Demasiados intentos. Espera {} s", (at - now).as_secs() + 1));
            }
        }
        Ok(())
    }

    pub fn fail(&mut self) {
        self.failures = self.failures.saturating_add(1);
        let secs = 1u64 << (self.failures - 1).min(6);
        self.retry_at = Some(Instant::now() + Duration::from_secs(secs.min(60)));
    }

    pub fn reset(&mut self) {
        self.failures = 0;
        self.retry_at = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn throttle_grows_exponentially() {
        let mut t = Throttle::default();
        let wait = |t: &Throttle| t.retry_at.unwrap().saturating_duration_since(Instant::now()).as_secs_f64();
        assert!(t.check().is_ok());
        t.fail();
        assert!(t.check().unwrap_err().contains("Espera"));
        assert!((0.5..=1.0).contains(&wait(&t)));
        t.fail();
        t.fail();
        assert!((3.5..=4.0).contains(&wait(&t)));
        for _ in 0..20 {
            t.fail();
        }
        assert!((59.5..=60.0).contains(&wait(&t)), "tope de 60 s");
        t.reset();
        assert!(t.check().is_ok());
    }
}
