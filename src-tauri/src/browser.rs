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
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::webview::{Color, NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewUrl};

// T-195 (BROW-042, BROW-046, BROW-047): the command line's browser commands; cli.rs reaches them
// through evidence/browser-T-195-cli.rs.patch.
#[path = "browser_cli.rs"]
pub mod cli;

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

/// The tabs whose page is on screen now (BROW-002 bounds calls keep it, and the open call says
/// whether a new tab starts on screen), so a page in a hidden tab opens no tab and sends no chord
/// (council FIX-1 A3, FIX-2 FS1).
static SHOWN: LazyLock<Mutex<HashSet<u32>>> = LazyLock::new(Mutex::default);

fn is_shown(id: u32) -> bool {
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

/// Decides one navigation of a tab's page. `on_screen` is whether that tab is shown now: a tab
/// that is not cannot have a user's click or key behind it (council FIX-2, FS1), so it opens no
/// tab, takes nothing from the allowance the user's own clicks share, and sends no chord (a
/// hidden page looping `focusAddressBar` would pull the keyboard off the pane the user types in).
pub fn navigation(url: &Url, dev: Option<&Url>, tabs: &Mutex<Allowance>, on_screen: bool, now: Instant) -> Nav {
    if let Some((target, front)) = link_of(url.as_str()) {
        return match parse(&target) {
            Ok(t) if on_screen && may_open(&t, dev, tabs, now) => Nav::Link(target, front),
            _ => Nav::Load(false),
        };
    }
    match chord_of(url.as_str()) {
        Some(_) if !on_screen => Nav::Load(false),
        Some(what) => Nav::Chord(what),
        // T-500: a redirect, link or script cannot take the tab where the bar may not.
        None => Nav::Load(allowed(url, dev).is_ok()),
    }
}

const CHORDS: [&str; 8] = ["focusAddressBar", "back", "forward", "reload", "find", "zoomIn", "zoomOut", "zoomReset"];

/// A page asked for a new window (a `_blank` link, `window.open`): the tab to open in its place,
/// in front. Only a tab on screen gets one (FS1, as for links above).
pub fn new_window(url: &Url, dev: Option<&Url>, tabs: &Mutex<Allowance>, on_screen: bool, now: Instant) -> Option<(String, bool)> {
    (on_screen && may_open(url, dev, tabs, now)).then(|| (url.to_string(), true))
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
    let near_ok = !local_host(&url) || same_spot(&url, page);
    (url.scheme() != "about" && allowed(&url, app).is_ok() && near_ok).then_some(url)
}

/// Whether an address names this machine or the local network rather than the public web:
/// loopback, private, link-local, carrier-grade NAT and unspecified addresses, `localhost`, and
/// names that only a local network resolves (no dot, `.local`, `.lan`, `.internal`, `.home.arpa`).
/// A public name that resolves to such an address is caught by the icon fetch's own lookup
/// (`Resolver`), which also covers a name rebound after the page loaded (council FIX-2, FS2).
pub fn local_host(url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default().trim_start_matches('[').trim_end_matches(']');
    match host.parse::<IpAddr>() {
        Ok(ip) => local_ip(ip),
        Err(_) => {
            let d = host.trim_end_matches('.').to_ascii_lowercase();
            d.is_empty() || !d.contains('.') || [".localhost", ".local", ".lan", ".internal", ".home.arpa"].iter().any(|s| d.ends_with(s))
        }
    }
}

/// Whether an address is on this machine or the local network: loopback, private, link-local,
/// carrier-grade NAT, `0.0.0.0/8` and broadcast, and the IPv6 forms of those, including an IPv4
/// address written as IPv6 (mapped `::ffff:a.b.c.d` or compatible `::a.b.c.d`, council FIX-2).
/// Council FIX-3 adds, whole: `198.18.0.0/15` (benchmarking), `192.0.0.0/24`, `240.0.0.0/4`
/// (reserved, broadcast inside), NAT64 `64:ff9b::/96` and `64:ff9b:1::/48`, 6to4 `2002::/16` and
/// site-local `fec0::/10`, each of which can carry or reach a local IPv4 address.
pub fn local_ip(ip: IpAddr) -> bool {
    let v4 = |ip: Ipv4Addr| {
        let [a, b, c, _] = ip.octets();
        a == 0
            || ip.is_loopback()
            || ip.is_private()
            || ip.is_link_local()
            || (a == 100 && (b & 0xc0) == 64)
            || (a == 198 && (b & 0xfe) == 18)
            || (a == 192 && b == 0 && c == 0)
            || a >= 240
    };
    match ip {
        IpAddr::V4(ip) => v4(ip),
        IpAddr::V6(ip) => {
            let g = ip.segments();
            ip.is_loopback()
                || ip.is_unspecified()
                || (g[0] & 0xfe00) == 0xfc00
                || (g[0] & 0xffc0) == 0xfe80
                || (g[0] & 0xffc0) == 0xfec0
                || g[0] == 0x2002
                || (g[0] == 0x64 && g[1] == 0xff9b && (g[2..6] == [0; 4] || g[2] == 1))
                || ip.to_ipv4().is_some_and(v4)
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
        && (!local_host(next) || same_spot(next, first))
}

/// How the icon fetch looks a host name up: the system's own lookup, or a stand-in in tests.
pub type Lookup = fn(&str) -> std::io::Result<Vec<IpAddr>>;

fn system_lookup(host: &str) -> std::io::Result<Vec<IpAddr>> {
    use std::net::ToSocketAddrs;
    Ok((host, 0).to_socket_addrs()?.map(|a| a.ip()).collect())
}

/// The addresses an icon fetch for another host may connect to (council FIX-2, FS2).
pub fn public_addrs(ips: Vec<IpAddr>) -> Vec<IpAddr> {
    ips.into_iter().filter(|ip| !local_ip(*ip)).collect()
}

/// The icon fetch's own name lookup: for any host other than the page's own, only public
/// addresses come back, so a public name that points at this machine or the local network
/// (`192-168-1-1.nip.io`, `localtest.me`, or a name rebound after the page loaded) is never asked.
struct Resolver {
    lookup: Lookup,
    public: bool,
}

impl reqwest::dns::Resolve for Resolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let (lookup, public, host) = (self.lookup, self.public, name.as_str().to_string());
        Box::pin(async move {
            let ips = tauri::async_runtime::spawn_blocking(move || lookup(&host)).await??;
            let ips = if public { public_addrs(ips) } else { ips };
            if ips.is_empty() {
                return Err("the icon host is on this machine or the local network".into());
            }
            let addrs: reqwest::dns::Addrs = Box::new(ips.into_iter().map(|ip| SocketAddr::new(ip, 0)));
            Ok(addrs)
        })
    }
}

/// The two icon clients, both built by the one `icon_client_for` builder line. `near` fetches a
/// page's own-host icon only when that page is itself open on this machine or the local network
/// (`icon_near`); a redirect off that host stops and is handed to `far`. `far` fetches every
/// other icon, a public page's own-host icon included, through the public-only lookup. Neither
/// goes through a proxy (a proxy would resolve the name where the lookup cannot see it).
/// DNS rebinding: a public name rebound to a local address after its page loaded reaches `far`
/// as an empty lookup and is never asked (council FIX-3: reqwest goes through none of the
/// engine's local-network checks, so `near` never serves a public page).
pub struct IconClients {
    near: reqwest::Client,
    far: reqwest::Client,
}

/// An icon client with the redirect rule above: a refused hop fails the fetch.
fn icon_client_for(app: Option<Url>, near: bool, lookup: Lookup) -> Option<reqwest::Client> {
    let policy = reqwest::redirect::Policy::custom(move |hop| {
        let same = hop.previous().first().is_some_and(|first| same_spot(first, hop.url()));
        if !hop_ok(hop.url(), hop.previous(), app.as_ref()) {
            let to = hop.url().to_string();
            hop.error(format!("icon redirect to {to} refused"))
        } else if near && !same {
            hop.stop()
        } else {
            hop.follow()
        }
    });
    let resolver = Resolver { lookup, public: !near };
    reqwest::Client::builder().timeout(Duration::from_secs(8)).redirect(policy).no_proxy().dns_resolver(resolver).build().ok()
}

pub fn icon_clients(app: Option<Url>, lookup: Lookup) -> Option<IconClients> {
    Some(IconClients { near: icon_client_for(app.clone(), true, lookup)?, far: icon_client_for(app, false, lookup)? })
}

/// The clients every icon fetch shares (the dev origin never changes while the app runs).
fn icon_client(app: Option<Url>) -> Option<&'static IconClients> {
    static CLIENTS: OnceLock<Option<IconClients>> = OnceLock::new();
    CLIENTS.get_or_init(move || icon_clients(app, system_lookup)).as_ref()
}

