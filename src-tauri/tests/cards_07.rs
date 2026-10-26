//! spec/07 accounts and keys (ACCT-004, 005, 007, 012, 013). Needs `claude_key`, `claude_accounts`,
//! `codex_accounts` and `secrets` public in lib.rs. Every sign-in file, key and token here is a
//! hand-written fake in a folder under this crate's target directory; the three agents are stood in
//! for by small batch files that print hand-written lines and write fake sign-in files. Nothing real
//! is read, started or contacted, and no credential store of the machine is touched.
#![cfg(windows)]

use kolux_rs_lib::claude_accounts as ca;
use kolux_rs_lib::claude_key as ck;
use kolux_rs_lib::codex_accounts as cx;
use kolux_rs_lib::secrets;
use kolux_rs_lib::state::Store;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const DAY: i64 = 86_400_000;
const NOW: i64 = 1_800_000_000_000;
/// Obviously fake; long enough and prefixed the way the key picker looks for.
const KEY: &str = "sk-ant-oat01-TEST-ONLY-NOT-A-REAL-KEY-0000000000000000000000";

fn folder(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("cards07-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn profile(name: &str) -> (PathBuf, Mutex<Store>) {
    let dir = folder(name);
    let store = Store::open(&dir).unwrap();
    (dir, Mutex::new(store))
}

fn write_bat(dir: &Path, name: &str, lines: &[&str]) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, format!("@echo off\r\n{}\r\n", lines.join("\r\n"))).unwrap();
    path
}

fn never() -> Arc<AtomicBool> {
    Arc::new(AtomicBool::new(false))
}

/// A stand-in `claude`: `auth login` prints a sign-in link and writes the credentials file into
/// the folder named by CLAUDE_CONFIG_DIR; `auth status --json` answers as a signed-in account.
fn fake_claude(dir: &Path, login: &str) -> PathBuf {
    write_bat(
        dir,
        "claude.cmd",
        &[
            "if \"%2\"==\"status\" goto status",
            "echo Opening https://claude.ai/oauth/authorize?code=abc123def456ghi789 in your browser",
            "ping -n 2 127.0.0.1 >nul",
            login,
            "exit /b 0",
            ":status",
            "echo {\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"email\":\"sam@example.com\",\"orgName\":\"Example Org\"}",
        ],
    )
}

fn creds_line(token: &str) -> String {
    format!(">\"%CLAUDE_CONFIG_DIR%\\.credentials.json\" echo {{\"claudeAiOauth\":{{\"accessToken\":\"{token}\"}}}}")
}

fn login_with(program: &Path, id_dir: &Path, cancel: Arc<AtomicBool>, on_browser: impl Fn() + Send + 'static) -> (String, ck::Ended) {
    ck::run_hidden(ca::login_command(program, id_dir), Duration::from_secs(30), cancel, on_browser, |_| false)
}

// ---------------------------------------------------------------- ACCT-004

