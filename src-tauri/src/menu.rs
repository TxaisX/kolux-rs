//! APP-009 / T-248-a: the native menu bar (File, Edit, View, Window, Help; the app menu in place of
//! File on macOS). The page owns the truth: every time the screen, the chrome switches or a shortcut
//! change, it sends `menu_sync` the state it shows and the menu is rebuilt from it, so the ticks and
//! the accelerators always agree with Settings (SET-020, SET-009). On Windows and Linux the menu
//! opens from the Kolux mark (`menu_popup`); on macOS it is the app menu bar. A click on an item either acts
//! here (reload, developer tools, full screen, minimise, maximise, exit) or comes back
//! to the page as a `menu-action` event carrying the item id, which is the keymap action id where
//! one exists (`app.settings`, `sidebar.left.toggle`, ...), so the page runs the same code as the
//! shortcut. T-248-b: APP-010 sidebar footer, APP-013 focus routing, APP-015 navigation guard.
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// The page event a menu click becomes when the page, not this file, carries it out.
pub const EVENT: &str = "menu-action";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Os {
    Windows,
    Mac,
    Linux,
}

impl Os {
    pub fn current() -> Os {
        if cfg!(target_os = "macos") {
            Os::Mac
        } else if cfg!(target_os = "windows") {
            Os::Windows
        } else {
            Os::Linux
        }
    }
}

