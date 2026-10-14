//! TERM-122 / APP-018: keep the computer awake while agents run. Off by default; On holds always;
//! Agent (Auto) holds only while an agent pane reads working. The choice sits on Settings > Agents
//! under the `keepAwake` key ("off", "agent", "on"); an older plain `true` reads as Agent.
//! Windows asks the system through SetThreadExecutionState on the watcher's own thread (the request
//! belongs to the thread that made it); macOS runs `caffeinate`, Linux `systemd-inhibit` (which also
//! blocks sleep on lid close). A missing tool quietly does nothing and is logged once.
// T-223: lib.rs starts the watcher and registers the command (coordinator hunk); until then the
// module is reached only by its tests.
#![allow(dead_code)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

pub const KEY: &str = "keepAwake";
static HELD: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Off,
    Agent,
    On,
}

/// The saved choice; anything unknown is Off, an older `true` is Agent.
pub fn mode(settings: &serde_json::Value) -> Mode {
    match settings.get(KEY) {
        Some(serde_json::Value::Bool(true)) => Mode::Agent,
        Some(serde_json::Value::String(s)) if s == "agent" || s == "auto" => Mode::Agent,
        Some(serde_json::Value::String(s)) if s == "on" => Mode::On,
        _ => Mode::Off,
    }
}

/// Whether to hold the computer awake: On always, Agent only with an agent working (waiting,
/// blocked or done agents do not count).
pub fn want(mode: Mode, states: impl IntoIterator<Item = &'static str>) -> bool {
    match mode {
        Mode::Off => false,
        Mode::On => true,
        Mode::Agent => states.into_iter().any(|s| s == "working"),
    }
}

/// The states the agent panes read now. Sessions live only in memory, so an agent marked working
/// before a restart but not seen since does not count.
// ponytail: a working reading gone quiet past the unverified window (STAT-032) still counts here;
// status.rs would need to expose that flag to drop it.
fn states() -> Vec<&'static str> {
    let guard = crate::status::SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
    guard.as_ref().map(|m| m.values().map(|s| s.resolved()).collect()).unwrap_or_default()
}

#[cfg(windows)]
mod sys {
    const ES_CONTINUOUS: u32 = 0x8000_0000;
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
    #[link(name = "kernel32")]
    extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
    }
    /// Asks Windows to stay awake (or lets it sleep again); false when the call was refused.
    pub fn set(hold: bool) -> bool {
        let flags = if hold { ES_CONTINUOUS | ES_SYSTEM_REQUIRED } else { ES_CONTINUOUS };
        // SAFETY: a plain kernel32 call with flag bits only; no pointers cross.
        unsafe { SetThreadExecutionState(flags) != 0 }
    }
    pub struct Hold;
    pub fn hold() -> Option<Hold> {
        set(true).then_some(Hold)
    }
    impl Drop for Hold {
        fn drop(&mut self) {
            set(false);
        }
    }
}

#[cfg(not(windows))]
mod sys {
    use std::process::{Child, Command, Stdio};
    pub struct Hold(Child);
    /// The system's own sleep blocker, held for as long as the child runs.
    pub fn hold() -> Option<Hold> {
        let pid = std::process::id().to_string();
        let mut cmd = if cfg!(target_os = "macos") {
            let mut c = Command::new("caffeinate");
            c.args(["-i", "-w", &pid]);
            c
        } else {
            let mut c = Command::new("systemd-inhibit");
            c.args(["--what=sleep:handle-lid-switch", "--who=Kolux", "--why=Agents are working", "--mode=block", "sleep", "infinity"]);
            c
        };
        cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().ok().map(Hold)
    }
    impl Drop for Hold {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

/// One tick: take or let go of the hold to match `wanted`; `missing` notes the once-only log.
fn step(slot: &mut Option<sys::Hold>, wanted: bool, missing: &mut bool) {
    if wanted && slot.is_none() {
        *slot = sys::hold();
        if slot.is_none() && !*missing {
            *missing = true;
            eprintln!("kolux: keep-awake is on but the system refused or its sleep blocker is missing; the computer may sleep");
        }
    } else if !wanted {
        *slot = None;
    }
    HELD.store(slot.is_some(), Ordering::Relaxed);
}

/// Starts the watcher: every 5 s it re-reads the choice and the agents' states, so a change, an
/// agent finishing and a resume from sleep are all picked up within a tick.
pub fn start(settings: impl Fn() -> serde_json::Value + Send + 'static) {
    std::thread::spawn(move || {
        let (mut slot, mut missing) = (None, false);
        loop {
            step(&mut slot, want(mode(&settings()), states()), &mut missing);
            std::thread::sleep(Duration::from_secs(5));
        }
    });
}

/// TERM-122: whether the computer is being kept awake now, for the status bar item.
#[tauri::command]
pub fn keep_awake_state() -> bool {
    HELD.load(Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn term122_off_by_default_and_an_older_on_reads_as_agent() {
        assert_eq!(mode(&json!({})), Mode::Off);
        assert_eq!(mode(&json!({ "keepAwake": false })), Mode::Off);
        assert_eq!(mode(&json!({ "keepAwake": true })), Mode::Agent);
        assert_eq!(mode(&json!({ "keepAwake": "agent" })), Mode::Agent);
        assert_eq!(mode(&json!({ "keepAwake": "on" })), Mode::On);
        assert_eq!(mode(&json!({ "keepAwake": "sometimes" })), Mode::Off);
    }

    #[test]
    fn term122_agent_holds_only_while_an_agent_works_and_on_holds_always() {
        assert!(!want(Mode::Off, ["working"]));
        assert!(want(Mode::On, []));
        assert!(want(Mode::Agent, ["done", "working"]));
        assert!(!want(Mode::Agent, ["waiting", "blocked", "done", "permission", "interrupted"]));
        assert!(!want(Mode::Agent, []));
    }

    #[test]
    fn term122_the_hold_is_taken_and_given_back_with_the_wanted_state() {
        let (mut slot, mut missing) = (None, false);
        step(&mut slot, true, &mut missing);
        #[cfg(windows)]
        assert!(slot.is_some() && keep_awake_state(), "Windows granted the hold through SetThreadExecutionState");
        step(&mut slot, false, &mut missing);
        assert!(slot.is_none() && !keep_awake_state());
    }
}
