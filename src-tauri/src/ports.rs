//! T-226 (VIEW-078): the ports the active workspace is listening on, for the status bar. A scan
//! reads the system's listening TCP table (`netstat -ano`), then ties each port to a workspace by
//! its process: a port belongs to the terminal whose shell started the process, and that terminal
//! belongs to the deepest workspace folder that contains the folder it started in. Everything else
//! is external and can never be stopped from here. The tying rules are pure, so tests prove them;
//! the commands at the end are thin.
//!
//! ponytail: Windows does not hand out another process's working folder without reading its
//! memory, so "the process's working folder" is the folder of the terminal that started it
//! (T-226-b in kolux-rs-after.md for a real cwd read once a Win32 feature is allowed in Cargo.toml).
//!
//! A Stop ends a program, so it is licensed strictly (ports-stop, from PR #42): the row the user
//! saw must still be the same program (its pid and start time agree three times: on the row, in a
//! fresh scan and right before the kill), every holder of the port must be the workspace's own,
//! Kolux itself and system processes are never ended, and the workspace folder must be at least
//! two folders deep, no home folder or a parent of one, a real Git worktree on disk and one the
//! project store (or Git, for that project) knows. The cheap checks run first; Git runs only when
//! the store alone cannot say. After the kill the stop waits for the program to be gone.

use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

/// One listening socket as the system table shows it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Listener {
    pub port: u16,
    pub addr: String,
    pub pid: u32,
}

/// One row of the Ports popover.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PortRow {
    pub port: u16,
    pub addr: String,
    pub pid: u32,
    /// True for a port held by a process outside the active workspace: listed, never stoppable.
    pub external: bool,
    /// When the holder started, as the system counts it, as text (the count does not fit a
    /// JavaScript number). A Stop sends it back, and a pid that now belongs to a newer program is
    /// refused. Empty for an external port and where the system keeps no start times.
    pub started: String,
    /// The Kolux terminal whose shell started the holder, so a printed address binds only to a
    /// port under the terminal that printed it. None for an external port.
    pub terminal: Option<u32>,
}

/// The listening TCP sockets in `netstat -ano` text (IPv4 and IPv6 lines alike).
pub fn parse_netstat(text: &str) -> Vec<Listener> {
    text.lines()
        .filter_map(|line| {
            let w: Vec<&str> = line.split_whitespace().collect();
            if w.len() < 5 || !w[0].eq_ignore_ascii_case("TCP") || !w[3].eq_ignore_ascii_case("LISTENING") {
                return None;
            }
            let (addr, port) = w[1].rsplit_once(':')?;
            Some(Listener { port: port.parse().ok()?, addr: addr.trim_matches(['[', ']']).to_string(), pid: w[4].parse().ok()? })
        })
        .collect()
}

fn norm(p: &str) -> String {
    p.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// The deepest of `workspaces` that is `dir` or holds it: nested worktrees keep their own ports.
pub fn deepest_workspace<'a>(dir: &str, workspaces: &'a [String]) -> Option<&'a str> {
    let d = norm(dir);
    workspaces
        .iter()
        .filter(|w| {
            let w = norm(w);
            d == w || d.starts_with(&format!("{w}/"))
        })
        .max_by_key(|w| norm(w).len())
        .map(String::as_str)
}

/// The terminal whose shell started `pid` (its id and folder), found by walking up the parent table.
fn session_of<'a>(pid: u32, parents: &HashMap<u32, u32>, sessions: &'a [(u32, u32, String)]) -> Option<(u32, &'a str)> {
    let mut at = pid;
    for _ in 0..64 {
        if let Some((id, _, dir)) = sessions.iter().find(|(_, root, _)| *root == at) {
            return Some((*id, dir));
        }
        at = *parents.get(&at)?;
    }
    None
}