/// What the page shows right now; the menu is a picture of it.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MenuState {
    /// "agents", "board", "terminals" (others leave every screen unticked).
    pub screen: String,
    pub status_bar_visible: bool,
    pub tasks_button: bool,
    pub automations_button: bool,
    pub title_bar_app_name: bool,
    /// The Classic look has no screen switcher, so View drops Workspace View (T-049-b).
    pub classic: bool,
    /// Menu item id -> accelerator text in the menu's own spelling ("CmdOrCtrl+Comma").
    pub accelerators: HashMap<String, String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stock {
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Minimize,
    Maximize,
    About,
    Services,
    Hide,
    HideOthers,
    ShowAll,
    Quit,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Node {
    Item { id: &'static str, label: &'static str, accel: Option<String> },
    Check { id: &'static str, label: &'static str, checked: bool, accel: Option<String> },
    Stock(Stock),
    Sep,
    Sub { label: &'static str, items: Vec<Node> },
}

/// The three switcher screens the View menu picks between (T-054).
pub const SCREENS: [(&str, &str, &str); 3] = [("screen.agents", "Agents", "agents"), ("screen.board", "Board", "board"), ("screen.terminals", "Terminals", "terminals")];

/// The whole menu bar for one platform and one page state.
pub fn spec(os: Os, s: &MenuState) -> Vec<Node> {
    let acc = |id: &str| s.accelerators.get(id).filter(|a| !a.is_empty()).cloned();
    let item = |id: &'static str, label: &'static str| Node::Item { id, label, accel: acc(id) };
    let check = |id: &'static str, label: &'static str, checked: bool| Node::Check { id, label, checked, accel: acc(id) };
    let mut bar = Vec::new();
    if os == Os::Mac {
        bar.push(Node::Sub {
            label: "Kolux",
            items: vec![
                Node::Stock(Stock::About),
                Node::Sep,
                item("app.settings", "Settings..."),
                Node::Sep,
                Node::Stock(Stock::Services),
                Node::Sep,
                Node::Stock(Stock::Hide),
                Node::Stock(Stock::HideOthers),
                Node::Stock(Stock::ShowAll),
                Node::Sep,
                Node::Stock(Stock::Quit),
            ],
        });
    } else {
        bar.push(Node::Sub { label: "File", items: vec![item("app.settings", "Settings..."), Node::Sep, item("file.exit", "Exit")] });
    }
    // Windows' stock Edit items replay Ctrl+key into whatever has focus, so in a terminal Copy with
    // no selection would send Ctrl+C to the agent. There the page carries out edit.* with its
    // terminal-aware copy, paste and select-all; macOS keeps the stock items.
    let edit = if os == Os::Mac {
        vec![Node::Stock(Stock::Undo), Node::Stock(Stock::Redo), Node::Sep, Node::Stock(Stock::Cut), Node::Stock(Stock::Copy), Node::Stock(Stock::Paste), Node::Stock(Stock::SelectAll)]
    } else {
        vec![item("edit.undo", "Undo"), item("edit.redo", "Redo"), Node::Sep, item("edit.cut", "Cut"), item("edit.copy", "Copy"), item("edit.paste", "Paste"), item("edit.selectAll", "Select All")]
    };
    bar.push(Node::Sub { label: "Edit", items: edit });
    let screens = SCREENS.iter().map(|(id, label, screen)| check(id, label, s.screen == *screen)).collect();
    bar.push(Node::Sub {
        label: "View",
        items: [if s.classic { vec![] } else { vec![Node::Sub { label: "Workspace View", items: screens }] }, vec![Node::Sub {
                label: "Appearance",
                items: vec![
                    item("sidebar.left.toggle", "Toggle Left Sidebar"),
                    item("sidebar.right.toggle", "Toggle Right Sidebar"),
                    Node::Sep,
                    check("set.statusBarVisible", "Show Status Bar", s.status_bar_visible),
                    check("set.tasksButton", "Show Tasks Button", s.tasks_button),
                    check("set.automationsButton", "Show Automations Button", s.automations_button),
                    check("set.titleBarAppName", "Show Titlebar App Name", s.title_bar_app_name),
                ],
            }],
            vec![Node::Sep,
            item("view.reload", "Reload"),
            item("app.forceReload", "Force Reload"),
            item("view.devtools", "Toggle Developer Tools"),
            Node::Sep,
            item("zoom.reset", "Actual Size"),
            item("zoom.in", "Zoom In"),
            item("zoom.out", "Zoom Out"),
            Node::Sep,
            item("view.fullscreen", "Toggle Full Screen")],
        ]
        .concat(),
    });
    bar.push(Node::Sub { label: "Window", items: vec![Node::Stock(Stock::Minimize), Node::Stock(Stock::Maximize)] });
    // Report Crash, Explore Kolux, Getting Started and Check for Updates come with T-248-b.
    if os != Os::Mac {
        bar.push(Node::Sub { label: "Help", items: vec![Node::Stock(Stock::About)] });
    }
    bar
}

/// Where a click goes: carried out here, or handed to the page.
#[derive(Clone, Debug, PartialEq)]
pub enum Route {
    Reload,
    DevTools,
    FullScreen,
    Exit,
    Page(String),
}

/// zoom.* goes to the page, which keeps the one saved interface zoom (SET-019).
pub fn route(id: &str) -> Route {
    match id {
        "view.reload" | "app.forceReload" => Route::Reload,
        "view.devtools" => Route::DevTools,
        "view.fullscreen" => Route::FullScreen,
        "file.exit" => Route::Exit,
        other => Route::Page(other.to_string()),
    }
}

/// Every accelerator the menu holds, so the Shortcuts page can count a chord that collides with
/// one as a clash (SET-010; the page side is T-248-b).
pub fn accelerators(nodes: &[Node]) -> Vec<String> {
    let mut out = Vec::new();
    for n in nodes {
        match n {
            Node::Item { accel: Some(a), .. } | Node::Check { accel: Some(a), .. } => out.push(a.clone()),
            Node::Sub { items, .. } => out.extend(accelerators(items)),
            _ => {}
        }
    }
    out
}

fn last() -> &'static Mutex<Option<MenuState>> {
    static LAST: OnceLock<Mutex<Option<MenuState>>> = OnceLock::new();
    LAST.get_or_init(|| Mutex::new(None))
}

/// The window the menu was last opened in; clicks go back to it.
fn popped() -> &'static Mutex<String> {
    static POPPED: OnceLock<Mutex<String>> = OnceLock::new();
    POPPED.get_or_init(|| Mutex::new("main".into()))
}

/// Windows and Linux draw no native menu bar on Kolux's frameless window (the bar is attached but
/// never painted, and its accelerators would catch keys such as Ctrl+C before a terminal sees
/// them), so there the menu opens from the Kolux mark in the title bar and the page keeps every
/// shortcut. macOS keeps its always-present app menu bar.
pub fn attaches_bar(os: Os) -> bool {
    os == Os::Mac
}

