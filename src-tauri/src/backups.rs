//! Respaldos de configuración en `<datos>/backups/<equipo>/<AAAA-MM-DD_HHMMSS>.txt`.
//! Nombres saneados (nunca salen de la carpeta), carpetas 700 y archivos 600.

use regex::Regex;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Tope por respaldo: una configuración real rara vez supera unos pocos MB.
const MAX_BYTES: usize = 20 * 1024 * 1024;

#[derive(Serialize)]
pub struct BackupFile {
    pub name: String,
    pub size: u64,
    pub modified: u64,
}

#[derive(Serialize)]
pub struct DeviceBackups {
    pub device: String,
    pub files: Vec<BackupFile>,
}

pub fn root(data_dir: &Path) -> PathBuf {
    data_dir.join("backups")
}

/// Nombre de carpeta seguro para el equipo: letras, números, `-`, `_` y `.`; el resto se
/// reemplaza por `_`. Sin rutas, sin `..` y con largo acotado.
pub fn sanitize_device(name: &str) -> Result<String, String> {
    let mapped: String = name
        .trim()
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '_' })
        .take(64)
        .collect();
    let clean = mapped.trim_matches(|c| c == '.' || c == '_').to_string();
    if clean.is_empty() {
        return Err("Nombre de equipo inválido".into());
    }
    Ok(clean)
}

fn file_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\d{4}-\d{2}-\d{2}_\d{6}(-\d{1,3})?\.txt$").unwrap())
}

/// Ruta de un respaldo existente; solo acepta nombres con el formato de la app.
fn file_path(data_dir: &Path, device: &str, file: &str) -> Result<PathBuf, String> {
    let dev = sanitize_device(device)?;
    if dev != device || !file_re().is_match(file) {
        return Err("Respaldo inválido".into());
    }
    Ok(root(data_dir).join(dev).join(file))
}

/// Palabras tras las que viene un secreto (contraseñas, llaves, comunidades SNMP).
const SECRET_WORDS: &[&str] = &[
    "password",
    "passwd",
    "secret",
    "community",
    "key-string",
    "psksecret",
    "pre-shared-key",
    "authentication-key",
    "message-digest-key",
    "encrypted-password",
    "auth-password",
    "priv-password",
    "passphrase",
    "shared-secret",
    "ascii-text",
    "hexadecimal",
    "cipher",
    "irreversible-cipher",
];

/// Indicadores de tipo/cifrado entre la palabra clave y el valor.
fn is_type_token(tok: &str) -> bool {
    let t = tok.to_ascii_lowercase();
    (t.len() <= 3 && t.chars().all(|c| c.is_ascii_digit()))
        || matches!(
            t.as_str(),
            "enc" | "cipher" | "irreversible-cipher" | "simple" | "plain" | "encrypted" | "ascii-text" | "hexadecimal" | "md5" | "sha" | "sha1" | "sha256" | "hidden"
        )
}

fn forti_set_secret(tok: &str) -> bool {
    let t = tok.to_ascii_lowercase();
    ["password", "passwd", "pwd", "secret", "key", "passphrase"].iter().any(|s| t.ends_with(s))
}

