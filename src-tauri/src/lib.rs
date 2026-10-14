mod activity;
mod agents;
mod artifacts;
mod automations;
mod capture;
mod crash;
mod perms;
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
mod models;
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

#[tauri::command(async)]
fn app_info(app: tauri::AppHandle, store: tauri::State<'_, Mutex<Store>>) -> Result<AppInfo, String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let start_count = store.get("start_count").map_err(|e| e.to_string())?.and_then(|v| v.parse().ok()).unwrap_or(0);
    let profile_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(AppInfo { version: app.package_info().version.to_string(), profile_dir: profile_dir.display().to_string(), start_count })
}

#[tauri::command(async)]
fn get_settings(store: tauri::State<'_, Mutex<Store>>) -> Result<serde_json::Value, String> {
    // Secrets stay in the backend: the window never receives them (ACCT-009, ACCT-011).
    Ok(secrets::without_secrets(store.lock().map_err(|e| e.to_string())?.settings()))
}

/// Writes only the settings the window changed (`set`, and `remove` for ones it cleared) over what
/// is on disk, so a key Kolux itself wrote meanwhile (a printed pull request link) is kept.
#[tauri::command(async)]
fn settings_patch(app: tauri::AppHandle, store: tauri::State<'_, Mutex<Store>>, set: serde_json::Map<String, serde_json::Value>, remove: Vec<String>) -> Result<(), String> {
    write_settings(&app, &store, |old| state::patched(old, &set, &remove)).map(|_| ())
}

/// APP-011: the durable save point a restart, an update or a reload waits for; an error cancels it.
#[tauri::command(async)]
fn save_point(store: tauri::State<'_, Mutex<Store>>) -> Result<(), String> {
    store.lock().map_err(|e| e.to_string())?.save_point().map_err(|e| format!("Kolux could not save ({e}), so nothing was restarted."))
}

/// APP-006: how long a close request may go unanswered before the window's interface counts as
/// gone (crashed, or frozen solid) and the app quits without asking.
const CLOSE_ANSWER: std::time::Duration = std::time::Duration::from_secs(5);
/// APP-006: quitting finishes within this long whatever hangs; the final save has its own, shorter
/// deadline inside it (APP-050).
const QUIT_LIMIT: std::time::Duration = std::time::Duration::from_secs(10);

/// APP-006: close requests made (the first number) and answered by the window (the second).
#[derive(Default)]
struct Closing(std::sync::atomic::AtomicU32, std::sync::atomic::AtomicU32);

/// APP-006: set once a quit or restart has been asked for, so the last window closing on the way
/// out never holds the app open.
static QUIT_UNDER_WAY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// APP-006: whether the app stays running when it is asked to exit. `code` is None when the last
/// window closed and Some when a quit or restart asked. Only macOS keeps an app with no windows.
fn keeps_running(mac: bool, code: Option<i32>, quitting: bool) -> bool {
    mac && code.is_none() && !quitting
}

/// APP-006 on macOS: clicking the Dock icon of an app with no window opens a fresh main window.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn reopen_main(app: &tauri::AppHandle) {
    if app.webview_windows().is_empty() {
        if let Some(config) = app.config().app.windows.first() {
            if let Err(e) = tauri::WebviewWindowBuilder::from_config(app, config).and_then(|b| b.build()) {
                eprintln!("reopen: the window could not be made again: {e}");
            }
        }
    }
}

/// APP-006: the window's close handler heard the request (it then asks, or closes).
/// APP-021: what the startup check could not repair, for the window to name.
struct StartupProblems(Vec<String>);

#[tauri::command]
fn startup_problems(problems: tauri::State<'_, StartupProblems>) -> Vec<String> {
    problems.0.clone()
}

#[tauri::command]
fn close_heard(closing: tauri::State<'_, Closing>) {
    use std::sync::atomic::Ordering::SeqCst;
    closing.1.store(closing.0.load(SeqCst), SeqCst);
}

/// SET-035: one change, laid over what is stored while the store is held, so two saves in quick
/// succession never undo each other. Returns what was really stored, without its secrets.
#[tauri::command(async)]
fn patch_settings(app: tauri::AppHandle, store: tauri::State<'_, Mutex<Store>>, patch: serde_json::Value) -> Result<serde_json::Value, String> {
    write_settings(&app, &store, |old| secrets::patched(&old, patch)).map(secrets::without_secrets)
}

