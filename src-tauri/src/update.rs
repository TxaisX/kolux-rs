//! Updates (APP-024, APP-025, APP-026, APP-027, APP-028, APP-029, APP-030, APP-031).
//!
//! The page owns the timetable (start-up, every 30 minutes, retries, offline, focus, wake: see
//! `src/update/schedule.ts`); this module owns the feed, the signed download and the install.
//! A found update downloads by itself and waits in memory; it installs when the user clicks
//! Restart to update, or when the app quits. The app never restarts itself to update.
//!
//! The feed is Kolux RS's own (OD-20): a Tauri update manifest at the latest release of the
//! releases repository. Every download is checked against the minisign public key below; there is
//! no switch that turns that off. Development copies and unpackaged copies never update
//! themselves; a development copy may be pointed at a test feed through two environment
//! variables, which release builds ignore.

use crate::state::Store;
use crate::terminal::Terminals;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The update manifest of the newest published release (OD-20: Kolux RS's own feed).
pub const RELEASE_ENDPOINT: &str = "https://github.com/TxaisX/kolux-rs-releases/releases/latest/download/latest.json";
/// The minisign public key releases are signed with. The release job (scripts/release.mjs, T-091)
/// builds it in from the public half of the signing key; a build made without it says it cannot
/// update instead of accepting anything unsigned.
pub const RELEASE_PUBKEY: &str = match option_env!("KOLUX_RS_RELEASE_PUBKEY") {
    Some(k) => k,
    None => "",
};
/// A check that has not answered by then is dropped (APP-024 "a check that stalls").
pub const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
/// Development copies only: a test feed and its key.
pub const ENV_ENDPOINT: &str = "KOLUX_RS_UPDATE_ENDPOINT";
pub const ENV_PUBKEY: &str = "KOLUX_RS_UPDATE_PUBKEY";
/// Release notes in the card are cut to this many lines (APP-027).
pub const NOTE_LINES: usize = 6;

const KEY_LAST_CHECK: &str = "update.lastCheckAt";
const KEY_DISMISSED: &str = "update.dismissedVersion";
const KEY_TIP_DONE: &str = "update.tipDone";
const KEY_ATTEMPT: &str = "update.attempt";
/// APP-030: installers stopped for their publisher (by SHA-256 and update signature); never
/// offered again. Capped at REFUSED_CAP; update_mark("refusedInstallers", "") forgets them all.
const KEY_REFUSED: &str = "update.refusedInstallers";
/// The earlier version-keyed list (T-293); no longer read, and cleared with the new one.
const KEY_REFUSED_OLD: &str = "update.refusedVersions";
/// APP-028: an install attempt older than this is not reported at launch.
pub const ATTEMPT_MAX_AGE_MS: u64 = 7 * 24 * 60 * 60 * 1000;
/// APP-029: the clean-up before the installer runs (ending the shells) gets this long.
pub const CLEANUP_LIMIT: Duration = Duration::from_secs(3);
/// APP-029: the old process is forced out this long after Restart to update.
pub const EXIT_DEADLINE: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, PartialEq)]
pub struct Feed {
    pub endpoint: String,
    pub pubkey: String,
}

/// Where this copy reads updates from, or why it never updates itself.
/// `debug` is a development build; `installed` is true when the program sits in an installed
/// copy (the installer leaves its uninstaller beside it).
pub fn feed(debug: bool, installed: bool, env: impl Fn(&str) -> Option<String>) -> Result<Feed, String> {
    if debug {
        return match (env(ENV_ENDPOINT), env(ENV_PUBKEY)) {
            (Some(endpoint), Some(pubkey)) if !endpoint.trim().is_empty() && !pubkey.trim().is_empty() => {
                Ok(Feed { endpoint: endpoint.trim().into(), pubkey: pubkey.trim().into() })
            }
            _ => Err("This is a development copy of Kolux RS; it never updates itself.".into()),
        };
    }
    if !installed {
        // APP-031: a copy built on this computer is never sent to the download page.
        return Err(if local_build(false, RELEASE_PUBKEY) {
            "This is a local build of Kolux RS and was not installed, so it does not update itself.".into()
        } else {
            "This copy of Kolux RS was not installed, so it cannot install updates. Install it from the releases page to get updates.".into()
        });
    }
    if RELEASE_PUBKEY.trim().is_empty() {
        return Err("This build has no update signing key, so it cannot check updates safely.".into());
    }
    Ok(Feed { endpoint: RELEASE_ENDPOINT.into(), pubkey: RELEASE_PUBKEY.into() })
}

/// APP-031: built on this computer rather than by the release job (which builds the key in).
pub fn local_build(debug: bool, release_key: &str) -> bool {
    debug || release_key.trim().is_empty()
}

fn installed_copy() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("uninstall.exe").is_file()))
        .unwrap_or(false)
}

fn this_feed() -> Result<Feed, String> {
    feed(cfg!(debug_assertions), installed_copy(), |k| std::env::var(k).ok())
}

/// Release notes as a few plain lines: headings and empty lines go, list markers are stripped,
/// and the list is cut to `NOTE_LINES` (APP-027).
pub fn clean_notes(body: Option<&str>) -> Vec<String> {
    let Some(body) = body else { return Vec::new() };
    body.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with("<!--"))
        .filter(|l| !l.chars().all(|c| c == '-' || c == '=' || c == '*' || c == '_'))
        .map(|l| {
            let l = l.strip_prefix("- ").or_else(|| l.strip_prefix("* ")).or_else(|| l.strip_prefix("+ ")).unwrap_or(l);
            l.trim().to_string()
        })
        .filter(|l| !l.is_empty())
        .take(NOTE_LINES)
        .collect()
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub version: String,
    pub current_version: String,
    pub notes: Vec<String>,
    pub date: Option<String>,
}

fn info_of(u: &Update) -> Info {
    Info {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: clean_notes(u.body.as_deref()),
        date: u.date.map(|d| d.to_string()),
    }
}

/// The update found by the last check, and the one that finished downloading.
#[derive(Default)]
pub struct Updates {
    pending: Mutex<Option<Update>>,
    ready: Mutex<Option<(Update, Vec<u8>)>>,
    /// APP-029: an install is under way; a second Restart to update is ignored.
    installing: AtomicBool,
    watchdog: Watchdog,
    /// APP-028: what the last install attempt means at this launch, worked out once.
    launch: OnceLock<Option<LastLaunch>>,
    /// APP-031: counts checks, so one that answers after a newer one started is ignored.
    checks: AtomicU64,
}

