//! TERM-045: whether a process has started programs of its own, so closing an idle shell does
//! not ask while closing one that runs a dev server does. `None` when the check itself fails; the
//! caller then closes without asking (fails open).
//! ORCH-058: ending a process with everything it started, and proving the processes are gone.
//! APP-053 / ACCT-051 / STAT-054 (T-184): the only place that touches Windows Job Objects. One job
//! holds the app itself, so every program it starts (pane shells, git, helpers) ends with the app
//! however the app ends; one job per pane ends that pane's shell and everything it launched when
//! the pane closes, and no other pane's.

use std::sync::OnceLock;
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

/// A kernel job whose members, and everything they start, are all ended the moment its last
/// handle closes (Windows: "kill on job close"). Elsewhere a stand-in that holds nothing, so the
/// callers read the same on every platform and the process-group kill does the work.
pub struct Job(imp::Job);

impl Job {
    /// A new job with "kill on close" set. Nothing is in it yet.
    pub fn new() -> Result<Job, String> {
        imp::Job::new().map(Job)
    }

    /// Puts the process with id `pid` in the job; from then on every process it starts is in it
    /// too (children never break away: nothing here uses a breakaway flag).
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn assign_pid(&self, pid: u32) -> Result<(), String> {
        self.0.assign_pid(pid)
    }

    /// Puts this process itself in the job.
    pub fn assign_self(&self) -> Result<(), String> {
        self.0.assign_self()
    }

    /// Puts a program the PTY layer started in the job, by the handle it holds (so a reused pid
    /// can never point the job at a stranger), with the pid as the fallback.
    pub fn assign_child(&self, child: &dyn portable_pty::Child) -> Result<(), String> {
        self.0.assign_child(child)
    }

    /// Whether process `pid` is in the job (directly or through a job nested in it).
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn holds_pid(&self, pid: u32) -> Result<bool, String> {
        self.0.holds_pid(pid)
    }
}

struct AppJob {
    job: Job,
    /// Whether the app itself is in the job (then its children are members by inheritance).
    holds_app: bool,
}

static APP: OnceLock<Option<AppJob>> = OnceLock::new();

/// Called once at startup: creates the app-wide job and puts the app itself in it, so everything
/// the app starts from then on is a member and goes down with the app on a quit, a crash or a
/// kill from outside. True when the app is in the job. When it cannot be put in (an outer job that
/// refuses nesting), the job still exists and each pane program is put in it explicitly instead.
pub fn app_job_start() -> bool {
    APP.get_or_init(|| {
        Job::new().ok().map(|job| {
            let holds_app = job.assign_self().is_ok();
            AppJob { job, holds_app }
        })
    })
    .as_ref()
    .is_some_and(|a| a.holds_app)
}

/// A job of its own for one pane, holding `child` and so everything it starts; the app-wide job
/// also gets the child when it does not already hold the app. `None` when jobs are unavailable:
/// the pane still runs and closes the old way (the shell is killed, its tree by `kill_tree`).
pub fn pane_job(child: &dyn portable_pty::Child) -> Option<Job> {
    if let Some(Some(app)) = APP.get() {
        if !app.holds_app {
            let _ = app.job.assign_child(child);
        }
    }
    let job = Job::new().ok()?;
    job.assign_child(child).ok()?;
    Some(job)
}

#[cfg(windows)]
mod imp {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows_sys::Win32::System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW, IsProcessInJob, JobObjectExtendedLimitInformation, SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

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

    /// The job handle; the only handle to the job, so dropping it is what ends the members. The
    /// handle is not inheritable (no security attributes at creation), so no child can keep the
    /// job alive past its owner.
    pub struct Job(HANDLE);

