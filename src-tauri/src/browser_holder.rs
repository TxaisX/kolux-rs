//! T-272-d: which browser page holds the keyboard, read from the system's own focus, so a page in
//! one split cannot send a keyboard chord (the address-bar chord, find, an app shortcut) while the
//! user types in another split's page.
//!
//! The app cannot tell those apart by its own focus (both arrive while the app's window holds the
//! keyboard and its own view does not). Two readings tell them apart: the engine's own key events
//! (below), and the system's focus. What the system does know is which window has the keyboard: every
//! page sits in its own container window, so the page whose container holds the focused window is
//! the only one a real key press can come from. A script cannot move that.
//!
//! It fails open: only positive evidence that ANOTHER page holds the keyboard drops a chord. When
//! the system cannot say (no container matches, a read fails, not Windows), the app's earlier checks
//! decide as before, so a wrong reading never eats a real key press.

//!
//! The engine's own key events (2026-10-20, webview2-com): WebView2 raises its accelerator-key
//! event in a page only for a key really pressed while that page holds the keyboard (a key with
//! Ctrl or Alt held, or one that types no character), before the page sees it. Every page whose
//! hook is in place is "watched": a keyboard chord or app shortcut from a watched page counts only
//! when a matching real key went down in that very page within the last second, and each press
//! counts once. Chords a mouse can also send (back and forward buttons, Ctrl+wheel zoom) leave no
//! key; when no key matches them the earlier checks decide, as before. A page whose hook failed is
//! not watched, so it, too, falls back to the system-focus reading and the earlier checks.

use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

/// Each tab's container window, as a plain number (recorded once the page exists).
static CONTAINERS: LazyLock<Mutex<HashMap<u32, isize>>> = LazyLock::new(Mutex::default);

/// The real key presses the engine reported, per watched page.
static PRESSES: LazyLock<Mutex<Presses>> = LazyLock::new(Mutex::default);

pub fn record(id: u32, container: isize) {
    if let Ok(mut c) = CONTAINERS.lock() {
        c.insert(id, container);
    }
}

pub fn forget(id: u32) {
    if let Ok(mut c) = CONTAINERS.lock() {
        c.remove(&id);
    }
    if let Ok(mut p) = PRESSES.lock() {
        p.forget(id);
    }
}

/// The engine's key-event hook is in place for page `id` (called once, as the page is made).
pub fn watch(id: u32) {
    if let Ok(mut p) = PRESSES.lock() {
        p.watch(id);
    }
}

/// The engine reported a key event in page `id`: `kind` is its key-event kind (0 key down,
/// 1 key up, 2 system key down, 3 system key up), `vk` its virtual key.
pub fn engine_key(id: u32, kind: i32, vk: u32) {
    if is_key_down(kind) {
        if let Ok(mut p) = PRESSES.lock() {
            p.press(id, vk, Instant::now());
        }
    }
}

/// A key going down (plain or with Alt), never a key coming up.
pub fn is_key_down(kind: i32) -> bool {
    kind == 0 || kind == 2
}

/// How long a real key press stays able to back a chord the page's script sends after it.
pub const PRESS_WINDOW: Duration = Duration::from_secs(1);
/// The presses kept per page (a held-down key repeats; older ones are dropped).
const PRESSES_KEPT: usize = 8;

/// What real key press a chord from a page needs to count.
#[derive(Debug, Clone, PartialEq)]
pub enum Need {
    /// Only a keyboard sends it: one of these virtual keys must have gone down in the page.
    Keys(Vec<u32>),
    /// A key (one of these) or a mouse sends it: a matching key counts; no key leaves it to the
    /// earlier checks, since a mouse button or wheel leaves no key event.
    KeysOrMouse(Vec<u32>),
    /// Only a keyboard sends it but which key is not known here: any real key press counts.
    AnyKey,
}

