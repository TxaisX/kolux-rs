//! ACCT-003: a missing agent tool installs from its Connect card. On Windows the install goes
//! through the system package manager (WinGet), run hidden; the progress bar follows what WinGet
//! prints. Once it is in, the program search path is read again from the registry so the new
//! tool is found at once, with no Kolux restart. An install still going after 15 minutes is
//! stopped and shown as failed; starting another install for the same agent ends the earlier
//! one; WinGet's known exit codes become plain reasons. Without WinGet (or off Windows) the
//! card offers the agent's install page instead.
//!
//! ponytail: cancelling stops WinGet itself; an installer it had already handed over to may
//! finish on its own. Ending the whole process tree needs a tree-kill helper; add one if a
//! hung installer child is ever seen.

use crate::claude_key::{run_hidden, Attention, Ended};
use portable_pty::CommandBuilder;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// ACCT-003: an install still going after this long is stopped and shown as failed.
pub const LIMIT: Duration = Duration::from_secs(15 * 60);
/// Fires whenever an install moves on; the cards read [`agent_installs`] again.
pub const EVENT: &str = "agent-install";

/// The WinGet package that installs each Connect-card agent.
pub fn package(agent: &str) -> Option<&'static str> {
    match agent {
        "claude" => Some("Anthropic.ClaudeCode"),
        "codex" => Some("OpenAI.Codex"),
        "grok" => Some("xAI.GrokBuild"),
        _ => None,
    }
}

