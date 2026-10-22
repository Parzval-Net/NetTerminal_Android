//! Contraseñas guardadas por sesión, en una bóveda cifrada dentro de la carpeta de datos
//! (`credentials.vault`, XChaCha20-Poly1305). La llave de 256 bits vive:
//! - Instalada: en el llavero del sistema (una sola entrada "NetTerminal" / "vault-key").
//!   El archivo copiado a otro equipo no sirve sin ese llavero.
//! - Portable, o sin llavero disponible: derivada de una contraseña maestra con Argon2id.
//!
//! Ninguna función devuelve una contraseña al frontend: solo `get` (uso interno del
//! autocompletado al conectar). La llave queda en memoria en un búfer que se borra al
//! bloquear y al salir.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::rand_core::RngCore;
use chacha20poly1305::aead::{Aead, KeyInit, OsRng, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use zeroize::{Zeroize, Zeroizing};

const MAGIC: &[u8; 7] = b"NTVAULT";
const VERSION: u8 = 1;
const HEADER_LEN: usize = 7 + 1 + 1 + 12 + 16 + 24;
const MAX_FILE: u64 = 4 * 1024 * 1024;

pub const MAX_PASSWORD: usize = 1024;
const MIN_MASTER: usize = 8;
const MAX_ID: usize = 128;

/// Prefijo de entradas que no son de sesiones (secretos SNMP por perfil). La limpieza de
/// entradas huérfanas al guardar la contraseña de una sesión no las toca.
pub const NS_SNMP: &str = "snmp:";

pub const LOCKED: &str = "La bóveda está bloqueada. Desbloquéala en Ajustes › Credenciales";

#[derive(Clone, Copy, PartialEq, Debug)]
enum Mode {
    /// Llave aleatoria guardada en el llavero del sistema.
    Keyring = 0,
    /// Llave derivada de la contraseña maestra (Argon2id).
    Master = 1,
}

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
    fn sane(&self) -> bool {
        (8..=1024 * 1024).contains(&self.m) && (1..=10).contains(&self.t) && (1..=8).contains(&self.p)
    }
}

#[derive(Clone, Debug)]
struct Header {
    mode: Mode,
    kdf: Kdf,
    salt: [u8; 16],
    nonce: [u8; 24],
}

impl Header {
    fn encode(&self) -> [u8; HEADER_LEN] {
        let mut h = [0u8; HEADER_LEN];
        h[..7].copy_from_slice(MAGIC);
        h[7] = VERSION;
        h[8] = self.mode as u8;
        h[9..13].copy_from_slice(&self.kdf.m.to_le_bytes());
        h[13..17].copy_from_slice(&self.kdf.t.to_le_bytes());
        h[17..21].copy_from_slice(&self.kdf.p.to_le_bytes());
        h[21..37].copy_from_slice(&self.salt);
        h[37..61].copy_from_slice(&self.nonce);
        h
    }

    fn decode(b: &[u8]) -> Result<Header, String> {
        let bad = || "El archivo de credenciales no es válido".to_string();
        if b.len() < HEADER_LEN + 16 || &b[..7] != MAGIC {
            return Err(bad());
        }
        if b[7] != VERSION {
            return Err("La bóveda es de una versión más nueva de NetTerminal".into());
        }
        let mode = match b[8] {
            0 => Mode::Keyring,
            1 => Mode::Master,
            _ => return Err(bad()),
        };
        let u = |i: usize| u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]);
        let kdf = Kdf { m: u(9), t: u(13), p: u(17) };
        if mode == Mode::Master && !kdf.sane() {
            return Err(bad());
        }
        let mut salt = [0u8; 16];
        salt.copy_from_slice(&b[21..37]);
        let mut nonce = [0u8; 24];
        nonce.copy_from_slice(&b[37..61]);
        Ok(Header { mode, kdf, salt, nonce })
    }
}