/// APP-031: why a check that reached the feed has nothing to offer. None of these is an error.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Quiet {
    /// The newest release has its manifest but its installer is not uploaded yet.
    HalfPublished,
    /// The feed has no manifest yet.
    NoManifest,
    /// The newest release has no download for this computer.
    NoPlatform,
    /// APP-030: the newest release was stopped earlier for its publisher and is not offered again.
    Refused,
}

/// APP-031: the feed answers that mean "nothing to install" rather than a failure.
pub fn quiet_of(e: &tauri_plugin_updater::Error) -> Option<Quiet> {
    use tauri_plugin_updater::Error as E;
    match e {
        E::ReleaseNotFound => Some(Quiet::NoManifest),
        E::TargetNotFound(_) | E::TargetsNotFound(_) => Some(Quiet::NoPlatform),
        _ => None,
    }
}

/// What one check found.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Checked {
    found: Option<Info>,
    quiet: Option<Quiet>,
}

/// The hosts a release download is fetched from (GitHub Releases and the storage it redirects to).
pub fn release_host(url: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(url) else { return false };
    if u.scheme() != "https" {
        return false;
    }
    let Some(h) = u.host_str() else { return false };
    h == "github.com" || h.ends_with(".githubusercontent.com")
}

/// APP-031: whether the installer the manifest names is missing from the release. Only a clear
/// "not found" counts; any other trouble is left for the download to report. The question is only
/// asked of GitHub's release hosts, over https, and redirects stay on those hosts (council review
/// of a08f2bb, F1: the privacy statement names GitHub Releases only).
async fn installer_missing(url: &str) -> bool {
    if !release_host(url) {
        return false;
    }
    let policy = reqwest::redirect::Policy::custom(|a| {
        if a.previous().len() >= 5 {
            a.error("too many redirects")
        } else if release_host(a.url().as_str()) {
            a.follow()
        } else {
            a.stop()
        }
    });
    let Ok(client) = reqwest::Client::builder().timeout(Duration::from_secs(10)).https_only(true).redirect(policy).build() else { return false };
    match client.head(url).send().await {
        Ok(r) => matches!(r.status().as_u16(), 404 | 410),
        Err(_) => false,
    }
}

/// APP-030: what a file's Windows (Authenticode) signature says.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct Signer {
    /// `Valid`, `NotSigned`, `HashMismatch`, `NotTrusted`, ... as Windows reports it.
    pub status: String,
    /// The publisher the signing certificate names; none when the file is not signed.
    pub subject: Option<String>,
}

/// APP-030: whether a downloaded installer may be installed over this copy.
#[derive(Debug, Clone, PartialEq)]
pub enum Verdict {
    Allow,
    /// Signed by someone else (or not validly signed) while this copy is signed: stopped for
    /// good, and this version is never offered again.
    Refuse(String),
    /// The download's signature could not be read at all; stopped this time, not remembered.
    Unverified(String),
}

/// APP-030: the error text that carries a security stop to the update card.
pub const SECURITY_STOP: &str = "security-stop: ";
/// APP-030: the same stop when the download's signature could not be read; not remembered.
pub const SECURITY_STOP_ONCE: &str = "security-stop-once: ";

fn signed(s: &Signer) -> Option<&str> {
    if s.status != "Valid" {
        return None;
    }
    s.subject.as_deref().map(str::trim).filter(|v| !v.is_empty())
}

/// APP-030 (council FIX-2 FS1): the signing release job builds this in as `1` when it signs the
/// copy. Such a copy never takes an update while it cannot read its own signature.
pub const SIGNED_BUILD: bool = match option_env!("KOLUX_RS_SIGNED_BUILD") {
    Some(v) => v.len() == 1 && v.as_bytes()[0] == b'1',
    None => false,
};

/// APP-030: the publisher rule. It applies when this copy is built as signed or carries a valid
/// signature; an unsigned copy (every release today, OD-03) keeps relying on the update key alone.
/// Only a definite answer is a refusal (another publisher, no signature, contents that do not
/// match the signature); anything unclear stops this download only (council FIX-2 FB1).
pub fn publisher_verdict(signed_build: bool, installed: Option<&Signer>, incoming: Option<&Signer>) -> Verdict {
    let mine = match installed.and_then(signed) {
        Some(m) => m,
        None if signed_build => {
            return Verdict::Unverified("Kolux RS could not confirm its own Windows signature, so it did not install the update. It will try again next time.".into())
        }
        None => return Verdict::Allow,
    };
    let Some(theirs) = incoming else {
        return Verdict::Unverified("Kolux RS could not read the download's Windows signature, so it was not installed. It will try again next time.".into());
    };
    match (signed(theirs), theirs.status.as_str()) {
        (Some(p), _) if p == mine => Verdict::Allow,
        (Some(p), _) => Verdict::Refuse(format!("The update is signed by \"{p}\", not by \"{mine}\", the publisher of this copy.")),
        (None, "NotSigned") => Verdict::Refuse(format!("The update has no Windows signature, but this copy is signed by \"{mine}\".")),
        (None, "HashMismatch") => Verdict::Refuse("The update's contents do not match its Windows signature (HashMismatch).".into()),
        (None, "") => Verdict::Unverified("Windows could not check the download's signature just now, so it was not installed. It will try again next time.".into()),
        (None, s) => Verdict::Unverified(format!("Windows could not confirm the download's signature just now ({s}), so it was not installed. It will try again next time.")),
    }
}

/// APP-030: at most this many refused installers are remembered (the oldest go first).
pub const REFUSED_CAP: usize = 20;

/// APP-030 (council FIX-2 FS2): one installer stopped for its publisher. It is known by its own
/// bytes (SHA-256) and by the update signature the feed gave with it (which covers those bytes),
/// never by the version string, so a stale installer served under a new version number cannot
/// block the real release.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Refused {
    pub sha256: String,
    #[serde(default)]
    pub signature: String,
    #[serde(default)]
    pub version: String,
}

fn refused_list(list: Option<&str>) -> Vec<Refused> {
    // A damaged list, or the earlier version-keyed list, is read as empty.
    list.and_then(|l| serde_json::from_str::<Vec<Refused>>(l).ok()).unwrap_or_default()
}

