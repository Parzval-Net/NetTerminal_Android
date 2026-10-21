mod cmdpacks;
mod connection;
mod expect;
mod filexfer;
mod updates;
mod mcp;
mod monitor;
mod nettools;
mod plugins;
mod servers;
mod scripts;
mod models;
mod notes;
mod session_store;
mod telnet;

use connection::ConnectionManager;
use models::{SerialPortInfo, Session};
use session_store::SessionStore;
use std::path::PathBuf;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

struct AppState {
    store: SessionStore,
    conns: ConnectionManager,
    scripts: scripts::ScriptRunner,
    mcp: mcp::McpServer,
    monitor: monitor::Monitor,
    jobs: nettools::Jobs,
    servers: servers::Servers,
    data_dir: PathBuf,
}

impl AppState {
    fn logs_dir(&self) -> PathBuf {
        self.data_dir.join("logs")
    }

    fn notes_dir(&self) -> PathBuf {
        self.data_dir.join("notes")
    }
}

#[tauri::command]
fn list_sessions(state: State<'_, AppState>) -> Vec<Session> {
    state.store.list()
}

#[tauri::command]
fn save_session(session: Session, state: State<'_, AppState>) -> Result<Session, String> {
    state.store.save(session)
}

#[tauri::command]
fn update_sessions(sessions: Vec<Session>, state: State<'_, AppState>) -> Result<Vec<Session>, String> {
    state.store.update_many(sessions)
}

#[tauri::command]
fn delete_session(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.store.delete(&id)
}

#[tauri::command(async)]
fn list_serial_ports() -> Vec<SerialPortInfo> {
    connection::list_serial_ports()
}