/// What a tab's icon request should do: answer from the icon already fetched for that address,
/// wait for the fetch already under way, or fetch it.
#[derive(Debug, PartialEq)]
pub enum IconStep {
    Have(String),
    Busy,
    Fetch,
}

/// The icon fetch under way for each tab and the last icon each tab got, so a page that reloads
/// itself in a loop, even with a new icon address each time, has one fetch at a time (council
/// FIX-2, AFTER 2). A request while that fetch runs is dropped, not queued: the tab's next
/// finished load asks again, and a fetch ends within `ICON_TIME`.
#[derive(Default)]
pub struct Icons {
    busy: HashMap<u32, String>,
    got: HashMap<u32, (String, String)>,
}

impl Icons {
    pub fn begin(&mut self, id: u32, url: &str) -> IconStep {
        if let Some((at, icon)) = self.got.get(&id) {
            if at == url {
                return IconStep::Have(icon.clone());
            }
        }
        if self.busy.contains_key(&id) {
            return IconStep::Busy;
        }
        self.busy.insert(id, url.to_string());
        IconStep::Fetch
    }

    /// A fetch ended; a failed one (`None`) is tried again on the next load.
    pub fn end(&mut self, id: u32, url: &str, icon: Option<&str>) {
        // A tab closed while its fetch ran keeps nothing.
        if self.busy.get(&id).is_some_and(|at| at == url) {
            self.busy.remove(&id);
            if let Some(icon) = icon {
                self.got.insert(id, (url.to_string(), icon.to_string()));
            }
        }
    }