#[test]
fn acct004_box1_connect_keeps_the_key_and_names_a_renewal_a_year_ahead() {
    let (dir, store) = profile("key-connect");
    // The key setup, as Claude Code's `setup-token` prints it: a sign-in link, then the key.
    let program = write_bat(&dir, "claude.cmd", &["echo Opening https://claude.ai/oauth/authorize?code=abc123def456ghi789", "ping -n 2 127.0.0.1 >nul", &format!("echo {KEY}"), "ping -n 4 127.0.0.1 >nul"]);
    let mut cmd = portable_pty::CommandBuilder::new(program.as_os_str());
    cmd.arg("setup-token");
    let seen = Arc::new(AtomicBool::new(false));
    let flag = seen.clone();
    let out = ck::run_setup(cmd, ck::SETUP_LIMIT, never(), move || flag.store(true, Ordering::SeqCst));
    assert_eq!(out, ck::Outcome::Key(KEY.into()));
    assert!(seen.load(Ordering::SeqCst), "the card is told the browser step has started");
    // MIRROR claude_key.rs:466-478: the setup thread keeps a Key outcome with keep() and the clock.
    let ck::Outcome::Key(token) = out else { unreachable!() };
    let store = store.lock().unwrap();
    ck::keep(&store, &token, NOW).unwrap();
    let raw = std::fs::read_to_string(dir.join("settings.json")).unwrap();
    assert!(!raw.contains(KEY), "the key is never in the clear");
    let has = secrets::read_setting(&store, ck::TOKEN_FIELD).unwrap().is_some();
    let status = ck::status_at(&store.settings(), has, NOW);
    assert!(status.connected && !status.renew_due && !status.expired);
    assert_eq!(status.expires_at, Some(NOW + 365 * DAY), "good for twelve months, so the renewal month is a year ahead");
    let wire = serde_json::to_value(&status).unwrap();
    assert_eq!((wire["connected"].as_bool(), wire["renewDue"].as_bool(), wire["expiresAt"].as_i64()), (Some(true), Some(false), Some(NOW + 365 * DAY)));
    assert_eq!(wire["attention"], Value::Null);
    drop(store);
    // And the launcher check that decides the setup may run at all: a native build, not a wrapper.
    assert!(!ck::is_wrapper(Path::new(r"C:\fake\claude.exe")));
}

#[test]
fn acct004_box2_a_key_made_340_days_ago_warns_with_renew_due() {
    let (_dir, store) = profile("key-340");
    let store = store.lock().unwrap();
    ck::keep(&store, KEY, NOW - 340 * DAY).unwrap(); // the stored creation date, backdated
    let has = secrets::read_setting(&store, ck::TOKEN_FIELD).unwrap().is_some();
    let status = ck::status_at(&store.settings(), has, NOW);
    assert!(status.connected && status.renew_due && !status.expired);
    assert_eq!(status.days_left, Some(25));
    let wire = serde_json::to_value(&status).unwrap();
    assert_eq!((wire["renewDue"].as_bool(), wire["expired"].as_bool(), wire["daysLeft"].as_i64()), (Some(true), Some(false), Some(25)));
    // One day short of the warning window: no warning yet.
    ck::keep(&store, KEY, NOW - 334 * DAY).unwrap();
    assert!(!ck::status_at(&store.settings(), true, NOW).renew_due);
}

#[test]
fn acct004_box3_a_claude_pane_in_key_mode_is_handed_the_key_and_a_managed_account_gives_way() {
    let (dir, store) = profile("key-pane");
    let store = store.lock().unwrap();
    ck::keep(&store, KEY, NOW).unwrap();
    let settings = store.settings();
    let token = secrets::read_setting(&store, ck::TOKEN_FIELD).unwrap();
    // MIRROR terminal.rs:1719-1735: spawn asks key_mode, then claude_key::pane_env, then (only if none) the account.
    let by_key = ck::pane_env(Some("claude"), &settings, token.clone());
    assert_eq!(by_key, Some(("CLAUDE_CODE_OAUTH_TOKEN", KEY.to_string())));
    let key_mode = settings[ck::MODE_FIELD] == ck::KEY_MODE;
    assert!(key_mode);
    assert_eq!(ca::pane_env(Some("claude"), key_mode, Some(r"G:\fake\account".into())), None, "key mode wins over a managed account");
    assert_eq!(ca::pane_env(Some("claude"), false, Some(r"G:\fake\account".into())).map(|p| p.0), Some(ca::CONFIG_ENV));
    // The child process really receives the variable (nothing is printed but whether it matches).
    let (k, v) = by_key.unwrap();
    let probe = write_bat(&dir, "probe.cmd", &[&format!("if \"%{k}%\"==\"{KEY}\" (echo SIGNED-IN-BY-KEY) else (echo NO-KEY)")]);
    let mut cmd = portable_pty::CommandBuilder::new(probe.as_os_str());
    cmd.env(k, v);
    let (printed, _) = ck::run_hidden(cmd, Duration::from_secs(20), never(), || {}, |_| false);
    assert!(printed.contains("SIGNED-IN-BY-KEY") && !printed.contains("NO-KEY"), "{printed}");
}