/// Asíncrono para no bloquear la UI mientras Telnet resuelve/conecta.
#[tauri::command]
async fn connect(
    id: String,
    mut session: Session,
    cols: u16,
    rows: u16,
    on_data: Channel<InvokeResponseBody>,
    on_exit: Channel<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // SCP: las rutas locales se resuelven aquí, solo dentro de la carpeta compartida.
    if let Some(spec) = session.scp.as_mut() {
        let root = app.state::<AppState>().data_dir.join("tftp");
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        if spec.upload {
            spec.local_paths = spec
                .files
                .iter()
                .map(|f| {
                    servers::safe_path(&root, f)
                        .filter(|p| p.is_file())
                        .map(|p| p.to_string_lossy().into_owned())
                        .ok_or_else(|| format!("No existe {f} en la carpeta compartida"))
                })
                .collect::<Result<_, _>>()?;
        } else {
            spec.local_dir = root.to_string_lossy().into_owned();
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>()
            .conns
            .connect(id, &session, cols, rows, on_data, on_exit)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn write(id: String, data: String, state: State<'_, AppState>) -> Result<(), String> {
    state.conns.write(&id, data.as_bytes())
}

#[tauri::command]
fn resize(id: String, cols: u16, rows: u16, state: State<'_, AppState>) -> Result<(), String> {
    state.conns.resize(&id, cols, rows)
}

#[tauri::command]
fn disconnect(id: String, state: State<'_, AppState>) {
    state.conns.disconnect(&id)
}

#[tauri::command]
fn send_break(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.conns.send_break(&id)
}

#[tauri::command]
fn set_logging(
    id: String,
    enabled: bool,
    timestamps: Option<bool>,
    resume: Option<String>,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    state
        .conns
        .set_logging(&id, enabled, timestamps.unwrap_or(false), &state.logs_dir(), resume.as_deref())
}

/// Abre la carpeta de logs ("logs") o la de datos ("data") en el explorador del sistema.
#[tauri::command]
fn open_dir(which: String, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let dir = match which.as_str() {
        "logs" => state.logs_dir(),
        "notes" => state.notes_dir(),
        "scripts" => scripts::scripts_dir(&state.data_dir),
        "tftp" => state.data_dir.join("tftp"),
        "plugins" => state.data_dir.join("plugins"),
        "syslog" => state.data_dir.join("syslog"),
        _ => state.data_dir.clone(),
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn list_notes(state: State<'_, AppState>) -> Vec<notes::NoteInfo> {
    notes::list(&state.notes_dir())
}

#[tauri::command(async)]
fn read_note(name: String, state: State<'_, AppState>) -> Result<String, String> {
    notes::read(&state.notes_dir(), &name)
}

#[tauri::command]
fn save_note(name: String, content: String, state: State<'_, AppState>) -> Result<(), String> {
    notes::save(&state.notes_dir(), &name, &content)
}

#[tauri::command]
fn rename_note(from: String, to: String, state: State<'_, AppState>) -> Result<String, String> {
    notes::rename(&state.notes_dir(), &from, &to)
}

#[tauri::command]
fn delete_note(name: String, state: State<'_, AppState>) -> Result<(), String> {
    notes::delete(&state.notes_dir(), &name)
}

#[tauri::command(async)]
fn list_scripts(state: State<'_, AppState>) -> Vec<String> {
    scripts::list(&state.data_dir)
}

#[tauri::command(async)]
fn run_script(id: String, script: String, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    state.scripts.run(app.clone(), id, script, &state.data_dir)
}

#[tauri::command]
fn stop_script(run: String, state: State<'_, AppState>) {
    state.scripts.stop(&run)
}

#[tauri::command]
fn mcp_configure(
    enabled: bool,
    port: u16,
    token: String,
    require_approval: bool,
    read_only: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    state.mcp.configure(
        app.clone(),
        mcp::McpConfig { enabled, port, token, require_approval, read_only },
    )
}

#[tauri::command]
fn mcp_decide(id: String, approved: bool, state: State<'_, AppState>) {
    state.mcp.decide(&id, approved)
}

// ---------- Herramientas de red ----------

#[tauri::command]
fn monitor_start(cfg: monitor::ProbeConfig, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.monitor.start(app.clone(), cfg)
}

#[tauri::command]
fn monitor_stop(id: String, state: State<'_, AppState>) {
    state.monitor.stop(&id)
}

#[tauri::command]
fn monitor_running(state: State<'_, AppState>) -> Vec<String> {
    state.monitor.running()
}

#[tauri::command(async)]
fn tool_traceroute(host: String, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    state.jobs.traceroute(app.clone(), &host)
}

#[tauri::command(async)]
fn tool_iperf(params: nettools::IperfParams, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    state.jobs.iperf(app.clone(), params)
}

#[tauri::command(async)]
fn tool_iperf_version() -> Option<String> {
    nettools::iperf_version()
}

#[tauri::command]
fn tool_speedtest(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    state.jobs.speedtest(app.clone())
}

#[tauri::command]
fn tool_stop(job: String, state: State<'_, AppState>) {
    state.jobs.stop(&job)
}

#[tauri::command]
async fn tool_ports(host: String, ports: Vec<u16>, timeout_ms: u64) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        nettools::check_ports(&host, ports, timeout_ms).map(|r| serde_json::to_value(r).unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
fn local_ips() -> serde_json::Value {
    serde_json::to_value(nettools::local_ips()).unwrap_or_default()
}

#[tauri::command(async)]
fn server_start(
    kind: String,
    port: u16,
    allow_write: Option<bool>,
    save: Option<bool>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let root = state.data_dir.join("tftp");
    match kind.as_str() {
        "tftp" => state.servers.start_tftp(app.clone(), root, port, allow_write.unwrap_or(false)),
        "http" => state.servers.start_http(app.clone(), root, port),
        "syslog" => state.servers.start_syslog(
            app.clone(),
            port,
            save.unwrap_or(false).then(|| state.data_dir.join("syslog")),
        ),
        _ => Err("Servidor desconocido".into()),
    }
}

#[tauri::command]
fn server_stop(kind: String, state: State<'_, AppState>) {
    state.servers.stop(&kind)
}

#[tauri::command]
fn server_running(state: State<'_, AppState>) -> Vec<String> {
    state.servers.running()
}

#[tauri::command(async)]
fn tftp_files(state: State<'_, AppState>) -> Vec<(String, u64)> {
    let dir = state.data_dir.join("tftp");
    let _ = std::fs::create_dir_all(&dir);
    let mut v: Vec<(String, u64)> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_file())
        .map(|e| (e.file_name().to_string_lossy().into_owned(), e.metadata().map(|m| m.len()).unwrap_or(0)))
        .collect();
    v.sort();
    v
}

/// Copia un archivo elegido por el usuario a la carpeta servida por TFTP/HTTP.
#[tauri::command(async)]
fn tftp_add(path: String, state: State<'_, AppState>) -> Result<String, String> {
    let src = std::path::PathBuf::from(&path);
    let name = src.file_name().ok_or("Ruta inválida")?.to_owned();
    let dir = state.data_dir.join("tftp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::copy(&src, dir.join(&name)).map_err(|e| e.to_string())?;
    Ok(name.to_string_lossy().into_owned())
}

/// MD5 de un archivo de la carpeta compartida (para verificar firmware en el equipo).
#[tauri::command]
async fn tftp_md5(name: String, app: tauri::AppHandle) -> Result<String, String> {
    let root = app.state::<AppState>().data_dir.join("tftp");
    let path = servers::safe_path(&root, &name).ok_or("Nombre inválido")?;
    tauri::async_runtime::spawn_blocking(move || {
        use md5::{Digest, Md5};
        use std::io::Read;
        let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
        let mut h = Md5::new();
        let mut buf = vec![0u8; 1 << 20];
        loop {
            let n = f.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            h.update(&buf[..n]);
        }
        Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn tftp_delete(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let root = state.data_dir.join("tftp");
    let path = servers::safe_path(&root, &name).ok_or("Nombre inválido")?;
    std::fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn device_run(conn: String, command: String, timeout_secs: u64, app: tauri::AppHandle) -> Result<String, String> {
    filexfer::run(app, conn, command, timeout_secs)
}

#[tauri::command(async)]
fn source_ip(host: String) -> Result<String, String> {
    filexfer::source_ip_for(&host)
}

/// Consulta el último release del repositorio de la app (latest.json firmado).
#[tauri::command]
async fn update_check(app: tauri::AppHandle) -> Result<updates::UpdateInfo, String> {
    updates::check(&app).await
}

/// Instala la versión encontrada en la última consulta y reinicia. Solo con confirmación.
#[tauri::command]
async fn update_install(app: tauri::AppHandle) -> Result<(), String> {
    updates::install(app).await
}

/// Repositorio desde el que se publica y actualiza la app (dueño/nombre).
#[tauri::command]
fn app_repo() -> &'static str {
    updates::repo()
}

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Guarda un texto (exportaciones de diagramas, tablas) en la ruta elegida por el usuario.
#[tauri::command(async)]
fn save_text(dest: String, content: String) -> Result<(), String> {
    let ok_ext = ["svg", "csv", "md", "mmd", "txt", "json", "drawio"];
    let ext = std::path::Path::new(&dest)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !ok_ext.contains(&ext.as_str()) {
        return Err(format!("Extensión no permitida: .{ext}"));
    }
    if content.len() > 10 * 1024 * 1024 {
        return Err("El archivo supera 10 MB".into());
    }
    std::fs::write(&dest, content).map_err(|e| e.to_string())
}

// ---------- Packs de comandos ----------

#[tauri::command(async)]
fn cmdpacks_list(state: State<'_, AppState>) -> Vec<serde_json::Value> {
    cmdpacks::list(&state.data_dir)
}

#[tauri::command(async)]
fn cmdpack_read(path: String) -> Result<serde_json::Value, String> {
    cmdpacks::read_external(&path)
}

#[tauri::command]
fn cmdpack_save(pack: serde_json::Value, state: State<'_, AppState>) -> Result<String, String> {
    cmdpacks::save(&state.data_dir, &pack)
}

#[tauri::command]
fn cmdpack_delete(id: String, state: State<'_, AppState>) -> Result<(), String> {
    cmdpacks::delete(&state.data_dir, &id)
}

#[tauri::command]
fn cmdpack_export(id: String, dest: String, state: State<'_, AppState>) -> Result<(), String> {
    cmdpacks::export(&state.data_dir, &id, &dest)
}

// ---------- Plugins ----------

#[tauri::command(async)]
fn plugins_list(state: State<'_, AppState>) -> serde_json::Value {
    serde_json::to_value(plugins::list(&state.data_dir)).unwrap_or_default()
}

#[tauri::command(async)]
fn plugin_stage(path: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    plugins::stage(&state.data_dir, std::path::Path::new(&path)).map(|p| serde_json::to_value(p).unwrap_or_default())
}

#[tauri::command(async)]
fn plugin_confirm(staging: String, state: State<'_, AppState>) -> Result<String, String> {
    plugins::confirm(&state.data_dir, &staging)
}

#[tauri::command]
fn plugin_cancel(staging: String, state: State<'_, AppState>) {
    plugins::cancel(&state.data_dir, &staging)
}

#[tauri::command(async)]
fn plugin_set_enabled(id: String, enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    plugins::set_enabled(&state.data_dir, &id, enabled)
}

#[tauri::command]
fn plugin_uninstall(id: String, state: State<'_, AppState>) -> Result<(), String> {
    plugins::uninstall(&state.data_dir, &id)
}

#[tauri::command(async)]
fn plugin_code(id: String, state: State<'_, AppState>) -> Result<String, String> {
    plugins::read_code(&state.data_dir, &id)
}

#[tauri::command(async)]
fn plugin_run(
    id: String,
    action: String,
    conn: Option<String>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    plugins::run(&state.scripts, app.clone(), &state.data_dir, &id, &action, conn)
}

#[tauri::command]
fn data_dir(state: State<'_, AppState>) -> String {
    state.data_dir.to_string_lossy().into_owned()
}

/// Los ajustes son de la UI: el backend solo los persiste como JSON opaco.
#[tauri::command(async)]
fn get_settings(state: State<'_, AppState>) -> serde_json::Value {
    let path = state.data_dir.join("settings.json");
    let Ok(content) = std::fs::read_to_string(&path) else {
        return serde_json::Value::Null;
    };
    serde_json::from_str(&content).unwrap_or_else(|_| {
        // Ajustes ilegibles: se respaldan antes de que la app los reemplace por los valores
        // por defecto, para no perder macros, monitores ni el token MCP.
        session_store::backup_corrupt(&path);
        serde_json::Value::Null
    })
}

#[tauri::command]
fn save_settings(settings: serde_json::Value, state: State<'_, AppState>) -> Result<(), String> {
    let path = state.data_dir.join("settings.json");
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    session_store::restrict(&tmp);
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Menú nativo de macOS sin "Cerrar ventana" (⌘W), que la app usa para cerrar pestañas.
#[cfg(target_os = "macos")]
fn macos_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem as P, Submenu};
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "NetTerminal",
                true,
                &[
                    &P::about(
                        app,
                        None,
                        Some(tauri::menu::AboutMetadata {
                            name: Some("NetTerminal".into()),
                            version: Some(env!("CARGO_PKG_VERSION").into()),
                            credits: Some("Creado por Nicolás Rivera\nVibecodeado con Claude Code".into()),
                            ..Default::default()
                        }),
                    )?,
                    &P::separator(app)?,
                    &MenuItem::with_id(app, "settings", "Ajustes…", true, Some("CmdOrCtrl+,"))?,
                    &P::separator(app)?,
                    &P::hide(app, None)?,
                    &P::hide_others(app, None)?,
                    &P::separator(app)?,
                    &P::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Edición",
                true,
                &[
                    &P::undo(app, None)?,
                    &P::redo(app, None)?,
                    &P::separator(app)?,
                    &P::cut(app, None)?,
                    &P::copy(app, None)?,
                    &P::paste(app, None)?,
                    &P::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(app, "Ventana", true, &[&P::minimize(app, None)?, &P::fullscreen(app, None)?])?,
        ],
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_menu_event(|app, event| {
            if event.id() == "settings" {
                let _ = app.emit("open-settings", ());
            }
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_menu(macos_menu(app.handle())?)?;
            let os_dir = app.path().app_config_dir()?;
            let data_dir = session_store::resolve_data_dir(os_dir);
            // Corrige permisos de archivos creados por versiones anteriores.
            for f in ["settings.json", "sessions.json"] {
                session_store::restrict(&data_dir.join(f));
            }
            app.manage(updates::Pending::default());
            app.manage(AppState {
                store: SessionStore::new(&data_dir),
                conns: ConnectionManager::default(),
                scripts: scripts::ScriptRunner::default(),
                mcp: mcp::McpServer::default(),
                monitor: monitor::Monitor::default(),
                jobs: nettools::Jobs::default(),
                servers: servers::Servers::default(),
                data_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_sessions,
            save_session,
            delete_session,
            update_sessions,
            list_serial_ports,
            connect,
            write,
            resize,
            disconnect,
            send_break,
            set_logging,
            open_dir,
            data_dir,
            get_settings,
            save_settings,
            list_notes,
            read_note,
            save_note,
            rename_note,
            delete_note,
            list_scripts,
            run_script,
            stop_script,
            mcp_configure,
            mcp_decide,
            monitor_start,
            monitor_stop,
            monitor_running,
            tool_traceroute,
            tool_iperf,
            tool_iperf_version,
            tool_speedtest,
            tool_stop,
            tool_ports,
            local_ips,
            server_start,
            server_stop,
            server_running,
            tftp_files,
            tftp_add,
            tftp_delete,
            tftp_md5,
            save_text,
            cmdpacks_list,
            cmdpack_read,
            cmdpack_save,
            cmdpack_delete,
            cmdpack_export,
            device_run,
            source_ip,
            app_version,
            update_check,
            update_install,
            app_repo,
            plugins_list,
            plugin_stage,
            plugin_confirm,
            plugin_cancel,
            plugin_set_enabled,
            plugin_uninstall,
            plugin_code,
            plugin_run
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar NetTerminal");
}
