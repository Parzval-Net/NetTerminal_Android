//! Scripts Python contra una sesión abierta. El script habla con la app por
//! stdin/stdout en líneas JSON (ver `netterminal.py`).

use crate::connection::ConnectionManager;
use crate::expect;
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const HELPER: &str = include_str!("netterminal.py");

const EXAMPLE: &str = r#"# Ejemplo: respaldo de configuración del equipo de la sesión activa.
# Ejecútalo desde la barra de botones o el menú Scripts con una sesión conectada.
import datetime
import pathlib

import netterminal as nt

nt.run("terminal length 0")           # Cisco/Arista. Huawei: "screen-length 0 temporary"
config = nt.run("show running-config", timeout=90)

carpeta = pathlib.Path(nt.data_dir) / "respaldos"
carpeta.mkdir(parents=True, exist_ok=True)
nombre = nt.session.get("name", "equipo").replace("/", "-")
archivo = carpeta / f"{nombre}_{datetime.datetime.now():%Y%m%d-%H%M%S}.txt"
archivo.write_text(config, encoding="utf-8")

print(f"Respaldo guardado: {archivo} ({len(config.splitlines())} líneas)")
"#;

#[derive(Default)]
pub struct ScriptRunner {
    running: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
}

#[derive(Serialize, Clone)]
struct ScriptEvent {
    run: String,
    script: String,
    kind: &'static str, // "log" | "done" | "error"
    message: String,
}

pub fn scripts_dir(data_dir: &Path) -> PathBuf {
    let dir = data_dir.join("scripts");
    let _ = fs::create_dir_all(&dir);
    // El helper se reescribe siempre para mantenerlo al día con la app.
    let _ = fs::write(dir.join("netterminal.py"), HELPER);
    let example = dir.join("ejemplo_respaldo.py");
    if !example.exists() {
        let _ = fs::write(example, EXAMPLE);
    }
    dir
}

pub fn list(data_dir: &Path) -> Vec<String> {
    let dir = scripts_dir(data_dir);
    let mut names: Vec<String> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            let name = p.file_name()?.to_string_lossy().into_owned();
            (p.extension()? == "py" && p.file_stem()? != "netterminal").then_some(name)
        })
        .collect();
    names.sort();
    names
}

/// Intérprete disponible: `py -3` en Windows, luego python3 y python.
fn python() -> Option<&'static (String, Vec<String>)> {
    static PY: OnceLock<Option<(String, Vec<String>)>> = OnceLock::new();
    PY.get_or_init(|| {
        let candidates: &[(&str, &[&str])] = if cfg!(windows) {
            &[("py", &["-3"]), ("python", &[]), ("python3", &[])]
        } else {
            &[("python3", &[]), ("python", &[])]
        };
        candidates.iter().find_map(|(bin, args)| {
            let mut c = Command::new(bin);
            c.args(*args).arg("--version");
            hide_console(&mut c);
            let out = c.output().ok()?;
            let v = String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr);
            v.contains("Python 3")
                .then(|| (bin.to_string(), args.iter().map(|a| a.to_string()).collect()))
        })
    })
    .as_ref()
}

fn hide_console(_c: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        _c.creation_flags(0x0800_0000);
    }
}

/// Qué ejecutar: un script de usuario o la acción de un plugin.
pub struct RunSpec {
    pub label: String,
    pub path: PathBuf,
    pub cwd: PathBuf,
    /// Conexión sobre la que opera (None = sin sesión).
    pub conn: Option<String>,
    /// false = el script no puede enviar ni leer de la sesión (plugin sin permiso "session").
    pub allow_session: bool,
    pub env: Vec<(String, String)>,
}

impl ScriptRunner {
    pub fn run(&self, app: AppHandle, conn_id: String, script: String, data_dir: &Path) -> Result<String, String> {
        let dir = scripts_dir(data_dir);
        // Solo archivos .py dentro de la carpeta de scripts (sin rutas).
        if script.contains(['/', '\\']) || !script.ends_with(".py") {
            return Err("Nombre de script inválido".into());
        }
        let path = dir.join(&script);
        if !path.is_file() {
            return Err(format!("No existe {script}"));
        }
        self.run_spec(
            app,
            RunSpec { label: script, path, cwd: dir, conn: Some(conn_id), allow_session: true, env: vec![] },
            data_dir,
        )
    }