/// VIEW-078: the rows for `active`: its own ports first, then the external ones, each port once
/// (an IPv4 and an IPv6 socket of one process are one port). Sorted by port. `sessions` are the
/// terminals as (id, shell pid, folder); `started` reads a process's start time, asked once per
/// own holder and never for an external one (an external port tells nothing about its holder).
pub fn rows_for(listeners: &[Listener], parents: &HashMap<u32, u32>, sessions: &[(u32, u32, String)], workspaces: &[String], active: &str, started: &dyn Fn(u32) -> String) -> Vec<PortRow> {
    let mut rows: Vec<PortRow> = Vec::new();
    let mut starts: HashMap<u32, String> = HashMap::new();
    for l in listeners {
        if rows.iter().any(|r| r.port == l.port && r.pid == l.pid) {
            continue;
        }
        let session = session_of(l.pid, parents, sessions);
        let owner = session.and_then(|(_, d)| deepest_workspace(d, workspaces));
        let own = owner.is_some_and(|w| norm(w) == norm(active));
        let (started, terminal) = if own {
            (starts.entry(l.pid).or_insert_with(|| started(l.pid)).clone(), session.map(|(id, _)| id))
        } else {
            (String::new(), None)
        };
        rows.push(PortRow { port: l.port, addr: l.addr.clone(), pid: l.pid, external: !own, started, terminal });
    }
    rows.sort_by_key(|r| (r.external, r.port));
    rows
}

/// How many external ports the popover lists; a machine can hold hundreds, and the popover has no room for them.
pub const MAX_EXTERNAL_ROWS: usize = 12;

/// Keeps every port of the workspace and the first `MAX_EXTERNAL_ROWS` external ones (`rows_for` order: own first, then by port).
/// Only the list shown is cut: a stop still looks the port up in the whole scan.
pub fn cap_external(rows: Vec<PortRow>) -> Vec<PortRow> {
    let mut external = 0;
    rows.into_iter()
        .filter(|r| {
            external += usize::from(r.external);
            !r.external || external <= MAX_EXTERNAL_ROWS
        })
        .collect()
}

// ---- the Stop guards ---------------------------------------------------------------------------

/// What a Stop found for its port, before anything is ended.
#[derive(Debug, PartialEq, Eq)]
pub enum Target<'a> {
    /// Nothing holds the port, or the program the user saw has already ended and another now holds
    /// it: success, nothing to end (a newcomer is never ended on the strength of an old row).
    Gone,
    /// The row to end.
    Row(&'a PortRow),
}

fn stale(port: u16, pid: u32) -> String {
    format!("Port {port}: process {pid} now belongs to another program; nothing was stopped")
}

/// The guards a fresh scan answers. Every holder of the port is checked before any kill: a port
/// also held outside the workspace, by Kolux itself or by a system process is refused whole, and a
/// row whose pid now names a newer program (its start time changed) is refused as stale.
pub fn stop_target<'a>(rows: &'a [PortRow], port: u16, pid: u32, started: &str, self_pid: u32) -> Result<Target<'a>, String> {
    let holders: Vec<&PortRow> = rows.iter().filter(|r| r.port == port).collect();
    let Some(target) = holders.iter().copied().find(|r| r.pid == pid) else {
        return Ok(Target::Gone);
    };
    if let Some(h) = holders.iter().find(|r| r.external) {
        return Err(format!("Port {port} is held by a process outside this workspace (pid {}); it can only be stopped where it runs", h.pid));
    }
    if let Some(h) = holders.iter().find(|r| r.pid <= 4 || r.pid == self_pid) {
        let who = if h.pid == self_pid { "Kolux itself" } else { "a system process" };
        return Err(format!("Port {port} is held by {who}; Kolux never stops it"));
    }
    if !same_start(&[started, &target.started]) {
        return Err(stale(port, pid));
    }
    Ok(Target::Row(target))
}

/// True when every reading of a process's start time agrees, so the pid still names the program
/// the user saw. On Windows a reading the system withheld never agrees: a Stop must know what it ends.
pub fn same_start(readings: &[&str]) -> bool {
    same_start_on(readings, cfg!(windows))
}

fn same_start_on(readings: &[&str], strict: bool) -> bool {
    let first = readings.first().copied().unwrap_or("");
    readings.iter().all(|r| *r == first) && (!strict || !first.is_empty())
}

/// How many folders deep `p` is below its root (a drive or `/`): `C:/work/app` is 2, `/srv` is 1.
pub fn depth(p: &str) -> usize {
    norm(p).split('/').filter(|s| !s.is_empty() && !(s.len() == 2 && s.ends_with(':'))).count()
}

