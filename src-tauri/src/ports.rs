//! VIEW-078: the ports the user's workspaces are listening on. A scan lists every TCP port some
//! program is listening on, ties each to the deepest workspace folder holding its process's
//! working folder, and calls the rest external. Stopping a port is allowed only for the program the
//! user saw, running inside a workspace folder that is really a worktree the project store knows;
//! an external program, a system process, or Kolux's own helpers are never touched.

use serde::Serialize;

#[cfg(all(windows, not(target_pointer_width = "64")))]
compile_error!("ports.rs reads another process's parameter block with the 64-bit layout; a 32-bit Windows build is not supported");

/// One listening socket as the system reports it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Listener {
    pub port: u16,
    pub address: String,
    pub pid: u32,
    pub name: String,
    /// The process's working folder, when this user may read it.
    pub cwd: Option<String>,
    /// When the process started, as the system counts it, so a later program that reuses its
    /// process number is told apart from it. `None` when the process cannot be opened.
    pub started: Option<u64>,
    /// The process's parent chain, nearest first, as far as the system shows it.
    pub ancestors: Vec<u32>,
}

/// What the status bar draws for one port.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortRow {
    pub port: u16,
    pub address: String,
    pub pid: u32,
    pub name: String,
    /// The deepest workspace folder holding the program's working folder; `None` = external.
    pub worktree: Option<String>,
    pub external: bool,
}

/// What a stop did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Stop {
    /// Nothing listens on the port any more: counts as success.
    Gone,
    Stopped(Vec<u32>),
}

/// What the status bar asks to stop: the port and the program it showed on it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StopRequest {
    pub port: u16,
    pub pid: u32,
}

/// What a stop is checked against besides the request.
pub struct Guards<'a> {
    /// Kolux's own process.
    pub own_pid: u32,
    /// The shells the panes started: a program under one of them is the user's own.
    pub pane_pids: &'a [u32],
    /// The program's start time as the system reports it now, read just before the kill.
    pub started_now: &'a dyn Fn(u32) -> Option<u64>,
}

fn norm(p: &str) -> String {
    let p = p.strip_prefix(r"\\?\").unwrap_or(p).replace('\\', "/");
    let p = p.trim_end_matches('/').to_string();
    if cfg!(windows) {
        p.to_lowercase()
    } else {
        p
    }
}

/// The deepest of `worktrees` that holds `cwd` (the folder itself counts), so nested worktrees
/// keep their own ports. Returned as the caller wrote it.
pub fn deepest_worktree<'a>(cwd: &str, worktrees: &'a [String]) -> Option<&'a String> {
    let c = norm(cwd);
    worktrees
        .iter()
        .filter(|w| {
            let w = norm(w);
            !w.is_empty() && (c == w || c.starts_with(&format!("{w}/")))
        })
        .max_by_key(|w| norm(w).len())
}

/// How many bytes of another program's working-folder string may be read: the length that program
/// reported is trusted only when it is UTF-16 sized (even), not empty and at most 32 KiB. An odd
/// length would otherwise write one byte past a buffer of `len / 2` characters.
pub fn string_bytes(len: usize) -> Option<usize> {
    if len == 0 || len > 32768 {
        return None;
    }
    if !len.is_multiple_of(2) { return None; } // G:size
    Some(len)
}

/// Folder segments below the drive or root: `C:\work\app` and `/home/me/app` have three.
fn segments(path: &str) -> usize {
    norm(path).split('/').filter(|s| !s.is_empty() && !s.ends_with(':')).count()
}

/// At least two folders below the drive or root, so a drive root (`C:\`, `/`) or a top-level
/// folder (`C:\work`, `/srv`) never stands in for a workspace.
pub fn deep_enough(path: &str) -> bool {
    segments(path) >= 2
}

/// Whether `path` is the user's home folder or a folder above it (`C:\Users`, `/home`, the drive).
/// Those can never license a stop, however deep they are and whatever `.git` entry they hold.
pub fn is_home_or_above(path: &str, home: &str) -> bool {
    let (p, h) = (norm(path), norm(home));
    if h.is_empty() {
        return false;
    }
    p.is_empty() || p == h || h.starts_with(&format!("{p}/"))
}

/// The workspace folders a stop may act in: real folders with a `.git` entry (a worktree or a
/// checkout), at least two levels deep, and never the home folder or a folder above it. Depth alone
/// keeps out only drive roots and top-level folders: `C:\Users\<name>` and `/home/<name>` are two
/// levels deep and may well hold a `.git`, so the home rule is its own check.
pub fn valid_worktrees(worktrees: &[String], home: Option<&str>) -> Vec<String> {
    valid_worktrees_by(worktrees, home, &|w| {
        let p = std::path::Path::new(w);
        p.join(".git").exists() && p.is_dir()
    })
}

/// `valid_worktrees` with the on-disk check (the folder is real and holds a `.git` entry) supplied by
/// the caller, so the depth and home rules can be proven on paths a test must never create, such as
/// a drive root or a top-level folder.
pub fn valid_worktrees_by(worktrees: &[String], home: Option<&str>, is_repo_dir: &dyn Fn(&str) -> bool) -> Vec<String> {
    let mut out = Vec::new();
    for w in worktrees {
        if !deep_enough(w) { continue; } // G:depth
        if home.is_some_and(|h| is_home_or_above(w, h)) { continue; } // G:home
        if !is_repo_dir(w) { continue; } // G:git
        out.push(w.clone());
    }
    out
}

/// The requested folders the project store knows (a project's root or one of its worktrees), so
/// the window's list can never widen what a stop may touch.
pub fn licensed(requested: &[String], known: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for r in requested {
        if !known.iter().any(|k| norm(k) == norm(r)) { continue; } // G:store
        out.push(r.clone());
    }
    out
}

/// Whether the program seen at scan time is still the one on that process number: both start times
/// are known and equal. A program that cannot be opened now is never assumed to be the same one.
pub fn same_program(seen: Option<u64>, now: Option<u64>) -> bool {
    matches!((seen, now), (Some(a), Some(b)) if a == b)
}

