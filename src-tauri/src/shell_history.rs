//! TERM-119: a shell's up arrow shows the commands run in this worktree only. A bash or zsh pane is
//! handed its own history file (`HISTFILE`) and a fish pane its own history session
//! (`fish_history`), both named after the worktree the pane starts in. Command Prompt, PowerShell,
//! WSL and any shell not listed are left alone, and a history file the user already set (in the
//! environment the pane starts from, or in the pane's own variables) is respected.
//!
//! The files live in Kolux's own data folder under `shell-history/<worktree key>/`, a folder only
//! the user can open on a Unix system (on Windows it inherits the profile's own private rights).
//! A folder is removed at start-up when the worktree it belongs to has been gone for 30 days across
//! start-ups while the folder above it is there (a drive that is not plugged in keeps its history for
//! good), and so is its fish session file, which fish keeps in its own data folder.
//!
//! ponytail: a shell start-up file that sets `HISTFILE` itself (zsh's new-user setup does) wins over
//! the variable, as the user's own settings should; the start-up hook layer (TERM-137) is where that
//! would be steered. zsh also saves nothing unless the user's setup sets SAVEHIST, as before.

use portable_pty::CommandBuilder;
use sha2::{Digest, Sha256};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// The setting that turns this off (on by default).
pub const FIELD: &str = "shellHistoryPerWorktree";
/// The folder under the app's data folder that holds every worktree's history.
const DIR: &str = "shell-history";
/// The file in a worktree's folder that records which worktree it belongs to.
const RECORD: &str = "worktree";
/// The start of a fish session name this build makes; the build's own tag follows.
const FISH_PREFIX: &str = "kolux_";
/// The file in a worktree's folder that holds the time (seconds) the sweep first found it missing.
const MISSING: &str = "missing-since";
/// How long a worktree must stay missing, across sweeps, before its history is removed (30 days).
const GRACE_SECS: u64 = 30 * 24 * 3600;

/// Whether the per-worktree history is on: it is unless the setting is switched off.
pub fn enabled(settings: &serde_json::Value) -> bool {
    settings.get(FIELD).and_then(serde_json::Value::as_bool) != Some(false)
}

#[derive(Debug, PartialEq, Clone, Copy)]
enum Kind {
    Bash,
    Zsh,
    Fish,
}

/// Which of the three shells `program` is, by its file name; the WSL launcher in the system folder
/// is also called bash.exe but is a different program that does not take the variable along, and a
/// Microsoft Store alias under WindowsApps starts something else.
fn kind_of(program: &Path) -> Option<Kind> {
    // Same rule as the pane's shell search (a Microsoft Store alias is a stand-in, not the program),
    // read on both slashes so a Windows path is judged the same on any system.
    if program.to_string_lossy().split(['/', '\\']).any(|c| c.eq_ignore_ascii_case("system32") || c.eq_ignore_ascii_case("WindowsApps")) {
        return None;
    }
    match program.file_stem()?.to_string_lossy().to_lowercase().as_str() {
        "bash" => Some(Kind::Bash),
        "zsh" => Some(Kind::Zsh),
        "fish" => Some(Kind::Fish),
        _ => None,
    }
}

/// The folder of the worktree `cwd` is in: the nearest folder at or above it with a `.git` entry
/// (a folder in a normal clone, a file in a linked worktree), else `cwd` itself.
pub fn worktree_root(cwd: &Path) -> PathBuf {
    cwd.ancestors().find(|d| d.join(".git").exists()).unwrap_or(cwd).to_path_buf()
}

/// The same worktree always spells the same: no verbatim prefix, slashes forward, no trailing
/// slash, and on Windows (where a path has no case) lower case.
fn normal(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    // The verbatim form of a share (//?/UNC/server/share) is the share itself (//server/share).
    let s = match s.strip_prefix("//?/UNC/") {
        Some(rest) => format!("//{rest}"),
        None => s.strip_prefix("//?/").unwrap_or(&s).to_string(),
    };
    let s = s.trim_end_matches('/').to_string();
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The folder name for a worktree: a short readable tail, then 16 hex digits of the full path.
pub fn key(root: &Path) -> String {
    let norm = normal(root);
    let tail: String = norm.rsplit('/').next().unwrap_or("").chars().filter(|c| c.is_ascii_alphanumeric()).take(16).collect();
    format!("{}-{}", if tail.is_empty() { "root" } else { &tail }, hex(&Sha256::digest(norm.as_bytes())[..8]))
}

/// This build's tag in a fish session name, so one build's sweep never touches another's sessions
/// (a dev copy and an installed one have different data folders).
fn build_tag(data: &Path) -> String {
    hex(&Sha256::digest(normal(data).as_bytes())[..3])
}

/// A private folder: made with owner-only rights on Unix.
fn make_private(dir: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)
    }
    #[cfg(not(unix))]
    {
        std::fs::create_dir_all(dir)
    }
}