// Windows virtual-key codes (public Win32 values).
const VK_TAB: u32 = 0x09;
const VK_RETURN: u32 = 0x0D;
const VK_ESCAPE: u32 = 0x1B;
const VK_BACK: u32 = 0x08;
const VK_SPACE: u32 = 0x20;
const VK_PRIOR: u32 = 0x21;
const VK_NEXT: u32 = 0x22;
const VK_END: u32 = 0x23;
const VK_HOME: u32 = 0x24;
const VK_LEFT: u32 = 0x25;
const VK_UP: u32 = 0x26;
const VK_RIGHT: u32 = 0x27;
const VK_DOWN: u32 = 0x28;
const VK_INSERT: u32 = 0x2D;
const VK_DELETE: u32 = 0x2E;
const VK_NUMPAD0: u32 = 0x60;
const VK_ADD: u32 = 0x6B;
const VK_SUBTRACT: u32 = 0x6D;
const VK_F1: u32 = 0x70;
const VK_OEM_1: u32 = 0xBA;
const VK_OEM_PLUS: u32 = 0xBB;
const VK_OEM_COMMA: u32 = 0xBC;
const VK_OEM_MINUS: u32 = 0xBD;
const VK_OEM_PERIOD: u32 = 0xBE;
const VK_OEM_2: u32 = 0xBF;
const VK_OEM_3: u32 = 0xC0;
const VK_OEM_4: u32 = 0xDB;
const VK_OEM_5: u32 = 0xDC;
const VK_OEM_6: u32 = 0xDD;
const VK_OEM_7: u32 = 0xDE;

/// The virtual key behind a key name the page's script reports: a key code (`KeyW`, `Digit1`,
/// `Numpad0`, `F5`, `PageDown`) or a typed key (`w`, `1`, `=`). `None` when it names no key we map.
pub fn vk_of(name: &str) -> Option<u32> {
    let one = |c: char| match c {
        'a'..='z' => Some(c.to_ascii_uppercase() as u32),
        'A'..='Z' | '0'..='9' => Some(c as u32),
        '=' | '+' => Some(VK_OEM_PLUS),
        '-' | '_' => Some(VK_OEM_MINUS),
        ',' | '<' => Some(VK_OEM_COMMA),
        '.' | '>' => Some(VK_OEM_PERIOD),
        '/' | '?' => Some(VK_OEM_2),
        '`' | '~' => Some(VK_OEM_3),
        '[' | '{' => Some(VK_OEM_4),
        '\\' | '|' => Some(VK_OEM_5),
        ']' | '}' => Some(VK_OEM_6),
        '\'' | '"' => Some(VK_OEM_7),
        ';' | ':' => Some(VK_OEM_1),
        ' ' => Some(VK_SPACE),
        _ => None,
    };
    let single = |s: &str| {
        let mut r = s.chars();
        match (r.next(), r.next()) {
            (Some(c), None) => Some(c),
            _ => None,
        }
    };
    if let Some(c) = single(name) {
        return one(c);
    }
    if let Some(c) = name.strip_prefix("Key").and_then(single).filter(char::is_ascii_uppercase) {
        return Some(c as u32);
    }
    if let Some(c) = name.strip_prefix("Digit").and_then(single).filter(char::is_ascii_digit) {
        return Some(c as u32);
    }
    if let Some(c) = name.strip_prefix("Numpad").and_then(single).filter(char::is_ascii_digit) {
        return Some(VK_NUMPAD0 + (c as u32 - '0' as u32));
    }
    if let Some(n) = name.strip_prefix('F').and_then(|n| n.parse::<u32>().ok()).filter(|n| (1..=24).contains(n)) {
        return Some(VK_F1 + n - 1);
    }
    Some(match name {
        "Tab" => VK_TAB,
        "Enter" | "NumpadEnter" => VK_RETURN,
        "Escape" => VK_ESCAPE,
        "Backspace" => VK_BACK,
        "Space" => VK_SPACE,
        "PageUp" => VK_PRIOR,
        "PageDown" => VK_NEXT,
        "End" => VK_END,
        "Home" => VK_HOME,
        "ArrowLeft" => VK_LEFT,
        "ArrowUp" => VK_UP,
        "ArrowRight" => VK_RIGHT,
        "ArrowDown" => VK_DOWN,
        "Insert" => VK_INSERT,
        "Delete" => VK_DELETE,
        "NumpadAdd" | "Plus" => VK_ADD,
        "NumpadSubtract" => VK_SUBTRACT,
        "Equal" => VK_OEM_PLUS,
        "Minus" => VK_OEM_MINUS,
        "Comma" => VK_OEM_COMMA,
        "Period" => VK_OEM_PERIOD,
        "Slash" => VK_OEM_2,
        "Backquote" => VK_OEM_3,
        "BracketLeft" => VK_OEM_4,
        "Backslash" => VK_OEM_5,
        "BracketRight" => VK_OEM_6,
        "Quote" => VK_OEM_7,
        "Semicolon" => VK_OEM_1,
        _ => return None,
    })
}