/// The settings `change` makes of what is on disk, written under one lock; returns what was stored.
fn write_settings(app: &tauri::AppHandle, store: &Mutex<Store>, change: impl FnOnce(serde_json::Value) -> serde_json::Value) -> Result<serde_json::Value, String> {
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
    // Views that depend on a setting (the lapsed sign-in notice, ACCT-012) read again, in every window.
    let _ = tauri::Emitter::emit(app, "settings-saved", ());
    Ok(value)
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
    let context = tauri::generate_context!();
    // APP-001: one copy per profile, settled before any window exists. A second launch hands over to
    // the first and exits with a code of its own, so no second window ever opens. The folder is the
    // one the app's path resolver gives (the roaming app data folder named by the identifier).
    let dir = std::env::var_os("APPDATA").map(std::path::PathBuf::from).unwrap_or_else(std::env::temp_dir).join(&context.config().identifier);
    let lock = match std::fs::create_dir_all(&dir).and_then(|_| cli::claim(&dir)) {
        Ok(Some(lock)) => Some(lock),
        Ok(None) => {
            cli::hand_over(&dir, std::time::Duration::from_secs(10));
            std::process::exit(cli::DUPLICATE_EXIT);
        }
        // ponytail: a profile the lock file cannot be made in still starts, unguarded.
        Err(_) => None,
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            if let Some(lock) = lock {
                app.manage(lock);
            }
            // APP-053: everything the app starts from here on ends with it; outside its own job (a job the
            // launcher owns without breakaway, say) the children would outlive a crash, so that is logged.
            let job_ok = procs::app_job_start();
            let dir = app.path().app_data_dir()?;
            diag::set_dir(&dir);
            if !job_ok {
                diag::write(&dir, "kolux-rs: the app could not be put in its own job object; child processes would survive a crash (APP-053)");
            }
            // The config homes this process resolved (defaults included), so a launch that inherited another
            // app's environment shows up in the log.
            diag::write(&dir, &format!("kolux-rs: config: CLAUDE_CONFIG_DIR={} CODEX_HOME={}", hooks::claude_settings_file().parent().map(|d| d.display().to_string()).unwrap_or_default(), trust::codex_config_file().parent().map(|d| d.display().to_string()).unwrap_or_default()));
            #[cfg(debug_assertions)]
            dev_inject()?;
            // APP-039: from here on a panic leaves a crash report for the next launch to offer.
            crash::install(dir.clone(), app.package_info().version.to_string());
            // APP-021: folders the app cannot write to and install files it cannot read are repaired
            // when they are the user's own; what stays broken is named in the window instead of
            // failing the launch.
            let checked = match std::env::current_exe() {
                Ok(exe) if cfg!(windows) => exe.parent().map(|i| perms::check(i, &dir)).unwrap_or_default(),
                _ => perms::Outcome::default(),
            };
            for r in &checked.repaired {
                secrets::log(&dir, &format!("permissions: {r}"));
            }
            let mut problems = checked.problems;
            let store = match Store::open(&dir) {
                Ok(store) => store,
                Err(e) => {
                    problems.push(format!("Kolux RS could not open its saved state in {} ({e}), so nothing this session changes is saved.", dir.display()));
                    Store::in_memory(&dir)?
                }
            };
            app.manage(StartupProblems(problems));
            if let Some(why) = &store.recovered {
                secrets::log(&dir, &format!("state: {why}"));
            }
            // APP-048: a damaged settings file keeps its good entries (the damaged copy is kept as .bad).
            if let Ok(true) = store.repair_settings() {
                secrets::log(&dir, "settings: settings.json was damaged; the readable entries were kept, the damaged copy is settings.json.bad");
            }
            skill_delete::recover(&dir); // SKILL-023: an interrupted skill delete is undone or completed.
            let starts: u64 = store.get("start_count")?.and_then(|v| v.parse().ok()).unwrap_or(0) + 1;
            store.set("start_count", &starts.to_string())?;
            // PROJ-074: what deleted workspaces left in their trash folders is cleared in the background.
            let trash = projects::trash_to_sweep(&store);
            let started = git::stamp_now();
            std::thread::spawn(move || trash.iter().for_each(|t| git::sweep_trash(t, started)));
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
            app.manage(Closing::default());
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
            terminal::read_login_env();
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
                // STAT-028: a cancelled turn that never sends its Stop reads interrupted.
                for status in status::settle_cancels() {
                    let _ = tauri::Emitter::emit(&handle, hooks::EVENT, status);
                }
                // STAT-032: a working reading with no signal for 30 minutes is marked unverified.
                for quiet in status::settle_unverified() {
                    let _ = tauri::Emitter::emit(&handle, "agent-unverified", quiet);
                }
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
            // APP-006: the window's own interface decides whether to ask before closing. If it does
            // not answer at all, it is gone, crashed or frozen solid, and the app quits anyway.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                use std::sync::atomic::Ordering::SeqCst;
                let n = window.state::<Closing>().0.fetch_add(1, SeqCst) + 1;
                let app = window.app_handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(CLOSE_ANSWER);
                    if app.state::<Closing>().1.load(SeqCst) < n {
                        eprintln!("close: the window did not answer within {CLOSE_ANSWER:?}; quitting");
                        app.exit(0);
                    }
                });
            }
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
            get_settings,
            patch_settings,
            save_point,
            close_heard,
            startup_problems,
            crash::crash_pending,
            crash::crash_newest,
            crash::crash_logs,
            crash::debug_crash,
            settings_patch,
            notify,
            notifications::notification_test,
            notifications::open_notification_settings,
            hooks::agent_hooks::agent_hooks_sync,
            hooks::agent_hooks::agent_hooks_file,
            hooks::agent_hooks::saved::agent_status_saved,
            hooks::agent_hooks::saved::agent_resumable,
            hooks::claude_usage,
            sysmem::process_memory,
            fonts::list_fonts,
            resources::resources,
            terminal::terminal_spawn,
            terminal::terminal_write,
            terminal::terminal_screen_reply,
            terminal::terminal_resize,
            terminal::terminal_ack,
            terminal::terminal_memory_profile,
            terminal::terminal_kill,
            terminal::terminal_layout,
            terminal::terminal_busy,
            terminal::terminal_diagnostics,
            terminal::terminal_history,
            terminal::terminal_forget_history,
            terminal::terminal_prune_history,
            terminal::terminal_history_append,
            status::agent_history,
            status::agent_answer,
            status::status_inband,
            activity::activity_counts,
            activity::activity_get,
            activity::activity_touch,
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
            projects::workspace_branch_delete,
            projects::workspace_cleanup_scan,
            projects::editor_sessions_get,
            projects::editor_sessions_save,
            projects::project_set,
            projects::workspaces_place_get,
            projects::workspaces_place_set,
            projects::git_first_commit_preview,
            projects::git_start,
            setup::workspace_setup,
            setup::setup_imports_list,
            setup::setup_import,
            agents::agent_list,
            models::agent_models,
            agents::agent_start_line,
            agents::open_install_page,
            agents::inventory::session_tabs,
            pty::shell_list,
            tools::tools_check,
            tools::tools_dismiss,
            token_usage::token_usage,
            token_usage::token_usage_scan,
            token_usage::token_tracking_set,
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
            scm::scm_commit, scm::scm_remote, scm::scm_push_target,
            scm::scm_pr, scm::scm_pr_checks, scm::scm_pr_create, scm::scm_open_pr,
            scm::scm_history, scm::scm_commit_files, scm::scm_github_repo,
            keybindings::keybindings_read,
            keybindings::keybindings_write,
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
            claude_accounts::claude_account_remove,
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
            codex_accounts::codex_account_label,
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
            files::file_stamp,
            files::file_write,
            files::file_stamps,
            files::file_pick,
            files::md_list,
            files::file_list,
            files::md_new,
            files::diff_sides,
            files::git_changes,
            files::change_entries,
            files::diff_image,
            files::dir_list,
            files::path_kind,
            artifacts::artifacts_list,
            artifacts::artifact_add,
            artifacts::artifact_remove,
            artifacts::open_external,
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
            usage_alerts::usage_alerts_fired,
            usage_alerts::usage_alert_send
        ])
        .build(context)
        .unwrap_or_else(|e| diag::fatal(&e.to_string()))
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { code, api, .. } = &event {
                use std::sync::atomic::Ordering::SeqCst;
                if code.is_some() {
                    QUIT_UNDER_WAY.store(true, SeqCst);
                }
                if keeps_running(cfg!(target_os = "macos"), *code, QUIT_UNDER_WAY.load(SeqCst)) {
                    api.prevent_exit();
                }
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows: false, .. } = &event {
                reopen_main(app);
            }
            if let tauri::RunEvent::Exit = event {
                // APP-006: whatever hangs below, the process is gone at the deadline.
                std::thread::spawn(|| {
                    std::thread::sleep(QUIT_LIMIT);
                    eprintln!("quit: still running after {QUIT_LIMIT:?}; exiting");
                    std::process::exit(0);
                });
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
                // APP-050: the final save, after any save in flight and before nothing else, on its own
                // thread so a stalled drive cannot hold the quit past the deadline.
                let handle = app.clone();
                let done = state::within(state::QUIT_DEADLINE, move || {
                    if let Ok(store) = handle.state::<Mutex<Store>>().lock() {
                        store.close();
                    }
                    if let Ok(dir) = handle.path().app_data_dir() {
                        diag::write(&dir, "app exit");
                        let _ = std::fs::remove_file(dir.join(cli::FILE));
                        let _ = std::fs::remove_file(dir.join(hooks::ENDPOINT_FILE));
                    }
                });
                if !done {
                    eprintln!("quit: the final save did not finish within {:?}; quitting without it", state::QUIT_DEADLINE);
                }
                // APP-025: an update that finished downloading installs as the app quits.
                update::install_on_quit(app);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// APP-006: closing the last window quits on Windows and Linux; on macOS the app keeps running,
    /// unless a quit is already under way.
    #[test]
    fn app006_only_macos_keeps_running_when_the_last_window_closes_and_a_quit_still_quits() {
        assert!(!keeps_running(false, None, false), "Windows and Linux: the last window closing quits");
        assert!(keeps_running(true, None, false), "macOS: the app stays in the dock");
        assert!(!keeps_running(true, None, true), "macOS: a quit under way finishes");
        assert!(!keeps_running(true, Some(0), false), "macOS: an explicit quit or restart finishes");
    }
}