/// Whether a program is part of Kolux itself with no pane in between (a WebView2 helper, an
/// updater): under Kolux's process, and neither a pane's shell nor started under one.
pub fn own_helper(l: &Listener, own_pid: u32, pane_pids: &[u32]) -> bool {
    let under_app = l.ancestors.contains(&own_pid);
    let under_pane = pane_pids.contains(&l.pid) || l.ancestors.iter().any(|a| pane_pids.contains(a));
    under_app && !under_pane
}

/// Every listener as a row: one row per program and port (IPv4 and IPv6 twins fold into one),
/// ordered by port, tied to its workspace folder when it has one.
pub fn classify(listeners: &[Listener], worktrees: &[String]) -> Vec<PortRow> {
    let mut rows: Vec<PortRow> = Vec::new();
    for l in listeners {
        if rows.iter().any(|r| r.port == l.port && r.pid == l.pid) {
            continue;
        }
        let worktree = l.cwd.as_deref().and_then(|c| deepest_worktree(c, worktrees)).cloned();
        rows.push(PortRow { port: l.port, address: l.address.clone(), pid: l.pid, name: l.name.clone(), external: worktree.is_none(), worktree });
    }
    rows.sort_by_key(|r| (r.port, r.pid));
    rows
}

/// Stops the program the user saw on `port`, but only inside a licensed workspace folder. Every
/// program on the port is checked before any is touched, so one outside program, a system or
/// Kolux process, or a program the user did not see refuses the whole stop.
pub fn stop_in(listeners: &[Listener], licensed: &[String], req: StopRequest, g: &Guards, kill: &mut dyn FnMut(u32)) -> Result<Stop, String> {
    let here: Vec<&Listener> = listeners.iter().filter(|l| l.port == req.port).collect();
    if here.is_empty() {
        return Ok(Stop::Gone);
    }
    let name = |l: &Listener| if l.name.is_empty() { "a program".to_string() } else { l.name.clone() };
    let outside = |l: &Listener| format!("Port {} is held by {} outside your workspaces. Kolux will not stop it from here", req.port, name(l));
    let mut pids: Vec<u32> = Vec::new();
    for l in &here {
        let inside = l.cwd.as_deref().and_then(|c| deepest_worktree(c, licensed)).is_some();
        if !inside { return Err(outside(l)); } // G:inside
        if l.pid <= 4 { return Err(outside(l)); } // G:system
        if l.pid == g.own_pid { return Err(format!("Port {} is held by Kolux itself", req.port)); } // G:self
        if own_helper(l, g.own_pid, g.pane_pids) { return Err(format!("Port {} is held by a part of Kolux itself ({}) that no pane started", req.port, name(l))); } // G:helper
        if !pids.contains(&l.pid) {
            pids.push(l.pid);
        }
    }
    let names: Vec<String> = here.iter().map(|l| format!("{} ({})", name(l), l.pid)).collect();
    if pids != [req.pid] { return Err(format!("Port {} is now held by {}, not the program that was shown. The list was refreshed; look again before stopping it", req.port, names.join(", "))); } // G:pid
    for l in &here {
        if !same_program(l.started, (g.started_now)(l.pid)) { return Err(format!("Port {}: {} has ended and its process number now belongs to another program; nothing was stopped", req.port, name(l))); } // G:started
    }
    for p in &pids {
        kill(*p);
    }
    Ok(Stop::Stopped(pids))
}

/// The whole stop: the window's list is cut to real worktrees outside the home folder, then to what
/// the project store knows, and the program on the port is checked against the request.
pub fn stop_request(listeners: &[Listener], worktrees: &[String], known: &[String], home: Option<&str>, req: StopRequest, g: &Guards, kill: &mut dyn FnMut(u32)) -> Result<Stop, String> {
    let lic = licensed(&valid_worktrees(worktrees, home), known);
    stop_in(listeners, &lic, req, g, kill)
}

/// `lsof -F pcn` output (one `p`, `c` and then `n` lines per socket) as (pid, command, address, port).
#[cfg_attr(windows, allow(dead_code))]
pub fn parse_lsof(out: &str) -> Vec<(u32, String, String, u16)> {
    let (mut pid, mut cmd, mut v) = (0u32, String::new(), Vec::new());
    for line in out.lines() {
        let (tag, rest) = line.split_at(line.len().min(1));
        match tag {
            "p" => pid = rest.parse().unwrap_or(0),
            "c" => cmd = rest.to_string(),
            "n" => {
                if let Some((a, p)) = rest.rsplit_once(':') {
                    if let (Ok(p), true) = (p.parse::<u16>(), pid != 0) {
                        v.push((pid, cmd.clone(), a.trim_matches(['[', ']']).to_string(), p));
                    }
                }
            }
            _ => {}
        }
    }
    v
}

