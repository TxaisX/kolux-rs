//! Shell integration for terminal panes (ACCT-047, ACCT-065; the marks feed TERM-058).
//!
//! A shell Kolux starts is wrapped so it says in band when it is ready: it prints the
//! FinalTerm-style prompt marks (`OSC 133 ; A` before each prompt, `OSC 133 ; C` when a command
//! starts, `OSC 133 ; D ; <exit>` when it ends) that terminals such as VS Code, WezTerm, Kitty and
//! iTerm2 read. The user's own configuration files are still honoured: every wrapper hands over to
//! them first and only adds the hooks. The pane (`src/terminal/shellMarks.ts`) scans the output
//! for the marks, holds the shell's output back until the first prompt, and types the startup
//! command exactly once when the shell is ready (or hands it over by bracketed paste when it is
//! long or full of quotes).
//!
//! ACCT-065: on macOS and Linux a chosen shell that is only a name is passed through to the
//! program search path untouched; a chosen full path that is missing or cannot run falls back to
//! zsh, then bash, then sh, and `pty::PtySession::spawn_first` names every shell it tried when none
//! starts.
//!
//! Until the coordinator applies evidence/sessions-T-104-b-terminal.rs.patch (which calls `wrap`
//! and `write_files` from the pane spawn) and evidence/sessions-T-104-b-pty.rs.patch (the Unix
//! chain), nothing on the lane reaches this module.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

/// The kind of shell a pane runs, by its program name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellKind {
    Zsh,
    Bash,
    Fish,
    /// PowerShell 7 or Windows PowerShell.
    PowerShell,
}

impl ShellKind {
    /// The kind for a program path or name; None for shells without hooks (sh, dash, cmd, wsl).
    pub fn of(program: &str) -> Option<ShellKind> {
        let stem = Path::new(program.trim().trim_matches('"')).file_stem()?.to_string_lossy().to_ascii_lowercase();
        match stem.as_str() {
            "zsh" => Some(ShellKind::Zsh),
            "bash" => Some(ShellKind::Bash),
            "fish" => Some(ShellKind::Fish),
            "pwsh" | "powershell" => Some(ShellKind::PowerShell),
            _ => None,
        }
    }
}

/// The wrapper for one shell start: extra arguments (replacing `login` where the wrapper takes it
/// over), variables to set and files to have on disk before the shell starts.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Wrapped {
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub files: Vec<(PathBuf, String)>,
}

/// The variable that keeps the user's own ZDOTDIR while Kolux's shim is the one zsh reads.
pub const USER_ZDOTDIR: &str = "KOLUX_USER_ZDOTDIR";
/// The variable the bash shim reads to know whether to act as a login shell.
pub const BASH_LOGIN: &str = "KOLUX_BASH_LOGIN";

const MARK_PROMPT: &str = r"\e]133;D;%s\a\e]133;A\a";
const MARK_START: &str = r"\e]133;C\a";

/// How `kind` is started so that it prints the prompt marks and still reads the user's files.
/// `args` are the shell's own arguments as planned so far (a `-l`/`--login` among them makes it
/// a login shell); `dir` is Kolux's folder for the shim files; `user_zdotdir` is the ZDOTDIR the
/// user already had, when any. `startup` is run by a PowerShell wrapper after the hook is set
/// (the encoded route of ACCT-047); the other shells get it typed by the pane once ready.
pub fn wrap(kind: ShellKind, args: &[String], dir: &Path, user_zdotdir: Option<&str>, startup: Option<&str>) -> Wrapped {
    let login = args.iter().any(|a| a == "-l" || a == "--login");
    match kind {
        ShellKind::Zsh => {
            let shim = shim_str(dir, &["zsh"]);
            let mut env = vec![("ZDOTDIR".to_string(), shim)];
            if let Some(u) = user_zdotdir.filter(|u| !u.trim().is_empty()) {
                env.push((USER_ZDOTDIR.to_string(), u.to_string()));
            }
            let files = [".zshenv", ".zprofile", ".zshrc", ".zlogin"].iter().map(|f| (dir.join("zsh").join(f), zsh_shim(f))).collect();
            Wrapped { args: args.to_vec(), env, files }
        }
        ShellKind::Bash => {
            // --rcfile is ignored by a login bash, so the shim does the login files itself.
            let mut out: Vec<String> = args.iter().filter(|a| *a != "-l" && *a != "--login").cloned().collect();
            out.push("--rcfile".to_string());
            out.push(shim_str(dir, &["bash", "kolux.bash"]));
            let env = vec![(BASH_LOGIN.to_string(), if login { "1" } else { "0" }.to_string())];
            Wrapped { args: out, env, files: vec![(dir.join("bash").join("kolux.bash"), bash_shim())] }
        }
        ShellKind::Fish => {
            let mut out = args.to_vec();
            out.push("--init-command".to_string());
            out.push(format!("source '{}'", shim_str(dir, &["fish", "kolux.fish"]).replace('\'', "\\'")));
            Wrapped { args: out, env: Vec::new(), files: vec![(dir.join("fish").join("kolux.fish"), fish_shim())] }
        }
        ShellKind::PowerShell => {
            let mut out: Vec<String> = args.iter().filter(|a| !a.eq_ignore_ascii_case("-NoExit") && !a.eq_ignore_ascii_case("-EncodedCommand") && !a.eq_ignore_ascii_case("-Command")).cloned().collect();
            out.push("-NoExit".to_string());
            out.push("-EncodedCommand".to_string());
            out.push(encoded_powershell(&powershell_hook(startup)));
            Wrapped { args: out, env: Vec::new(), files: Vec::new() }
        }
    }
}

