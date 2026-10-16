use crate::models::{Session, SessionType};
use chrono::Utc;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

pub struct SessionStore {
    file_path: PathBuf,
    sessions: Mutex<Vec<Session>>,
}

/// Carpeta "visible" donde vive la app, para el modo portable:
/// - Linux AppImage: se ejecuta montado en /tmp; la ruta real viene en $APPIMAGE.
/// - macOS: el binario está en NetTerminal.app/Contents/MacOS; se usa la carpeta del .app.
/// - Windows y resto: la carpeta del ejecutable.
fn portable_root(exe: &Path, appimage: Option<PathBuf>) -> Option<PathBuf> {
    if let Some(img) = appimage {
        return img.parent().map(Path::to_path_buf);
    }
    let dir = exe.parent()?;
    let bundle = dir
        .ancestors()
        .find(|a| a.extension().is_some_and(|e| e == "app"));
    match bundle {
        Some(app) if dir.ends_with("Contents/MacOS") => app.parent().map(Path::to_path_buf),
        _ => Some(dir.to_path_buf()),
    }
}

/// Directorio de datos. En modo portable (existe `portable` o `data/` junto a la app)
/// todo vive en `data/` al lado de los ejecutables, compartido entre Windows, macOS y
/// Linux; si no, en el directorio de configuración del sistema operativo.
/// Restringe permisos al usuario actual (Unix): la carpeta de datos contiene el token
/// MCP, logs con salida de equipos y notas.
pub fn restrict(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = if path.is_dir() { 0o700 } else { 0o600 };
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// true si la app corre en modo portable (marcador `portable` o carpeta `data/` al lado).
pub fn is_portable() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|exe| portable_root(&exe, std::env::var_os("APPIMAGE").map(PathBuf::from)))
        .is_some_and(|root| root.join("portable").exists() || root.join("data").is_dir())
}

pub fn resolve_data_dir(os_config_dir: PathBuf) -> PathBuf {
    let root = std::env::current_exe()
        .ok()
        .and_then(|exe| portable_root(&exe, std::env::var_os("APPIMAGE").map(PathBuf::from)));
    if let Some(root) = root {
        if root.join("portable").exists() || root.join("data").is_dir() {
            return root.join("data");
        }
    }
    os_config_dir
}

impl SessionStore {
    pub fn new(data_dir: &Path) -> Self {
        let _ = fs::create_dir_all(data_dir);
        restrict(data_dir);
        let file_path = data_dir.join("sessions.json");

        // Migración desde la ubicación de la versión anterior (~/.netterminal)
        if !file_path.exists() {
            if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
                let legacy = PathBuf::from(home).join(".netterminal").join("sessions.json");
                if legacy.exists() {
                    let _ = fs::copy(&legacy, &file_path);
                }
            }
        }

        let sessions = match fs::read_to_string(&file_path) {
            Err(_) => Self::default_sessions(),
            Ok(content) => {
                // Se descartan solo las entradas inválidas (puerto fuera de rango, tipo
                // desconocido tras volver a una versión anterior, edición manual), nunca todo.
                let parsed = serde_json::from_str::<Vec<serde_json::Value>>(&content);
                let valid: Vec<Session> = parsed
                    .as_ref()
                    .map(|items| items.iter().filter_map(|v| serde_json::from_value(v.clone()).ok()).collect())
                    .unwrap_or_default();
                let lost = parsed.as_ref().map(|items| items.len() != valid.len()).unwrap_or(true);
                if lost {
                    // Respaldo del archivo original antes de reescribirlo.
                    backup_corrupt(&file_path);
                }
                if parsed.is_err() {
                    Self::default_sessions()
                } else {
                    valid
                }
            }
        };

