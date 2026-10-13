//! APP-054: the Resource Manager's figures. Memory and CPU for the app itself and for every
//! terminal session (its whole process tree), and how much memory the computer has free.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

/// One process as the OS lists it: its id, its parent's id, resident memory in bytes and the CPU
/// time it has used so far, in 100 ns units. Figures stay 0 until `imp::fill` reads them.
#[derive(Clone, Copy, Debug, Default)]
pub struct Proc {
    pub pid: u32,
    pub parent: u32,
    pub bytes: u64,
    pub cpu: u64,
}

#[derive(Serialize, Clone, Copy, Debug, Default, PartialEq)]
pub struct Usage {
    pub bytes: u64,
    /// Percent of the whole machine (every core), 0 to 100.
    pub cpu: f64,
    pub processes: usize,
}

#[derive(Serialize)]
pub struct SessionUsage {
    pub id: u32,
    pub dir: Option<String>,
    #[serde(flatten)]
    pub usage: Usage,
}

#[derive(Serialize)]
pub struct Resources {
    pub app: Usage,
    pub sessions: Vec<SessionUsage>,
    /// The computer's free memory by its own measure (available memory on Windows and Linux).
    pub free: Option<u64>,
    pub total: Option<u64>,
}

/// Who each process is counted under: the first session whose tree reaches it, else the app (any
/// other process under the app's own). A process, and so a subtree, is never counted twice.
pub fn owners(procs: &[Proc], roots: &[(u32, u32)], app_pid: u32) -> HashMap<u32, Option<u32>> {
    let mut kids: HashMap<u32, Vec<u32>> = HashMap::new();
    for p in procs.iter().filter(|p| p.pid != p.parent) {
        kids.entry(p.parent).or_default().push(p.pid);
    }
    let mut owner = HashMap::new();
    let starts = roots.iter().map(|&(id, pid)| (pid, Some(id))).chain([(app_pid, None)]);
    for (start, who) in starts {
        let mut stack = vec![start];
        while let Some(pid) = stack.pop() {
            if owner.contains_key(&pid) {
                continue;
            }
            owner.insert(pid, who);
            stack.extend(kids.get(&pid).into_iter().flatten());
        }
    }
    owner
}

/// CPU time used between two samples as a percent of the machine: clamped to its total core
/// capacity, so a bad sample never shows more than 100.
pub fn percent(used: u64, secs: f64, cores: usize) -> f64 {
    if secs <= 0.0 {
        return 0.0;
    }
    (used as f64 / 1e7 / secs / cores.max(1) as f64 * 100.0).clamp(0.0, 100.0)
}

/// The previous sample's CPU times, so the next one can say how much was used in between.
#[derive(Default)]
pub struct Sampler {
    last: Mutex<Option<(Instant, HashMap<u32, u64>)>>,
}

/// Adds the figures up per owner. `before` holds the CPU times of the last sample; a process
/// seen for the first time counts no CPU yet. `app_ws` stands in when the app's own row is missing.
pub fn total(procs: &[Proc], owner: &HashMap<u32, Option<u32>>, before: &HashMap<u32, u64>, secs: f64, cores: usize, app_pid: u32, app_ws: Option<u64>) -> (Usage, HashMap<u32, Usage>) {
    let mut sums: HashMap<Option<u32>, (u64, u64, usize)> = HashMap::new();
    for p in procs {
        if let Some(who) = owner.get(&p.pid) {
            let used = before.get(&p.pid).map_or(0, |b| p.cpu.saturating_sub(*b));
            let s = sums.entry(*who).or_default();
            *s = (s.0 + p.bytes, s.1 + used, s.2 + 1);
        }
    }
    let usage = |(bytes, used, processes): (u64, u64, usize)| Usage { bytes, cpu: percent(used, secs, cores), processes };
    let mut app = usage(sums.remove(&None).unwrap_or_default());
    if !procs.iter().any(|p| p.pid == app_pid) {
        app.bytes += app_ws.unwrap_or(0);
    }
    (app, sums.into_iter().filter_map(|(k, v)| Some((k?, usage(v)))).collect())
}

