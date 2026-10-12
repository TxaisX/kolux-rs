mod agents;
mod artifacts;
mod automations;
mod capture;
mod browser;
pub mod cli;
mod claude_accounts;
mod claude_key;
mod codex_accounts;
mod codex_usage;
mod creatures;
mod files;
mod fsops;
mod git;
mod include;
mod grok;
mod install;
mod keybindings;
mod names;
mod orchestration;
mod procs;
mod resources;
mod projects;
mod scm;
mod pty;
mod routing;
mod schedule;
mod secrets;
mod state;
mod sysmem;
mod terminal;
mod trust;
mod update;
mod visibility;

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
    // Secrets stay in the backend: the window never receives them (ACCT-009, ACCT-011).
    Ok(secrets::without_secrets(store.lock().map_err(|e| e.to_string())?.settings()))
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, store: tauri::State<'_, Mutex<Store>>, value: serde_json::Value) -> Result<(), String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    // The window cannot write a secret field; the sealed values on disk are kept as they are.
    let value = secrets::keep_stored_secrets(&store.settings(), value);
    store.save_settings(&value).map_err(|e| e.to_string())?;
    // Views that depend on a setting (the lapsed sign-in notice, ACCT-012) read again.
    let _ = tauri::Emitter::emit(&app, "settings-saved", ());
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let store = Store::open(&dir)?;
            let starts: u64 = store.get("start_count")?.and_then(|v| v.parse().ok()).unwrap_or(0) + 1;
            store.set("start_count", &starts.to_string())?;
            app.manage(Mutex::new(store));
            // SET-004: the window starts hidden and the page shows it once its first frame has the saved
            // look; this is the backstop for a page that never gets that far.
            if let Some(w) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    let _ = w.show();
                });
            }
            app.manage(Terminals::default());
            app.manage(resources::Sampler::default());
            app.manage(claude_key::KeySetup::default());
            app.manage(claude_accounts::SignIns::default());
            app.manage(codex_accounts::SignIns::default());
            app.manage(install::Installs::default());
            app.manage(grok::GrokSignIn::default());
            app.manage(artifacts::Library::new(dir.join("artifacts")));
            // Pages Claude sessions publish are kept in the library as they happen (SKILL-035).
            capture::start(app.handle().clone());
            app.manage(update::Updates::default());
            // Git is checked once here; every project and workspace action runs through it.
            app.manage(git::Git::detect()?);
            // The command line reaches the app through a loopback port (PROJ-077).
            cli::serve(app.handle().clone(), &dir)?;
            // AUTO-001: the automations clock.
            automations::start_clock(app.handle().clone());
            // Shortly after the first window: seal anything older still in the clear and limit
            // the profile folder to this user (ACCT-009). Never delays or stops the launch.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(2));
                secrets::sealing_pass(&handle.state::<Mutex<Store>>(), &dir);
            });
            Ok(())
        })
        // The Artifacts viewer (SKILL-036) loads stored pages through this scheme, one entry at a time.
        .register_uri_scheme_protocol(artifacts::SCHEME, |ctx, req| artifacts::serve(&ctx.app_handle().state::<artifacts::Library>(), &req))
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
            resources::resources,
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
            projects::workspace_branches,
            projects::workspace_open_branch,
            projects::workspace_unseen,
            projects::workspace_seen,
            projects::workspace_hide,
            projects::visibility_get,
            projects::visibility_set,
            projects::visibility_root_add,
            projects::visibility_root_remove,
            projects::workspace_note_get,
            projects::workspace_note_save,
            projects::branch_prefix_check,
            projects::workspace_create_fresh,
            projects::handoff_note_prepare,
            projects::workspace_remove,
            projects::workspace_remove_check,
            projects::project_set,
            agents::agent_list,
            pty::shell_list,
            agents::agent_start_line,
            trust::trust_folders_cmd,
            scm::scm_status, scm::scm_summary,
            scm::scm_stage,
            scm::scm_commit, scm::scm_remote,
            terminal::terminal_busy,
            keybindings::keybindings_read,
            projects::workspaces_place_get,
            projects::workspaces_place_set,
            browser::browser_open,
            browser::browser_bounds,
            browser::browser_navigate,
            browser::browser_go,
            browser::browser_close,
            automations::automations_list,
            automations::automation_set_enabled,
            automations::automation_delete,
            automations::automation_run_now,
            automations::automation_preview,
            automations::automation_save,
            routing::routing_catalog,
            secrets::secret_status,
            secrets::secret_set,
            secrets::secret_clear,
            codex_usage::codex_usage,
            claude_key::claude_key_status,
            claude_key::claude_key_connect,
            claude_key::claude_key_cancel,
            claude_key::claude_key_disconnect,
            claude_accounts::claude_accounts,
            claude_accounts::claude_account_sign_in,
            claude_accounts::claude_account_cancel,
            claude_accounts::claude_account_activate,
            claude_accounts::claude_account_check,
            claude_accounts::claude_own_sign_in,
            agents::open_install_page,
            install::agent_installs,
            install::agent_can_install,
            install::agent_install,
            install::agent_install_cancel,
            install::agent_install_dismiss,
            grok::grok_status,
            grok::grok_sign_in,
            grok::grok_cancel,
            grok::grok_key_set,
            codex_accounts::codex_accounts,
            codex_accounts::codex_account_sign_in,
            codex_accounts::codex_account_cancel,
            codex_accounts::codex_account_activate,
            codex_accounts::codex_account_remove,
            files::file_read,
            files::file_write,
            files::md_list,
            artifacts::artifacts_list,
            artifacts::artifact_add,
            artifacts::artifact_remove,
            artifacts::open_external,
            files::file_list,
            files::md_new,
            files::diff_sides,
            files::git_changes,
            files::change_entries,
            files::diff_image,
            files::dir_list,
            files::path_kind,
            fsops::fs_create,
            fsops::fs_rename,
            fsops::fs_trash,
            fsops::fs_restore,
            fsops::fs_copy,
            fsops::fs_move,
            fsops::clip_write,
            update::update_status,
            update::update_mark,
            update::update_check,
            update::update_download,
            update::update_restart
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // ACCT-015: no sign-in or install keeps running after Kolux quits.
                claude_key::cancel_all(std::time::Duration::from_secs(2));
                app.state::<Terminals>().kill_all();
                if let Ok(dir) = app.path().app_data_dir() {
                    let _ = std::fs::remove_file(dir.join(cli::FILE));
                }
                // APP-025: an update that finished downloading installs as the app quits.
                update::install_on_quit(app);
            }
        });
}