        let store = Self {
            file_path,
            sessions: Mutex::new(sessions),
        };
        let _ = store.persist(&store.sessions.lock().unwrap());
        store
    }

    fn default_sessions() -> Vec<Session> {
        vec![Session {
            id: Uuid::new_v4().to_string(),
            name: "Terminal local".to_string(),
            session_type: SessionType::Local,
            folder: Some("Local".to_string()),
            host: None,
            port: None,
            username: None,
            identity_file: None,
            legacy_ssh: None,
            jump_host: None,
            ssh_args: None,
            serial_port: None,
            baud_rate: None,
            data_bits: None,
            stop_bits: None,
            parity: None,
            flow_control: None,
            highlight: None,
            on_connect: None,
            newline: None,
            local_echo: None,
            encoding: None,
            auto_reconnect: None,
            platform: None,
            scp: None,
            created_at: Utc::now().to_rfc3339(),
        }]
    }

    pub fn list(&self) -> Vec<Session> {
        self.sessions.lock().unwrap().clone()
    }

    pub fn save(&self, mut session: Session) -> Result<Session, String> {
        let mut list = self.sessions.lock().unwrap();
        if session.id.is_empty() {
            session.id = Uuid::new_v4().to_string();
            session.created_at = Utc::now().to_rfc3339();
            list.push(session.clone());
        } else if let Some(idx) = list.iter().position(|s| s.id == session.id) {
            list[idx] = session.clone();
        } else {
            list.push(session.clone());
        }
        self.persist(&list)?;
        Ok(session)
    }

    /// Actualiza varias sesiones existentes en una sola escritura (mover/renombrar carpetas).
    pub fn update_many(&self, changed: Vec<Session>) -> Result<Vec<Session>, String> {
        let mut list = self.sessions.lock().unwrap();
        for s in changed {
            if let Some(idx) = list.iter().position(|x| x.id == s.id) {
                list[idx] = s;
            }
        }
        self.persist(&list)?;
        Ok(list.clone())
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let mut list = self.sessions.lock().unwrap();
        list.retain(|s| s.id != id);
        self.persist(&list)
    }

    /// Escritura atómica: archivo temporal + rename, para no corromper el JSON.
    fn persist(&self, list: &[Session]) -> Result<(), String> {
        let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
        let tmp = self.file_path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        restrict(&tmp);
        fs::rename(&tmp, &self.file_path).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::portable_root;
    use std::path::{Path, PathBuf};

    #[test]
    fn keeps_valid_sessions_and_backs_up_corrupt_file() {
        let dir = std::env::temp_dir().join(format!("nt-store-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("sessions.json");
        std::fs::write(
            &file,
            r#"[{"id":"a","name":"core","type":"ssh","host":"192.0.2.1","created_at":""},
                {"id":"b","name":"malo","type":"ssh","port":99999,"created_at":""}]"#,
        )
        .unwrap();
        let store = super::SessionStore::new(&dir);
        let names: Vec<String> = store.list().into_iter().map(|s| s.name).collect();
        assert_eq!(names, vec!["core"]);
        let backups = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with("sessions.corrupt-"))
            .count();
        assert_eq!(backups, 1);
        // JSON ilegible: también queda respaldo y no se pierde el archivo original.
        std::fs::write(&file, "{no es json").unwrap();
        let _ = super::SessionStore::new(&dir);
        let backups = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with("sessions.corrupt-"))
            .count();
        assert!(backups >= 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn portable_root_per_platform() {
        let usb = PathBuf::from("/Volumes/USB/NetTerminal");
        assert_eq!(
            portable_root(&usb.join("NetTerminal.app/Contents/MacOS/net-terminal"), None),
            Some(usb.clone())
        );
        assert_eq!(
            portable_root(Path::new("/tmp/.mount_Net123/usr/bin/net-terminal"), Some(usb.join("NetTerminal.AppImage"))),
            Some(usb.clone())
        );
        assert_eq!(portable_root(&usb.join("NetTerminal.exe"), None), Some(usb));
    }
}

/// Copia un archivo de datos que no se pudo leer completo a `<nombre>.corrupt-<unix>.json`.
pub fn backup_corrupt(path: &Path) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("datos");
    let dest = path.with_file_name(format!("{stem}.corrupt-{ts}.json"));
    if fs::copy(path, &dest).is_ok() {
        restrict(&dest);
    }
}
