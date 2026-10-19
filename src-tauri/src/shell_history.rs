//! TERM-119: a shell's up arrow shows the commands run in this worktree only. A bash or zsh pane is
//! handed its own history file (`HISTFILE`) and a fish pane its own history session
//! (`fish_history`), both named after the worktree the pane starts in. Command Prompt, PowerShell,
//! WSL and any shell not listed are left alone, and a history file the user already set (in the
//! environment the pane starts from, or in the pane's own variables) is respected.
//!
//! The files live in Kolux's own data folder under `shell-history/<worktree key>/`, a folder only
//! the user can open on a Unix system (on Windows it inherits the profile's own private rights).
//! A folder is removed at start-up when the worktree it belongs to is gone, and so is its fish
//! session file, which fish keeps in its own data folder.
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
/// is also called bash.exe but is a different program that does not take the variable along.
fn kind_of(program: &Path) -> Option<Kind> {
    if program.components().any(|c| c.as_os_str().eq_ignore_ascii_case("system32")) {
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
    let s = s.strip_prefix("//?/").unwrap_or(&s).trim_end_matches('/').to_string();
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

/// The variable a pane's shell gets, when it is one of the three and nothing has chosen its history
/// already: `(name, value)`. The worktree's folder and its record are made as a side effect.
fn history_var(command: &CommandBuilder, data: &Path) -> Option<(&'static str, OsString)> {
    let argv0 = command.get_argv().first()?;
    let kind = kind_of(Path::new(argv0))?;
    let name = match kind {
        Kind::Bash | Kind::Zsh => "HISTFILE",
        Kind::Fish => "fish_history",
    };
    // A history the user set is respected. An empty value is a choice too (bash keeps no file then).
    if command.get_env(name).is_some() {
        return None;
    }
    let cwd = command.get_cwd().map(PathBuf::from)?;
    let root = worktree_root(&cwd);
    let key = key(&root);
    let dir = data.join(DIR).join(&key);
    make_private(&dir).ok()?;
    let record = dir.join(RECORD);
    if !record.is_file() {
        std::fs::write(&record, normal_record(&root)).ok()?;
    }
    Some(match kind {
        Kind::Bash => (name, shell_path(&dir.join("bash_history"))),
        Kind::Zsh => (name, shell_path(&dir.join("zsh_history"))),
        Kind::Fish => (name, format!("{FISH_PREFIX}{}_{key}", build_tag(data)).into()),
    })
}

/// What the record file holds: the worktree's folder as the OS spells it.
fn normal_record(root: &Path) -> String {
    root.to_string_lossy().trim_start_matches(r"\\?\").to_string()
}

/// Scopes this pane's history to its worktree. Call it on each shell command before it starts, after
/// the pane's own variables are on the command; does nothing for another shell, when the user chose a
/// history, or when the folder cannot be made. The first call in a run also starts the sweep.
pub fn apply(command: &mut CommandBuilder, data: &Path) {
    sweep_once(data);
    if let Some((name, value)) = history_var(command, data) {
        command.env(name, value);
    }
}

/// Removes what a deleted worktree left: its history folder in `data`, and the fish session of any
/// folder that is gone. A worktree counts as deleted only when its folder is missing while the folder
/// above it is there, so an unplugged drive or a network share that does not answer keeps its history.
/// Returns how many files and folders were removed.
pub fn sweep(data: &Path, fish: Option<&Path>) -> usize {
    let base = data.join(DIR);
    let mut removed = 0;
    if let Ok(entries) = std::fs::read_dir(&base) {
        for e in entries.flatten() {
            let dir = e.path();
            let Ok(record) = std::fs::read_to_string(dir.join(RECORD)) else { continue };
            let wt = Path::new(record.trim());
            let gone = matches!(wt.try_exists(), Ok(false)) && wt.parent().is_some_and(|p| !p.as_os_str().is_empty() && matches!(p.try_exists(), Ok(true)));
            if gone && std::fs::remove_dir_all(&dir).is_ok() {
                removed += 1;
            }
        }
    }
    // Fish sessions are named after the folder: any this build made without a folder are leftovers.
    let prefix = format!("{FISH_PREFIX}{}_", build_tag(data));
    if let Some(fish) = fish {
        for e in std::fs::read_dir(fish).into_iter().flatten().flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let Some(key) = name.strip_prefix(&prefix).and_then(|n| n.strip_suffix("_history")) else { continue };
            if !base.join(key).is_dir() && std::fs::remove_file(e.path()).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

/// The start-up sweep: once per run, off the thread that opens the pane.
fn sweep_once(data: &Path) {
    static ONCE: OnceLock<()> = OnceLock::new();
    ONCE.get_or_init(|| {
        let data = data.to_path_buf();
        let fish = fish_dir(std::env::var_os("XDG_DATA_HOME"), crate::pty::home_dir());
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
        let var = |prog: &str, wt: &Path| history_var(&shell(prog, wt), &data).unwrap();
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
        assert!(fish_a.starts_with("kolux_") && fish_a.ends_with(&key(&a)), "{fish_a}");
        // The folder and its record are there, and the record names the worktree.
        let dir = data.join(DIR).join(key(&a));
        assert_eq!(normal(Path::new(std::fs::read_to_string(dir.join(RECORD)).unwrap().trim())), normal(&a));
    }

    #[test]
    fn term119_command_prompt_powershell_wsl_and_unknown_shells_are_left_alone() {
        let t = temp("term119-other");
        let data = t.join("data");
        let a = worktree(&t, "a");
        for prog in ["cmd.exe", "powershell.exe", "pwsh", "sh", "nu", "wsl.exe", r"C:\Windows\System32\bash.exe", "claude"] {
            assert!(history_var(&shell(prog, &a), &data).is_none(), "{prog}");
        }
        assert!(!data.exists(), "nothing is made for a shell that is left alone");
    }

    #[test]
    fn term119_a_history_the_user_set_keeps_being_used() {
        let t = temp("term119-user");
        let data = t.join("data");
        let a = worktree(&t, "a");
        let mut bash = shell("bash", &a);
        bash.env("HISTFILE", "/home/me/.my_history");
        apply(&mut bash, &data);
        assert_eq!(bash.get_env("HISTFILE").unwrap(), "/home/me/.my_history");
        let mut fish = shell("fish", &a);
        fish.env("fish_history", "mine");
        apply(&mut fish, &data);
        assert_eq!(fish.get_env("fish_history").unwrap(), "mine");
        // Left empty on purpose is a choice as well.
        let mut zsh = shell("zsh", &a);
        zsh.env("HISTFILE", "");
        apply(&mut zsh, &data);
        assert_eq!(zsh.get_env("HISTFILE").unwrap(), "");
        assert!(!data.join(DIR).exists());
        // Without a choice, apply sets it.
        let mut plain = shell("bash", &a);
        apply(&mut plain, &data);
        assert!(plain.get_env("HISTFILE").unwrap().to_string_lossy().contains(&key(&a)));
    }

    #[cfg(unix)]
    #[test]
    fn term119_the_history_folder_is_private_to_the_user() {
        use std::os::unix::fs::PermissionsExt;
        let t = temp("term119-private");
        let data = t.join("data");
        let a = worktree(&t, "a");
        history_var(&shell("bash", &a), &data).unwrap();
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
                let (_, v) = history_var(&shell(prog, wt), &data).unwrap();
                if prog == "bash" {
                    std::fs::write(Path::new(&v), "echo hi").unwrap();
                } else {
                    std::fs::write(fish.join(format!("{}_history", v.to_string_lossy())), "- cmd: x").unwrap();
                }
            }
        }
        // Another build's session and the user's own sessions are not ours to touch.
        std::fs::write(fish.join("kolux_ffffff_other-0000000000000000_history"), "x").unwrap();
        std::fs::write(fish.join("fish_history"), "x").unwrap();
        std::fs::remove_dir_all(&dead).unwrap();
        // A worktree on a place that is not there at all (an unplugged drive) is kept.
        let away = data.join(DIR).join("away-0000000000000000");
        std::fs::create_dir_all(&away).unwrap();
        std::fs::write(away.join(RECORD), if cfg!(windows) { r"Q:\no\such\drive\wt" } else { "/no/such/mount/point/wt" }).unwrap();
        assert_eq!(sweep(&data, Some(&fish)), 2);
        assert!(!data.join(DIR).join(key(&dead)).exists());
        assert!(data.join(DIR).join(key(&live)).join("bash_history").is_file());
        assert!(away.is_dir());
        let left: Vec<String> = std::fs::read_dir(&fish).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        assert_eq!(left.len(), 3, "{left:?}");
        assert!(left.iter().any(|n| n.ends_with(&format!("{}_history", key(&live)))));
        assert!(left.contains(&"fish_history".to_string()) && left.contains(&"kolux_ffffff_other-0000000000000000_history".to_string()));
        // Nothing to sweep is not an error.
        assert_eq!(sweep(&t.join("nowhere"), None), 0);
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
        if let Some((k, v)) = history_var(&pane, data) {
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
        let Some(bash) = git_bash() else { return };
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
