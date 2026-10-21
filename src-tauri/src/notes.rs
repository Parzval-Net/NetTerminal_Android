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

/// Coincidencia de búsqueda en una nota.
#[derive(Serialize, Debug)]
pub struct NoteMatch {
    pub name: String,
    /// Línea (desde 1).
    pub line: usize,
    pub snippet: String,
}

/// Máximo de resultados y tamaño de nota que se revisa (las notas grandes se omiten).
const SEARCH_MAX_RESULTS: usize = 200;
const SEARCH_MAX_FILE: u64 = 2 * 1024 * 1024;
const SNIPPET_CHARS: usize = 160;

/// Busca texto plano sin distinguir mayúsculas en todas las notas (las más recientes primero).
pub fn search(dir: &Path, query: &str) -> Vec<NoteMatch> {
    let q: Vec<char> = query.trim().to_lowercase().chars().collect();
    if q.is_empty() || q.len() > 200 {
        return Vec::new();
    }
    let mut out = Vec::new();
    for note in list(dir) {
        let Ok(path) = file_for(dir, &note.name) else { continue };
        if fs::metadata(&path).map(|m| m.len() > SEARCH_MAX_FILE).unwrap_or(true) {
            continue;
        }
        let Ok(text) = read(dir, &note.name) else { continue };
        for (i, line) in text.lines().enumerate() {
            let chars: Vec<char> = line.chars().collect();
            // Comparación carácter a carácter: la posición sirve directo para el fragmento.
            let lower: Vec<char> = chars.iter().map(|c| c.to_lowercase().next().unwrap_or(*c)).collect();
            let Some(pos) = lower.windows(q.len()).position(|w| w == q.as_slice()) else { continue };
            out.push(NoteMatch { name: note.name.clone(), line: i + 1, snippet: snippet(&chars, pos, q.len()) });
            if out.len() >= SEARCH_MAX_RESULTS {
                return out;
            }
        }
    }
    out
}

/// Fragmento de la línea alrededor de la coincidencia, sin espacios iniciales.
fn snippet(chars: &[char], pos: usize, len: usize) -> String {
    if chars.len() <= SNIPPET_CHARS {
        return chars.iter().collect::<String>().trim().to_string();
    }
    let start = pos.saturating_sub((SNIPPET_CHARS.saturating_sub(len)) / 2).min(chars.len() - SNIPPET_CHARS);
    let end = start + SNIPPET_CHARS;
    let mut s: String = chars[start..end].iter().collect();
    if start > 0 {
        s = format!("…{}", s.trim_start());
    }
    if end < chars.len() {
        s.push('…');
    }
    s
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

    #[test]
    fn searches_all_notes_case_insensitive() {
        let dir = std::env::temp_dir().join(format!("nt-notes-search-{}", std::process::id()));
        save(&dir, "core", "interface Gi1/0/1\n description UPLINK\nshow VLAN brief").unwrap();
        save(&dir, "wan", "ip route 0.0.0.0 0.0.0.0 192.0.2.1\nshow vlan").unwrap();
        let mut hits = search(&dir, "VlAn");
        hits.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(hits.len(), 2);
        assert_eq!((hits[0].name.as_str(), hits[0].line), ("core", 3));
        assert_eq!(hits[1].snippet, "show vlan");
        assert!(search(&dir, "  ").is_empty());
        assert!(search(&dir, "no-existe").is_empty());
        // Fragmento acotado en líneas largas.
        save(&dir, "larga", &format!("{}clave{}", "x".repeat(400), "y".repeat(400))).unwrap();
        let h = search(&dir, "CLAVE");
        assert!(h[0].snippet.contains("clave") && h[0].snippet.chars().count() <= SNIPPET_CHARS + 2);
        let _ = fs::remove_dir_all(&dir);
    }
}
