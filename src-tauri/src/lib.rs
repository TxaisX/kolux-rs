mod activity;
mod agents;
mod artifacts;
mod automations;
mod capture;
mod browser;
mod cap;
pub mod cli;
mod cli_accounts;
mod claude_accounts;
mod claude_key;
mod codex_accounts;
mod codex_usage;
mod creatures;
mod diag;
mod fence;
mod files;
mod fsops;
mod fonts;
mod git;
mod groups;
mod hooks;
mod include;
// T-043-e: the macOS keychain rule table; the Mac wiring that calls it is T-043-f.
#[cfg_attr(not(test), allow(dead_code))]
mod keychain;
mod grok;
mod install;
mod keybindings;
mod kits;
mod links;
mod names;
mod newproject;
mod notifications;
mod onboarding;
mod orchestration;
mod foreground;
mod procs;
mod protected;
mod resources;
mod projects;
mod scm;
mod pr_checkout;
mod pty;
mod setup;
mod routing;
mod schedule;
mod resume;
mod secrets;
mod skill_delete;
mod state;
mod status;
mod sysmem;
mod terminal;
#[cfg(test)]
mod test_dir;
mod tools;
mod token_usage;
mod trust;
mod update;
mod visibility;
mod usage_alerts;

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
    write_settings(&app, &store, |_| value)
}

/// Writes only the settings the window changed (`set`, and `remove` for ones it cleared) over what
/// is on disk, so a key Kolux itself wrote meanwhile (a printed pull request link) is kept.
#[tauri::command]
fn settings_patch(app: tauri::AppHandle, store: tauri::State<'_, Mutex<Store>>, set: serde_json::Map<String, serde_json::Value>, remove: Vec<String>) -> Result<(), String> {
    write_settings(&app, &store, |old| state::patched(old, &set, &remove))
}

/// The settings `change` makes of what is on disk, written under one lock.
fn write_settings(app: &tauri::AppHandle, store: &Mutex<Store>, change: impl FnOnce(serde_json::Value) -> serde_json::Value) -> Result<(), String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let old = store.settings();
    // The window cannot write a secret field; the sealed values on disk are kept as they are.
    let value = secrets::keep_stored_secrets(&old, change(old.clone()));
    let before = old.get(resume::FIELD) == Some(&serde_json::Value::Bool(true));
    store.save_settings(&value).map_err(|e| e.to_string())?;
    drop(store);
    // USAGE-007: off discards the waits, on picks up the panes already stopped on a limit.
    let after = value.get(resume::FIELD) == Some(&serde_json::Value::Bool(true));
    if before != after {
        resume::switched(app, after);
    }
    // Views that depend on a setting (the lapsed sign-in notice, ACCT-012) read again.
    let _ = tauri::Emitter::emit(app, "settings-saved", ());
    Ok(())
}

/// A desktop notification (STAT-041). The window decides when one is due and with which words.
#[tauri::command]
fn notify(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())
}

/// The minutes of silence before a working agent is reported quiet; 10 by default, 0 is off
/// (STAT-045, settings key `quietMinutes`).
fn quiet_minutes(store: &Mutex<Store>) -> u64 {
    let settings = store.lock().map(|s| s.settings()).unwrap_or_default();
    settings.get("quietMinutes").and_then(|v| v.as_f64()).map(|m| m.max(0.0) as u64).unwrap_or(10)
}

