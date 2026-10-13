mod connection;
mod expect;
mod mcp;
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

#[tauri::command]
fn list_serial_ports() -> Vec<SerialPortInfo> {
    connection::list_serial_ports()
}

/// Asíncrono para no bloquear la UI mientras Telnet resuelve/conecta.
#[tauri::command]
async fn connect(
    id: String,
    session: Session,
    cols: u16,
    rows: u16,
    on_data: Channel<InvokeResponseBody>,
    on_exit: Channel<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
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
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    state
        .conns
        .set_logging(&id, enabled, timestamps.unwrap_or(false), &state.logs_dir())
}

/// Abre la carpeta de logs ("logs") o la de datos ("data") en el explorador del sistema.
#[tauri::command]
fn open_dir(which: String, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let dir = match which.as_str() {
        "logs" => state.logs_dir(),
        "notes" => state.notes_dir(),
        "scripts" => scripts::scripts_dir(&state.data_dir),
        _ => state.data_dir.clone(),
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_notes(state: State<'_, AppState>) -> Vec<notes::NoteInfo> {
    notes::list(&state.notes_dir())
}

#[tauri::command]
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

#[tauri::command]
fn list_scripts(state: State<'_, AppState>) -> Vec<String> {
    scripts::list(&state.data_dir)
}

#[tauri::command]
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

#[tauri::command]
fn data_dir(state: State<'_, AppState>) -> String {
    state.data_dir.to_string_lossy().into_owned()
}

/// Los ajustes son de la UI: el backend solo los persiste como JSON opaco.
#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> serde_json::Value {
    std::fs::read_to_string(state.data_dir.join("settings.json"))
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or(serde_json::Value::Null)
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
                    &P::about(app, None, None)?,
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
            app.manage(AppState {
                store: SessionStore::new(&data_dir),
                conns: ConnectionManager::default(),
                scripts: scripts::ScriptRunner::default(),
                mcp: mcp::McpServer::default(),
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
            mcp_decide
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar NetTerminal");
}
