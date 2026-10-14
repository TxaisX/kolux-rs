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
use std::collections::{HashMap, HashSet, VecDeque};
use std::net::{IpAddr, Ipv4Addr};
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::webview::{Color, NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewUrl};

pub const LOAD_EVENT: &str = "browser-load";
pub const TITLE_EVENT: &str = "browser-title";
pub const CHORD_EVENT: &str = "browser-chord";
pub const LINK_EVENT: &str = "browser-link";
pub const ICON_EVENT: &str = "browser-icon";

/// Asks a finished page where its icon is (BROW-023): the first `<link rel~=icon>`, else the
/// site's /favicon.ico. Runs as the page's own script; the answer is only ever fetched by the app.
const ICON_QUERY: &str = r#"(() => { const l = document.querySelector('link[rel~="icon" i][href]'); return l ? l.href : new URL("/favicon.ico", location.href).href; })()"#;

/// Icons larger than this are not shown (a real site icon is a few kilobytes).
const ICON_MAX: usize = 256 * 1024;

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
    else if (mod && !e.altKey && !e.shiftKey && k === "f") what = "find";
    else if (mod && !e.altKey && (k === "=" || k === "+")) what = "zoomIn";
    else if (mod && !e.altKey && k === "-") what = "zoomOut";
    else if (mod && !e.altKey && k === "0") what = "zoomReset";
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
  // BROW-012: Ctrl (Cmd on a Mac) with the wheel zooms this tab by the app's steps; Alt or Shift
  // with it scrolls as usual. One step per burst, so a trackpad does not race to the limit.
  let wheeled = -1000;
  addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || (mac && e.metaKey)) || e.altKey || e.shiftKey) return;
    e.preventDefault();
    if (e.timeStamp - wheeled < 120) return;
    wheeled = e.timeStamp;
    send(e.deltaY < 0 ? "zoomIn" : "zoomOut");
  }, { capture: true, passive: false });
  // BROW-014: middle click or Mod+click on a link opens it as another tab, behind this one, or in
  // front with Shift. Runs after the page's own handlers: a click the page cancelled, a click a
  // script made, a download link or a link with no web address is left to the page.
  const link = (e) => {
    if (!e.isTrusted || e.defaultPrevented) return;
    const middle = e.type === "auxclick" && e.button === 1;
    const modded = e.type === "click" && e.button === 0 && (mac ? e.metaKey : e.ctrlKey) && !e.altKey;
    if (!middle && !modded) return;
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!a || a.hasAttribute("download") || !/^https?:/i.test(a.href)) return;
    e.preventDefault();
    send((e.shiftKey ? "open-front" : "open-back") + "?u=" + encodeURIComponent(a.href));
  };
  addEventListener("click", link);
  addEventListener("auxclick", link);
})();"#;

/// The chord a navigation carries, if it is one of ours and names a browser action.
pub fn chord_of(url: &str) -> Option<&'static str> {
    let what = url.strip_prefix(CHORD_SCHEME)?;
    CHORDS.iter().copied().find(|c| *c == what)
}

/// BROW-016: how many tabs pages may open within `TABS_WINDOW`; the rest are absorbed.
pub const TABS_ALLOWED: usize = 5;
pub const TABS_WINDOW: Duration = Duration::from_secs(10);

/// A sliding window of the tabs pages have opened lately. A burst gets `TABS_ALLOWED` through and
/// a slow, steady stream cannot get more than that into any window either; the allowance fills up
/// again as old opens fall out of the window.
#[derive(Default)]
pub struct Allowance(VecDeque<Instant>);

impl Allowance {
    pub fn take(&mut self, now: Instant) -> bool {
        while self.0.front().is_some_and(|t| now.duration_since(*t) >= TABS_WINDOW) {
            self.0.pop_front();
        }
        if self.0.len() >= TABS_ALLOWED {
            return false;
        }
        self.0.push_back(now);
        true
    }
}

// ponytail: one allowance for every browser page, so a page and the tabs it opened share it (the
// family the spec names) along with unrelated pages. An allowance per opener alone would hand each
// new tab a fresh five and let a self-copying page grow again; per-family windows need the opener
// passed when the tab opens (T-272-c).
static PAGE_TABS: Mutex<Allowance> = Mutex::new(Allowance(VecDeque::new()));