use tauri::menu::{AboutMetadata, CheckMenuItemBuilder, IsMenuItem, Menu, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{Emitter, Manager, Runtime, WebviewWindow};

enum Built<R: Runtime> {
    Normal(tauri::menu::MenuItem<R>),
    Check(tauri::menu::CheckMenuItem<R>),
    Pre(PredefinedMenuItem<R>),
    Sub(Submenu<R>),
}

impl<R: Runtime> Built<R> {
    fn as_item(&self) -> &dyn IsMenuItem<R> {
        match self {
            Built::Normal(i) => i,
            Built::Check(i) => i,
            Built::Pre(i) => i,
            Built::Sub(i) => i,
        }
    }
}

fn build_node<R: Runtime, M: Manager<R>>(app: &M, n: &Node) -> tauri::Result<Built<R>> {
    Ok(match n {
        Node::Item { id, label, accel } => {
            let b = MenuItemBuilder::with_id(*id, *label);
            Built::Normal(match accel { Some(a) => b.accelerator(a), None => b }.build(app)?)
        }
        Node::Check { id, label, checked, accel } => {
            let b = CheckMenuItemBuilder::with_id(*id, *label).checked(*checked);
            Built::Check(match accel { Some(a) => b.accelerator(a), None => b }.build(app)?)
        }
        Node::Sep => Built::Pre(PredefinedMenuItem::separator(app)?),
        Node::Stock(s) => Built::Pre(match s {
            Stock::Undo => PredefinedMenuItem::undo(app, None)?,
            Stock::Redo => PredefinedMenuItem::redo(app, None)?,
            Stock::Cut => PredefinedMenuItem::cut(app, None)?,
            Stock::Copy => PredefinedMenuItem::copy(app, None)?,
            Stock::Paste => PredefinedMenuItem::paste(app, None)?,
            Stock::SelectAll => PredefinedMenuItem::select_all(app, None)?,
            Stock::Minimize => PredefinedMenuItem::minimize(app, None)?,
            Stock::Maximize => PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            Stock::About => {
                let info = app.package_info();
                let meta = AboutMetadata { name: Some("Kolux".into()), version: Some(info.version.to_string()), ..Default::default() };
                PredefinedMenuItem::about(app, Some("About Kolux"), Some(meta))?
            }
            Stock::Services => PredefinedMenuItem::services(app, None)?,
            Stock::Hide => PredefinedMenuItem::hide(app, None)?,
            Stock::HideOthers => PredefinedMenuItem::hide_others(app, None)?,
            Stock::ShowAll => PredefinedMenuItem::show_all(app, None)?,
            Stock::Quit => PredefinedMenuItem::quit(app, None)?,
        }),
        Node::Sub { label, items } => {
            let built = items.iter().map(|i| build_node(app, i)).collect::<tauri::Result<Vec<_>>>()?;
            let refs: Vec<&dyn IsMenuItem<R>> = built.iter().map(|b| b.as_item()).collect();
            Built::Sub(SubmenuBuilder::new(app, *label).items(&refs).build()?)
        }
    })
}

fn build_menu<R: Runtime, M: Manager<R>>(app: &M, nodes: &[Node]) -> tauri::Result<Menu<R>> {
    let built = nodes.iter().map(|n| build_node(app, n)).collect::<tauri::Result<Vec<_>>>()?;
    let refs: Vec<&dyn IsMenuItem<R>> = built.iter().map(|b| b.as_item()).collect();
    Menu::with_items(app, &refs)
}

fn on_click<R: Runtime>(app: &tauri::AppHandle<R>, id: &str) {
    let label = popped().lock().unwrap_or_else(|e| e.into_inner()).clone();
    let Some(view) = app.get_webview_window(&label) else { return };
    match route(id) {
        Route::Reload => drop(view.reload()),
        Route::DevTools => {
            #[cfg(debug_assertions)]
            if view.is_devtools_open() {
                view.close_devtools();
            } else {
                view.open_devtools();
            }
        }
        Route::FullScreen => drop(view.set_fullscreen(!view.is_fullscreen().unwrap_or(false))),
        // The same path as the window's close button, so quitting stops every pane (ACCT-051).
        Route::Exit => drop(view.close()),
        Route::Page(id) => drop(view.emit_to(view.label(), EVENT, serde_json::json!({ "id": id }))),
    }
}

fn listen_once<R: Runtime>(app: &tauri::AppHandle<R>) {
    static ON: OnceLock<()> = OnceLock::new();
    if ON.set(()).is_ok() {
        app.on_menu_event(|app, e| on_click(app, e.id().as_ref()));
    }
}

/// The page's menu state changed: keep it for the next time the menu opens (and on macOS rebuild
/// the app menu bar when it differs from the last one). Returns every accelerator the menu holds.
#[tauri::command]
pub fn menu_sync<R: Runtime>(window: WebviewWindow<R>, state: MenuState) -> Result<Vec<String>, String> {
    let os = Os::current();
    let nodes = spec(os, &state);
    let accels = accelerators(&nodes);
    let mut last = last().lock().unwrap_or_else(|e| e.into_inner());
    if last.as_ref() == Some(&state) {
        return Ok(accels);
    }
    listen_once(window.app_handle());
    if attaches_bar(os) {
        let menu = build_menu(&window, &nodes).map_err(|e| e.to_string())?;
        window.app_handle().set_menu(menu).map_err(|e| e.to_string())?;
    }
    *last = Some(state);
    Ok(accels)
}

/// Opens the whole menu (File, Edit, View, Window, Help) under the Kolux mark at (x, y), in the
/// window's own logical pixels. Its items show the in-app shortcuts as hints.
#[tauri::command]
pub fn menu_popup<R: Runtime>(window: WebviewWindow<R>, x: f64, y: f64) -> Result<(), String> {
    let state = last().lock().unwrap_or_else(|e| e.into_inner()).clone().unwrap_or_default();
    let menu = build_menu(&window, &spec(Os::current(), &state)).map_err(|e| e.to_string())?;
    listen_once(window.app_handle());
    *popped().lock().unwrap_or_else(|e| e.into_inner()) = window.label().to_string();
    window.popup_menu_at(&menu, tauri::LogicalPosition::new(x, y)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(nodes: &[Node]) -> Vec<&'static str> {
        nodes.iter().filter_map(|n| if let Node::Sub { label, .. } = n { Some(*label) } else { None }).collect()
    }
    fn sub<'a>(nodes: &'a [Node], label: &str) -> &'a [Node] {
        nodes.iter().find_map(|n| match n { Node::Sub { label: l, items } if *l == label => Some(items.as_slice()), _ => None }).unwrap_or_else(|| panic!("no {label} menu"))
    }
    fn ids(nodes: &[Node]) -> Vec<&'static str> {
        nodes.iter().filter_map(|n| match n { Node::Item { id, .. } | Node::Check { id, .. } => Some(*id), _ => None }).collect()
    }
    fn ticked(nodes: &[Node]) -> Vec<&'static str> {
        nodes.iter().filter_map(|n| match n { Node::Check { id, checked: true, .. } => Some(*id), _ => None }).collect()
    }
    fn state(screen: &str) -> MenuState {
        MenuState { screen: screen.into(), status_bar_visible: true, tasks_button: true, automations_button: false, title_bar_app_name: false, classic: false, accelerators: HashMap::new() }
    }

    #[test]
    fn app_009_windows_has_file_edit_view_window_help_and_help_holds_about_until_t248b() {
        let bar = spec(Os::Windows, &state("terminals"));
        assert_eq!(labels(&bar), ["File", "Edit", "View", "Window", "Help"]);
        assert_eq!(ids(sub(&bar, "File")), ["app.settings", "file.exit"]);
        assert_eq!(sub(&bar, "Help"), [Node::Stock(Stock::About)]);
        assert_eq!(sub(&bar, "Window"), [Node::Stock(Stock::Minimize), Node::Stock(Stock::Maximize)]);
        // Linux gets the same bar as Windows.
        assert_eq!(spec(Os::Linux, &state("terminals")), bar);
    }

    #[test]
    fn app_009_macos_app_menu_replaces_file_and_runs_hide_hide_others_show_all_in_order() {
        let bar = spec(Os::Mac, &state("terminals"));
        assert_eq!(labels(&bar), ["Kolux", "Edit", "View", "Window"]);
        let app = sub(&bar, "Kolux");
        assert_eq!(ids(app), ["app.settings"]);
        let stock: Vec<Stock> = app.iter().filter_map(|n| if let Node::Stock(s) = n { Some(*s) } else { None }).collect();
        assert_eq!(stock, [Stock::About, Stock::Services, Stock::Hide, Stock::HideOthers, Stock::ShowAll, Stock::Quit]);
    }

    #[test]
    fn app_009_macos_edit_is_stock_and_windows_linux_edit_goes_to_the_page_never_as_a_key_press() {
        let edit: Vec<Stock> = sub(&spec(Os::Mac, &state("agents")), "Edit").iter().filter_map(|n| if let Node::Stock(s) = n { Some(*s) } else { None }).collect();
        assert_eq!(edit, [Stock::Undo, Stock::Redo, Stock::Cut, Stock::Copy, Stock::Paste, Stock::SelectAll]);
        for os in [Os::Windows, Os::Linux] {
            let bar = spec(os, &state("agents"));
            let edit = sub(&bar, "Edit");
            assert!(!edit.iter().any(|n| matches!(n, Node::Stock(_))), "{os:?} must not replay Ctrl+key");
            assert_eq!(ids(edit), ["edit.undo", "edit.redo", "edit.cut", "edit.copy", "edit.paste", "edit.selectAll"]);
            for id in ids(edit) {
                assert_eq!(route(id), Route::Page(id.into()));
            }
        }
    }

    #[test]
    fn t049b_classic_drops_workspace_view_and_switching_the_look_rebuilds_the_menu() {
        let mut s = state("terminals");
        let new_look = spec(Os::Windows, &s);
        s.classic = true;
        let classic = spec(Os::Windows, &s);
        assert_ne!(classic, new_look);
        assert_eq!(labels(sub(&classic, "View")), ["Appearance"]);
        assert_eq!(labels(sub(&new_look, "View")), ["Workspace View", "Appearance"]);
    }

    #[test]
    fn t054_view_menu_ticks_exactly_the_current_screen_and_none_for_other_screens() {
        for (screen, want) in [("agents", vec!["screen.agents"]), ("board", vec!["screen.board"]), ("terminals", vec!["screen.terminals"]), ("tower", vec![])] {
            let bar = spec(Os::Windows, &state(screen));
            let views = sub(sub(&bar, "View"), "Workspace View");
            assert_eq!(ids(views), ["screen.agents", "screen.board", "screen.terminals"]);
            assert_eq!(ticked(views), want, "screen {screen}");
        }
    }

    #[test]
    fn set_020_appearance_ticks_agree_with_each_settings_switch() {
        let mut s = state("terminals");
        let bar = spec(Os::Windows, &s);
        let look = sub(sub(&bar, "View"), "Appearance");
        assert_eq!(ids(look), ["sidebar.left.toggle", "sidebar.right.toggle", "set.statusBarVisible", "set.tasksButton", "set.automationsButton", "set.titleBarAppName"]);
        assert_eq!(ticked(look), ["set.statusBarVisible", "set.tasksButton"]);
        // Flipping the Automations button and hiding the status bar rebuild a different menu.
        s.automations_button = true;
        s.status_bar_visible = false;
        let again = spec(Os::Windows, &s);
        assert_ne!(again, bar);
        assert_eq!(ticked(sub(sub(&again, "View"), "Appearance")), ["set.tasksButton", "set.automationsButton"]);
    }

    #[test]
    fn set_009_a_changed_shortcut_shows_as_the_new_accelerator_and_an_empty_one_shows_none() {
        let mut s = state("terminals");
        s.accelerators.insert("app.settings".into(), "CmdOrCtrl+Comma".into());
        s.accelerators.insert("zoom.in".into(), "CmdOrCtrl+=".into());
        let file = spec(Os::Windows, &s);
        assert_eq!(sub(&file, "File")[0], Node::Item { id: "app.settings", label: "Settings...", accel: Some("CmdOrCtrl+Comma".into()) });
        s.accelerators.insert("app.settings".into(), "CmdOrCtrl+Shift+P".into());
        s.accelerators.insert("zoom.in".into(), String::new());
        let bar = spec(Os::Windows, &s);
        assert_eq!(sub(&bar, "File")[0], Node::Item { id: "app.settings", label: "Settings...", accel: Some("CmdOrCtrl+Shift+P".into()) });
        assert_eq!(accelerators(&bar), ["CmdOrCtrl+Shift+P"]);
    }

    #[test]
    fn set_019_menu_zoom_goes_to_the_page_so_the_saved_interface_zoom_stays_the_only_one() {
        for id in ["zoom.in", "zoom.out", "zoom.reset"] {
            assert_eq!(route(id), Route::Page(id.into()));
        }
    }

    #[test]
    fn app_009_native_items_act_here_and_the_rest_go_to_the_page_by_keymap_id() {
        assert_eq!(route("view.reload"), Route::Reload);
        assert_eq!(route("app.forceReload"), Route::Reload);
        assert_eq!(route("view.devtools"), Route::DevTools);
        assert_eq!(route("view.fullscreen"), Route::FullScreen);
        assert_eq!(route("file.exit"), Route::Exit);
        for id in ["app.settings", "screen.board", "sidebar.left.toggle", "set.tasksButton", "help.checkUpdates", "help.reportCrash"] {
            assert_eq!(route(id), Route::Page(id.into()));
        }
    }

    #[test]
    fn app_009_only_macos_attaches_a_native_bar_the_frameless_window_opens_it_from_the_mark() {
        assert!(attaches_bar(Os::Mac));
        assert!(!attaches_bar(Os::Windows) && !attaches_bar(Os::Linux));
    }

    #[test]
    fn menu_state_reads_the_pages_camel_case_and_tolerates_missing_fields() {
        let s: MenuState = serde_json::from_value(serde_json::json!({ "screen": "board", "statusBarVisible": true, "accelerators": { "app.settings": "CmdOrCtrl+Comma" } })).unwrap();
        assert_eq!(s.screen, "board");
        assert!(s.status_bar_visible && !s.tasks_button);
        assert_eq!(s.accelerators["app.settings"], "CmdOrCtrl+Comma");
    }
}
