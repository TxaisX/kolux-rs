//! One shell session behind a pseudo-terminal (PTY).
//!
//! A `PtySession` owns the PTY master, the child's writer and a way to kill the child. Output is
//! pumped on a reader thread to a callback; a second thread waits for the child and reports its
//! exit. Dropping the session (or calling `kill`) ends the program, by force if it does not leave.

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::thread;
use std::time::Duration;

/// TERM-098 (Windows): a terminal's reply to a program's colour question (OSC 4/10/11/12 with
/// `rgb:`) or light/dark question (CSI ? 997 ; 1|2 n) reaches the console layer as plain bytes,
/// and it drops them, since it parses input only for the sequences it knows. Written as
/// win32-input-mode key events (one per character, the console's own keyboard encoding, which it
/// asks for with CSI ? 9001 h) they reach the program untouched.
pub fn is_reply(data: &[u8]) -> bool {
    data.starts_with(b"\x1b]") || data.starts_with(b"\x1b[?997;")
}

/// `data` as win32-input-mode key events: `CSI Vk ; Sc ; Uc ; Kd ; Cs ; Rc _` per character, a
/// key-down then a key-up with the character and no virtual key. The key-up matters: a run of
/// identical key-downs is coalesced by the console into one repeated key, and a reader then sees
/// one character too many (measured: `dddd` read back as `ddddd`).
pub fn as_key_events(data: &[u8]) -> Vec<u8> {
    String::from_utf8_lossy(data).chars().map(|c| format!("\x1b[0;0;{0};1;0;1_\x1b[0;0;{0};0;0;1_", c as u32)).collect::<String>().into_bytes()
}

/// ACCT-046: the shells an automatic pick tries, best first. On Windows: PowerShell 7 (passed over
/// when the copy found is a Microsoft Store alias), then Windows PowerShell, then the command
/// prompt, which is always last, found through the system's ComSpec setting when that is set, and
/// started in UTF-8. Elsewhere the login shell, else sh.
// ponytail: PowerShell gets no prompt markers yet; nothing in Kolux reads them (DT-R36).
pub fn auto_shells(find: impl Fn(&str) -> Option<PathBuf>, comspec: Option<PathBuf>) -> Vec<(PathBuf, Vec<&'static str>)> {
    if !cfg!(windows) {
        return vec![(std::env::var_os("SHELL").map(PathBuf::from).unwrap_or_else(|| "sh".into()), Vec::new())];
    }
    let mut out = Vec::new();
    out.extend(find("pwsh.exe").filter(|p| !store_alias(p)).map(|p| (p, vec!["-NoLogo"])));
    out.extend(find("powershell.exe").map(|p| (p, vec!["-NoLogo"])));
    let cmd = comspec.filter(|p| p.is_file()).or_else(|| find("cmd.exe")).unwrap_or_else(|| "cmd.exe".into());
    out.push((cmd, CMD_ARGS.to_vec()));
    out
}

/// The command prompt, switched to UTF-8 before its first prompt.
const CMD_ARGS: [&str; 4] = ["/k", "chcp", "65001", ">nul"];

/// A Microsoft Store app alias: a stand-in under WindowsApps rather than the program itself.
fn store_alias(p: &Path) -> bool {
    p.components().any(|c| c.as_os_str().eq_ignore_ascii_case("WindowsApps"))
}

/// The automatic shells for a new pane (ACCT-046), each starting in `cwd`, or in the home folder
/// when there is none. ACCT-049: on Windows the home folder is the home drive plus the home path
/// when that folder exists, else the user profile.
pub fn shell_commands(cwd: Option<&str>) -> Vec<CommandBuilder> {
    let dir = cwd.map(PathBuf::from).or_else(home_dir);
    auto_shells(crate::agents::find_program, std::env::var_os("ComSpec").map(PathBuf::from))
        .into_iter()
        .map(|(program, args)| {
            let mut c = CommandBuilder::new(program);
            c.args(args);
            if let Some(d) = &dir {
                c.cwd(d);
            }
            c
        })
        .collect()
}

fn home_dir() -> Option<PathBuf> {
    if !cfg!(windows) {
        return std::env::var_os("HOME").map(PathBuf::from);
    }
    let joined = std::env::var_os("HOMEDRIVE").zip(std::env::var_os("HOMEPATH")).map(|(mut d, p)| {
        d.push(p);
        PathBuf::from(d)
    });
    joined.filter(|p| p.is_dir()).or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
}

