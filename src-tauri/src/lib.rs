mod agents;
mod browser;
pub mod cli;
mod creatures;
mod git;
mod include;
mod keybindings;
mod names;
mod projects;
mod scm;
mod pty;
mod state;
mod sysmem;
mod terminal;
mod trust;

use state::Store;
use std::sync::Mutex;
use tauri::Manager;
use terminal::Terminals;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    profile_dir: String,
    start_count: u64,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle, store: tauri::State<'_, Mutex<Store>>) -> Result<AppInfo, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let start_count = store.get("start_count").map_err(|e| e.to_string())?.and_then(|v| v.parse().ok()).unwrap_or(0);
    let profile_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(AppInfo { version: app.package_info().version.to_string(), profile_dir: profile_dir.display().to_string(), start_count })
}

#[tauri::command]
fn get_settings(store: tauri::State<'_, Mutex<Store>>) -> Result<serde_json::Value, String> {
    Ok(store.lock().map_err(|e| e.to_string())?.settings())
}

#[tauri::command]
fn save_settings(store: tauri::State<'_, Mutex<Store>>, value: serde_json::Value) -> Result<(), String> {
    store.lock().map_err(|e| e.to_string())?.save_settings(&value).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let store = Store::open(&dir)?;
            let starts: u64 = store.get("start_count")?.and_then(|v| v.parse().ok()).unwrap_or(0) + 1;
            store.set("start_count", &starts.to_string())?;
            app.manage(Mutex::new(store));
            app.manage(Terminals::default());
            // Git is checked once here; every project and workspace action runs through it.
            app.manage(git::Git::detect()?);
            // The command line reaches the app through a loopback port (PROJ-077).
            cli::serve(app.handle().clone(), &dir)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // The window is gone: no shell may outlive it.
            if let tauri::WindowEvent::Destroyed = event {
                window.state::<Terminals>().kill_all();
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            get_settings,
            save_settings,
            sysmem::process_memory,
            terminal::terminal_spawn,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
            projects::git_version,
            projects::project_list,
            projects::project_add,
            projects::workspace_list,
            projects::workspace_preview,
            projects::workspace_create,
            projects::workspace_create_fresh,
            projects::workspace_remove,
            projects::project_set,
            agents::agent_list,
            agents::agent_start_line,
            trust::trust_folders_cmd,
            scm::scm_status,
            scm::scm_stage,
            scm::scm_commit, scm::scm_remote,
            keybindings::keybindings_read,
            projects::workspaces_place_get,
            projects::workspaces_place_set,
            browser::browser_open,
            browser::browser_bounds,
            browser::browser_navigate,
            browser::browser_go,
            browser::browser_close
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<Terminals>().kill_all();
                if let Ok(dir) = app.path().app_data_dir() {
                    let _ = std::fs::remove_file(dir.join(cli::FILE));
                }
            }
        });
}