/// APP-030: whether this installer (by its bytes' SHA-256, when they are here) or this update
/// signature (at check time, before any download) was refused before.
pub fn refused_has(list: Option<&str>, sha256: Option<&str>, signature: &str) -> bool {
    let signature = signature.trim();
    refused_list(list)
        .iter()
        .any(|r| sha256.is_some_and(|h| h.eq_ignore_ascii_case(&r.sha256)) || (!signature.is_empty() && r.signature.trim() == signature))
}

/// APP-030: the stored list with this installer added once, keeping the newest `REFUSED_CAP`.
pub fn refused_add(list: Option<&str>, entry: Refused) -> String {
    let mut v = refused_list(list);
    v.retain(|r| !r.sha256.eq_ignore_ascii_case(&entry.sha256));
    v.push(entry);
    let over = v.len().saturating_sub(REFUSED_CAP);
    v.drain(..over);
    serde_json::to_string(&v).unwrap_or_else(|_| "[]".into())
}

/// The SHA-256 of an installer, as lower-case hex.
pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// APP-030 (council FIX-2 AFTER 1): a signature read that has not answered by then (a slow
/// certificate revocation check, say) is given up and the download is stopped this time only.
pub const SIGNATURE_LIMIT: Duration = Duration::from_secs(20);

/// Runs `cmd` and gives its standard output, or `None` when it fails to start, exits with an
/// error, or is still running after `limit` (it is then ended).
pub fn bounded_output(mut cmd: std::process::Command, limit: Duration) -> Option<Vec<u8>> {
    use std::io::Read;
    let mut child = cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).spawn().ok()?;
    // The answer is one short line; reading it on its own thread keeps a full pipe from stalling the wait.
    let mut out = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = out.read_to_end(&mut buf);
        buf
    });
    let until = Instant::now() + limit;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if Instant::now() < until => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    let buf = reader.join().ok()?;
    status.success().then_some(buf)
}

/// APP-030 (council FIX-2 AFTER 2): Windows' own System32 folder, asked of Windows rather than
/// read from an environment variable that the caller could have changed.
#[cfg(windows)]
pub fn system_dir() -> Option<std::path::PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    let mut buf = vec![0u16; 520];
    // SAFETY: the buffer is valid for `buf.len()` UTF-16 units and Windows writes at most that many.
    let n = unsafe { windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW(buf.as_mut_ptr(), buf.len() as u32) } as usize;
    (n > 0 && n < buf.len()).then(|| std::ffi::OsString::from_wide(&buf[..n]).into())
}

/// APP-030: the Windows signature of one file, read by Windows PowerShell's own signature check
/// (no window; the path goes in through the environment, never into the command text; any error
/// stops the read instead of printing an empty answer). `None` when it cannot be read in time.
#[cfg(windows)]
pub fn read_signer(path: &std::path::Path) -> Option<Signer> {
    use std::os::windows::process::CommandExt;
    let ps = system_dir()?.join("WindowsPowerShell").join("v1.0").join("powershell.exe");
    let script = "$ErrorActionPreference = 'Stop'; \
        $s = Get-AuthenticodeSignature -LiteralPath $env:KOLUX_RS_SIGNED_FILE -ErrorAction Stop; \
        $c = $s.SignerCertificate; \
        [pscustomobject]@{ status = [string]$s.Status; subject = $(if ($c) { $c.Subject } else { $null }) } | ConvertTo-Json -Compress";
    let mut cmd = std::process::Command::new(ps);
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .env("KOLUX_RS_SIGNED_FILE", path)
        .creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let out = bounded_output(cmd, SIGNATURE_LIMIT)?;
    serde_json::from_str::<Signer>(String::from_utf8_lossy(&out).trim()).ok()
}

#[cfg(not(windows))]
pub fn read_signer(_path: &std::path::Path) -> Option<Signer> {
    None
}

/// APP-030 (council FIX-2 AFTER 3): writes the download to a new file nobody else can create
/// first, then holds it open so that no other program can change it while its signature is read;
/// the held copy is read back and must match the bytes in memory. The file goes with the handle.
pub struct HeldCopy {
    file: Option<std::fs::File>,
    pub path: std::path::PathBuf,
}

impl HeldCopy {
    pub fn new(bytes: &[u8]) -> Option<HeldCopy> {
        use std::io::{Read, Write};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let n = NEXT.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!("kolux-rs-update-{}-{}-{n}.exe", std::process::id(), now_ms()));
        let mut w = std::fs::OpenOptions::new().write(true).create_new(true).open(&path).ok()?;
        let wrote = w.write_all(bytes).and_then(|_| w.sync_all());
        drop(w);
        let mut open = std::fs::OpenOptions::new();
        open.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            open.share_mode(1); // FILE_SHARE_READ: others may read it, nobody may write, rename or delete it
        }
        let held = wrote.ok().and_then(|_| open.open(&path).ok());
        let Some(mut file) = held else {
            let _ = std::fs::remove_file(&path);
            return None;
        };
        let mut back = Vec::with_capacity(bytes.len());
        if file.read_to_end(&mut back).is_err() || back != bytes {
            drop(file);
            let _ = std::fs::remove_file(&path);
            return None;
        }
        Some(HeldCopy { file: Some(file), path })
    }
}

impl Drop for HeldCopy {
    fn drop(&mut self) {
        // Closing the only handle first lets the delete go through.
        drop(self.file.take());
        let _ = std::fs::remove_file(&self.path);
    }
}

/// APP-030: the downloaded installer's signature, read from a held copy.
pub fn incoming_signer(bytes: &[u8]) -> Option<Signer> {
    let copy = HeldCopy::new(bytes)?;
    read_signer(&copy.path)
}

/// APP-030: checks the downloaded installer against the running copy's publisher.
fn check_publisher(bytes: &[u8]) -> Verdict {
    let installed = std::env::current_exe().ok().and_then(|p| read_signer(&p));
    // Nothing to compare against (an unsigned copy, or a signed build that cannot read its own
    // signature): the download is never written out.
    if installed.as_ref().and_then(signed).is_none() {
        return publisher_verdict(SIGNED_BUILD, installed.as_ref(), None);
    }
    publisher_verdict(SIGNED_BUILD, installed.as_ref(), incoming_signer(bytes).as_ref())
}

/// APP-028: one install attempt, kept in the store until the next launch reads it.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempt {
    pub from: String,
    pub to: String,
    pub at: u64,
    #[serde(default)]
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LastLaunch {
    /// The update took: a one-time note with its notes.
    Updated { version: String, notes: Vec<String> },
    /// The version that was installed over is still the one running.
    Failed { version: String, from: String },
}