/// Whether the folder a Stop names may license one: at least two folders deep, no home folder or
/// a parent of one, a Git worktree on disk (`has_git`) and a workspace Kolux knows (`known`).
pub fn folder_check(active: &str, homes: &[String], has_git: &dyn Fn(&str) -> bool, known: &dyn Fn(&str) -> bool) -> Result<(), String> {
    if depth(active) < 2 {
        return Err(format!("{active} is too close to the root of the drive; Kolux only stops programs inside a workspace folder"));
    }
    let a = norm(active);
    if homes.iter().map(|h| norm(h)).any(|h| h == a || h.starts_with(&format!("{a}/"))) {
        return Err(format!("{active} is a home folder or holds one; Kolux never stops programs there"));
    }
    if !has_git(active) {
        return Err(format!("{active} is not a Git worktree; Kolux only stops programs inside one"));
    }
    if !known(active) {
        return Err(format!("{active} is not a workspace of a project Kolux knows; nothing was stopped"));
    }
    Ok(())
}

/// Whether `active` is a workspace Kolux knows: one the project store lists (`store_paths`: project
/// folders and the worktrees Kolux has seen), or else one Git lists for the project whose folder
/// holds it (`worktrees_of`, asked for that one project only; never when the store already says).
pub fn known_workspace(active: &str, store_paths: &[String], roots: &[String], worktrees_of: &dyn Fn(&str) -> Vec<String>) -> bool {
    let a = norm(active);
    if store_paths.iter().any(|p| norm(p) == a) {
        return true;
    }
    deepest_workspace(active, roots).is_some_and(|root| worktrees_of(root).iter().any(|w| norm(w) == a))
}

/// The home folders a Stop refuses, from `vars` (USERPROFILE, HOMEDRIVE+HOMEPATH, HOME) and the
/// home the terminals use; each once, unset ones left out.
pub fn homes_from(vars: &[(&str, Option<&str>)], pty_home: Option<&str>) -> Vec<String> {
    let get = |k: &str| vars.iter().find(|(n, _)| *n == k).and_then(|(_, v)| *v).filter(|v| !v.is_empty());
    let joined = get("HOMEDRIVE").zip(get("HOMEPATH")).map(|(d, p)| format!("{d}{p}"));
    let mut out: Vec<String> = Vec::new();
    for h in [get("USERPROFILE").map(String::from), joined, get("HOME").map(String::from), pty_home.map(String::from)].into_iter().flatten() {
        if !out.iter().any(|o| norm(o) == norm(&h)) {
            out.push(h);
        }
    }
    out
}

fn candidate_homes() -> Vec<String> {
    let env: Vec<(&str, Option<String>)> = ["USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME"].into_iter().map(|k| (k, std::env::var(k).ok())).collect();
    let vars: Vec<(&str, Option<&str>)> = env.iter().map(|(k, v)| (*k, v.as_deref())).collect();
    let pty = crate::pty::home_dir().map(|p| p.to_string_lossy().into_owned());
    homes_from(&vars, pty.as_deref())
}

/// The workspaces the project store licenses: every Git project's folder (`roots`) and, with them,
/// the worktrees Kolux has seen for it (`all`). Folder projects are not Git workspaces.
fn store_workspaces(store: &crate::state::Store) -> (Vec<String>, Vec<String>) {
    let mut roots = Vec::new();
    let mut all = Vec::new();
    for p in crate::projects::load_projects(store).into_iter().filter(|p| !crate::folder_projects::is_folder(store, &p.id)) {
        all.extend(crate::projects::seen_of(store, &p).unwrap_or_default());
        all.push(p.path.clone());
        roots.push(p.path);
    }
    (roots, all)
}

// ---- the system side ---------------------------------------------------------------------------

#[cfg(windows)]
fn scan_listeners() -> Result<Vec<Listener>, String> {
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new("netstat").args(["-ano"]).creation_flags(0x0800_0000).output().map_err(|e| format!("The port scan could not start: {e}"))?;
    if !out.status.success() {
        return Err("The port scan failed: netstat did not finish".into());
    }
    Ok(parse_netstat(&String::from_utf8_lossy(&out.stdout)))
}

