// Browser tabs (BROW-001, BROW-002): every tab is a child web view of the main window. The
// front end says where the pane's body is and whether it is on screen; the page is laid over
// that spot and hidden, never torn down, while its tab or screen is away, so scroll position,
// form fields, sign-in and history all survive. Pages get no Tauri capability (the capability
// names the main web view only), so a site can never reach the app's commands. T-500: Tauri still
// hands every app command to a page whose origin it counts as its own (a `*.localhost` host, the
// dev server), so a tab may only ever open http, https or the blank page, never such a host, by
// the address bar or by any navigation the page makes (`evidence/T-500-isolation.txt`). Tauri's
// IPC objects stay in the page (it defines them first, non-configurable); its origin check is
// what refuses them, and this gate is what keeps a tab off every origin that check trusts.
use serde::{Deserialize, Serialize};
use tauri::webview::{Color, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewUrl};

pub const LOAD_EVENT: &str = "browser-load";
pub const TITLE_EVENT: &str = "browser-title";
pub const CHORD_EVENT: &str = "browser-chord";

/// The scheme the page's script navigates to for a browser chord (`kolux-chord:back`). The
/// navigation handler turns it into `CHORD_EVENT` and cancels it, so it never reaches the
/// network or the operating system, and a page that has no script of ours sees nothing.
const CHORD_SCHEME: &str = "kolux-chord:";

/// Runs in every page's main frame before the page's own script (BROW-003, BROW-005): the
/// browser chords pressed while the keyboard is inside the page, Mod+L, Alt+Left / Alt+Right
/// (Mod+[ / Mod+] on a Mac), Mod+R and the mouse's back and forward buttons, are taken away
/// from the web view, which would otherwise go back on its own and leave the toolbar's history
/// behind, and handed to the app as a chord navigation. T-012-b-fix.
pub const CHORD_SCRIPT: &str = r#"(() => {
  if (window !== window.top) return;
  const mac = navigator.platform.startsWith("Mac");
  const send = (what) => location.assign("kolux-chord:" + what);
  addEventListener("keydown", (e) => {
    const mod = mac ? e.metaKey : e.ctrlKey;
    const k = e.key.toLowerCase();
    let what = null;
    if (mod && !e.altKey && !e.shiftKey && k === "l") what = "focusAddressBar";
    else if (mod && !e.altKey && k === "r") what = "reload";
    else if (mac ? mod && k === "[" : e.altKey && !mod && e.key === "ArrowLeft") what = "back";
    else if (mac ? mod && k === "]" : e.altKey && !mod && e.key === "ArrowRight") what = "forward";
    if (!what) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    send(what);
  }, true);
  addEventListener("mouseup", (e) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    send(e.button === 3 ? "back" : "forward");
  }, true);
})();"#;

/// The chord a navigation carries, if it is one of ours and names a browser action.
pub fn chord_of(url: &str) -> Option<&str> {
    url.strip_prefix(CHORD_SCHEME).filter(|what| matches!(*what, "focusAddressBar" | "back" | "forward" | "reload"))
}

#[derive(Clone, Serialize)]
struct LoadPayload {
    id: u32,
    event: &'static str,
    url: String,
}

#[derive(Clone, Serialize)]
struct TitlePayload {
    id: u32,
    title: String,
}

#[derive(Clone, Serialize)]
struct ChordPayload {
    id: u32,
    what: String,
}

/// Where a pane body is, in CSS pixels from the window's top left.
#[derive(Clone, Copy, Deserialize)]
pub struct Spot {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// The web view label for a tab; the front end's pane key is the id.
pub fn label(id: u32) -> String {
    format!("browser-{id}")
}

/// A full address for the web view. What the user typed is resolved in the front end
/// (BROW-003); the back end only refuses what is not an address at all.
pub fn parse(url: &str) -> Result<Url, String> {
    Url::parse(url).map_err(|e| format!("invalid address: {e}"))
}

/// Whether a tab may go to `url` (T-500): http, https or the blank page only. A `*.localhost`
/// host is where the app itself (tauri.localhost), its IPC (ipc.localhost) and every custom scheme
/// (kolux-artifact.localhost) answer, and `app` is the app's own origin in a development build;
/// Tauri counts a page at any of those as its own and opens every app command to it, so a tab
/// never goes there. Plain `localhost` (a user's own dev server) is fine.
pub fn allowed(url: &Url, app: Option<&Url>) -> Result<(), String> {
    if url.as_str() == "about:blank" {
        return Ok(());
    }
    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!("{}: addresses do not open in a browser tab", url.scheme()));
    }
    let host = url.host_str().unwrap_or_default();
    if host.ends_with(".localhost") || app.is_some_and(|a| a.origin() == url.origin()) {
        return Err(format!("{host} is the app's own address and does not open in a browser tab"));
    }
    Ok(())
}

