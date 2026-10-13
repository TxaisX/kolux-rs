//! PROJ-033: a project's setup script, `scripts.setup` in the worktree's kolux.yaml, and the line
//! that runs it in a Setup terminal. A first line naming a POSIX shell (`#!/bin/bash -e`,
//! `#!/usr/bin/env sh`) runs it through that shell with the flags it declares; otherwise the
//! configured shell when that is a POSIX one; otherwise, on Windows, the command prompt, which
//! is refused a script it would misread (more than one line, `%`, `^` or `"`). Windows line
//! endings are accepted. The rest of kolux.yaml comes with PROJ-034 (T-149), so `scripts.setup`
//! is read with a small line scanner like the shared-folders list.
use std::path::{Path, PathBuf};

/// How the Setup terminal starts: the program, its arguments, and the script it runs.
#[derive(serde::Serialize, Debug, PartialEq, Clone)]
pub struct SetupLine {
    pub program: String,
    pub args: Vec<String>,
    pub script: String,
}

const POSIX: [&str; 7] = ["sh", "bash", "dash", "zsh", "ksh", "ash", "mksh"];

fn is_posix(program: &str) -> bool {
    let stem = Path::new(program).file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    POSIX.contains(&stem.as_str())
}

/// `scripts.setup` from kolux.yaml's text: a plain or quoted value on its line, or a `|` / `>`
/// block of the lines indented under it. None when there is none or it is blank.
pub fn setup_script(yaml: &str) -> Option<String> {
    let indent = |l: &str| l.len() - l.trim_start().len();
    let lines: Vec<&str> = yaml.lines().map(|l| l.trim_end_matches('\r')).collect();
    let mut in_scripts = false;
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let ind = indent(line);
        if ind == 0 {
            in_scripts = t == "scripts:";
            continue;
        }
        if !in_scripts {
            continue;
        }
        let Some(rest) = t.strip_prefix("setup:") else { continue };
        let rest = rest.trim();
        let script = if rest.starts_with('|') || rest.starts_with('>') {
            let body: Vec<&str> = lines[i + 1..].iter().take_while(|l| l.trim().is_empty() || indent(l) > ind).copied().collect();
            let cut = body.iter().filter(|l| !l.trim().is_empty()).map(|l| indent(l)).min().unwrap_or(0);
            let kept: Vec<&str> = body.iter().map(|l| l.get(cut..).unwrap_or("")).collect();
            if rest.starts_with('>') {
                kept.iter().map(|l| l.trim()).filter(|l| !l.is_empty()).collect::<Vec<_>>().join(" ")
            } else {
                kept.join("\n").trim_end().to_string()
            }
        } else {
            let quoted = rest.strip_prefix('"').and_then(|r| r.strip_suffix('"')).or_else(|| rest.strip_prefix('\'').and_then(|r| r.strip_suffix('\'')));
            quoted.map(str::to_string).unwrap_or_else(|| rest.split(" #").next().unwrap_or("").trim().to_string())
        };
        return Some(script).filter(|s| !s.trim().is_empty());
    }
    None
}

/// The shell a first `#!` line names and the flags it declares, when that shell is a POSIX one.
fn shebang(script: &str) -> Option<(String, Vec<String>)> {
    let first = script.lines().next()?.strip_prefix("#!")?;
    let mut words = first.split_whitespace();
    let mut program = words.next()?.to_string();
    if Path::new(&program).file_name().is_some_and(|n| n == "env") {
        program = words.by_ref().find(|w| !w.starts_with('-'))?.to_string();
    }
    is_posix(&program).then(|| (program, words.map(str::to_string).collect()))
}

/// What in a script the command prompt would misread, if anything.
fn cmd_trouble(script: &str) -> Option<&'static str> {
    if script.trim_end().contains('\n') {
        Some("it has more than one line, and cmd runs only the first")
    } else if script.contains('%') {
        Some("cmd would expand its % signs")
    } else if script.contains('^') {
        Some("cmd would drop its ^ signs")
    } else if script.contains('"') {
        Some("its quotes would reach cmd escaped")
    } else {
        None
    }
}

/// The line that runs `script`. `configured` is the shell a new terminal gets; `find` finds a
/// POSIX shell a `#!` line names (on Windows, Git's own bash, never WSL's launcher).
pub fn setup_line(script: &str, windows: bool, configured: Option<&Path>, find: impl Fn(&str) -> Option<PathBuf>) -> Result<SetupLine, String> {
    let script = script.replace("\r\n", "\n");
    let line = |program: String, mut args: Vec<String>| {
        args.extend(["-c".to_string(), script.clone()]);
        SetupLine { program, args, script: script.clone() }
    };
    if let Some((shell, flags)) = shebang(&script) {
        let name = Path::new(&shell).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| shell.clone());
        let program = if windows {
            find(&name).ok_or_else(|| format!("The setup script asks for {name}, which was not found; install Git for Windows, or drop its #! line"))?.to_string_lossy().into_owned()
        } else {
            shell
        };
        return Ok(line(program, flags));
    }
    if let Some(shell) = configured.filter(|p| is_posix(&p.to_string_lossy())) {
        return Ok(line(shell.to_string_lossy().into_owned(), Vec::new()));
    }
    if !windows {
        return Ok(line("sh".into(), Vec::new()));
    }
    if let Some(why) = cmd_trouble(&script) {
        return Err(format!("The setup script was not run: it would go through cmd, and {why}. Start it with a #!/bin/sh line to run it through Git Bash."));
    }
    let script = script.trim_end().to_string();
    Ok(SetupLine { program: "cmd.exe".into(), args: vec!["/d".into(), "/s".into(), "/c".into(), script.clone()], script })
}