/// The WinGet line for `id`: exact id, the community source, every question answered up front
/// so nothing waits on a prompt nobody can see.
pub fn command_args(id: &str) -> Vec<String> {
    ["install", "--id", id, "--exact", "--source", "winget", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

fn size(n: &str, unit: &str) -> Option<f64> {
    let v: f64 = n.parse().ok()?;
    Some(v * match unit {
        "KB" => 1e3,
        "MB" => 1e6,
        "GB" => 1e9,
        _ => return None,
    })
}

/// How far the install is, 0..=100, from the last progress WinGet printed: a download line
/// (`12.0 MB / 50.0 MB`) or a percentage (`45%`). `None` before any.
pub fn progress(clean: &str) -> Option<u8> {
    let words: Vec<&str> = clean.split(|c: char| c.is_whitespace() || c == '\u{2588}' || c == '\u{2592}').filter(|w| !w.is_empty()).collect();
    let mut last = None;
    for (i, w) in words.iter().enumerate() {
        if let Some(p) = w.strip_suffix('%').and_then(|p| p.parse::<f64>().ok()) {
            if (0.0..=100.0).contains(&p) {
                last = Some(p.round() as u8);
            }
        } else if *w == "/" && i >= 2 && i + 2 < words.len() {
            if let (Some(done), Some(total)) = (size(words[i - 2], words[i - 1]), size(words[i + 1], words[i + 2])) {
                if total > 0.0 && done <= total {
                    last = Some((done / total * 100.0).round() as u8);
                }
            }
        }
    }
    last
}

/// WinGet's known exit codes (its public return-code list), as the reason and plain words the
/// card shows. `Ok` means the tool is on the machine.
pub fn conclude(ended: &Ended, agent: &str) -> Result<(), Attention> {
    let failed = |m: String| Attention::new("install-failed", m);
    match ended {
        Ended::Exited(Some(0)) | Ended::Stopped => Ok(()),
        // Already installed, or no newer version to put on.
        Ended::Exited(Some(0x8A15_0061)) | Ended::Exited(Some(0x8A15_002B)) => Ok(()),
        Ended::Exited(Some(0x8A15_002D)) => Err(Attention::new("smartscreen", "Windows' security check blocked the installer. Install it from its own page instead.")),
        Ended::Exited(Some(0x8A15_010F)) => Err(Attention::new("install-unavailable", "Your organisation's policy blocks installing this. Ask your admin, or install it from its own page.")),
        Ended::Exited(Some(0x8A15_0014)) | Ended::Exited(Some(0x8A15_0010)) => Err(Attention::new("install-unavailable", "The package manager has no installer for this PC. Install it from its own page instead.")),
        Ended::Exited(Some(0x8A15_0102)) => Err(failed("Another install is running on this PC. Wait for it to finish, then try again.".into())),
        Ended::Exited(Some(0x8A15_0107)) => Err(failed("The install needs an internet connection. Check you are online, then try again.".into())),
        Ended::Exited(Some(0x8A15_0105)) => Err(failed("There is not enough disk space. Make some room, then try again.".into())),
        Ended::Exited(Some(0x8A15_0109)) => Err(failed("Restart your PC to finish the install.".into())),
        Ended::Exited(Some(0x8A15_0011)) => Err(failed("The downloaded installer did not match what was expected, so it was not run. Try again later.".into())),
        Ended::Exited(Some(0x8A15_010C)) | Ended::Cancelled => Err(Attention::new("cancelled", "Install cancelled.")),
        Ended::Exited(code) => Err(failed(match code {
            Some(c) => format!("The install of {agent} failed (code 0x{c:08X})."),
            None => format!("The install of {agent} stopped without saying why."),
        })),
        Ended::TimedOut => Err(failed("The install was still going after 15 minutes, so Kolux stopped it.".into())),
        Ended::NotStarted(e) => Err(Attention::new("install-unavailable", format!("The package manager could not start: {e}"))),
    }
}

/// A finished install whose program still cannot be found is not a success: the card would
/// otherwise go back to Install with no word of why.
pub fn found_after(name: &str, found: bool) -> Result<(), Attention> {
    if found {
        return Ok(());
    }
    Err(Attention::new("install-failed", format!("The package manager finished, but Kolux cannot find {name}'s program yet. Try installing again, or sign out of Windows and back in.")))
}

/// The program search path as Windows now holds it (machine, then user, each expanded), with
/// any folder this process had on top that the registry does not list kept at the end.
#[cfg(windows)]
fn fresh_path(current: &str) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ};
    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }
    fn read(root: HKEY, key: &str) -> Option<String> {
        let (key, name) = (wide(key), wide("Path"));
        let flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ;
        let mut bytes = 0u32;
        // SAFETY: valid null-terminated strings; a null buffer asks only for the size.
        if unsafe { RegGetValueW(root, key.as_ptr(), name.as_ptr(), flags, std::ptr::null_mut(), std::ptr::null_mut(), &mut bytes) } != 0 {
            return None;
        }
        let mut buf = vec![0u16; bytes as usize / 2 + 1];
        let mut len = (buf.len() * 2) as u32;
        // SAFETY: `buf` holds `len` bytes.
        if unsafe { RegGetValueW(root, key.as_ptr(), name.as_ptr(), flags, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut len) } != 0 {
            return None;
        }
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..end]))
    }
    let machine = read(HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment");
    let user = read(HKEY_CURRENT_USER, "Environment");
    if machine.is_none() && user.is_none() {
        return None;
    }
    Some(merge_path(&[machine.unwrap_or_default(), user.unwrap_or_default()].join(";"), current))
}

#[cfg(not(windows))]
fn fresh_path(_current: &str) -> Option<String> {
    None
}

/// `fresh` first, then the folders of `current` it lacks; each folder once, blanks dropped.
pub fn merge_path(fresh: &str, current: &str) -> String {
    let mut seen = std::collections::HashSet::new();
    fresh
        .split(';')
        .chain(current.split(';'))
        .map(str::trim)
        .filter(|d| !d.is_empty() && seen.insert(d.trim_end_matches(['\\', '/']).to_lowercase()))
        .collect::<Vec<_>>()
        .join(";")
}

/// ACCT-003: the search path is read again so a tool installed a moment ago is found.
pub fn reread_path() {
    let current = std::env::var("PATH").unwrap_or_default();
    if let Some(p) = fresh_path(&current) {
        // SAFETY (edition 2021: safe): Kolux sets PATH only here, after an install.
        std::env::set_var("PATH", p);
    }
}

struct Job {
    cancel: Arc<AtomicBool>,
    /// Bumps on every start, so an earlier job that ends late does not overwrite a newer one.
    run: u64,
}

/// What one card shows about its install.
#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallView {
    pub running: bool,
    pub progress: Option<u8>,
    pub attention: Option<Attention>,
}