/// Reemplaza por `****` los valores secretos de una línea, conservando la estructura
/// (palabra clave, tipo y lo que sigue al valor) para que las comparaciones sigan sirviendo.
pub fn mask_line(line: &str) -> String {
    // Fragmentos alternados de espacio y texto, para reconstruir la línea tal cual.
    let mut parts: Vec<(bool, String)> = Vec::new();
    for c in line.chars() {
        let ws = c.is_whitespace();
        match parts.last_mut() {
            Some((w, s)) if *w == ws => s.push(c),
            _ => parts.push((ws, c.to_string())),
        }
    }
    let words: Vec<usize> = parts.iter().enumerate().filter(|(_, (w, _))| !w).map(|(i, _)| i).collect();
    if words.is_empty() {
        return line.to_string();
    }
    let first = parts[words[0]].1.to_ascii_lowercase();
    let mut k = 0;
    while k < words.len() {
        let tok = parts[words[k]].1.to_ascii_lowercase();
        let tok = tok.trim_end_matches(';');
        let prev = if k > 0 { parts[words[k - 1]].1.to_ascii_lowercase() } else { String::new() };
        let trigger = SECRET_WORDS.contains(&tok)
            || (tok == "key"
                && (prev == "isakmp"
                    || first.starts_with("tacacs")
                    || first.starts_with("radius")
                    || first == "server"
                    // " key 7 <valor>" dentro de un bloque tacacs/radius; " key 1" (key chain) no.
                    || (k == 0
                        && words.len() >= 3
                        && parts[words[1]].1.chars().all(|c| c.is_ascii_digit()))))
            || (k == 1 && first == "set" && forti_set_secret(tok));
        if !trigger {
            k += 1;
            continue;
        }
        // Salta los indicadores de tipo; si no queda valor, el último "tipo" era el secreto.
        let mut j = k + 1;
        if tok == "community" {
            // Huawei: "community read cipher <valor>"; el valor Cisco va enseguida.
            while j < words.len()
                && matches!(parts[words[j]].1.to_ascii_lowercase().as_str(), "read" | "write" | "cipher" | "simple")
            {
                j += 1;
            }
        } else {
            while j < words.len() && is_type_token(&parts[words[j]].1) {
                j += 1;
            }
            if j == words.len() && j > k + 1 {
                j -= 1;
            }
        }
        if j >= words.len() {
            break;
        }
        // Un valor entre comillas puede tener espacios: se enmascara hasta la comilla final.
        let start = words[j];
        let mut end = start;
        let first_val = &parts[start].1;
        if first_val.starts_with('"') && !(first_val.len() > 1 && first_val.trim_end_matches(';').ends_with('"')) {
            let mut m = j + 1;
            while m < words.len() {
                end = words[m];
                if parts[words[m]].1.trim_end_matches(';').ends_with('"') {
                    break;
                }
                m += 1;
            }
            j = m;
        }
        let tail = if parts[end].1.ends_with(';') { ";" } else { "" };
        parts[start].1 = format!("****{tail}");
        for p in parts.iter_mut().take(end + 1).skip(start + 1) {
            p.1.clear();
        }
        k = j + 1;
    }
    parts.into_iter().map(|(_, s)| s).collect()
}

pub fn mask(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    for (i, line) in content.split('\n').enumerate() {
        if i > 0 {
            out.push('\n');
        }
        out.push_str(&mask_line(line));
    }
    out
}

/// Guarda un respaldo y devuelve el nombre del archivo creado.
pub fn save(data_dir: &Path, device: &str, content: &str, masked: bool) -> Result<String, String> {
    if content.len() > MAX_BYTES {
        return Err("El respaldo supera 20 MB".into());
    }
    let dev = sanitize_device(device)?;
    let base = root(data_dir);
    let dir = base.join(&dev);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    crate::session_store::restrict(&base);
    crate::session_store::restrict(&dir);
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H%M%S").to_string();
    let mut name = format!("{stamp}.txt");
    let mut n = 2;
    while dir.join(&name).exists() {
        if n > 999 {
            return Err("Demasiados respaldos en el mismo segundo".into());
        }
        name = format!("{stamp}-{n}.txt");
        n += 1;
    }
    let body = if masked { mask(content) } else { content.to_string() };
    let path = dir.join(&name);
    let tmp = dir.join(format!(".{name}.tmp"));
    fs::write(&tmp, body).map_err(|e| e.to_string())?;
    crate::session_store::restrict(&tmp);
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(name)
}

pub fn list(data_dir: &Path) -> Vec<DeviceBackups> {
    let mut out: Vec<DeviceBackups> = fs::read_dir(root(data_dir))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let device = e.file_name().to_string_lossy().into_owned();
            if sanitize_device(&device).ok()? != device {
                return None;
            }
            let mut files: Vec<BackupFile> = fs::read_dir(e.path())
                .into_iter()
                .flatten()
                .flatten()
                .filter_map(|f| {
                    let name = f.file_name().to_string_lossy().into_owned();
                    if !file_re().is_match(&name) {
                        return None;
                    }
                    let meta = f.metadata().ok()?;
                    let modified = meta
                        .modified()
                        .ok()
                        .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    Some(BackupFile { name, size: meta.len(), modified })
                })
                .collect();
            // El nombre lleva la fecha: orden descendente = más reciente primero.
            files.sort_by(|a, b| b.name.cmp(&a.name));
            (!files.is_empty()).then_some(DeviceBackups { device, files })
        })
        .collect();
    out.sort_by_key(|a| a.device.to_lowercase());
    out
}