/// The key a browser chord (`kolux-chord:<what>`) needs, as the page's chord script sends them:
/// Mod+L, Mod+F, Mod+R, Mod+0 only from the keyboard; back and forward also from the mouse's
/// side buttons, zoom in and out also from Ctrl+wheel.
pub fn need_for_chord(what: &str) -> Need {
    match what {
        "focusAddressBar" => Need::Keys(vec!['L' as u32]),
        "find" => Need::Keys(vec!['F' as u32]),
        "reload" => Need::Keys(vec!['R' as u32]),
        "zoomReset" => Need::Keys(vec!['0' as u32, VK_NUMPAD0]),
        "zoomIn" => Need::KeysOrMouse(vec![VK_OEM_PLUS, VK_ADD]),
        "zoomOut" => Need::KeysOrMouse(vec![VK_OEM_MINUS, VK_SUBTRACT]),
        // Alt+Left / Alt+Right, or Mod+[ / Mod+] on a Mac.
        "back" => Need::KeysOrMouse(vec![VK_LEFT, VK_OEM_4]),
        "forward" => Need::KeysOrMouse(vec![VK_RIGHT, VK_OEM_6]),
        _ => Need::AnyKey,
    }
}

/// The key an app shortcut the page forwards needs (its `kolux-chord:key` fields `c`, the key
/// code, and `k`, the typed key): either one's virtual key counts, so a remapped layout still
/// matches; when neither maps, any real key press in the page counts.
pub fn need_for_key(fields: &serde_json::Value) -> Need {
    let mut keys: Vec<u32> = ["c", "k"].iter().filter_map(|f| fields.get(*f)?.as_str()).filter_map(vk_of).collect();
    keys.dedup();
    if keys.is_empty() {
        Need::AnyKey
    } else {
        Need::Keys(keys)
    }
}

/// The real key presses each watched page's engine reported, newest last.
#[derive(Debug, Default)]
pub struct Presses {
    watched: HashSet<u32>,
    recent: HashMap<u32, Vec<(u32, Instant)>>,
}

impl Presses {
    pub fn watch(&mut self, id: u32) {
        self.watched.insert(id);
    }

    pub fn forget(&mut self, id: u32) {
        self.watched.remove(&id);
        self.recent.remove(&id);
    }

    pub fn press(&mut self, id: u32, vk: u32, now: Instant) {
        let list = self.recent.entry(id).or_default();
        list.retain(|(_, at)| now.saturating_duration_since(*at) <= PRESS_WINDOW);
        list.push((vk, now));
        if list.len() > PRESSES_KEPT {
            list.remove(0);
        }
    }

    /// Whether a chord from page `from` was really pressed there, by the engine's key events:
    /// `Some(true)` when a matching press is found (it is used up: one press backs one chord),
    /// `Some(false)` when the page is watched and nothing matches (its script sent it),
    /// `None` when the engine cannot say (the page is not watched, or a mouse may have sent it).
    pub fn verdict(&mut self, from: u32, need: &Need, now: Instant) -> Option<bool> {
        if !self.watched.contains(&from) {
            return None;
        }
        let list = self.recent.entry(from).or_default();
        list.retain(|(_, at)| now.saturating_duration_since(*at) <= PRESS_WINDOW);
        let hit = list.iter().rposition(|(vk, _)| match need {
            Need::Keys(keys) | Need::KeysOrMouse(keys) => keys.contains(vk),
            Need::AnyKey => true,
        });
        match (hit, need) {
            (Some(i), _) => {
                list.remove(i);
                Some(true)
            }
            (None, Need::KeysOrMouse(_)) => None,
            (None, _) => Some(false),
        }
    }
}

/// The engine's verdict on a chord from page `from` (see `Presses::verdict`).
fn engine_verdict(from: u32, need: &Need) -> Option<bool> {
    PRESSES.lock().ok()?.verdict(from, need, Instant::now())
}

