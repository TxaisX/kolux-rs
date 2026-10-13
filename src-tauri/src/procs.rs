//! TERM-045: whether a process has started programs of its own, so closing an idle shell does
//! not ask while closing one that runs a dev server does. `None` when the check itself fails; the
//! caller then closes without asking (fails open).
//! ORCH-058: ending a process with everything it started, and proving the processes are gone.

use std::time::{Duration, Instant};

/// True when some running process has `pid` as its parent.
pub fn has_children(pid: u32) -> Option<bool> {
    imp::has_children(pid)
}

/// Whether process `pid` still runs; `None` when the check itself fails.
pub fn alive(pid: u32) -> Option<bool> {
    imp::alive(pid)
}

/// Ends `pid` and every process it started (a dev server a shell runs holds the folder too).
pub fn kill_tree(pid: u32) {
    imp::kill_tree(pid)
}

/// ORCH-058: the pids of `pids` still running, or unprovable, once `wait` has passed; one that
/// is already gone never counts, so a stale record does not block.
pub fn wait_gone(pids: &[u32], wait: Duration) -> Vec<u32> {
    wait_gone_by(pids, wait, alive)
}

fn wait_gone_by(pids: &[u32], wait: Duration, alive: impl Fn(u32) -> Option<bool>) -> Vec<u32> {
    let end = Instant::now() + wait;
    loop {
        // ponytail: a pid reused by a new process inside the wait would read as stuck; compare
        // creation times if that ever shows up.
        let left: Vec<u32> = pids.iter().copied().filter(|p| alive(*p) != Some(false)).collect();
        if left.is_empty() || Instant::now() >= end {
            return left;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(windows)]
mod imp {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};

    // ponytail: parent ids only; Windows keeps a dead parent's id on its orphans, so a reused pid
    // could read as busy. Compare creation times if a false "busy" ever shows up.
    pub fn has_children(pid: u32) -> Option<bool> {
        any(|e| e.th32ParentProcessID == pid && e.th32ProcessID != pid)
    }

    pub fn alive(pid: u32) -> Option<bool> {
        any(|e| e.th32ProcessID == pid)
    }

    /// `taskkill /T` ends the processes `pid` started before `pid` itself, with no console window.
    pub fn kill_tree(pid: u32) {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill").args(["/T", "/F", "/PID", &pid.to_string()]).creation_flags(0x0800_0000).output();
    }

    /// Whether some entry of the process table satisfies `hit`; `None` when the table cannot be read.
    fn any(mut hit: impl FnMut(&PROCESSENTRY32W) -> bool) -> Option<bool> {
        // SAFETY: the snapshot handle is checked before use and closed once; the entry is zeroed
        // with its size set, as Process32FirstW/NextW require, and only read after a success.
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE {
                return None;
            }
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut found = false;
            let mut ok = Process32FirstW(snap, &mut entry) != 0;
            let walked = ok;
            while ok {
                if hit(&entry) {
                    found = true;
                    break;
                }
                ok = Process32NextW(snap, &mut entry) != 0;
            }
            CloseHandle(snap);
            walked.then_some(found)
        }
    }
}

#[cfg(not(windows))]
mod imp {
    /// `pgrep -P` ships with Linux and macOS: exit 0 when a child was listed, 1 when none.
    pub fn has_children(pid: u32) -> Option<bool> {
        let out = std::process::Command::new("pgrep").arg("-P").arg(pid.to_string()).output().ok()?;
        match out.status.code() {
            Some(0) => Some(true),
            Some(1) => Some(false),
            _ => None,
        }
    }

    /// `kill -0` tells whether the process exists without touching it.
    pub fn alive(pid: u32) -> Option<bool> {
        let out = std::process::Command::new("kill").arg("-0").arg(pid.to_string()).output().ok()?;
        match out.status.code() {
            Some(0) => Some(true),
            Some(1) => Some(false),
            _ => None,
        }
    }

    /// The PTY child leads its own process group, so the group signal takes everything it started.
    pub fn kill_tree(pid: u32) {
        let _ = std::process::Command::new("kill").args(["-9", &format!("-{pid}")]).output();
        let _ = std::process::Command::new("kill").args(["-9", &pid.to_string()]).output();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn term045_a_process_running_a_child_has_children_and_the_child_has_none() {
        let mut child = if cfg!(windows) {
            std::process::Command::new("powershell.exe").args(["-NoLogo", "-NoProfile", "-Command", "Start-Sleep 5"]).spawn().unwrap()
        } else {
            std::process::Command::new("sleep").arg("5").spawn().unwrap()
        };
        assert_eq!(has_children(std::process::id()), Some(true), "this test process runs a child");
        let leaf = has_children(child.id());
        let _ = child.kill();
        let _ = child.wait();
        assert_eq!(leaf, Some(false), "the sleeping child starts nothing");
    }

    #[test]
    fn orch058_a_gone_pid_is_never_stuck_while_a_live_or_unknowable_one_is() {
        use std::time::{Duration, Instant};
        // 1 is already gone (stale record), 2 keeps running: only 2 is stuck once the wait is up.
        assert_eq!(wait_gone_by(&[1, 2], Duration::from_millis(20), |p| Some(p == 2)), vec![2]);
        // A probe that cannot answer gives no proof, so the pid counts as stuck.
        assert_eq!(wait_gone_by(&[7], Duration::from_millis(20), |_| None), vec![7]);
        // Nothing to wait for returns at once.
        let t = Instant::now();
        assert!(wait_gone_by(&[], Duration::from_secs(5), |_| Some(true)).is_empty());
        assert!(t.elapsed() < Duration::from_secs(1));
        // A process that ends during the wait is not stuck.
        let t = Instant::now();
        assert!(wait_gone_by(&[3], Duration::from_secs(3), move |_| Some(t.elapsed() < Duration::from_millis(150))).is_empty());
    }

    #[test]
    fn orch058_kill_tree_ends_a_shell_and_the_program_it_started() {
        use std::time::Duration;
        let mut child = if cfg!(windows) {
            std::process::Command::new("cmd.exe").args(["/c", "ping -n 60 127.0.0.1 >nul"]).spawn().unwrap()
        } else {
            std::process::Command::new("sh").args(["-c", "sleep 60; true"]).spawn().unwrap()
        };
        let pid = child.id();
        std::thread::sleep(Duration::from_millis(700));
        assert_eq!(has_children(pid), Some(true), "the shell started its program");
        assert_eq!(alive(pid), Some(true));
        kill_tree(pid);
        let _ = child.wait();
        drop(child);
        assert!(wait_gone(&[pid], Duration::from_secs(5)).is_empty(), "the shell is gone");
        // An orphan would still name the dead shell as its parent: the program went with it.
        assert_eq!(has_children(pid), Some(false), "the program the shell started is gone too");
        assert_eq!(alive(pid), Some(false));
    }
}
