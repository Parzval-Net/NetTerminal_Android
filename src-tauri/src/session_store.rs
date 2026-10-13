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

        let sessions = fs::read_to_string(&file_path)
            .ok()
            .and_then(|c| serde_json::from_str::<Vec<Session>>(&c).ok())
            .unwrap_or_else(Self::default_sessions);

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