/// A path as a shell reads it: forward slashes, which Git Bash and every Unix shell accept.
fn shell_path(p: &Path) -> OsString {
    p.to_string_lossy().replace('\\', "/").into()
}

/// The folder where fish keeps its history sessions.
pub fn fish_dir(xdg_data_home: Option<OsString>, home: Option<PathBuf>) -> Option<PathBuf> {
    xdg_data_home.filter(|d| !d.is_empty()).map(|d| PathBuf::from(d).join("fish")).or_else(|| home.map(|h| h.join(".local/share/fish")))
}

/// The fish session for a worktree key. Fish takes only letters, digits and underscores in a session
/// name (anything else makes it print an error and use the shared history), so the key's `-` becomes
/// `_`; the key's parts are alphanumeric, which keeps `sweep` able to undo that.
fn fish_session(data: &Path, key: &str) -> String {
    format!("{FISH_PREFIX}{}_{}", build_tag(data), key.replace('-', "_"))
}

/// The variable a pane's shell gets, when it is one of the three and nothing has chosen its history
/// already: `(name, value)`. `chosen` says whether a variable of that name is set somewhere the command
/// does not show yet (the pane's own variables). The worktree's folder and its record are made as a
/// side effect: this is the disk work, so it is done before anything is locked.
fn history_var(command: &CommandBuilder, data: &Path, chosen: &dyn Fn(&str) -> bool) -> Option<(&'static str, OsString)> {
    let argv0 = command.get_argv().first()?;
    let kind = kind_of(Path::new(argv0))?;
    let name = match kind {
        Kind::Bash | Kind::Zsh => "HISTFILE",
        Kind::Fish => "fish_history",
    };
    // A history the user set is respected. An empty value is a choice too (bash keeps no file then).
    if command.get_env(name).is_some() || chosen(name) {
        return None;
    }
    let cwd = command.get_cwd().map(PathBuf::from)?;
    let root = worktree_root(&cwd);
    let key = key(&root);
    let dir = data.join(DIR).join(&key);
    make_private(&dir).ok()?;
    // The pane's folder is there, so the worktree is back: drop the sweep's missing-since note.
    let _ = std::fs::remove_file(dir.join(MISSING));
    let record = dir.join(RECORD);
    if !record.is_file() {
        std::fs::write(&record, normal_record(&root)).ok()?;
    }
    Some(match kind {
        Kind::Bash => (name, shell_path(&dir.join("bash_history"))),
        Kind::Zsh => (name, shell_path(&dir.join("zsh_history"))),
        Kind::Fish => (name, fish_session(data, &key).into()),
    })
}