/// A POSIX shell by name on Windows: Git for Windows' own copy first, then one on the search
/// path that is not System32's WSL launcher.
fn find_posix(name: &str) -> Option<PathBuf> {
    let git = std::env::var_os("ProgramFiles").map(|p| PathBuf::from(p).join("Git").join("bin").join(format!("{name}.exe"))).filter(|p| p.is_file());
    git.or_else(|| crate::agents::find_program(name).filter(|p| !p.to_string_lossy().to_lowercase().contains("system32")))
}

/// PROJ-033: the Setup terminal's line for the worktree at `path`; None when its kolux.yaml has
/// no setup script; an error when the script cannot be run as written.
#[tauri::command(async)]
pub fn workspace_setup(path: String) -> Result<Option<SetupLine>, String> {
    let Ok(text) = std::fs::read_to_string(Path::new(&path).join(crate::include::CONFIG_FILE)) else { return Ok(None) };
    let Some(script) = setup_script(&text) else { return Ok(None) };
    let configured = crate::pty::auto_shells(crate::agents::find_program, std::env::var_os("ComSpec").map(PathBuf::from)).into_iter().next().map(|(p, _)| p);
    setup_line(&script, cfg!(windows), configured.as_deref(), find_posix).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proj033_the_setup_script_is_read_from_kolux_yaml() {
        assert_eq!(setup_script("scripts:\n  setup: pnpm i\nworktree:\n  x: 1\n").as_deref(), Some("pnpm i"));
        assert_eq!(setup_script("scripts:\r\n  setup: \"pnpm i # not a comment\"\r\n").as_deref(), Some("pnpm i # not a comment"));
        assert_eq!(setup_script("scripts:\n  setup: pnpm i # a comment\n").as_deref(), Some("pnpm i"));
        assert_eq!(setup_script("scripts:\n  other: 1\n  setup: |\n    #!/bin/bash -e\n    pnpm i\n\n    echo ok\nnext: 2\n").as_deref(), Some("#!/bin/bash -e\npnpm i\n\necho ok"));
        assert_eq!(setup_script("scripts:\n  setup: >\n    pnpm i\n    --frozen-lockfile\n").as_deref(), Some("pnpm i --frozen-lockfile"));
        assert_eq!(setup_script("worktree:\n  setup: no\nscripts:\n  run: x\n"), None, "only scripts.setup counts");
        assert_eq!(setup_script("scripts:\n  setup: ''\n"), None);
        assert_eq!(setup_script("scripts: {}\n"), None);
    }

    #[test]
    fn proj033_a_posix_first_line_runs_through_that_shell_with_its_flags() {
        let bash = |n: &str| (n == "bash").then(|| PathBuf::from("C:/Git/bin/bash.exe"));
        let l = setup_line("#!/bin/bash -e\r\npnpm i\r\n", true, Some(Path::new("powershell.exe")), bash).unwrap();
        assert_eq!(l.program, "C:/Git/bin/bash.exe");
        assert_eq!(l.args, ["-e", "-c", "#!/bin/bash -e\npnpm i\n"], "Windows line endings are accepted");
        let l = setup_line("#!/usr/bin/env bash\nmake", true, None, bash).unwrap();
        assert_eq!(l.program, "C:/Git/bin/bash.exe");
        assert_eq!(l.args[0], "-c");
        assert!(setup_line("#!/bin/zsh\nx", true, None, bash).unwrap_err().contains("zsh, which was not found"));
        assert_eq!(setup_line("#!/bin/sh\nx", false, None, bash).unwrap().program, "/bin/sh");
    }

    #[test]
    fn proj033_other_interpreters_are_not_posix_and_cmd_refuses_what_it_would_misread() {
        let none = |_: &str| None;
        // a python first line is not a POSIX shell: it goes the configured shell's way, here cmd
        assert!(setup_line("#!/usr/bin/env python\nprint(1)", true, Some(Path::new("powershell.exe")), none).unwrap_err().contains("more than one line"));
        let l = setup_line("pnpm i && pnpm build\r\n", true, Some(Path::new("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe")), none).unwrap();
        assert_eq!(l.program, "cmd.exe");
        assert_eq!(l.args, ["/d", "/s", "/c", "pnpm i && pnpm build"]);
        assert!(setup_line("echo %PATH%", true, None, none).unwrap_err().contains("% signs"));
        assert!(setup_line("echo a^b", true, None, none).unwrap_err().contains("^"));
        assert!(setup_line("echo \"hi\"", true, None, none).unwrap_err().contains("quotes"));
        // a configured POSIX shell takes the script as it is, quotes and all
        let l = setup_line("echo \"%x\"\necho y", true, Some(Path::new("C:/Git/bin/bash.exe")), none).unwrap();
        assert_eq!(l.args, ["-c", "echo \"%x\"\necho y"]);
        assert_eq!(setup_line("echo hi", false, Some(Path::new("/usr/bin/fish")), none).unwrap().program, "sh");
    }
}