#[cfg(windows)]
mod imp {
    use super::Listener;
    use std::collections::HashMap;
    use std::ffi::c_void;
    use windows_sys::Wdk::System::Threading::{NtQueryInformationProcess, ProcessBasicInformation};
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows_sys::Win32::System::Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ};

    // Declared here because the crate's windows-sys features do not carry these two calls.
    #[link(name = "iphlpapi")]
    extern "system" {
        fn GetExtendedTcpTable(table: *mut c_void, size: *mut u32, order: i32, family: u32, class: i32, reserved: u32) -> u32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn ReadProcessMemory(process: *mut c_void, base: *const c_void, buf: *mut c_void, size: usize, read: *mut usize) -> i32;
    }

    const AF_INET: u32 = 2;
    const AF_INET6: u32 = 23;
    const TCP_TABLE_OWNER_PID_LISTENER: i32 = 3;
    const INSUFFICIENT_BUFFER: u32 = 122;

    /// (port, address, pid) of every listening socket, IPv4 then IPv6.
    fn sockets() -> Result<Vec<(u16, String, u32)>, String> {
        let mut out = Vec::new();
        for family in [AF_INET, AF_INET6] {
            let mut buf: Vec<u32> = vec![0; 64];
            let mut size = (buf.len() * 4) as u32;
            let mut status = INSUFFICIENT_BUFFER;
            for _ in 0..6 {
                // SAFETY: `buf` is `size` bytes long and u32-aligned; the call writes at most `size`
                // bytes and, when too small, reports the size it needs, which the next round allocates.
                status = unsafe { GetExtendedTcpTable(buf.as_mut_ptr().cast(), &mut size, 0, family, TCP_TABLE_OWNER_PID_LISTENER, 0) };
                if status != INSUFFICIENT_BUFFER {
                    break;
                }
                buf = vec![0; (size as usize).div_ceil(4) + 16];
                size = (buf.len() * 4) as u32;
            }
            if status != 0 {
                return Err(format!("The system's port table could not be read (error {status})"));
            }
            let n = buf[0] as usize;
            let words = if family == AF_INET { 6 } else { 14 };
            for i in 0..n {
                let Some(r) = buf.get(1 + i * words..1 + (i + 1) * words) else { break };
                // IPv4 row: state, local addr, local port, remote addr, remote port, pid.
                // IPv6 row: local addr (4 words), scope, local port, remote addr (4 words), scope, remote port, state, pid.
                let (port, address) = if family == AF_INET {
                    let a = r[1].to_le_bytes();
                    (r[2], format!("{}.{}.{}.{}", a[0], a[1], a[2], a[3]))
                } else {
                    let b: Vec<u8> = r[0..4].iter().flat_map(|w| w.to_le_bytes()).collect();
                    let g: Vec<String> = b.chunks(2).map(|c| format!("{:x}", u16::from_be_bytes([c[0], c[1]]))).collect();
                    (r[5], if b.iter().all(|x| *x == 0) { "::".to_string() } else if b[..15].iter().all(|x| *x == 0) && b[15] == 1 { "::1".to_string() } else { g.join(":") })
                };
                let pid = r[words - 1];
                out.push((u16::from_be((port & 0xffff) as u16), address, pid));
            }
        }
        Ok(out)
    }

    /// Name and parent of every process, from one snapshot.
    fn table() -> HashMap<u32, (String, u32)> {
        let mut m = HashMap::new();
        // SAFETY: the snapshot handle is checked before use and closed once; the entry is zeroed with
        // its size set, as Process32FirstW/NextW require, and only read after a success.
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE {
                return m;
            }
            let mut e: PROCESSENTRY32W = std::mem::zeroed();
            e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut ok = Process32FirstW(snap, &mut e) != 0;
            while ok {
                let len = e.szExeFile.iter().position(|c| *c == 0).unwrap_or(e.szExeFile.len());
                m.insert(e.th32ProcessID, (String::from_utf16_lossy(&e.szExeFile[..len]), e.th32ParentProcessID));
                ok = Process32NextW(snap, &mut e) != 0;
            }
            CloseHandle(snap);
        }
        m
    }

    /// When the process started, in the system's 100 ns ticks; `None` when it cannot be opened.
    pub fn started(pid: u32) -> Option<u64> {
        // SAFETY: the handle is checked and closed once; the four FILETIME out-values are plain
        // zeroed structs of the size the call writes, read only after it reports success.
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return None;
            }
            let mut t = [FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 }; 4];
            let ok = GetProcessTimes(h, &mut t[0], &mut t[1], &mut t[2], &mut t[3]) != 0;
            CloseHandle(h);
            ok.then(|| (u64::from(t[0].dwHighDateTime) << 32) | u64::from(t[0].dwLowDateTime))
        }
    }

    /// The parent chain, nearest first. Windows keeps a dead parent's number on its orphans, and
    /// that number may be reused, so a parent is accepted only when it started before its child;
    /// the walk also stops at a number the snapshot does not hold, a cycle, or 64 steps.
    fn ancestors(pid: u32, table: &HashMap<u32, (String, u32)>) -> Vec<u32> {
        let mut out = Vec::new();
        let mut at = pid;
        let mut at_started = started(pid);
        while let Some((_, parent)) = table.get(&at) {
            if *parent == 0 || *parent == at || out.contains(parent) || out.len() >= 64 {
                break;
            }
            let parent_started = started(*parent);
            if let (Some(p), Some(c)) = (parent_started, at_started) {
                if p > c {
                    break;
                }
            }
            out.push(*parent);
            at = *parent;
            at_started = parent_started;
        }
        out
    }

    #[repr(C)]
    #[derive(Default)]
    struct BasicInfo {
        exit: i32,
        peb: usize,
        affinity: usize,
        priority: i32,
        pid: usize,
        parent: usize,
    }

    /// A process's working folder, read from its own parameter block; `None` when this user may not.
    // ponytail: the offsets are the 64-bit layout only (the crate refuses other widths above). A 64-bit
    // Kolux reading a 32-bit program sees that program's 64-bit block; whether that block follows the
    // program's later folder changes is unverified (review AFTER 9). A program that hides its block
    // reads as external.
    pub fn cwd(pid: u32) -> Option<String> {
        // SAFETY: the handle is checked and closed once; every read goes through ReadProcessMemory into
        // a buffer of exactly the stated size and is used only when the whole size was read. The two
        // fixed reads fill an 8-byte and a 16-byte local. The string read uses a length the TARGET
        // reported, which is trusted only after `string_bytes` has checked it is even, non-zero and at
        // most 32 KiB, so the `bytes / 2` u16 buffer is exactly `bytes` bytes long; an odd or oversized
        // length from a corrupted or hostile block reads nothing.
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
            if h.is_null() {
                return None;
            }
            let read = |at: usize, buf: *mut c_void, len: usize| -> bool {
                let mut got = 0usize;
                ReadProcessMemory(h, at as *const c_void, buf, len, &mut got) != 0 && got == len
            };
            let mut info = BasicInfo::default();
            let mut ret = 0u32;
            let status = NtQueryInformationProcess(h, ProcessBasicInformation, (&mut info as *mut BasicInfo).cast(), std::mem::size_of::<BasicInfo>() as u32, &mut ret);
            let mut result = None;
            if status >= 0 && info.peb != 0 {
                let mut params = 0usize;
                // PEB + 0x20 = ProcessParameters; its CurrentDirectory (a UNICODE_STRING) sits at + 0x38.
                if read(info.peb + 0x20, (&mut params as *mut usize).cast(), 8) && params != 0 {
                    let mut us = [0u8; 16];
                    if read(params + 0x38, us.as_mut_ptr().cast(), 16) {
                        let len = u16::from_le_bytes([us[0], us[1]]) as usize;
                        let ptr = usize::from_le_bytes(us[8..16].try_into().unwrap());
                        if let (Some(bytes), true) = (super::string_bytes(len), ptr != 0) {
                            let mut text = vec![0u16; bytes / 2];
                            if read(ptr, text.as_mut_ptr().cast(), bytes) {
                                result = Some(String::from_utf16_lossy(&text));
                            }
                        }
                    }
                }
            }
            CloseHandle(h);
            result
        }
    }

    /// What is looked up once per process number: working folder, start time, parent chain.
    type Facts = (Option<String>, Option<u64>, Vec<u32>);

    pub fn listeners() -> Result<Vec<Listener>, String> {
        let table = table();
        let mut facts: HashMap<u32, Facts> = HashMap::new();
        Ok(sockets()?
            .into_iter()
            .map(|(port, address, pid)| {
                // System numbers (0, 4: the kernel and http.sys) cannot be opened: they list as external.
                let (cwd, started, ancestors) = facts.entry(pid).or_insert_with(|| if pid <= 4 { (None, None, Vec::new()) } else { (cwd(pid), started(pid), ancestors(pid, &table)) }).clone();
                Listener { port, address, pid, name: table.get(&pid).map(|t| t.0.clone()).unwrap_or_default(), cwd, started, ancestors }
            })
            .collect())
    }
}