    // SAFETY: a job handle is a kernel object reference; the Win32 calls on it are thread-safe
    // and nothing here hands out the raw handle.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    fn last_error(what: &str) -> String {
        // SAFETY: reads the calling thread's last error code; no pointers involved.
        format!("{what} failed (Windows error {})", unsafe { GetLastError() })
    }

    /// Runs `f` with a handle to process `pid` opened for `access`; the handle is not inheritable
    /// and is closed here.
    fn with_process<T>(pid: u32, access: u32, f: impl FnOnce(HANDLE) -> Result<T, String>) -> Result<T, String> {
        // SAFETY: the opened handle is checked, used inside `f` only and closed once afterwards.
        unsafe {
            let p = OpenProcess(access, 0, pid);
            if p.is_null() {
                return Err(last_error("OpenProcess"));
            }
            let r = f(p);
            CloseHandle(p);
            r
        }
    }

    impl Job {
        pub fn new() -> Result<Job, String> {
            // SAFETY: the handle is checked before use; the limit struct is zeroed, sized and
            // passed with its own length, as SetInformationJobObject requires; on a failure the
            // handle is closed here and never returned.
            unsafe {
                let h = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if h.is_null() {
                    return Err(last_error("CreateJobObject"));
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(h, JobObjectExtendedLimitInformation, &info as *const _ as *const std::ffi::c_void, std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32);
                if ok == 0 {
                    let e = last_error("SetInformationJobObject");
                    CloseHandle(h);
                    return Err(e);
                }
                Ok(Job(h))
            }
        }

        fn assign_handle(&self, process: HANDLE) -> Result<(), String> {
            // SAFETY: both handles are open for the duration of the call; a process already in
            // another job is nested under it (Windows 8 and later), never moved.
            if unsafe { AssignProcessToJobObject(self.0, process) } == 0 {
                return Err(last_error("AssignProcessToJobObject"));
            }
            Ok(())
        }

        pub fn assign_pid(&self, pid: u32) -> Result<(), String> {
            with_process(pid, PROCESS_SET_QUOTA | PROCESS_TERMINATE, |p| self.assign_handle(p))
        }

        pub fn assign_self(&self) -> Result<(), String> {
            // SAFETY: the current-process pseudo handle needs no closing and carries every right.
            self.assign_handle(unsafe { GetCurrentProcess() })
        }

        pub fn assign_child(&self, child: &dyn portable_pty::Child) -> Result<(), String> {
            match child.as_raw_handle() {
                Some(h) => self.assign_handle(h as HANDLE),
                None => child.process_id().map_or(Err("the program has no handle and no pid".into()), |p| self.assign_pid(p)),
            }
        }

        #[cfg_attr(not(test), allow(dead_code))]
        pub fn holds_pid(&self, pid: u32) -> Result<bool, String> {
            with_process(pid, PROCESS_QUERY_LIMITED_INFORMATION, |p| {
                let mut inside: i32 = 0;
                // SAFETY: both handles are open; `inside` is written only on success.
                if unsafe { IsProcessInJob(p, self.0, &mut inside) } == 0 {
                    return Err(last_error("IsProcessInJob"));
                }
                Ok(inside != 0)
            })
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: the handle was returned open by CreateJobObjectW and is closed once, here.
            unsafe {
                CloseHandle(self.0);
            }
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

    /// No job objects here: the process-group kill in `kill_tree` is what ends a pane's tree.
    pub struct Job;

    impl Job {
        pub fn new() -> Result<Job, String> {
            Ok(Job)
        }

        pub fn assign_pid(&self, _pid: u32) -> Result<(), String> {
            Ok(())
        }

        pub fn assign_self(&self) -> Result<(), String> {
            Ok(())
        }

        pub fn assign_child(&self, _child: &dyn portable_pty::Child) -> Result<(), String> {
            Ok(())
        }

        #[cfg_attr(not(test), allow(dead_code))]
        pub fn holds_pid(&self, _pid: u32) -> Result<bool, String> {
            Ok(false)
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

    /// Whether `tasklist /FI "PID eq <pid>"` still lists the process (the second column is the pid).
    #[cfg(windows)]
    fn listed(pid: u32) -> bool {
        let out = std::process::Command::new("tasklist").args(["/NH", "/FI", &format!("PID eq {pid}")]).output().expect("tasklist runs");
        String::from_utf8_lossy(&out.stdout).lines().any(|l| l.split_whitespace().nth(1) == Some(pid.to_string().as_str()))
    }

    /// Polls `tasklist` until `pid` is gone; how long that took, or `None` after two seconds.
    #[cfg(windows)]
    fn gone_within_2s(pid: u32) -> Option<Duration> {
        let t = Instant::now();
        while t.elapsed() < Duration::from_secs(2) {
            if !listed(pid) {
                return Some(t.elapsed());
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        None
    }

    /// APP-053 / ACCT-051: closing a job ends the shell it holds and the program the shell started,
    /// within two seconds, while a shell in another job runs on untouched.
    #[cfg(windows)]
    #[test]
    fn t184_closing_a_job_ends_its_shell_and_its_program_and_not_another_jobs() {
        // The jobs exist first and each shell is put in its job the instant it is started: a
        // process brings nothing it started before it was put in (so the app does the same: a
        // pane's shell is put in its job straight after the spawn, before it can start anything).
        let job_a = Job::new().expect("a job is created");
        let job_b = Job::new().expect("a second job is created");
        let spawn = |job: &Job| {
            let child = std::process::Command::new("cmd.exe").args(["/c", "ping -n 30 127.0.0.1 >nul"]).spawn().expect("cmd starts");
            job.assign_pid(child.id()).expect("the shell is put in its job");
            child
        };
        let mut a = spawn(&job_a);
        let mut b = spawn(&job_b);
        assert_eq!(job_a.holds_pid(a.id()), Ok(true), "job A holds shell A");
        assert_eq!(job_a.holds_pid(b.id()), Ok(false), "job A does not hold shell B");
        std::thread::sleep(Duration::from_millis(700));
        assert_eq!(has_children(a.id()), Some(true), "shell A started its ping");
        assert_eq!(has_children(b.id()), Some(true), "shell B started its ping");
        assert!(listed(a.id()) && listed(b.id()), "tasklist lists both shells before the close");

        // A ping that escaped the job would run on for 30 s with the dead shell as its parent;
        // one the job ended leaves the process table within the same two seconds.
        let ping_gone_within_2s = |shell: u32| {
            let t = Instant::now();
            while t.elapsed() < Duration::from_secs(2) {
                if has_children(shell) == Some(false) {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            false
        };
        drop(job_a);
        let took = gone_within_2s(a.id()).expect("shell A is gone from tasklist within 2 s of closing job A");
        eprintln!("shell A gone {} ms after job A closed", took.as_millis());
        assert!(ping_gone_within_2s(a.id()), "shell A's ping went with the job");
        assert!(listed(b.id()), "shell B, in the other job, is still listed");
        assert_eq!(alive(b.id()), Some(true), "shell B still runs");
        assert_eq!(has_children(b.id()), Some(true), "shell B's ping still runs");

        drop(job_b);
        let took = gone_within_2s(b.id()).expect("shell B is gone within 2 s of closing job B");
        eprintln!("shell B gone {} ms after job B closed", took.as_millis());
        assert!(ping_gone_within_2s(b.id()), "shell B's ping went with its job");
        let _ = a.wait();
        let _ = b.wait();
    }

    /// The app-wide job takes the app itself, so a program started afterwards is a member without
    /// any assignment of its own.
    #[cfg(windows)]
    #[test]
    fn t184_the_app_job_holds_the_process_and_what_it_starts() {
        assert!(app_job_start(), "the test process is put in the app-wide job");
        assert!(app_job_start(), "a second call answers the same without a second job");
        let app = APP.get().and_then(Option::as_ref).expect("the app job exists");
        assert_eq!(app.job.holds_pid(std::process::id()), Ok(true), "the app job holds this process");
        let mut child = std::process::Command::new("cmd.exe").args(["/c", "ping -n 3 127.0.0.1 >nul"]).spawn().expect("cmd starts");
        assert_eq!(app.job.holds_pid(child.id()), Ok(true), "a program started afterwards is in the app job by inheritance");
        let _ = child.kill();
        let _ = child.wait();
    }
}
