//! Actualizaciones desde el repositorio donde se publica la app.
//!
//! Una sola fuente: el `latest.json` firmado del último release. Sirve tanto para el aviso
//! como para instalar, así que lo que se anuncia es exactamente lo que se instala. Se lee
//! desde la CDN de releases de GitHub (sin la API ni su límite de consultas por IP).

use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Repositorio "dueño/nombre". En CI se fija con el repositorio que compila
/// (`NT_UPDATE_REPO`, así un fork se actualiza desde sí mismo); si no, el de Cargo.toml.
pub fn repo() -> &'static str {
    option_env!("NT_UPDATE_REPO")
        .filter(|r| valid_repo(r))
        .unwrap_or_else(|| repo_from_url(env!("CARGO_PKG_REPOSITORY")))
}

fn repo_from_url(url: &'static str) -> &'static str {
    url.trim_end_matches('/').trim_end_matches(".git").trim_start_matches("https://github.com/")
}

fn valid_repo(r: &str) -> bool {
    let parts: Vec<&str> = r.split('/').collect();
    parts.len() == 2
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)))
}

fn endpoint() -> String {
    format!("https://github.com/{}/releases/latest/download/latest.json", repo())
}

/// Última comprobación con versión nueva: la instalación la reutiliza sin volver a consultar.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct UpdateInfo {
    current: String,
    latest: String,
    newer: bool,
    /// Página del release, para leer las novedades o descargar a mano.
    url: String,
    notes: String,
    published: String,
    /// Si esta instalación puede actualizarse sola (o por qué no).
    supported: bool,
    reason: Option<&'static str>,
}

/// Si esta instalación puede actualizarse sola, o por qué no.
pub fn blocker() -> Option<&'static str> {
    if crate::session_store::is_portable() {
        return Some("En modo portable la actualización es manual: reemplaza los archivos de la carpeta.");
    }
    if cfg!(target_os = "linux") && std::env::var_os("APPIMAGE").is_none() {
        return Some("Instalada con .deb: actualiza con el paquete nuevo o con apt.");
    }
    if cfg!(target_os = "macos") && std::env::current_exe().is_ok_and(|p| p.starts_with("/Volumes/")) {
        return Some("La app corre desde el .dmg: cópiala a Aplicaciones para poder actualizarla.");
    }
    None
}

async fn fetch(app: &AppHandle) -> Result<Option<Update>, String> {
    let url = endpoint().parse().map_err(|e| format!("Dirección de actualizaciones inválida: {e}"))?;
    app.updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| match e.to_string() {
            m if m.contains("404") => "Aún no hay releases con actualización automática publicados".to_string(),
            m => format!("No se pudo consultar las actualizaciones: {m}"),
        })
}

pub async fn check(app: &AppHandle) -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let found = fetch(app).await?;
    let reason = blocker();
    let info = match &found {
        Some(u) => UpdateInfo {
            latest: u.version.clone(),
            newer: true,
            url: format!("https://github.com/{}/releases/tag/v{}", repo(), u.version),
            notes: u.body.clone().unwrap_or_default().chars().take(4000).collect(),
            published: u.date.map(|d| d.to_string()).unwrap_or_default(),
            current,
            supported: reason.is_none(),
            reason,
        },
        None => UpdateInfo {
            latest: current.clone(),
            newer: false,
            url: format!("https://github.com/{}/releases", repo()),
            notes: String::new(),
            published: String::new(),
            current,
            supported: reason.is_none(),
            reason,
        },
    };
    *app.state::<Pending>().0.lock().unwrap() = found;
    Ok(info)
}

/// Descarga, verifica la firma (clave pública incluida en la app) e instala; luego reinicia.
/// Solo se llama cuando el usuario lo confirma.
pub async fn install(app: AppHandle) -> Result<(), String> {
    if let Some(reason) = blocker() {
        return Err(reason.into());
    }
    let cached = app.state::<Pending>().0.lock().unwrap().take();
    let update = match cached {
        Some(u) => u,
        None => fetch(&app).await?.ok_or("Ya tienes la última versión")?,
    };
    let progress = app.clone();
    let mut done: usize = 0;
    update
        .download_and_install(
            move |chunk, total| {
                done += chunk;
                let _ = progress.emit("update-progress", serde_json::json!({ "downloaded": done, "total": total }));
            },
            || {},
        )
        .await
        .map_err(|e| format!("No se pudo instalar la actualización: {e}"))?;
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_comes_from_build_metadata() {
        assert!(valid_repo(repo()), "repositorio inválido: {}", repo());
        assert_eq!(repo_from_url("https://github.com/dueño/app.git"), "dueño/app");
        assert_eq!(repo_from_url("https://github.com/a/b/"), "a/b");
        assert!(endpoint().ends_with("/releases/latest/download/latest.json"));
    }

    #[test]
    fn rejects_bad_repo() {
        assert!(!valid_repo("../../evil"));
        assert!(!valid_repo("a/b/c"));
        assert!(!valid_repo("a b/c"));
        assert!(valid_repo("Parzval-Net/Net_Terminal"));
    }
}