#[cfg(not(windows))]
fn scan_listeners() -> Result<Vec<Listener>, String> {
    // ponytail: macOS and Linux read `lsof -iTCP -sTCP:LISTEN` with T-285; until then the popover shows no ports, not an error banner.
    Ok(Vec::new())
}

/// Every running process's parent, from the process table.
#[cfg(windows)]
fn parent_table() -> HashMap<u32, u32> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    let mut map = HashMap::new();
    // SAFETY: the snapshot handle is checked before use and closed once; the entry is zeroed with
    // its size set, as Process32FirstW/NextW require, and only read after a success.
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return map;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snap, &mut entry) != 0;
        while ok {
            map.insert(entry.th32ProcessID, entry.th32ParentProcessID);
            ok = Process32NextW(snap, &mut entry) != 0;
        }
        CloseHandle(snap);
    }
    map
}

#[cfg(not(windows))]
fn parent_table() -> HashMap<u32, u32> {
    HashMap::new()
}

/// When process `pid` started, as the system's own count (100 ns ticks since 1601), as text; empty
/// when the system will not say. A limited query right, no memory read.
#[cfg(windows)]
fn start_time(pid: u32) -> String {
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME};
    use windows_sys::Win32::System::Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    // SAFETY: the handle is checked before use and closed once; the four FILETIMEs are zeroed
    // out-parameters GetProcessTimes fills, read only after it reports success.
    unsafe {
        let p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if p.is_null() {
            return String::new();
        }
        let mut times: [FILETIME; 4] = std::mem::zeroed();
        let [c, e, k, u] = &mut times;
        let ok = GetProcessTimes(p, c, e, k, u) != 0;
        CloseHandle(p);
        if !ok {
            return String::new();
        }
        ((u64::from(c.dwHighDateTime) << 32) | u64::from(c.dwLowDateTime)).to_string()
    }
}

#[cfg(not(windows))]
fn start_time(_pid: u32) -> String {
    String::new()
}

fn scan(terminals: &crate::terminal::Terminals, workspaces: &[String], active: &str) -> Result<Vec<PortRow>, String> {
    let listeners = scan_listeners()?;
    let sessions: Vec<(u32, u32, String)> = terminals.list().into_iter().filter_map(|(id, pid, dir)| Some((id, pid?, dir?))).collect();
    Ok(rows_for(&listeners, &parent_table(), &sessions, workspaces, active, &start_time))
}

/// VIEW-078: the listening ports for the active workspace (own first, then external). A failed
/// scan is an error with its reason; the panel keeps its last good list.
#[tauri::command]
pub async fn ports_list(terminals: tauri::State<'_, crate::terminal::Terminals>, workspaces: Vec<String>, active: String) -> Result<Vec<PortRow>, String> {
    let t = terminals.inner().clone();
    tauri::async_runtime::spawn_blocking(move || scan(&t, &workspaces, &active).map(cap_external)).await.map_err(|e| e.to_string())?
}

