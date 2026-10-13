//! APP-039: a crash leaves a report behind, and the next launch offers it once. A panic anywhere in
//! the app writes `<profile>/crashes/<ms>.txt` before the process ends (release builds abort on a
//! panic). Only the newest report prompts, once; `crashes/dismissed` names the last one shown.
//! Help > Report Crash reads the newest report whatever was dismissed.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// How many reports are kept; older ones go when a new one is written.
const KEEP: usize = 10;

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct Report {
    pub id: String,
    pub text: String,
}

fn folder(profile: &Path) -> PathBuf {
    profile.join("crashes")
}

/// Writes one report and returns its id. `what` is the panic message with its place.
pub fn record(profile: &Path, version: &str, what: &str) -> std::io::Result<String> {
    let dir = folder(profile);
    fs::create_dir_all(&dir)?;
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let id = format!("{ms:015}");
    let thread = std::thread::current().name().unwrap_or("unnamed").to_string();
    let text = format!(
        "Kolux RS {version} crashed\nWhen: {} (unix seconds)\nSystem: {} {}\nThread: {thread}\nWhat: {}\n",
        ms / 1000,
        std::env::consts::OS,
        std::env::consts::ARCH,
        scrub(what, home().as_deref())
    );
    fs::write(dir.join(format!("{id}.txt")), text)?;
    let mut ids = ids(profile);
    while ids.len() > KEEP {
        let _ = fs::remove_file(dir.join(format!("{}.txt", ids.remove(0))));
    }
    Ok(id)
}

/// Report ids, oldest first (they are zero-padded milliseconds, so they sort as text).
fn ids(profile: &Path) -> Vec<String> {
    let mut ids: Vec<String> = fs::read_dir(folder(profile))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| e.file_name().to_str()?.strip_suffix(".txt").map(str::to_string))
        .collect();
    ids.sort();
    ids
}

pub fn newest(profile: &Path) -> Option<Report> {
    let id = ids(profile).pop()?;
    let text = fs::read_to_string(folder(profile).join(format!("{id}.txt"))).ok()?;
    Some(Report { id, text })
}

/// The newest report when it has not been offered yet.
pub fn pending(profile: &Path) -> Option<Report> {
    let shown = fs::read_to_string(folder(profile).join("dismissed")).unwrap_or_default();
    newest(profile).filter(|r| r.id.as_str() > shown.trim())
}

pub fn dismiss(profile: &Path, id: &str) -> std::io::Result<()> {
    fs::create_dir_all(folder(profile))?;
    fs::write(folder(profile).join("dismissed"), id)
}

fn home() -> Option<String> {
    std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).ok().filter(|h| !h.is_empty())
}

/// Removes what could identify the user or unlock something before text leaves the app: the home
/// folder becomes `~`, and anything shaped like a key or token (sk-..., or 32+ letters, digits,
/// `-` and `_` in a row) becomes `[redacted]`.
pub fn scrub(text: &str, home: Option<&str>) -> String {
    let mut text = text.to_string();
    if let Some(h) = home {
        for form in [h.to_string(), h.replace('\\', "/")] {
            text = text.replace(&form, "~");
        }
    }
    let mut out = String::with_capacity(text.len());
    let mut word = String::new();
    let flush = |word: &mut String, out: &mut String| {
        if word.starts_with("sk-") || word.len() >= 32 {
            out.push_str("[redacted]");
        } else {
            out.push_str(word);
        }
        word.clear();
    };
    for c in text.chars() {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
            word.push(c);
        } else {
            flush(&mut word, &mut out);
            out.push(c);
        }
    }
    flush(&mut word, &mut out);
    out
}