    pub fn forget(&mut self, id: u32) {
        self.got.remove(&id);
        self.busy.remove(&id);
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

/// Whether an icon is fetched by the near client: it is on the page's own host and that page is
/// itself open on this machine or the local network (council FIX-3). A public page's icon, on its
/// own name or not, goes through the public-only lookup, so a name rebound to a local address
/// after the page loaded is never asked.
pub fn icon_near(url: &Url, page: &Url) -> bool {
    local_host(page) && same_spot(url, page)
}

/// Whether two addresses name the same host on the same port, a scheme's default port counting
/// as written (council FIX-4, AFTER 2): a page on one port of this machine never reaches another.
pub fn same_spot(a: &Url, b: &Url) -> bool {
    a.host_str() == b.host_str() && a.port_or_known_default() == b.port_or_known_default()
}

/// What is left of an icon fetch's time limit after `elapsed`; `None` once it has run out
/// (council FIX-4, AFTER 3: the far request after a hand-off gets only this).
pub fn time_left(elapsed: Duration, limit: Duration) -> Option<Duration> {
    limit.checked_sub(elapsed).filter(|d| !d.is_zero())
}

/// Whether a focusAddressBar chord may move the keyboard into the app's own view: only while the
/// app's window holds the keyboard at the system level (a child page holding it still counts), so
/// a page cannot pull the keyboard while the user is in another program (council FIX-4, item 3).
pub fn focus_app_ok(window_focused: bool) -> Result<(), String> {
    if window_focused {
        Ok(())
    } else {
        Err("the app's window does not hold the keyboard".into())
    }
}

/// Where a redirect the near client stopped at goes next, if the far client may follow it: the
/// `Location` joined to the address that answered, under the same rule as every other hop.
pub fn hand_off(from: &Url, location: Option<&str>, app: Option<&Url>) -> Option<Url> {
    let next = from.join(location?).ok()?;
    hop_ok(&next, std::slice::from_ref(from), app).then_some(next)
}

/// How long one icon fetch may take in all, near and far together.
const ICON_TIME: Duration = Duration::from_secs(8);

/// `near` is whether the icon is on the page's own host.
/// Fetches an icon, reading no more of the body than an icon may be: a non-image answer or one
/// that says it is too large is dropped before its body is read, and a body that turns out too
/// large is dropped as soon as it passes the limit.
async fn fetch_icon(clients: &IconClients, near: bool, url: Url, app: Option<&Url>) -> Option<String> {
    fetch_icon_within(clients, near, url, app, ICON_TIME).await
}

/// The fetch under one overall time limit: each request's own timeout runs until its body is
/// read, and the far request after a hand-off gets only what the near one left. The redirect cap
/// is per client, so a hand-off can take up to twice `ICON_HOPS` hops, all inside the limit.
async fn fetch_icon_within(clients: &IconClients, near: bool, url: Url, app: Option<&Url>, limit: Duration) -> Option<String> {
    let start = Instant::now();
    let mut res = if near { &clients.near } else { &clients.far }.get(url).timeout(limit).send().await.ok()?;
    if near && res.status().is_redirection() {
        // The near client stopped at a redirect off the page's host: the rest is the far client's.
        let next = hand_off(res.url(), res.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()), app)?;
        let left = time_left(start.elapsed(), limit)?;
        res = clients.far.get(next).timeout(left).send().await.ok()?;
    }
    let mut res = res.error_for_status().ok()?;
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
fn icon_for(app: AppHandle, dev: Option<Url>, id: u32, page: String, url: Url, near: bool) {
    let step = ICONS.lock().map(|mut i| i.begin(id, url.as_str())).unwrap_or(IconStep::Busy);
    match step {
        IconStep::Busy => {}
        IconStep::Have(icon) => {
            let _ = app.emit(ICON_EVENT, IconPayload { id, page, icon });
        }
        IconStep::Fetch => {
            tauri::async_runtime::spawn(async move {
                let icon = match icon_client(dev.clone()) {
                    Some(clients) => fetch_icon(clients, near, url.clone(), dev.as_ref()).await,
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
    // `tauri.localhost.` is the same host as `tauri.localhost` (council FIX-2, AFTER 5).
    let host = url.host_str().unwrap_or_default().trim_end_matches('.');
    let app_own = |a: &Url| a.scheme() == url.scheme() && a.port_or_known_default() == url.port_or_known_default() && a.host_str().map(|h| h.trim_end_matches('.')) == Some(host);
    if host.ends_with(".localhost") || app.is_some_and(app_own) {
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
#[allow(clippy::too_many_arguments)] // a Tauri command takes its arguments one by one
pub async fn browser_open(app: AppHandle, window: tauri::Window, webview: Webview, id: u32, url: String, spot: Spot, background: Option<[u8; 3]>, shown: Option<bool>) -> Result<(), String> {
    let url = parse(&url)?;
    let _ = APP.set(app.clone()); // T-195: the command line's browser commands need the app
    let _ = DRIVER.set(Box::new(drive));
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
            if let Some((url, front)) = new_window(&url, window_dev.as_ref(), &PAGE_TABS, is_shown(id), Instant::now()) {
                let _ = window_app.emit(LINK_EVENT, LinkPayload { id, url, front });
            }
            NewWindowResponse::Deny
        })
        .on_navigation(move |url| match navigation(url, dev.as_ref(), &PAGE_TABS, is_shown(id), Instant::now()) {
            Nav::Load(go) => go,
            Nav::Link(url, front) => {
                let _ = chord_app.emit(LINK_EVENT, LinkPayload { id, url, front });
                false
            }
            Nav::Chord(what) => {
                // Council FIX-3: the keyboard is not moved here. The app tells a chord pressed in
                // the page (its own window does not hold the keyboard) from one the page's script
                // sent, and only a pressed focusAddressBar asks `browser_go("focusApp")`.
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
                    let near = icon_near(&url, &page);
                    icon_for(icon_app.clone(), icon_dev.clone(), id, at.clone(), url, near);
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
    // A new page is laid over its pane; a tab opened behind starts hidden (council FIX-2, AFTER 3),
    // and the pane's bounds keep this true from here on.
    set_shown(id, shown.unwrap_or(true));
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
/// It runs inside the page, so the page's own script can see what is searched for (as a
/// page's own find box would; council T-272-c).
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
    if what == "focusApp" {
        // A focusAddressBar chord pressed in the page: the bar lives in the app's own web view.
        // Council FIX-5: the label "main" is hard-coded here (both lines below), while browser_open
        // adds a page to whichever window called it. That holds today because tauri.conf.json
        // defines one app window with the default label; if a second app window ever hosts a
        // browser pane, pass the calling window in instead.
        focus_app_ok(app.get_window("main").ok_or("no app window")?.is_focused().map_err(err)?)?;
        return app.get_webview("main").ok_or("no app view")?.set_focus().map_err(err);
    }
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
    forget_tab(id);
    if let Ok(mut i) = ICONS.lock() {
        i.forget(id);
    }
    view(&app, id)?.close().map_err(err)
}

/// T-074 (BROW-008, BROW-009): the probe the pane runs about four times a second while a page is
/// on screen. wry reports only that a load started and finished (its NavigationCompleted handler
/// drops the success flag), so the page itself is asked where it is: WebView2's own error page
/// answers `chrome-error://chromewebdata/`, a live page answers its address, and a page whose
/// process died answers nothing (or nothing that is a string). The pane's state machine
/// (src/browser/loadState.ts) turns the answers into the overlay and the one automatic reload.
const PROBE_QUERY: &str = "location.href";
/// How long a probe waits for the page before it counts as unanswered. A page running a long
/// script answers late, not never; three unanswered probes in a row count as a dead page.
const PROBE_WAIT: Duration = Duration::from_millis(1500);
/// How long the diagnosis waits for a connection or a TLS answer from a failed address.
const DIAGNOSE_WAIT: Duration = Duration::from_secs(4);

/// What the probe's answer (the JSON `eval_with_callback` hands back) says about the page.
pub fn probe_result(answer: &str) -> &'static str {
    match serde_json::from_str::<serde_json::Value>(answer) {
        Ok(serde_json::Value::String(href)) if href.starts_with("chrome-error://") => "error-page",
        Ok(serde_json::Value::String(_)) => "page",
        _ => "no-answer",
    }
}

/// Asks a tab's page where it is: `"page"`, `"error-page"` or `"no-answer"` (see `probe_result`).
// Registered by evidence/browser-T-074-lib.rs.patch (lib.rs is a shared file); drop this allow once applied.
#[allow(dead_code)]
#[tauri::command]
pub async fn browser_probe(app: AppHandle, id: u32) -> Result<&'static str, String> {
    let v = view(&app, id)?;
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    if v.eval_with_callback(PROBE_QUERY, move |answer| {
        let _ = tx.send(answer);
    })
    .is_err()
    {
        return Ok("no-answer");
    }
    let answer = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(PROBE_WAIT).ok()).await.map_err(|e| e.to_string())?;
    Ok(answer.as_deref().map_or("no-answer", probe_result))
}

// ---------------------------------------------------------------- T-195: agents and notes drive the tab

/// The app, for the browser commands of the command line (BROW-042): cli.rs answers requests on
/// a thread of its own with no handle to the app, so the first tab opened leaves one here.
static APP: OnceLock<AppHandle> = OnceLock::new();

/// An open tab as its pane reports it (`browser_tab`): whose worktree it belongs to and whether it
/// is the one on screen in its split. `seen` orders the tabs by when they were last on screen.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tab {
    pub id: u32,
    pub worktree: Option<String>,
    pub shown: bool,
    pub seen: u64,
}

static TABS: Mutex<Vec<Tab>> = Mutex::new(Vec::new());
static TICK: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// How long a page command may take before the tab counts as not answering (a long script
/// answers late; `wait` asks again).
pub const EVAL_WAIT: Duration = Duration::from_millis(3000);
/// Two unanswered page commands in a row and the page's helper is dropped, so the next command
/// installs a fresh one (BROW-042: a stuck helper restarts).
const EVAL_STRIKES: u8 = 2;
static STRIKES: Mutex<Vec<(u32, u8)>> = Mutex::new(Vec::new());

pub fn tabs() -> Vec<Tab> {
    TABS.lock().map(|t| t.clone()).unwrap_or_default()
}

/// Records a tab's worktree and whether it is on screen; a tab on screen is the most recently seen.
pub fn note_tab(tabs: &mut Vec<Tab>, id: u32, worktree: Option<String>, shown: bool, tick: u64) {
    let seen = if shown { tick } else { tabs.iter().find(|t| t.id == id).map_or(0, |t| t.seen) };
    match tabs.iter_mut().find(|t| t.id == id) {
        Some(t) => {
            t.worktree = worktree;
            t.shown = shown;
            t.seen = seen;
        }
        None => tabs.push(Tab { id, worktree, shown, seen }),
    }
}

fn forget_tab(id: u32) {
    if let Ok(mut t) = TABS.lock() {
        t.retain(|t| t.id != id);
    }
    if let Ok(mut s) = STRIKES.lock() {
        s.retain(|s| s.0 != id);
    }
}

/// Two spellings of one folder: the real path when it exists, else the text with slashes and
/// case made alike (Windows paths).
pub fn same_dir(a: &str, b: &str) -> bool {
    fn norm(p: &str) -> String {
        let real = std::path::Path::new(p).canonicalize().map(|r| r.to_string_lossy().to_string()).unwrap_or_else(|_| p.to_string());
        real.replace('\\', "/").trim_end_matches('/').to_lowercase()
    }
    norm(a) == norm(b)
}

/// BROW-042: which tab a command goes to. `--page` names one (a tab its pane has reported);
/// otherwise the worktree's tab on screen, else the one last on screen there. Tabs the panes have
/// not described yet (none carry a worktree) count for any worktree.
pub fn pick_tab(tabs: &[Tab], page: Option<u32>, worktree: Option<&str>) -> Result<u32, String> {
    if let Some(id) = page {
        return if tabs.iter().any(|t| t.id == id) { Ok(id) } else { Err(format!("browser tab {id} is not open")) };
    }
    let best = |set: &[&Tab]| set.iter().find(|t| t.shown).or_else(|| set.iter().max_by_key(|t| t.seen)).map(|t| t.id);
    let all: Vec<&Tab> = tabs.iter().collect();
    let Some(wt) = worktree else {
        return best(&all).ok_or_else(|| "no browser tab is open".to_string());
    };
    let mine: Vec<&Tab> = tabs.iter().filter(|t| t.worktree.as_deref().is_some_and(|w| same_dir(w, wt))).collect();
    if let Some(id) = best(&mine) {
        return Ok(id);
    }
    if tabs.iter().all(|t| t.worktree.is_none()) {
        if let Some(id) = best(&all) {
            return Ok(id);
        }
    }
    Err(format!("no browser tab is open in {wt}"))
}

/// The pane says which worktree its tab belongs to and whether it is on screen (BROW-042).
// Registered by evidence/browser-T-195-lib.rs.patch (lib.rs is a shared file); drop this allow once applied.
#[allow(dead_code)]
#[tauri::command]
pub async fn browser_tab(id: u32, worktree: Option<String>, shown: bool) -> Result<(), String> {
    let tick = TICK.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let mut t = TABS.lock().map_err(|e| e.to_string())?;
    note_tab(&mut t, id, worktree, shown, tick);
    Ok(())
}

/// What the command line asks of a page. The code that reaches the web view sits behind this
/// hook, set when the first tab opens, so cli.rs never links it directly: a test binary that links
/// the window toolkit cannot load without the app's manifest (comctl32 v6), and cli.rs's tests
/// call dispatch.
pub enum Act<'a> {
    Eval(u32, &'a str, Duration),
    Navigate(u32, &'a str),
    Go(u32, &'a str),
}
type Driver = dyn Fn(Act) -> Result<serde_json::Value, String> + Send + Sync;
static DRIVER: OnceLock<Box<Driver>> = OnceLock::new();

fn driver() -> Result<&'static Driver, String> {
    DRIVER.get().map(|d| d.as_ref()).ok_or_else(|| "no browser tab has been opened yet".to_string())
}

/// The driver behind the hook: the one place the command line's work touches a web view.
fn drive(act: Act) -> Result<serde_json::Value, String> {
    let app = APP.get().ok_or("no browser tab has been opened yet")?;
    match act {
        Act::Eval(id, script, wait) => {
            let v = view(app, id)?;
            let (tx, rx) = std::sync::mpsc::channel::<String>();
            v.eval_with_callback(script, move |answer| {
                let _ = tx.send(answer);
            })
            .map_err(err)?;
            match rx.recv_timeout(wait) {
                Ok(answer) => {
                    if let Ok(mut s) = STRIKES.lock() {
                        s.retain(|s| s.0 != id);
                    }
                    serde_json::from_str(&answer).map_err(|_| "the page answered with something that is not JSON".to_string())
                }
                Err(_) => {
                    let strikes = STRIKES.lock().map(|mut s| match s.iter_mut().find(|s| s.0 == id) {
                        Some(s) => {
                            s.1 += 1;
                            s.1
                        }
                        None => {
                            s.push((id, 1));
                            1
                        }
                    });
                    if strikes.is_ok_and(|n| n >= EVAL_STRIKES) {
                        let _ = v.eval("delete window.__kx; delete window.__kxa");
                        if let Ok(mut s) = STRIKES.lock() {
                            s.retain(|s| s.0 != id);
                        }
                    }
                    Err(format!("browser tab {id} did not answer within {} ms", wait.as_millis()))
                }
            }
        }
        Act::Navigate(id, url) => {
            // `kolux goto`: the same gate as the address bar (T-500), then the page goes there.
            let url = parse(url)?;
            allowed(&url, app_origin(app).as_ref())?;
            let to = url.to_string();
            view(app, id)?.navigate(url).map_err(err)?;
            Ok(serde_json::Value::String(to))
        }
        Act::Go(id, what) => {
            let v = view(app, id)?;
            match what {
                "reload" => v.reload().map_err(err)?,
                _ => v.eval(script(what).ok_or_else(|| format!("unknown browser action {what}"))?).map_err(err)?,
            }
            Ok(serde_json::Value::Null)
        }
    }
}

/// Runs a script in a tab's page and hands back the JSON it completes with. Blocking: it waits for
/// the page's answer, so it runs on the command line's thread or under `spawn_blocking`, never on
/// the app's main thread (which delivers the answer).
pub fn eval_json(id: u32, script: &str, wait: Duration) -> Result<serde_json::Value, String> {
    driver()?(Act::Eval(id, script, wait))
}

/// `kolux goto`; the answer is the address the page was sent to.
pub fn navigate_to(id: u32, url: &str) -> Result<String, String> {
    driver()?(Act::Navigate(id, url)).map(|v| v.as_str().unwrap_or_default().to_string())
}

/// `kolux back|forward|reload`.
pub fn go(id: u32, what: &str) -> Result<(), String> {
    driver()?(Act::Go(id, what)).map(|_| ())
}

/// BROW-037: the picker that runs in the page while the user annotates it. A hover outlines the
/// element under the pointer; a click is taken (the page does not get it) and queued as a pick:
/// a selector, the element's path, its text, its data-* hints, the React component chain and
/// source location when the page carries them, and the computed styles that matter. `poll` drains
/// the queue; `stop` takes the picker out again.
const ANNOTATE_START: &str = r#"(function(){
if(window.__kxa) return {ok:true,active:true};
const A={q:[]};
const box=document.createElement('div'); box.setAttribute('data-kx-annotate',''); box.style.cssText='position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #ff5a00;background:rgba(255,90,0,.08);border-radius:2px;transition:all .05s;display:none';
(document.body||document.documentElement).appendChild(box);
const sel=e=>{ if(e.id&&document.querySelectorAll('#'+CSS.escape(e.id)).length===1) return '#'+CSS.escape(e.id); const tid=e.getAttribute('data-testid'); if(tid) return '[data-testid="'+tid+'"]';
 const parts=[]; let n=e; while(n&&n.nodeType===1&&parts.length<5){ let p=n.tagName.toLowerCase(); if(n.id){ parts.unshift('#'+CSS.escape(n.id)); break; } const sib=[...(n.parentElement?n.parentElement.children:[])].filter(c=>c.tagName===n.tagName); if(sib.length>1) p+=':nth-of-type('+(sib.indexOf(n)+1)+')'; parts.unshift(p); n=n.parentElement; } return parts.join(' > '); };
const path=e=>{ const out=[]; let n=e; while(n&&n.nodeType===1&&out.length<8){ out.unshift(n.tagName.toLowerCase()+(n.id?'#'+n.id:'')+(n.classList.length?'.'+[...n.classList].slice(0,2).join('.'):'')); n=n.parentElement; } return out.join(' > '); };
const react=e=>{ const k=Object.keys(e).find(k=>k.startsWith('__reactFiber$')||k.startsWith('__reactInternalInstance$')); if(!k) return {}; let f=e[k]; const chain=[]; let src=null;
 while(f&&chain.length<6){ const t=f.type; if(t&&typeof t!=='string'){ const nm=t.displayName||t.name||(t.render&&(t.render.displayName||t.render.name)); if(nm) chain.push(nm); } if(!src&&f._debugSource) src=f._debugSource.fileName+':'+f._debugSource.lineNumber; f=f.return; }
 return {component:chain.length?chain.join(' < '):undefined,source:src||undefined}; };
const styles=e=>{ const s=getComputedStyle(e); const out={}; for(const k of ['color','background-color','font-size','font-family','font-weight','padding','margin','border','display']){ const v=s.getPropertyValue(k); if(v&&v!=='none'&&v!=='normal'&&v!=='0px') out[k]=v; } return out; };
const hints=e=>{ const out={}; for(const a of e.attributes){ if(a.name.startsWith('data-')||a.name.startsWith('aria-')||a.name==='role'||a.name==='name'||a.name==='href'||a.name==='type'||a.name==='class') out[a.name]=a.value.slice(0,200); } return out; };
A.move=ev=>{ const e=ev.target; if(!(e instanceof Element)||e===box){ return; } const r=e.getBoundingClientRect(); box.style.display='block'; box.style.left=r.left+'px'; box.style.top=r.top+'px'; box.style.width=r.width+'px'; box.style.height=r.height+'px'; };
A.click=ev=>{ ev.preventDefault(); ev.stopImmediatePropagation(); const e=ev.target; if(!(e instanceof Element)) return; const r=e.getBoundingClientRect(); const rx=react(e);
 A.q.push({selector:sel(e),path:path(e),tag:e.tagName.toLowerCase(),text:((e.innerText||e.textContent||'').trim().replace(/\s+/g,' ')).slice(0,200),component:rx.component,source:rx.source,hints:hints(e),styles:styles(e),box:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)},url:location.href}); };
A.swallow=ev=>{ ev.preventDefault(); ev.stopImmediatePropagation(); };
A.key=ev=>{ if(ev.key==='Escape'){ ev.preventDefault(); ev.stopImmediatePropagation(); A.q.push({escape:true}); } };
document.addEventListener('mousemove',A.move,true); document.addEventListener('click',A.click,true); document.addEventListener('mousedown',A.swallow,true); document.addEventListener('mouseup',A.swallow,true); document.addEventListener('keydown',A.key,true);
A.box=box; window.__kxa=A; return {ok:true,active:true};
})()"#;
const ANNOTATE_POLL: &str = "(function(){ const a=window.__kxa; if(!a) return {active:false,picks:[]}; return {active:true,picks:a.q.splice(0)}; })()";
const ANNOTATE_STOP: &str = "(function(){ const a=window.__kxa; if(!a) return {ok:true,active:false}; document.removeEventListener('mousemove',a.move,true); document.removeEventListener('click',a.click,true); document.removeEventListener('mousedown',a.swallow,true); document.removeEventListener('mouseup',a.swallow,true); document.removeEventListener('keydown',a.key,true); a.box.remove(); delete window.__kxa; return {ok:true,active:false}; })()";

/// The picker's script for `start`, `poll` or `stop`.
pub fn annotate_script(what: &str) -> Option<&'static str> {
    match what {
        "start" => Some(ANNOTATE_START),
        "poll" => Some(ANNOTATE_POLL),
        "stop" => Some(ANNOTATE_STOP),
        _ => None,
    }
}

/// BROW-037: starts, polls or stops the page picker in a tab; `poll` answers `{active, picks}`.
// Registered by evidence/browser-T-195-lib.rs.patch (lib.rs is a shared file); drop this allow once applied.
#[allow(dead_code)]
#[tauri::command]
pub async fn browser_annotate(app: AppHandle, id: u32, what: String) -> Result<serde_json::Value, String> {
    let _ = APP.set(app);
    let script = annotate_script(&what).ok_or_else(|| format!("unknown annotate step {what}"))?;
    tauri::async_runtime::spawn_blocking(move || eval_json(id, script, EVAL_WAIT)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod agent_tests {
    use super::*;

    fn tab(id: u32, worktree: Option<&str>, shown: bool, seen: u64) -> Tab {
        Tab { id, worktree: worktree.map(str::to_string), shown, seen }
    }

    #[test]
    fn brow042_the_worktrees_tab_on_screen_else_its_last_seen_else_a_clear_refusal() {
        let tabs = vec![tab(1, Some("G:/wt/a"), false, 5), tab(2, Some("G:/wt/a"), true, 7), tab(3, Some("G:/wt/b"), false, 9)];
        assert_eq!(pick_tab(&tabs, None, Some("G:/wt/a")), Ok(2));
        assert_eq!(pick_tab(&tabs, None, Some("g:\\wt\\b\\")), Ok(3), "spellings of one folder match");
        assert_eq!(pick_tab(&tabs, None, Some("G:/wt/c")), Err("no browser tab is open in G:/wt/c".into()));
        assert_eq!(pick_tab(&tabs, None, None), Ok(2));
        assert_eq!(pick_tab(&[tab(1, Some("G:/wt/a"), false, 5), tab(4, Some("G:/wt/a"), false, 8)], None, Some("G:/wt/a")), Ok(4), "none on screen: the last seen");
        assert_eq!(pick_tab(&tabs, Some(3), Some("G:/wt/a")), Ok(3), "--page wins");
        assert_eq!(pick_tab(&tabs, Some(9), None), Err("browser tab 9 is not open".into()));
        assert_eq!(pick_tab(&[], None, None), Err("no browser tab is open".into()));
        // Panes that have not reported a worktree yet: their tabs serve any worktree.
        assert_eq!(pick_tab(&[tab(1, None, true, 1)], None, Some("G:/wt/a")), Ok(1));
    }

    #[test]
    fn brow042_the_registry_keeps_one_row_per_tab_and_orders_by_last_shown() {
        let mut tabs = Vec::new();
        note_tab(&mut tabs, 1, Some("G:/wt/a".into()), true, 1);
        note_tab(&mut tabs, 2, Some("G:/wt/a".into()), true, 2);
        note_tab(&mut tabs, 1, Some("G:/wt/a".into()), false, 3);
        assert_eq!(tabs, vec![tab(1, Some("G:/wt/a"), false, 1), tab(2, Some("G:/wt/a"), true, 2)]);
        note_tab(&mut tabs, 2, None, false, 4);
        assert_eq!(tabs[1], tab(2, None, false, 2), "hidden keeps the last time it was seen");
        assert!(same_dir("G:/x/y", "g:\\x\\y\\") && !same_dir("G:/x/y", "G:/x/z"));
    }

    #[test]
    fn brow037_the_picker_scripts_queue_picks_and_can_be_taken_out() {
        assert!(annotate_script("start").unwrap().contains("window.__kxa=A"));
        assert!(annotate_script("poll").unwrap().contains("a.q.splice(0)"));
        assert!(annotate_script("stop").unwrap().contains("delete window.__kxa"));
        assert_eq!(annotate_script("peek"), None);
        for ev in ["mousemove", "click", "mousedown", "mouseup", "keydown"] {
            assert!(ANNOTATE_START.contains(&format!("addEventListener('{ev}'")), "{ev} is taken while picking");
            assert!(ANNOTATE_STOP.contains(&format!("removeEventListener('{ev}'")), "{ev} is given back");
        }
        for field in ["selector:", "path:", "component:", "source:", "hints:", "styles:", "box:"] {
            assert!(ANNOTATE_START.contains(field), "a pick carries {field}");
        }
    }

    // eval_json, navigate_to and go are not called from tests: linking them pulls the window
    // toolkit into the test binary, which then needs the app's manifest (comctl32 v6) to load.
}

/// Why an address failed, for the overlay's wording (BROW-008).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Diagnosis {
    /// `unknown-host`, `refused`, `timeout`, `unreachable`, `certificate` or `unknown`.
    pub kind: &'static str,
    /// The address is this computer's (local-server advice makes sense).
    pub local: bool,
    /// The same address over https when the switch makes sense: a failed http address that is not
    /// this computer's, with nothing but the scheme changed.
    pub https: Option<String>,
}

/// The TLS error text names a certificate problem (native-tls and the OS wording vary).
pub fn certificate_error(text: &str) -> bool {
    let t = text.to_ascii_lowercase();
    ["certificate", "self-signed", "self signed", "x509", "cert_", "untrusted root"].iter().any(|w| t.contains(w))
}

/// Names what failed from the three checks: name lookup, a TCP connection, and (https only) the
/// TLS handshake's error text when the connection itself worked.
pub fn failure_kind(dns_ok: bool, tcp: Option<std::io::ErrorKind>, tls: Option<&str>) -> &'static str {
    use std::io::ErrorKind as K;
    if !dns_ok {
        return "unknown-host";
    }
    match tcp {
        Some(K::ConnectionRefused) => "refused",
        Some(K::TimedOut | K::WouldBlock) => "timeout",
        Some(_) => "unreachable",
        None => match tls {
            Some(t) if certificate_error(t) => "certificate",
            _ => "unknown",
        },
    }
}

/// The https twin of a failed http address (BROW-008): scheme only, and never for this
/// computer's addresses, where https is rarely served.
pub fn https_twin(url: &Url) -> Option<String> {
    if url.scheme() != "http" || local_host(url) {
        return None;
    }
    let mut u = url.clone();
    u.set_scheme("https").ok()?;
    Some(u.to_string())
}

/// Name lookup and one TCP connection to the address (blocking): whether the name resolved, and
/// the error kind of the last connection attempt when none succeeded.
pub fn reach(url: &Url) -> (bool, Option<std::io::ErrorKind>) {
    let Ok(addrs) = url.socket_addrs(|| None) else { return (false, None) };
    if addrs.is_empty() {
        return (false, None);
    }
    let mut last = None;
    for a in addrs {
        match std::net::TcpStream::connect_timeout(&a, DIAGNOSE_WAIT) {
            Ok(_) => return (true, None),
            Err(e) => last = Some(e.kind()),
        }
    }
    (true, last)
}

fn error_text(e: &(dyn std::error::Error + 'static)) -> String {
    let mut out = e.to_string();
    let mut cur = e.source();
    while let Some(s) = cur {
        out.push_str(" / ");
        out.push_str(&s.to_string());
        cur = s.source();
    }
    out
}

/// Looks at why `url` failed to load, for the overlay's wording. The address passes the same
/// check as a page load (`allowed`), so a page cannot aim this at the user's own network.
// Registered by evidence/browser-T-074-lib.rs.patch (lib.rs is a shared file); drop this allow once applied.
#[allow(dead_code)]
#[tauri::command]
pub async fn browser_diagnose(app: AppHandle, url: String) -> Result<Diagnosis, String> {
    let url = parse(&url)?;
    allowed(&url, app_origin(&app).as_ref())?;
    let (local, https) = (local_host(&url), https_twin(&url));
    let probe = url.clone();
    let (dns_ok, tcp) = tauri::async_runtime::spawn_blocking(move || reach(&probe)).await.map_err(|e| e.to_string())?;
    let mut tls = None;
    if dns_ok && tcp.is_none() && url.scheme() == "https" {
        // Strict checking, as the page's own load: a certificate the OS does not trust fails here too.
        if let Ok(client) = reqwest::Client::builder().timeout(DIAGNOSE_WAIT).no_proxy().redirect(reqwest::redirect::Policy::none()).build() {
            if let Err(e) = client.head(url.as_str()).send().await {
                tls = Some(error_text(&e));
            }
        }
    }
    Ok(Diagnosis { kind: failure_kind(dns_ok, tcp, tls.as_deref()), local, https })
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
        assert!(icon_address(r#""http://192.168.1.5/f.ico""#, None, &lan).is_some());
        // Council FIX-4, AFTER 2 (flipped): the same host on another port is another service.
        assert_eq!(icon_address(r#""http://192.168.1.5:8080/f.ico""#, None, &lan), None);
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
        let clients = icon_clients(None, system_lookup).unwrap();
        let fetch = |url: Url| tauri::async_runtime::block_on(fetch_icon(&clients, true, url, None));
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
        let clients = icon_clients(None, system_lookup).unwrap();
        assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, true, url, None)), None);
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
        // A redirect within the host and port the chain started on is followed (council FIX-4,
        // AFTER 2: another port of that host is refused, fix4_2_a_same_host_redirect_...).
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = Url::parse(&format!("http://127.0.0.1:{}/favicon.ico", l.local_addr().unwrap().port())).unwrap();
        let server = std::thread::spawn(move || {
            let answers: [&[u8]; 2] = [
                b"HTTP/1.1 302 Found\r\nLocation: /real.png\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\nConnection: close\r\n\r\n\x07\x07\x07",
            ];
            let mut asked = Vec::new();
            for answer in answers {
                let (mut s, _) = l.accept().unwrap();
                let (mut buf, mut got) = ([0u8; 4096], Vec::new());
                while !got.windows(4).any(|w| w == b"\r\n\r\n") {
                    match s.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => got.extend_from_slice(&buf[..n]),
                    }
                }
                asked.push(String::from_utf8_lossy(&got).lines().next().unwrap_or_default().to_string());
                let _ = s.write_all(answer);
            }
            asked
        });
        assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, true, url, None)), Some("data:image/png;base64,BwcH".into()));
        assert_eq!(server.join().unwrap(), ["GET /favicon.ico HTTP/1.1", "GET /real.png HTTP/1.1"]);
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

