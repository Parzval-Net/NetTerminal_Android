//! Aviso de versión nueva: consulta el último release en GitHub y lo compara con la
//! versión instalada. No descarga ni instala nada.

use serde::Serialize;
use std::time::Duration;

#[derive(Serialize)]
pub struct UpdateInfo {
    current: String,
    latest: String,
    newer: bool,
    url: String,
    notes: String,
    published: String,
}

fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    let core = v.trim().trim_start_matches(['v', 'V']).split(['-', '+']).next()?;
    let mut it = core.split('.').map(|p| p.parse::<u64>().ok());
    Some((it.next()??, it.next().flatten().unwrap_or(0), it.next().flatten().unwrap_or(0)))
}

pub fn is_newer(latest: &str, current: &str) -> bool {
    matches!((parse_version(latest), parse_version(current)), (Some(l), Some(c)) if l > c)
}

pub fn check(repo: &str, token: Option<&str>) -> Result<UpdateInfo, String> {
    let valid = repo.split('/').count() == 2
        && repo.split('/').all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)));
    if !valid {
        return Err("Repositorio inválido (formato: dueño/repositorio)".into());
    }
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(15))
        .try_proxy_from_env(true)
        .build();
    let mut req = agent
        .get(&format!("https://api.github.com/repos/{repo}/releases/latest"))
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", concat!("NetTerminal/", env!("CARGO_PKG_VERSION")));
    if let Some(t) = token.map(str::trim).filter(|t| !t.is_empty()) {
        req = req.set("Authorization", &format!("Bearer {t}"));
    }
    let resp = match req.call() {
        Ok(r) => r,
        Err(ureq::Error::Status(404, _)) => {
            return Err(if token.is_some_and(|t| !t.trim().is_empty()) {
                "No hay releases publicados todavía, o el token no tiene acceso al repositorio".into()
            } else {
                "El repositorio es privado o no tiene releases. Agrega un token de solo lectura en Ajustes.".into()
            })
        }
        Err(ureq::Error::Status(401, _)) => return Err("Token inválido o expirado".into()),
        Err(ureq::Error::Status(403, r)) => {
            return Err(if r.header("x-ratelimit-remaining") == Some("0") {
                "GitHub limitó las consultas sin autenticar desde tu red (común en redes corporativas). \
                 Agrega un token o intenta más tarde."
                    .into()
            } else {
                "GitHub denegó el acceso: revisa los permisos del token".into()
            })
        }
        Err(e) => return Err(format!("Sin conexión con GitHub: {e}")),
    };
    let body = resp.into_string().map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let latest = v["tag_name"].as_str().unwrap_or("").to_string();
    let current = env!("CARGO_PKG_VERSION").to_string();
    Ok(UpdateInfo {
        newer: is_newer(&latest, &current),
        url: v["html_url"].as_str().unwrap_or("").to_string(),
        notes: v["body"].as_str().unwrap_or("").chars().take(2000).collect(),
        published: v["published_at"].as_str().unwrap_or("").to_string(),
        latest,
        current,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions() {
        assert!(is_newer("v0.3.0", "0.2.0"));
        assert!(is_newer("1.0", "0.9.9"));
        assert!(is_newer("v0.2.10", "0.2.9"));
        assert!(!is_newer("v0.2.0", "0.2.0"));
        assert!(!is_newer("v0.1.9", "0.2.0"));
        assert!(!is_newer("nightly", "0.2.0"));
        assert!(!is_newer("v0.3.0-beta", "0.3.0"));
    }

    #[test]
    fn rejects_bad_repo() {
        assert!(check("../../evil", None).is_err());
        assert!(check("a/b/c", None).is_err());
    }
}
