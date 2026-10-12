//! One shell session behind a pseudo-terminal (PTY).
//!
//! A `PtySession` owns the PTY master, the child's writer and a way to kill the child. Output is
//! pumped on a reader thread to a callback; a second thread waits for the child and reports its
//! exit. Dropping the session (or calling `kill`) ends the program, by force if it does not leave.

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::thread;

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

/// Which program a new pane runs. Windows PowerShell ships with every Windows install; `pwsh`
/// (PowerShell 7) is used only when the user has it on the path. The shell starts in `cwd` when
/// that folder exists (a workspace's folder), otherwise in the user's home folder.
pub fn shell_command(cwd: Option<&str>) -> CommandBuilder {
    let mut cmd = if cfg!(windows) {
        let mut c = CommandBuilder::new("powershell.exe");
        c.arg("-NoLogo");
        c
    } else {
        CommandBuilder::new(std::env::var("SHELL").unwrap_or_else(|_| "sh".into()))
    };
    match cwd.filter(|d| std::path::Path::new(d).is_dir()) {
        Some(dir) => cmd.cwd(dir),
        None => {
            if let Ok(home) = std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
                cmd.cwd(home);
            }
        }
    }
    cmd
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
}

impl PtySession {
    /// Spawns `cmd` in a fresh PTY of `cols` x `rows`. `on_output` receives every chunk the program
    /// prints; `on_exit` runs once with the exit code when the program ends.
    pub fn spawn(
        cmd: CommandBuilder,
        cols: u16,
        rows: u16,
        mut on_output: impl FnMut(&[u8]) + Send + 'static,
        on_exit: impl FnOnce(Option<u32>) + Send + 'static,
    ) -> Result<Self, String> {
        let pair = native_pty_system()
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
        let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
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

        Ok(Self { master: Some(pair.master), writer: Some(writer), killer, pid })
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

    /// The round trip every pane depends on: a real shell, a typed command, its output read back.
    #[test]
    fn shell_echoes_a_marker_back_through_the_pty() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let (exit_tx, exit_rx) = mpsc::channel::<Option<u32>>();
        let mut session = PtySession::spawn(
            shell_command(None),
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

    #[test]
    fn a_missing_program_is_refused_at_spawn() {
        let r = PtySession::spawn(program_command("kolux-rs-no-such-program-7f3a", &[], None), 80, 24, |_| {}, |_| {});
        assert!(r.is_err());
    }

    /// Closing a pane ends its program even when the program is still waiting for input.
    #[test]
    fn kill_ends_a_running_shell() {
        let (exit_tx, exit_rx) = mpsc::channel::<Option<u32>>();
        let mut session = PtySession::spawn(shell_command(None), 80, 24, |_| {}, move |code| {
            let _ = exit_tx.send(code);
        })
        .expect("spawn shell in a pty");
        session.kill();
        exit_rx.recv_timeout(Duration::from_secs(30)).expect("shell ends after kill");
    }
}