// ---------------------------------------------------------------- ACCT-005

#[test]
fn acct005_box1_add_an_account_shows_email_and_organisation() {
    let (dir, store) = profile("add");
    let program = fake_claude(&dir, &creds_line("fake-access-0000"));
    let seen = Arc::new(AtomicBool::new(false));
    let flag = seen.clone();
    // MIRROR claude_accounts.rs:372-395: the add runs the hidden login in the account's folder, then asks who signed in.
    let account = ca::sign_in(&store, &dir, "a1", false, NOW, |d| login_with(&program, d, never(), move || flag.store(true, Ordering::SeqCst)), |d| ca::auth_status(&program, Some(d))).unwrap();
    assert!(seen.load(Ordering::SeqCst), "the sign-in link appeared, so the note says to finish in the browser");
    assert_eq!((account.email.as_deref(), account.organization.as_deref()), (Some("sam@example.com"), Some("Example Org")));
    let listed = ca::load(&store.lock().unwrap());
    assert_eq!(listed, vec![account.clone()], "the row is listed");
    assert!(Path::new(&account.config_dir).starts_with(dir.join(ca::FOLDER)), "it has a private folder of its own");
    assert!(Path::new(&account.config_dir).join(ca::CREDENTIALS).is_file());
    assert_eq!(ca::active(&store.lock().unwrap()), None, "adding does not change the active account");
    let wire = serde_json::to_value(&account).unwrap();
    assert_eq!((wire["email"].as_str(), wire["organization"].as_str(), wire["stale"].as_bool()), (Some("sam@example.com"), Some("Example Org"), Some(false)));
    ca::activate(&store.lock().unwrap(), Some("a1")).unwrap();
    assert_eq!(ca::active(&store.lock().unwrap()).as_deref(), Some("a1"), "and it can be made active");
}

#[test]
fn acct005_box2_cancel_partway_adds_no_row_and_keeps_the_active_account() {
    let (dir, store) = profile("cancel");
    let program = fake_claude(&dir, &creds_line("fake-access-0000"));
    ca::sign_in(&store, &dir, "a1", false, NOW, |d| login_with(&program, d, never(), || {}), |d| ca::auth_status(&program, Some(d))).unwrap();
    ca::activate(&store.lock().unwrap(), Some("a1")).unwrap();
    let before = ca::load(&store.lock().unwrap());
    // A second add whose login hangs in the browser step; the user presses Cancel once it shows.
    let hang = write_bat(&dir, "claude.cmd", &["echo Opening https://claude.ai/oauth/authorize?code=abc123def456ghi789", "ping -n 30 127.0.0.1 >nul"]);
    let cancel = never();
    let press = cancel.clone();
    let err = ca::sign_in(&store, &dir, "a2", false, NOW + 1, |d| login_with(&hang, d, cancel, move || press.store(true, Ordering::SeqCst)), |_| None).unwrap_err();
    assert_eq!(err.reason, "cancelled");
    assert_eq!(ca::load(&store.lock().unwrap()), before, "no row was added");
    assert_eq!(ca::active(&store.lock().unwrap()).as_deref(), Some("a1"), "the active account stays the same");
    assert!(!dir.join(ca::FOLDER).join("a2").exists(), "nothing partial is kept");
}