/// The tabs whose page is on screen now (BROW-002 bounds calls keep it), so a page in a hidden
/// tab may still open tabs behind, but never pushes one to the front (council FIX-1, A3).
static SHOWN: LazyLock<Mutex<HashSet<u32>>> = LazyLock::new(Mutex::default);

fn shown(id: u32) -> bool {
    SHOWN.lock().is_ok_and(|s| s.contains(&id))
}

fn set_shown(id: u32, on: bool) {
    if let Ok(mut s) = SHOWN.lock() {
        if on {
            s.insert(id);
        } else {
            s.remove(&id);
        }
    }
}

/// BROW-014 / BROW-016: whether a page may open `url` as another tab. Both ways a page opens tabs
/// (a new-window request and our own link navigation) come through here, so a page that loops
/// either one still gets only the allowance. A refused address takes nothing from it.
pub fn may_open(url: &Url, dev: Option<&Url>, tabs: &Mutex<Allowance>, now: Instant) -> bool {
    allowed(url, dev).is_ok() && tabs.lock().map(|mut a| a.take(now)).unwrap_or(false)
}

/// What a navigation the page asks for becomes.
#[derive(Debug, PartialEq)]
pub enum Nav {
    /// An ordinary navigation: load it (true) or refuse it (false).
    Load(bool),
    /// Open this address as another tab, in front or behind (BROW-014).
    Link(String, bool),
    /// A browser chord pressed inside the page (BROW-003, BROW-005).
    Chord(&'static str),
}

/// Decides one navigation of a tab's page. `on_screen` is whether that tab is shown now.
pub fn navigation(url: &Url, dev: Option<&Url>, tabs: &Mutex<Allowance>, on_screen: bool, now: Instant) -> Nav {
    if let Some((target, front)) = link_of(url.as_str()) {
        return match parse(&target) {
            Ok(t) if may_open(&t, dev, tabs, now) => Nav::Link(target, front && on_screen),
            _ => Nav::Load(false),
        };
    }
    match chord_of(url.as_str()) {
        Some(what) => Nav::Chord(what),
        // T-500: a redirect, link or script cannot take the tab where the bar may not.
        None => Nav::Load(allowed(url, dev).is_ok()),
    }
}

const CHORDS: [&str; 8] = ["focusAddressBar", "back", "forward", "reload", "find", "zoomIn", "zoomOut", "zoomReset"];

/// A page asked for a new window (a `_blank` link, `window.open`): the tab to open in its place,
/// and whether it comes to the front (only when the asking tab is on screen).
pub fn new_window(url: &Url, dev: Option<&Url>, tabs: &Mutex<Allowance>, on_screen: bool, now: Instant) -> Option<(String, bool)> {
    may_open(url, dev, tabs, now).then(|| (url.to_string(), on_screen))
}

/// A link the page's script asked to open as another tab (BROW-014): the address and whether
/// the new tab comes to the front.
pub fn link_of(url: &str) -> Option<(String, bool)> {
    let (what, query) = url.strip_prefix(CHORD_SCHEME)?.split_once("?u=")?;
    let front = match what {
        "open-front" => true,
        "open-back" => false,
        _ => return None,
    };
    let full = Url::parse(&format!("{CHORD_SCHEME}x?u={query}")).ok()?;
    let target = full.query_pairs().find(|(k, _)| k == "u")?.1.into_owned();
    Some((target, front))
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
struct IconPayload {
    id: u32,
    /// The page the icon belongs to, so the pane can tell a late answer for an old site.
    page: String,
    /// The icon as a data: address (the app's own pages may not load images from the web).
    icon: String,
}

/// The icon address a page gave (`eval_with_callback` hands back the result as JSON), if it is a
/// web address a tab could open (T-500: never one of the app's own origins). The app fetches it
/// itself, so a public page may not point it at the user's own machine or network (a router, a
/// LAN dev server): an icon on such a host is fetched only for a page on that same host.
pub fn icon_address(answer: &str, app: Option<&Url>, page: &Url) -> Option<Url> {
    let href: String = serde_json::from_str(answer).ok()?;
    let url = parse(&href).ok()?;
    let near_ok = !local_host(&url) || url.host_str() == page.host_str();
    (url.scheme() != "about" && allowed(&url, app).is_ok() && near_ok).then_some(url)
}

/// Whether an address names this machine or the local network rather than the public web:
/// loopback, private, link-local, carrier-grade NAT and unspecified addresses, `localhost`, and
/// names that only a local network resolves (no dot, `.local`, `.lan`, `.internal`, `.home.arpa`).
/// ponytail: a public name that resolves to a private address is not caught (that needs our own
/// resolver); the hooks server still wants its token, and no cookies are ever sent.
pub fn local_host(url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default().trim_start_matches('[').trim_end_matches(']');
    let v4 = |ip: Ipv4Addr| {
        let [a, b, ..] = ip.octets();
        ip.is_loopback() || ip.is_private() || ip.is_link_local() || ip.is_unspecified() || ip.is_broadcast() || (a == 100 && (b & 0xc0) == 64)
    };
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => v4(ip),
        Ok(IpAddr::V6(ip)) => {
            let s = ip.segments()[0];
            ip.is_loopback() || ip.is_unspecified() || (s & 0xfe00) == 0xfc00 || (s & 0xffc0) == 0xfe80 || ip.to_ipv4_mapped().is_some_and(v4)
        }
        Err(_) => {
            let d = host.trim_end_matches('.').to_ascii_lowercase();
            d.is_empty() || !d.contains('.') || [".localhost", ".local", ".lan", ".internal", ".home.arpa"].iter().any(|s| d.ends_with(s))
        }
    }
}

/// How many redirects an icon fetch follows.
const ICON_HOPS: usize = 5;

/// Whether an icon fetch may follow a redirect to `next`, given the addresses already asked
/// (`previous`, first the icon address the page gave): the same rule as a tab's address on every
/// hop, never from https down to http, and never onto this machine or the local network unless
/// the chain started on that very host (which `icon_address` only allows for a page there).
pub fn hop_ok(next: &Url, previous: &[Url], app: Option<&Url>) -> bool {
    let (Some(first), Some(last)) = (previous.first(), previous.last()) else { return false };
    previous.len() <= ICON_HOPS
        && next.scheme() != "about"
        && allowed(next, app).is_ok()
        && !(last.scheme() == "https" && next.scheme() == "http")
        && (!local_host(next) || next.host_str() == first.host_str())
}

/// An icon client with the redirect rule above: a refused hop fails the fetch.
fn icon_client_for(app: Option<Url>) -> Option<reqwest::Client> {
    let policy = reqwest::redirect::Policy::custom(move |hop| {
        if hop_ok(hop.url(), hop.previous(), app.as_ref()) {
            hop.follow()
        } else {
            let to = hop.url().to_string();
            hop.error(format!("icon redirect to {to} refused"))
        }
    });
    reqwest::Client::builder().timeout(Duration::from_secs(8)).redirect(policy).build().ok()
}

/// The one client every icon fetch shares (the dev origin never changes while the app runs).
fn icon_client(app: Option<Url>) -> Option<&'static reqwest::Client> {
    static CLIENT: OnceLock<Option<reqwest::Client>> = OnceLock::new();
    CLIENT.get_or_init(move || icon_client_for(app)).as_ref()
}

