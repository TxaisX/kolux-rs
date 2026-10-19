//! VIEW-078: the ports the user's workspaces are listening on. A scan lists every TCP port some
//! program is listening on, ties each to the deepest workspace folder holding its process's
//! working folder, and calls the rest external. Stopping a port is allowed only for a program that
//! runs inside a workspace folder that is really a worktree; an external program is never touched.

use serde::Serialize;

/// One listening socket as the system reports it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Listener {
    pub port: u16,
    pub address: String,
    pub pid: u32,
    pub name: String,
    /// The process's working folder, when this user may read it.
    pub cwd: Option<String>,
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

/// The workspace folders a stop may act in: real folders with a `.git` entry (a worktree or a
/// checkout), at least two levels deep, so a drive root or a home folder can never stand in.
pub fn valid_worktrees(worktrees: &[String]) -> Vec<String> {
    worktrees
        .iter()
        .filter(|w| {
            let p = std::path::Path::new(w.as_str());
            norm(w).split('/').filter(|s| !s.is_empty() && !s.ends_with(':')).count() >= 2 && p.is_dir() && p.join(".git").exists()
        })
        .cloned()
        .collect()
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

/// Stops what listens on `port`, but only programs inside a valid workspace folder. Every program
/// on the port is checked before any is touched, so one outside program refuses the whole stop.
pub fn stop_in(listeners: &[Listener], worktrees: &[String], port: u16, own_pid: u32, kill: &mut dyn FnMut(u32)) -> Result<Stop, String> {
    let here: Vec<&Listener> = listeners.iter().filter(|l| l.port == port).collect();
    if here.is_empty() {
        return Ok(Stop::Gone);
    }
    let ok = valid_worktrees(worktrees);
    let mut pids: Vec<u32> = Vec::new();
    for l in &here {
        let inside = l.cwd.as_deref().and_then(|c| deepest_worktree(c, &ok)).is_some();
        if !inside || l.pid <= 4 || l.pid == own_pid {
            return Err(format!("Port {port} is held by {} outside your workspaces. Kolux will not stop it from here", if l.name.is_empty() { "a program".to_string() } else { l.name.clone() }));
        }
        if !pids.contains(&l.pid) {
            pids.push(l.pid);
        }
    }
    for p in &pids {
        kill(*p);
    }
    Ok(Stop::Stopped(pids))
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
    use std::ffi::c_void;
    use windows_sys::Wdk::System::Threading::{NtQueryInformationProcess, ProcessBasicInformation};
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};

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

    fn names() -> std::collections::HashMap<u32, String> {
        let mut m = std::collections::HashMap::new();
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
                m.insert(e.th32ProcessID, String::from_utf16_lossy(&e.szExeFile[..len]));
                ok = Process32NextW(snap, &mut e) != 0;
            }
            CloseHandle(snap);
        }
        m
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
    // ponytail: offsets are the 64-bit layout (a 64-bit Kolux reading a 64-bit program, or a 32-bit
    // one through its native block); a program that hides its block reads as external.
    pub fn cwd(pid: u32) -> Option<String> {
        // SAFETY: the handle is checked and closed once; every read goes through ReadProcessMemory
        // into a buffer of the stated size, and the string is read only within the length the target
        // reported, capped at 32 KiB.
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
                        if len > 0 && len <= 32768 && ptr != 0 {
                            let mut text = vec![0u16; len / 2];
                            if read(ptr, text.as_mut_ptr().cast(), len) {
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

    pub fn listeners() -> Result<Vec<Listener>, String> {
        let names = names();
        let mut folders: std::collections::HashMap<u32, Option<String>> = std::collections::HashMap::new();
        Ok(sockets()?
            .into_iter()
            .filter(|(_, _, pid)| *pid > 4)
            .map(|(port, address, pid)| {
                let cwd = folders.entry(pid).or_insert_with(|| cwd(pid)).clone();
                Listener { port, address, pid, name: names.get(&pid).cloned().unwrap_or_default(), cwd }
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

    pub fn listeners() -> Result<Vec<Listener>, String> {
        let out = std::process::Command::new("lsof").args(["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"]).output().map_err(|e| format!("The system's port list could not be read ({e})"))?;
        let mut folders: std::collections::HashMap<u32, Option<String>> = std::collections::HashMap::new();
        Ok(super::parse_lsof(&String::from_utf8_lossy(&out.stdout))
            .into_iter()
            .map(|(pid, name, address, port)| Listener { port, address, pid, name, cwd: folders.entry(pid).or_insert_with(|| cwd(pid)).clone() })
            .collect())
    }
}

/// Every listening socket on the machine with its program and working folder.
pub fn listeners() -> Result<Vec<Listener>, String> {
    imp::listeners()
}

/// The status bar's scan: the listeners as rows, workspace ones tied to their folder.
#[tauri::command]
pub async fn ports_scan(worktrees: Vec<String>) -> Result<Vec<PortRow>, String> {
    tauri::async_runtime::spawn_blocking(move || listeners().map(|l| classify(&l, &worktrees))).await.map_err(|e| e.to_string())?
}

/// Stops what listens on `port`. Returns "stopped" or "gone" (it had already exited).
#[tauri::command]
pub async fn ports_stop(worktrees: Vec<String>, port: u16) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let now = listeners()?;
        let mut killed = Vec::new();
        let done = stop_in(&now, &worktrees, port, std::process::id(), &mut |pid| {
            crate::procs::kill_tree(pid);
            killed.push(pid);
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
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;
    use std::process::{Command, Stdio};

    fn w(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    fn l(port: u16, pid: u32, cwd: Option<&str>) -> Listener {
        Listener { port, address: "127.0.0.1".into(), pid, name: format!("prog{pid}.exe"), cwd: cwd.map(str::to_string) }
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
        ];
        let rows = classify(&ls, &trees);
        assert_eq!(rows.iter().map(|r| r.port).collect::<Vec<_>>(), vec![3000, 5173, 8080, 9000], "one row per program and port, by port");
        assert_eq!(rows[0].worktree.as_deref(), Some("C:/work/app/nested"));
        assert_eq!(rows[1].worktree.as_deref(), Some("C:/work/app"));
        assert!(!rows[0].external && !rows[1].external);
        assert!(rows[2].external && rows[2].worktree.is_none(), "a program elsewhere is external");
        assert!(rows[3].external, "a folder that cannot be read is external, never guessed");
    }

    #[test]
    fn view_078_stopping_a_port_that_already_exited_counts_as_success() {
        let mut killed = Vec::new();
        let r = stop_in(&[l(1, 10, None)], &w(&[]), 5173, 99, &mut |p| killed.push(p));
        assert_eq!(r, Ok(Stop::Gone));
        assert!(killed.is_empty());
    }

    #[test]
    fn view_078_a_port_held_outside_the_workspaces_is_never_stopped() {
        let tmp = crate::test_dir::temp("ports-refuse");
        let tree = tmp.join("proj").join("wt");
        std::fs::create_dir_all(tree.join(".git")).unwrap();
        let (tree_s, outside) = (tree.to_string_lossy().into_owned(), tmp.join("else").to_string_lossy().into_owned());
        let mut killed: Vec<u32> = Vec::new();
        // outside the worktree
        let r = stop_in(&[l(5173, 10, Some(&outside))], std::slice::from_ref(&tree_s), 5173, 99, &mut |p| killed.push(p));
        assert!(r.unwrap_err().contains("outside your workspaces"));
        // a folder that cannot be read
        assert!(stop_in(&[l(5173, 10, None)], std::slice::from_ref(&tree_s), 5173, 99, &mut |p| killed.push(p)).is_err());
        // one program inside and one outside on the same port: nothing is stopped
        let mixed = [l(5173, 10, Some(&tree_s)), l(5173, 11, Some(&outside))];
        assert!(stop_in(&mixed, std::slice::from_ref(&tree_s), 5173, 99, &mut |p| killed.push(p)).is_err());
        // Kolux itself and system pids
        assert!(stop_in(&[l(5173, 99, Some(&tree_s))], std::slice::from_ref(&tree_s), 5173, 99, &mut |p| killed.push(p)).is_err());
        assert!(stop_in(&[l(5173, 4, Some(&tree_s))], std::slice::from_ref(&tree_s), 5173, 99, &mut |p| killed.push(p)).is_err());
        assert!(killed.is_empty(), "nothing was touched: {killed:?}");
        // the same program inside the worktree is stopped
        let ok = stop_in(&[l(5173, 10, Some(&tree_s.replace('\\', "/")))], &[tree_s], 5173, 99, &mut |p| killed.push(p));
        assert_eq!(ok, Ok(Stop::Stopped(vec![10])));
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
        assert_eq!(valid_worktrees(&[as_string(&plain), as_string(&real), "C:\\".into(), "/".into(), as_string(&tmp.join("missing"))]), vec![as_string(&real)]);
        let mut killed = Vec::new();
        for root in ["C:\\", "/", ""] {
            let r = stop_in(&[l(1, 10, Some("C:\\anything"))], &[root.to_string()], 1, 99, &mut |p| killed.push(p));
            assert!(r.is_err(), "{root:?} must not license a stop");
        }
        assert!(stop_in(&[l(1, 10, Some(&as_string(&plain)))], &[as_string(&plain)], 1, 99, &mut |p| killed.push(p)).is_err(), "no .git entry");
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
        drop(socket);
    }

    /// A throwaway server this test starts: node listening on a free loopback port, run in `dir`.
    fn server(dir: &std::path::Path) -> Option<(std::process::Child, u16)> {
        let mut child = Command::new("node")
            .args(["-e", "require('net').createServer().listen(0,'127.0.0.1',function(){console.log(this.address().port)});setTimeout(()=>{},60000)"])
            .current_dir(dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let mut line = String::new();
        BufReader::new(child.stdout.take()?).read_line(&mut line).ok()?;
        match line.trim().parse() {
            Ok(port) => Some((child, port)),
            Err(_) => {
                let _ = child.kill();
                None
            }
        }
    }

    fn stop_for_real(worktrees: &[String], port: u16) -> Result<Stop, String> {
        let now = listeners()?;
        stop_in(&now, worktrees, port, std::process::id(), &mut |pid| crate::procs::kill_tree(pid))
    }

    #[test]
    fn view_078_a_server_started_in_a_worktree_is_listed_and_stopped_and_one_outside_is_refused() {
        let tmp = crate::test_dir::temp("ports-real");
        let tree = tmp.join("proj").join("wt");
        let outside = tmp.join("elsewhere");
        std::fs::create_dir_all(tree.join(".git")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let tree_s = tree.to_string_lossy().into_owned();
        let Some((mut inside, in_port)) = server(&tree) else {
            eprintln!("node is not on the path; the real-server test is skipped");
            return;
        };
        let (mut apart, out_port) = server(&outside).expect("second server");
        let rows = classify(&listeners().unwrap(), std::slice::from_ref(&tree_s));
        let mine = rows.iter().find(|r| r.port == in_port).expect("the server in the worktree is listed");
        assert_eq!((mine.external, mine.pid), (false, inside.id()));
        assert_eq!(mine.worktree.as_deref(), Some(tree_s.as_str()));
        assert!(rows.iter().find(|r| r.port == out_port).expect("the other server is listed").external, "outside the worktree = external");
        // the outside one is refused and keeps running
        let refused = stop_for_real(std::slice::from_ref(&tree_s), out_port);
        assert!(refused.is_err(), "{refused:?}");
        assert!(apart.try_wait().unwrap().is_none(), "the outside server must still be running");
        // the inside one is stopped and disappears
        assert!(matches!(stop_for_real(std::slice::from_ref(&tree_s), in_port), Ok(Stop::Stopped(_))));
        let _ = inside.wait();
        let gone = (0..40).any(|_| {
            std::thread::sleep(std::time::Duration::from_millis(50));
            !listeners().unwrap().iter().any(|x| x.port == in_port)
        });
        assert!(gone, "the stopped port is no longer listed");
        // stopping it again counts as success
        assert_eq!(stop_for_real(&[tree_s], in_port), Ok(Stop::Gone));
        let _ = apart.kill();
        let _ = apart.wait();
    }
}