#[cfg(not(windows))]
mod imp {
    use super::Listener;

    fn cwd(pid: u32) -> Option<String> {
        if let Ok(p) = std::fs::read_link(format!("/proc/{pid}/cwd")) {
            return Some(p.to_string_lossy().into_owned());
        }
        let out = std::process::Command::new("lsof").args(["-a", "-d", "cwd", "-p", &pid.to_string(), "-Fn"]).output().ok()?;
        String::from_utf8_lossy(&out.stdout).lines().find_map(|l| l.strip_prefix('n').map(str::to_string))
    }

    /// The fields of `/proc/<pid>/stat` after the command name: state, parent, ..., start time (index 19).
    fn stat_fields(pid: u32) -> Option<Vec<String>> {
        let text = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        let (_, rest) = text.rsplit_once(')')?;
        Some(rest.split_whitespace().map(str::to_string).collect())
    }

    fn ps(pid: u32, field: &str) -> Option<String> {
        let out = std::process::Command::new("ps").args(["-o", &format!("{field}="), "-p", &pid.to_string()]).output().ok()?;
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (!s.is_empty()).then_some(s)
    }

    fn ppid(pid: u32) -> Option<u32> {
        stat_fields(pid).and_then(|f| f.get(1)?.parse().ok()).or_else(|| ps(pid, "ppid")?.parse().ok())
    }

    /// When the process started: the kernel's start tick on Linux, elsewhere the `ps` start text
    /// hashed, since only equality is ever asked of it.
    pub fn started(pid: u32) -> Option<u64> {
        if let Some(t) = stat_fields(pid).and_then(|f| f.get(19)?.parse::<u64>().ok()) {
            return Some(t);
        }
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        ps(pid, "lstart")?.hash(&mut h);
        Some(h.finish())
    }

    fn ancestors(pid: u32) -> Vec<u32> {
        let mut out = Vec::new();
        let mut at = pid;
        while let Some(p) = ppid(at) {
            if p <= 1 || p == at || out.contains(&p) || out.len() >= 64 {
                break;
            }
            out.push(p);
            at = p;
        }
        out
    }

    pub fn listeners() -> Result<Vec<Listener>, String> {
        let out = std::process::Command::new("lsof").args(["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"]).output().map_err(|e| format!("The system's port list could not be read ({e})"))?;
        let mut facts: std::collections::HashMap<u32, (Option<String>, Option<u64>, Vec<u32>)> = std::collections::HashMap::new();
        Ok(super::parse_lsof(&String::from_utf8_lossy(&out.stdout))
            .into_iter()
            .map(|(pid, name, address, port)| {
                let (cwd, started, ancestors) = facts.entry(pid).or_insert_with(|| (cwd(pid), started(pid), ancestors(pid))).clone();
                Listener { port, address, pid, name, cwd, started, ancestors }
            })
            .collect())
    }
}

/// Every listening socket on the machine with its program and working folder.
pub fn listeners() -> Result<Vec<Listener>, String> {
    imp::listeners()
}

fn home() -> Option<String> {
    crate::pty::home_dir().map(|p| p.to_string_lossy().into_owned())
}

/// Every folder the project store knows: each project's root and the worktrees git lists for it.
/// The store lock is taken only to read the project list, never across a git call.
fn known_workspaces(git: &crate::git::Git, store: &std::sync::Mutex<crate::state::Store>) -> Result<Vec<String>, String> {
    let projects = crate::projects::load_projects(&*store.lock().map_err(|e| e.to_string())?);
    Ok(projects
        .iter()
        .flat_map(|p| std::iter::once(p.path.clone()).chain(git.worktrees(std::path::Path::new(&p.path)).unwrap_or_default().into_iter().map(|w| w.path)))
        .collect())
}