#[derive(Default)]
pub struct Installs {
    jobs: Mutex<HashMap<String, Job>>,
    views: Mutex<HashMap<String, InstallView>>,
    runs: std::sync::atomic::AtomicU64,
}

impl Installs {
    fn set(&self, agent: &str, run: u64, view: InstallView) -> bool {
        let current = self.jobs.lock().ok().and_then(|j| j.get(agent).map(|j| j.run)) == Some(run);
        if current {
            if let Ok(mut v) = self.views.lock() {
                v.insert(agent.to_string(), view);
            }
        }
        current
    }
}

#[tauri::command]
pub fn agent_installs(installs: tauri::State<'_, Installs>) -> HashMap<String, InstallView> {
    installs.views.lock().map(|v| v.clone()).unwrap_or_default()
}

/// Whether the card can install the agent itself; otherwise it offers the install page.
pub fn agent_can_install_now(agent: &str) -> bool {
    cfg!(windows) && package(agent).is_some() && crate::agents::find_program("winget").is_some()
}

/// Async so the WinGet PATH probe (158 ms under load) runs off the UI thread, which a sync command would hold.
#[tauri::command]
pub async fn agent_can_install(agent: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || agent_can_install_now(&agent)).await.unwrap_or(false)
}

#[tauri::command]
pub fn agent_install(app: AppHandle, installs: tauri::State<'_, Installs>, agent: String) -> Result<(), String> {
    let id = package(&agent).ok_or_else(|| format!("Kolux has no installer for {agent}."))?;
    let winget = crate::agents::find_program("winget").ok_or("The Windows package manager (WinGet) is not on this PC. Use the install page instead.")?;
    let cancel = Arc::new(AtomicBool::new(false));
    let run = installs.runs.fetch_add(1, Ordering::SeqCst) + 1;
    {
        let mut jobs = installs.jobs.lock().map_err(|e| e.to_string())?;
        // Starting another install for the same agent ends the earlier one.
        if let Some(old) = jobs.insert(agent.clone(), Job { cancel: cancel.clone(), run }) {
            old.cancel.store(true, Ordering::SeqCst);
        }
    }
    installs.set(&agent, run, InstallView { running: true, progress: None, attention: None });
    let _ = app.emit(EVENT, ());
    std::thread::spawn(move || {
        let mut cmd = CommandBuilder::new(winget);
        cmd.args(command_args(id));
        let tick_app = app.clone();
        let tick_agent = agent.clone();
        let shown = Mutex::new(None::<u8>);
        let (_, ended) = run_hidden(cmd, LIMIT, cancel, || {}, move |clean| {
            let p = progress(clean);
            let mut last = shown.lock().unwrap_or_else(|e| e.into_inner());
            if p.is_some() && *last != p {
                *last = p;
                if tick_app.state::<Installs>().set(&tick_agent, run, InstallView { running: true, progress: p, attention: None }) {
                    let _ = tick_app.emit(EVENT, ());
                }
            }
            false
        });
        let mut result = conclude(&ended, &agent);
        if result.is_ok() {
            reread_path();
            let _ = app.emit("agents-changed", ());
            let me = crate::agents::catalogue().into_iter().find(|a| a.id == agent);
            result = found_after(me.as_ref().map_or(agent.as_str(), |a| a.name.as_str()), me.as_ref().is_some_and(|a| a.installed));
        }
        let attention = result.err().filter(|a| a.reason != "cancelled");
        let installs = app.state::<Installs>();
        if installs.set(&agent, run, InstallView { running: false, progress: None, attention }) {
            if let Ok(mut jobs) = installs.jobs.lock() {
                jobs.remove(&agent);
            }
        }
        let _ = app.emit(EVENT, ());
    });
    Ok(())
}