/// The diagnostic bundle Attach recent diagnostic logs copies: the last lines of the app log,
/// scrubbed.
pub fn log_bundle(profile: &Path, home: Option<&str>) -> String {
    const LINES: usize = 200;
    match fs::read_to_string(profile.join("logs").join("kolux.log")) {
        Ok(log) => {
            let lines: Vec<&str> = log.lines().collect();
            let tail = lines[lines.len().saturating_sub(LINES)..].join("\n");
            format!("Recent Kolux RS diagnostic log (last {} lines, scrubbed):\n{}\n", lines.len().min(LINES), scrub(&tail, home))
        }
        Err(_) => "Kolux RS has no diagnostic log yet.\n".into(),
    }
}

/// Keeps the default panic output and writes a report first. Only the first panic is reported:
/// one that unwinds into the window's event loop is followed by a second "cannot unwind" panic
/// that says nothing about the cause.
pub fn install(profile: PathBuf, version: String) {
    static REPORTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if REPORTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
            return previous(info);
        }
        let place = info.location().map(|l| format!(" at {}:{}", l.file(), l.line())).unwrap_or_default();
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "a panic with no message".into());
        let _ = record(&profile, &version, &format!("{message}{place}"));
        previous(info);
    }));
}

fn profile(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// The report to offer at startup, marked as offered so it never prompts again.
#[tauri::command]
pub fn crash_pending(app: tauri::AppHandle) -> Result<Option<Report>, String> {
    let dir = profile(&app)?;
    let report = pending(&dir);
    if let Some(r) = &report {
        dismiss(&dir, &r.id).map_err(|e| e.to_string())?;
    }
    Ok(report)
}

#[tauri::command]
pub fn crash_newest(app: tauri::AppHandle) -> Result<Option<Report>, String> {
    Ok(newest(&profile(&app)?))
}

#[tauri::command]
pub fn crash_logs(app: tauri::AppHandle) -> Result<String, String> {
    Ok(log_bundle(&profile(&app)?, home().as_deref()))
}

/// Development builds only: ends the app with a panic, for proving the report end to end.
#[tauri::command]
pub fn debug_crash() {
    if cfg!(debug_assertions) {
        panic!("debug_crash was asked for (a development build's crash test)");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-rs-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn app039_only_the_newest_report_prompts_and_only_once() {
        let dir = temp("app039-once");
        assert_eq!(pending(&dir), None, "no report, nothing to offer");
        let first = record(&dir, "1.2.3", "first").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let second = record(&dir, "1.2.3", "second").unwrap();
        assert!(second > first);
        let r = pending(&dir).unwrap();
        assert_eq!(r.id, second, "the newest report prompts");
        assert!(r.text.contains("Kolux RS 1.2.3 crashed") && r.text.contains("What: second"), "{}", r.text);
        dismiss(&dir, &r.id).unwrap();
        assert_eq!(pending(&dir), None, "once offered it does not prompt again");
        assert_eq!(newest(&dir).unwrap().id, second, "Report Crash still opens it after dismissal");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn app039_old_reports_are_pruned() {
        let dir = temp("app039-prune");
        for i in 0..(KEEP + 3) {
            record(&dir, "1", &i.to_string()).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        assert_eq!(ids(&dir).len(), KEEP);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn app039_the_log_bundle_is_scrubbed() {
        let dir = temp("app039-logs");
        assert!(log_bundle(&dir, None).contains("no diagnostic log"), "it says when there is nothing");
        fs::create_dir_all(dir.join("logs")).unwrap();
        fs::write(dir.join("logs").join("kolux.log"), "1 opened C:\\Users\\Ann\\repo\n2 key sk-ant-abc123 used\n3 token 0123456789abcdef0123456789abcdef99 seen\n4 plain words stay\n").unwrap();
        let b = log_bundle(&dir, Some("C:\\Users\\Ann"));
        assert!(b.contains("opened ~\\repo"), "{b}");
        assert!(!b.contains("sk-ant") && !b.contains("0123456789abcdef0123"), "{b}");
        assert_eq!(b.matches("[redacted]").count(), 2, "{b}");
        assert!(b.contains("4 plain words stay"), "{b}");
        fs::remove_dir_all(&dir).unwrap();
    }
}