/// ACCT-049: whether a pane may start in `dir`. A folder that is gone, or on a drive that is not
/// connected, gets a message instead of a silent start somewhere else, and an `agent` never
/// starts by itself in the root of a drive. The check stops waiting after two seconds, so a
/// network drive that does not answer cannot hold the app.
// ponytail: each pane waits on its own, so many panes on a dead drive wait two seconds each; share
// one answer per drive if that ever bites.
pub fn check_start_dir(dir: &str, agent: bool) -> Result<(), String> {
    let path = PathBuf::from(dir);
    let (tx, rx) = std::sync::mpsc::channel();
    let probe = path.clone();
    thread::spawn(move || {
        let root: PathBuf = probe.components().take_while(|c| matches!(c, Component::Prefix(_) | Component::RootDir)).collect();
        let _ = tx.send((probe.is_dir(), root.as_os_str().is_empty() || root.exists(), root));
    });
    let Ok((is_dir, mounted, root)) = rx.recv_timeout(Duration::from_secs(2)) else {
        return Err(format!("The folder {dir} is not answering. If it is on a network or external drive, check that the drive is connected, then open the pane again."));
    };
    if !mounted {
        return Err(format!("The drive {} is not connected, so {dir} cannot be opened. Plug the drive in or reconnect it, then open the pane again.", root.display()));
    }
    if !is_dir {
        return Err(format!("The folder {dir} no longer exists. It may have been moved or deleted; open the project from where it is now."));
    }
    if agent && path.parent().is_none() {
        return Err(format!("Kolux does not start an agent by itself in {dir}, the root of a drive. Open a project folder and start it there."));
    }
    Ok(())
}

/// Whether a pane's program is one of the shells rather than an agent (ACCT-049).
pub fn is_shell_program(program: &str) -> bool {
    let stem = Path::new(program).file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    ["pwsh", "powershell", "cmd", "bash", "wsl", "zsh", "fish", "sh"].contains(&stem.as_str())
}

/// ACCT-048: an inherited variable a pane should not see: Kolux's own runtime and build ones
/// (Tauri, WebView2, a cargo or npm script run) or a conda activation that came along only in part.
/// CLI-010: also another copy's data-folder override (KOLUX_USER_DATA_PATH), which a Kolux started
/// from that copy's terminal inherits and which would send this pane's commands to the other app.
// ponytail: the folders a dev run puts on PATH stay; strip them if a dev build's panes ever mislead.
pub fn inherited_noise(name: &str) -> bool {
    const PREFIXES: [&str; 9] = ["TAURI_", "__TAURI", "WEBVIEW2_", "CARGO_PKG_", "CARGO_MANIFEST_", "CARGO_BIN_", "npm_", "PNPM_SCRIPT_", "CONDA_PREFIX"];
    const NAMES: [&str; 7] = ["CARGO_CRATE_NAME", "CARGO_PRIMARY_PACKAGE", "INIT_CWD", "CONDA_DEFAULT_ENV", "CONDA_SHLVL", "CONDA_PROMPT_MODIFIER", "KOLUX_USER_DATA_PATH"];
    PREFIXES.iter().any(|p| name.starts_with(p)) || NAMES.contains(&name)
}

/// SESS-006: a shell the create menu offers, one item each. The first is the one Ctrl+T opens.
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct ShellInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub program: String,
    pub args: Vec<String>,
}