/// APP-028: what an install attempt means for the version now running. Only the version that was
/// installed over still running is a failure; any other version than the target is a deliberate
/// move (a pinned or locally built copy) and says nothing; attempts older than seven days are ignored.
pub fn last_launch(a: &Attempt, running: &str, now: u64) -> Option<LastLaunch> {
    if now.saturating_sub(a.at) > ATTEMPT_MAX_AGE_MS {
        return None;
    }
    if running == a.to {
        Some(LastLaunch::Updated { version: a.to.clone(), notes: a.notes.clone() })
    } else if running == a.from && a.from != a.to {
        Some(LastLaunch::Failed { version: a.to.clone(), from: a.from.clone() })
    } else {
        None
    }
}

/// APP-029: forces the old process out at its deadline so it never blocks the installer.
#[derive(Default)]
pub struct Watchdog {
    deadline: Mutex<Option<Instant>>,
}

impl Watchdog {
    /// Arms the watchdog for `at`; arming again never moves the deadline later. Returns the
    /// deadline now in force.
    pub fn arm(&self, at: Instant) -> Instant {
        let mut d = self.deadline.lock().unwrap_or_else(|e| e.into_inner());
        let v = d.map_or(at, |d| d.min(at));
        *d = Some(v);
        v
    }
    pub fn stand_down(&self) {
        *self.deadline.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
    /// `None` once stood down; otherwise whether the deadline has passed.
    pub fn due(&self, now: Instant) -> Option<bool> {
        self.deadline.lock().unwrap_or_else(|e| e.into_inner()).map(|d| now >= d)
    }
}

fn arm_watchdog(app: &AppHandle) {
    app.state::<Updates>().watchdog.arm(Instant::now() + EXIT_DEADLINE);
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(250));
        match app.state::<Updates>().watchdog.due(Instant::now()) {
            None => return,
            Some(true) => std::process::exit(0),
            Some(false) => {}
        }
    });
}

/// APP-029: the clean-up before quitting, held to `CLEANUP_LIMIT` so the restart is not held up.
fn cleanup(app: &AppHandle) {
    let (tx, rx) = mpsc::channel();
    let app = app.clone();
    std::thread::spawn(move || {
        app.state::<Terminals>().kill_all();
        let _ = tx.send(());
    });
    let _ = rx.recv_timeout(CLEANUP_LIMIT);
}