/// What the record file holds: the worktree's folder as the OS spells it.
fn normal_record(root: &Path) -> String {
    let s = root.to_string_lossy();
    match s.strip_prefix(r"\\?\UNC\") {
        Some(rest) => format!(r"\\{rest}"),
        None => s.strip_prefix(r"\\?\").unwrap_or(&s).to_string(),
    }
}

/// The history variable for each command a pane may start, in order (`None` for another shell, when
/// the user chose a history, or when the folder cannot be made). `chosen` says whether the user's own
/// variables for the pane set a name. All the disk work is here, so call it before the registry of
/// panes is locked; the caller then only sets the variable (`command.env(name, value)`) on its command,
/// after the pane's own variables. The first call in a run also starts the sweep over `data` and the
/// fish folder `fish`.
pub fn plan(commands: &[CommandBuilder], data: &Path, fish: Option<PathBuf>, chosen: &dyn Fn(&str) -> bool) -> Vec<Option<(&'static str, OsString)>> {
    sweep_once(data, fish);
    commands.iter().map(|c| history_var(c, data, chosen)).collect()
}

/// The folder where this machine's fish keeps its sessions, from the process's own environment.
pub fn system_fish_dir() -> Option<PathBuf> {
    fish_dir(std::env::var_os("XDG_DATA_HOME"), crate::pty::home_dir())
}

/// Removes what a deleted worktree left: its history folder in `data`, and the fish session of any
/// folder that is gone. A worktree counts as deleted only when the folder above it is there and a
/// sweep has found it missing and a later one, at least `GRACE_SECS` after, finds it still missing (a
/// note in its history folder holds the first time). So a drive that is not plugged in or a share that
/// does not answer (nothing above the worktree) never costs a worktree its history, and a mount point
/// left behind empty keeps it for the grace period; a worktree that is back clears the note (so does a
/// pane started in it). Only real folders named after the worktree their record names are touched, and
/// never through a link; when the history folder is itself a link no fish session is touched either.
/// Returns how many files and folders were removed.
pub fn sweep(data: &Path, fish: Option<&Path>) -> usize {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    sweep_at(data, fish, now, GRACE_SECS)
}

/// `sweep` at a given time (seconds; 0 means the clock is unknown, so nothing is noted or removed)
/// with a given grace period (seconds).
fn sweep_at(data: &Path, fish: Option<&Path>, now: u64, grace: u64) -> usize {
    let base = data.join(DIR);
    let mut removed = 0;
    // A history folder that is itself a link is not followed: what it points at is not ours to sweep.
    let real_base = std::fs::symlink_metadata(&base).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink());
    if let (true, Ok(entries)) = (real_base, std::fs::read_dir(&base)) {
        for e in entries.flatten() {
            if !e.file_type().is_ok_and(|t| t.is_dir()) {
                continue;
            }
            let dir = e.path();
            let Ok(record) = std::fs::read_to_string(dir.join(RECORD)) else { continue };
            let wt = Path::new(record.trim());
            // A record that is not an absolute place (it would be read against the app's own folder), or
            // a folder not named after its record, is not one this build made.
            if !wt.is_absolute() || e.file_name().to_string_lossy() != key(wt) {
                continue;
            }
            match wt.try_exists() {
                Ok(true) => {
                    let _ = std::fs::remove_file(dir.join(MISSING));
                }
                // Missing with the folder above it there (a mount point left behind, a deleted worktree):
                // the clock runs. With the folder above it missing too (a drive that is not plugged in, a
                // share that is away) nothing is deleted, ever, and an earlier note is dropped so the clock
                // starts over when the folder above comes back.
                Ok(false) if now > 0 => {
                    let above = wt.parent().is_some_and(|p| !p.as_os_str().is_empty() && matches!(p.try_exists(), Ok(true)));
                    if !above {
                        let _ = std::fs::remove_file(dir.join(MISSING));
                        continue;
                    }
                    match std::fs::read_to_string(dir.join(MISSING)).ok().and_then(|s| s.trim().parse::<u64>().ok()) {
                        Some(since) if now.saturating_sub(since) >= grace => {
                            if std::fs::remove_dir_all(&dir).is_ok() {
                                removed += 1;
                            }
                        }
                        Some(_) => {}
                        None => {
                            let _ = std::fs::write(dir.join(MISSING), now.to_string());
                        }
                    }
                }
                // "Cannot tell" (a share that does not respond) changes nothing.
                _ => {}
            }
        }
    }
    // Fish sessions are named after the folder: any this build made without a folder are leftovers.
    // A history folder that exists but is not a real folder (a link, a file) cannot tell which
    // sessions are leftovers, so none is touched then.
    let prefix = format!("{FISH_PREFIX}{}_", build_tag(data));
    let unreadable = std::fs::symlink_metadata(&base).is_ok() && !real_base;
    if let (false, Some(fish)) = (unreadable, fish) {
        for e in std::fs::read_dir(fish).into_iter().flatten().flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            // `<tail>_<hex>` back to the folder's `<tail>-<hex>`; both parts are alphanumeric.
            let Some((tail, hex)) = name.strip_prefix(&prefix).and_then(|n| n.strip_suffix("_history")).and_then(|n| n.rsplit_once('_')) else { continue };
            if !base.join(format!("{tail}-{hex}")).is_dir() && std::fs::remove_file(e.path()).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

/// The start-up sweep: once per run, off the thread that opens the pane.
fn sweep_once(data: &Path, fish: Option<PathBuf>) {
    static ONCE: OnceLock<()> = OnceLock::new();
    ONCE.get_or_init(|| {
        let data = data.to_path_buf();
        std::thread::spawn(move || {
            sweep(&data, fish.as_deref());
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_dir::temp;

    fn shell(program: &str, cwd: &Path) -> CommandBuilder {
        let mut c = CommandBuilder::new(program);
        // The test machine's own variables must not decide the outcome.
        c.env_remove("HISTFILE");
        c.env_remove("fish_history");
        c.cwd(cwd);
        c
    }

    /// Nothing is chosen by the pane's own variables.
    fn none(_: &str) -> bool {
        false
    }

    fn worktree(parent: &Path, name: &str) -> PathBuf {
        let d = parent.join(name);
        std::fs::create_dir_all(d.join(".git")).unwrap();
        d
    }

    #[test]
    fn term119_the_setting_is_on_unless_switched_off() {
        assert!(enabled(&serde_json::json!({})));
        assert!(enabled(&serde_json::json!({ FIELD: true })));
        assert!(!enabled(&serde_json::json!({ FIELD: false })));
    }

    #[test]
    fn term119_a_subfolder_belongs_to_the_worktree_above_it_and_each_worktree_has_its_own_key() {
        let t = temp("term119-key");
        let a = worktree(&t, "alpha");
        let b = worktree(&t, "beta");
        std::fs::create_dir_all(a.join("src/deep")).unwrap();
        assert_eq!(worktree_root(&a.join("src/deep")), a);
        // A linked worktree has a `.git` file, not a folder.
        let linked = t.join("linked");
        std::fs::create_dir_all(&linked).unwrap();
        std::fs::write(linked.join(".git"), "gitdir: elsewhere").unwrap();
        assert_eq!(worktree_root(&linked), linked);
        assert_ne!(key(&a), key(&b));
        assert_eq!(key(&worktree_root(&a.join("src"))), key(&a));
        assert!(key(&a).starts_with("alpha-") && key(&a).len() == "alpha-".len() + 16);
        // Spelling does not change the key.
        assert_eq!(key(Path::new("/w/Repo/")), key(Path::new("/w/Repo")));
        assert_eq!(key(Path::new(r"\\?\C:\w\repo")), key(Path::new("C:/w/repo")));
        assert!(key(Path::new("/")).starts_with("root-"));
    }

    #[test]
    fn term119_bash_and_zsh_get_a_history_file_per_worktree_and_fish_a_session() {
        let t = temp("term119-vars");
        let data = t.join("data");
        let a = worktree(&t, "a");
        let b = worktree(&t, "b");
        let var = |prog: &str, wt: &Path| history_var(&shell(prog, wt), &data, &none).unwrap();
        let (name, bash_a) = var("bash", &a);
        let (_, bash_b) = var("bash.exe", &b);
        assert_eq!(name, "HISTFILE");
        assert_ne!(bash_a, bash_b);
        let bash_a = bash_a.to_string_lossy().to_string();
        assert!(bash_a.ends_with("/bash_history") && !bash_a.contains('\\'), "{bash_a}");
        assert!(bash_a.contains(&key(&a)));
        let (name, zsh_a) = var("/usr/bin/zsh", &a);
        assert_eq!(name, "HISTFILE");
        assert!(zsh_a.to_string_lossy().ends_with("/zsh_history"));
        let (name, fish_a) = var("fish", &a);
        let (_, fish_b) = var("fish", &b);
        assert_eq!(name, "fish_history");
        assert_ne!(fish_a, fish_b);
        let fish_a = fish_a.to_string_lossy().to_string();
        // Fish takes a session name only when it is letters, digits and underscores; any other name
        // makes it print an error and fall back to the shared history.
        assert!(fish_a.starts_with("kolux_") && !fish_a.is_empty() && fish_a.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'), "{fish_a}");
        assert!(fish_a.ends_with(&key(&a).replace('-', "_")), "{fish_a}");
        // The folder and its record are there, and the record names the worktree.
        let dir = data.join(DIR).join(key(&a));
        assert_eq!(normal(Path::new(std::fs::read_to_string(dir.join(RECORD)).unwrap().trim())), normal(&a));
    }

    #[test]
    fn term119_command_prompt_powershell_wsl_and_unknown_shells_are_left_alone() {
        let t = temp("term119-other");
        let data = t.join("data");
        let a = worktree(&t, "a");
        for prog in ["cmd.exe", "powershell.exe", "pwsh", "sh", "nu", "wsl.exe", r"C:\Windows\System32\bash.exe", r"C:\Users\x\AppData\Local\Microsoft\WindowsApps\bash.exe", "C:/Users/x/AppData/Local/Microsoft/WindowsApps/zsh", "claude"] {
            assert!(history_var(&shell(prog, &a), &data, &none).is_none(), "{prog}");
        }
        assert!(!data.exists(), "nothing is made for a shell that is left alone");
    }

    #[test]
    fn term119_a_history_the_user_set_keeps_being_used() {
        let t = temp("term119-user");
        let data = t.join("data");
        let a = worktree(&t, "a");
        // Set on the command itself (the environment the pane starts from).
        for (prog, name) in [("bash", "HISTFILE"), ("fish", "fish_history"), ("zsh", "HISTFILE")] {
            let mut c = shell(prog, &a);
            // An empty value is a choice as well.
            c.env(name, "");
            assert!(history_var(&c, &data, &none).is_none(), "{prog}");
        }
        // Set in the pane's own variables, which are put on the command later.
        let own = |k: &str| k == "HISTFILE";
        assert!(history_var(&shell("bash", &a), &data, &own).is_none());
        assert!(!data.join(DIR).exists(), "no folder is made when the user chose");
        assert!(history_var(&shell("fish", &a), &data, &own).is_some(), "fish has its own variable");
        // Without a choice, the variable names this worktree.
        let (name, v) = history_var(&shell("bash", &a), &data, &none).unwrap();
        assert!(name == "HISTFILE" && v.to_string_lossy().contains(&key(&a)));
    }

    #[test]
    fn term119_plan_gives_each_command_its_own_answer_and_sweeps_only_the_folders_given() {
        let t = temp("term119-plan");
        let data = t.join("data");
        let a = worktree(&t, "a");
        let cmds = [shell("bash", &a), shell("cmd.exe", &a), shell("fish", &a)];
        // The sweep reads only the data folder and the fish folder it is given (none here), so no home
        // folder is read by construction; the test itself asserts only the answers.
        let got = plan(&cmds, &data, None, &none);
        assert_eq!(got.len(), 3);
        assert_eq!(got[0].as_ref().map(|v| v.0), Some("HISTFILE"));
        assert!(got[1].is_none());
        assert_eq!(got[2].as_ref().map(|v| v.0), Some("fish_history"));
        let own = |k: &str| k == "HISTFILE" || k == "fish_history";
        assert!(plan(&cmds, &data, None, &own).iter().all(Option::is_none));
    }

    #[cfg(unix)]
    #[test]
    fn term119_the_history_folder_is_private_to_the_user() {
        use std::os::unix::fs::PermissionsExt;
        let t = temp("term119-private");
        let data = t.join("data");
        let a = worktree(&t, "a");
        history_var(&shell("bash", &a), &data, &none).unwrap();
        let mode = std::fs::metadata(data.join(DIR).join(key(&a))).unwrap().permissions().mode();
        assert_eq!(mode & 0o077, 0, "{mode:o}");
    }

    #[test]
    fn term119_the_sweep_removes_a_deleted_worktrees_history_and_leftover_fish_sessions() {
        let t = temp("term119-sweep");
        let data = t.join("data");
        let fish = t.join("fish");
        std::fs::create_dir_all(&fish).unwrap();
        let live = worktree(&t, "live");
        let dead = worktree(&t, "dead");
        for wt in [&live, &dead] {
            for prog in ["bash", "fish"] {
                let (_, v) = history_var(&shell(prog, wt), &data, &none).unwrap();
                if prog == "bash" {
                    std::fs::write(Path::new(&v), "echo hi").unwrap();
                } else {
                    std::fs::write(fish.join(format!("{}_history", v.to_string_lossy())), "- cmd: x").unwrap();
                }
            }
        }
        // Another build's session and the user's own sessions are not ours to touch.
        std::fs::write(fish.join("kolux_ffffff_other_0000000000000000_history"), "x").unwrap();
        std::fs::write(fish.join("fish_history"), "x").unwrap();
        std::fs::remove_dir_all(&dead).unwrap();
        // The first sweep that finds a worktree missing only notes the time; nothing is removed.
        assert_eq!(sweep_at(&data, Some(&fish), T0, GRACE_SECS), 0);
        assert!(data.join(DIR).join(key(&dead)).is_dir());
        // A later one, after the grace period, removes the deleted worktree's folder and fish session.
        assert_eq!(sweep_at(&data, Some(&fish), T0 + GRACE_SECS, GRACE_SECS), 2);
        assert!(!data.join(DIR).join(key(&dead)).exists());
        assert!(data.join(DIR).join(key(&live)).join("bash_history").is_file());
        let left: Vec<String> = std::fs::read_dir(&fish).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        assert_eq!(left.len(), 3, "{left:?}");
        assert!(left.iter().any(|n| n.ends_with(&format!("{}_history", key(&live).replace('-', "_")))));
        assert!(left.contains(&"fish_history".to_string()) && left.contains(&"kolux_ffffff_other_0000000000000000_history".to_string()));
        // Nothing to sweep is not an error.
        assert_eq!(sweep(&t.join("nowhere"), None), 0);
    }

    /// A pretend clock for the sweep tests (seconds).
    const T0: u64 = 1_000_000;
    const DAY: u64 = 24 * 3600;

    fn stamp(data: &Path, wt: &Path) -> PathBuf {
        data.join(DIR).join(key(wt)).join(MISSING)
    }

    #[test]
    fn term119_a_worktree_on_a_mount_that_goes_away_and_comes_back_keeps_its_history() {
        let t = temp("term119-mount");
        let data = t.join("data");
        // A mount point is a folder that stays behind, empty, when the drive under it is unmounted.
        let mount = t.join("mnt");
        let wt = worktree(&mount, "proj");
        let (_, v) = history_var(&shell("bash", &wt), &data, &none).unwrap();
        std::fs::write(Path::new(&v), "echo precious").unwrap();
        let kept = || data.join(DIR).join(key(&wt)).join("bash_history").is_file();
        // The drive goes away: the mount point is there, the worktree is not.
        std::fs::remove_dir_all(&wt).unwrap();
        assert!(mount.is_dir() && !wt.exists());
        assert_eq!(sweep_at(&data, None, T0, GRACE_SECS), 0);
        assert!(kept(), "the first sweep that finds it missing must keep it");
        assert!(stamp(&data, &wt).is_file(), "and note when it went missing");
        assert_eq!(sweep_at(&data, None, T0 + DAY, GRACE_SECS), 0);
        assert!(kept());
        // The drive comes back: the history is still there and the note is gone.
        std::fs::create_dir_all(wt.join(".git")).unwrap();
        assert_eq!(sweep_at(&data, None, T0 + 2 * DAY, GRACE_SECS), 0);
        assert!(kept() && !stamp(&data, &wt).exists(), "a worktree that is back clears the note");
        // Missing again, long after the first time: the earlier absence does not count, the clock starts over.
        std::fs::remove_dir_all(&wt).unwrap();
        let again = T0 + 2 * GRACE_SECS;
        assert_eq!(sweep_at(&data, None, again, GRACE_SECS), 0);
        assert!(kept());
        assert_eq!(sweep_at(&data, None, again + GRACE_SECS - 1, GRACE_SECS), 0);
        assert!(kept(), "one second short of the grace period");
        // Missing for the whole grace period across sweeps: it is a deleted worktree now.
        assert_eq!(sweep_at(&data, None, again + GRACE_SECS, GRACE_SECS), 1);
        assert!(!data.join(DIR).join(key(&wt)).exists());
    }

    #[test]
    fn term119_a_drive_letter_or_mount_that_is_not_there_at_all_keeps_its_history() {
        let t = temp("term119-nodrive");
        let data = t.join("data");
        let gone = Path::new(if cfg!(windows) { r"Q:\no\such\drive\wt" } else { "/no/such/mount/point/wt" });
        let dir = data.join(DIR).join(key(gone));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(RECORD), gone.to_string_lossy().as_bytes()).unwrap();
        std::fs::write(dir.join("bash_history"), "x").unwrap();
        // The folder above the worktree is not there either (an unplugged drive): no note is made and
        // the history survives the grace period twice over, as it did before the note existed.
        assert_eq!(sweep_at(&data, None, T0, GRACE_SECS), 0);
        assert!(!dir.join(MISSING).exists(), "no note when the folder above the worktree is not there");
        assert_eq!(sweep_at(&data, None, T0 + GRACE_SECS - 1, GRACE_SECS), 0);
        assert_eq!(sweep_at(&data, None, T0 + 2 * GRACE_SECS, GRACE_SECS), 0);
        assert_eq!(sweep_at(&data, None, T0 + 10 * GRACE_SECS, GRACE_SECS), 0);
        assert!(dir.join("bash_history").is_file());
        // A clock that went backwards removes nothing.
        assert_eq!(sweep_at(&data, None, T0 - 5, GRACE_SECS), 0);
        assert!(dir.is_dir());
    }

    #[test]
    fn term119_a_note_from_before_the_drive_went_away_does_not_count_when_it_comes_back_empty() {
        let t = temp("term119-stale-note");
        let data = t.join("data");
        let mount = t.join("mnt");
        let wt = worktree(&mount, "proj");
        let (_, v) = history_var(&shell("bash", &wt), &data, &none).unwrap();
        std::fs::write(Path::new(&v), "echo precious").unwrap();
        let kept = || data.join(DIR).join(key(&wt)).join("bash_history").is_file();
        // The worktree goes missing under a mount point that is there: the note is made.
        std::fs::remove_dir_all(&wt).unwrap();
        assert_eq!(sweep_at(&data, None, T0, GRACE_SECS), 0);
        assert!(stamp(&data, &wt).is_file());
        // The whole mount then goes away (nothing above the worktree): the note is dropped, not aged.
        std::fs::remove_dir_all(&mount).unwrap();
        assert_eq!(sweep_at(&data, None, T0 + DAY, GRACE_SECS), 0);
        assert!(!stamp(&data, &wt).exists());
        // The mount comes back empty after the old note's 30 days: the clock starts over, nothing goes.
        std::fs::create_dir_all(&mount).unwrap();
        assert_eq!(sweep_at(&data, None, T0 + GRACE_SECS, GRACE_SECS), 0);
        assert!(kept());
        assert_eq!(sweep_at(&data, None, T0 + 2 * GRACE_SECS, GRACE_SECS), 1);
    }

    #[test]
    fn term119_starting_a_pane_in_a_worktree_clears_its_missing_note() {
        let t = temp("term119-pane-clears");
        let data = t.join("data");
        let mount = t.join("mnt");
        let wt = worktree(&mount, "proj");
        let (_, v) = history_var(&shell("bash", &wt), &data, &none).unwrap();
        std::fs::write(Path::new(&v), "echo precious").unwrap();
        let kept = || data.join(DIR).join(key(&wt)).join("bash_history").is_file();
        // Day 1: the share is not mounted yet when Kolux starts, so the sweep notes the time.
        std::fs::remove_dir_all(&wt).unwrap();
        assert_eq!(sweep_at(&data, None, T0, GRACE_SECS), 0);
        assert!(stamp(&data, &wt).is_file());
        // The user mounts it and works in the worktree: a pane starts there.
        std::fs::create_dir_all(wt.join(".git")).unwrap();
        history_var(&shell("bash", &wt), &data, &none).unwrap();
        assert!(!stamp(&data, &wt).exists(), "using the worktree clears the note");
        // Later it is missing again at a start-up 30 days after day 1: a fresh note, not a removal.
        std::fs::remove_dir_all(&wt).unwrap();
        assert_eq!(sweep_at(&data, None, T0 + GRACE_SECS, GRACE_SECS), 0);
        assert!(kept());
        assert!(stamp(&data, &wt).is_file());
    }

    #[test]
    fn term119_the_fish_sessions_are_left_alone_when_the_history_folder_is_a_link() {
        let t = temp("term119-fish-link");
        let data = t.join("data");
        let fish = t.join("fish");
        std::fs::create_dir_all(&fish).unwrap();
        let wt = worktree(&t, "wt");
        let (_, v) = history_var(&shell("fish", &wt), &data, &none).unwrap();
        let session = fish.join(format!("{}_history", v.to_string_lossy()));
        std::fs::write(&session, "- cmd: x").unwrap();
        // The history folder is replaced by a link to somewhere else that holds none of the folders.
        std::fs::remove_dir_all(data.join(DIR)).unwrap();
        let elsewhere = t.join("elsewhere");
        std::fs::create_dir_all(&elsewhere).unwrap();
        if !link_dir(&elsewhere, &data.join(DIR)) {
            eprintln!("term119: SKIPPED the fish link check, no folder link could be made here");
            return;
        }
        assert_eq!(sweep_at(&data, Some(&fish), T0, GRACE_SECS), 0);
        assert!(session.is_file(), "a history folder that cannot be read as ours must not cost a fish session");
        // With a real history folder that lacks the worktree's folder, the session is a leftover.
        std::fs::remove_dir(data.join(DIR)).unwrap();
        std::fs::create_dir_all(data.join(DIR)).unwrap();
        assert_eq!(sweep_at(&data, Some(&fish), T0, GRACE_SECS), 1);
        assert!(!session.exists());
    }

    /// Makes `link` a folder link to `target` (a symbolic link on Unix, a junction on Windows).
    fn link_dir(target: &Path, link: &Path) -> bool {
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(target, link).is_ok()
        }
        #[cfg(windows)]
        {
            std::process::Command::new("cmd").arg("/C").arg("mklink").arg("/J").arg(link).arg(target).output().map(|o| o.status.success()).unwrap_or(false)
        }
    }

    #[test]
    fn term119_the_sweep_leaves_alone_what_is_not_a_real_folder_named_after_its_record() {
        let t = temp("term119-guard");
        let data = t.join("data");
        let base = data.join(DIR);
        std::fs::create_dir_all(&base).unwrap();
        let missing = t.join("missing_wt");
        let plant = |name: &str, record: &str| {
            let d = base.join(name);
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join(RECORD), record).unwrap();
            std::fs::write(d.join("bash_history"), "x").unwrap();
            d
        };
        // A folder whose name is not the key of the worktree its record names.
        let wrong = plant("not-the-key-0000000000000000", &missing.to_string_lossy());
        // A record that names no absolute place (a relative one would be read against the app's own folder).
        let relative = plant(&key(Path::new("src/missing_wt")), "src/missing_wt");
        // A real, matching entry for the same missing worktree, to prove the sweep does run here.
        let real = plant(&key(&missing), &missing.to_string_lossy());
        for now in [T0, T0 + GRACE_SECS] {
            sweep_at(&data, None, now, GRACE_SECS);
        }
        assert!(wrong.join("bash_history").is_file() && relative.join("bash_history").is_file());
        assert!(!real.exists(), "the matching entry is removed after the grace period");
        // An entry that is a link, and a history folder that is a link, are never followed.
        let elsewhere = t.join("elsewhere");
        let inside = elsewhere.join(key(&missing));
        std::fs::create_dir_all(&inside).unwrap();
        std::fs::write(inside.join(RECORD), missing.to_string_lossy().as_bytes()).unwrap();
        std::fs::write(inside.join("bash_history"), "x").unwrap();
        if !link_dir(&inside, &base.join(key(&missing))) {
            eprintln!("term119: SKIPPED the link check, no folder link could be made here");
            return;
        }
        let data2 = t.join("data2");
        std::fs::create_dir_all(&data2).unwrap();
        assert!(link_dir(&elsewhere, &data2.join(DIR)));
        for now in [T0, T0 + GRACE_SECS] {
            sweep_at(&data, None, now, GRACE_SECS);
            sweep_at(&data2, None, now, GRACE_SECS);
        }
        assert!(inside.join("bash_history").is_file(), "an entry that is a link is not followed");
        assert!(!inside.join(MISSING).exists(), "and no note is written through it");
        assert!(elsewhere.join(key(&missing)).join("bash_history").is_file(), "a history folder that is a link is not followed");
    }

    #[test]
    fn term119_a_verbatim_unc_share_is_recorded_and_keyed_as_the_share_it_is() {
        let verbatim = Path::new(r"\\?\UNC\server\share\proj");
        assert_eq!(normal_record(verbatim), r"\\server\share\proj");
        assert_eq!(key(verbatim), key(Path::new(r"\\server\share\proj")));
        assert_eq!(normal_record(Path::new(r"\\?\C:\w\repo")), r"C:\w\repo");
        assert_eq!(normal_record(Path::new(r"\\server\share\proj")), r"\\server\share\proj");
    }

    #[test]
    fn term119_fish_keeps_its_sessions_in_the_xdg_folder_else_the_home_one() {
        assert_eq!(fish_dir(Some("/x".into()), Some("/h".into())), Some(PathBuf::from("/x").join("fish")));
        assert_eq!(fish_dir(Some("".into()), Some("/h".into())), Some(PathBuf::from("/h").join(".local/share/fish")));
        assert_eq!(fish_dir(None, None), None);
    }

    /// Git Bash on this PC (not the WSL launcher), when it is installed.
    fn git_bash() -> Option<PathBuf> {
        ["C:/Program Files/Git/bin/bash.exe", "C:/Program Files (x86)/Git/bin/bash.exe", "/bin/bash", "/usr/bin/bash"].iter().map(PathBuf::from).find(|p| p.is_file())
    }

    /// Runs `bash -i` with the pane's variables and a few typed lines, then lets it exit (which is
    /// when bash writes its history).
    fn run_bash(bash: &Path, cwd: &Path, data: &Path, extra: Option<(&str, &Path)>, typed: &str) {
        use std::io::Write;
        let mut pane = shell(&bash.to_string_lossy(), cwd);
        if let Some((k, v)) = extra {
            pane.env(k, v);
        }
        if let Some((k, v)) = history_var(&pane, data, &none) {
            pane.env(k, v);
        }
        let mut cmd = std::process::Command::new(bash);
        cmd.arg("-i").current_dir(cwd).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        cmd.env_remove("HISTFILE");
        // The throwaway home keeps the real history and start-up files out of it (SAFETY RULE).
        cmd.env("HOME", data.parent().unwrap()).env("USERPROFILE", data.parent().unwrap());
        for (k, v) in pane.iter_full_env_as_str() {
            if k == "HISTFILE" {
                cmd.env(k, v);
            }
        }
        let mut child = cmd.spawn().unwrap();
        child.stdin.take().unwrap().write_all(format!("{typed}\nexit\n").as_bytes()).unwrap();
        assert!(child.wait().is_ok());
    }

    #[test]
    fn term119_a_real_bash_keeps_each_worktrees_commands_apart() {
        let Some(bash) = git_bash() else {
            eprintln!("term119: SKIPPED the real-bash check, no bash found here (this pass is not proof of it)");
            return;
        };
        let t = temp("term119-bash");
        let data = t.join("home").join("data");
        std::fs::create_dir_all(&data).unwrap();
        let a = worktree(&t, "wt-a");
        let b = worktree(&t, "wt-b");
        run_bash(&bash, &a, &data, None, "echo only_in_worktree_a");
        run_bash(&bash, &b, &data, None, "echo only_in_worktree_b");
        let read = |wt: &Path| std::fs::read_to_string(data.join(DIR).join(key(wt)).join("bash_history")).unwrap();
        assert!(read(&a).contains("only_in_worktree_a") && !read(&a).contains("only_in_worktree_b"), "{}", read(&a));
        assert!(read(&b).contains("only_in_worktree_b") && !read(&b).contains("only_in_worktree_a"), "{}", read(&b));
        // A second shell in A starts with A's earlier commands (the up arrow has them).
        run_bash(&bash, &a, &data, None, "echo second_in_a");
        assert!(read(&a).contains("only_in_worktree_a") && read(&a).contains("second_in_a"));
        // The throwaway home got no history file of its own from these runs.
        assert!(!t.join("home").join(".bash_history").exists());
        // A user's own file is the one used, and ours is not made.
        let mine = t.join("mine_history");
        let c = worktree(&t, "wt-c");
        run_bash(&bash, &c, &data, Some(("HISTFILE", &mine)), "echo into_my_file");
        assert!(std::fs::read_to_string(&mine).unwrap().contains("into_my_file"));
        assert!(!data.join(DIR).join(key(&c)).exists());
    }
}
