//! TERM-045: whether a process has started programs of its own, so closing an idle shell does
//! not ask while closing one that runs a dev server does. `None` when the check itself fails; the
//! caller then closes without asking (fails open).

/// True when some running process has `pid` as its parent.
pub fn has_children(pid: u32) -> Option<bool> {
    imp::has_children(pid)
}

#[cfg(windows)]
mod imp {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};

    // ponytail: parent ids only; Windows keeps a dead parent's id on its orphans, so a reused pid
    // could read as busy. Compare creation times if a false "busy" ever shows up.
    pub fn has_children(pid: u32) -> Option<bool> {
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
                if entry.th32ParentProcessID == pid && entry.th32ProcessID != pid {
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
}
