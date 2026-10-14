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
    scripts_entry(yaml, "setup")
}

/// `scripts.<key>` from kolux.yaml's text, read the way `setup_script` reads `scripts.setup`.
pub fn scripts_entry(yaml: &str, key: &str) -> Option<String> {
    yaml_entry(yaml, Some("scripts"), key)
}

/// PROJ-036: a top-level kolux.yaml value such as `issueCommand`, read the same way.
pub fn top_entry(yaml: &str, key: &str) -> Option<String> {
    yaml_entry(yaml, None, key)
}

/// `key` at the top level (`parent` None) or one level under `parent:`; plain, quoted or block.
fn yaml_entry(yaml: &str, parent: Option<&str>, key: &str) -> Option<String> {
    let prefix = format!("{key}:");
    let head = parent.map(|p| format!("{p}:"));
    let indent = |l: &str| l.len() - l.trim_start().len();
    let lines: Vec<&str> = yaml.lines().map(|l| l.trim_end_matches('\r')).collect();
    let mut in_scripts = false;
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let ind = indent(line);
        match &head {
            Some(h) if ind == 0 => {
                in_scripts = t == h;
                continue;
            }
            Some(_) if !in_scripts => continue,
            None if ind > 0 => continue,
            _ => {}
        }
        let Some(rest) = t.strip_prefix(prefix.as_str()) else { continue };
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
    // STAT-055: a Windows batch file runs under the classic command prompt even when the shell is Git Bash.
    let first = script.split_whitespace().next().unwrap_or("").trim_matches('"').to_ascii_lowercase();
    let batch = windows && (first.ends_with(".bat") || first.ends_with(".cmd"));
    if let Some(shell) = configured.filter(|p| !batch && is_posix(&p.to_string_lossy())) {
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

/// The shell a new terminal gets, as setup and archive lines are built for it.
fn configured_shell() -> Option<PathBuf> {
    crate::pty::auto_shells(crate::agents::find_program, std::env::var_os("ComSpec").map(PathBuf::from)).into_iter().next().map(|(p, _)| p)
}

/// STAT-055: where a project's setup script comes from. By default the script kept in Kolux's
/// own settings for the repository wins even when kolux.yaml has one; the older shared-first
/// policy (`shared`) takes kolux.yaml's only. The bool says whether the script is the shared one.
pub fn pick_setup(local: Option<&str>, shared: Option<String>, policy: Option<&str>) -> Option<(String, bool)> {
    let local = local.map(|l| l.replace("\r\n", "\n")).filter(|l| !l.trim().is_empty());
    match policy {
        Some("shared") | Some("shared-first") => shared.map(|s| (s, true)),
        _ => local.map(|l| (l, false)).or_else(|| shared.map(|s| (s, true))),
    }
}

/// STAT-055: the main folder of the repository the worktree at `worktree` belongs to, read from
/// its `.git` file (`gitdir: <main>/.git/worktrees/<name>`); the folder itself otherwise.
pub fn main_folder(worktree: &Path) -> PathBuf {
    let gitdir = std::fs::read_to_string(worktree.join(".git")).ok().and_then(|t| t.lines().next().and_then(|l| l.strip_prefix("gitdir:")).map(|d| PathBuf::from(d.trim())));
    gitdir
        .as_deref()
        .and_then(Path::parent)
        .filter(|p| p.file_name().is_some_and(|n| n == "worktrees"))
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| worktree.to_path_buf())
}

/// STAT-055 / COMPAT 5.5: the variables a setup or archive script is given.
pub fn script_vars(root: &Path, worktree: &Path) -> Vec<(&'static str, String)> {
    let name = worktree.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    vec![("KOLUX_ROOT_PATH", root.to_string_lossy().into_owned()), ("KOLUX_WORKTREE_PATH", worktree.to_string_lossy().into_owned()), ("KOLUX_WORKSPACE_NAME", name)]
}

/// STAT-055: conda's variables, cleared for a script when the environment is only partly active.
pub const CONDA_VARS: [&str; 4] = ["CONDA_PREFIX", "CONDA_DEFAULT_ENV", "CONDA_SHLVL", "CONDA_PROMPT_MODIFIER"];

/// STAT-055: a conda environment named in CONDA_PREFIX whose folder is not on the search path is
/// only partly active, and a script must not inherit it.
pub fn conda_partial(prefix: Option<&str>, path: &str) -> bool {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_lowercase();
    let Some(p) = prefix.map(norm).filter(|p| !p.is_empty()) else { return false };
    !std::env::split_paths(path).any(|d| norm(&d.to_string_lossy()).starts_with(&p))
}

fn conda_now() -> bool {
    conda_partial(std::env::var("CONDA_PREFIX").ok().as_deref(), &std::env::var("PATH").unwrap_or_default())
}

/// STAT-055: `line` with `vars` set and `unset` cleared ahead of its script, so a Setup terminal
/// started from it sees them: `export` lines for a POSIX shell, `set NAME=value&&` for cmd (a value
/// cmd would misread is left out there). The script itself (`line.script`) is unchanged.
pub fn with_env(mut line: SetupLine, vars: &[(&str, String)], unset: &[&str]) -> SetupLine {
    let cmd = line.program.eq_ignore_ascii_case("cmd.exe");
    let Some(last) = line.args.last_mut() else { return line };
    let pre: String = if cmd {
        let plain = |v: &str| !v.chars().any(|c| "&|<>^%\"\r\n".contains(c));
        vars.iter().filter(|(_, v)| plain(v)).map(|(k, v)| format!("set {k}={v}&& ")).chain(unset.iter().map(|k| format!("set {k}=&& "))).collect()
    } else {
        let quote = |v: &str| format!("'{}'", v.replace('\'', "'\\''"));
        let mut s: String = vars.iter().map(|(k, v)| format!("export {k}={}\n", quote(v))).collect();
        if !unset.is_empty() {
            s.push_str(&format!("unset {}\n", unset.join(" ")));
        }
        s
    };
    *last = format!("{pre}{last}");
    line
}

/// STAT-055: the Setup terminal's line for the worktree at `path`: its setup script from
/// `local` (Kolux's own setting for the repository) or the worktree's kolux.yaml as `policy`
/// says, with the setup variables set.
#[tauri::command(async)]
pub fn workspace_setup(path: String, local: Option<String>, policy: Option<String>) -> Result<Option<SetupLine>, String> {
    let wt = Path::new(&path);
    let shared = std::fs::read_to_string(wt.join(crate::include::CONFIG_FILE)).ok().and_then(|t| setup_script(&t));
    let Some((script, _)) = pick_setup(local.as_deref(), shared, policy.as_deref()) else { return Ok(None) };
    let line = setup_line(&script, cfg!(windows), configured_shell().as_deref(), find_posix)?;
    let unset: &[&str] = if conda_now() { &CONDA_VARS } else { &[] };
    Ok(Some(with_env(line, &script_vars(&main_folder(wt), wt), unset)))
}

/// STAT-055: runs kolux.yaml's archive script (read from the worktree being removed; OD-14: no
/// per-repository archive setting) in that worktree with the script variables, before it goes,
/// and waits up to `limit`. None when there is none; the exit code when it ran.
pub fn run_archive(root: &Path, worktree: &Path, limit: std::time::Duration) -> Result<Option<i32>, String> {
    let Some(script) = std::fs::read_to_string(worktree.join(crate::include::CONFIG_FILE)).ok().and_then(|y| scripts_entry(&y, "archive")) else { return Ok(None) };
    let line = setup_line(&script, cfg!(windows), configured_shell().as_deref(), find_posix).map_err(|e| e.replacen("The setup script", "The archive script", 1))?;
    let mut cmd = std::process::Command::new(&line.program);
    cmd.args(&line.args).current_dir(worktree).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    cmd.envs(script_vars(root, worktree));
    if conda_now() {
        for k in CONDA_VARS {
            cmd.env_remove(k);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window
    }
    let mut child = cmd.spawn().map_err(|e| format!("The archive script could not start: {e}"))?;
    let start = std::time::Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| format!("The archive script could not be watched: {e}"))? {
            return Ok(Some(status.code().unwrap_or(-1)));
        }
        if start.elapsed() >= limit {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("The archive script was stopped after {} seconds", limit.as_secs()));
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

/// STAT-055: the archive script for the worktree at `path`, run before it is removed.
// ponytail: registered in lib.rs and called from the removal by the coordinator (hunks in the T-110-a commit).
#[allow(dead_code)]
#[tauri::command(async)]
pub fn workspace_archive(path: String) -> Result<Option<i32>, String> {
    let wt = Path::new(&path);
    run_archive(&main_folder(wt), wt, std::time::Duration::from_secs(120))
}

/// PROJ-036 / COMPAT 5.6: the per-user issue command, a file in the repository's .kolux folder
/// (kept out of git by the user); its whole text is the command. It wins over kolux.yaml's.
pub const ISSUE_OVERRIDE: &str = ".kolux/issue-command";
/// PROJ-036: kolux.yaml's shared issue command key (COMPAT 5.6).
pub const ISSUE_KEY: &str = "issueCommand";

/// PROJ-036: the issue command for a workspace at `worktree` of the repository at `root`, and
/// whether it is the shared one: the local override (main folder first, then the worktree's own)
/// wins; else `issueCommand` from the worktree's kolux.yaml, else the main folder's.
pub fn issue_command(root: &Path, worktree: &Path) -> Option<(String, bool)> {
    let read = |p: PathBuf| std::fs::read_to_string(p).ok().map(|t| t.trim_start_matches('\u{feff}').trim().replace("\r\n", "\n")).filter(|t| !t.is_empty());
    if let Some(local) = read(root.join(ISSUE_OVERRIDE)).or_else(|| read(worktree.join(ISSUE_OVERRIDE))) {
        return Some((local, false));
    }
    [worktree, root].iter().find_map(|d| std::fs::read_to_string(d.join(crate::include::CONFIG_FILE)).ok().and_then(|y| top_entry(&y, ISSUE_KEY))).map(|c| (c, true))
}

/// PROJ-036: the issue filled into the command: `{{issue}}` becomes its number and `{{issueUrl}}`
/// its address (only an address of plain URL characters; anything else becomes empty, so nothing
/// from GitHub can reach the shell as code); a command with neither gets the number as its last
/// word. The issue's title is never put in: anyone can write it.
pub fn fill_issue(command: &str, number: u64, url: &str) -> String {
    let safe = url.starts_with("https://") && url.chars().all(|c| c.is_ascii_alphanumeric() || "-._~:/".contains(c));
    let url = if safe { url } else { "" };
    if command.contains("{{issue}}") || command.contains("{{issueUrl}}") {
        command.replace("{{issueUrl}}", url).replace("{{issue}}", &number.to_string())
    } else {
        format!("{} {number}", command.trim_end())
    }
}

/// PROJ-036: what runs the issue command, and where it came from (a shared one needs the
/// repository's trust first, SAFE-025).
#[derive(serde::Serialize, Debug, PartialEq, Clone)]
pub struct IssueRun {
    pub line: SetupLine,
    pub shared: bool,
    pub command: String,
}

/// PROJ-036: the issue command for issue `number` in the new workspace at `path` of the
/// repository at `root`; None when the project has none; an error when it cannot run as written.
// ponytail: registered in lib.rs by the coordinator (hunk in the T-288 commit); until then only the tests call it.
#[allow(dead_code)]
#[tauri::command(async)]
pub fn workspace_issue_command(root: String, path: String, number: u64, url: String) -> Result<Option<IssueRun>, String> {
    let Some((command, shared)) = issue_command(Path::new(&root), Path::new(&path)) else { return Ok(None) };
    let configured = crate::pty::auto_shells(crate::agents::find_program, std::env::var_os("ComSpec").map(PathBuf::from)).into_iter().next().map(|(p, _)| p);
    let line = setup_line(&fill_issue(&command, number, &url), cfg!(windows), configured.as_deref(), find_posix).map_err(|e| e.replacen("The setup script", "The issue command", 1))?;
    Ok(Some(IssueRun { line, shared, command }))
}

/// VIEW-112: a config file is read only up to this size; a larger one is refused before parsing.
const IMPORT_MAX: u64 = 64 * 1024;

/// VIEW-112: other worktree tools' setup files, by path under the repository root. Conductor's
/// `conductor.json` keeps `scripts.setup` and `scripts.archive`; the Codex app's local environment
/// keeps `[setup] script` and `[cleanup] script` (its PowerShell `[setup.windows]` is not taken,
/// since Kolux runs setup through a POSIX shell or cmd).
const IMPORT_FILES: [&str; 2] = ["conductor.json", ".codex/environments/environment.toml"];

/// VIEW-112: what one other tool's file offers, or why it was refused.
#[derive(serde::Serialize, Debug, PartialEq, Clone)]
pub struct SetupImport {
    pub file: String,
    pub setup: Option<String>,
    pub teardown: Option<String>,
    pub refused: Option<String>,
}

fn script_of(v: Option<&str>) -> Option<String> {
    let s = v?.replace("\r\n", "\n");
    let s = s.trim_matches('\n').trim_end();
    if s.trim().is_empty() {
        return None;
    }
    // ponytail: other tools run these through the user's POSIX shell; a several-line script without
    // a #! line gets #!/bin/sh so Windows runs it through Git Bash instead of refusing it under cmd.
    Some(if s.contains('\n') && !s.starts_with("#!") { format!("#!/bin/sh\n{s}") } else { s.to_string() })
}

/// The setup and teardown scripts in one file's text, or why it cannot be read.
fn parse_import(file: &str, text: &str) -> Result<(Option<String>, Option<String>), String> {
    if file.ends_with(".json") {
        let v: serde_json::Value = serde_json::from_str(text).map_err(|e| format!("it is not valid JSON ({e})"))?;
        if !v.is_object() || v.get("scripts").is_some_and(|s| !s.is_object()) {
            return Err("it is not a settings object with a scripts table".into());
        }
        let s = &v["scripts"];
        Ok((script_of(s["setup"].as_str()), script_of(s["archive"].as_str())))
    } else {
        let doc: toml_edit::DocumentMut = text.parse().map_err(|e: toml_edit::TomlError| format!("it is not valid TOML ({})", e.message()))?;
        let get = |t: &str| doc.get(t).and_then(|t| t.get("script")).and_then(|s| s.as_str());
        Ok((script_of(get("setup")), script_of(get("cleanup"))))
    }
}

/// VIEW-112: the setup and teardown commands other tools' files in `root` offer that kolux.yaml
/// does not have yet, and the files refused (too large, not text, malformed). A file with nothing
/// left to offer is not listed.
pub fn setup_imports(root: &Path) -> Vec<SetupImport> {
    let yaml = std::fs::read_to_string(root.join(crate::include::CONFIG_FILE)).unwrap_or_default();
    let (has_setup, has_archive) = (scripts_entry(&yaml, "setup").is_some(), scripts_entry(&yaml, "archive").is_some());
    let mut out = Vec::new();
    for file in IMPORT_FILES {
        let path = root.join(file);
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        let refuse = |why: String| SetupImport { file: file.into(), setup: None, teardown: None, refused: Some(why) };
        if !meta.is_file() {
            continue;
        }
        if meta.len() > IMPORT_MAX {
            out.push(refuse(format!("it is larger than {} KB", IMPORT_MAX / 1024)));
            continue;
        }
        let text = match std::fs::read(&path).map(String::from_utf8) {
            Ok(Ok(t)) => t,
            Ok(Err(_)) => {
                out.push(refuse("it is not text".into()));
                continue;
            }
            Err(e) => {
                out.push(refuse(format!("it could not be read ({e})")));
                continue;
            }
        };
        match parse_import(file, text.trim_start_matches('\u{feff}')) {
            Err(why) => out.push(refuse(why)),
            Ok((setup, teardown)) => {
                let setup = setup.filter(|_| !has_setup);
                let teardown = teardown.filter(|_| !has_archive);
                if setup.is_some() || teardown.is_some() {
                    out.push(SetupImport { file: file.into(), setup, teardown, refused: None });
                }
            }
        }
    }
    out
}

/// VIEW-112: `yaml` with `scripts.setup` and `scripts.archive` added as block scalars, under the
/// file's top-level `scripts:` block or a new one. A `scripts` entry written another way (inline)
/// is refused rather than rewritten.
pub fn import_into(yaml: &str, setup: Option<&str>, archive: Option<&str>) -> Result<String, String> {
    let crlf = yaml.contains("\r\n");
    let text = yaml.replace("\r\n", "\n");
    let lines: Vec<&str> = text.lines().collect();
    let top = lines.iter().position(|l| l.starts_with("scripts:") || l.starts_with("scripts :"));
    let child = top
        .and_then(|i| lines[i + 1..].iter().find(|l| !l.trim().is_empty() && !l.trim_start().starts_with('#')))
        .map(|l| l.len() - l.trim_start().len())
        .filter(|&n| n > 0)
        .unwrap_or(2);
    let pad = " ".repeat(child);
    let mut block = String::new();
    for (key, script) in [("setup", setup), ("archive", archive)] {
        let Some(script) = script else { continue };
        block.push_str(&format!("{pad}{key}: |\n"));
        for l in script.lines() {
            if l.is_empty() {
                block.push('\n');
            } else {
                block.push_str(&format!("{pad}  {l}\n"));
            }
        }
    }
    let out = match top {
        Some(i) if lines[i].trim_end() != "scripts:" => return Err(format!("{}'s scripts entry is not a plain block; add the commands there by hand", crate::include::CONFIG_FILE)),
        Some(i) => {
            let mut v: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
            v.insert(i + 1, block.trim_end_matches('\n').to_string());
            v.join("\n") + "\n"
        }
        None if text.trim().is_empty() => format!("scripts:\n{block}"),
        None => format!("{}\nscripts:\n{block}", text.trim_end_matches('\n')),
    };
    Ok(if crlf { out.replace('\n', "\r\n") } else { out })
}

/// VIEW-112: what other tools' setup files in the project at `path` offer.
#[tauri::command(async)]
pub fn setup_imports_list(path: String) -> Vec<SetupImport> {
    setup_imports(Path::new(&path))
}

/// VIEW-112: takes `file`'s offer into the kolux.yaml at `path`, read again here so only what the
/// file says is written.
#[tauri::command(async)]
pub fn setup_import(path: String, file: String) -> Result<(), String> {
    let root = Path::new(&path);
    let offer = setup_imports(root).into_iter().find(|o| o.file == file && o.refused.is_none()).ok_or_else(|| format!("{file} has nothing left to import"))?;
    let target = root.join(crate::include::CONFIG_FILE);
    let yaml = std::fs::read_to_string(&target).unwrap_or_default();
    let next = import_into(&yaml, offer.setup.as_deref(), offer.teardown.as_deref())?;
    std::fs::write(&target, next).map_err(|e| format!("{} could not be written: {e}", crate::include::CONFIG_FILE))
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

    fn tree(files: &[(&str, &[u8])]) -> PathBuf {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("kolux-view112-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for (p, body) in files {
            let f = dir.join(p);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, body).unwrap();
        }
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn view112_other_tools_setup_and_teardown_commands_are_offered() {
        let dir = tree(&[
            ("conductor.json", b"{\"scripts\":{\"setup\":\"pnpm i\",\"run\":\"pnpm dev\",\"archive\":\"./archive.sh\"}}"),
            (".codex/environments/environment.toml", b"version = 1\r\nname = \"x\"\r\n\r\n[setup]\r\nscript = '''\r\npnpm install\r\npnpm build\r\n'''\r\n\r\n[setup.windows]\r\nscript = 'Copy-Item a b'\r\n\r\n[cleanup]\r\nscript = \"rm -rf .cache\"\r\n"),
        ]);
        let got = setup_imports(&dir);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0], SetupImport { file: "conductor.json".into(), setup: Some("pnpm i".into()), teardown: Some("./archive.sh".into()), refused: None });
        assert_eq!(got[1].setup.as_deref(), Some("#!/bin/sh\npnpm install\npnpm build"), "a several-line script runs through sh");
        assert_eq!(got[1].teardown.as_deref(), Some("rm -rf .cache"));
        // what kolux.yaml already has is not offered again; a file with nothing left is not listed
        std::fs::write(dir.join("kolux.yaml"), "scripts:\n  setup: make\n").unwrap();
        let got = setup_imports(&dir);
        assert_eq!(got.iter().map(|o| (o.setup.is_some(), o.teardown.is_some())).collect::<Vec<_>>(), [(false, true), (false, true)]);
        std::fs::write(dir.join("kolux.yaml"), "scripts:\n  setup: make\n  archive: x\n").unwrap();
        assert!(setup_imports(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
        let none = tree(&[("README.md", b"hi")]);
        assert!(setup_imports(&none).is_empty());
        let _ = std::fs::remove_dir_all(&none);
    }

    #[test]
    fn view112_a_malformed_or_oversized_config_is_refused_and_offers_nothing() {
        let big = format!("{{\"scripts\":{{\"setup\":\"{}\"}}}}", "x".repeat(70 * 1024));
        let dir = tree(&[("conductor.json", big.as_bytes()), (".codex/environments/environment.toml", b"[setup\nscript = 'x'\n")]);
        let got = setup_imports(&dir);
        assert_eq!(got.len(), 2);
        assert!(got.iter().all(|o| o.setup.is_none() && o.teardown.is_none()));
        assert!(got[0].refused.as_deref().unwrap().contains("larger than 64 KB"));
        assert!(got[1].refused.as_deref().unwrap().contains("not valid TOML"));
        assert!(setup_import(dir.to_string_lossy().into_owned(), "conductor.json".into()).is_err(), "a refused file cannot be imported");
        assert!(!dir.join("kolux.yaml").exists());
        let _ = std::fs::remove_dir_all(&dir);
        for bad in [&b"{\"scripts\": [1]}"[..], b"[1,2]", b"{\"scripts\":", b"\xff\xfe{}"] {
            let dir = tree(&[("conductor.json", bad)]);
            let got = setup_imports(&dir);
            assert_eq!(got.len(), 1, "{bad:?}");
            assert!(got[0].refused.is_some() && got[0].setup.is_none(), "{bad:?}");
            let _ = std::fs::remove_dir_all(&dir);
        }
    }

    #[test]
    fn view112_an_import_lands_in_kolux_yaml_where_setup_reads_it() {
        let y = import_into("", Some("#!/bin/sh\npnpm i\n\nmake"), Some("./a.sh")).unwrap();
        assert_eq!(y, "scripts:\n  setup: |\n    #!/bin/sh\n    pnpm i\n\n    make\n  archive: |\n    ./a.sh\n");
        assert_eq!(setup_script(&y).as_deref(), Some("#!/bin/sh\npnpm i\n\nmake"));
        assert_eq!(scripts_entry(&y, "archive").as_deref(), Some("./a.sh"));
        let y = import_into("worktree:\r\n  sharedDirectories:\r\n    - node_modules\r\nscripts:\r\n    issueCommand: x\r\n", Some("pnpm i"), None).unwrap();
        assert_eq!(y, "worktree:\r\n  sharedDirectories:\r\n    - node_modules\r\nscripts:\r\n    setup: |\r\n      pnpm i\r\n    issueCommand: x\r\n");
        assert_eq!(setup_script(&y).as_deref(), Some("pnpm i"));
        let y = import_into("defaultTabs: []\n", None, Some("rm -rf x")).unwrap();
        assert_eq!(scripts_entry(&y, "archive").as_deref(), Some("rm -rf x"));
        assert!(y.starts_with("defaultTabs: []\nscripts:\n"));
        assert!(import_into("scripts: {}\n", Some("x"), None).unwrap_err().contains("by hand"));
        // the command writes the file in the project's folder
        let dir = tree(&[("conductor.json", b"{\"scripts\":{\"setup\":\"pnpm i\"}}")]);
        setup_import(dir.to_string_lossy().into_owned(), "conductor.json".into()).unwrap();
        assert_eq!(setup_script(&std::fs::read_to_string(dir.join("kolux.yaml")).unwrap()).as_deref(), Some("pnpm i"));
        assert!(setup_imports(&dir).is_empty(), "nothing is offered twice");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn proj036_the_issue_command_is_kolux_yamls_top_level_entry() {
        assert_eq!(top_entry("scripts:\n  setup: x\nissueCommand: 'claude \"fix #{{issue}}\"'\nnext: claude # a comment\n", ISSUE_KEY).as_deref(), Some("claude \"fix #{{issue}}\""));
        assert_eq!(top_entry("issueCommand: |\r\n  #!/bin/sh\r\n  gh issue view {{issue}}\r\nnext: 1\r\n", ISSUE_KEY).as_deref(), Some("#!/bin/sh\ngh issue view {{issue}}"));
        assert_eq!(top_entry("scripts:\n  issueCommand: nested\n", ISSUE_KEY), None, "only the top level counts");
        assert_eq!(scripts_entry("issueCommand: top\nscripts:\n  setup: s\n", "issueCommand"), None);
        assert_eq!(setup_script("issueCommand: x\nscripts:\n  setup: s\n").as_deref(), Some("s"), "setup still reads under scripts");
        assert_eq!(top_entry("issueCommand: ''\n", ISSUE_KEY), None);
        assert_eq!(top_entry("issueCommand: gh issue develop # a comment\n", ISSUE_KEY).as_deref(), Some("gh issue develop"));
    }

    #[test]
    fn proj036_the_issue_is_filled_in_and_its_title_never_reaches_the_shell() {
        let url = "https://github.com/o/r/issues/12";
        assert_eq!(fill_issue("work {{issue}} at {{issueUrl}}", 12, url), "work 12 at https://github.com/o/r/issues/12");
        assert_eq!(fill_issue("gh issue develop\n", 12, url), "gh issue develop 12", "no placeholder: the number goes last");
        assert_eq!(fill_issue("open {{issueUrl}}", 12, "https://x/$(rm -rf ~)"), "open ", "an address with shell characters is dropped");
        assert_eq!(fill_issue("open {{issueUrl}}", 12, "file:///c/x"), "open ");
    }

    #[test]
    fn proj036_a_create_from_issue_12_runs_the_command_and_the_local_one_wins() {
        let root = tree(&[("kolux.yaml", b"issueCommand: echo shared {{issue}}\n")]);
        let wt = tree(&[("kolux.yaml", b"issueCommand: echo worktree {{issue}}\n")]);
        let run = |r: &PathBuf, w: &PathBuf| workspace_issue_command(r.to_string_lossy().into_owned(), w.to_string_lossy().into_owned(), 12, "https://github.com/o/r/issues/12".into()).unwrap();
        let got = run(&root, &wt).expect("a shared issue command");
        assert!(got.shared);
        assert_eq!(got.line.script, "echo worktree 12", "the worktree's own kolux.yaml is read first");
        assert!(got.line.args.last().unwrap().contains("echo worktree 12"));
        let bare = tree(&[("README.md", b"x")]);
        assert_eq!(run(&root, &bare).unwrap().line.script, "echo shared 12", "else the main folder's");
        std::fs::create_dir_all(root.join(".kolux")).unwrap();
        std::fs::write(root.join(ISSUE_OVERRIDE), "\u{feff}echo local {{issue}}\r\n").unwrap();
        let got = run(&root, &wt).unwrap();
        assert!(!got.shared, "the local override wins over both shared ones");
        assert_eq!(got.line.script, "echo local 12");
        assert_eq!(got.command, "echo local {{issue}}");
        assert_eq!(run(&bare, &bare), None, "no issue command, nothing runs");
        for d in [root, wt, bare] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn stat055_local_settings_win_unless_the_policy_is_shared_first() {
        let shared = || Some("pnpm i".to_string());
        assert_eq!(pick_setup(Some("make\r\nmake test"), shared(), None), Some(("make\nmake test".into(), false)), "local wins by default");
        assert_eq!(pick_setup(Some("make"), shared(), Some("local")), Some(("make".into(), false)));
        assert_eq!(pick_setup(Some("make"), shared(), Some("shared-first")), Some(("pnpm i".into(), true)), "shared-first: kolux.yaml only");
        assert_eq!(pick_setup(Some("make"), None, Some("shared")), None, "shared-first never falls back to local");
        assert_eq!(pick_setup(Some("  "), shared(), None), Some(("pnpm i".into(), true)), "a blank local script is none");
        assert_eq!(pick_setup(None, None, None), None);
        // the setup command reads kolux.yaml inside the worktree being created
        let wt = tree(&[("kolux.yaml", b"scripts:\n  setup: echo shared\n")]);
        let p = wt.to_string_lossy().into_owned();
        assert_eq!(workspace_setup(p.clone(), None, None).unwrap().unwrap().script, "echo shared");
        assert_eq!(workspace_setup(p.clone(), Some("echo local".into()), None).unwrap().unwrap().script, "echo local");
        assert_eq!(workspace_setup(p, Some("echo local".into()), Some("shared".into())).unwrap().unwrap().script, "echo shared");
        let _ = std::fs::remove_dir_all(wt);
    }

    #[test]
    fn stat055_a_batch_file_runs_under_cmd_even_when_the_shell_is_git_bash() {
        let bash = Some(Path::new("C:/Program Files/Git/bin/bash.exe"));
        let none = |_: &str| None;
        let l = setup_line("scripts\\setup.bat --fast", true, bash, none).unwrap();
        assert_eq!((l.program.as_str(), l.args.last().unwrap().as_str()), ("cmd.exe", "scripts\\setup.bat --fast"));
        assert!(setup_line("\"tools\\Prep.CMD\"", true, bash, none).unwrap_err().contains("quotes"), "still refused what cmd would misread");
        assert_eq!(setup_line("./setup.sh", true, bash, none).unwrap().program, "C:/Program Files/Git/bin/bash.exe", "other scripts keep the POSIX shell");
        assert_eq!(setup_line("setup.bat", false, None, none).unwrap().program, "sh", "only on Windows");
    }

    #[test]
    fn stat055_scripts_get_the_root_worktree_and_name_and_never_a_half_active_conda() {
        let root = tree(&[("README.md", b"x")]);
        let wt = tree(&[(".git", b"gitdir: C:/repos/app/.git/worktrees/brave-otter\n")]);
        assert_eq!(main_folder(&wt), PathBuf::from("C:/repos/app"));
        assert_eq!(main_folder(&root), root, "a main folder is its own root");
        let vars = script_vars(Path::new("C:/repos/app"), Path::new("C:/ws/brave-otter"));
        assert_eq!(vars.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>(), ["KOLUX_ROOT_PATH=C:/repos/app", "KOLUX_WORKTREE_PATH=C:/ws/brave-otter", "KOLUX_WORKSPACE_NAME=brave-otter"]);
        let sh = with_env(SetupLine { program: "C:/Git/bin/bash.exe".into(), args: vec!["-e".into(), "-c".into(), "#!/bin/bash -e\nmake".into()], script: "#!/bin/bash -e\nmake".into() }, &[("KOLUX_ROOT_PATH", "C:/it's".into())], &CONDA_VARS);
        assert_eq!(sh.args, ["-e", "-c", "export KOLUX_ROOT_PATH='C:/it'\\''s'\nunset CONDA_PREFIX CONDA_DEFAULT_ENV CONDA_SHLVL CONDA_PROMPT_MODIFIER\n#!/bin/bash -e\nmake"]);
        assert_eq!(sh.script, "#!/bin/bash -e\nmake", "the script itself is unchanged");
        let cmd = with_env(SetupLine { program: "cmd.exe".into(), args: vec!["/d".into(), "/s".into(), "/c".into(), "pnpm i".into()], script: "pnpm i".into() }, &[("KOLUX_ROOT_PATH", "C:/Program Files (x86)/a".into()), ("KOLUX_WORKSPACE_NAME", "a&b".into())], &["CONDA_PREFIX"]);
        assert_eq!(cmd.args[3], "set KOLUX_ROOT_PATH=C:/Program Files (x86)/a&& set CONDA_PREFIX=&& pnpm i", "a value cmd would misread is left out");
        assert!(conda_partial(Some("C:\\conda\\envs\\x"), "C:\\Windows;C:\\conda\\condabin"), "named but not on the path");
        assert!(!conda_partial(Some("C:\\conda\\envs\\x"), "C:\\conda\\envs\\x\\Scripts;C:\\Windows"), "fully active");
        assert!(!conda_partial(None, "C:\\Windows"));
        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(wt);
    }

    #[test]
    fn stat055_removing_a_worktree_runs_its_archive_script_inside_it() {
        let wt = tree(&[("kolux.yaml", b"scripts:\n  archive: echo done>archived.txt\n")]);
        let code = run_archive(Path::new("C:/repos/app"), &wt, std::time::Duration::from_secs(60)).unwrap();
        assert_eq!(code, Some(0));
        assert_eq!(std::fs::read_to_string(wt.join("archived.txt")).unwrap().trim(), "done");
        std::fs::write(wt.join("kolux.yaml"), "scripts:\n  setup: x\n").unwrap();
        assert_eq!(run_archive(&wt, &wt, std::time::Duration::from_secs(60)).unwrap(), None, "no archive script, nothing runs");
        let slow = if cfg!(windows) { "ping -n 6 127.0.0.1>nul" } else { "sleep 5" };
        std::fs::write(wt.join("kolux.yaml"), format!("scripts:\n  archive: {slow}\n")).unwrap();
        assert!(run_archive(&wt, &wt, std::time::Duration::from_millis(300)).unwrap_err().contains("stopped after"));
        // with a POSIX shell the variables reach the script
        if cfg!(not(windows)) || find_posix("sh").is_some() {
            std::fs::write(wt.join("kolux.yaml"), "scripts:\n  archive: |\n    #!/bin/sh\n    printf '%s|%s' \"$KOLUX_WORKSPACE_NAME\" \"$KOLUX_ROOT_PATH\" > vars.txt\n").unwrap();
            assert_eq!(run_archive(Path::new("C:/repos/app"), &wt, std::time::Duration::from_secs(60)).unwrap(), Some(0));
            let name = wt.file_name().unwrap().to_string_lossy().into_owned();
            assert_eq!(std::fs::read_to_string(wt.join("vars.txt")).unwrap(), format!("{name}|C:/repos/app"));
        }
        let _ = std::fs::remove_dir_all(wt);
    }
}
