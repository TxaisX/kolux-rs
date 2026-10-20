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

use serde::Serialize;
use std::collections::HashMap;

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

/// The terminal (by its folder) whose shell started `pid`, found by walking up the parent table.
fn session_dir<'a>(pid: u32, parents: &HashMap<u32, u32>, sessions: &'a [(u32, String)]) -> Option<&'a str> {
    let mut at = pid;
    for _ in 0..64 {
        if let Some((_, dir)) = sessions.iter().find(|(root, _)| *root == at) {
            return Some(dir);
        }
        at = *parents.get(&at)?;
    }
    None
}

/// VIEW-078: the rows for `active`: its own ports first, then the external ones, each port once
/// (an IPv4 and an IPv6 socket of one process are one port). Sorted by port.
pub fn rows_for(listeners: &[Listener], parents: &HashMap<u32, u32>, sessions: &[(u32, String)], workspaces: &[String], active: &str) -> Vec<PortRow> {
    let mut rows: Vec<PortRow> = Vec::new();
    for l in listeners {
        if rows.iter().any(|r| r.port == l.port && r.pid == l.pid) {
            continue;
        }
        let owner = session_dir(l.pid, parents, sessions).and_then(|d| deepest_workspace(d, workspaces));
        let own = owner.is_some_and(|w| norm(w) == norm(active));
        rows.push(PortRow { port: l.port, addr: l.addr.clone(), pid: l.pid, external: !own });
    }
    rows.sort_by_key(|r| (r.external, r.port));
    rows
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
    // ponytail: macOS and Linux read `lsof -iTCP -sTCP:LISTEN` with T-285; Windows is the build target now.
    Err("Listing ports is not built for this system yet".into())
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

fn scan(terminals: &crate::terminal::Terminals, workspaces: &[String], active: &str) -> Result<Vec<PortRow>, String> {
    let listeners = scan_listeners()?;
    let sessions: Vec<(u32, String)> = terminals.list().into_iter().filter_map(|(_, pid, dir)| Some((pid?, dir?))).collect();
    Ok(rows_for(&listeners, &parent_table(), &sessions, workspaces, active))
}

/// VIEW-078: the listening ports for the active workspace (own first, then external). A failed
/// scan is an error with its reason; the panel keeps its last good list.
#[tauri::command]
pub async fn ports_list(terminals: tauri::State<'_, crate::terminal::Terminals>, workspaces: Vec<String>, active: String) -> Result<Vec<PortRow>, String> {
    let t = terminals.inner().clone();
    tauri::async_runtime::spawn_blocking(move || scan(&t, &workspaces, &active)).await.map_err(|e| e.to_string())?
}

/// VIEW-078: stops the process behind a port with everything it started. A port that is already
/// gone counts as success; an external port is refused whatever the caller asked.
#[tauri::command]
pub async fn ports_stop(terminals: tauri::State<'_, crate::terminal::Terminals>, workspaces: Vec<String>, active: String, port: u16, pid: u32) -> Result<(), String> {
    let t = terminals.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let rows = scan(&t, &workspaces, &active)?;
        match rows.iter().find(|r| r.port == port && r.pid == pid) {
            None => Ok(()),
            Some(r) if r.external => Err(format!("Port {port} is held by a process outside this workspace; it can only be stopped where it runs")),
            Some(_) => {
                crate::procs::kill_tree(pid);
                Ok(())
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const NETSTAT: &str = "\nActive Connections\n\n  Proto  Local Address          Foreign Address        State           PID\n  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1004\n  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       4242\n  TCP    [::1]:5173             [::]:0                 LISTENING       4242\n  TCP    127.0.0.1:5173         127.0.0.1:50000        ESTABLISHED     4242\n  UDP    0.0.0.0:5353           *:*                                    900\n";

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
        let sessions = vec![(3000, "C:\\work\\app".to_string())];
        let rows = rows_for(&parse_netstat(NETSTAT), &parents, &sessions, &ws(), "C:\\work\\app");
        assert_eq!(rows.len(), 2, "5173 once even with an IPv4 and an IPv6 socket");
        assert_eq!((rows[0].port, rows[0].external), (5173, false));
        assert_eq!((rows[1].port, rows[1].external), (135, true));
    }

    #[test]
    fn view078_nested_worktrees_keep_their_own_ports() {
        let parents = HashMap::from([(4242, 3000)]);
        let sessions = vec![(3000, "C:\\work\\app\\wt\\feat\\web".to_string())];
        let ls = parse_netstat(NETSTAT);
        let outer = rows_for(&ls, &parents, &sessions, &ws(), "C:\\work\\app");
        let inner = rows_for(&ls, &parents, &sessions, &ws(), "C:\\work\\app\\wt\\feat");
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
        let rows = rows_for(&parse_netstat(NETSTAT), &parents, &[(3000, "C:\\work\\app".into())], &ws(), "C:\\work\\app");
        assert!(rows.iter().all(|r| r.external));
    }
}