/// The installed shells: on Windows, Windows PowerShell (always there), PowerShell 7, Command
/// Prompt, Git Bash and WSL when found, PowerShell 7 first when it is installed; elsewhere the login shell, then bash, zsh and fish.
pub fn shells(find: impl Fn(&str) -> Option<std::path::PathBuf>) -> Vec<ShellInfo> {
    let mut out: Vec<ShellInfo> = Vec::new();
    let mut add = |id, name, program: Option<std::path::PathBuf>, args: &[&str]| {
        if let Some(p) = program {
            let program = p.to_string_lossy().into_owned();
            if !out.iter().any(|s| s.program.eq_ignore_ascii_case(&program)) {
                out.push(ShellInfo { id, name, program, args: args.iter().map(|a| a.to_string()).collect() });
            }
        }
    };
    if cfg!(windows) {
        // ACCT-046: the automatic pick's order, so the first item (the one Ctrl+T opens) names it.
        let pwsh = find("pwsh.exe");
        add("pwsh", "PowerShell 7", pwsh.clone().filter(|p| !store_alias(p)), &["-NoLogo"]);
        add("powershell", "Windows PowerShell", Some(find("powershell.exe").unwrap_or_else(|| "powershell.exe".into())), &["-NoLogo"]);
        add("pwsh", "PowerShell 7", pwsh, &["-NoLogo"]);
        add("cmd", "Command Prompt", find("cmd.exe"), &CMD_ARGS);
        // Git for Windows' own bash, never the WSL launcher that System32 calls bash.exe.
        let git = std::env::var_os("ProgramFiles").map(|p| std::path::PathBuf::from(p).join("Git").join("bin").join("bash.exe")).filter(|p| p.is_file());
        add("gitbash", "Git Bash", git, &["--login", "-i"]);
        // wsl.exe ships with Windows even with no Linux installed; it counts once a distribution is.
        add("wsl", "WSL", find("wsl.exe").filter(|_| wsl_has_distro()), &[]);
    } else {
        add("login", "Login shell", std::env::var_os("SHELL").map(std::path::PathBuf::from), &[]);
        add("bash", "bash", find("bash"), &[]);
        add("zsh", "zsh", find("zsh"), &[]);
        add("fish", "fish", find("fish"), &[]);
    }
    out
}

/// WSL keeps its default distribution under the user's Lxss key once one is installed.
#[cfg(windows)]
fn wsl_has_distro() -> bool {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_ANY};
    let wide = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
    let (key, name) = (wide(r"Software\Microsoft\Windows\CurrentVersion\Lxss"), wide("DefaultDistribution"));
    let mut len = 0u32;
    // SAFETY: both strings are NUL-terminated and live across the call; only the size is asked for.
    unsafe { RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), RRF_RT_ANY, std::ptr::null_mut(), std::ptr::null_mut(), &mut len) == 0 }
}
#[cfg(not(windows))]
fn wsl_has_distro() -> bool {
    false
}

#[tauri::command]
pub fn shell_list() -> Vec<ShellInfo> {
    shells(crate::agents::find_program)
}

/// TERM-040: where a new terminal starts. A requested folder may be relative to the workspace or
/// an absolute folder outside it; a missing one falls back to the workspace folder.
pub fn start_dir(workspace: &str, requested: Option<&str>) -> String {
    let Some(req) = requested.map(str::trim).filter(|r| !r.is_empty()) else { return workspace.to_string() };
    let path = std::path::Path::new(workspace).join(req);
    if path.is_dir() { path.to_string_lossy().into_owned() } else { workspace.to_string() }
}

/// A pane that runs one program (an agent such as `claude`) instead of a shell. `program` is
/// resolved the way a shell would (`claude` becomes `...\claude.exe`) so the process starts
/// without a shell in between; a name that does not resolve is passed through unchanged and the
/// spawn error says what was missing. A Windows command-script shim (npm's `codex.cmd`) is run
/// through `cmd.exe /d /c`, as the command line would (SESS-001). Starts in `cwd` when that
/// folder exists.
pub fn program_command(program: &str, args: &[String], cwd: Option<&str>) -> CommandBuilder {
    let resolved = crate::agents::find_program(program).unwrap_or_else(|| program.into());
    let (exe, head) = start_line(&resolved);
    let mut cmd = CommandBuilder::new(exe);
    cmd.args(head);
    cmd.args(args);
    if let Some(dir) = cwd.filter(|d| std::path::Path::new(d).is_dir()) {
        cmd.cwd(dir);
    }
    cmd
}