pub fn read(data_dir: &Path, device: &str, file: &str) -> Result<String, String> {
    let bytes = fs::read(file_path(data_dir, device, file)?).map_err(|e| e.to_string())?;
    Ok(String::from_utf8(bytes).unwrap_or_else(|e| e.into_bytes().iter().map(|&b| b as char).collect()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_device_names() {
        assert_eq!(sanitize_device("core-sw01").unwrap(), "core-sw01");
        assert_eq!(sanitize_device("../../etc/passwd").unwrap(), "etc_passwd");
        assert_eq!(sanitize_device("..").ok(), None);
        assert_eq!(sanitize_device("  / ").ok(), None);
        assert_eq!(sanitize_device("sw acceso:norte").unwrap(), "sw_acceso_norte");
        assert_eq!(sanitize_device(r"C:\Windows").unwrap(), "C__Windows");
        assert_eq!(sanitize_device(&"x".repeat(200)).unwrap().len(), 64);
    }

    #[test]
    fn rejects_paths_outside_backups() {
        let d = Path::new("/tmp/nt");
        assert!(file_path(d, "core", "2026-01-02_030405.txt").is_ok());
        assert!(file_path(d, "core", "2026-01-02_030405-2.txt").is_ok());
        assert!(file_path(d, "core", "../sessions.json").is_err());
        assert!(file_path(d, "core", "2026-01-02_030405.txt/../../x").is_err());
        assert!(file_path(d, "../core", "2026-01-02_030405.txt").is_err());
        assert!(file_path(d, "core/..", "2026-01-02_030405.txt").is_err());
    }

    #[test]
    fn masks_secrets_by_vendor() {
        let cases = [
            ("enable secret 9 $9$abc$def", "enable secret 9 ****"),
            ("username admin privilege 15 secret 5 $1$xyz", "username admin privilege 15 secret 5 ****"),
            ("username ops password 0 Cl4ve", "username ops password 0 ****"),
            ("enable password 12345", "enable password ****"),
            ("snmp-server community PUBLICO RO 10", "snmp-server community **** RO 10"),
            ("snmp-server community 123 RW", "snmp-server community **** RW"),
            (" key 7 0822455D0A16", " key 7 ****"),
            ("tacacs-server host 192.0.2.5 key 7 ABCD", "tacacs-server host 192.0.2.5 key 7 ****"),
            ("crypto isakmp key S3creto address 192.0.2.9", "crypto isakmp key **** address 192.0.2.9"),
            (" ip ospf message-digest-key 12 md5 7 XYZ", " ip ospf message-digest-key 12 md5 7 ****"),
            (" key-string 7 1234ABCD", " key-string 7 ****"),
            (" local-user admin password irreversible-cipher $1a$xx$", " local-user admin password irreversible-cipher ****"),
            ("snmp-agent community read cipher %^%#abc%^%# acl 2000", "snmp-agent community read cipher **** acl 2000"),
            (
                "set system root-authentication encrypted-password \"$6$abc\"",
                "set system root-authentication encrypted-password ****",
            ),
            (
                "set security ike policy P1 pre-shared-key ascii-text \"$9$a b\"",
                "set security ike policy P1 pre-shared-key ascii-text ****",
            ),
            ("        set password ENC SH2abc==", "        set password ENC ****"),
            ("        set psksecret ENC xyz", "        set psksecret ENC ****"),
            ("    encrypted-password \"$6$x\"; ## SECRET-DATA", "    encrypted-password ****; ## SECRET-DATA"),
        ];
        for (input, want) in cases {
            assert_eq!(mask_line(input), want, "entrada: {input}");
        }
        // Líneas sin secretos quedan intactas.
        for keep in [
            "interface GigabitEthernet1/0/1",
            "service password-encryption",
            "key chain OSPF",
            " key 1",
            "crypto key generate rsa modulus 2048",
            "        set keepalive 10",
            "",
        ] {
            assert_eq!(mask_line(keep), keep);
        }
    }

    #[test]
    fn saves_lists_and_reads() {
        let dir = std::env::temp_dir().join(format!("nt-backups-{}", std::process::id()));
        let a = save(&dir, "../core sw", "hostname core\nenable secret 5 abc\n", true).unwrap();
        let b = save(&dir, "../core sw", "hostname core\n", false).unwrap();
        assert_ne!(a, b);
        let l = list(&dir);
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].device, "core_sw");
        assert_eq!(l[0].files.len(), 2);
        assert_eq!(read(&dir, "core_sw", &a).unwrap(), "hostname core\nenable secret 5 ****\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(root(&dir).join("core_sw").join(&a)).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        assert!(read(&dir, "core_sw", "../../x.txt").is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