/// What a tab's icon request should do: answer from the icon already fetched for that address,
/// wait for the fetch already under way, or fetch it.
#[derive(Debug, PartialEq)]
pub enum IconStep {
    Have(String),
    Busy,
    Fetch,
}

/// The icon fetches under way and the last icon each tab got, so a page that reloads itself in
/// a loop starts one fetch per icon address, not one per load.
#[derive(Default)]
pub struct Icons {
    busy: HashSet<(u32, String)>,
    got: HashMap<u32, (String, String)>,
}

impl Icons {
    pub fn begin(&mut self, id: u32, url: &str) -> IconStep {
        if let Some((at, icon)) = self.got.get(&id) {
            if at == url {
                return IconStep::Have(icon.clone());
            }
        }
        if self.busy.insert((id, url.to_string())) {
            IconStep::Fetch
        } else {
            IconStep::Busy
        }
    }

    /// A fetch ended; a failed one (`None`) is tried again on the next load.
    pub fn end(&mut self, id: u32, url: &str, icon: Option<&str>) {
        // A tab closed while its fetch ran keeps nothing.
        if self.busy.remove(&(id, url.to_string())) {
            if let Some(icon) = icon {
                self.got.insert(id, (url.to_string(), icon.to_string()));
            }
        }
    }

    pub fn forget(&mut self, id: u32) {
        self.got.remove(&id);
        self.busy.retain(|(tab, _)| *tab != id);
    }
}

static ICONS: LazyLock<Mutex<Icons>> = LazyLock::new(Mutex::default);