/// What is started for `resolved`: the file itself, or for a `.cmd` / `.bat` shim `cmd.exe` with
/// `/d /c <shim>` in front of the program's own arguments.
// ponytail: cmd.exe's quote rules bite when the shim's folder has a space AND an argument carries
// quotes (both together), which an opening prompt (SESS-051) can; run the shim's target directly
// if a prompt with quotes ever misfires.
pub fn start_line(resolved: &std::path::Path) -> (std::ffi::OsString, Vec<std::ffi::OsString>) {
    let shim = cfg!(windows)
        && resolved
            .extension()
            .map(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"))
            .unwrap_or(false);
    if shim {
        ("cmd.exe".into(), vec!["/d".into(), "/c".into(), resolved.as_os_str().to_owned()])
    } else {
        (resolved.as_os_str().to_owned(), Vec::new())
    }
}

pub struct PtySession {
    master: Option<Box<dyn MasterPty + Send>>,
    writer: Option<Box<dyn Write + Send>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    pid: Option<u32>,
    /// The program that started (ACCT-046: an automatic shell may be a fallback).
    program: String,
}

impl PtySession {
    /// Spawns `cmd` in a fresh PTY of `cols` x `rows`. `on_output` receives every chunk the program
    /// prints; `on_exit` runs once with the exit code when the program ends.
    pub fn spawn(
        cmd: CommandBuilder,
        cols: u16,
        rows: u16,
        on_output: impl FnMut(&[u8]) + Send + 'static,
        on_exit: impl FnOnce(Option<u32>) + Send + 'static,
    ) -> Result<Self, String> {
        Self::spawn_first(vec![cmd], cols, rows, on_output, on_exit)
    }

    /// ACCT-046: tries each of `cmds` in turn and keeps the first that starts, so a shell that is
    /// refused (access denied, say) gives way to the next one; the error names each that failed.
    pub fn spawn_first(
        cmds: Vec<CommandBuilder>,
        cols: u16,
        rows: u16,
        mut on_output: impl FnMut(&[u8]) + Send + 'static,
        on_exit: impl FnOnce(Option<u32>) + Send + 'static,
    ) -> Result<Self, String> {
        let pair = native_pty_system()
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
        let mut failed = Vec::new();
        let mut started = None;
        for cmd in cmds {
            let name = cmd.get_argv().first().map(|a| a.to_string_lossy().into_owned()).unwrap_or_default();
            match pair.slave.spawn_command(cmd) {
                Ok(c) => {
                    started = Some((c, name));
                    break;
                }
                Err(e) => failed.push((name, e.to_string())),
            }
        }
        let Some((mut child, program)) = started else {
            return Err(match failed.len() {
                1 => failed.remove(0).1,
                _ => format!("No shell would start. Kolux tried {}.", failed.iter().map(|(n, e)| format!("{n} ({e})")).collect::<Vec<_>>().join(", ")),
            });
        };
        drop(pair.slave);
        let killer = child.clone_killer();
        let pid = child.process_id();
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        thread::Builder::new()
            .name("pty-reader".into())
            .spawn(move || {
                let mut buf = [0u8; 8192];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => on_output(&buf[..n]),
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        thread::Builder::new()
            .name("pty-waiter".into())
            .spawn(move || {
                let code = child.wait().ok().map(|s| s.exit_code());
                on_exit(code);
            })
            .map_err(|e| e.to_string())?;

        Ok(Self { master: Some(pair.master), writer: Some(writer), killer, pid, program })
    }

    /// Sends keystrokes (already encoded as the terminal would) to the program.
    pub fn write(&mut self, data: &[u8]) -> Result<(), String> {
        let w = self.writer.as_mut().ok_or("session already closed")?;
        let keyed;
        let data = if cfg!(windows) && is_reply(data) {
            keyed = as_key_events(data);
            &keyed[..]
        } else {
            data
        };
        w.write_all(data).and_then(|_| w.flush()).map_err(|e| e.to_string())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let m = self.master.as_ref().ok_or("session already closed")?;
        m.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())
    }

    /// The program that started.
    pub fn program(&self) -> &str {
        &self.program
    }

    /// The started program's process id, when the platform reports one.
    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    /// Ends the program: closes its input, forces it to stop, releases the PTY so the reader
    /// thread can finish.
    pub fn kill(&mut self) {
        self.writer.take();
        let _ = self.killer.kill();
        self.master.take();
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        self.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    #[test]
    fn a_cmd_shim_runs_through_the_command_shell_and_an_exe_runs_itself() {
        let exe = std::path::Path::new("C:/Users/me/.local/bin/claude.exe");
        assert_eq!(start_line(exe), (exe.as_os_str().to_owned(), vec![]));
        let shim = std::path::Path::new("C:/Users/me/AppData/Roaming/npm/codex.CMD");
        let (program, head) = start_line(shim);
        if cfg!(windows) {
            assert_eq!(program, "cmd.exe");
            assert_eq!(head, vec!["/d", "/c", "C:/Users/me/AppData/Roaming/npm/codex.CMD"]);
        } else {
            assert_eq!(program, shim.as_os_str());
            assert!(head.is_empty());
        }
    }

    #[cfg(windows)]
    #[test]
    fn the_create_menu_lists_each_installed_shell_once_best_first() {
        let found = |name: &str| match name {
            "pwsh.exe" => Some(std::path::PathBuf::from("C:/pf/pwsh.exe")),
            "cmd.exe" => Some(std::path::PathBuf::from("C:/Windows/System32/cmd.exe")),
            _ => None,
        };
        let list = shells(found);
        let ids: Vec<_> = list.iter().map(|s| s.id).collect();
        assert_eq!(&ids[..3], &["pwsh", "powershell", "cmd"]);
        assert_eq!(list[1].program, "powershell.exe");
        assert_eq!(list[2].args, ["/k", "chcp", "65001", ">nul"]);
        assert!(!ids.contains(&"wsl"));
        // Nothing found but the built-in one: still one item.
        assert_eq!(shells(|_| None).first().map(|s| s.id), Some("powershell"));
    }

    /// The round trip every pane depends on: a real shell, a typed command, its output read back.
    #[test]
    fn shell_echoes_a_marker_back_through_the_pty() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let (exit_tx, exit_rx) = mpsc::channel::<Option<u32>>();
        let mut session = PtySession::spawn(
            shell_commands(None).remove(0),
            100,
            30,
            move |chunk| {
                let _ = tx.send(chunk.to_vec());
            },
            move |code| {
                let _ = exit_tx.send(code);
            },
        )
        .expect("spawn shell in a pty");

        session.write(b"echo kolux-rs-ok\r\n").expect("write to pty");

        let mut seen = String::new();
        let mut answered = 0;
        let deadline = Instant::now() + Duration::from_secs(30);
        // The typed line is echoed once and its output printed once: wait for the second copy.
        while seen.matches("kolux-rs-ok").count() < 2 {
            let left = deadline.saturating_duration_since(Instant::now());
            assert!(!left.is_zero(), "marker not read back within 30s; saw:\n{seen}");
            if let Ok(chunk) = rx.recv_timeout(left) {
                seen.push_str(&String::from_utf8_lossy(&chunk));
            }
            // The console host asks where the cursor is (ESC[6n) before it draws anything and
            // waits for the answer; a real terminal replies by itself, the test stands in for it.
            let asks = seen.matches("\x1b[6n").count();
            while answered < asks {
                session.write(b"\x1b[1;1R").expect("answer cursor query");
                answered += 1;
            }
        }

        session.resize(80, 24).expect("resize");
        session.write(b"exit\r\n").expect("write exit");
        let code = exit_rx.recv_timeout(Duration::from_secs(30)).expect("shell exits after `exit`");
        assert_eq!(code, Some(0), "clean exit code");
        session.kill();
    }

    /// An agent pane runs a program directly, with its own arguments, in a chosen folder: the
    /// path every agent launch takes. PowerShell stands in for the agent so the test needs
    /// nothing installed beyond Windows.
    #[test]
    fn a_program_with_arguments_runs_through_the_pty_and_prints() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let (exit_tx, exit_rx) = mpsc::channel::<Option<u32>>();
        let (program, args, cwd) = if cfg!(windows) {
            ("powershell", vec!["-NoLogo".to_string(), "-Command".to_string(), "echo kolux-rs-program-marker; (Get-Location).Path".to_string()], std::env::temp_dir())
        } else {
            ("sh", vec!["-c".to_string(), "echo kolux-rs-program-marker; pwd".to_string()], std::env::temp_dir())
        };
        let cwd_text = cwd.display().to_string();
        let mut session = PtySession::spawn(
            program_command(program, &args, Some(&cwd_text)),
            100,
            30,
            move |chunk| {
                let _ = tx.send(chunk.to_vec());
            },
            move |code| {
                let _ = exit_tx.send(code);
            },
        )
        .expect("spawn a program in a pty");
        // Drain output while waiting for the exit: the console host asks where the cursor is
        // (ESC[6n) before it draws anything and blocks until answered, as in the shell test.
        let mut seen = String::new();
        let mut answered = 0;
        let deadline = Instant::now() + Duration::from_secs(30);
        let code = loop {
            if let Ok(code) = exit_rx.try_recv() {
                break code;
            }
            assert!(Instant::now() < deadline, "the program did not end within 30s; saw:\n{seen}");
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(200)) {
                seen.push_str(&String::from_utf8_lossy(&chunk));
            }
            let asks = seen.matches("\x1b[6n").count();
            while answered < asks {
                session.write(b"\x1b[1;1R").expect("answer cursor query");
                answered += 1;
            }
        };
        while let Ok(chunk) = rx.recv_timeout(Duration::from_millis(500)) {
            seen.push_str(&String::from_utf8_lossy(&chunk));
        }
        assert_eq!(code, Some(0), "clean exit; output:\n{seen}");
        assert!(seen.contains("kolux-rs-program-marker"), "the program's output reached the pane:\n{seen}");
        let folder = cwd_text.trim_end_matches(['\\', '/']).to_lowercase();
        assert!(seen.to_lowercase().contains(&folder), "it started in the chosen folder {folder}:\n{seen}");
        session.kill();
    }

    /// TERM-098: a program's colour and light/dark questions reach the pane through the console
    /// layer and the pane's answers reach the program. PowerShell asks, the test answers as the
    /// pane would, and the program prints what it received.
    #[test]
    #[cfg(windows)]
    fn term098_colour_and_mode_queries_pass_through_the_console_layer() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let (exit_tx, exit_rx) = mpsc::channel::<Option<u32>>();
        let script = concat!(
            "$e=[char]27; $q = \"$e]11;?$e\\\" + \"$e]10;?$e\\\" + \"$e]4;1;?$e\\\" + \"$e[?996n\" + \"$e[?2031h\"; ",
            "[Console]::Out.Write($q); [Console]::Out.Flush(); $t=(Get-Date).AddMilliseconds(2500); $s=''; ",
            "while((Get-Date) -lt $t){ if([Console]::KeyAvailable){ $s += [Console]::ReadKey($true).KeyChar } else { Start-Sleep -Milliseconds 20 } }; ",
            "'GOT:' + (($s.ToCharArray() | % { [int]$_ }) -join ',') + ':END'"
        );
        let args = vec!["-NoLogo".to_string(), "-NoProfile".to_string(), "-Command".to_string(), script.to_string()];
        let mut session = PtySession::spawn(
            program_command("powershell", &args, None),
            100,
            30,
            move |chunk| {
                let _ = tx.send(chunk.to_vec());
            },
            move |code| {
                let _ = exit_tx.send(code);
            },
        )
        .expect("spawn powershell in a pty");
        // What the pane would answer to each question, once per question seen.
        let answers: [(&str, &[u8]); 5] = [
            ("\x1b[6n", b"\x1b[1;1R"),
            ("\x1b]11;?", b"\x1b]11;rgb:1111/2222/3333\x1b\\"),
            ("\x1b]10;?", b"\x1b]10;rgb:aaaa/bbbb/cccc\x1b\\"),
            ("\x1b]4;1;?", b"\x1b]4;1;rgb:dddd/eeee/ffff\x1b\\"),
            ("\x1b[?996n", b"\x1b[?997;1n"),
        ];
        let mut answered = [0usize; 5];
        let mut seen = String::new();
        let deadline = Instant::now() + Duration::from_secs(30);
        let code = loop {
            if let Ok(code) = exit_rx.try_recv() {
                break code;
            }
            assert!(Instant::now() < deadline, "the program did not end within 30s; saw:\n{seen:?}");
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(100)) {
                seen.push_str(&String::from_utf8_lossy(&chunk));
            }
            for (i, (ask, reply)) in answers.iter().enumerate() {
                let asks = seen.matches(ask).count();
                while answered[i] < asks {
                    session.write(reply).expect("answer a query");
                    answered[i] += 1;
                }
            }
        };
        while let Ok(chunk) = rx.recv_timeout(Duration::from_millis(500)) {
            seen.push_str(&String::from_utf8_lossy(&chunk));
        }
        session.kill();
        assert_eq!(code, Some(0), "clean exit; output:\n{seen:?}");
        let got: String = seen
            .split_once("GOT:")
            .and_then(|(_, r)| r.split_once(":END"))
            .map(|(codes, _)| codes.split(',').filter_map(|c| c.trim().parse::<u32>().ok()).filter_map(char::from_u32).collect())
            .unwrap_or_default();
        eprintln!("PANE SAW: {seen:?}\nPROGRAM GOT: {got:?}\nANSWERED: {answered:?}");
        // The console layer keeps OSC 10 and 11 questions to itself (measured on Windows 11 26200,
        // DT-C20); the palette question and the light/dark question and subscription get through.
        for ask in ["\x1b]4;1;?", "\x1b[?996n", "\x1b[?2031h"] {
            assert!(seen.contains(ask), "the pane saw the question {ask:?}; pane saw:\n{seen:?}");
        }
        assert!(got.contains("\x1b]4;1;rgb:dddd/eeee/ffff"), "the program got the palette colour; it got {got:?}");
        assert!(got.contains("\x1b[?997;1n"), "the program got the light/dark answer; it got {got:?}");
        assert!(!got.contains("\x1b[1;1R"), "the cursor report stays the console's own; it got {got:?}");
    }

    #[test]
    fn term098_a_reply_is_sent_as_key_events_and_keys_are_not() {
        assert!(is_reply(b"\x1b]11;rgb:1111/2222/3333\x1b\\"));
        assert!(is_reply(b"\x1b[?997;2n"));
        assert!(!is_reply(b"\x1b[1;1R"));
        assert!(!is_reply(b"\x1b[?1;2c"));
        assert!(!is_reply(b"\x1b[200~\x1b]0;x\x07\x1b[201~"));
        assert!(!is_reply(b"ls\r"));
        let keyed = as_key_events(b"\x1b[?997;1n");
        assert!(keyed.starts_with(b"\x1b[0;0;27;1;0;1_\x1b[0;0;27;0;0;1_\x1b[0;0;91;1;0;1_\x1b[0;0;91;0;0;1_"), "{}", String::from_utf8_lossy(&keyed));
        assert_eq!(keyed.iter().filter(|b| **b == b'_').count(), 18, "a down and an up per character");
    }

    /// A program that is not installed fails at spawn with a message, not a silent empty pane.
    #[test]
    fn term040_a_start_folder_is_relative_or_absolute_and_a_missing_one_falls_back() {
        let ws = std::env::temp_dir();
        let ws_s = ws.to_string_lossy().into_owned();
        let sub = ws.join("kolux-rs-t010");
        std::fs::create_dir_all(&sub).unwrap();
        let sub_s = sub.to_string_lossy().into_owned();
        assert_eq!(start_dir(&ws_s, Some("kolux-rs-t010")), sub_s);
        assert_eq!(start_dir(&ws_s, Some(&sub_s)), sub_s);
        assert_eq!(start_dir(&ws_s, Some("no-such-folder-t010")), ws_s);
        assert_eq!(start_dir(&ws_s, None), ws_s);
        assert_eq!(start_dir(&ws_s, Some("  ")), ws_s);
        let _ = std::fs::remove_dir(&sub);
    }

    /// ACCT-046: PowerShell 7, then Windows PowerShell, then the command prompt in UTF-8, taken
    /// from ComSpec when that is set; a Store alias of PowerShell 7 is passed over.
    #[cfg(windows)]
    #[test]
    fn acct046_the_automatic_shell_order_ends_with_a_utf8_command_prompt() {
        let comspec = std::env::temp_dir().join("kolux-rs-acct046-cmd.exe");
        std::fs::write(&comspec, b"").unwrap();
        let line = |v: Vec<(PathBuf, Vec<&str>)>| v.into_iter().map(|(p, a)| format!("{} {}", p.to_string_lossy(), a.join(" "))).collect::<Vec<_>>();
        let all = |n: &str| Some(PathBuf::from(format!("C:/pf/{n}")));
        let cmd = format!("{} /k chcp 65001 >nul", comspec.to_string_lossy());
        assert_eq!(line(auto_shells(all, Some(comspec.clone()))), ["C:/pf/pwsh.exe -NoLogo".to_string(), "C:/pf/powershell.exe -NoLogo".into(), cmd]);
        let store = |n: &str| (n == "pwsh.exe").then(|| PathBuf::from("C:/Users/u/AppData/Local/Microsoft/WindowsApps/pwsh.exe"));
        assert_eq!(line(auto_shells(store, None)), ["cmd.exe /k chcp 65001 >nul".to_string()]);
        let _ = std::fs::remove_file(&comspec);
    }

    /// ACCT-046: a shell that will not start gives way to the next one; when none starts, the
    /// error names each one tried.
    #[test]
    fn acct046_a_shell_that_will_not_start_gives_way_to_the_next() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let mut cmds = vec![program_command("kolux-rs-no-such-shell-7f3a", &[], None)];
        cmds.extend(shell_commands(None));
        let mut session = PtySession::spawn_first(cmds, 80, 24, move |c| {
            let _ = tx.send(c.to_vec());
        }, |_| {})
        .expect("falls back to a shell that starts");
        assert!(rx.recv_timeout(Duration::from_secs(30)).is_ok(), "the fallback shell prints");
        session.kill();
        let none = PtySession::spawn_first(vec![program_command("kolux-rs-no-such-a", &[], None), program_command("kolux-rs-no-such-b", &[], None)], 80, 24, |_| {}, |_| {});
        let err = none.err().expect("nothing starts");
        assert!(err.contains("kolux-rs-no-such-a") && err.contains("kolux-rs-no-such-b"), "{err}");
    }

    /// ACCT-049: a folder that is gone or on a drive that is not there gets a message, and an
    /// agent is kept out of a drive root while a shell may open there.
    #[test]
    fn acct049_start_folders_that_are_gone_unplugged_or_a_drive_root_are_refused() {
        let tmp = std::env::temp_dir();
        assert!(check_start_dir(&tmp.to_string_lossy(), true).is_ok());
        let gone = tmp.join("kolux-rs-acct049-gone");
        assert!(check_start_dir(&gone.to_string_lossy(), false).unwrap_err().contains("no longer exists"));
        let root: PathBuf = tmp.components().take(if cfg!(windows) { 2 } else { 1 }).collect();
        assert!(check_start_dir(&root.to_string_lossy(), false).is_ok(), "a shell may open at a drive root");
        assert!(check_start_dir(&root.to_string_lossy(), true).unwrap_err().contains("root of a drive"));
        if cfg!(windows) {
            if let Some(d) = (b'D'..=b'Z').rev().map(|b| format!("{}:/", b as char)).find(|d| !Path::new(d).exists()) {
                assert!(check_start_dir(&format!("{d}repo"), false).unwrap_err().contains("is not connected"));
            }
        }
        assert!(is_shell_program("C:/Program Files/PowerShell/7/pwsh.exe") && is_shell_program("cmd.exe") && !is_shell_program("claude"));
    }

    /// ACCT-048: Kolux's own runtime and build variables and a partial conda activation are
    /// dropped; the user's own settings stay.
    #[test]
    fn acct048_runtime_build_and_partial_conda_variables_are_not_passed_down() {
        for n in ["TAURI_ENV_DEBUG", "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "CARGO_PKG_NAME", "CARGO_MANIFEST_DIR", "npm_lifecycle_event", "npm_config_user_agent", "INIT_CWD", "CONDA_PREFIX", "CONDA_PREFIX_1", "CONDA_SHLVL", "CONDA_DEFAULT_ENV", "KOLUX_USER_DATA_PATH"] {
            assert!(inherited_noise(n), "{n}");
        }
        for n in ["PATH", "CARGO_HOME", "NPM_CONFIG_PREFIX", "CONDA_EXE", "HOME", "KOLUX_TERMINAL_HANDLE"] {
            assert!(!inherited_noise(n), "{n}");
        }
    }

    #[test]
    fn a_missing_program_is_refused_at_spawn() {
        let r = PtySession::spawn(program_command("kolux-rs-no-such-program-7f3a", &[], None), 80, 24, |_| {}, |_| {});
        assert!(r.is_err());
    }

    /// Closing a pane ends its program even when the program is still waiting for input.
    #[test]
    fn kill_ends_a_running_shell() {
        let (exit_tx, exit_rx) = mpsc::channel::<Option<u32>>();
        let mut session = PtySession::spawn(shell_commands(None).remove(0), 80, 24, |_| {}, move |code| {
            let _ = exit_tx.send(code);
        })
        .expect("spawn shell in a pty");
        session.kill();
        exit_rx.recv_timeout(Duration::from_secs(30)).expect("shell ends after kill");
    }
}