/// A shim path as a shell sees it: forward slashes whatever the host (Git Bash and every Unix
/// shell read them; a backslash would be an escape in the shell text).
fn shim_str(dir: &Path, rel: &[&str]) -> String {
    let mut s = dir.to_string_lossy().replace('\\', "/");
    while s.len() > 1 && s.ends_with('/') {
        s.pop();
    }
    for r in rel {
        s.push('/');
        s.push_str(r);
    }
    s
}

/// A zsh shim file: hands over to the user's file of the same name (from their own ZDOTDIR, else
/// the home folder), then, in .zshrc, installs the prompt hooks.
fn zsh_shim(name: &str) -> String {
    let mut s = String::new();
    s.push_str("# Kolux shell integration (ACCT-047): your own ");
    s.push_str(name);
    s.push_str(" runs first; Kolux only adds prompt marks.\n");
    s.push_str("__kolux_user_zdotdir=\"${KOLUX_USER_ZDOTDIR:-$HOME}\"\n");
    s.push_str("if [[ -f \"$__kolux_user_zdotdir/");
    s.push_str(name);
    s.push_str("\" ]]; then\n  __kolux_shim=\"$ZDOTDIR\"\n  ZDOTDIR=\"$__kolux_user_zdotdir\"\n  . \"$__kolux_user_zdotdir/");
    s.push_str(name);
    s.push_str("\"\n  ZDOTDIR=\"$__kolux_shim\"\n  unset __kolux_shim\nfi\n");
    if name == ".zshrc" {
        s.push_str("autoload -Uz add-zsh-hook\n");
        s.push_str("__kolux_precmd() { local r=$?; printf '");
        s.push_str(MARK_PROMPT);
        s.push_str("' \"$r\"; return $r; }\n");
        s.push_str("__kolux_preexec() { printf '");
        s.push_str(MARK_START);
        s.push_str("'; }\n");
        s.push_str("add-zsh-hook precmd __kolux_precmd\nadd-zsh-hook preexec __kolux_preexec\n");
    }
    if name == ".zlogin" {
        // The last file zsh reads: from here on the user's own ZDOTDIR is theirs again.
        s.push_str("if [[ -n \"${KOLUX_USER_ZDOTDIR-}\" ]]; then ZDOTDIR=\"$KOLUX_USER_ZDOTDIR\"; else unset ZDOTDIR; fi\nunset KOLUX_USER_ZDOTDIR\n");
    }
    s
}

