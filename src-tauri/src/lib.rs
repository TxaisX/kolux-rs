mod activity;
mod agents;
mod artifacts;
mod automations;
mod awake;
mod capture;
mod chat;
mod chat_tools;
mod clipboard;
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
mod editor_search;
mod fence;
mod files;
mod fsops;
mod fonts;
mod git;
mod github;
mod groups;
mod hooks;
mod include;
mod import;
// T-043-e: the macOS keychain rule table; the Mac wiring that calls it is T-043-f.
#[cfg_attr(not(test), allow(dead_code))]
mod keychain;
mod grok;
mod install;
mod keybindings;
mod kits;
mod links;
mod menu;
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
mod skills;
mod pr_checkout;
mod pty;
mod setup;
mod routing;
mod schedule;
mod resume;
mod secrets;
mod sessions;
mod shell_history;
mod skill_delete;
mod state;
mod status;
mod sysmem;
mod terminal;
#[cfg(test)]
mod test_dir;
mod tools;
mod token_usage;
mod tray;
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

/// A desktop notification (STAT-041). The window decides when one is due and with which words, and
/// (STAT-043) whether the system's own sound plays with it: `sound` is false when Kolux plays its
/// own tone or file instead, or the volume is 0.
#[tauri::command]
fn notify(app: tauri::AppHandle, title: String, body: String, sound: Option<bool>) -> Result<(), String> {
    notifications::show(&app, title, body, sound.unwrap_or(true))
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
    // T-552: the config's windows are opened by tools::guarded_setup instead, which waits out a
    // quitting Kolux whose WebView2 processes still hold the profile folder, and turns any setup
    // failure into a plain native message instead of a panic.
    let mut context = tauri::generate_context!();
    let windows: Vec<String> = context.config().app.windows.iter().filter(|w| w.create).map(|w| w.label.clone()).collect();
    for w in &mut context.config_mut().app.windows {
        w.create = false;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| tools::guarded_setup(app, &windows, |app| {
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
            let store = Store::open(&dir)?;
            // SKILL-023: an interrupted skill delete is undone or completed under the skill lock (a busy
            // lock or a lock that cannot be opened is logged; the latter still recovers).
            skill_delete::startup_recover(&dir);
            let starts: u64 = store.get("start_count")?.and_then(|v| v.parse().ok()).unwrap_or(0) + 1;
            store.set("start_count", &starts.to_string())?;
            onboarding::first_start(&store, starts)?;
            // USAGE-011: last run's activity counts, before any pane reports.
            activity::start(&store);
            // ACCT-010: a key this computer can no longer open is cleared before the window asks.
            secrets::drop_unreadable(&store, &dir);
            app.manage(Mutex::new(store));
            // TERM-122: the keep-awake watcher reads the saved choice every tick, and counts a
            // working pane only while its terminal is still running.
            {
                let (h, t) = (app.handle().clone(), app.handle().clone());
                awake::start(
                    move || h.state::<Mutex<Store>>().lock().map(|s| s.settings()).unwrap_or_default(),
                    move |id| t.try_state::<Terminals>().is_some_and(|ts| ts.started(id).is_some()),
                );
            }
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
            notifications::first_run_welcome(app.handle()); // VIEW-111: a Mac's one welcome notification
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
        }))
        // The Artifacts viewer (SKILL-036) loads stored pages through this scheme, one entry at a time.
        // T-500: only the app's own web view may read artifacts; a Browser pane page gets nothing.
        .register_uri_scheme_protocol(artifacts::SCHEME, |ctx, req| {
            if ctx.webview_label() != "main" {
                return tauri::http::Response::builder().status(403).body(b"not for this page".to_vec()).unwrap_or_default();
            }
            artifacts::serve(&ctx.app_handle().state::<artifacts::Library>(), &req)
        })
        // T-033-e (FIX-1): a reload of the main page (F5 / Ctrl+R) destroys no window, and the old
        // page never gets to release its git watches, so they are all let go as the new page starts
        // loading (the new page subscribes afresh); at the first load there is nothing to let go.
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                scm::watch::unwatch_all();
            }
        })
        .on_window_event(|window, event| {
            // The window is gone: no shell may outlive it.
            // T-546-c: only the main window holds shells, so the Tower's own window closing changes nothing;
            // the Tower window goes with the main one, so it never keeps the app running on its own.
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    window.state::<Terminals>().kill_all();
                    // T-033-e: no git watch outlives the window either (nothing is waited for here).
                    scm::watch::unwatch_all();
                    if let Some(t) = window.app_handle().get_webview_window("tower") {
                        let _ = t.close();
                    }
                }
            }
            // ACCT-055: files dropped in from outside may be copied into the Explorer, nothing else.
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                window.state::<fence::Fence>().dropped(paths);
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            get_settings,
            settings_patch,
            notify,
            notifications::notification_test,
            notifications::notification_sound_load,
            notifications::open_notification_settings,
            hooks::agent_hooks::agent_hooks_sync,
            hooks::agent_hooks::agent_hooks_file,
            hooks::agent_hooks::saved::agent_status_saved,
            hooks::agent_hooks::saved::agent_resumable,
            protected::protected_rules,
            hooks::claude_usage,
            sysmem::process_memory,
            fonts::list_fonts,
            resources::resources,
            sessions::claude_workspace_sessions,
            terminal::terminal_spawn,
            terminal::terminal_write,
            chat::chat_support,
            chat::chat_read,
            chat::chat_close,
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
            activity::activity_timeline,
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
            projects::workspace_suggest_name,
            projects::project_icons_list,
            projects::project_icon_set,
            projects::project_auto_icon,
            setup::setup_suggestion,
            setup::setup_suggestion_save,
            setup::setup_suggestion_dismiss,
            setup::repo_setup_get,
            setup::repo_setup_save,
            setup::repo_setup_remove,
            setup::repo_setup_policy_set,
            setup::repo_setup_wait_set,
            projects::handoff_note_prepare,
            projects::workspace_remove,
            projects::workspace_remove_check,
            projects::project_set,
            projects::workspaces_place_get,
            projects::workspaces_place_set,
            projects::git_first_commit_preview,
            projects::git_start,
            setup::workspace_setup,
            setup::workspace_issue_command,
            setup::script_trust_needed,
            setup::script_trust_grant,
            setup::setup_imports_list,
            setup::setup_import,
            agents::agent_list,
            agents::agent_start_line,
            agents::open_install_page,
            agents::inventory::session_tabs,
            orchestration::task_reset,
            pty::shell_list,
            tools::tools_check,
            tools::tools_dismiss,
            tools::editors_list,
            tools::teams_host,
            awake::keep_awake_state,
            token_usage::token_usage,
            token_usage::token_usage_scan,
            token_usage::token_tracking_set,
            trust::trust_folders_cmd,
            scm::scm_status, scm::scm_reveal,
            scm::scm_watch, scm::scm_unwatch,
            scm::scm_base_changes, scm::scm_base_sides,
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
            github::github_repo_parent,
            github::github_people,
            github::github_project,
            github::github_projects,
            github::github_project_set,
            github::github_issue_state,
            github::github_issue_comment,
            github::github_issue_create,
            scm::scm_task_labels,
            scm::scm_task_body,
            scm::scm_stage,
            scm::scm_discard,
            scm::scm_commit, scm::scm_remote,
            scm::scm_pr, scm::scm_pr_checks, scm::scm_pr_create, scm::scm_open_pr,
            scm::scm_history, scm::scm_commit_files, scm::scm_github_repo,
            keybindings::keybindings_read,
            menu::menu_sync, menu::menu_popup,
            keybindings::keybindings_write,
            keybindings::keybindings_reload,
            keybindings::keybindings_show,
            browser::browser_open,
            browser::browser_bounds,
            browser::browser_navigate,
            browser::browser_go,
            browser::browser_close,
            browser::browser_probe,
            browser::browser_diagnose,
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
            onboarding::guide_get,
            onboarding::guide_mark,
            onboarding::cli_status,
            onboarding::tours_get,
            onboarding::onboarding_reopen,
            onboarding::onboarding_milestone,
            files::file_read,
            files::file_write,
            files::file_stamps,
            files::file_pick,
            files::md_list,
            editor_search::editor_search,
            editor_search::editor_search_cancel,
            skills::skills_scan,
            skill_delete::skills_delete_plan,
            skill_delete::skills_delete,
            skills::skills_reveal,
            files::open_in,
            files::file_list,
            files::md_new,
            files::md_templates,
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
            links::open_path, links::file_grant, links::editor_open,
            fsops::fs_create,
            fsops::fs_rename,
            fsops::fs_trash,
            fsops::fs_restore,
            fsops::fs_copy,
            fsops::fs_move,
            fsops::clip_write,
            clipboard::clip_copy_text,
            clipboard::clip_copy_files,
            clipboard::feedback_facts,
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
        .unwrap_or_else(|e| tools::startup_failed(&e.to_string()))
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
                // T-552: the window's WebView2 processes let go of the profile folder before the app
                // ends (up to 3 s), so a relaunch right after finds it free.
                let webviews_left = tools::wait_webviews_closed();
                if let Ok(dir) = app.path().app_data_dir() {
                    if webviews_left > 0 {
                        diag::write(&dir, &format!("app exit: {webviews_left} WebView2 process(es) still running after 3 s (T-552)"));
                    }
                    diag::write(&dir, "app exit");
                    let _ = std::fs::remove_file(dir.join(cli::FILE));
                    let _ = std::fs::remove_file(dir.join(hooks::ENDPOINT_FILE));
                }
                // APP-025: an update that finished downloading installs as the app quits.
                update::install_on_quit(app);
            }
        });
}