#[tauri::command]
pub fn agent_install_cancel(installs: tauri::State<'_, Installs>, agent: String) {
    if let Some(job) = installs.jobs.lock().ok().and_then(|j| j.get(&agent).map(|j| j.cancel.clone())) {
        job.store(true, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_follows_the_last_download_line_or_percentage_winget_printed() {
        assert_eq!(progress("Found Codex CLI [OpenAI.Codex] Version 0.161.0\r\nDownloading https://x/codex.zip"), None);
        let bar = "  \u{2588}\u{2588}\u{2588}\u{2592}\u{2592}\u{2592}  12.0 MB / 48.0 MB\r  \u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2592}  24.0 MB / 48.0 MB";
        assert_eq!(progress(bar), Some(50));
        assert_eq!(progress(&format!("{bar}\r\nSuccessfully verified installer hash\r\nStarting package install...\r\n  \u{2588}\u{2588}  80%")), Some(80));
        // What WinGet 1.29 really printed in a hidden terminal: a spinner, then the bar.
        assert_eq!(progress("Downloading https://x/rg.zip\r   - \r   \\ \r  \u{2588}\u{2588}\u{2588}\u{2588}  1.70 MB / 1.70 MB\r\nSuccessfully verified installer hash"), Some(100));
        // A kilobyte count against megabytes compares the real sizes.
        assert_eq!(progress("500 KB / 2.00 MB"), Some(25));
        // A version number or a stray slash is not progress.
        assert_eq!(progress("Version: 1.0 / Publisher: xAI Corp."), None);
        assert_eq!(progress("140%"), None);
    }

    #[test]
    fn winget_exit_codes_become_plain_reasons() {
        assert_eq!(conclude(&Ended::Exited(Some(0)), "codex"), Ok(()));
        assert_eq!(conclude(&Ended::Exited(Some(0x8A15_0061)), "codex"), Ok(()), "already installed counts as installed");
        assert_eq!(conclude(&Ended::Exited(Some(0x8A15_002D)), "codex").unwrap_err().reason, "smartscreen");
        assert_eq!(conclude(&Ended::Exited(Some(0x8A15_0014)), "codex").unwrap_err().reason, "install-unavailable");
        assert_eq!(conclude(&Ended::Cancelled, "codex").unwrap_err().reason, "cancelled");
        let hung = conclude(&Ended::TimedOut, "codex").unwrap_err();
        assert_eq!(hung.reason, "install-failed", "a hung install offers Try installing again");
        assert!(hung.message.contains("15 minutes"));
        assert!(conclude(&Ended::Exited(Some(0x8000_4005)), "codex").unwrap_err().message.contains("0x80004005"));
    }

    #[test]
    fn an_install_whose_program_cannot_be_found_is_a_failure() {
        assert_eq!(found_after("Grok", true), Ok(()));
        let e = found_after("Grok", false).unwrap_err();
        assert_eq!(e.reason, "install-failed");
        assert!(e.message.contains("cannot find Grok's program"));
    }

    #[test]
    fn the_fresh_path_comes_first_and_keeps_what_only_this_process_had() {
        assert_eq!(merge_path(r"C:\Windows;C:\Users\me\AppData\Local\Microsoft\WinGet\Links", r"C:\stub;C:\windows\;;"), r"C:\Windows;C:\Users\me\AppData\Local\Microsoft\WinGet\Links;C:\stub");
    }

    #[test]
    fn the_three_connect_agents_have_winget_packages_and_every_question_is_answered() {
        assert_eq!(package("grok"), Some("xAI.GrokBuild"));
        assert_eq!(package("aider"), None);
        let a = command_args("OpenAI.Codex");
        for flag in ["--exact", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"] {
            assert!(a.iter().any(|x| x == flag), "{flag}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn the_registry_still_has_a_search_path() {
        let p = fresh_path("").expect("Windows keeps a PATH in the registry");
        assert!(p.to_lowercase().contains(r"\windows"), "{p}");
    }
}


#[cfg(test)]
mod can_install_async_tests {
    use super::*;

    fn is_async<F: std::future::Future>(_: fn(String) -> F) {}

    #[test]
    fn agent_can_install_is_an_async_command_that_matches_the_sync_one() {
        is_async(agent_can_install);
        let _scratch = crate::test_dir::temp("can-install-async");
        for agent in ["claude", "codex", "grok", "unknown-agent"] {
            let old = cfg!(windows) && package(agent).is_some() && crate::agents::find_program("winget").is_some();
            assert_eq!(agent_can_install_now(agent), old, "{agent}");
            assert_eq!(tauri::async_runtime::block_on(agent_can_install(agent.into())), old, "{agent} through the command");
        }
        assert!(!agent_can_install_now("unknown-agent"), "no installer, no install");
    }
}