/// The icon bytes as a data: address, if the server said it is an image and it is small enough.
pub fn icon_data(kind: &str, bytes: &[u8]) -> Option<String> {
    use base64::Engine;
    let kind = kind.split(';').next().unwrap_or_default().trim().to_ascii_lowercase();
    if !kind.starts_with("image/") || bytes.is_empty() || bytes.len() > ICON_MAX {
        return None;
    }
    Some(format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Fetches an icon, reading no more of the body than an icon may be: a non-image answer or one
/// that says it is too large is dropped before its body is read, and a body that turns out too
/// large is dropped as soon as it passes the limit.
async fn fetch_icon(client: &reqwest::Client, url: Url) -> Option<String> {
    let mut res = client.get(url).send().await.ok()?.error_for_status().ok()?;
    let kind = res.headers().get(reqwest::header::CONTENT_TYPE)?.to_str().ok()?.to_string();
    if !kind.trim().to_ascii_lowercase().starts_with("image/") || res.content_length().is_some_and(|n| n > ICON_MAX as u64) {
        return None;
    }
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await.ok()? {
        if body.len() + chunk.len() > ICON_MAX {
            return None;
        }
        body.extend_from_slice(&chunk);
    }
    icon_data(&kind, &body)
}

/// BROW-023: the icon for one finished load, fetched at most once per address at a time.
fn icon_for(app: AppHandle, dev: Option<Url>, id: u32, page: String, url: Url) {
    let step = ICONS.lock().map(|mut i| i.begin(id, url.as_str())).unwrap_or(IconStep::Busy);
    match step {
        IconStep::Busy => {}
        IconStep::Have(icon) => {
            let _ = app.emit(ICON_EVENT, IconPayload { id, page, icon });
        }
        IconStep::Fetch => {
            tauri::async_runtime::spawn(async move {
                let icon = match icon_client(dev) {
                    Some(client) => fetch_icon(client, url.clone()).await,
                    None => None,
                };
                if let Ok(mut i) = ICONS.lock() {
                    i.end(id, url.as_str(), icon.as_deref());
                }
                if let Some(icon) = icon {
                    let _ = app.emit(ICON_EVENT, IconPayload { id, page, icon });
                }
            });
        }
    }
}

#[derive(Clone, Serialize)]
struct LinkPayload {
    id: u32,
    url: String,
    front: bool,
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
    let window_app = app.clone();
    let window_dev = dev.clone();
    let icon_dev = dev.clone();
    let builder = WebviewBuilder::new(label(id), WebviewUrl::External(url))
        .focused(false)
        // BROW-012: zoom is the app's, in its own steps, so the engine's own zoom keys are off.
        .zoom_hotkeys_enabled(false)
        .initialization_script(CHORD_SCRIPT)
        // BROW-014: a link or script asking for a new window becomes another Kolux tab, in front.
        .on_new_window(move |url, _| {
            // BROW-016: a page opening windows in a loop gets a handful of tabs, never a flood.
            if let Some((url, front)) = new_window(&url, window_dev.as_ref(), &PAGE_TABS, shown(id), Instant::now()) {
                let _ = window_app.emit(LINK_EVENT, LinkPayload { id, url, front });
            }
            NewWindowResponse::Deny
        })
        .on_navigation(move |url| match navigation(url, dev.as_ref(), &PAGE_TABS, shown(id), Instant::now()) {
            Nav::Load(go) => go,
            Nav::Link(url, front) => {
                let _ = chord_app.emit(LINK_EVENT, LinkPayload { id, url, front });
                false
            }
            Nav::Chord(what) => {
                if what == "focusAddressBar" {
                    // The keyboard is inside the page; the bar lives in the app's own web view.
                    if let Some(main) = chord_app.get_webview("main") {
                        let _ = main.set_focus();
                    }
                }
                let _ = chord_app.emit(CHORD_EVENT, ChordPayload { id, what: what.to_string() });
                false
            }
        })
        .on_page_load(move |page, payload| {
            let event = match payload.event() {
                PageLoadEvent::Started => "started",
                PageLoadEvent::Finished => "finished",
            };
            // BROW-023: every finished load asks for the site's icon again, so an icon that failed
            // is tried again after a reload; the pane keeps the old one while the site is the same.
            if event == "finished" {
                let (icon_app, icon_dev, at) = (load_app.clone(), icon_dev.clone(), payload.url().to_string());
                let _ = page.eval_with_callback(ICON_QUERY, move |answer| {
                    let Ok(page) = parse(&at) else { return };
                    let Some(url) = icon_address(&answer, icon_dev.as_ref(), &page) else { return };
                    icon_for(icon_app.clone(), icon_dev.clone(), id, at.clone(), url);
                });
            }
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
    // A new page is laid over its pane, on screen, until the pane's bounds say otherwise.
    set_shown(id, true);
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
    set_shown(id, shown);
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

/// Find in page (BROW-007): the engine's own find, which selects and scrolls to the next match
/// (or the previous one), wrapping at the ends. The text goes in as a JSON string, never as code.
pub fn find_script(text: &str, back: bool) -> String {
    format!("window.find({}, false, {back}, true)", serde_json::Value::from(text))
}

/// A tab's zoom (BROW-012) kept inside what the engine accepts; the steps are the front end's.
pub fn zoom_level(level: f64) -> f64 {
    if level.is_finite() {
        level.clamp(0.25, 5.0)
    } else {
        1.0
    }
}

/// `text` is the find text for `find` and `findBack`; `level` is the zoom for `zoom`.
#[tauri::command]
pub async fn browser_go(app: AppHandle, id: u32, what: String, text: Option<String>, level: Option<f64>) -> Result<(), String> {
    let v = view(&app, id)?;
    match what.as_str() {
        "reload" => v.reload().map_err(err),
        "zoom" => v.set_zoom(zoom_level(level.unwrap_or(1.0))).map_err(err),
        "find" | "findBack" => v.eval(find_script(text.as_deref().unwrap_or_default(), what == "findBack")).map_err(err),
        _ => v.eval(script(&what).ok_or_else(|| format!("unknown browser action {what}"))?).map_err(err),
    }
}

#[tauri::command]
pub async fn browser_close(app: AppHandle, id: u32) -> Result<(), String> {
    set_shown(id, false);
    if let Ok(mut i) = ICONS.lock() {
        i.forget(id);
    }
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
        assert_eq!(chord_of("kolux-chord:find"), Some("find"));
        assert_eq!(chord_of("kolux-chord:zoomIn"), Some("zoomIn"));
        assert_eq!(chord_of("kolux-chord:zoomReset"), Some("zoomReset"));
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

    #[test]
    fn brow014_a_modded_link_opens_as_a_tab_behind_or_in_front() {
        // What the page script sends: encodeURIComponent of the link's address.
        let sent = "kolux-chord:open-back?u=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1%26y%3D2%23top";
        assert_eq!(link_of(sent), Some(("https://example.com/a?x=1&y=2#top".to_string(), false)));
        assert_eq!(link_of("kolux-chord:open-front?u=https%3A%2F%2Fexample.com%2F"), Some(("https://example.com/".to_string(), true)));
        assert_eq!(link_of("kolux-chord:open-sideways?u=https%3A%2F%2Fexample.com%2F"), None);
        assert_eq!(link_of("kolux-chord:back"), None);
        assert_eq!(link_of("https://example.com/kolux-chord:open-back?u=x"), None);
        assert_eq!(chord_of("kolux-chord:open-back?u=x"), None);
    }

    #[test]
    fn brow007_find_runs_the_engine_find_with_the_text_quoted() {
        assert_eq!(find_script("word", false), r#"window.find("word", false, false, true)"#);
        assert_eq!(find_script(r#"a"); alert(1); (""#, true), r#"window.find("a\"); alert(1); (\"", false, true, true)"#);
    }

    #[test]
    fn brow012_zoom_stays_inside_the_engine_limits() {
        assert_eq!(zoom_level(1.5), 1.5);
        assert_eq!(zoom_level(9.0), 5.0);
        assert_eq!(zoom_level(0.1), 0.25);
        assert_eq!(zoom_level(f64::NAN), 1.0);
    }

    #[test]
    fn brow016_a_window_storm_opens_a_handful_of_tabs_and_the_allowance_comes_back() {
        let start = Instant::now();
        let mut a = Allowance::default();
        // 100 windows from one click: a few open, the rest are absorbed.
        let opened = (0..100).filter(|_| a.take(start)).count();
        assert_eq!(opened, TABS_ALLOWED);
        // A steady stream inside the same window gets nothing more.
        assert!(!a.take(start + Duration::from_secs(9)));
        // Once the window has passed (a minute later) links open again.
        assert!(a.take(start + Duration::from_secs(60)));
        // A slow, steady stream, one a second for a minute, never beats the window either.
        let mut b = Allowance::default();
        let through = (0..60).filter(|i| b.take(start + Duration::from_secs(*i))).count();
        assert_eq!(through, TABS_ALLOWED * 6);
    }

    #[test]
    fn brow023_the_site_icon_is_a_small_image_from_a_web_address() {
        let page = Url::parse("https://example.com/a").unwrap();
        assert_eq!(icon_address(r#""https://example.com/favicon.ico""#, None, &page).map(|u| u.to_string()), Some("https://example.com/favicon.ico".into()));
        assert_eq!(icon_address(r#""http://tauri.localhost/x.png""#, None, &page), None);
        assert_eq!(icon_address(r#""data:image/png;base64,AA==""#, None, &page), None);
        assert_eq!(icon_address("null", None, &page), None);
        assert_eq!(icon_data("image/png", &[1, 2, 3]), Some("data:image/png;base64,AQID".into()));
        assert_eq!(icon_data("Image/X-Icon; charset=binary", &[1]), Some("data:image/x-icon;base64,AQ==".into()));
        assert_eq!(icon_data("text/html", b"<html>"), None);
        assert_eq!(icon_data("image/png", &[]), None);
        assert_eq!(icon_data("image/png", &vec![0; ICON_MAX + 1]), None);
    }

    // Council FIX-1 (d2/browser-80d198b-review.md). A page that loops
    // `location.assign("kolux-chord:open-front?u=" + location.href)` must hit the same allowance a
    // window storm does, or each new tab copies itself until memory runs out.
    #[test]
    fn fix1_a_link_navigations_take_from_the_same_allowance_as_new_windows() {
        let now = Instant::now();
        let me = Url::parse("kolux-chord:open-front?u=https%3A%2F%2Fexample.com%2F").unwrap();
        let web = Url::parse("https://example.com/").unwrap();
        let tabs = Mutex::new(Allowance::default());
        let links = (0..100).filter(|_| matches!(navigation(&me, None, &tabs, true, now), Nav::Link(..))).count();
        assert_eq!(links, TABS_ALLOWED);
        assert_eq!(navigation(&me, None, &tabs, true, now), Nav::Load(false));
        // The two ways share one allowance, in either order.
        assert_eq!(new_window(&web, None, &tabs, true, now), None);
        let tabs = Mutex::new(Allowance::default());
        for _ in 0..TABS_ALLOWED {
            assert_eq!(new_window(&web, None, &tabs, true, now), Some(("https://example.com/".into(), true)));
        }
        assert_eq!(navigation(&me, None, &tabs, true, now), Nav::Load(false));
        // It comes back once the window has passed.
        assert_eq!(navigation(&me, None, &tabs, true, now + TABS_WINDOW), Nav::Link("https://example.com/".into(), true));
        // A refused address takes nothing from it.
        let tabs = Mutex::new(Allowance::default());
        let bad = Url::parse("kolux-chord:open-back?u=http%3A%2F%2Ftauri.localhost%2F").unwrap();
        for _ in 0..50 {
            assert_eq!(navigation(&bad, None, &tabs, true, now), Nav::Load(false));
            assert_eq!(new_window(&Url::parse("http://tauri.localhost/").unwrap(), None, &tabs, true, now), None);
        }
        assert!(matches!(navigation(&me, None, &tabs, true, now), Nav::Link(..)));
        // Ordinary navigations and chords are not counted and behave as before.
        for _ in 0..20 {
            assert_eq!(navigation(&web, None, &tabs, true, now), Nav::Load(true));
            assert_eq!(navigation(&Url::parse("kolux-chord:back").unwrap(), None, &tabs, true, now), Nav::Chord("back"));
        }
        assert_eq!(navigation(&Url::parse("http://tauri.localhost/").unwrap(), None, &tabs, true, now), Nav::Load(false));
        assert_eq!(navigation(&Url::parse("kolux-chord:close").unwrap(), None, &tabs, true, now), Nav::Load(false));
    }

    #[test]
    fn fix1_e_a_hidden_tab_opens_tabs_behind_never_in_front() {
        let now = Instant::now();
        let tabs = Mutex::new(Allowance::default());
        let front = Url::parse("kolux-chord:open-front?u=https%3A%2F%2Fexample.com%2F").unwrap();
        let web = Url::parse("https://example.com/").unwrap();
        assert_eq!(navigation(&front, None, &tabs, false, now), Nav::Link("https://example.com/".into(), false));
        assert_eq!(new_window(&web, None, &tabs, false, now), Some(("https://example.com/".into(), false)));
        assert_eq!(navigation(&front, None, &tabs, true, now), Nav::Link("https://example.com/".into(), true));
        assert_eq!(new_window(&web, None, &tabs, true, now), Some(("https://example.com/".into(), true)));
    }

    #[test]
    fn fix1_c_a_public_page_never_points_the_icon_fetch_at_this_machine_or_network() {
        let public = Url::parse("https://example.com/a").unwrap();
        for icon in [
            "http://127.0.0.1:8745/x.ico",
            "http://localhost/favicon.ico",
            "http://[::1]/x",
            "http://[fe80::1]/x",
            "http://[fd00::5]/x",
            "http://[::ffff:192.168.0.1]/x",
            "http://192.168.1.1/x",
            "http://10.0.0.1/x",
            "http://172.16.4.4/x",
            "http://169.254.169.254/latest",
            "http://100.64.0.1/x",
            "http://0.0.0.0/x",
            "http://router/x",
            "http://nas.local/x",
            "http://box.lan/x",
            "http://svc.internal/x",
        ] {
            assert_eq!(icon_address(&format!("\"{icon}\""), None, &public), None, "{icon}");
        }
        assert!(icon_address(r#""https://cdn.example.net/i.png""#, None, &public).is_some());
        assert!(icon_address(r#""https://8.8.8.8/i.png""#, None, &public).is_some());
        assert!(icon_address(r#""https://[2001:db8::1]/i.png""#, None, &public).is_some());
        // A page on the user's own dev server or LAN box may show that host's own icon.
        let dev = Url::parse("http://localhost:3000/app").unwrap();
        assert!(icon_address(r#""http://localhost:3000/favicon.ico""#, None, &dev).is_some());
        assert_eq!(icon_address(r#""http://192.168.1.1/favicon.ico""#, None, &dev), None);
        let lan = Url::parse("http://192.168.1.5/").unwrap();
        assert!(icon_address(r#""http://192.168.1.5:8080/f.ico""#, None, &lan).is_some());
        // The app's own dev origin stays refused even for a page on localhost.
        let app = Url::parse("http://localhost:1420").unwrap();
        assert_eq!(icon_address(r#""http://localhost:1420/favicon.ico""#, Some(&app), &dev), None);
    }

    #[test]
    fn fix1_c_every_redirect_hop_is_checked_again() {
        let u = |s: &str| Url::parse(s).unwrap();
        let https = [u("https://example.com/favicon.ico")];
        assert!(hop_ok(&u("https://cdn.example.net/i.png"), &https, None));
        assert!(!hop_ok(&u("http://cdn.example.net/i.png"), &https, None), "https down to http");
        assert!(hop_ok(&u("http://cdn.example.net/i.png"), &[u("http://example.com/x")], None));
        assert!(!hop_ok(&u("http://192.168.1.1/"), &https, None));
        assert!(!hop_ok(&u("https://localhost:3000/"), &https, None));
        assert!(!hop_ok(&u("https://tauri.localhost/"), &https, None));
        assert!(!hop_ok(&u("file:///C:/Windows/win.ini"), &https, None));
        assert!(!hop_ok(&u("about:blank"), &https, None));
        let app = u("http://localhost:1420");
        let local = [u("http://localhost:3000/favicon.ico")];
        assert!(hop_ok(&u("http://localhost:3000/real.ico"), &local, Some(&app)));
        assert!(!hop_ok(&u("http://localhost:1420/x"), &local, Some(&app)));
        assert!(!hop_ok(&u("http://192.168.0.1/"), &local, Some(&app)));
        let long: Vec<Url> = (0..=ICON_HOPS).map(|i| u(&format!("https://example.com/{i}"))).collect();
        assert!(!hop_ok(&u("https://example.com/next"), &long, None));
        assert!(!hop_ok(&u("https://example.com/next"), &[], None));
    }

    /// One HTTP answer on a loopback port: `head` (status line and headers), then `body` bytes.
    /// The thread returns whether the whole body went out.
    fn answer_once(head: String, body: usize) -> (Url, std::thread::JoinHandle<bool>) {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = Url::parse(&format!("http://127.0.0.1:{}/favicon.ico", l.local_addr().unwrap().port())).unwrap();
        let t = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let (mut buf, mut got) = ([0u8; 4096], Vec::new());
            while !got.windows(4).any(|w| w == b"\r\n\r\n") {
                match s.read(&mut buf) {
                    Ok(0) | Err(_) => return false,
                    Ok(n) => got.extend_from_slice(&buf[..n]),
                }
            }
            if s.write_all(head.as_bytes()).is_err() {
                return false;
            }
            let (chunk, mut sent) = (vec![7u8; 64 * 1024], 0);
            while sent < body {
                let n = chunk.len().min(body - sent);
                if s.write_all(&chunk[..n]).is_err() {
                    return false;
                }
                sent += n;
            }
            true
        });
        (url, t)
    }

    #[test]
    fn fix1_b_the_icon_fetch_stops_reading_past_the_limit() {
        let client = icon_client_for(None).unwrap();
        let fetch = |url: Url| tauri::async_runtime::block_on(fetch_icon(&client, url));
        let big = 32 * 1024 * 1024;
        // No length given: the body is read only until it passes the limit.
        let (url, server) = answer_once("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nConnection: close\r\n\r\n".into(), big);
        assert_eq!(fetch(url), None);
        assert!(!server.join().unwrap(), "the whole 32 MB body was read");
        // A length over the limit: refused before the body is read.
        let (url, server) = answer_once(format!("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {big}\r\n\r\n"), big);
        assert_eq!(fetch(url), None);
        assert!(!server.join().unwrap(), "a body said to be 32 MB was read");
        // Not an image: refused before the body is read.
        let (url, server) = answer_once("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n".into(), big);
        assert_eq!(fetch(url), None);
        assert!(!server.join().unwrap(), "a 32 MB page was read as an icon");
        // A real icon still comes through.
        let (url, server) = answer_once("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\n\r\n".into(), 3);
        assert_eq!(fetch(url), Some("data:image/png;base64,BwcH".into()));
        assert!(server.join().unwrap());
    }

    #[test]
    fn fix1_c_the_icon_client_refuses_a_redirect_onto_another_local_host() {
        use std::io::{Read, Write};
        // The second host: counts whether anything asked it.
        let second = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = second.local_addr().unwrap().port();
        second.set_nonblocking(true).unwrap();
        // The first answer sends the fetch to the same machine under another name.
        let (url, first) = answer_once(format!("HTTP/1.1 302 Found\r\nLocation: http://localhost:{port}/x.png\r\nContent-Length: 0\r\n\r\n"), 0);
        let client = icon_client_for(None).unwrap();
        assert_eq!(tauri::async_runtime::block_on(fetch_icon(&client, url)), None);
        first.join().unwrap();
        let start = Instant::now();
        let mut asked = false;
        while start.elapsed() < Duration::from_millis(500) {
            if let Ok((mut s, _)) = second.accept() {
                asked = true;
                let _ = s.read(&mut [0u8; 64]);
                let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!asked, "the redirect onto localhost was followed");
        // A redirect within the host the chain started on is followed.
        let (to, server) = answer_once("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\n\r\n".into(), 3);
        let (url, first) = answer_once(format!("HTTP/1.1 302 Found\r\nLocation: {to}\r\nContent-Length: 0\r\n\r\n"), 0);
        assert_eq!(tauri::async_runtime::block_on(fetch_icon(&client, url)), Some("data:image/png;base64,BwcH".into()));
        assert!(first.join().unwrap() && server.join().unwrap());
    }

    #[test]
    fn fix1_b_a_reloading_page_starts_one_icon_fetch_per_address() {
        let mut i = Icons::default();
        let a = "https://example.com/favicon.ico";
        assert_eq!(i.begin(1, a), IconStep::Fetch);
        for _ in 0..100 {
            assert_eq!(i.begin(1, a), IconStep::Busy);
        }
        // Another tab fetches on its own.
        assert_eq!(i.begin(2, a), IconStep::Fetch);
        i.end(1, a, Some("data:image/png;base64,AQ=="));
        assert_eq!(i.begin(1, a), IconStep::Have("data:image/png;base64,AQ==".into()));
        // A new address is fetched; a failed fetch is tried again on the next load.
        assert_eq!(i.begin(1, "https://example.com/b.ico"), IconStep::Fetch);
        i.end(1, "https://example.com/b.ico", None);
        assert_eq!(i.begin(1, "https://example.com/b.ico"), IconStep::Fetch);
        // A tab closed mid-fetch keeps nothing.
        i.forget(2);
        i.end(2, a, Some("data:image/png;base64,AQ=="));
        assert_eq!(i.begin(2, a), IconStep::Fetch);
    }
}