/// How the two readings combine: the engine's key events win when they can say (a real press in
/// that very page, or a watched page with none); otherwise the system-focus reading drops a chord
/// only when another page holds the keyboard.
pub fn decide_drop(engine: Option<bool>, focus: impl FnOnce() -> Option<bool>) -> bool {
    match engine {
        Some(pressed) => !pressed,
        None => focus() == Some(false),
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

/// Whether to drop a keyboard chord from tab `from` that needs `need`: when the engine's key
/// events show no matching real press in that page, or (when they cannot say) another page holds
/// the keyboard.
pub fn drop_chord(from: u32, need: &Need) -> bool {
    decide_drop(engine_verdict(from, need), || focus_verdict(from))
}

/// The system-focus reading: whether page `from` holds the keyboard (`None`: cannot say).
fn focus_verdict(from: u32) -> Option<bool> {
    let tabs = CONTAINERS.lock().map(|c| c.clone()).ok()?;
    let focus = focused_window()?;
    pressed(from, holder_among(&tabs, |c| contains(c, focus)))
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

    // --- the engine's key events ---

    const L: u32 = 'L' as u32;

    fn watched(ids: &[u32]) -> Presses {
        let mut p = Presses::default();
        for id in ids {
            p.watch(*id);
        }
        p
    }

    // The bug the card names: the user types in split 2; split 1's script sends the address-bar
    // chord. The engine saw no key in split 1, so it is dropped; split 2's real Ctrl+L counts.
    #[test]
    fn t272d_engine_a_chord_with_no_real_key_in_that_page_is_dropped() {
        let t = Instant::now();
        let mut p = watched(&[1, 2]);
        p.press(2, L, t);
        let need = need_for_chord("focusAddressBar");
        assert_eq!(p.verdict(1, &need, t), Some(false), "split 1 had no key: its script sent it");
        assert_eq!(p.verdict(2, &need, t + Duration::from_millis(30)), Some(true), "split 2's real Ctrl+L");
    }

    // One real press backs one chord: a page cannot turn the user's Ctrl+L into a stream of them.
    #[test]
    fn t272d_engine_one_press_backs_one_chord() {
        let t = Instant::now();
        let mut p = watched(&[1]);
        p.press(1, L, t);
        let need = need_for_chord("focusAddressBar");
        assert_eq!(p.verdict(1, &need, t), Some(true));
        assert_eq!(p.verdict(1, &need, t), Some(false), "the press is used up");
        // A held-down key repeats, and each repeat is a real key-down the engine reports.
        p.press(1, L, t);
        p.press(1, L, t);
        assert_eq!(p.verdict(1, &need, t), Some(true));
        assert_eq!(p.verdict(1, &need, t), Some(true));
        assert_eq!(p.verdict(1, &need, t), Some(false));
    }

    // The edge: a press is good for one second, not one moment longer.
    #[test]
    fn t272d_engine_a_press_older_than_the_window_backs_nothing() {
        let t = Instant::now();
        let need = need_for_chord("focusAddressBar");
        let mut p = watched(&[1]);
        p.press(1, L, t);
        assert_eq!(p.verdict(1, &need, t + PRESS_WINDOW), Some(true), "exactly at the window still counts");
        p.press(1, L, t);
        assert_eq!(p.verdict(1, &need, t + PRESS_WINDOW + Duration::from_millis(1)), Some(false));
    }

    // The key must match: a real Ctrl+C in the page does not back the page's address-bar chord.
    #[test]
    fn t272d_engine_another_key_does_not_back_the_chord() {
        let t = Instant::now();
        let mut p = watched(&[1]);
        p.press(1, 'C' as u32, t);
        assert_eq!(p.verdict(1, &need_for_chord("focusAddressBar"), t), Some(false));
        // ... and the Ctrl+C press stays for a chord it does match (nothing was used up).
        assert_eq!(p.verdict(1, &Need::Keys(vec!['C' as u32]), t), Some(true));
    }

    // Back, forward and zoom also come from the mouse, which leaves no key: with no key they are
    // left to the earlier checks; with the matching key they count and use it up.
    #[test]
    fn t272d_engine_mouse_chords_without_a_key_are_left_to_the_earlier_checks() {
        let t = Instant::now();
        let mut p = watched(&[1]);
        for what in ["back", "forward", "zoomIn", "zoomOut"] {
            assert_eq!(p.verdict(1, &need_for_chord(what), t), None, "{what}");
        }
        p.press(1, VK_LEFT, t);
        assert_eq!(p.verdict(1, &need_for_chord("back"), t), Some(true), "Alt+Left");
        for what in ["focusAddressBar", "find", "reload", "zoomReset"] {
            assert_eq!(p.verdict(1, &need_for_chord(what), t), Some(false), "{what} only comes from a key");
        }
    }

    // A page whose hook is not in place (or a closed one) is not judged by the engine at all.
    #[test]
    fn t272d_engine_an_unwatched_page_cannot_be_judged() {
        let t = Instant::now();
        let mut p = watched(&[1]);
        assert_eq!(p.verdict(9, &need_for_chord("focusAddressBar"), t), None);
        p.press(1, L, t);
        p.forget(1);
        assert_eq!(p.verdict(1, &need_for_chord("focusAddressBar"), t), None);
    }

    // App shortcuts the page forwards: the code's key or the typed key, whichever maps.
    #[test]
    fn t272d_engine_app_shortcuts_need_their_own_key() {
        let t = Instant::now();
        let w = serde_json::json!({ "kind": "key", "k": "w", "c": "KeyW", "m": "c" });
        assert_eq!(need_for_key(&w), Need::Keys(vec!['W' as u32]));
        // A French keyboard: the key in the W spot types "z"; either matches.
        let azerty = serde_json::json!({ "k": "z", "c": "KeyW" });
        assert_eq!(need_for_key(&azerty), Need::Keys(vec!['W' as u32, 'Z' as u32]));
        assert_eq!(need_for_key(&serde_json::json!({ "k": "Tab", "c": "Tab" })), Need::Keys(vec![VK_TAB]));
        assert_eq!(need_for_key(&serde_json::json!({ "k": "Dead", "c": "IntlRo" })), Need::AnyKey);
        let mut p = watched(&[1]);
        assert_eq!(p.verdict(1, &need_for_key(&w), t), Some(false), "a shortcut no key backs is dropped");
        p.press(1, 'Z' as u32, t);
        assert_eq!(p.verdict(1, &need_for_key(&azerty), t), Some(true));
        assert_eq!(p.verdict(1, &Need::AnyKey, t), Some(false), "nothing left");
    }

    #[test]
    fn t272d_engine_key_names_map_to_virtual_keys() {
        for (name, vk) in [
            ("l", 0x4C), ("L", 0x4C), ("KeyL", 0x4C), ("Digit1", 0x31), ("1", 0x31), ("Numpad0", 0x60),
            ("F1", 0x70), ("F12", 0x7B), ("F24", 0x87), ("PageDown", 0x22), ("PageUp", 0x21), ("Space", 0x20),
            (" ", 0x20), ("Plus", 0x6B), ("NumpadAdd", 0x6B), ("=", 0xBB), ("+", 0xBB), ("-", 0xBD),
            ("[", 0xDB), ("]", 0xDD), ("ArrowLeft", 0x25), ("ArrowRight", 0x27), ("Escape", 0x1B),
        ] {
            assert_eq!(vk_of(name), Some(vk), "{name}");
        }
        for name in ["", "F0", "F25", "Keyl", "KeyLL", "Digitx", "Dead", "é", "Unidentified"] {
            assert_eq!(vk_of(name), None, "{name}");
        }
    }

    // Only a key going down is a press; its coming up is not.
    #[test]
    fn t272d_engine_only_key_downs_count() {
        assert!(is_key_down(0), "key down");
        assert!(is_key_down(2), "system key down (with Alt)");
        assert!(!is_key_down(1));
        assert!(!is_key_down(3));
    }

    // How the readings combine: the engine wins when it can say; otherwise the focus reading
    // drops only on positive evidence (and is not even asked when the engine can say).
    #[test]
    fn t272d_engine_reading_wins_and_focus_reading_is_the_fallback() {
        let never = || -> Option<bool> { panic!("the focus reading is not needed") };
        assert!(decide_drop(Some(false), never), "watched page, no real key: dropped");
        assert!(!decide_drop(Some(true), never), "real key in that page: kept, whatever the focus says");
        assert!(decide_drop(None, || Some(false)), "engine cannot say, another page holds the keyboard");
        assert!(!decide_drop(None, || Some(true)));
        assert!(!decide_drop(None, || None), "neither can say: fails open");
    }

    // At most a few presses are kept per page.
    #[test]
    fn t272d_engine_keeps_only_the_newest_presses() {
        let t = Instant::now();
        let mut p = watched(&[1]);
        p.press(1, L, t);
        for _ in 0..PRESSES_KEPT {
            p.press(1, 'X' as u32, t);
        }
        assert_eq!(p.verdict(1, &need_for_chord("focusAddressBar"), t), Some(false), "the oldest press fell off");
    }
}