/// VIEW-078: stops the process behind a port with everything it started, once every guard above
/// passes (`stop_target`, then `folder_check`, then a last start-time reading). A port that is
/// already gone counts as success; a program still running after the kill is an error.
#[tauri::command]
pub async fn ports_stop(app: tauri::AppHandle, workspaces: Vec<String>, active: String, port: u16, pid: u32, started: String) -> Result<(), String> {
    use tauri::Manager;
    let t = app.state::<crate::terminal::Terminals>().inner().clone();
    let git = app.state::<crate::git::Git>().inner().clone();
    // The store is read here, so its lock is never held across the scan or a Git run.
    let (roots, store_paths) = {
        let store = app.state::<std::sync::Mutex<crate::state::Store>>();
        let s = store.lock().map_err(|e| e.to_string())?;
        store_workspaces(&s)
    };
    tauri::async_runtime::spawn_blocking(move || {
        let rows = scan(&t, &workspaces, &active)?;
        let target = match stop_target(&rows, port, pid, &started, std::process::id())? {
            Target::Gone => return Ok(()),
            Target::Row(r) => r.clone(),
        };
        let worktrees_of = |root: &str| git.worktrees(Path::new(root)).map(|v| v.into_iter().map(|w| w.path).collect()).unwrap_or_default();
        folder_check(&active, &candidate_homes(), &|p| Path::new(p).join(".git").exists(), &|p| known_workspace(p, &store_paths, &roots, &worktrees_of))?;
        // The third reading, right before the kill: the pid must still be the program the user saw.
        if !same_start(&[&started, &target.started, &start_time(pid)]) {
            return Err(stale(port, pid));
        }
        crate::procs::kill_tree(pid);
        if !crate::procs::wait_gone(&[pid], Duration::from_secs(2)).is_empty() {
            return Err(format!("Port {port}: process {pid} is still running after the stop"));
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const NETSTAT: &str = "\nActive Connections\n\n  Proto  Local Address          Foreign Address        State           PID\n  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1004\n  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       4242\n  TCP    [::1]:5173             [::]:0                 LISTENING       4242\n  TCP    127.0.0.1:5173         127.0.0.1:50000        ESTABLISHED     4242\n  UDP    0.0.0.0:5353           *:*                                    900\n";

    fn no_start(_: u32) -> String {
        String::new()
    }

    fn ws() -> Vec<String> {
        vec!["C:\\work\\app".into(), "C:\\work\\app\\wt\\feat".into()]
    }

    #[test]
    fn view078_parse_keeps_only_listening_tcp_with_both_address_families() {
        let l = parse_netstat(NETSTAT);
        assert_eq!(l.len(), 3);
        assert_eq!(l[1], Listener { port: 5173, addr: "127.0.0.1".into(), pid: 4242 });
        assert_eq!(l[2].addr, "::1");
    }

    #[test]
    fn view078_a_dev_server_is_the_workspaces_own_and_a_service_is_external_without_a_stop() {
        let parents = HashMap::from([(4242, 4000), (4000, 3000), (1004, 4)]);
        let sessions = vec![(1, 3000, "C:\\work\\app".to_string())];
        let rows = rows_for(&parse_netstat(NETSTAT), &parents, &sessions, &ws(), "C:\\work\\app", &no_start);
        assert_eq!(rows.len(), 2, "5173 once even with an IPv4 and an IPv6 socket");
        assert_eq!((rows[0].port, rows[0].external), (5173, false));
        assert_eq!((rows[1].port, rows[1].external), (135, true));
    }

    #[test]
    fn view078_nested_worktrees_keep_their_own_ports() {
        let parents = HashMap::from([(4242, 3000)]);
        let sessions = vec![(1, 3000, "C:\\work\\app\\wt\\feat\\web".to_string())];
        let ls = parse_netstat(NETSTAT);
        let outer = rows_for(&ls, &parents, &sessions, &ws(), "C:\\work\\app", &no_start);
        let inner = rows_for(&ls, &parents, &sessions, &ws(), "C:\\work\\app\\wt\\feat", &no_start);
        assert!(outer.iter().find(|r| r.port == 5173).unwrap().external, "the nested worktree's port is not the outer one's");
        assert!(!inner.iter().find(|r| r.port == 5173).unwrap().external);
    }

    #[test]
    fn view078_deepest_workspace_and_prefix_edges() {
        assert_eq!(deepest_workspace("C:/work/app/wt/feat/x", &ws()), Some("C:\\work\\app\\wt\\feat"));
        assert_eq!(deepest_workspace("C:\\work\\apple", &ws()), None, "a sibling that shares a name prefix is not inside");
        assert_eq!(deepest_workspace("c:\\WORK\\app", &ws()), Some("C:\\work\\app"));
    }

    #[test]
    fn view078_a_parent_loop_ends_and_an_unknown_process_is_external() {
        let parents = HashMap::from([(4242, 4243), (4243, 4242)]);
        let rows = rows_for(&parse_netstat(NETSTAT), &parents, &[(1, 3000, "C:\\work\\app".into())], &ws(), "C:\\work\\app", &no_start);
        assert!(rows.iter().all(|r| r.external));
    }

    fn row(port: u16, external: bool) -> PortRow {
        PortRow { port, addr: "0.0.0.0".into(), pid: u32::from(port), external, started: String::new(), terminal: None }
    }

    #[test]
    fn row75_external_rows_are_capped_and_the_workspaces_own_are_all_kept() {
        let mut rows: Vec<PortRow> = (1..=3).map(|p| row(8000 + p, false)).collect();
        rows.extend((1..=MAX_EXTERNAL_ROWS as u16 + 10).map(|p| row(p, true)));
        let got = cap_external(rows);
        assert_eq!(got.iter().filter(|r| !r.external).count(), 3, "own ports are never dropped");
        assert_eq!(got.iter().filter(|r| r.external).count(), MAX_EXTERNAL_ROWS);
        assert_eq!(got[3].port, 1, "own first, then the external ones in port order");
        assert_eq!(got.last().map(|r| r.port), Some(MAX_EXTERNAL_ROWS as u16));
    }

    #[test]
    fn row75_a_short_list_is_left_alone() {
        let rows = vec![row(80, true), row(443, true)];
        assert_eq!(cap_external(rows.clone()), rows);
        assert!(cap_external(Vec::new()).is_empty());
    }

    // ---- the Stop guards (ports-stop, from PR #42) -------------------------------------------------

    fn sessions() -> Vec<(u32, u32, String)> {
        vec![(7, 3000, "C:\\work\\app".to_string())]
    }

    fn held(port: u16, pid: u32, external: bool, started: &str) -> PortRow {
        PortRow { port, addr: "127.0.0.1".into(), pid, external, started: started.into(), terminal: (!external).then_some(7) }
    }

    #[test]
    fn view078_stop_a_row_names_the_terminal_that_started_it_and_when_it_started() {
        let parents = HashMap::from([(4242, 4000), (4000, 3000), (1004, 4)]);
        let rows = rows_for(&parse_netstat(NETSTAT), &parents, &sessions(), &ws(), "C:\\work\\app", &|pid| format!("t{pid}"));
        assert_eq!((rows[0].pid, rows[0].terminal, rows[0].started.as_str()), (4242, Some(7), "t4242"));
        assert_eq!((rows[1].external, rows[1].terminal, rows[1].started.as_str()), (true, None, ""), "an external port tells nothing about its holder");
    }

    #[test]
    fn view078_stop_a_port_nothing_holds_or_that_another_program_now_holds_is_gone() {
        assert_eq!(stop_target(&[], 5173, 4242, "1", 9), Ok(Target::Gone));
        let rows = [held(5173, 5000, false, "2")];
        assert_eq!(stop_target(&rows, 5173, 4242, "1", 9), Ok(Target::Gone), "the program the user saw has ended; the newcomer is left alone");
    }

    #[test]
    fn view078_stop_every_holder_is_checked_so_a_second_holder_outside_the_workspace_refuses() {
        let rows = [held(5173, 4242, false, "1"), held(5173, 6000, true, "")];
        let err = stop_target(&rows, 5173, 4242, "1", 9).unwrap_err();
        assert!(err.contains("outside this workspace") && err.contains("6000"), "{err}");
    }

    #[test]
    fn view078_stop_kolux_itself_and_system_processes_are_refused() {
        assert!(stop_target(&[held(80, 9, false, "1")], 80, 9, "1", 9).unwrap_err().contains("Kolux itself"));
        assert!(stop_target(&[held(135, 4, false, "1")], 135, 4, "1", 9).unwrap_err().contains("system process"));
        assert!(stop_target(&[held(80, 4242, false, "1"), held(80, 9, false, "1")], 80, 4242, "1", 9).is_err(), "a port Kolux shares is never stopped");
    }

    #[test]
    fn view078_stop_a_reused_process_id_is_refused_as_stale() {
        let rows = [held(5173, 4242, false, "200")];
        let err = stop_target(&rows, 5173, 4242, "100", 9).unwrap_err();
        assert!(err.contains("another program"), "{err}");
        assert!(matches!(stop_target(&rows, 5173, 4242, "200", 9), Ok(Target::Row(r)) if r.pid == 4242));
        assert!(same_start_on(&["5", "5", "5"], true));
        assert!(!same_start_on(&["5", "5", "6"], true));
        assert!(!same_start_on(&["", "", ""], true), "a start time the system withheld never confirms a pid");
        assert!(same_start_on(&["", "", ""], false), "where the system keeps no start times the guard is off");
    }

    #[test]
    fn view078_stop_a_home_folder_its_parents_a_shallow_folder_and_a_folder_without_git_are_refused() {
        let homes = vec!["C:\\Users\\txais".to_string(), "/home/txais".to_string(), "D:\\people\\home\\txais".to_string()];
        let yes = |_: &str| true;
        assert!(folder_check("C:\\Users\\txais", &homes, &yes, &yes).unwrap_err().contains("home folder"));
        assert!(folder_check("D:\\people\\home", &homes, &yes, &yes).unwrap_err().contains("home folder"), "a parent of a home, deep enough to pass the depth rule");
        assert!(folder_check("C:\\Users", &homes, &yes, &yes).is_err(), "a parent of a home at the root is refused too (by depth)");
        assert!(folder_check("c:/users/TXAIS/", &homes, &yes, &yes).unwrap_err().contains("home folder"), "spelling does not matter");
        assert_eq!(folder_check("D:\\people\\homely", &homes, &yes, &yes), Ok(()), "a sibling that shares a name prefix is not a parent");
        assert!(folder_check("C:\\work", &homes, &yes, &yes).unwrap_err().contains("too close to the root"));
        assert!(folder_check("C:\\Users\\txais\\code\\app", &homes, &|_| false, &yes).unwrap_err().contains("not a Git worktree"));
        assert!(folder_check("C:\\Users\\txais\\code\\app", &homes, &yes, &|_| false).unwrap_err().contains("not a workspace"));
        assert_eq!(folder_check("C:\\Users\\txais\\code\\app", &homes, &yes, &yes), Ok(()));
        assert_eq!(depth("C:\\"), 0);
        assert_eq!(depth("/srv"), 1);
        assert_eq!(depth("//nas/share/app"), 3);
    }

    #[test]
    fn view078_stop_the_store_licenses_a_workspace_and_git_is_asked_only_for_the_project_holding_it() {
        use std::cell::RefCell;
        let asked = RefCell::new(Vec::new());
        let git = |root: &str| {
            asked.borrow_mut().push(root.to_string());
            vec![format!("{root}\\wt\\feat")]
        };
        let roots = vec!["C:\\work\\app".to_string(), "C:\\other".to_string()];
        let store = vec!["C:\\work\\app".to_string(), "C:\\work\\app\\wt\\seen".to_string()];
        assert!(known_workspace("c:/work/app/wt/seen", &store, &roots, &git));
        assert!(asked.borrow().is_empty(), "a workspace the store lists never spawns git");
        assert!(known_workspace("C:\\work\\app\\wt\\feat", &store, &roots, &git));
        assert_eq!(*asked.borrow(), vec!["C:\\work\\app".to_string()]);
        assert!(!known_workspace("C:\\work\\app\\wt\\stranger", &store, &roots, &git));
        assert!(!known_workspace("D:\\elsewhere\\x", &store, &roots, &git), "a folder under no project asks nothing");
        assert_eq!(asked.borrow().len(), 2);
    }

    #[test]
    fn view078_stop_the_homes_a_stop_refuses_come_from_every_home_variable() {
        let vars = [("USERPROFILE", Some("C:\\Users\\a")), ("HOMEDRIVE", Some("D:")), ("HOMEPATH", Some("\\Users\\b")), ("HOME", Some("/home/c"))];
        assert_eq!(homes_from(&vars, Some("/home/pty")), vec!["C:\\Users\\a", "D:\\Users\\b", "/home/c", "/home/pty"]);
        assert_eq!(homes_from(&[("HOME", None)], None), Vec::<String>::new());
    }

    #[cfg(not(windows))]
    #[test]
    fn row75_a_system_without_a_scan_shows_no_ports_not_an_error() {
        assert_eq!(scan_listeners(), Ok(Vec::new()));
    }
}
