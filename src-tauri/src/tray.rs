//! APP-008 / STAT-047: the tray icon. Its menu is Open Kolux and Quit; on Windows a left click
//! opens the window; an amber dot appears when a bell rang, an agent finished or a usage alert fired
//! while the window was hidden or minimised, and clears once the window is shown; development
//! copies carry DEV and the branch they run from in the icon and the tooltip, kept when the
//! attention icon is swapped in; Linux gets no tray icon.
//! The real icon needs tauri's `tray-icon` feature, switched on through this crate's `tray`
//! feature (Cargo.toml is the coordinator's file: `evidence/tray-T-248-b-Cargo.toml.patch`).
//! Without it `install` puts nothing in the tray and every model function still builds and tests.
#![allow(unexpected_cfgs)] // the `tray` feature is declared by that Cargo.toml patch
#![allow(dead_code)] // without it only the tests reach the model; `install` and `window_shown` wait on the lib.rs patch

use crate::menu::Os;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The tray icon's id, for the lookups that swap its icon.
pub const TRAY_ID: &str = "kolux";

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

impl Dot {
    pub fn window_hidden(&mut self) {
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

/// On Windows only a released left click opens the window; a right click, and any click
/// elsewhere, is the menu.
pub fn click_opens(os: Os, left: bool, released: bool) -> bool {
    left_click_opens(os) && left && released
}

/// APP-008: the branch a Git HEAD file names; a detached HEAD shows the short commit.
pub fn branch_from_head(head: &str) -> Option<String> {
    let head = head.trim();
    if head.is_empty() {
        return None;
    }
    match head.strip_prefix("ref: refs/heads/") {
        Some(b) => Some(b.trim().to_string()),
        None => Some(head.chars().take(7).collect()),
    }
}

/// Where a checkout keeps its HEAD: inside `.git` when that is a folder, or inside the folder a
/// `.git` file names (a worktree), read relative to the checkout.
pub fn git_head_file(checkout: &Path) -> Option<PathBuf> {
    let dot_git = checkout.join(".git");
    let dir = if dot_git.is_dir() {
        dot_git
    } else {
        let text = std::fs::read_to_string(&dot_git).ok()?;
        let target = text.lines().find_map(|l| l.strip_prefix("gitdir:")).map(str::trim)?;
        checkout.join(target)
    };
    let head = dir.join("HEAD");
    head.is_file().then_some(head)
}

/// A development copy runs from its source tree: the branch of the checkout that holds src-tauri.
fn dev_branch() -> Option<String> {
    if !tauri::is_dev() {
        return None;
    }
    let checkout = Path::new(env!("CARGO_MANIFEST_DIR")).parent()?;
    let head = git_head_file(checkout)?;
    branch_from_head(&std::fs::read_to_string(head).ok()?)
}

/// The attention dot's colour (amber) and the DEV marker's (blue), as RGBA.
pub const AMBER: [u8; 4] = [245, 166, 35, 255];
pub const DEV_MARK: [u8; 4] = [59, 130, 246, 255];
const RING: [u8; 4] = [24, 24, 24, 255];

/// The icon's pixels with, when asked, the amber dot in the bottom-right corner (a dark ring keeps
/// it visible on a light icon) and the DEV marker, a square in the top-left corner. Both fit any
/// icon size; a request for neither returns the pixels unchanged.
pub fn paint(rgba: &[u8], w: u32, h: u32, dot: bool, dev: bool) -> Vec<u8> {
    let mut out = rgba.to_vec();
    let (wi, hi) = (w as i64, h as i64);
    let mut set = |x: i64, y: i64, c: [u8; 4]| {
        if x >= 0 && y >= 0 && x < wi && y < hi {
            let i = ((y * wi + x) * 4) as usize;
            if i + 4 <= out.len() {
                out[i..i + 4].copy_from_slice(&c);
            }
        }
    };
    if dev {
        let side = (wi / 4).max(1);
        for y in 0..side {
            for x in 0..side {
                set(x, y, DEV_MARK);
            }
        }
    }
    if dot {
        let r = (wi / 4).max(1);
        let (cx, cy) = (wi - r - 1, hi - r - 1);
        for y in (cy - r - 1)..=(cy + r + 1) {
            for x in (cx - r - 1)..=(cx + r + 1) {
                let d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
                if d2 <= r * r {
                    set(x, y, AMBER);
                } else if d2 <= (r + 1) * (r + 1) {
                    set(x, y, RING);
                }
            }
        }
    }
    out
}

/// STAT-048: the taskbar badge. Windows has no badge count, so the count is painted onto an overlay
/// icon: an amber disc with the number in white, "99+" past the cap.
pub const BADGE_SIZE: u32 = 32;
pub const WHITE: [u8; 4] = [255, 255, 255, 255];
const BADGE_CAP: u32 = 99;

/// What the badge says for this many workspaces: nothing at zero, the number, or "99+".
pub fn badge_text(count: u32) -> Option<String> {
    match count {
        0 => None,
        n if n > BADGE_CAP => Some(format!("{BADGE_CAP}+")),
        n => Some(n.to_string()),
    }
}

/// A 3x5 pixel glyph for each character the badge can show, one row per byte (3 low bits).
fn glyph(c: char) -> [u8; 5] {
    match c {
        '0' => [0b111, 0b101, 0b101, 0b101, 0b111],
        '1' => [0b010, 0b110, 0b010, 0b010, 0b111],
        '2' => [0b111, 0b001, 0b111, 0b100, 0b111],
        '3' => [0b111, 0b001, 0b111, 0b001, 0b111],
        '4' => [0b101, 0b101, 0b111, 0b001, 0b001],
        '5' => [0b111, 0b100, 0b111, 0b001, 0b111],
        '6' => [0b111, 0b100, 0b111, 0b101, 0b111],
        '7' => [0b111, 0b001, 0b001, 0b001, 0b001],
        '8' => [0b111, 0b101, 0b111, 0b101, 0b111],
        '9' => [0b111, 0b101, 0b111, 0b001, 0b111],
        '+' => [0b000, 0b010, 0b111, 0b010, 0b000],
        _ => [0; 5],
    }
}

/// The overlay badge's pixels (RGBA, BADGE_SIZE square): an amber disc with `text` centred in white.
pub fn paint_badge(text: &str) -> (Vec<u8>, u32, u32) {
    let size = BADGE_SIZE as i64;
    let mut out = vec![0u8; (BADGE_SIZE * BADGE_SIZE * 4) as usize];
    let mut set = |x: i64, y: i64, c: [u8; 4]| {
        if x >= 0 && y >= 0 && x < size && y < size {
            let i = ((y * size + x) * 4) as usize;
            out[i..i + 4].copy_from_slice(&c);
        }
    };
    let (c, r) = (size / 2, size / 2 - 1);
    for y in 0..size {
        for x in 0..size {
            let (dx, dy) = (x - c, y - c);
            if dx * dx + dy * dy <= r * r {
                set(x, y, AMBER);
            }
        }
    }
    let chars: Vec<char> = text.chars().take(3).collect();
    let scale = if chars.len() >= 3 { 2 } else { 3 };
    let gap = scale;
    let total_w = chars.len() as i64 * 3 * scale + (chars.len() as i64 - 1).max(0) * gap;
    let (x0, y0) = ((size - total_w) / 2, (size - 5 * scale) / 2);
    for (n, ch) in chars.iter().enumerate() {
        let gx = x0 + n as i64 * (3 * scale + gap);
        for (row, bits) in glyph(*ch).iter().enumerate() {
            for col in 0..3 {
                if bits & (0b100 >> col) != 0 {
                    for sy in 0..scale {
                        for sx in 0..scale {
                            set(gx + col * scale + sx, y0 + row as i64 * scale + sy, WHITE);
                        }
                    }
                }
            }
        }
    }
    (out, BADGE_SIZE, BADGE_SIZE)
}

/// The tray's state, shared by the pings and the window events.
#[derive(Default)]
pub struct TrayState {
    dot: Mutex<Dot>,
}

/// Puts Kolux's icon in the tray on Windows and macOS. Nothing happens on Linux, or in a build
/// without the `tray` feature. Called from the app's setup (lib.rs, the coordinator's file:
/// `evidence/tray-T-248-b-lib.rs.patch`).
pub fn install(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::Manager;
    app.manage(TrayState::default());
    #[cfg(feature = "tray")]
    if has_tray(Os::current()) {
        real::install(app)?;
    }
    Ok(())
}

/// Is the main window out of sight: hidden, or minimised to the taskbar?
fn window_hidden(app: &tauri::AppHandle) -> bool {
    use tauri::Manager;
    app.get_webview_window("main").map(|w| !w.is_visible().unwrap_or(true) || w.is_minimized().unwrap_or(false)).unwrap_or(true)
}

/// A bell, a finished agent or a usage alert: the dot lights only while the window is out of sight.
pub fn ping(app: &tauri::AppHandle, what: Ping) {
    use tauri::Manager;
    let Some(state) = app.try_state::<TrayState>() else { return };
    let hidden = window_hidden(app);
    let changed = state.dot.lock().map(|mut d| {
        if hidden {
            d.window_hidden();
        } else {
            d.window_shown();
        }
        d.ping(what)
    });
    if matches!(changed, Ok(true)) {
        refresh(app, true);
    }
}

/// The window came back (shown, restored or focused): the dot clears. Called when the main window
/// gains focus (the same lib.rs patch).
pub fn window_shown(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(state) = app.try_state::<TrayState>() else { return };
    let was_on = state.dot.lock().map(|mut d| {
        let was = d.on;
        d.window_shown();
        was
    });
    if matches!(was_on, Ok(true)) {
        refresh(app, false);
    }
}

/// Open Kolux from the tray: the main window is shown, restored and focused, and the dot clears.
pub fn open_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    window_shown(app);
}

/// Quit from the tray: the app's ordinary exit, whose Exit step stops every pane and child process
/// (the same path as File > Exit), never the close button's path.
pub fn quit(app: &tauri::AppHandle) {
    app.exit(0);
}

#[cfg(feature = "tray")]
fn refresh(app: &tauri::AppHandle, dot: bool) {
    real::set_icon(app, dot);
}
#[cfg(not(feature = "tray"))]
fn refresh(_app: &tauri::AppHandle, _dot: bool) {}

#[cfg(feature = "tray")]
mod real {
    use super::*;
    use tauri::image::Image;
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    pub fn install(app: &tauri::AppHandle) -> tauri::Result<()> {
        let [(open_id, open), (quit_id, quit_label)] = items();
        let open_item = MenuItem::with_id(app, open_id, open, true, None::<&str>)?;
        let quit_item = MenuItem::with_id(app, quit_id, quit_label, true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&open_item, &quit_item])?;
        let os = Os::current();
        let mut tray = TrayIconBuilder::with_id(TRAY_ID)
            .menu(&menu)
            .tooltip(tooltip(tauri::is_dev(), dev_branch().as_deref()))
            .show_menu_on_left_click(!left_click_opens(os))
            .on_menu_event(|app, e| match e.id().as_ref() {
                OPEN_ID => open_window(app),
                QUIT_ID => quit(app),
                _ => {}
            })
            .on_tray_icon_event(move |tray, e| {
                if let TrayIconEvent::Click { button, button_state, .. } = e {
                    if click_opens(os, button == MouseButton::Left, button_state == MouseButtonState::Up) {
                        open_window(tray.app_handle());
                    }
                }
            });
        if let Some(icon) = icon(app, false) {
            tray = tray.icon(icon);
        }
        tray.build(app)?;
        Ok(())
    }