#[tauri::command]
pub async fn resources(terminals: tauri::State<'_, crate::terminal::Terminals>, sampler: tauri::State<'_, Sampler>) -> Result<Resources, String> {
    let sessions = terminals.list();
    let roots: Vec<(u32, u32)> = sessions.iter().filter_map(|(id, pid, _)| Some((*id, (*pid)?))).collect();
    let app_pid = std::process::id();
    let mut procs = imp::processes().unwrap_or_default();
    let owner = owners(&procs, &roots, app_pid);
    for p in procs.iter_mut().filter(|p| owner.contains_key(&p.pid)) {
        imp::fill(p);
    }
    let now = Instant::now();
    let cores = std::thread::available_parallelism().map_or(1, |n| n.get());
    let mut last = sampler.last.lock().unwrap_or_else(|e| e.into_inner());
    let (secs, before) = match last.take() {
        Some((at, times)) => (now.duration_since(at).as_secs_f64(), times),
        None => (0.0, HashMap::new()),
    };
    let (app, mut each) = total(&procs, &owner, &before, secs, cores, app_pid, crate::sysmem::working_set_bytes());
    *last = Some((now, procs.iter().filter(|p| owner.contains_key(&p.pid)).map(|p| (p.pid, p.cpu)).collect()));
    let (free, total) = imp::memory();
    let sessions = sessions.into_iter().map(|(id, _, dir)| SessionUsage { id, dir, usage: each.remove(&id).unwrap_or_default() }).collect();
    Ok(Resources { app, sessions, free, total })
}