/// The bash shim: the login files (when the shell was asked to be a login shell) or ~/.bashrc,
/// then the prompt marks through PROMPT_COMMAND and a guarded DEBUG trap for the command start.
fn bash_shim() -> String {
    let mut s = String::from("# Kolux shell integration (ACCT-047): your own bash files run first; Kolux only adds prompt marks.\n");
    s.push_str("if [ \"${KOLUX_BASH_LOGIN-0}\" = 1 ]; then\n");
    s.push_str("  [ -f /etc/profile ] && . /etc/profile\n");
    s.push_str("  for __kolux_f in \"$HOME/.bash_profile\" \"$HOME/.bash_login\" \"$HOME/.profile\"; do\n");
    s.push_str("    if [ -f \"$__kolux_f\" ]; then . \"$__kolux_f\"; break; fi\n  done\n  unset __kolux_f\n");
    s.push_str("else\n  [ -f \"$HOME/.bashrc\" ] && . \"$HOME/.bashrc\"\nfi\nunset KOLUX_BASH_LOGIN\n");
    s.push_str("__kolux_prompt() { local r=$?; __kolux_in_prompt=1; printf '");
    s.push_str(MARK_PROMPT);
    s.push_str("' \"$r\"; return $r; }\n");
    s.push_str("__kolux_prompt_end() { __kolux_in_prompt=0; __kolux_ran=0; }\n");
    s.push_str("__kolux_preexec() {\n  case \"$BASH_COMMAND\" in __kolux_*) return;; esac\n");
    s.push_str("  [ \"${__kolux_in_prompt-0}\" = 1 ] && return\n  [ \"${__kolux_ran-0}\" = 1 ] && return\n  __kolux_ran=1; printf '");
    s.push_str(MARK_START);
    s.push_str("'\n}\n");
    s.push_str("PROMPT_COMMAND=\"__kolux_prompt${PROMPT_COMMAND:+;$PROMPT_COMMAND};__kolux_prompt_end\"\n");
    s.push_str("trap '__kolux_preexec' DEBUG\n");
    s
}

/// The fish shim: fish runs it after the user's config.fish (that is what --init-command does).
fn fish_shim() -> String {
    let mut s = String::from("# Kolux shell integration (ACCT-047): runs after your config.fish; Kolux only adds prompt marks.\n");
    s.push_str("function __kolux_prompt --on-event fish_prompt\n    printf '");
    s.push_str(MARK_PROMPT);
    s.push_str("' $status\nend\n");
    s.push_str("function __kolux_preexec --on-event fish_preexec\n    printf '");
    s.push_str(MARK_START);
    s.push_str("'\nend\n");
    s
}

/// The PowerShell script run with -NoExit after the profile: wraps the prompt function so each
/// prompt carries the marks, then runs the startup command once (the encoded route of ACCT-047).
pub fn powershell_hook(startup: Option<&str>) -> String {
    let mut s = String::from("$global:__koluxPrompt = $function:prompt\n");
    s.push_str("function global:prompt { $e = [char]27; $b = [char]7; $c = if ($global:LASTEXITCODE) { $global:LASTEXITCODE } else { 0 }; \"$e]133;D;$c$b$e]133;A$b\" + (& $global:__koluxPrompt) }\n");
    if let Some(cmd) = startup.map(str::trim).filter(|c| !c.is_empty()) {
        s.push_str(cmd);
        s.push('\n');
    }
    s
}