/// Dónde se guarda la llave de la bóveda en modo instalado. Detrás de un trait para
/// probar sin llavero (CI sin sesión gráfica).
pub trait KeyStore: Send + Sync {
    /// Ok(None): no hay llave guardada. Err: llavero no disponible.
    fn get(&self) -> Result<Option<Zeroizing<Vec<u8>>>, String>;
    fn set(&self, key: &[u8]) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

/// Llavero del sistema: Keychain (macOS), Administrador de credenciales (Windows) o
/// Secret Service (Linux). Sin Secret Service no hay respaldo en archivo: se usa la
/// contraseña maestra.
pub struct OsKeyStore;

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
impl OsKeyStore {
    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new("NetTerminal", "vault-key").map_err(|e| e.to_string())
    }
}

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
impl KeyStore for OsKeyStore {
    fn get(&self) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        match Self::entry()?.get_secret() {
            Ok(k) => Ok(Some(Zeroizing::new(k))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    fn set(&self, key: &[u8]) -> Result<(), String> {
        Self::entry()?.set_secret(key).map_err(|e| e.to_string())
    }
    fn delete(&self) -> Result<(), String> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
impl KeyStore for OsKeyStore {
    fn get(&self) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        Err("Llavero no disponible".into())
    }
    fn set(&self, _: &[u8]) -> Result<(), String> {
        Err("Llavero no disponible".into())
    }
    fn delete(&self) -> Result<(), String> {
        Ok(())
    }
}

/// Mapa id de sesión -> contraseña, borrado de memoria al soltarse.
#[derive(Default)]
struct Entries(HashMap<String, String>);

impl Drop for Entries {
    fn drop(&mut self) {
        for v in self.0.values_mut() {
            v.zeroize();
        }
    }
}

#[derive(Serialize)]
pub struct Status {
    /// "keychain" (llave en el llavero del sistema) o "vault" (contraseña maestra).
    pub backend: &'static str,
    pub exists: bool,
    pub unlocked: bool,
    pub portable: bool,
}

#[derive(Default)]
struct Inner {
    key: Option<Zeroizing<[u8; 32]>>,
    failures: u32,
    retry_at: Option<Instant>,
}

pub struct Credentials {
    path: PathBuf,
    portable: bool,
    keys: Box<dyn KeyStore>,
    kdf: Kdf,
    /// Disponibilidad del llavero, consultada una sola vez y solo si se usa la función.
    keyring_ok: OnceLock<bool>,
    inner: Mutex<Inner>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn random<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    OsRng.fill_bytes(&mut b);
    b
}

fn derive(master: &str, salt: &[u8], kdf: Kdf) -> Result<Zeroizing<[u8; 32]>, String> {
    let params = Params::new(kdf.m, kdf.t, kdf.p, Some(32)).map_err(|e| e.to_string())?;
    let mut key = Zeroizing::new([0u8; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(master.as_bytes(), salt, key.as_mut())
        .map_err(|e| e.to_string())?;
    Ok(key)
}

fn check_master(master: &str) -> Result<(), String> {
    let n = master.chars().count();
    if n < MIN_MASTER {
        return Err(format!("La contraseña maestra debe tener al menos {MIN_MASTER} caracteres"));
    }
    if master.len() > MAX_PASSWORD {
        return Err("La contraseña maestra es demasiado larga".into());
    }
    Ok(())
}

fn check_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > MAX_ID || id.chars().any(|c| c.is_control()) {
        return Err("Sesión inválida".into());
    }
    Ok(())
}

/// Escritura atómica con permisos 600 desde la creación (Unix).
fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let tmp = path.with_extension("vault.tmp");
    let _ = std::fs::remove_file(&tmp);
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(&tmp).map_err(|e| e.to_string())?;
    f.write_all(data).and_then(|_| f.sync_all()).map_err(|e| e.to_string())?;
    drop(f);
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

impl Credentials {
    pub fn new(data_dir: &Path, portable: bool) -> Self {
        Self::with(data_dir, portable, Box::new(OsKeyStore), KDF_DEFAULT)
    }

    pub fn with(data_dir: &Path, portable: bool, keys: Box<dyn KeyStore>, kdf: Kdf) -> Self {
        Credentials {
            path: data_dir.join("credentials.vault"),
            portable,
            keys,
            kdf,
            keyring_ok: OnceLock::new(),
            inner: Mutex::default(),
        }
    }

    fn keyring_available(&self) -> bool {
        !self.portable && *self.keyring_ok.get_or_init(|| self.keys.get().is_ok())
    }

    fn read(&self) -> Result<Option<(Header, Vec<u8>)>, String> {
        let meta = match std::fs::metadata(&self.path) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.to_string()),
        };
        if meta.len() > MAX_FILE {
            return Err("El archivo de credenciales no es válido".into());
        }
        let bytes = std::fs::read(&self.path).map_err(|e| e.to_string())?;
        Ok(Some((Header::decode(&bytes)?, bytes)))
    }

    /// Modo vigente: el del archivo si existe; si no, llavero cuando hay uno disponible.
    fn mode(&self) -> Mode {
        match self.read() {
            Ok(Some((h, _))) => h.mode,
            _ if self.keyring_available() => Mode::Keyring,
            _ => Mode::Master,
        }
    }

    fn decrypt(key: &[u8; 32], bytes: &[u8]) -> Result<Entries, String> {
        let header = Header::decode(bytes)?;
        let plain = XChaCha20Poly1305::new(key.into())
            .decrypt(XNonce::from_slice(&header.nonce), Payload { msg: &bytes[HEADER_LEN..], aad: &bytes[..HEADER_LEN] })
            .map(Zeroizing::new)
            .map_err(|_| "Contraseña maestra incorrecta o archivo de credenciales alterado".to_string())?;
        serde_json::from_slice::<HashMap<String, String>>(&plain)
            .map(Entries)
            .map_err(|_| "El archivo de credenciales no es válido".into())
    }

    fn encrypt_write(&self, key: &[u8; 32], mode: Mode, kdf: Kdf, salt: [u8; 16], entries: &Entries) -> Result<(), String> {
        let header = Header { mode, kdf, salt, nonce: random() }.encode();
        let plain = Zeroizing::new(serde_json::to_vec(&entries.0).map_err(|e| e.to_string())?);
        let ct = XChaCha20Poly1305::new(key.into())
            .encrypt(XNonce::from_slice(&header[37..61]), Payload { msg: &plain, aad: &header })
            .map_err(|_| "No se pudo cifrar la bóveda".to_string())?;
        let mut out = Vec::with_capacity(HEADER_LEN + ct.len());
        out.extend_from_slice(&header);
        out.extend_from_slice(&ct);
        write_atomic(&self.path, &out)
    }

    /// Espera exponencial tras intentos fallidos de contraseña maestra (1, 2, 4… hasta 60 s).
    fn throttle(inner: &Inner) -> Result<(), String> {
        if let Some(at) = inner.retry_at {
            let now = Instant::now();
            if now < at {
                return Err(format!("Demasiados intentos. Espera {} s", (at - now).as_secs() + 1));
            }
        }
        Ok(())
    }

    fn fail(inner: &mut Inner) {
        inner.failures = inner.failures.saturating_add(1);
        let secs = 1u64 << (inner.failures - 1).min(6);
        inner.retry_at = Some(Instant::now() + Duration::from_secs(secs.min(60)));
    }

    /// Asegura la llave en memoria. En modo llavero la lee (o la crea con la bóveda si
    /// `create`); en modo maestra exige haber desbloqueado antes.
    fn ensure_key(&self, inner: &mut Inner, create: bool) -> Result<Option<(Header, Vec<u8>)>, String> {
        let file = self.read()?;
        if inner.key.is_some() {
            return Ok(file);
        }
        match &file {
            Some((h, _)) if h.mode == Mode::Master => Err(LOCKED.into()),
            Some(_) => {
                let raw = self.keys.get()?.ok_or(
                    "La llave de la bóveda no está en el llavero de este equipo. Restablece la bóveda en Ajustes › Credenciales",
                )?;
                if raw.len() != 32 {
                    return Err("La llave de la bóveda en el llavero no es válida".into());
                }
                let mut key = Zeroizing::new([0u8; 32]);
                key.copy_from_slice(&raw);
                inner.key = Some(key);
                Ok(file)
            }
            None if !create => Ok(None),
            None if self.keyring_available() => {
                let key = Zeroizing::new(random::<32>());
                self.keys.set(key.as_ref())?;
                self.encrypt_write(&key, Mode::Keyring, Kdf { m: 0, t: 0, p: 0 }, random(), &Entries::default())?;
                inner.key = Some(key);
                self.read()
            }
            None => Err("Primero crea la bóveda con una contraseña maestra en Ajustes › Credenciales".into()),
        }
    }

    pub fn status(&self) -> Status {
        let exists = self.path.exists();
        Status {
            backend: if self.mode() == Mode::Keyring { "keychain" } else { "vault" },
            exists,
            unlocked: exists && lock(&self.inner).key.is_some(),
            portable: self.portable,
        }
    }

    pub fn create(&self, master: &str) -> Result<(), String> {
        check_master(master)?;
        if self.path.exists() {
            return Err("La bóveda ya existe".into());
        }
        if self.mode() != Mode::Master {
            return Err("Esta instalación guarda la llave en el llavero del sistema".into());
        }
        let salt = random::<16>();
        let key = derive(master, &salt, self.kdf)?;
        self.encrypt_write(&key, Mode::Master, self.kdf, salt, &Entries::default())?;
        lock(&self.inner).key = Some(key);
        Ok(())
    }

    pub fn unlock(&self, master: &str) -> Result<(), String> {
        if master.len() > MAX_PASSWORD {
            return Err("Contraseña demasiado larga".into());
        }
        let mut inner = lock(&self.inner);
        Self::throttle(&inner)?;
        let (h, bytes) = self.read()?.ok_or("No hay bóveda creada")?;
        if h.mode != Mode::Master {
            return self.ensure_key(&mut inner, false).map(|_| ());
        }
        let key = derive(master, &h.salt, h.kdf)?;
        match Self::decrypt(&key, &bytes) {
            Ok(_) => {
                inner.key = Some(key);
                inner.failures = 0;
                inner.retry_at = None;
                Ok(())
            }
            Err(e) => {
                Self::fail(&mut inner);
                Err(e)
            }
        }
    }

    pub fn lock(&self) {
        lock(&self.inner).key = None;
    }

    pub fn change(&self, old: &str, new: &str) -> Result<(), String> {
        check_master(new)?;
        let mut inner = lock(&self.inner);
        Self::throttle(&inner)?;
        let (h, bytes) = self.read()?.ok_or("No hay bóveda creada")?;
        if h.mode != Mode::Master {
            return Err("Esta bóveda usa el llavero del sistema: no tiene contraseña maestra".into());
        }
        let old_key = derive(old, &h.salt, h.kdf)?;
        let entries = match Self::decrypt(&old_key, &bytes) {
            Ok(e) => e,
            Err(e) => {
                Self::fail(&mut inner);
                return Err(e);
            }
        };
        let salt = random::<16>();
        let key = derive(new, &salt, self.kdf)?;
        self.encrypt_write(&key, Mode::Master, self.kdf, salt, &entries)?;
        inner.key = Some(key);
        inner.failures = 0;
        inner.retry_at = None;
        Ok(())
    }

    /// Borra la bóveda completa (y la llave del llavero). Para contraseña maestra olvidada
    /// o llavero perdido: las contraseñas guardadas se pierden.
    pub fn reset(&self) -> Result<(), String> {
        let mut inner = lock(&self.inner);
        inner.key = None;
        match std::fs::remove_file(&self.path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
        if !self.portable {
            let _ = self.keys.delete();
        }
        Ok(())
    }

    /// Modifica las entradas con la llave en memoria y reescribe el archivo.
    fn update(&self, create: bool, f: impl FnOnce(&mut Entries)) -> Result<(), String> {
        let mut inner = lock(&self.inner);
        let Some((h, bytes)) = self.ensure_key(&mut inner, create)? else {
            return Ok(());
        };
        let key = inner.key.as_ref().ok_or(LOCKED)?;
        let mut entries = Self::decrypt(key, &bytes)?;
        f(&mut entries);
        self.encrypt_write(key, h.mode, h.kdf, h.salt, &entries)
    }

    /// Guarda la contraseña de una sesión. `valid` (ids de sesiones existentes) permite
    /// limpiar entradas huérfanas de sesiones borradas con la bóveda bloqueada.
    pub fn set(&self, id: &str, password: &str, valid: &[String]) -> Result<(), String> {
        check_id(id)?;
        if password.is_empty() || password.len() > MAX_PASSWORD {
            return Err(format!("La contraseña debe tener entre 1 y {MAX_PASSWORD} bytes"));
        }
        if password.chars().any(|c| matches!(c, '\r' | '\n' | '\0')) {
            return Err("La contraseña no puede contener saltos de línea".into());
        }
        self.update(true, |e| {
            if let Some(mut old) = e.0.insert(id.to_string(), password.to_string()) {
                old.zeroize();
            }
            let stale: Vec<String> =
                e.0.keys().filter(|k| *k != id && !k.starts_with(NS_SNMP) && !valid.contains(k)).cloned().collect();
            for k in stale {
                if let Some(mut v) = e.0.remove(&k) {
                    v.zeroize();
                }
            }
        })
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        check_id(id)?;
        self.update(false, |e| {
            if let Some(mut v) = e.0.remove(id) {
                v.zeroize();
            }
        })
    }

    pub fn has(&self, id: &str) -> Result<bool, String> {
        check_id(id)?;
        let mut inner = lock(&self.inner);
        let Some((_, bytes)) = self.ensure_key(&mut inner, false)? else {
            return Ok(false);
        };
        let key = inner.key.as_ref().ok_or(LOCKED)?;
        Ok(Self::decrypt(key, &bytes)?.0.contains_key(id))
    }

    /// Solo para el autocompletado del backend. None si no hay, o si está bloqueada.
    pub(crate) fn get(&self, id: &str) -> Option<Zeroizing<String>> {
        check_id(id).ok()?;
        let mut inner = lock(&self.inner);
        let (_, bytes) = self.ensure_key(&mut inner, false).ok()??;
        let mut entries = Self::decrypt(inner.key.as_ref()?, &bytes).ok()?;
        entries.0.remove(id).map(Zeroizing::new)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Llavero en memoria para pruebas.
    #[derive(Default, Clone)]
    struct MemKeys(std::sync::Arc<Mutex<Option<Vec<u8>>>>, bool);

    impl KeyStore for MemKeys {
        fn get(&self) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
            if self.1 {
                return Err("sin llavero".into());
            }
            Ok(lock(&self.0).clone().map(Zeroizing::new))
        }
        fn set(&self, key: &[u8]) -> Result<(), String> {
            *lock(&self.0) = Some(key.to_vec());
            Ok(())
        }
        fn delete(&self) -> Result<(), String> {
            *lock(&self.0) = None;
            Ok(())
        }
    }

    const FAST: Kdf = Kdf { m: 64, t: 1, p: 1 };

    fn dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("nt-cred-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn master_vault_roundtrip_and_wrong_master() {
        let d = dir();
        let c = Credentials::with(&d, true, Box::new(MemKeys::default()), FAST);
        assert_eq!(c.status().backend, "vault");
        assert!(c.set("s1", "x", &[]).is_err(), "sin bóveda no se guarda");
        assert!(c.create("corta").is_err());
        c.create("maestra-larga").unwrap();
        c.set("s1", "Cl4ve$ecreta", &["s1".into()]).unwrap();
        assert!(c.has("s1").unwrap());
        assert_eq!(c.get("s1").as_deref().map(|s| s.as_str()), Some("Cl4ve$ecreta"));
        // El archivo no contiene la contraseña en claro.
        let raw = std::fs::read(d.join("credentials.vault")).unwrap();
        assert!(!raw.windows(12).any(|w| w == b"Cl4ve$ecreta"));

        c.lock();
        assert!(c.get("s1").is_none());
        assert_eq!(c.has("s1").unwrap_err(), LOCKED);
        assert!(c.unlock("otra-maestra").is_err());
        // Tras un fallo hay espera antes del siguiente intento.
        assert!(c.unlock("maestra-larga").unwrap_err().contains("Espera"));
        lock(&c.inner).retry_at = None;
        c.unlock("maestra-larga").unwrap();
        assert!(c.has("s1").unwrap());

        c.change("maestra-larga", "nueva-maestra").unwrap();
        c.lock();
        lock(&c.inner).retry_at = None;
        assert!(c.unlock("maestra-larga").is_err());
        lock(&c.inner).retry_at = None;
        c.unlock("nueva-maestra").unwrap();
        assert_eq!(c.get("s1").as_deref().map(|s| s.as_str()), Some("Cl4ve$ecreta"));

        // Entradas huérfanas se limpian al guardar otra; las de SNMP no son de sesiones.
        c.set("snmp:core", "{\"community\":\"x\"}", &[]).unwrap();
        c.set("s2", "otra", &["s2".into()]).unwrap();
        assert!(!c.has("s1").unwrap());
        assert!(c.has("snmp:core").unwrap());
        c.delete("s2").unwrap();
        assert!(!c.has("s2").unwrap());
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn tampered_vault_is_rejected() {
        let d = dir();
        let c = Credentials::with(&d, true, Box::new(MemKeys::default()), FAST);
        c.create("maestra-larga").unwrap();
        c.set("s1", "secreto", &[]).unwrap();
        let path = d.join("credentials.vault");
        let good = std::fs::read(&path).unwrap();
        // Un byte del texto cifrado y uno de la cabecera (sal): ambos fallan por AEAD/derivación.
        for i in [good.len() - 1, HEADER_LEN + 2, 25] {
            let mut bad = good.clone();
            bad[i] ^= 0x01;
            std::fs::write(&path, &bad).unwrap();
            c.lock();
            lock(&c.inner).retry_at = None;
            assert!(c.unlock("maestra-larga").is_err(), "byte {i}");
        }
        // Parámetros absurdos en la cabecera: se rechazan sin intentar derivar.
        let mut bad = good.clone();
        bad[9..13].copy_from_slice(&u32::MAX.to_le_bytes());
        std::fs::write(&path, &bad).unwrap();
        lock(&c.inner).retry_at = None;
        assert!(c.unlock("maestra-larga").unwrap_err().contains("no es válido"));
        std::fs::write(&path, &good).unwrap();
        lock(&c.inner).retry_at = None;
        c.unlock("maestra-larga").unwrap();
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn vault_file_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let d = dir();
        let c = Credentials::with(&d, true, Box::new(MemKeys::default()), FAST);
        c.create("maestra-larga").unwrap();
        c.set("s1", "secreto", &[]).unwrap();
        let mode = std::fs::metadata(d.join("credentials.vault")).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn keyring_mode_needs_no_master_and_file_alone_is_useless() {
        let d = dir();
        let keys = MemKeys::default();
        let c = Credentials::with(&d, false, Box::new(keys.clone()), FAST);
        assert_eq!(c.status().backend, "keychain");
        assert!(c.create("maestra-larga").is_err());
        c.set("s1", "secreto", &[]).unwrap();
        assert_eq!(lock(&keys.0).as_ref().map(Vec::len), Some(32));
        // Tras bloquear (o reiniciar la app) se recupera sola desde el llavero.
        c.lock();
        assert!(c.has("s1").unwrap());
        let c2 = Credentials::with(&d, false, Box::new(keys.clone()), FAST);
        assert_eq!(c2.get("s1").as_deref().map(|s| s.as_str()), Some("secreto"));
        // Sin la llave del llavero (archivo copiado a otro equipo) no se lee.
        let other = Credentials::with(&d, false, Box::new(MemKeys::default()), FAST);
        assert!(other.get("s1").is_none());
        assert!(other.has("s1").is_err());
        c.reset().unwrap();
        assert!(lock(&keys.0).is_none());
        assert!(!d.join("credentials.vault").exists());
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn without_keyring_falls_back_to_master() {
        let d = dir();
        let c = Credentials::with(&d, false, Box::new(MemKeys(Default::default(), true)), FAST);
        assert_eq!(c.status().backend, "vault");
        assert!(c.set("s1", "x", &[]).is_err());
        c.create("maestra-larga").unwrap();
        c.set("s1", "x", &[]).unwrap();
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn rejects_bad_inputs() {
        let d = dir();
        let c = Credentials::with(&d, false, Box::new(MemKeys::default()), FAST);
        assert!(c.set("s1", "", &[]).is_err());
        assert!(c.set("s1", &"x".repeat(MAX_PASSWORD + 1), &[]).is_err());
        assert!(c.set("s1", "a\rb", &[]).is_err());
        assert!(c.set(&"i".repeat(200), "x", &[]).is_err());
        assert!(c.set("", "x", &[]).is_err());
        std::fs::remove_dir_all(&d).unwrap();
    }
}