#[test]
fn acct005_box3_a_failed_re_authentication_keeps_the_earlier_credentials_and_the_row() {
    let (dir, store) = profile("reauth");
    let program = fake_claude(&dir, &creds_line("fake-access-0000"));
    let first = ca::sign_in(&store, &dir, "a1", false, NOW, |d| login_with(&program, d, never(), || {}), |d| ca::auth_status(&program, Some(d))).unwrap();
    let creds = Path::new(&first.config_dir).join(ca::CREDENTIALS);
    let earlier = std::fs::read_to_string(&creds).unwrap();
    // The re-authentication wipes the file and quits early.
    let failing = write_bat(&dir, "claude.cmd", &["echo Opening https://claude.ai/oauth/authorize?code=abc123def456ghi789", "del \"%CLAUDE_CONFIG_DIR%\\.credentials.json\"", "exit /b 1"]);
    let err = ca::sign_in(&store, &dir, "a1", true, NOW + 5, |d| login_with(&failing, d, never(), || {}), |_| None).unwrap_err();
    assert!(!err.message.contains("https://") && !err.message.contains("abc123def456ghi789"), "no link or code in the error: {err}");
    assert_eq!(std::fs::read_to_string(&creds).unwrap(), earlier, "the earlier credentials are back");
    let rows = ca::load(&store.lock().unwrap());
    assert_eq!(rows, vec![first], "the row is unchanged and not marked as needing sign-in");
    assert!(!rows[0].stale);
}

// ---------------------------------------------------------------- ACCT-007

/// A stand-in `codex`: `login --device-auth` prints the link, then the code a moment later, waits
/// (the user is on another device), then writes a ChatGPT-style sign-in into CODEX_HOME.
fn fake_codex_device(dir: &Path) -> PathBuf {
    let claims = base64_url(r#"{"email":"kim@example.com"}"#);
    write_bat(
        dir,
        "codex.cmd",
        &[
            "echo Open this link on any device: https://auth.example.com/codex/device",
            "ping -n 2 127.0.0.1 >nul",
            "echo Enter this one-time code: WXYZ-6789",
            "ping -n 3 127.0.0.1 >nul",
            &format!(">\"%CODEX_HOME%\\auth.json\" echo {{\"OPENAI_API_KEY\":null,\"tokens\":{{\"id_token\":\"h.{claims}.s\",\"access_token\":\"fake\"}}}}"),
            "echo Successfully logged in",
        ],
    )
}

fn base64_url(s: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(s)
}

/// The sign-in as `codex_account_sign_in` runs it (codex_accounts.rs:451-478), minus the window events.
fn codex_login(program: &Path, device: bool, shown: Arc<Mutex<Vec<(String, String, bool)>>>) -> impl FnOnce(&Path) -> (String, ck::Ended, Option<String>) + '_ {
    move |home| {
        let seen: Arc<Mutex<Option<(String, String)>>> = Arc::default();
        let peek = seen.clone();
        let auth = home.join("auth.json");
        let (out, ended) = ck::run_hidden(cx::login_command(program, home, device), cx::LOGIN_LIMIT, never(), || {}, move |clean| {
            if device {
                if let Some(found) = cx::device_prompt(clean) {
                    let mut s = peek.lock().unwrap();
                    if s.as_ref() != Some(&found) {
                        shown.lock().unwrap().push((found.0.clone(), found.1.clone(), auth.exists()));
                        *s = Some(found);
                    }
                }
            }
            false
        });
        let code = seen.lock().unwrap().as_ref().map(|d| d.1.clone());
        (out, ended, code)
    }
}

#[test]
fn acct007_box1_connect_with_a_code_shows_the_code_then_reads_connected() {
    let (dir, store) = profile("codex-device");
    let program = fake_codex_device(&dir);
    let argv = cx::login_command(&program, &dir, true).get_argv().iter().map(|a| a.to_string_lossy().into_owned()).collect::<Vec<_>>();
    assert_eq!(&argv[1..], ["login", "--device-auth"]);
    let shown = Arc::default();
    let started = Instant::now();
    let account = cx::sign_in(&store, &dir, "c1", NOW, codex_login(&program, true, Arc::clone(&shown))).unwrap();
    let shown = shown.lock().unwrap();
    assert_eq!(shown.len(), 1, "the view got one link-and-code pair, only once both were printed: {shown:?}");
    assert_eq!((shown[0].0.as_str(), shown[0].1.as_str()), ("https://auth.example.com/codex/device", "WXYZ-6789"));
    assert!(!shown[0].2, "the code was on show while the sign-in had not happened yet");
    assert!(started.elapsed() > Duration::from_secs(2), "the sign-in was still waiting on the other device after the code showed");
    // The other device finishes: the account is listed, active, named by its email.
    assert_eq!(account.email.as_deref(), Some("kim@example.com"));
    let store = store.lock().unwrap();
    assert_eq!(cx::load(&store), vec![account.clone()]);
    assert_eq!(cx::active_account(&store).map(|a| a.id), Some("c1".to_string()));
    assert!(Path::new(&account.home).starts_with(dir.join(cx::FOLDER)), "in a private Codex home of its own");
    assert_eq!(cx::system_default(Some(&account.home), None), "chatgpt");
}