    // Council FIX-2, FS1: a tab that is not on screen cannot have a user gesture, so it opens no
    // tab, sends no chord and takes nothing from the allowance the user's own clicks share.
    #[test]
    fn fix2_a_a_hidden_tab_opens_nothing_sends_no_chord_and_leaves_the_allowance() {
        let now = Instant::now();
        let tabs = Mutex::new(Allowance::default());
        let front = Url::parse("kolux-chord:open-front?u=https%3A%2F%2Fexample.com%2F").unwrap();
        let back = Url::parse("kolux-chord:open-back?u=https%3A%2F%2Fexample.com%2F").unwrap();
        let web = Url::parse("https://example.com/").unwrap();
        for _ in 0..100 {
            assert_eq!(navigation(&front, None, &tabs, false, now), Nav::Load(false));
            assert_eq!(navigation(&back, None, &tabs, false, now), Nav::Load(false));
            assert_eq!(new_window(&web, None, &tabs, false, now), None);
            for what in CHORDS {
                let chord = Url::parse(&format!("kolux-chord:{what}")).unwrap();
                assert_eq!(navigation(&chord, None, &tabs, false, now), Nav::Load(false), "{what}");
            }
        }
        // The hidden storm took nothing: a shown tab's real clicks still get the whole allowance.
        for _ in 0..TABS_ALLOWED - 1 {
            assert_eq!(navigation(&back, None, &tabs, true, now), Nav::Link("https://example.com/".into(), false));
        }
        assert_eq!(new_window(&web, None, &tabs, true, now), Some(("https://example.com/".into(), true)));
        assert_eq!(navigation(&front, None, &tabs, true, now + TABS_WINDOW), Nav::Link("https://example.com/".into(), true));
        assert_eq!(navigation(&Url::parse("kolux-chord:focusAddressBar").unwrap(), None, &tabs, true, now), Nav::Chord("focusAddressBar"));
        // A hidden tab still loads ordinary pages and still refuses the app's own.
        assert_eq!(navigation(&web, None, &tabs, false, now), Nav::Load(true));
        assert_eq!(navigation(&Url::parse("http://tauri.localhost/").unwrap(), None, &tabs, false, now), Nav::Load(false));
    }