/// The app's own origin while it runs from the dev server; a release build serves itself from a
/// `*.localhost` host, which `allowed` refuses on its own.
fn app_origin(app: &AppHandle) -> Option<Url> {
    tauri::is_dev().then(|| app.config().build.dev_url.clone()).flatten()
}

fn view(app: &AppHandle, id: u32) -> Result<Webview, String> {
    app.get_webview(&label(id)).ok_or_else(|| format!("browser tab {id} is not open"))
}

fn err(e: tauri::Error) -> String {
    e.to_string()
}

/// Opens a tab's page over the given spot (CSS pixels, window-relative). Async on purpose:
/// creating a child web view from the main thread deadlocks on Windows. Creating the page moves
/// the keyboard off the app's web view (to the page, or with `focused(false)` to the bare window),
/// so it is handed back for the address bar (BROW-001).
#[tauri::command]
pub async fn browser_open(app: AppHandle, window: tauri::Window, webview: Webview, id: u32, url: String, spot: Spot, background: Option<[u8; 3]>) -> Result<(), String> {
    let url = parse(&url)?;
    let dev = app_origin(&app);
    allowed(&url, dev.as_ref())?;
    let load_app = app.clone();
    let chord_app = app.clone();
    let builder = WebviewBuilder::new(label(id), WebviewUrl::External(url))
        .focused(false)
        .initialization_script(CHORD_SCRIPT)
        .on_navigation(move |url| {
            let Some(what) = chord_of(url.as_str()) else {
                // T-500: a redirect, link or script cannot take the tab where the bar may not.
                return allowed(url, dev.as_ref()).is_ok();
            };
            if what == "focusAddressBar" {
                // The keyboard is inside the page; the bar lives in the app's own web view.
                if let Some(main) = chord_app.get_webview("main") {
                    let _ = main.set_focus();
                }
            }
            let _ = chord_app.emit(CHORD_EVENT, ChordPayload { id, what: what.to_string() });
            false
        })
        .on_page_load(move |_, payload| {
            let event = match payload.event() {
                PageLoadEvent::Started => "started",
                PageLoadEvent::Finished => "finished",
            };
            let _ = load_app.emit(LOAD_EVENT, LoadPayload { id, event, url: payload.url().to_string() });
        })
        .on_document_title_changed(move |_, title| {
            let _ = app.emit(TITLE_EVENT, TitlePayload { id, title });
        });
    // BROW-011: until the page paints, the web view shows the pane's colour, never a white flash.
    let builder = match surface(background) {
        Some(c) => builder.background_color(c),
        None => builder,
    };
    window.add_child(builder, LogicalPosition::new(spot.x, spot.y), LogicalSize::new(spot.w, spot.h)).map_err(err)?;
    webview.set_focus().map_err(err)
}

/// The loading surface for a pane colour (BROW-011): opaque, so the engine's white never shows
/// through before the page's own first paint.
pub fn surface(rgb: Option<[u8; 3]>) -> Option<Color> {
    rgb.map(|[r, g, b]| Color(r, g, b, 255))
}

/// Moves a tab's page to where its pane body is, or hides it while the tab is away (BROW-002).
/// `background` is the pane colour again when the app theme changed (BROW-011).
#[tauri::command]
pub async fn browser_bounds(app: AppHandle, id: u32, spot: Spot, shown: bool, background: Option<[u8; 3]>) -> Result<(), String> {
    let v = view(&app, id)?;
    if let Some(c) = surface(background) {
        v.set_background_color(Some(c)).map_err(err)?;
    }
    if !shown {
        return v.hide().map_err(err);
    }
    v.set_bounds(Rect { position: LogicalPosition::new(spot.x, spot.y).into(), size: LogicalSize::new(spot.w, spot.h).into() }).map_err(err)?;
    v.show().map_err(err)
}

#[tauri::command]
pub async fn browser_navigate(app: AppHandle, id: u32, url: String) -> Result<(), String> {
    let url = parse(&url)?;
    allowed(&url, app_origin(&app).as_ref())?;
    view(&app, id)?.navigate(url).map_err(err)
}