/// `script` as PowerShell's -EncodedCommand argument: base64 of the UTF-16LE text, the only form
/// that carries quotes and line breaks through any argument quoting untouched.
pub fn encoded_powershell(script: &str) -> String {
    use base64::Engine;
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// Whether `command` should be typed as it is, or handed over whole by bracketed paste: long
/// lines, quotes, backslashes or line breaks never go through the line editor one key at a time.
pub fn typed_as_is(command: &str) -> bool {
    command.len() <= 160 && !command.contains(['"', '\'', '\\', '\n', '\r', '`'])
}

/// ACCT-065: the shells a macOS or Linux pane tries, in order. A `chosen` shell given only by name
/// is passed through alone (the search path or the start folder finds it); a chosen full path that
/// `runnable` rejects is skipped, and zsh, bash and sh (from the login shell's folder and the
/// standard folders) follow as fallbacks. The list never repeats a path.
pub fn unix_shell_chain(chosen: Option<(&str, &[String])>, login_shell: Option<&str>, runnable: impl Fn(&Path) -> bool) -> Vec<(PathBuf, Vec<String>)> {
    let mut out: Vec<(PathBuf, Vec<String>)> = Vec::new();
    if let Some((c, args)) = chosen.filter(|(c, _)| !c.trim().is_empty()) {
        let c = c.trim();
        if !c.contains('/') {
            return vec![(PathBuf::from(c), args.to_vec())];
        }
        if runnable(Path::new(c)) {
            out.push((PathBuf::from(c), args.to_vec()));
        }
    }
    let mut push = |p: PathBuf| {
        if runnable(&p) && !out.iter().any(|(q, _)| *q == p) {
            out.push((p, Vec::new()));
        }
    };
    if let Some(l) = login_shell.filter(|l| l.contains('/')) {
        push(PathBuf::from(l));
    }
    for name in ["zsh", "bash", "sh"] {
        for dir in ["/bin", "/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"] {
            push(PathBuf::from(format!("{dir}/{name}")));
        }
    }
    out
}

/// ACCT-065: the message when none of `tried` would start: it names every shell attempted.
pub fn none_started(tried: &[(PathBuf, String)]) -> String {
    if tried.is_empty() {
        return "No shell would start: no shell was found to try.".to_string();
    }
    format!("No shell would start. Kolux tried {}.", tried.iter().map(|(p, e)| format!("{} ({e})", p.display())).collect::<Vec<_>>().join(", "))
}

/// ACCT-047: wraps a shell start in place: `command`'s arguments are rewritten and its variables
/// set so the shell prints the prompt marks, with the shim files under `dir`. A shell without
/// hooks, or one whose shim files cannot be written, runs as it is (better a plain shell than no
/// pane). Returns the kind that was wrapped.
pub fn apply(command: &mut portable_pty::CommandBuilder, dir: &Path) -> Option<ShellKind> {
    let argv = command.get_argv();
    let kind = ShellKind::of(&argv.first()?.to_string_lossy())?;
    let args: Vec<String> = argv.iter().skip(1).map(|a| a.to_string_lossy().into_owned()).collect();
    let user_zdotdir = command.get_env("ZDOTDIR").map(|v| v.to_string_lossy().into_owned()).or_else(|| std::env::var("ZDOTDIR").ok());
    let w = wrap(kind, &args, dir, user_zdotdir.as_deref(), None);
    write_files(&w.files).ok()?;
    let argv = command.get_argv_mut();
    argv.truncate(1);
    argv.extend(w.args.iter().map(std::ffi::OsString::from));
    for (k, v) in w.env {
        command.env(k, v);
    }
    Some(kind)
}

/// Writes the wrapper files, each only when its text changed (a user watching the folder sees no
/// churn), and makes their folders.
pub fn write_files(files: &[(PathBuf, String)]) -> Result<(), String> {
    for (path, text) in files {
        if std::fs::read_to_string(path).is_ok_and(|have| have == *text) {
            continue;
        }
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        }
        std::fs::write(path, text).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn acct047_shell_kind_by_program_name() {
        assert_eq!(ShellKind::of("/bin/zsh"), Some(ShellKind::Zsh));
        assert_eq!(ShellKind::of("C:\\Program Files\\Git\\bin\\bash.exe"), Some(ShellKind::Bash));
        assert_eq!(ShellKind::of("\"C:\\Program Files\\PowerShell\\7\\pwsh.exe\""), Some(ShellKind::PowerShell));
        assert_eq!(ShellKind::of("powershell.exe"), Some(ShellKind::PowerShell));
        assert_eq!(ShellKind::of("fish"), Some(ShellKind::Fish));
        assert_eq!(ShellKind::of("/bin/sh"), None, "sh has no hooks");
        assert_eq!(ShellKind::of("cmd.exe"), None);
        assert_eq!(ShellKind::of(""), None);
    }

    #[test]
    fn acct047_zsh_shim_keeps_the_users_files_and_marks_the_prompt() {
        let w = wrap(ShellKind::Zsh, &s(&["-l"]), Path::new("/tmp/kolux"), Some("/home/u/.config/zsh"), None);
        assert_eq!(w.args, s(&["-l"]), "a login zsh keeps its flag: the shim's .zprofile/.zlogin hand over");
        assert!(w.env.contains(&("ZDOTDIR".to_string(), "/tmp/kolux/zsh".to_string())));
        assert!(w.env.contains(&(USER_ZDOTDIR.to_string(), "/home/u/.config/zsh".to_string())));
        let names: Vec<_> = w.files.iter().map(|(p, _)| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(names, [".zshenv", ".zprofile", ".zshrc", ".zlogin"]);
        let zshrc = &w.files[2].1;
        assert!(zshrc.contains(". \"$__kolux_user_zdotdir/.zshrc\""), "the user's .zshrc is sourced");
        assert!(zshrc.contains("add-zsh-hook precmd __kolux_precmd"));
        assert!(zshrc.contains("add-zsh-hook preexec __kolux_preexec"));
        assert!(zshrc.contains(r"\e]133;A\a") && zshrc.contains(r"\e]133;D;%s\a") && zshrc.contains(r"\e]133;C\a"));
        assert!(zshrc.contains("local r=$?") && zshrc.contains("return $r"), "the user's prompt still sees the exit code");
        assert!(w.files[3].1.contains("ZDOTDIR=\"$KOLUX_USER_ZDOTDIR\""), ".zlogin gives ZDOTDIR back");
        // Without a user ZDOTDIR the shim falls back to the home folder and sets no stale variable.
        let plain = wrap(ShellKind::Zsh, &[], Path::new("/tmp/kolux"), None, None);
        assert!(!plain.env.iter().any(|(k, _)| k == USER_ZDOTDIR));
        assert!(plain.files[0].1.contains("${KOLUX_USER_ZDOTDIR:-$HOME}"));
    }

    #[test]
    fn acct047_bash_shim_takes_login_over_and_guards_the_debug_trap() {
        let w = wrap(ShellKind::Bash, &s(&["-l"]), Path::new("/tmp/kolux"), None, None);
        assert_eq!(w.args, s(&["--rcfile", "/tmp/kolux/bash/kolux.bash"]), "-l goes: --rcfile is ignored by a login bash");
        assert_eq!(w.env, vec![(BASH_LOGIN.to_string(), "1".to_string())]);
        let rc = &w.files[0].1;
        assert!(rc.contains("/etc/profile") && rc.contains(".bash_profile") && rc.contains(".bash_login") && rc.contains(".profile"), "login files");
        assert!(rc.contains("$HOME/.bashrc"), "interactive file");
        assert!(rc.contains("PROMPT_COMMAND=\"__kolux_prompt${PROMPT_COMMAND:+;$PROMPT_COMMAND};__kolux_prompt_end\""));
        assert!(rc.contains("trap '__kolux_preexec' DEBUG"));
        assert!(rc.contains("case \"$BASH_COMMAND\" in __kolux_*) return;; esac"), "Kolux's own prompt functions never count as a command start");
        let plain = wrap(ShellKind::Bash, &[], Path::new("/tmp/kolux"), None, None);
        assert_eq!(plain.env, vec![(BASH_LOGIN.to_string(), "0".to_string())]);
    }

    #[test]
    fn acct047_fish_runs_the_shim_after_the_users_config() {
        let w = wrap(ShellKind::Fish, &s(&["-l"]), Path::new("/tmp/ko lux"), None, None);
        assert_eq!(w.args, s(&["-l", "--init-command", "source '/tmp/ko lux/fish/kolux.fish'"]));
        assert!(w.env.is_empty());
        let f = &w.files[0].1;
        assert!(f.contains("--on-event fish_prompt") && f.contains("--on-event fish_preexec"));
        assert!(f.contains("$status"));
    }

    #[test]
    fn acct047_powershell_hook_is_encoded_and_carries_the_startup_command_intact() {
        let startup = "claude \"fix the 'quoted' bug\" --model opus";
        let w = wrap(ShellKind::PowerShell, &s(&["-NoLogo"]), Path::new("C:\\k"), None, Some(startup));
        assert_eq!(&w.args[..3], &s(&["-NoLogo", "-NoExit", "-EncodedCommand"])[..]);
        assert_eq!(w.args.len(), 4);
        assert!(w.files.is_empty() && w.env.is_empty());
        // Decode the way PowerShell does: base64, then UTF-16LE.
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD.decode(&w.args[3]).unwrap();
        let units: Vec<u16> = bytes.chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        let script = String::from_utf16(&units).unwrap();
        assert!(script.contains("function global:prompt"));
        assert!(script.contains("]133;D;$c$b$e]133;A$b"));
        assert_eq!(script.matches(startup).count(), 1, "the startup command is there once, unchanged");
        assert!(script.ends_with(&format!("{startup}\n")));
        let none = powershell_hook(Some("   "));
        assert!(!none.contains("   \n"), "a blank startup adds nothing");
        assert_eq!(encoded_powershell("hi"), "aABpAA==");
    }

    #[test]
    fn acct047_long_or_quoted_commands_are_not_typed() {
        assert!(typed_as_is("claude"));
        assert!(typed_as_is("codex --model o3 resume"));
        assert!(!typed_as_is("claude \"a prompt\""));
        assert!(!typed_as_is("echo it's"));
        assert!(!typed_as_is("a\\b"));
        assert!(!typed_as_is("line one\nline two"));
        assert!(!typed_as_is(&"x".repeat(161)));
        assert!(typed_as_is(&"x".repeat(160)));
    }

    #[test]
    fn acct065_bare_name_passes_through_and_a_missing_path_falls_back() {
        let have = |p: &Path| matches!(p.to_str(), Some("/bin/zsh" | "/bin/bash" | "/bin/sh" | "/usr/local/bin/fish"));
        // Bare name: untouched, no fallbacks (the search path finds it or the start says so).
        assert_eq!(unix_shell_chain(Some(("bash", &s(&["-l"]))), Some("/bin/zsh"), have), vec![(PathBuf::from("bash"), s(&["-l"]))]);
        // A full path that is gone: zsh, bash, sh in that order, the login shell first when it runs.
        let chain = unix_shell_chain(Some(("/opt/gone/nu", &[])), Some("/bin/zsh"), have);
        assert_eq!(chain.iter().map(|(p, _)| p.to_string_lossy().into_owned()).collect::<Vec<_>>(), ["/bin/zsh", "/bin/bash", "/bin/sh"]);
        // A full path that runs: first, then the fallbacks behind it, never twice.
        let chain = unix_shell_chain(Some(("/usr/local/bin/fish", &s(&["-l"]))), Some("/usr/local/bin/fish"), have);
        assert_eq!(chain[0], (PathBuf::from("/usr/local/bin/fish"), s(&["-l"])));
        assert_eq!(chain.iter().filter(|(p, _)| p.ends_with("fish")).count(), 1);
        assert_eq!(chain.len(), 4);
        // Nothing chosen: the login shell then the standard three.
        let chain = unix_shell_chain(None, Some("/bin/bash"), have);
        assert_eq!(chain.iter().map(|(p, _)| p.to_string_lossy().into_owned()).collect::<Vec<_>>(), ["/bin/bash", "/bin/zsh", "/bin/sh"]);
        // No usable shell at all: an empty chain, and the message says so.
        assert!(unix_shell_chain(Some(("/x/y", &[])), Some("/x/z"), |_| false).is_empty());
        assert_eq!(none_started(&[]), "No shell would start: no shell was found to try.");
        let msg = none_started(&[(PathBuf::from("/x/y"), "not found".into()), (PathBuf::from("/bin/zsh"), "permission denied".into())]);
        assert_eq!(msg, "No shell would start. Kolux tried /x/y (not found), /bin/zsh (permission denied).");
    }

    #[test]
    fn acct047_apply_rewrites_a_shell_start_in_place_and_leaves_hookless_shells_alone() {
        let dir = std::env::temp_dir().join(format!("kolux-shell-apply-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut zsh = portable_pty::CommandBuilder::new("/bin/zsh");
        zsh.arg("-l");
        zsh.env("ZDOTDIR", "/home/u/zdot");
        zsh.cwd("/repo");
        assert_eq!(apply(&mut zsh, &dir), Some(ShellKind::Zsh));
        let argv: Vec<String> = zsh.get_argv().iter().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(argv, s(&["/bin/zsh", "-l"]));
        assert_eq!(zsh.get_env("ZDOTDIR").unwrap().to_string_lossy(), shim_str(&dir, &["zsh"]));
        assert_eq!(zsh.get_env(USER_ZDOTDIR).unwrap().to_string_lossy(), "/home/u/zdot", "the user's own ZDOTDIR is kept for the shim");
        assert_eq!(zsh.get_cwd().unwrap().to_string_lossy(), "/repo", "the start folder stays");
        assert!(dir.join("zsh").join(".zshrc").is_file(), "the shim files are on disk before the shell starts");
        let mut bash = portable_pty::CommandBuilder::new("bash");
        bash.arg("--login");
        assert_eq!(apply(&mut bash, &dir), Some(ShellKind::Bash));
        let argv: Vec<String> = bash.get_argv().iter().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(argv, s(&["bash", "--rcfile", &shim_str(&dir, &["bash", "kolux.bash"])]));
        assert_eq!(bash.get_env(BASH_LOGIN).unwrap().to_string_lossy(), "1");
        let mut cmd = portable_pty::CommandBuilder::new("cmd.exe");
        cmd.args(["/d", "/k"]);
        assert_eq!(apply(&mut cmd, &dir), None);
        assert_eq!(cmd.get_argv().len(), 3, "a shell without hooks is untouched");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn acct047_write_files_makes_folders_and_rewrites_only_on_change() {
        let dir = std::env::temp_dir().join(format!("kolux-shell-marks-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let w = wrap(ShellKind::Zsh, &[], &dir, None, None);
        write_files(&w.files).unwrap();
        let p = dir.join("zsh").join(".zshrc");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), w.files[2].1);
        let before = std::fs::metadata(&p).unwrap().modified().unwrap();
        write_files(&w.files).unwrap();
        assert_eq!(std::fs::metadata(&p).unwrap().modified().unwrap(), before, "unchanged text is not rewritten");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