/// APP-029: why the installer could not run, in plain words, with paths, addresses' queries and
/// anything that looks like a secret taken out.
pub fn clean_reason(raw: &str) -> String {
    let lower = raw.to_lowercase();
    let cause = if lower.contains("os error 1223") || lower.contains("canceled by the user") || lower.contains("cancelled by the user") {
        "Windows asked for permission to run the installer and the request was refused, so nothing changed."
    } else if lower.contains("os error 5)") || lower.contains("access is denied") || lower.contains("permission denied") {
        "Kolux RS does not have permission to run the installer, so nothing changed."
    } else if lower.contains("os error 2)") || lower.contains("cannot find the file") || lower.contains("no such file") {
        "The downloaded installer is gone; another program may have removed it."
    } else {
        "The installer could not start, so nothing changed."
    };
    // Windows fills some messages from a template whose "%1" never got its file name.
    let raw = raw.replace("%1", "the installer");
    let said = raw
        .split(' ')
        .filter(|w| !w.is_empty())
        .map(|w| {
            let bare = w.trim_matches(|c: char| "\"'()[]{},;".contains(c));
            let path = bare.contains('\\') || bare.starts_with("~/") || (bare.starts_with('/') && bare.len() > 1) || bare.contains(":/");
            let url = bare.starts_with("http://") || bare.starts_with("https://");
            let secret = bare.len() >= 24 && bare.chars().any(|c| c.is_ascii_digit()) && bare.chars().all(|c| c.is_ascii_alphanumeric() || "-_.=+/".contains(c));
            if url {
                w.replace(bare, bare.split(['?', '#']).next().unwrap_or(""))
            } else if path {
                w.replace(bare, "<path>")
            } else if secret {
                w.replace(bare, "<hidden>")
            } else {
                w.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    if said.is_empty() { cause.into() } else { format!("{cause} ({said})") }
}

fn record_attempt(app: &AppHandle, u: &Update) {
    let a = Attempt { from: u.current_version.clone(), to: u.version.clone(), at: now_ms(), notes: clean_notes(u.body.as_deref()) };
    if let (Ok(store), Ok(json)) = (app.state::<Mutex<Store>>().lock(), serde_json::to_string(&a)) {
        let _ = store.set(KEY_ATTEMPT, &json);
    }
}

fn clear_attempt(app: &AppHandle) {
    if let Ok(store) = app.state::<Mutex<Store>>().lock() {
        let _ = store.set(KEY_ATTEMPT, "");
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool,
    reason: Option<String>,
    current_version: String,
    last_check_at: Option<u64>,
    dismissed_version: Option<String>,
    tip_done: bool,
    ready: Option<Info>,
    last_launch: Option<LastLaunch>,
    local: bool,
}

#[tauri::command(async)]
pub fn update_status(app: AppHandle, store: State<'_, Mutex<Store>>, updates: State<'_, Updates>) -> Result<Status, String> {
    let feed = this_feed();
    let store = store.lock().map_err(|e| e.to_string())?;
    let get = |k: &str| store.get(k).ok().flatten();
    let current = app.package_info().version.to_string();
    // APP-028: read once per launch, then forgotten, so the note shows on this launch only.
    let last = updates
        .launch
        .get_or_init(|| {
            let a = get(KEY_ATTEMPT).and_then(|v| serde_json::from_str::<Attempt>(&v).ok())?;
            let _ = store.set(KEY_ATTEMPT, "");
            last_launch(&a, &current, now_ms())
        })
        .clone();
    Ok(Status {
        last_launch: last,
        local: local_build(cfg!(debug_assertions), RELEASE_PUBKEY),
        enabled: feed.is_ok(),
        reason: feed.err(),
        current_version: app.package_info().version.to_string(),
        last_check_at: get(KEY_LAST_CHECK).and_then(|v| v.parse().ok()),
        dismissed_version: get(KEY_DISMISSED).filter(|v| !v.is_empty()),
        tip_done: get(KEY_TIP_DONE).as_deref() == Some("1"),
        ready: updates.ready.lock().map_err(|e| e.to_string())?.as_ref().map(|(u, _)| info_of(u)),
    })
}

/// Remembers the dismissed version or that the reassurance tip is done, or (APP-030, council
/// FIX-2 FS2) forgets every installer stopped for its publisher: key "refusedInstallers" with an
/// empty value. Nothing can be added to that list this way; a forgotten installer that is still
/// signed by someone else is stopped again when it downloads.
#[tauri::command(async)]
pub fn update_mark(store: State<'_, Mutex<Store>>, key: String, value: String) -> Result<(), String> {
    let store = store.lock().map_err(|e| e.to_string())?;
    let key = match key.as_str() {
        "dismissedVersion" => KEY_DISMISSED,
        "tipDone" => KEY_TIP_DONE,
        "refusedInstallers" if value.is_empty() => {
            store.set(KEY_REFUSED_OLD, "").map_err(|e| e.to_string())?;
            KEY_REFUSED
        }
        "refusedInstallers" => return Err("the stopped-installers list can only be cleared".into()),
        _ => return Err(format!("unknown update mark: {key}")),
    };
    store.set(key, &value).map_err(|e| e.to_string())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// One check against the feed. `None` means this copy is up to date.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Checked, String> {
    let feed = this_feed()?;
    let me = app.state::<Updates>().checks.fetch_add(1, Ordering::SeqCst) + 1;
    let url = feed.endpoint.parse().map_err(|e| format!("bad update address: {e}"))?;
    let found = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .pubkey(feed.pubkey)
        .timeout(CHECK_TIMEOUT)
        // APP-029: the plugin's own hook hides every window and clears its resources before the
        // installer starts, which leaves a hidden, broken app when the installer then cannot start.
        // The process ends straight after a good start, so nothing needs tidying first.
        .on_before_exit(|| {})
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await;
    // APP-031: a missing manifest or platform is no update, and a release whose installer is not
    // uploaded yet is passed over until it is.
    let (found, quiet) = match found {
        Ok(Some(u)) if installer_missing(u.download_url.as_str()).await => (None, Some(Quiet::HalfPublished)),
        // APP-030: an installer stopped for its publisher is never offered again (known by the
        // update signature, which covers its bytes; a different installer under the same version is).
        Ok(Some(u)) if refused_has(app.state::<Mutex<Store>>().lock().ok().and_then(|s| s.get(KEY_REFUSED).ok().flatten()).as_deref(), None, &u.signature) => {
            (None, Some(Quiet::Refused))
        }
        Ok(found) => (found, None),
        Err(e) => (None, Some(quiet_of(&e).ok_or_else(|| e.to_string())?)),
    };
    let checked = Checked { found: found.as_ref().map(info_of), quiet };
    let updates = app.state::<Updates>();
    // APP-031: a late answer from an earlier check never overwrites the current one.
    if updates.checks.load(Ordering::SeqCst) != me {
        return Ok(checked);
    }
    if let Ok(store) = app.state::<Mutex<Store>>().lock() {
        let _ = store.set(KEY_LAST_CHECK, &now_ms().to_string());
    }
    *updates.pending.lock().map_err(|e| e.to_string())? = found;
    Ok(checked)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    version: String,
    received: u64,
    total: Option<u64>,
}

/// Downloads the update the last check found and checks its signature. The bytes wait in memory
/// until Restart to update or quit.
#[tauri::command]
pub async fn update_download(app: AppHandle) -> Result<Info, String> {
    let updates = app.state::<Updates>();
    if let Some((u, _)) = updates.ready.lock().map_err(|e| e.to_string())?.as_ref() {
        return Ok(info_of(u));
    }
    let update = updates.pending.lock().map_err(|e| e.to_string())?.clone().ok_or("There is no update to download; check again.")?;
    let version = update.version.clone();
    let mut received = 0u64;
    let emitter = app.clone();
    let bytes = update
        .download(
            |chunk, total| {
                received += chunk as u64;
                let _ = emitter.emit("update-progress", Progress { version: version.clone(), received, total });
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    // APP-030: a signed copy only takes an installer from the same publisher; no bypass. An
    // installer refused before is stopped again without asking Windows.
    let (verdict, bytes, sha) = tauri::async_runtime::spawn_blocking(move || {
        let sha = sha256_hex(&bytes);
        (check_publisher(&bytes), bytes, sha)
    })
    .await
    .map_err(|e| e.to_string())?;
    let earlier = app.state::<Mutex<Store>>().lock().ok().and_then(|s| s.get(KEY_REFUSED).ok().flatten());
    let verdict = if refused_has(earlier.as_deref(), Some(&sha), "") {
        Verdict::Refuse("This installer was stopped earlier because it did not come from this copy's publisher.".into())
    } else {
        verdict
    };
    match verdict {
        Verdict::Allow => {}
        Verdict::Refuse(why) => {
            if let Ok(store) = app.state::<Mutex<Store>>().lock() {
                let entry = Refused { sha256: sha, signature: update.signature.clone(), version: update.version.clone() };
                let _ = store.set(KEY_REFUSED, &refused_add(earlier.as_deref(), entry));
            }
            *updates.pending.lock().map_err(|e| e.to_string())? = None;
            return Err(format!("{SECURITY_STOP}{why}"));
        }
        Verdict::Unverified(why) => return Err(format!("{SECURITY_STOP_ONCE}{why}")),
    }
    let info = info_of(&update);
    *updates.ready.lock().map_err(|e| e.to_string())? = Some((update, bytes));
    Ok(info)
}

/// Restart to update: the shells end, the installer runs and starts the new version (APP-029).
/// The attempt is recorded for the next launch (APP-028) and a watchdog forces this process out
/// at its deadline. When the installer cannot start, the watchdog stands down, the update stays
/// ready and the real reason comes back; a second click while an install is under way is ignored.
#[tauri::command]
pub fn update_restart(app: AppHandle) -> Result<(), String> {
    let updates = app.state::<Updates>();
    if updates.installing.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let ready = updates.ready.lock().map_err(|e| e.to_string())?.take();
    let Some((update, bytes)) = ready else {
        updates.installing.store(false, Ordering::SeqCst);
        return Err("No update is ready.".into());
    };
    record_attempt(&app, &update);
    arm_watchdog(&app);
    // On Windows this starts the installer and ends this process, which ends its shells with it;
    // the shells are not ended first, so an installer that cannot start leaves every pane running.
    match update.install(&bytes) {
        Ok(()) => {
            cleanup(&app);
            app.restart()
        }
        Err(e) => {
            updates.watchdog.stand_down();
            clear_attempt(&app);
            if let Ok(mut r) = updates.ready.lock() {
                *r = Some((update, bytes));
            }
            updates.installing.store(false, Ordering::SeqCst);
            Err(clean_reason(&e.to_string()))
        }
    }
}

/// Called as the app quits: a downloaded update installs now and does not reopen the app. The
/// attempt is recorded so the next launch can tell whether it took (APP-028).
pub fn install_on_quit(app: &AppHandle) {
    let updates = app.state::<Updates>();
    if updates.installing.swap(true, Ordering::SeqCst) {
        return;
    }
    let ready = updates.ready.lock().ok().and_then(|mut r| r.take());
    if let Some((update, bytes)) = ready {
        record_attempt(app, &update);
        let _ = update.restart_after_install(false).install(&bytes);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_with(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let pairs: Vec<(String, String)> = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        move |k| pairs.iter().find(|(pk, _)| pk == k).map(|(_, v)| v.clone())
    }

    #[test]
    fn the_installer_check_only_asks_github_release_hosts_over_https() {
        assert!(release_host("https://github.com/TxaisX/kolux-rs-releases/releases/download/v0.2.0/setup.exe"));
        assert!(release_host("https://release-assets.githubusercontent.com/x"));
        assert!(release_host("https://objects.githubusercontent.com/x"));
        assert!(!release_host("http://github.com/TxaisX/kolux-rs-releases/releases/download/v0.2.0/setup.exe"));
        assert!(!release_host("https://github.com.evil.example/x"));
        assert!(!release_host("https://evilgithubusercontent.com/x"));
        assert!(!release_host("http://127.0.0.1:9/setup.exe"));
        assert!(!release_host("not a url"));
    }

    #[test]
    fn development_copy_never_updates_without_a_test_feed() {
        let e = feed(true, true, env_with(&[])).unwrap_err();
        assert!(e.contains("development copy"), "{e}");
        // Only one of the two variables is not enough.
        assert!(feed(true, true, env_with(&[(ENV_ENDPOINT, "http://127.0.0.1:1/latest.json")])).is_err());
        assert!(feed(true, true, env_with(&[(ENV_ENDPOINT, " "), (ENV_PUBKEY, "k")])).is_err());
    }

    #[test]
    fn development_copy_takes_a_test_feed() {
        let f = feed(true, false, env_with(&[(ENV_ENDPOINT, "http://127.0.0.1:9/latest.json "), (ENV_PUBKEY, "abc")])).unwrap();
        assert_eq!(f, Feed { endpoint: "http://127.0.0.1:9/latest.json".into(), pubkey: "abc".into() });
    }

    #[test]
    fn release_builds_ignore_the_test_feed_and_need_an_installed_copy() {
        let env = env_with(&[(ENV_ENDPOINT, "http://127.0.0.1:9/latest.json"), (ENV_PUBKEY, "abc")]);
        let e = feed(false, false, &env).unwrap_err();
        assert!(e.contains("not installed"), "{e}");
        match feed(false, true, &env) {
            Ok(f) => assert_eq!(f.endpoint, RELEASE_ENDPOINT, "a release build must never read the test feed"),
            Err(e) => assert!(e.contains("signing key"), "{e}"),
        }
    }

    #[test]
    fn app031_a_missing_manifest_or_platform_is_no_update_and_a_local_build_is_told_apart() {
        use tauri_plugin_updater::Error as E;
        assert_eq!(quiet_of(&E::ReleaseNotFound), Some(Quiet::NoManifest));
        assert_eq!(quiet_of(&E::TargetNotFound("windows-x86_64".into())), Some(Quiet::NoPlatform));
        assert_eq!(quiet_of(&E::TargetsNotFound(vec!["windows-x86_64".into()])), Some(Quiet::NoPlatform));
        assert_eq!(quiet_of(&E::EmptyEndpoints), None);
        assert_eq!(serde_json::to_string(&Quiet::HalfPublished).unwrap(), "\"halfPublished\"");
        assert!(local_build(true, "key"));
        assert!(local_build(false, " "));
        assert!(!local_build(false, "key"));
        if local_build(false, RELEASE_PUBKEY) {
            let e = feed(false, false, |_| None).unwrap_err();
            assert!(!e.contains("releases page"), "{e}");
        }
    }

    #[test]
    fn app028_the_next_launch_tells_a_failed_install_from_a_good_one() {
        let a = Attempt { from: "0.1.4".into(), to: "0.1.5".into(), at: 1_000, notes: vec!["New".into()] };
        assert_eq!(last_launch(&a, "0.1.5", 2_000), Some(LastLaunch::Updated { version: "0.1.5".into(), notes: vec!["New".into()] }));
        assert_eq!(last_launch(&a, "0.1.4", 2_000), Some(LastLaunch::Failed { version: "0.1.5".into(), from: "0.1.4".into() }));
        // A move to a pinned or locally built version is never a failure.
        assert_eq!(last_launch(&a, "0.1.3", 2_000), None);
        assert_eq!(last_launch(&a, "0.2.0-local", 2_000), None);
        // Older than seven days: ignored; just inside: reported.
        assert_eq!(last_launch(&a, "0.1.4", 1_000 + ATTEMPT_MAX_AGE_MS + 1), None);
        assert!(last_launch(&a, "0.1.4", 1_000 + ATTEMPT_MAX_AGE_MS).is_some());
        let round: Attempt = serde_json::from_str(&serde_json::to_string(&a).unwrap()).unwrap();
        assert_eq!(round, a);
    }

    #[test]
    fn app029_arming_the_watchdog_again_never_moves_its_deadline_later() {
        let w = Watchdog::default();
        let t = Instant::now();
        assert_eq!(w.due(t), None);
        assert_eq!(w.arm(t + Duration::from_secs(10)), t + Duration::from_secs(10));
        assert_eq!(w.arm(t + Duration::from_secs(30)), t + Duration::from_secs(10));
        assert_eq!(w.arm(t + Duration::from_secs(5)), t + Duration::from_secs(5));
        assert_eq!(w.due(t + Duration::from_secs(4)), Some(false));
        assert_eq!(w.due(t + Duration::from_secs(5)), Some(true));
        w.stand_down();
        assert_eq!(w.due(t + Duration::from_secs(60)), None);
    }

    #[test]
    fn app029_the_reason_names_the_permission_problem_without_paths_or_secrets() {
        let r = clean_reason("The operation was canceled by the user. (os error 1223)");
        assert!(r.starts_with("Windows asked for permission"), "{r}");
        let r = clean_reason("Access is denied. (os error 5) C:\\Users\\Xiong T\\AppData\\Local\\Temp\\kolux-rs-setup.exe");
        assert!(r.starts_with("Kolux RS does not have permission"), "{r}");
        assert!(!r.contains("Users") && !r.contains("Temp") && r.contains("<path>"), "{r}");
        let r = clean_reason("request to https://example.com/latest.json?token=abc failed, key ghp_0123456789abcdefABCDEF0123");
        assert!(r.contains("https://example.com/latest.json") && !r.contains("token=abc") && !r.contains("ghp_0123") && r.contains("<hidden>"), "{r}");
        assert!(clean_reason("invalid updater binary format").starts_with("The installer could not start"));
        assert!(!clean_reason("This version of %1 is not compatible (os error 216)").contains("%1"));
    }

    #[test]
    fn notes_drop_headings_and_blank_lines_and_are_cut_short() {
        let body = "## What's new\n\n- First\n* Second\n\n### Fixes\n+ Third\nFourth plain line\n---\n- Fifth\n- Sixth\n- Seventh\n";
        assert_eq!(clean_notes(Some(body)), vec!["First", "Second", "Third", "Fourth plain line", "Fifth", "Sixth"]);
        assert_eq!(clean_notes(Some("# Only a heading\n\n")), Vec::<String>::new());
        assert_eq!(clean_notes(None), Vec::<String>::new());
        // The release job's hidden source marker never shows as a note.
        assert_eq!(clean_notes(Some("- Ship it\n<!-- kolux-rs-source: abc123 -->\n")), vec!["Ship it"]);
    }

    fn sig(status: &str, subject: Option<&str>) -> Signer {
        Signer { status: status.into(), subject: subject.map(Into::into) }
    }

    const ME: &str = "CN=Txais Xiong, O=Txais Xiong, C=US";

    #[test]
    fn app030_an_unsigned_copy_never_stops_an_update() {
        // Every release today is unsigned (OD-03): the rule stays dormant whatever arrives.
        for installed in [None, Some(sig("NotSigned", None)), Some(sig("HashMismatch", Some(ME))), Some(sig("Valid", Some("  ")))] {
            for incoming in [None, Some(sig("NotSigned", None)), Some(sig("Valid", Some("CN=Someone Else")))] {
                assert_eq!(publisher_verdict(false, installed.as_ref(), incoming.as_ref()), Verdict::Allow, "{installed:?} / {incoming:?}");
            }
        }
    }

    #[test]
    fn app030_a_copy_built_signed_that_cannot_read_its_own_signature_stops_once() {
        // FIX-2 FS1: the build flag says this copy is signed; a failed or unclear read of its own
        // signature (PowerShell blocked, antivirus holding the file) never lets an update through.
        for installed in [None, Some(sig("", None)), Some(sig("UnknownError", Some(ME))), Some(sig("NotTrusted", Some(ME)))] {
            for incoming in [None, Some(sig("Valid", Some(ME))), Some(sig("NotSigned", None))] {
                let v = publisher_verdict(true, installed.as_ref(), incoming.as_ref());
                assert!(matches!(&v, Verdict::Unverified(why) if why.contains("its own")), "{installed:?} / {incoming:?}: {v:?}");
            }
        }
        // When it can read its own signature, the flag changes nothing.
        let mine = sig("Valid", Some(ME));
        assert_eq!(publisher_verdict(true, Some(&mine), Some(&mine)), Verdict::Allow);
        assert!(matches!(publisher_verdict(true, Some(&mine), Some(&sig("NotSigned", None))), Verdict::Refuse(_)));
        // The flag is only on in a build the signing job made.
        assert!(!SIGNED_BUILD || option_env!("KOLUX_RS_SIGNED_BUILD") == Some("1"));
    }

    #[test]
    fn app030_a_signed_copy_takes_only_its_own_publisher() {
        let mine = sig("Valid", Some(ME));
        for build in [false, true] {
            assert_eq!(publisher_verdict(build, Some(&mine), Some(&sig("Valid", Some(ME)))), Verdict::Allow);
            // A renewed certificate keeps the publisher name: still allowed (surrounding spaces ignored).
            assert_eq!(publisher_verdict(build, Some(&mine), Some(&sig("Valid", Some(&format!(" {ME} "))))), Verdict::Allow);
        }
        let Verdict::Refuse(why) = publisher_verdict(false, Some(&mine), Some(&sig("Valid", Some("CN=Someone Else")))) else { panic!("not refused") };
        assert!(why.contains("CN=Someone Else") && why.contains(ME), "{why}");
        let Verdict::Refuse(why) = publisher_verdict(false, Some(&mine), Some(&sig("NotSigned", None))) else { panic!("unsigned taken") };
        assert!(why.contains("no Windows signature"), "{why}");
        // Same publisher name on a signature whose contents do not match is stopped for good.
        let Verdict::Refuse(why) = publisher_verdict(false, Some(&mine), Some(&sig("HashMismatch", Some(ME)))) else { panic!("HashMismatch taken") };
        assert!(why.contains("HashMismatch"), "{why}");
        // FIX-2 FB1: an unclear or passing result (antivirus holding the file gives an empty status, an
        // offline PC gives NotTrusted) stops this time only; it is never remembered.
        for unclear in ["", "UnknownError", "NotTrusted", "Incompatible", "NotSupportedFileFormat", "Valid"] {
            let subject = if unclear == "Valid" { None } else { Some(ME) };
            assert!(matches!(publisher_verdict(false, Some(&mine), Some(&sig(unclear, subject))), Verdict::Unverified(_)), "{unclear:?} was remembered");
        }
        // A download whose signature cannot be read is stopped this time but not remembered.
        assert!(matches!(publisher_verdict(false, Some(&mine), None), Verdict::Unverified(_)));
    }

    fn refused(sha: &str, signature: &str, version: &str) -> Refused {
        Refused { sha256: sha.into(), signature: signature.into(), version: version.into() }
    }

    #[test]
    fn app030_a_refused_installer_is_known_by_its_bytes_not_its_version() {
        assert!(!refused_has(None, Some("aa"), "sig-a"));
        assert!(!refused_has(Some("not json"), Some("aa"), "sig-a"));
        let one = refused_add(None, refused("AA", "sig-a", "0.9.0"));
        // Download time (the bytes' hash, any case) and check time (the feed's signature for those bytes).
        assert!(refused_has(Some(&one), Some("aa"), ""));
        assert!(refused_has(Some(&one), None, "sig-a"));
        // FIX-2 FS2: the real 0.9.0 (other bytes, other signature) is not blocked by a stale
        // installer that was served as "0.9.0".
        assert!(!refused_has(Some(&one), Some("bb"), "sig-b"));
        assert!(!refused_has(Some(&one), None, ""), "an empty signature matches nothing");
        // The earlier version-keyed list blocks nothing.
        assert!(!refused_has(Some(r#"["0.9.0"]"#), None, "0.9.0"));
        // Added once per installer, newest last, and a damaged list starts over instead of failing the stop.
        let again = refused_add(Some(&one), refused("aa", "sig-a2", "0.9.0"));
        assert_eq!(refused_list(Some(&again)).len(), 1);
        assert_eq!(refused_list(Some(&refused_add(Some("{oops"), refused("cc", "s", "1.0.0")))), vec![refused("cc", "s", "1.0.0")]);
    }

    #[test]
    fn app030_the_refused_list_keeps_only_the_newest_twenty() {
        let mut list: Option<String> = None;
        for i in 0..(REFUSED_CAP + 5) {
            list = Some(refused_add(list.as_deref(), refused(&format!("{i:064x}"), &format!("sig-{i}"), "1.0.0")));
        }
        let kept = refused_list(list.as_deref());
        assert_eq!(kept.len(), REFUSED_CAP);
        assert_eq!(kept.first().map(|r| r.signature.as_str()), Some("sig-5"));
        assert!(!refused_has(list.as_deref(), None, "sig-4") && refused_has(list.as_deref(), None, &format!("sig-{}", REFUSED_CAP + 4)));
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn app030_the_security_stop_reaches_the_card_as_its_own_kind() {
        assert_eq!(serde_json::to_string(&Quiet::Refused).unwrap(), r#""refused""#);
        // The card reads these two marks (card.ts securityStop); a refused stop and a one-time stop
        // must never be mistaken for each other.
        assert_eq!((SECURITY_STOP, SECURITY_STOP_ONCE), ("security-stop: ", "security-stop-once: "));
        assert!(!SECURITY_STOP_ONCE.contains(SECURITY_STOP));
    }

    #[cfg(windows)]
    #[test]
    fn app030_a_signature_read_that_hangs_is_given_up() {
        // FIX-2 AFTER 1: a program that does not answer in time is ended and gives no answer.
        let mut cmd = std::process::Command::new(system_dir().unwrap().join("ping.exe"));
        cmd.args(["-n", "30", "127.0.0.1"]);
        let at = Instant::now();
        assert_eq!(bounded_output(cmd, Duration::from_millis(400)), None);
        assert!(at.elapsed() < Duration::from_secs(10), "{:?}", at.elapsed());
        let mut cmd = std::process::Command::new(system_dir().unwrap().join("cmd.exe"));
        cmd.args(["/c", "echo hi"]);
        assert_eq!(bounded_output(cmd, Duration::from_secs(20)).map(|b| String::from_utf8_lossy(&b).trim().to_string()), Some("hi".into()));
        let mut cmd = std::process::Command::new(system_dir().unwrap().join("cmd.exe"));
        cmd.args(["/c", "exit 3"]);
        assert_eq!(bounded_output(cmd, Duration::from_secs(20)), None, "a failed read is no answer");
    }

    #[cfg(windows)]
    #[test]
    fn app030_powershell_comes_from_windows_own_folder_and_the_held_copy_cannot_change() {
        // FIX-2 AFTER 2: System32 is asked of Windows, not read from SystemRoot.
        let sys = system_dir().expect("system folder");
        let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        assert_eq!(sys.to_string_lossy().to_lowercase(), std::path::Path::new(&root).join("System32").to_string_lossy().to_lowercase());
        // FIX-2 AFTER 3: while the copy is held, nobody can write, replace or delete it; it goes with the handle.
        let copy = HeldCopy::new(b"MZ held").expect("held copy");
        assert_eq!(std::fs::read(&copy.path).unwrap(), b"MZ held");
        assert!(std::fs::OpenOptions::new().write(true).open(&copy.path).is_err(), "written while held");
        assert!(std::fs::remove_file(&copy.path).is_err(), "deleted while held");
        let path = copy.path.clone();
        drop(copy);
        assert!(!path.exists());
    }

    #[cfg(windows)]
    #[test]
    fn app030_reads_real_windows_signatures() {
        // A Windows program carries a valid signature with a publisher, also when read from a held copy.
        let ps = system_dir().unwrap().join("WindowsPowerShell").join("v1.0").join("powershell.exe");
        let s = read_signer(&ps).expect("powershell.exe signature read");
        assert_eq!(s.status, "Valid", "{s:?}");
        assert!(s.subject.as_deref().is_some_and(|v| v.contains("Microsoft")), "{s:?}");
        assert_eq!(incoming_signer(&std::fs::read(&ps).unwrap()), Some(s.clone()));
        // A real program nobody signed (this test program), with a bracket in its name, which a
        // wildcard path would trip on: Windows says NotSigned, a definite answer.
        let dir = std::env::temp_dir().join(format!("kolux-rs-app030-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("un[signed].exe");
        std::fs::copy(std::env::current_exe().unwrap(), &f).unwrap();
        let u = read_signer(&f).expect("unsigned file read");
        assert_eq!(u, Signer { status: "NotSigned".into(), subject: None });
        // A file that is not a program at all gives an unclear answer or none: never allowed.
        let junk = dir.join("junk.exe");
        std::fs::write(&junk, b"MZ not a real program").unwrap();
        let j = read_signer(&junk);
        assert!(!matches!(publisher_verdict(false, Some(&s), j.as_ref()), Verdict::Allow), "{j:?}");
        // Signed copy vs unsigned download: stopped for good. Signed copy vs itself: allowed.
        assert!(matches!(publisher_verdict(false, Some(&s), Some(&u)), Verdict::Refuse(_)));
        assert_eq!(publisher_verdict(false, Some(&s), Some(&s)), Verdict::Allow);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