/// What the toolbar does to the page (BROW-005). wry offers reload only, so the rest runs as
/// page script; `None` is a request this tab does not know.
pub fn script(what: &str) -> Option<&'static str> {
    match what {
        "back" => Some("history.back()"),
        "forward" => Some("history.forward()"),
        "stop" => Some("window.stop()"),
        _ => None,
    }
}

#[tauri::command]
pub async fn browser_go(app: AppHandle, id: u32, what: String) -> Result<(), String> {
    let v = view(&app, id)?;
    if what == "reload" {
        return v.reload().map_err(err);
    }
    v.eval(script(&what).ok_or_else(|| format!("unknown browser action {what}"))?).map_err(err)
}

#[tauri::command]
pub async fn browser_close(app: AppHandle, id: u32) -> Result<(), String> {
    view(&app, id)?.close().map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brow001_tab_labels_and_addresses() {
        assert_eq!(label(7), "browser-7");
        assert_eq!(parse("about:blank").unwrap().as_str(), "about:blank");
        assert_eq!(parse("https://example.com").unwrap().host_str(), Some("example.com"));
        assert!(parse("not an address").unwrap_err().starts_with("invalid address"));
    }

    #[test]
    fn chords_pressed_inside_the_page_arrive_as_a_blocked_navigation() {
        // T-012-b-fix: the page's script navigates to `kolux-chord:<action>`; only the four
        // browser actions count, so a site cannot smuggle anything else through the channel.
        assert_eq!(chord_of("kolux-chord:focusAddressBar"), Some("focusAddressBar"));
        assert_eq!(chord_of("kolux-chord:back"), Some("back"));
        assert_eq!(chord_of("kolux-chord:forward"), Some("forward"));
        assert_eq!(chord_of("kolux-chord:reload"), Some("reload"));
        assert_eq!(chord_of("kolux-chord:close"), None);
        assert_eq!(chord_of("https://example.com/kolux-chord:back"), None);
        for needle in ["kolux-chord:", "ArrowLeft", "ArrowRight", "preventDefault", "window.top"] {
            assert!(CHORD_SCRIPT.contains(needle), "{needle}");
        }
    }

    #[test]
    fn t500_a_tab_never_opens_an_origin_tauri_counts_as_the_apps_own() {
        // evidence/T-500-isolation.txt: a page at the dev origin or at a custom-scheme host got
        // every app command; remote http, https and the blank page are what a tab is for.
        let dev = Url::parse("http://localhost:1420").unwrap();
        let ok = |u: &str| allowed(&Url::parse(u).unwrap(), Some(&dev));
        assert_eq!(ok("https://example.com/"), Ok(()));
        assert_eq!(ok("http://localhost:3000/app"), Ok(()));
        assert_eq!(ok("http://127.0.0.1:8745/probe.html"), Ok(()));
        assert_eq!(ok("about:blank"), Ok(()));
        assert!(ok("http://localhost:1420/kolux-probe").unwrap_err().contains("app's own address"));
        assert!(ok("http://kolux-artifact.localhost/x/index.html").unwrap_err().contains("app's own address"));
        assert!(ok("http://tauri.localhost/").unwrap_err().contains("app's own address"));
        assert!(ok("https://ipc.localhost/app_info").is_err());
        assert!(ok("file:///G:/Temp/browser-t195/probe.html").unwrap_err().starts_with("file: addresses do not open"));
        assert!(ok("tauri://localhost/").is_err());
        assert!(ok("javascript:alert(1)").is_err());
        // A release build has no dev origin; the *.localhost rule still holds.
        assert_eq!(allowed(&Url::parse("http://localhost:1420/").unwrap(), None), Ok(()));
        assert!(allowed(&Url::parse("http://tauri.localhost/").unwrap(), None).is_err());
    }

    #[test]
    fn brow011_the_loading_surface_is_the_pane_colour_and_opaque() {
        assert_eq!(surface(Some([13, 13, 13])), Some(Color(13, 13, 13, 255)));
        assert_eq!(surface(Some([250, 250, 249])), Some(Color(250, 250, 249, 255)));
        assert_eq!(surface(None), None);
    }

    #[test]
    fn brow005_toolbar_actions_run_as_page_script() {
        assert_eq!(script("back"), Some("history.back()"));
        assert_eq!(script("forward"), Some("history.forward()"));
        assert_eq!(script("stop"), Some("window.stop()"));
        assert_eq!(script("close"), None);
    }
}
