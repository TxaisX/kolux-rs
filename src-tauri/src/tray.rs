//! APP-008 / T-248-a: what the tray icon shows, kept free of the tray itself so it is testable.
//! The icon has a two-item menu (Open Kolux, Quit); a dot appears when a bell rang or an agent
//! finished while the window was hidden and clears once the window is shown; development copies
//! carry a DEV label with the branch they run from; Linux gets no tray icon. Putting this on a real
//! tray icon needs tauri's `tray-icon` feature (a Cargo.toml change for the coordinator) and is
//! T-248-b, together with the left-click-opens rule on Windows.
// Nothing outside the tests calls this until T-248-b puts it on a real tray icon.
#![allow(dead_code)]

use crate::menu::Os;

pub const OPEN_ID: &str = "tray.open";
pub const QUIT_ID: &str = "tray.quit";

/// The tray's menu, in order: (id, label).
pub fn items() -> [(&'static str, &'static str); 2] {
    [(OPEN_ID, "Open Kolux"), (QUIT_ID, "Quit")]
}

/// Windows and macOS get a tray icon; Linux does not.
pub fn has_tray(os: Os) -> bool {
    os != Os::Linux
}

/// On Windows a left-click opens the app; elsewhere a click opens the menu.
pub fn left_click_opens(os: Os) -> bool {
    os == Os::Windows
}

/// The hover text: the app name, and for a development copy "DEV" and the branch it runs from.
pub fn tooltip(dev: bool, branch: Option<&str>) -> String {
    match (dev, branch.map(str::trim).filter(|b| !b.is_empty())) {
        (false, _) => "Kolux".into(),
        (true, Some(b)) => format!("Kolux DEV ({b})"),
        (true, None) => "Kolux DEV".into(),
    }
}

/// Something that may want the user's attention.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ping {
    Bell,
    AgentFinished,
}

/// The attention dot: set by a ping while the window is hidden, cleared when it is shown.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Dot {
    pub on: bool,
    hidden: bool,
}

/// STAT-047: the icon file the tray shows; a development copy keeps its DEV marker when the
/// attention version is swapped in.
pub fn icon(dev: bool, dot: bool) -> &'static str {
    match (dev, dot) {
        (false, false) => "tray.png",
        (false, true) => "tray-dot.png",
        (true, false) => "tray-dev.png",
        (true, true) => "tray-dev-dot.png",
    }
}

/// STAT-047: closing the window hides it to the tray only when the user turned that on; the saved
/// choice carries over, the default is off.
pub fn close_to_tray(saved: Option<bool>) -> bool {
    saved == Some(true)
}

impl Dot {
    pub fn window_hidden(&mut self) {
        self.hidden = true;
    }
    /// STAT-047: a minimised window is out of sight like a hidden one.
    pub fn window_minimised(&mut self) {
        self.hidden = true;
    }
    pub fn window_shown(&mut self) {
        self.hidden = false;
        self.on = false;
    }
    /// A ping lights the dot only while the window is hidden; the return says whether it changed.
    pub fn ping(&mut self, _what: Ping) -> bool {
        let was = self.on;
        if self.hidden {
            self.on = true;
        }
        was != self.on
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_008_menu_is_open_then_quit() {
        assert_eq!(items(), [("tray.open", "Open Kolux"), ("tray.quit", "Quit")]);
    }

    #[test]
    fn app_008_windows_and_macos_only_and_left_click_opens_on_windows() {
        assert!(has_tray(Os::Windows) && has_tray(Os::Mac) && !has_tray(Os::Linux));
        assert!(left_click_opens(Os::Windows) && !left_click_opens(Os::Mac));
    }

    #[test]
    fn app_008_dev_copies_show_dev_and_the_branch() {
        assert_eq!(tooltip(false, Some("lane/chrome")), "Kolux");
        assert_eq!(tooltip(true, Some("lane/chrome")), "Kolux DEV (lane/chrome)");
        assert_eq!(tooltip(true, Some("  ")), "Kolux DEV");
        assert_eq!(tooltip(true, None), "Kolux DEV");
    }

    #[test]
    fn app_008_dot_lights_only_while_hidden_and_clears_when_shown() {
        let mut d = Dot::default();
        assert!(!d.ping(Ping::AgentFinished), "a ping with the window up leaves no dot");
        assert!(!d.on);
        d.window_hidden();
        assert!(d.ping(Ping::AgentFinished));
        assert!(d.on);
        assert!(!d.ping(Ping::Bell), "a second ping changes nothing");
        d.window_shown();
        assert!(!d.on);
        d.window_hidden();
        assert!(d.ping(Ping::Bell));
    }

    #[test]
    fn stat047_a_minimised_window_takes_the_dot_and_restoring_clears_it() {
        let mut d = Dot::default();
        d.window_minimised();
        assert!(d.ping(Ping::AgentFinished) && d.on);
        d.window_shown();
        assert!(!d.on);
        assert!(!d.ping(Ping::AgentFinished), "visible again: a finish leaves no dot");
    }

    #[test]
    fn stat047_dev_copies_keep_their_marker_on_the_attention_icon_and_close_to_tray_is_off_by_default() {
        assert_eq!(icon(false, true), "tray-dot.png");
        assert_eq!(icon(true, false), "tray-dev.png");
        assert_eq!(icon(true, true), "tray-dev-dot.png");
        assert!(!close_to_tray(None) && !close_to_tray(Some(false)));
        assert!(close_to_tray(Some(true)), "a saved choice carries over");
    }
}
