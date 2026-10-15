//! Notas en texto plano dentro de `<datos>/notes`, editables también con cualquier editor.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct NoteInfo {
    pub name: String,
    pub modified: u64,
}

/// Nombre seguro: sin separadores de ruta ni caracteres reservados en Windows.
fn file_for(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let clean: String = name
        .trim()
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') && !c.is_control())
        .collect();
    let clean = clean.trim_matches('.').trim();
    if clean.is_empty() {
        return Err("Nombre de nota inválido".into());
    }
    Ok(dir.join(format!("{clean}.txt")))
}

pub fn list(dir: &Path) -> Vec<NoteInfo> {
    let _ = fs::create_dir_all(dir);
    let mut notes: Vec<NoteInfo> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            if path.extension()?.to_str()? != "txt" {
                return None;
            }
            let modified = e
                .metadata()
                .ok()?
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_secs();
            Some(NoteInfo {
                name: path.file_stem()?.to_string_lossy().into_owned(),
                modified,
            })
        })
        .collect();
    notes.sort_by_key(|n| std::cmp::Reverse(n.modified));
    notes
}

pub fn read(dir: &Path, name: &str) -> Result<String, String> {
    // Lectura tolerante: una nota guardada en Windows-1252 por otro editor no debe verse vacía
    // (y sobrescribirse con la primera tecla).
    let bytes = fs::read(file_for(dir, name)?).map_err(|e| e.to_string())?;
    Ok(String::from_utf8(bytes).unwrap_or_else(|e| e.into_bytes().iter().map(|&b| b as char).collect()))
}

pub fn save(dir: &Path, name: &str, content: &str) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = file_for(dir, name)?;
    let tmp = path.with_extension("txt.tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

pub fn rename(dir: &Path, from: &str, to: &str) -> Result<String, String> {
    let src = file_for(dir, from)?;
    let dst = file_for(dir, to)?;
    if dst.exists() {
        return Err("Ya existe una nota con ese nombre".into());
    }
    fs::rename(&src, &dst).map_err(|e| e.to_string())?;
    Ok(dst.file_stem().unwrap_or_default().to_string_lossy().into_owned())
}

pub fn delete(dir: &Path, name: &str) -> Result<(), String> {
    fs::remove_file(file_for(dir, name)?).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_names_and_roundtrips() {
        let dir = std::env::temp_dir().join(format!("nt-notes-{}", std::process::id()));
        save(&dir, "../../etc/pass:wd", "hola").unwrap();
        assert!(dir.join("etcpasswd.txt").exists());
        assert_eq!(read(&dir, "etcpasswd").unwrap(), "hola");
        assert_eq!(rename(&dir, "etcpasswd", "cambio CR-123").unwrap(), "cambio CR-123");
        assert_eq!(list(&dir).len(), 1);
        delete(&dir, "cambio CR-123").unwrap();
        assert!(file_for(&dir, "..").is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
