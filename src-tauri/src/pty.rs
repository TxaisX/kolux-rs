//! One shell session behind a pseudo-terminal (PTY).
//!
//! A `PtySession` owns the PTY master, the child's writer and a way to kill the child. Output is
//! pumped on a reader thread to a callback; a second thread waits for the child and reports its
//! exit. Dropping the session (or calling `kill`) ends the program, by force if it does not leave.

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::thread;

/// Which program a new pane runs. Windows PowerShell ships with every Windows install; `pwsh`
/// (PowerShell 7) is used only when the user has it on the path.
pub fn shell_command() -> CommandBuilder {
    let mut cmd = if cfg!(windows) {
        let mut c = CommandBuilder::new("powershell.exe");
        c.arg("-NoLogo");
        c
    } else {
        CommandBuilder::new(std::env::var("SHELL").unwrap_or_else(|_| "sh".into()))
    };
    if let Ok(home) = std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        cmd.cwd(home);
    }
    cmd
}

pub struct PtySession {
    master: Option<Box<dyn MasterPty + Send>>,
    writer: Option<Box<dyn Write + Send>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
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

        Ok(Self { master: Some(pair.master), writer: Some(writer), killer })
    }

    /// Sends keystrokes (already encoded as the terminal would) to the program.
    pub fn write(&mut self, data: &[u8]) -> Result<(), String> {
        let w = self.writer.as_mut().ok_or("session already closed")?;
        w.write_all(data).and_then(|_| w.flush()).map_err(|e| e.to_string())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let m = self.master.as_ref().ok_or("session already closed")?;
        m.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())
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

    /// The round trip every pane depends on: a real shell, a typed command, its output read back.
    #[test]
    fn shell_echoes_a_marker_back_through_the_pty() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let (exit_tx, exit_rx) = mpsc::channel::<Option<u32>>();
        let mut session = PtySession::spawn(
            shell_command(),
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

    /// Closing a pane ends its program even when the program is still waiting for input.
    #[test]
    fn kill_ends_a_running_shell() {
        let (exit_tx, exit_rx) = mpsc::channel::<Option<u32>>();
        let mut session = PtySession::spawn(shell_command(), 80, 24, |_| {}, move |code| {
            let _ = exit_tx.send(code);
        })
        .expect("spawn shell in a pty");
        session.kill();
        exit_rx.recv_timeout(Duration::from_secs(30)).expect("shell ends after kill");
    }
}
