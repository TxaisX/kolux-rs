//! T-272-d: which browser page holds the keyboard, read from the system's own focus, so a page in
//! one split cannot send a keyboard chord (the address-bar chord, find, an app shortcut) while the
//! user types in another split's page.
//!
//! The app cannot tell those apart by its own focus (both arrive while the app's window holds the
//! keyboard and its own view does not), and the engine's real key events are not reachable through
//! the libraries this tree uses. What the system does know is which window has the keyboard: every
//! page sits in its own container window, so the page whose container holds the focused window is
//! the only one a real key press can come from. A script cannot move that.
//!
//! It fails open: only positive evidence that ANOTHER page holds the keyboard drops a chord. When
//! the system cannot say (no container matches, a read fails, not Windows), the app's earlier checks
//! decide as before, so a wrong reading never eats a real key press.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

/// Each tab's container window, as a plain number (recorded once the page exists).
static CONTAINERS: LazyLock<Mutex<HashMap<u32, isize>>> = LazyLock::new(Mutex::default);

pub fn record(id: u32, container: isize) {
    if let Ok(mut c) = CONTAINERS.lock() {
        c.insert(id, container);
    }
}

pub fn forget(id: u32) {
    if let Ok(mut c) = CONTAINERS.lock() {
        c.remove(&id);
    }
}

/// The tab whose container holds the focused window, if any; `inside(container)` says whether the
/// focused window is that container or inside it.
pub fn holder_among(tabs: &HashMap<u32, isize>, inside: impl Fn(isize) -> bool) -> Option<u32> {
    tabs.iter().find(|(_, c)| inside(**c)).map(|(id, _)| *id)
}

/// Whether a keyboard chord from tab `from` was pressed in that very page: `Some(true)` when its
/// page holds the keyboard, `Some(false)` when another page does (that page's script sent it),
/// `None` when the system cannot say.
pub fn pressed(from: u32, holder: Option<u32>) -> Option<bool> {
    holder.map(|h| h == from)
}

/// Whether to drop a keyboard chord from tab `from`: only when another page holds the keyboard.
pub fn drop_chord(from: u32) -> bool {
    let Ok(tabs) = CONTAINERS.lock().map(|c| c.clone()) else {
        return false;
    };
    let Some(focus) = focused_window() else {
        return false;
    };
    pressed(from, holder_among(&tabs, |c| contains(c, focus))) == Some(false)
}

/// The window holding the keyboard in the foreground thread (the one the user types into).
#[cfg(windows)]
fn focused_window() -> Option<isize> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetGUIThreadInfo, GUITHREADINFO};
    let mut info = GUITHREADINFO { cbSize: std::mem::size_of::<GUITHREADINFO>() as u32, ..Default::default() };
    // SAFETY: `info` is a properly sized GUITHREADINFO the call fills in; thread 0 is the foreground one.
    let ok = unsafe { GetGUIThreadInfo(0, &mut info) } != 0;
    (ok && !info.hwndFocus.is_null()).then_some(info.hwndFocus as isize)
}

#[cfg(not(windows))]
fn focused_window() -> Option<isize> {
    None
}

#[cfg(windows)]
fn contains(container: isize, focus: isize) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::IsChild;
    // SAFETY: IsChild only compares window handles; a stale handle answers false.
    container == focus || unsafe { IsChild(container as _, focus as _) } != 0
}

#[cfg(not(windows))]
fn contains(container: isize, focus: isize) -> bool {
    container == focus
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tabs() -> HashMap<u32, isize> {
        HashMap::from([(1, 100), (2, 200), (3, 300)])
    }

    // The focused window sits inside split 2's page (its container 200 or a window below it).
    #[test]
    fn t272d_the_page_whose_container_holds_the_keyboard_is_the_holder() {
        let below = |c: isize| c == 200;
        assert_eq!(holder_among(&tabs(), below), Some(2));
        assert_eq!(holder_among(&tabs(), |_| false), None, "the app's own view or another program");
        assert_eq!(holder_among(&HashMap::new(), |_| true), None, "no pages yet");
    }

    // The bug: the user types in split 2's page; split 1's script sends the address-bar chord.
    #[test]
    fn t272d_a_chord_from_another_splits_page_is_dropped_and_the_typed_page_keeps_its_own() {
        let holder = holder_among(&tabs(), |c| c == 200);
        assert_eq!(pressed(1, holder), Some(false), "split 1 did not have the keyboard: its script sent it");
        assert_eq!(pressed(3, holder), Some(false));
        assert_eq!(pressed(2, holder), Some(true), "a real Ctrl+L in the page being typed in still counts");
    }

    // Fails open: when the system cannot say who holds the keyboard, nothing is dropped here and
    // the app's earlier checks decide.
    #[test]
    fn t272d_no_reading_drops_nothing() {
        assert_eq!(pressed(1, None), None);
        assert_eq!(pressed(1, holder_among(&tabs(), |_| false)), None);
    }

    #[test]
    fn t272d_a_closed_tab_is_no_longer_a_holder() {
        record(41, 4100);
        record(42, 4200);
        forget(42);
        let snapshot = CONTAINERS.lock().unwrap().clone();
        assert_eq!(holder_among(&snapshot, |c| c == 4200), None);
        assert_eq!(holder_among(&snapshot, |c| c == 4100), Some(41));
        forget(41);
    }
}