/// APP-003 proof, dev builds only: KOLUX_DEV_INJECT=startup fails the launch before the window
/// opens, =background panics a background thread a few seconds in.
#[cfg(debug_assertions)]
fn dev_inject() -> Result<(), String> {
    match std::env::var("KOLUX_DEV_INJECT").as_deref() {
        Ok("startup") => Err("KOLUX_DEV_INJECT=startup: a failure injected before the window opens".into()),
        Ok("background") => {
            std::thread::spawn(|| {
                std::thread::sleep(std::time::Duration::from_secs(3));
                panic!("KOLUX_DEV_INJECT=background: a failure injected into background work");
            });
            Ok(())
        }
        _ => Ok(()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    diag::catch_panics();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // APP-053: everything the app starts from here on ends with it; outside its own job (a job the
            // launcher owns without breakaway, say) the children would outlive a crash, so that is logged.
            if !procs::app_job_start() {
                eprintln!("kolux-rs: the app could not be put in its own job object; child processes would survive a crash (APP-053)");
            }
            // The config homes this process resolved (defaults included), so a launch that inherited another
            // app's environment shows up in the log.
            eprintln!("kolux-rs: config: CLAUDE_CONFIG_DIR={} CODEX_HOME={}", hooks::claude_settings_file().parent().map(|d| d.display().to_string()).unwrap_or_default(), trust::codex_config_file().parent().map(|d| d.display().to_string()).unwrap_or_default());
            let dir = app.path().app_data_dir()?;
            diag::set_dir(&dir);
            #[cfg(debug_assertions)]
            dev_inject()?;
            let store = Store::open(&dir)?;
            skill_delete::recover(&dir); // SKILL-023: an interrupted skill delete is undone or completed.
            let starts: u64 = store.get("start_count")?.and_then(|v| v.parse().ok()).unwrap_or(0) + 1;
            store.set("start_count", &starts.to_string())?;
            onboarding::first_start(&store, starts)?;
            // USAGE-011: last run's activity counts, before any pane reports.
            activity::start(&store);
            // ACCT-010: a key this computer can no longer open is cleared before the window asks.
            secrets::drop_unreadable(&store, &dir);
            app.manage(Mutex::new(store));
            app.manage(links::Grants::default());
            // APP-041: the app's own start-and-stop record, next to what the terminals report.
            diag::write(&dir, &format!("app start {starts}, Kolux RS {}", app.package_info().version));
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
            app.manage(resume::Registry::default());
            app.manage(claude_key::KeySetup::default());
            app.manage(claude_accounts::SignIns::default());
            app.manage(codex_accounts::SignIns::default());
            app.manage(install::Installs::default());
            app.manage(grok::GrokSignIn::default());
            app.manage(artifacts::Library::new(dir.join("artifacts")));
            // Pages Claude sessions publish are kept in the library as they happen (SKILL-035).
            capture::start(app.handle().clone());
            app.manage(update::Updates::default());
            // Git is checked once here; every project and workspace action runs through it. Without
            // Git the app still opens, and the landing screen says so (APP-023).
            app.manage(git::Git::detect().unwrap_or(git::Git { version: String::new() }));
            projects::forget_gone_at_start(app.handle().clone()); // APP-051
            app.manage(tools::Cache::default());
            // ACCT-055: picked-file grants saved by the last run come back.
            let fence = fence::Fence::load(&app.state::<Mutex<Store>>());
            app.manage(fence);
            app.manage(token_usage::Flights::default());
            // The command line reaches the app through a loopback port (PROJ-077).
            cli::serve(app.handle().clone(), &dir)?;
            // AUTO-001: the automations clock.
            automations::start_clock(app.handle().clone());
            // Agents report their status through hooks (STAT-001): the listener, then the scripts
            // and each found, switched-on agent's entries (STAT-004), off the launch path.
            // STAT-006 / STAT-030: the last run's statuses, with what hooks held while Kolux was
            // closed, are read before the listener opens.
            if let Ok(store) = app.state::<Mutex<Store>>().lock() {
                hooks::agent_hooks::saved::startup(&store, &dir);
            }
            let hooks = hooks::serve(app.handle().clone(), &dir)?;
            app.manage(hooks);
            let settings = app.state::<Mutex<Store>>().lock().map(|s| s.settings()).unwrap_or_default();
            let profile = dir.clone();
            std::thread::spawn(move || {
                hooks::agent_hooks::sync(&settings, &profile);
            });
            // Shortly after the first window: seal anything older still in the clear and limit
            // the profile folder to this user (ACCT-009). Never delays or stops the launch.
            let handle = app.handle().clone();
            let log_dir = dir.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(2));
                secrets::sealing_pass(&handle.state::<Mutex<Store>>(), &dir);
            });
            // USAGE-007: the resumes the previous run left waiting, then the timer that types them.
            if let Ok(store) = app.state::<Mutex<Store>>().lock() {
                resume::restore_from(app.handle(), &store);
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(15));
                resume::tick(&handle, &log_dir);
            });
            // ACCT-050: an agent started by hand in a shell pane is recognised within a few seconds.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(2));
                foreground::poll(&handle);
            });
            // USAGE-011: changed activity counts are saved in batches.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(5));
                activity::save(&handle.state::<Mutex<Store>>(), false);
            });
            // STAT-045: a working agent that prints nothing for the chosen minutes is reported once
            // per silent spell. Silence is the terminal's own output, never the hooks.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(15));
                let minutes = quiet_minutes(&handle.state::<Mutex<Store>>());
                let threshold = (minutes > 0).then(|| std::time::Duration::from_secs(minutes * 60));
                let terminals = handle.state::<Terminals>();
                for pane_key in status::quiet_check(threshold, |id| terminals.silence(id)) {
                    let _ = tauri::Emitter::emit(&handle, "agent-quiet", status::Quiet { pane_key, minutes });
                }
            });
            Ok(())
        })
        // The Artifacts viewer (SKILL-036) loads stored pages through this scheme, one entry at a time.
        // T-500: only the app's own web view may read artifacts; a Browser pane page gets nothing.
        .register_uri_scheme_protocol(artifacts::SCHEME, |ctx, req| {
            if ctx.webview_label() != "main" {
                return tauri::http::Response::builder().status(403).body(b"not for this page".to_vec()).unwrap_or_default();
            }
            artifacts::serve(&ctx.app_handle().state::<artifacts::Library>(), &req)
        })
        .on_window_event(|window, event| {
            // The window is gone: no shell may outlive it.
            if let tauri::WindowEvent::Destroyed = event {
                window.state::<Terminals>().kill_all();
            }
            // ACCT-055: files dropped in from outside may be copied into the Explorer, nothing else.
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                window.state::<fence::Fence>().dropped(paths);
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            notifications::notification_test,
            notifications::open_notification_settings,
            get_settings,
            save_settings,
            settings_patch,
            hooks::agent_hooks::agent_hooks_sync,
            hooks::agent_hooks::agent_hooks_file,
            hooks::agent_hooks::saved::agent_status_saved,
            hooks::agent_hooks::saved::agent_resumable,
            notify,
            sysmem::process_memory,
            fonts::list_fonts,
            resources::resources,
            terminal::terminal_spawn,
            terminal::terminal_write,
            terminal::terminal_screen_reply,
            status::agent_history,
            activity::activity_counts,
            status::agent_answer,
            terminal::terminal_resize,
            terminal::terminal_ack,
            terminal::terminal_memory_profile,
            terminal::terminal_kill,
            terminal::terminal_layout,
            projects::git_version,
            projects::project_list,
            projects::project_add,
            projects::workspace_list,
            projects::workspace_preview,
            projects::workspace_create,
            projects::workspace_create_cancel,
            projects::workspace_prs,
            projects::workspace_open_pr,
            projects::workspace_from_item,
            projects::workspace_items,
            projects::workspace_item,
            setup::workspace_setup,
            setup::setup_imports_list,
            setup::setup_import,
            projects::workspace_set_parent,
            projects::workspace_branches,
            projects::workspace_open_branch,
            projects::workspace_unseen,
            projects::workspace_seen,
            projects::workspace_hide,
            projects::workspace_rename,
            projects::workspace_sleep,
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
            tools::tools_check,
            tools::tools_dismiss,
            token_usage::token_usage,
            token_usage::token_usage_scan,
            token_usage::token_tracking_set,
            agents::agent_start_line,
            trust::trust_folders_cmd,
            scm::scm_status,
            scm::scm_watch, scm::scm_unwatch,
            scm::scm_pushed, scm::scm_head, scm::scm_summary, scm::scm_abort,
            scm::scm_merge_info,
            scm::scm_merge,
            scm::scm_gh_budget,
            scm::scm_tasks_search,
            scm::scm_gh_account,
            scm::scm_prs_poll,
            scm::scm_commit_message,
            scm::scm_commit_message_stop,
            scm::scm_task_detail,
            scm::scm_repo_labels,
            scm::scm_task_labels,
            scm::scm_task_body,
            scm::scm_stage,
            scm::scm_discard,
            scm::scm_commit, scm::scm_remote,
            scm::scm_pr, scm::scm_pr_checks, scm::scm_pr_create, scm::scm_open_pr,
            scm::scm_history, scm::scm_commit_files, scm::scm_github_repo,
            terminal::terminal_busy,
            terminal::terminal_diagnostics,
            terminal::terminal_history,
            terminal::terminal_forget_history,
            terminal::terminal_prune_history,
            terminal::terminal_history_append,
            keybindings::keybindings_read,
            keybindings::keybindings_write,
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
            secrets::secrets_dropped,
            secrets::secrets_dropped_dismiss,
            secrets::secret_set,
            secrets::secret_clear,
            codex_usage::codex_usage,
            hooks::claude_usage,
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
            projects::git_first_commit_preview,
            projects::git_start,
            activity::activity_get,
            activity::activity_touch,
            groups::groups_get,
            groups::group_create,
            groups::group_rename,
            groups::group_nest,
            groups::group_put,
            groups::group_delete,
            newproject::clone_suggest,
            newproject::project_clone,
            newproject::clone_cancel,
            newproject::project_new_defaults,
            newproject::project_create,
            kits::kit_samples,
            kits::kit_samples_dir,
            kits::kit_check,
            kits::kit_prepare,
            kits::kit_open_results,
            kits::kit_collect,
            kits::kit_history,
            kits::kit_open_file,
            onboarding::onboarding_get,
            onboarding::onboarding_step,
            onboarding::onboarding_close,
            onboarding::onboarding_reopen,
            onboarding::onboarding_milestone,
            files::file_read,
            files::file_write,
            files::file_pick,
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
            links::open_path, links::file_grant,
            fsops::fs_create,
            fsops::fs_rename,
            fsops::fs_trash,
            fsops::fs_restore,
            fsops::fs_copy,
            fsops::fs_move,
            fsops::clip_write,
            diag::diag_bundle,
            diag::diag_review,
            diag::diag_review_discard,
            update::update_status,
            update::update_mark,
            update::update_check,
            update::update_download,
            update::update_restart,
            claude_accounts::claude_account_remove,
            codex_accounts::codex_account_label,
            usage_alerts::usage_alerts_fired,
            usage_alerts::usage_alert_send
        ])
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| diag::fatal(&e.to_string()))
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // USAGE-011: open turns end and the counts are written; no batched save follows.
                activity::save(&app.state::<Mutex<Store>>(), true);
                // STAT-037: the agents still mid-task are recorded before their terminals end.
                if let Ok(store) = app.state::<Mutex<Store>>().lock() {
                    hooks::agent_hooks::saved::at_quit(&store);
                }
                // ACCT-015: no sign-in or install keeps running after Kolux quits.
                claude_key::cancel_all(std::time::Duration::from_secs(2));
                // ACCT-025: sign-ins the agents renewed are sealed again, Codex's then Claude's,
                // each step given two seconds. Settings need no step: every change is already on disk.
                if let (Ok(profile), Ok(store)) = (app.path().app_data_dir(), app.state::<Mutex<Store>>().lock()) {
                    let steps = [codex_accounts::sign_in_files(&store, &profile), claude_accounts::sign_in_files(&store, &profile)];
                    drop(store);
                    for pairs in steps {
                        let p = profile.clone();
                        let _ = secrets::within(std::time::Duration::from_secs(2), move || secrets::save_changed(&pairs, &p));
                    }
                }
                app.state::<Terminals>().kill_all();
                if let Ok(dir) = app.path().app_data_dir() {
                    diag::write(&dir, "app exit");
                    let _ = std::fs::remove_file(dir.join(cli::FILE));
                    let _ = std::fs::remove_file(dir.join(hooks::ENDPOINT_FILE));
                }
                // APP-025: an update that finished downloading installs as the app quits.
                update::install_on_quit(app);
            }
        });
}