/// Every file under `root` with its bytes, for a byte-for-byte comparison.
fn snapshot(root: &Path) -> Vec<(String, Vec<u8>)> {
    fn walk(dir: &Path, root: &Path, out: &mut Vec<(String, Vec<u8>)>) {
        for e in std::fs::read_dir(dir).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                walk(&p, root, out);
            } else {
                out.push((p.strip_prefix(root).unwrap().to_string_lossy().into_owned(), std::fs::read(&p).unwrap()));
            }
        }
    }
    let mut out = Vec::new();
    walk(root, root, &mut out);
    out.sort();
    out
}

#[test]
fn acct007_box2_adding_a_second_account_leaves_the_users_codex_folder_byte_for_byte() {
    let (dir, store) = profile("codex-second");
    // The user's usual Codex folder, hand-made: a ChatGPT-style sign-in, settings, a skill, history.
    let user = folder("codex-user");
    let claims = base64_url(r#"{"email":"me@example.com"}"#);
    std::fs::write(user.join("auth.json"), format!(r#"{{"OPENAI_API_KEY":null,"tokens":{{"id_token":"h.{claims}.s","access_token":"fake-user"}}}}"#)).unwrap();
    std::fs::write(user.join("config.toml"), "model = \"fake-model\"\n[projects.'G:\\fake']\ntrust_level = \"trusted\"\n").unwrap();
    std::fs::create_dir_all(user.join("skills").join("demo")).unwrap();
    std::fs::write(user.join("skills").join("demo").join("SKILL.md"), "# demo skill\r\nline two\r\n").unwrap();
    std::fs::write(user.join("history.jsonl"), b"{\"text\":\"one\"}\n\xff\xfe binary tail").unwrap();
    let before = snapshot(&user);
    let stamps: Vec<_> = before.iter().map(|(n, _)| std::fs::metadata(user.join(n)).unwrap().modified().unwrap()).collect();

    let program = fake_codex_device(&dir);
    // Two accounts are added; each then gets what a pane launch gives its home (the user's skills and settings are copied in).
    for (n, id) in ["c1", "c2"].into_iter().enumerate() {
        assert!(!cx::user_custom_provider(Some(user.to_str().unwrap()), None), "the add checks the user's settings by reading only");
        let account = cx::sign_in(&store, &dir, id, NOW + n as i64, codex_login(&program, false, Arc::default())).unwrap();
        let home = Path::new(&account.home);
        cx::share_user_files(&user, home, Instant::now() + Duration::from_secs(5)).unwrap();
        cx::sync_settings(&user, home).unwrap();
        assert!(home.join("auth.json").is_file() && home != user, "the account has a home of its own");
        assert_ne!(std::fs::read(home.join("auth.json")).unwrap(), std::fs::read(user.join("auth.json")).unwrap(), "the user's own sign-in was not copied over the account's");
    }
    assert_eq!(cx::load(&store.lock().unwrap()).len(), 2, "both accounts are listed");
    assert_eq!(snapshot(&user), before, "every file in the usual Codex folder is byte-for-byte unchanged, none added or removed");
    let after: Vec<_> = before.iter().map(|(n, _)| std::fs::metadata(user.join(n)).unwrap().modified().unwrap()).collect();
    assert_eq!(after, stamps, "not even rewritten");
}

// ---------------------------------------------------------------- ACCT-012

#[test]
fn acct012_box1_a_stale_active_account_is_what_the_notice_reads() {
    let (dir, store) = profile("stale");
    let program = fake_claude(&dir, &creds_line("fake-access-0000"));
    ca::sign_in(&store, &dir, "a1", false, NOW, |d| login_with(&program, d, never(), || {}), |d| ca::auth_status(&program, Some(d))).unwrap();
    {
        let s = store.lock().unwrap();
        ca::activate(&s, Some("a1")).unwrap();
        assert!(ca::mark_stale(&s, "a1", true).unwrap(), "Claude Code no longer reports it signed in");
        // What the window reads for the notice: the stale flag on the active account, labelled by email.
        let wire = serde_json::to_value(ca::load(&s)).unwrap();
        assert_eq!((wire[0]["id"].as_str(), wire[0]["email"].as_str(), wire[0]["stale"].as_bool()), (Some("a1"), Some("sam@example.com"), Some(true)));
        assert_eq!(ca::active(&s).as_deref(), Some("a1"));
    }
    // Sign in again is the same sign-in with the account's id (SignInNotice.tsx: claude_account_sign_in { id }): it clears the flag.
    let again = ca::sign_in(&store, &dir, "a1", true, NOW + 9, |d| login_with(&program, d, never(), || {}), |d| ca::auth_status(&program, Some(d)));
    assert!(again.is_err(), "the same credentials as before are not taken as a new sign-in");
    let fresh = fake_claude(&dir, &creds_line("fake-access-1111"));
    ca::sign_in(&store, &dir, "a1", true, NOW + 9, |d| login_with(&fresh, d, never(), || {}), |d| ca::auth_status(&fresh, Some(d))).unwrap();
    let rows = ca::load(&store.lock().unwrap());
    assert!(!rows[0].stale && rows[0].last_sign_in == NOW + 9, "a new sign-in clears it");
}

#[test]
fn acct012_box2_the_upkeep_switch_that_hands_sign_ins_to_claude_code() {
    // The window hides the notice when this is true (AccountsView.upkeepLeftToClaude).
    assert!(ca::upkeep_left_to_claude(&json!({})), "absent = on (OD-01)");
    assert!(ca::upkeep_left_to_claude(&json!({ ca::UPKEEP_FIELD: true })));
    assert!(!ca::upkeep_left_to_claude(&json!({ ca::UPKEEP_FIELD: false })));
}

// ---------------------------------------------------------------- ACCT-013

#[test]
fn acct013_box2_a_claude_usage_limit_reaches_the_card_as_a_reset_time_with_no_fix() {
    let (_dir, store) = profile("limit");
    let store = store.lock().unwrap();
    let resets = NOW + 3 * 3_600_000;
    // The status line reports the 5-hour window used up; the hook keeps when it lifts (hooks.rs:545).
    let limits = [kolux_rs_lib::hooks::Limit { kind: "five_hour".into(), used_percent: 100.0, resets_at: Some(resets) }];
    let lifts = kolux_rs_lib::hooks::exhausted(&limits).unwrap();
    store.set(ck::LIMIT_KEY, &lifts.to_string()).unwrap();
    // MIRROR claude_key.rs:423-424: the card's attention is usage_limit() of the kept time.
    let kept = store.get(ck::LIMIT_KEY).unwrap().and_then(|t| t.parse().ok());
    let attention = ck::usage_limit(kept, NOW).unwrap();
    let wire = serde_json::to_value(&attention).unwrap();
    assert_eq!((wire["reason"].as_str(), wire["resetsAt"].as_i64()), (Some("usage-limit"), Some(resets)));
    assert_eq!(ck::usage_limit(kept, resets), None, "once the window lifts the card goes back to normal");
}