    /// The app icon with the DEV marker on a development copy and, when asked, the dot.
    fn icon(app: &tauri::AppHandle, dot: bool) -> Option<Image<'static>> {
        let base = app.default_window_icon()?;
        let (w, h) = (base.width(), base.height());
        Some(Image::new_owned(paint(base.rgba(), w, h, dot, tauri::is_dev()), w, h))
    }

    pub fn set_icon(app: &tauri::AppHandle, dot: bool) {
        if let (Some(tray), Some(img)) = (app.tray_by_id(TRAY_ID), icon(app, dot)) {
            let _ = tray.set_icon(Some(img));
        }
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
    fn app_008_a_dev_copy_reads_its_branch_from_the_checkouts_git_head() {
        assert_eq!(branch_from_head("ref: refs/heads/lane/tray\n"), Some("lane/tray".into()));
        assert_eq!(branch_from_head("ref: refs/heads/main"), Some("main".into()));
        // a detached checkout shows the short commit
        assert_eq!(branch_from_head("0123456789abcdef0123456789abcdef01234567\n"), Some("0123456".into()));
        assert_eq!(branch_from_head(""), None);
        assert_eq!(branch_from_head("   "), None);
        let dir = std::env::temp_dir().join(format!("kolux-app008-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        // a plain checkout keeps HEAD inside its .git folder
        let plain = dir.join("plain");
        std::fs::create_dir_all(plain.join(".git")).unwrap();
        std::fs::write(plain.join(".git").join("HEAD"), "ref: refs/heads/main\n").unwrap();
        assert_eq!(git_head_file(&plain), Some(plain.join(".git").join("HEAD")));
        // a worktree's .git is a file pointing at the main repo's worktree folder
        let wt = dir.join("wt");
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::create_dir_all(dir.join("repo").join(".git").join("worktrees").join("wt")).unwrap();
        std::fs::write(dir.join("repo").join(".git").join("worktrees").join("wt").join("HEAD"), "ref: refs/heads/lane/tray\n").unwrap();
        std::fs::write(wt.join(".git"), "gitdir: ../repo/.git/worktrees/wt\n").unwrap();
        let head = git_head_file(&wt).expect("a worktree's HEAD is found through its .git file");
        assert_eq!(std::fs::read_to_string(&head).map(|h| branch_from_head(&h)).unwrap(), Some("lane/tray".into()));
        // no Git at all: no branch
        let none = dir.join("none");
        std::fs::create_dir_all(&none).unwrap();
        assert_eq!(git_head_file(&none), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn app_008_the_icon_gets_an_amber_dot_and_a_dev_marker_only_when_asked() {
        let (w, h) = (32u32, 32u32);
        let base = vec![0u8; (w * h * 4) as usize];
        let px = |img: &[u8], x: u32, y: u32| -> [u8; 4] {
            let i = ((y * w + x) * 4) as usize;
            [img[i], img[i + 1], img[i + 2], img[i + 3]]
        };
        assert_eq!(paint(&base, w, h, false, false), base, "nothing asked: the icon is untouched");
        let dot = paint(&base, w, h, true, false);
        assert_eq!(dot.len(), base.len());
        assert_eq!(px(&dot, 27, 27), AMBER, "the dot sits in the bottom-right corner");
        assert_eq!(px(&dot, 0, 0), [0, 0, 0, 0], "the top-left corner is untouched by the dot");
        assert_eq!(px(&dot, 16, 16), [0, 0, 0, 0], "the middle of the icon is untouched");
        let dev = paint(&base, w, h, false, true);
        assert_eq!(px(&dev, 2, 2), DEV_MARK, "the DEV marker sits in the top-left corner");
        assert_eq!(px(&dev, 27, 27), [0, 0, 0, 0], "no dot without a ping");
        let both = paint(&base, w, h, true, true);
        assert_eq!(px(&both, 2, 2), DEV_MARK, "the DEV marker stays when the attention icon is swapped in");
        assert_eq!(px(&both, 27, 27), AMBER);
        // a tiny icon still paints without going out of bounds
        let tiny = paint(&[0u8; 16], 2, 2, true, true);
        assert_eq!(tiny.len(), 16);
    }

    #[test]
    fn app_008_only_a_released_left_click_on_windows_opens_the_window() {
        assert!(click_opens(Os::Windows, true, true));
        assert!(!click_opens(Os::Windows, true, false), "the press alone does nothing; the release opens");
        assert!(!click_opens(Os::Windows, false, true), "a right click is the menu");
        assert!(!click_opens(Os::Mac, true, true), "on macOS a click opens the menu");
        assert!(!click_opens(Os::Linux, true, true));
    }

    #[test]
    fn stat048_the_badge_text_caps_large_counts_and_zero_clears() {
        assert_eq!(badge_text(0), None);
        assert_eq!(badge_text(1), Some("1".into()));
        assert_eq!(badge_text(42), Some("42".into()));
        assert_eq!(badge_text(99), Some("99".into()));
        assert_eq!(badge_text(100), Some("99+".into()));
        assert_eq!(badge_text(u32::MAX), Some("99+".into()));
    }

    #[test]
    fn stat048_the_overlay_badge_is_an_amber_disc_with_the_count_in_white() {
        let (px, w, h) = paint_badge("2");
        assert_eq!((w, h), (BADGE_SIZE, BADGE_SIZE));
        assert_eq!(px.len(), (w * h * 4) as usize);
        let at = |img: &[u8], x: u32, y: u32| -> [u8; 4] {
            let i = ((y * w + x) * 4) as usize;
            [img[i], img[i + 1], img[i + 2], img[i + 3]]
        };
        assert_eq!(at(&px, 0, 0), [0, 0, 0, 0], "the corners stay clear: it is a disc");
        assert_eq!(at(&px, w - 1, h - 1), [0, 0, 0, 0]);
        assert_eq!(at(&px, 2, h / 2), AMBER, "the disc's edge is amber");
        assert!(px.chunks(4).any(|p| p == WHITE), "the digit is drawn in white");
        assert_ne!(paint_badge("1").0, paint_badge("2").0, "different counts look different");
        let (three, ..) = paint_badge("99+");
        assert!(three.chunks(4).any(|p| p == WHITE), "three glyphs still fit the disc");
        assert_eq!(three.len(), px.len());
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
}