#[cfg(windows)]
mod imp {
    use super::Proc;
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows_sys::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    use windows_sys::Win32::System::Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    // ponytail: parent ids only, as in procs.rs; a reused pid could pull a stranger into a tree.
    // Compare creation times if a figure ever looks too big.
    pub fn processes() -> Option<Vec<Proc>> {
        // SAFETY: the snapshot handle is checked before use and closed once; the entry is zeroed
        // with its size set, as Process32FirstW/NextW require, and only read after a success.
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE {
                return None;
            }
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut out = Vec::new();
            let mut ok = Process32FirstW(snap, &mut entry) != 0;
            while ok {
                out.push(Proc { pid: entry.th32ProcessID, parent: entry.th32ParentProcessID, ..Proc::default() });
                ok = Process32NextW(snap, &mut entry) != 0;
            }
            CloseHandle(snap);
            Some(out)
        }
    }

    fn ticks(t: FILETIME) -> u64 {
        (u64::from(t.dwHighDateTime) << 32) | u64::from(t.dwLowDateTime)
    }

    /// Working set and CPU time; a process that cannot be opened keeps zeros.
    pub fn fill(p: &mut Proc) {
        // SAFETY: the handle is checked before use and closed once; both out-structs are zeroed
        // and sized as the calls require, and only read after a success.
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, p.pid);
            if h.is_null() {
                return;
            }
            let mut c: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
            c.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
            if K32GetProcessMemoryInfo(h, &mut c, c.cb) != 0 {
                p.bytes = c.WorkingSetSize as u64;
            }
            let zero = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
            let (mut created, mut exited, mut kernel, mut user) = (zero, zero, zero, zero);
            if GetProcessTimes(h, &mut created, &mut exited, &mut kernel, &mut user) != 0 {
                p.cpu = ticks(kernel) + ticks(user);
            }
            CloseHandle(h);
        }
    }

    /// Available and total physical memory.
    pub fn memory() -> (Option<u64>, Option<u64>) {
        // SAFETY: the struct is zeroed with dwLength set, as GlobalMemoryStatusEx requires.
        unsafe {
            let mut m: MEMORYSTATUSEX = std::mem::zeroed();
            m.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
            if GlobalMemoryStatusEx(&mut m) == 0 {
                return (None, None);
            }
            (Some(m.ullAvailPhys), Some(m.ullTotalPhys))
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::Proc;

    /// `ps` on Linux and macOS: pid, parent, resident KiB and cumulative CPU time.
    pub fn processes() -> Option<Vec<Proc>> {
        let out = std::process::Command::new("ps").args(["-axo", "pid=,ppid=,rss=,time="]).output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        Some(
            text.lines()
                .filter_map(|l| {
                    let mut f = l.split_whitespace();
                    Some(Proc { pid: f.next()?.parse().ok()?, parent: f.next()?.parse().ok()?, bytes: f.next()?.parse::<u64>().ok()? * 1024, cpu: (seconds(f.next()?)? * 1e7) as u64 })
                })
                .collect(),
        )
    }

    /// `[[dd-]hh:]mm:ss[.ff]` as seconds.
    fn seconds(t: &str) -> Option<f64> {
        let (days, rest) = match t.split_once('-') {
            Some((d, r)) => (d.parse::<f64>().ok()?, r),
            None => (0.0, t),
        };
        rest.split(':').try_fold(0.0, |acc, part| part.parse::<f64>().ok().map(|v| acc * 60.0 + v)).map(|s| s + days * 86400.0)
    }

    pub fn fill(_: &mut Proc) {}

    /// Linux: MemAvailable and MemTotal from /proc/meminfo.
    /// ponytail: macOS reports none; its memory-pressure figure waits with T-285.
    pub fn memory() -> (Option<u64>, Option<u64>) {
        let Ok(text) = std::fs::read_to_string("/proc/meminfo") else { return (None, None) };
        let field = |name: &str| text.lines().find_map(|l| l.strip_prefix(name)).and_then(|v| v.split_whitespace().next()?.parse::<u64>().ok()).map(|kb| kb * 1024);
        (field("MemAvailable:"), field("MemTotal:"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pid: u32, parent: u32, bytes: u64, cpu: u64) -> Proc {
        Proc { pid, parent, bytes, cpu }
    }

    #[test]
    fn app054_each_tree_is_counted_once_and_the_rest_goes_to_the_app() {
        // app 1 runs the WebView (2) and two shells (10, 20); shell 10 runs a dev server (11) that
        // runs a child (12); session 7's root is 11, already inside session 5's tree.
        let procs = [p(1, 0, 100, 0), p(2, 1, 50, 0), p(10, 1, 10, 0), p(11, 10, 30, 0), p(12, 11, 5, 0), p(20, 1, 7, 0), p(99, 0, 1000, 0)];
        let owner = owners(&procs, &[(5, 10), (6, 20), (7, 11)], 1);
        assert_eq!(owner.get(&12), Some(&Some(5)));
        assert_eq!(owner.get(&99), None, "a stranger is nobody's");
        let (app, each) = total(&procs, &owner, &HashMap::new(), 2.0, 4, 1, Some(1));
        assert_eq!((app.bytes, app.processes), (150, 2));
        assert_eq!((each[&5].bytes, each[&5].processes), (45, 3));
        assert_eq!(each[&6].bytes, 7);
        assert!(!each.contains_key(&7), "a subtree already counted is never added twice");
        // the app's own row missing: its working set stands in
        let (app, _) = total(&procs[1..], &owner, &HashMap::new(), 2.0, 4, 1, Some(64));
        assert_eq!(app.bytes, 50 + 64);
    }

    #[test]
    fn app054_cpu_is_a_share_of_every_core_and_never_above_it() {
        // 1 s of CPU in 2 s on 4 cores is 12.5 %
        let before = HashMap::from([(10, 0), (11, 5_000_000)]);
        let procs = [p(10, 1, 0, 5_000_000), p(11, 10, 0, 10_000_000)];
        let owner = owners(&procs, &[(5, 10)], 1);
        let (_, each) = total(&procs, &owner, &before, 2.0, 4, 1, None);
        assert_eq!(each[&5].cpu, 12.5);
        assert_eq!(percent(u64::MAX, 0.5, 8), 100.0);
        assert_eq!(percent(10, 0.0, 8), 0.0);
    }
}