    pub fn run_spec(&self, app: AppHandle, spec: RunSpec, data_dir: &Path) -> Result<String, String> {
        let RunSpec { label: script, path, cwd, conn, allow_session, env } = spec;
        let (bin, pre) = python().ok_or("No se encontró Python 3. Instálalo para usar scripts y plugins.")?;
        let helper_dir = scripts_dir(data_dir);

        let conns = &app.state::<crate::AppState>().conns;
        let (session, rx) = match conn.as_deref() {
            Some(id) => {
                let (_, s) = conns.info(id).ok_or("La sesión no está conectada")?;
                (Some(s), conns.tap(id))
            }
            None => (None, None),
        };
        let conn_id = conn.unwrap_or_default();

        let mut cmd = Command::new(bin);
        cmd.args(pre)
            .arg("-u")
            .arg(&path)
            .current_dir(&cwd)
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONPATH", &helper_dir)
            .env("NT_DATA_DIR", data_dir)
            .env(
                "NT_SESSION",
                session
                    .map(|s| {
                        json!({
                            "name": s.name, "type": s.session_type, "host": s.host,
                            "port": s.port, "username": s.username, "serial_port": s.serial_port,
                        })
                        .to_string()
                    })
                    .unwrap_or_else(|| "{}".into()),
            )
            .envs(env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console(&mut cmd);
        let mut child = cmd.spawn().map_err(|e| format!("No se pudo iniciar Python: {e}"))?;

        let stdout = child.stdout.take().ok_or("sin stdout")?;
        let mut stdin = child.stdin.take().ok_or("sin stdin")?;
        let stderr = child.stderr.take().ok_or("sin stderr")?;
        let run_id = uuid::Uuid::new_v4().to_string();
        let child = Arc::new(Mutex::new(child));
        self.running.lock().unwrap().insert(run_id.clone(), child.clone());

        let errors = Arc::new(Mutex::new(Vec::<String>::new()));
        let errs = errors.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let mut e = errs.lock().unwrap();
                e.push(line);
                if e.len() > 20 {
                    e.remove(0);
                }
            }
        });

        let id = run_id.clone();
        std::thread::spawn(move || {
            let emit = |kind: &'static str, message: String| {
                let _ = app.emit(
                    "script-event",
                    ScriptEvent { run: id.clone(), script: script.clone(), kind, message },
                );
            };
            let mut pending = String::new();
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let req: Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => {
                        emit("log", line);
                        continue;
                    }
                };
                let conns = &app.state::<crate::AppState>().conns;
                let session_op = matches!(req["op"].as_str(), Some("send" | "wait" | "read" | "clear"));
                let reply = match (&rx, session_op) {
                    (_, true) if !allow_session => {
                        json!({"ok": false, "error": "Este plugin no declaró el permiso 'session'"})
                    }
                    (None, true) => json!({"ok": false, "error": "No hay una sesión conectada"}),
                    (Some(rx), _) => handle(&req, conns, &conn_id, rx, &mut pending, &emit),
                    (None, false) => handle_offline(&req, &emit),
                };
                if writeln!(stdin, "{reply}").and_then(|_| stdin.flush()).is_err() {
                    break;
                }
            }
            let status = child.lock().unwrap().wait();
            app.state::<crate::AppState>().scripts.running.lock().unwrap().remove(&id);
            match status {
                Ok(s) if s.success() => emit("done", "Script finalizado".into()),
                Ok(s) => {
                    let tail = errors.lock().unwrap().join("\n");
                    let last = tail.lines().last().unwrap_or("").to_string();
                    emit("error", format!("Terminó con código {}: {last}", s.code().unwrap_or(-1)));
                }
                Err(e) => emit("error", e.to_string()),
            }
        });
        Ok(run_id)
    }

    pub fn stop(&self, run_id: &str) {
        if let Some(child) = self.running.lock().unwrap().remove(run_id) {
            let _ = child.lock().unwrap().kill();
        }
    }
}

fn handle_offline(req: &Value, emit: &dyn Fn(&'static str, String)) -> Value {
    match req["op"].as_str().unwrap_or("") {
        "log" => {
            emit("log", req["msg"].as_str().unwrap_or("").to_string());
            json!({"ok": true})
        }
        other => json!({"ok": false, "error": format!("operación desconocida: {other}")}),
    }
}

fn handle(
    req: &Value,
    conns: &ConnectionManager,
    conn_id: &str,
    rx: &std::sync::mpsc::Receiver<String>,
    pending: &mut String,
    emit: &dyn Fn(&'static str, String),
) -> Value {
    let secs = |k: &str, d: f64| Duration::from_secs_f64(req[k].as_f64().unwrap_or(d).clamp(0.05, 3600.0));
    match req["op"].as_str().unwrap_or("") {
        "send" => match conns.write(conn_id, req["data"].as_str().unwrap_or("").as_bytes()) {
            Ok(()) => json!({"ok": true}),
            Err(e) => json!({"ok": false, "error": e}),
        },
        "wait" => {
            let Ok(re) = Regex::new(req["pattern"].as_str().unwrap_or("")) else {
                return json!({"ok": false, "error": "patrón inválido"});
            };
            match expect::wait_for(rx, &re, secs("timeout", 10.0), pending) {
                Ok(output) => json!({"ok": true, "output": output}),
                Err(output) => json!({"ok": false, "error": "timeout", "output": output}),
            }
        }
        "read" => {
            let mut out = std::mem::take(pending);
            out.push_str(&expect::collect(rx, secs("idle", 1.0), secs("timeout", 10.0)));
            json!({"ok": true, "output": out})
        }
        "clear" => {
            pending.clear();
            expect::drain(rx);
            json!({"ok": true})
        }
        "log" => {
            emit("log", req["msg"].as_str().unwrap_or("").to_string());
            json!({"ok": true})
        }
        other => json!({"ok": false, "error": format!("operación desconocida: {other}")}),
    }
}