    /// An icon server on a loopback port that answers every request with a 3-byte image; the
    /// count is how many connections reached it.
    fn icon_server() -> (u16, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let hits = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let seen = hits.clone();
        std::thread::spawn(move || {
            for s in l.incoming() {
                let Ok(mut s) = s else { continue };
                seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let (mut buf, mut got) = ([0u8; 4096], Vec::new());
                while !got.windows(4).any(|w| w == b"\r\n\r\n") {
                    match s.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => got.extend_from_slice(&buf[..n]),
                    }
                }
                let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\nConnection: close\r\n\r\n\x07\x07\x07");
            }
        });
        (port, hits)
    }

    /// A stand-in lookup: every name is this machine (what nip.io, localtest.me or a rebound
    /// name answers), so no test ever asks the real network.
    fn to_this_machine(_: &str) -> std::io::Result<Vec<IpAddr>> {
        Ok(vec![IpAddr::from([127, 0, 0, 1])])
    }

    // Council FIX-2, FS2.
    #[test]
    fn fix2_b_a_public_name_that_resolves_to_this_machine_is_never_asked() {
        use std::sync::atomic::Ordering;
        let (port, hits) = icon_server();
        let clients = icon_clients(None, to_this_machine).unwrap();
        for name in ["192-168-1-1.nip.io", "localtest.me", "rebound.example.com"] {
            let url = Url::parse(&format!("http://{name}:{port}/favicon.ico")).unwrap();
            assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, false, url, None)), None, "{name}");
        }
        assert_eq!(hits.load(Ordering::SeqCst), 0, "an icon fetch reached this machine through a public name");
        // Council FIX-3: a page on that very public name gets no icon from there either (a name
        // rebound after the page loaded would take the fetch onto this machine).
        let own = Url::parse(&format!("http://localtest.me:{port}/favicon.ico")).unwrap();
        let page = Url::parse(&format!("http://localtest.me:{port}/")).unwrap();
        assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, icon_near(&own, &page), own, None)), None);
        assert_eq!(hits.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn fix2_b_a_redirect_off_the_pages_own_host_goes_through_the_public_lookup() {
        use std::sync::atomic::Ordering;
        let (port, hits) = icon_server();
        let clients = icon_clients(None, to_this_machine).unwrap();
        let (url, first) = answer_once(format!("HTTP/1.1 302 Found\r\nLocation: http://lan-box.example:{port}/x.png\r\nContent-Length: 0\r\n\r\n"), 0);
        assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, true, url, None)), None);
        first.join().unwrap();
        assert_eq!(hits.load(Ordering::SeqCst), 0, "the redirect reached this machine through a public name");
    }

    #[test]
    fn fix2_b_the_public_lookup_keeps_only_public_addresses() {
        let ip = |s: &str| s.parse::<IpAddr>().unwrap();
        let all = [
            "127.0.0.1", "192.168.1.1", "10.0.0.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::5",
            "::ffff:10.0.0.1", "::7f00:1", "8.8.8.8", "2001:db8::1",
        ];
        assert_eq!(public_addrs(all.map(ip).to_vec()), vec![ip("8.8.8.8"), ip("2001:db8::1")]);
    }

    // Council FIX-2, AFTER 4 and 5.
    #[test]
    fn fix2_c_ipv4_compatible_addresses_and_a_trailing_dot_are_caught() {
        let u = |s: &str| Url::parse(s).unwrap();
        for s in ["http://[::7f00:1]/", "http://[::a00:1]/", "http://[::c0a8:101]/"] {
            assert!(local_host(&u(s)), "{s}");
        }
        assert!(!local_host(&u("http://[::808:808]/")));
        let public = u("https://example.com/");
        assert_eq!(icon_address(r#""http://[::7f00:1]:8745/x""#, None, &public), None);
        assert!(allowed(&u("http://tauri.localhost./"), None).is_err());
        assert!(allowed(&u("http://ipc.localhost./x"), None).is_err());
        let app = u("http://localhost:1420");
        assert!(allowed(&u("http://localhost.:1420/"), Some(&app)).is_err());
        assert!(allowed(&u("http://localhost:3000/"), Some(&app)).is_ok());
        assert!(allowed(&u("https://example.com./"), Some(&app)).is_ok());
    }

    // Council FIX-2, AFTER 2: `?r=random` on every reload cannot fan out icon fetches.
    #[test]
    fn fix2_c_a_tab_has_one_icon_fetch_at_a_time() {
        let mut i = Icons::default();
        assert_eq!(i.begin(1, "https://example.com/i.png?r=1"), IconStep::Fetch);
        for n in 2..50 {
            assert_eq!(i.begin(1, &format!("https://example.com/i.png?r={n}")), IconStep::Busy, "{n}");
        }
        assert_eq!(i.begin(2, "https://example.com/i.png?r=1"), IconStep::Fetch);
        i.end(1, "https://example.com/i.png?r=1", None);
        assert_eq!(i.begin(1, "https://example.com/i.png?r=9"), IconStep::Fetch);
    }

    // Council FIX-3, FIX-BEFORE 1: DNS rebinding through the page's own name, on any port.
    #[test]
    fn fix3_1_a_public_pages_own_name_goes_through_the_public_lookup_on_any_port() {
        use std::sync::atomic::Ordering;
        let (port, hits) = icon_server();
        let clients = icon_clients(None, to_this_machine).unwrap();
        for (page, icon) in [
            ("http://rb.example/".to_string(), format!("http://rb.example:{port}/x")),
            ("https://rb.example/".to_string(), format!("http://rb.example:{port}/x")),
            (format!("http://rb.example:{port}/"), format!("http://rb.example:{port}/favicon.ico")),
        ] {
            let (page, icon) = (Url::parse(&page).unwrap(), Url::parse(&icon).unwrap());
            assert!(!icon_near(&icon, &page), "{page} {icon}");
            assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, icon_near(&icon, &page), icon, None)), None);
        }
        assert_eq!(hits.load(Ordering::SeqCst), 0, "a rebound public name reached this machine");
        // A page that is itself on this machine or the local network still gets its own icon.
        let page = Url::parse(&format!("http://localhost:{port}/app")).unwrap();
        let icon = Url::parse(&format!("http://localhost:{port}/favicon.ico")).unwrap();
        assert!(icon_near(&icon, &page));
        assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, true, icon, None)), Some("data:image/png;base64,BwcH".into()));
        assert_eq!(hits.load(Ordering::SeqCst), 1);
        assert!(!icon_near(&Url::parse("http://other.lan/x").unwrap(), &Url::parse("http://box.lan/").unwrap()));
    }

    // Council FIX-3, AFTER 1.
    #[test]
    fn fix3_3_translation_and_reserved_ranges_are_local() {
        let ip = |s: &str| s.parse::<IpAddr>().unwrap();
        let local = [
            "64:ff9b::7f00:1", "64:ff9b::808:808", "64:ff9b:1::1", "64:ff9b:1:ffff::1", "2002:c0a8:101::1", "2002:808:808::1", "fec0::1", "feff::1",
            "198.18.0.1", "198.19.255.255", "192.0.0.8", "240.0.0.1", "255.255.255.254",
        ];
        for s in local {
            assert!(local_ip(ip(s)), "{s}");
        }
        let public = ["198.17.255.255", "198.20.0.1", "192.0.1.1", "64:ff9c::1", "64:ff9b:2::1", "2003::1", "fe00::1", "8.8.8.8"];
        for s in public {
            assert!(!local_ip(ip(s)), "{s}");
        }
        let mut all: Vec<IpAddr> = local.map(ip).to_vec();
        all.push(ip("8.8.8.8"));
        assert_eq!(public_addrs(all), vec![ip("8.8.8.8")]);
    }

    // Council FIX-3, AFTER 2 (review "Tests"): the hand-off from the near client to the far one.
    #[test]
    fn fix3_3_a_redirect_off_the_pages_host_is_handed_on_under_the_hop_rule() {
        let u = |s: &str| Url::parse(s).unwrap();
        let from = u("https://example.com/favicon.ico");
        assert_eq!(hand_off(&from, Some("/i.png"), None), Some(u("https://example.com/i.png")));
        assert_eq!(hand_off(&from, Some("https://cdn.example.net/i.png"), None), Some(u("https://cdn.example.net/i.png")));
        assert_eq!(hand_off(&from, Some("//cdn.example.net/i.png"), None), Some(u("https://cdn.example.net/i.png")));
        assert_eq!(hand_off(&from, Some("http://cdn.example.net/i.png"), None), None, "https down to http");
        assert_eq!(hand_off(&from, Some("https://192.168.1.1/"), None), None);
        assert_eq!(hand_off(&from, Some("https://[::7f00:1]/"), None), None);
        assert_eq!(hand_off(&from, Some("https://tauri.localhost/"), None), None);
        assert_eq!(hand_off(&from, Some("file:///C:/Windows/win.ini"), None), None);
        assert_eq!(hand_off(&from, None, None), None);
        let local = u("http://localhost:3000/favicon.ico");
        assert_eq!(hand_off(&local, Some("/real.ico"), None), Some(u("http://localhost:3000/real.ico")));
        assert_eq!(hand_off(&local, Some("http://127.0.0.1:8745/"), None), None);
        assert_eq!(hand_off(&local, Some("http://localhost:1420/x"), Some(&u("http://localhost:1420"))), None);
    }

    // Council FIX-3, AFTER 2: one overall time limit, however the fetch goes.
    #[test]
    fn fix3_3_an_icon_fetch_ends_at_its_time_limit() {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = Url::parse(&format!("http://127.0.0.1:{}/favicon.ico", l.local_addr().unwrap().port())).unwrap();
        let server = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let _ = s.read(&mut [0u8; 4096]);
            let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\n\r\n");
            std::thread::sleep(Duration::from_millis(2500));
            let _ = s.write_all(b"\x07\x07\x07");
        });
        let clients = icon_clients(None, system_lookup).unwrap();
        let start = Instant::now();
        let got = tauri::async_runtime::block_on(fetch_icon_within(&clients, true, url, None, Duration::from_millis(300)));
        let took = start.elapsed();
        assert_eq!(got, None);
        assert!(took < Duration::from_millis(1500), "took {took:?}");
        server.join().unwrap();
    }

    // Council FIX-4, item 3; renamed in FIX-5: this checks only how focus_app_ok maps the window's
    // focus reading to allow or refuse. The wiring in browser_go and Tauri's cached focus state (true
    // while any web view of the window holds the keyboard) are proven by the batched live proof
    // (evidence/browser-FIX-4.txt steps 2-3), not by this test.
    #[test]
    fn fix4_1_focus_app_ok_allows_a_focused_window_and_refuses_an_unfocused_one() {
        assert_eq!(focus_app_ok(true), Ok(()));
        assert!(focus_app_ok(false).is_err());
    }

    // Council FIX-4, AFTER 2: the port counts, so a page on one local port reaches no other.
    #[test]
    fn fix4_2_a_local_page_reaches_no_other_port_of_its_host() {
        let u = |s: &str| Url::parse(s).unwrap();
        assert!(same_spot(&u("http://localhost/"), &u("http://localhost:80/x")));
        assert!(same_spot(&u("https://box.lan/"), &u("https://box.lan:443/i.png")));
        assert!(!same_spot(&u("http://127.0.0.1:3000/"), &u("http://127.0.0.1:8745/")));
        assert!(!same_spot(&u("http://box.lan/"), &u("https://box.lan/")));
        let page = u("http://127.0.0.1:3000/app");
        assert_eq!(icon_address(r#""http://127.0.0.1:3000/favicon.ico""#, None, &page), Some(u("http://127.0.0.1:3000/favicon.ico")));
        assert_eq!(icon_address(r#""http://127.0.0.1:8745/x""#, None, &page), None);
        assert!(!icon_near(&u("http://127.0.0.1:8745/x"), &page));
        let first = u("http://127.0.0.1:3000/favicon.ico");
        assert!(hop_ok(&u("http://127.0.0.1:3000/real.ico"), std::slice::from_ref(&first), None));
        assert!(!hop_ok(&u("http://127.0.0.1:8745/x"), std::slice::from_ref(&first), None));
    }

    #[test]
    fn fix4_2_a_same_host_redirect_to_another_port_is_never_followed() {
        use std::sync::atomic::Ordering;
        let (port, hits) = icon_server();
        let clients = icon_clients(None, to_this_machine).unwrap();
        let (url, first) = answer_once(format!("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{port}/x.png\r\nContent-Length: 0\r\n\r\n"), 0);
        assert_eq!(tauri::async_runtime::block_on(fetch_icon(&clients, true, url, None)), None);
        first.join().unwrap();
        assert_eq!(hits.load(Ordering::SeqCst), 0, "the redirect reached another port of this machine");
    }

    // Council FIX-4, AFTER 3: the far request after a hand-off gets only what is left.
    #[test]
    fn fix4_3_the_far_request_gets_only_what_is_left() {
        let s = Duration::from_secs;
        assert_eq!(time_left(s(0), s(8)), Some(s(8)));
        assert_eq!(time_left(s(3), s(8)), Some(s(5)));
        assert_eq!(time_left(Duration::from_millis(7999), s(8)), Some(Duration::from_millis(1)));
        assert_eq!(time_left(s(8), s(8)), None);
        assert_eq!(time_left(s(9), s(8)), None);
    }
}

#[cfg(test)]
mod t074_tests {
    use super::*;

    #[test]
    fn brow008_the_probe_tells_the_engines_error_page_from_a_page_and_from_silence() {
        assert_eq!(probe_result("\"chrome-error://chromewebdata/\""), "error-page");
        assert_eq!(probe_result("\"https://example.com/a\""), "page");
        assert_eq!(probe_result("\"about:blank\""), "page");
        // A dead page's callback (if it comes at all) carries no string.
        assert_eq!(probe_result("null"), "no-answer");
        assert_eq!(probe_result(""), "no-answer");
        assert_eq!(probe_result("{}"), "no-answer");
    }

    #[test]
    fn brow008_the_failure_kind_names_what_failed() {
        use std::io::ErrorKind as K;
        assert_eq!(failure_kind(false, None, None), "unknown-host");
        assert_eq!(failure_kind(false, Some(K::ConnectionRefused), None), "unknown-host");
        assert_eq!(failure_kind(true, Some(K::ConnectionRefused), None), "refused");
        assert_eq!(failure_kind(true, Some(K::TimedOut), None), "timeout");
        assert_eq!(failure_kind(true, Some(K::Other), None), "unreachable");
        assert_eq!(failure_kind(true, None, Some("error sending request / certificate verify failed: self signed")), "certificate");
        assert_eq!(failure_kind(true, None, Some("The certificate chain was issued by an authority that is not trusted.")), "certificate");
        assert_eq!(failure_kind(true, None, Some("connection reset by peer")), "unknown");
        assert_eq!(failure_kind(true, None, None), "unknown");
    }

    #[test]
    fn brow008_the_https_switch_changes_the_scheme_only_and_never_for_local_or_https() {
        assert_eq!(https_twin(&parse("http://example.com/a?b=1#c").unwrap()), Some("https://example.com/a?b=1#c".into()));
        assert_eq!(https_twin(&parse("http://example.com:8080/").unwrap()), Some("https://example.com:8080/".into()));
        assert_eq!(https_twin(&parse("https://example.com/").unwrap()), None);
        assert_eq!(https_twin(&parse("http://localhost:3000/").unwrap()), None);
        assert_eq!(https_twin(&parse("http://127.0.0.1:9/").unwrap()), None);
        assert_eq!(https_twin(&parse("http://[::1]:9/").unwrap()), None);
    }

    #[test]
    fn brow008_a_closed_local_port_is_refused_and_local_and_an_open_one_is_reached() {
        // Real sockets on this machine: a port nothing listens on, then one that does.
        let gone = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = gone.local_addr().unwrap().port();
        drop(gone);
        let url = parse(&format!("http://127.0.0.1:{port}/")).unwrap();
        let (dns_ok, tcp) = reach(&url);
        assert_eq!(failure_kind(dns_ok, tcp, None), "refused");
        assert!(local_host(&url));
        assert_eq!(https_twin(&url), None);
        let open = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = parse(&format!("http://127.0.0.1:{}/", open.local_addr().unwrap().port())).unwrap();
        assert_eq!(reach(&url), (true, None));
        assert_eq!(failure_kind(true, None, None), "unknown");
        // A name that cannot exist (RFC 6761 .invalid) never resolves.
        assert!(!reach(&parse("http://no-such-host.invalid/").unwrap()).0);
    }

    #[test]
    fn t074_the_diagnosis_serialises_for_the_pane() {
        let d = Diagnosis { kind: "refused", local: true, https: None };
        assert_eq!(serde_json::to_string(&d).unwrap(), r#"{"kind":"refused","local":true,"https":null}"#);
    }
}