/// The status bar's scan: the listeners as rows, workspace ones tied to their folder. Only folders
/// that could license a stop count as workspaces, so a row never shows a Stop the backend refuses.
#[tauri::command]
pub async fn ports_scan(worktrees: Vec<String>) -> Result<Vec<PortRow>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ok = valid_worktrees(&worktrees, home().as_deref());
        listeners().map(|l| classify(&l, &ok))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stops the program the status bar showed on `port`. Returns "stopped" or "gone" (it had already
/// exited). The folders the window sent are cut to real worktrees the project store knows; the
/// program must be the one shown, inside such a folder, not a system process, not Kolux or one of
/// its own helpers, and still the same program (same start time) just before the kill.
#[tauri::command(async)]
pub fn ports_stop(git: tauri::State<'_, crate::git::Git>, store: tauri::State<'_, std::sync::Mutex<crate::state::Store>>, terminals: tauri::State<'_, crate::terminal::Terminals>, worktrees: Vec<String>, port: u16, pid: u32) -> Result<String, String> {
    let known = known_workspaces(&git, &store)?;
    let pane_pids: Vec<u32> = terminals.list().into_iter().filter_map(|(_, pid, _)| pid).collect();
    let now = listeners()?;
    let home = home();
    let g = Guards { own_pid: std::process::id(), pane_pids: &pane_pids, started_now: &imp::started };
    let mut killed = Vec::new();
    // The start-time check runs inside `stop_in` right before this closure, so the gap between the
    // check and the kill is the microseconds of one process spawn, not the scan-to-click window.
    // `taskkill /T` (and the Unix kill_tree) ends the program's descendants as well, its workers and
    // child servers, without a folder check of their own: that is what stopping a dev server means.
    let done = stop_request(&now, &worktrees, &known, home.as_deref(), StopRequest { port, pid }, &g, &mut |p| {
        crate::procs::kill_tree(p);
        killed.push(p);
    })?;
    match done {
        Stop::Gone => Ok("gone".to_string()),
        Stop::Stopped(pids) => {
            let left = crate::procs::wait_gone(&pids, std::time::Duration::from_secs(3));
            if left.is_empty() {
                Ok("stopped".to_string())
            } else {
                Err(format!("Port {port} is still held; the program did not end"))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;
    use std::process::{Command, Stdio};

    const SEEN: u64 = 7;

    fn w(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    fn l(port: u16, pid: u32, cwd: Option<&str>) -> Listener {
        Listener { port, address: "127.0.0.1".into(), pid, name: format!("prog{pid}.exe"), cwd: cwd.map(str::to_string), started: Some(SEEN), ancestors: Vec::new() }
    }

    fn same(_: u32) -> Option<u64> {
        Some(SEEN)
    }

    /// Kolux is pid 99 with one pane shell, pid 50; every program started as before.
    fn guards() -> Guards<'static> {
        Guards { own_pid: 99, pane_pids: &[50], started_now: &same }
    }

    fn req(port: u16, pid: u32) -> StopRequest {
        StopRequest { port, pid }
    }

    /// A worktree folder deep enough to license a stop, with its `.git` entry.
    fn tree(tmp: &std::path::Path) -> String {
        let t = tmp.join("proj").join("wt");
        std::fs::create_dir_all(t.join(".git")).unwrap();
        t.to_string_lossy().into_owned()
    }

    #[test]
    fn view_078_a_port_belongs_to_the_deepest_worktree_holding_its_folder() {
        let trees = w(&["C:/work/app", "C:/work/app/.worktrees/feature", "C:/work/other"]);
        assert_eq!(deepest_worktree("C:/work/app/.worktrees/feature/web", &trees).map(String::as_str), Some("C:/work/app/.worktrees/feature"));
        assert_eq!(deepest_worktree("C:/work/app/web", &trees).map(String::as_str), Some("C:/work/app"));
        assert_eq!(deepest_worktree("C:/work/app", &trees).map(String::as_str), Some("C:/work/app"), "the folder itself counts");
        // a sibling that only shares a name prefix is not inside
        assert_eq!(deepest_worktree("C:/work/app2/web", &trees), None);
        assert_eq!(deepest_worktree("C:/elsewhere", &trees), None);
    }

    #[test]
    fn view_078_slashes_trailing_separators_and_the_extended_prefix_do_not_hide_a_match() {
        let trees = w(&["C:\\work\\app\\"]);
        assert!(deepest_worktree("C:\\work\\app\\web\\", &trees).is_some());
        assert!(deepest_worktree("\\\\?\\C:\\work\\app\\web", &trees).is_some());
        assert!(deepest_worktree("C:/work/app/web", &trees).is_some());
        #[cfg(windows)]
        assert!(deepest_worktree("c:\\WORK\\App\\x", &trees).is_some(), "Windows folders ignore case");
        assert_eq!(deepest_worktree("C:\\work\\apple", &trees), None);
    }

    #[test]
    fn view_078_rows_tie_ports_to_workspaces_fold_twins_and_mark_the_rest_external() {
        let trees = w(&["C:/work/app", "C:/work/app/nested"]);
        let ls = vec![
            l(5173, 10, Some("C:/work/app/web")),
            Listener { address: "::1".into(), ..l(5173, 10, Some("C:/work/app/web")) },
            l(3000, 11, Some("C:/work/app/nested/api")),
            l(8080, 12, Some("D:/other/project")),
            l(9000, 13, None),
            l(80, 4, None),
        ];
        let rows = classify(&ls, &trees);
        assert_eq!(rows.iter().map(|r| r.port).collect::<Vec<_>>(), vec![80, 3000, 5173, 8080, 9000], "one row per program and port, by port");
        assert!(rows[0].external, "a system listener (pid 4) is shown as external, not hidden");
        assert_eq!(rows[1].worktree.as_deref(), Some("C:/work/app/nested"));
        assert_eq!(rows[2].worktree.as_deref(), Some("C:/work/app"));
        assert!(!rows[1].external && !rows[2].external);
        assert!(rows[3].external && rows[3].worktree.is_none(), "a program elsewhere is external");
        assert!(rows[4].external, "a folder that cannot be read is external, never guessed");
    }

    #[test]
    fn view_078_fix1_a_working_folder_length_is_trusted_only_when_it_is_utf16_sized() {
        assert_eq!(string_bytes(0), None, "empty");
        assert_eq!(string_bytes(1), None, "odd: one byte past a buffer of len / 2 characters");
        assert_eq!(string_bytes(2), Some(2));
        assert_eq!(string_bytes(33), None, "odd");
        assert_eq!(string_bytes(32768), Some(32768), "the cap itself is allowed");
        assert_eq!(string_bytes(32769), None);
        assert_eq!(string_bytes(32770), None, "even but over the cap");
    }

    #[test]
    fn view_078_fix1_the_depth_rule_keeps_out_drive_roots_and_top_level_folders() {
        for shallow in ["C:\\", "C:", "/", "", "C:\\work", "C:/work/", "/srv", "\\\\?\\C:\\work"] {
            assert!(!deep_enough(shallow), "{shallow:?} is not deep enough");
        }
        for deep in ["C:\\work\\app", "C:/work/app/", "/home/me", "/srv/a/b", "\\\\?\\C:\\work\\app"] {
            assert!(deep_enough(deep), "{deep:?} is deep enough");
        }
        // through the licence check, with the disk check standing in (a test must not plant a .git in a
        // drive root): a root or top-level folder is refused even when it does hold a .git entry
        let any_repo = |_: &str| true;
        assert_eq!(valid_worktrees_by(&w(&["C:\\", "/", "C:\\work", "/srv", "C:\\work\\app", "/srv/a/b"]), None, &any_repo), w(&["C:\\work\\app", "/srv/a/b"]));
        assert_eq!(valid_worktrees_by(&w(&["C:\\work\\app"]), None, &|_| false), Vec::<String>::new(), "no .git entry, however deep");
    }

    #[test]
    fn view_078_fix1_the_home_folder_and_every_folder_above_it_never_license_a_stop() {
        let home = "C:\\Users\\me";
        for above in ["C:\\Users\\me", "C:/Users/me/", "C:\\Users", "C:\\", "C:", "/"] {
            assert!(is_home_or_above(above, home), "{above:?} is home or above it");
        }
        #[cfg(windows)]
        assert!(is_home_or_above("c:/users/ME/", home), "Windows folders ignore case");
        for below in ["C:\\Users\\me\\proj", "C:\\Users\\meow", "C:\\Users\\m", "D:\\work\\app"] {
            assert!(!is_home_or_above(below, home), "{below:?} is not home or above it");
        }
        assert!(!is_home_or_above("C:\\Users", ""), "no home known: the rule stands aside, the others still apply");
        // on disk: a home folder with its own .git entry, two levels deep, is still refused, as is its parent
        let tmp = crate::test_dir::temp("ports-home");
        let home_dir = tmp.join("home");
        let proj = home_dir.join("proj");
        std::fs::create_dir_all(home_dir.join(".git")).unwrap();
        std::fs::create_dir_all(proj.join(".git")).unwrap();
        std::fs::create_dir_all(tmp.join(".git")).unwrap();
        let s = |p: &std::path::Path| p.to_string_lossy().into_owned();
        let list = [s(&home_dir), s(&tmp), s(&proj)];
        assert_eq!(valid_worktrees(&list, Some(&s(&home_dir))), vec![s(&proj)]);
        // and through the whole stop: a program started in the home folder is refused even though home holds a .git
        let mut killed = Vec::new();
        let r = stop_request(&[l(1, 10, Some(&s(&home_dir)))], &list, &list, Some(&s(&home_dir)), req(1, 10), &guards(), &mut |p| killed.push(p));
        assert!(r.unwrap_err().contains("outside your workspaces"));
        assert!(killed.is_empty());
    }

    #[test]
    fn view_078_fix1_a_stop_is_licensed_only_by_workspaces_the_project_store_knows() {
        assert_eq!(licensed(&w(&["C:\\work\\app", "C:\\work\\other"]), &w(&["c:/work/app/"])), w(&["C:\\work\\app"]), "the store's spelling may differ");
        assert_eq!(licensed(&w(&["C:\\work\\app"]), &w(&[])), Vec::<String>::new(), "an empty store licenses nothing");
        let tmp = crate::test_dir::temp("ports-store");
        let a = tree(&tmp);
        let b = tmp.join("proj").join("other");
        std::fs::create_dir_all(b.join(".git")).unwrap();
        let b = b.to_string_lossy().into_owned();
        let request = [a.clone(), b.clone()];
        let mut killed = Vec::new();
        // the window asks with both folders, but the store knows only `a`: a program in `b` is refused
        let r = stop_request(&[l(1, 10, Some(&b))], &request, std::slice::from_ref(&a), None, req(1, 10), &guards(), &mut |p| killed.push(p));
        assert!(r.unwrap_err().contains("outside your workspaces"));
        assert!(killed.is_empty());
        // once the store knows `b` too, the same program is stopped
        assert_eq!(stop_request(&[l(1, 10, Some(&b))], &request, &request, None, req(1, 10), &guards(), &mut |p| killed.push(p)), Ok(Stop::Stopped(vec![10])));
        assert_eq!(killed, vec![10]);
    }

    #[test]
    fn view_078_stopping_a_port_that_already_exited_counts_as_success() {
        let mut killed = Vec::new();
        let r = stop_in(&[l(1, 10, None)], &w(&[]), req(5173, 10), &guards(), &mut |p| killed.push(p));
        assert_eq!(r, Ok(Stop::Gone));
        assert!(killed.is_empty());
    }

    #[test]
    fn view_078_a_port_held_outside_the_workspaces_is_never_stopped() {
        let tmp = crate::test_dir::temp("ports-refuse");
        let tree_s = tree(&tmp);
        let outside = tmp.join("else").to_string_lossy().into_owned();
        let lic = std::slice::from_ref(&tree_s);
        let mut killed: Vec<u32> = Vec::new();
        // outside the worktree
        let r = stop_in(&[l(5173, 10, Some(&outside))], lic, req(5173, 10), &guards(), &mut |p| killed.push(p));
        assert!(r.unwrap_err().contains("outside your workspaces"));
        // a folder that cannot be read
        assert!(stop_in(&[l(5173, 10, None)], lic, req(5173, 10), &guards(), &mut |p| killed.push(p)).is_err());
        // one program inside and one outside on the same port: nothing is stopped
        let mixed = [l(5173, 10, Some(&tree_s)), l(5173, 11, Some(&outside))];
        assert!(stop_in(&mixed, lic, req(5173, 10), &guards(), &mut |p| killed.push(p)).is_err());
        // a system pid, with the folder somehow readable
        assert!(stop_in(&[l(5173, 4, Some(&tree_s))], lic, req(5173, 4), &guards(), &mut |p| killed.push(p)).is_err());
        assert!(killed.is_empty(), "nothing was touched: {killed:?}");
        // the same program inside the worktree is stopped
        let ok = stop_in(&[l(5173, 10, Some(&tree_s.replace('\\', "/")))], lic, req(5173, 10), &guards(), &mut |p| killed.push(p));
        assert_eq!(ok, Ok(Stop::Stopped(vec![10])));
        assert_eq!(killed, vec![10]);
    }

    #[test]
    fn view_078_fix1_kolux_itself_and_its_helpers_no_pane_started_are_never_stopped() {
        let tmp = crate::test_dir::temp("ports-self");
        let tree_s = tree(&tmp);
        let lic = std::slice::from_ref(&tree_s);
        let mut killed: Vec<u32> = Vec::new();
        // Kolux's own process
        let r = stop_in(&[l(5173, 99, Some(&tree_s))], lic, req(5173, 99), &guards(), &mut |p| killed.push(p));
        assert!(r.unwrap_err().contains("Kolux itself"));
        // a helper under Kolux with no pane in between (the WebView2 browser process on its debugging port)
        let helper = Listener { ancestors: vec![98, 99], ..l(9258, 97, Some(&tree_s)) };
        assert!(own_helper(&helper, 99, &[50]));
        let e = stop_in(&[helper], lic, req(9258, 97), &guards(), &mut |p| killed.push(p)).unwrap_err();
        assert!(e.contains("no pane started"), "{e}");
        assert!(killed.is_empty(), "nothing was touched: {killed:?}");
        // a program under a pane's shell, which is itself under Kolux, is the user's own
        let under_pane = Listener { ancestors: vec![50, 99], ..l(5173, 10, Some(&tree_s)) };
        assert!(!own_helper(&under_pane, 99, &[50]));
        assert_eq!(stop_in(&[under_pane], lic, req(5173, 10), &guards(), &mut |p| killed.push(p)), Ok(Stop::Stopped(vec![10])));
        // the pane's shell itself, and a program with no Kolux in its chain
        assert!(!own_helper(&Listener { ancestors: vec![99], ..l(1, 50, None) }, 99, &[50]));
        assert!(!own_helper(&Listener { ancestors: vec![1, 2, 3], ..l(1, 10, None) }, 99, &[50]));
        assert_eq!(killed, vec![10]);
    }

    #[test]
    fn view_078_fix1_a_stop_ends_only_the_program_the_user_saw_and_never_a_reused_process_number() {
        let tmp = crate::test_dir::temp("ports-pid");
        let tree_s = tree(&tmp);
        let lic = std::slice::from_ref(&tree_s);
        let mut killed: Vec<u32> = Vec::new();
        // the user clicked the row for program 10, but program 11 holds the port by now
        let e = stop_in(&[l(5173, 11, Some(&tree_s))], lic, req(5173, 10), &guards(), &mut |p| killed.push(p)).unwrap_err();
        assert!(e.contains("not the program that was shown"), "{e}");
        // two of the user's programs share the port: the request names one, so nothing is stopped
        let two = [l(5173, 10, Some(&tree_s)), l(5173, 11, Some(&tree_s))];
        assert!(stop_in(&two, lic, req(5173, 10), &guards(), &mut |p| killed.push(p)).is_err());
        // the process number was reused by a program with another start time, or one that cannot be opened now
        assert!(!same_program(Some(1), Some(2)));
        assert!(!same_program(Some(1), None));
        assert!(!same_program(None, Some(1)));
        assert!(!same_program(None, None), "two unknowns are never the same program");
        assert!(same_program(Some(1), Some(1)));
        let later = Guards { started_now: &|_| Some(SEEN + 1), ..guards() };
        let e = stop_in(&[l(5173, 10, Some(&tree_s))], lic, req(5173, 10), &later, &mut |p| killed.push(p)).unwrap_err();
        assert!(e.contains("now belongs to another program"), "{e}");
        let unknown = Guards { started_now: &|_| None, ..guards() };
        assert!(stop_in(&[l(5173, 10, Some(&tree_s))], lic, req(5173, 10), &unknown, &mut |p| killed.push(p)).is_err());
        let unseen = Listener { started: None, ..l(5173, 10, Some(&tree_s)) };
        assert!(stop_in(&[unseen], lic, req(5173, 10), &guards(), &mut |p| killed.push(p)).is_err(), "a program whose start was not readable at scan is not stopped");
        assert!(killed.is_empty(), "nothing was touched: {killed:?}");
        // the same program, IPv4 and IPv6 twins, is stopped once
        let twins = [l(5173, 10, Some(&tree_s)), Listener { address: "::1".into(), ..l(5173, 10, Some(&tree_s)) }];
        assert_eq!(stop_in(&twins, lic, req(5173, 10), &guards(), &mut |p| killed.push(p)), Ok(Stop::Stopped(vec![10])));
        assert_eq!(killed, vec![10]);
    }

    #[test]
    fn view_078_a_folder_that_is_not_a_worktree_or_is_a_root_cannot_license_a_stop() {
        let tmp = crate::test_dir::temp("ports-valid");
        let plain = tmp.join("plain");
        std::fs::create_dir_all(&plain).unwrap();
        let real = tmp.join("repo");
        std::fs::create_dir_all(real.join(".git")).unwrap();
        let as_string = |p: &std::path::Path| p.to_string_lossy().into_owned();
        assert_eq!(valid_worktrees(&[as_string(&plain), as_string(&real), "C:\\".into(), "/".into(), as_string(&tmp.join("missing"))], None), vec![as_string(&real)]);
        let mut killed = Vec::new();
        for root in ["C:\\", "/", ""] {
            let r = stop_request(&[l(1, 10, Some("C:\\anything"))], &[root.to_string()], &[root.to_string()], None, req(1, 10), &guards(), &mut |p| killed.push(p));
            assert!(r.is_err(), "{root:?} must not license a stop");
        }
        let p = as_string(&plain);
        assert!(stop_request(&[l(1, 10, Some(&p))], std::slice::from_ref(&p), std::slice::from_ref(&p), None, req(1, 10), &guards(), &mut |k| killed.push(k)).is_err(), "no .git entry");
        assert!(killed.is_empty());
    }

    #[test]
    fn view_078_lsof_output_is_read_into_programs_and_ports() {
        let out = "p4242\ncnode\nn*:5173\nn[::1]:5173\np7\ncpython\nn127.0.0.1:8000\nnnot-a-socket\n";
        let got = parse_lsof(out);
        assert_eq!(got, vec![(4242, "node".into(), "*".into(), 5173), (4242, "node".into(), "::1".into(), 5173), (7, "python".into(), "127.0.0.1".into(), 8000)]);
    }

    #[test]
    fn view_078_a_real_listener_is_found_with_its_programs_working_folder() {
        let socket = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = socket.local_addr().unwrap().port();
        let all = listeners().expect("the system's port list is readable");
        let mine = all.iter().find(|x| x.port == port).unwrap_or_else(|| panic!("port {port} not in {} listeners", all.len()));
        assert_eq!(mine.pid, std::process::id());
        assert_eq!(mine.address, "127.0.0.1");
        let here = std::env::current_dir().unwrap().to_string_lossy().into_owned();
        assert_eq!(norm(mine.cwd.as_deref().expect("a program's own folder is readable")), norm(&here));
        assert!(mine.started.is_some(), "a program's own start time is readable");
        assert_eq!(imp::started(std::process::id()), mine.started, "the start time reads the same twice");
        drop(socket);
    }

    /// A throwaway server this test starts: node listening on a free loopback port, run in `dir`.
    fn server(dir: &std::path::Path) -> (std::process::Child, u16) {
        let mut child = Command::new("node")
            .args(["-e", "require('net').createServer().listen(0,'127.0.0.1',function(){console.log(this.address().port)});setTimeout(()=>{},60000)"])
            .current_dir(dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("node is on the PATH: this test needs it and must not pass without it");
        let mut line = String::new();
        BufReader::new(child.stdout.take().expect("stdout")).read_line(&mut line).expect("the server prints its port");
        let port = line.trim().parse().unwrap_or_else(|_| {
            let _ = child.kill();
            panic!("the server printed {line:?}, not a port")
        });
        (child, port)
    }

    /// The whole stop against the live machine. The test process stands for Kolux and, when
    /// `pane` is set, also for the pane's shell that started the server.
    fn stop_for_real(worktrees: &[String], port: u16, pid: u32, pane: bool) -> Result<Stop, String> {
        let now = listeners()?;
        let me = std::process::id();
        let panes: &[u32] = if pane { std::slice::from_ref(&me) } else { &[] };
        let g = Guards { own_pid: me, pane_pids: panes, started_now: &imp::started };
        stop_request(&now, worktrees, worktrees, None, StopRequest { port, pid }, &g, &mut |p| crate::procs::kill_tree(p))
    }

    #[test]
    fn view_078_a_server_started_in_a_worktree_is_listed_and_stopped_and_one_outside_is_refused() {
        let tmp = crate::test_dir::temp("ports-real");
        let tree = tmp.join("proj").join("wt");
        let outside = tmp.join("elsewhere");
        std::fs::create_dir_all(tree.join(".git")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let tree_s = tree.to_string_lossy().into_owned();
        let (mut inside, in_port) = server(&tree);
        let (mut apart, out_port) = server(&outside);
        let all = listeners().unwrap();
        let rows = classify(&all, std::slice::from_ref(&tree_s));
        let mine = rows.iter().find(|r| r.port == in_port).expect("the server in the worktree is listed");
        assert_eq!((mine.external, mine.pid), (false, inside.id()));
        assert_eq!(mine.worktree.as_deref(), Some(tree_s.as_str()));
        assert!(rows.iter().find(|r| r.port == out_port).expect("the other server is listed").external, "outside the worktree = external");
        let seen = all.iter().find(|x| x.port == in_port).unwrap();
        assert!(seen.ancestors.contains(&std::process::id()), "the server's parent chain reaches the process that started it: {:?}", seen.ancestors);
        // the outside one is refused and keeps running
        let refused = stop_for_real(std::slice::from_ref(&tree_s), out_port, apart.id(), true);
        assert!(refused.is_err(), "{refused:?}");
        assert!(apart.try_wait().unwrap().is_none(), "the outside server must still be running");
        // the inside one, asked for by another process number, is refused too
        let wrong = stop_for_real(std::slice::from_ref(&tree_s), in_port, inside.id() + 1, true);
        assert!(wrong.unwrap_err().contains("not the program that was shown"));
        // started under Kolux with no pane in between: a helper, refused
        let helper = stop_for_real(std::slice::from_ref(&tree_s), in_port, inside.id(), false);
        assert!(helper.unwrap_err().contains("no pane started"));
        assert!(inside.try_wait().unwrap().is_none(), "the inside server must still be running");
        // the inside one, as the pane's own program, is stopped and disappears
        assert!(matches!(stop_for_real(std::slice::from_ref(&tree_s), in_port, inside.id(), true), Ok(Stop::Stopped(_))));
        let _ = inside.wait();
        let gone = (0..40).any(|_| {
            std::thread::sleep(std::time::Duration::from_millis(50));
            !listeners().unwrap().iter().any(|x| x.port == in_port)
        });
        assert!(gone, "the stopped port is no longer listed");
        // stopping it again counts as success
        assert_eq!(stop_for_real(&[tree_s], in_port, inside.id(), true), Ok(Stop::Gone));
        let _ = apart.kill();
        let _ = apart.wait();
    }
}
