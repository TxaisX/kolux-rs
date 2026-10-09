// Browser tabs (BROW-001, BROW-002): every tab is a child web view of the main window. The
// front end says where the pane's body is and whether it is on screen; the page is laid over
// that spot and hidden, never torn down, while its tab or screen is away, so scroll position,
// form fields, sign-in and history all survive. Pages get no Tauri capability (the capability
// names the main web view only), so a site can never reach the app's commands.
use serde::{Deserialize, Serialize};
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewUrl};

pub const LOAD_EVENT: &str = "browser-load";
pub const TITLE_EVENT: &str = "browser-title";

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

fn view(app: &AppHandle, id: u32) -> Result<Webview, String> {
    app.get_webview(&label(id)).ok_or_else(|| format!("browser tab {id} is not open"))
}

fn err(e: tauri::Error) -> String {
    e.to_string()
}

/// Opens a tab's page over the given spot (CSS pixels, window-relative). Async on purpose:
/// creating a child web view from the main thread deadlocks on Windows. The new page takes the
/// keyboard as it is created; it goes back to the app's own web view so the address bar keeps it
/// (BROW-001).
#[tauri::command]
pub async fn browser_open(app: AppHandle, window: tauri::Window, webview: Webview, id: u32, url: String, spot: Spot) -> Result<(), String> {
    let url = parse(&url)?;
    let load_app = app.clone();
    let builder = WebviewBuilder::new(label(id), WebviewUrl::External(url))
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
    window.add_child(builder, LogicalPosition::new(spot.x, spot.y), LogicalSize::new(spot.w, spot.h)).map_err(err)?;
    webview.set_focus().map_err(err)
}

/// Moves a tab's page to where its pane body is, or hides it while the tab is away (BROW-002).
#[tauri::command]
pub async fn browser_bounds(app: AppHandle, id: u32, spot: Spot, shown: bool) -> Result<(), String> {
    let v = view(&app, id)?;
    if !shown {
        return v.hide().map_err(err);
    }
    v.set_bounds(Rect { position: LogicalPosition::new(spot.x, spot.y).into(), size: LogicalSize::new(spot.w, spot.h).into() }).map_err(err)?;
    v.show().map_err(err)
}

#[tauri::command]
pub async fn browser_navigate(app: AppHandle, id: u32, url: String) -> Result<(), String> {
    view(&app, id)?.navigate(parse(&url)?).map_err(err)
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
}
