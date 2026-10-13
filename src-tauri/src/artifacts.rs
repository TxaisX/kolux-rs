//! The Artifacts library (SKILL-036, VIEW-012): HTML pages kept in the app's own folder so they
//! can be viewed with no network. Each entry is a folder holding the page and the files it points
//! to by relative path, plus one line in `library.json`. The viewer loads entries through the
//! `kolux-artifact` scheme, which serves only that entry's files.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

pub const SCHEME: &str = "kolux-artifact";
/// Where the web view puts the scheme: Windows' web view reaches custom schemes over http.
const ORIGIN: &str = if cfg!(windows) { "http://kolux-artifact.localhost" } else { "kolux-artifact://localhost" };
const MAX_PAGE: u64 = 10 * 1024 * 1024;
const MAX_ASSETS: usize = 100;
const MAX_ASSET: u64 = 10 * 1024 * 1024;
const MAX_TOTAL: u64 = 50 * 1024 * 1024;
/// Script hosts whose files are fetched into an entry so it still runs offline (SKILL-035).
const CDNS: [&str; 5] = ["https://cdnjs.cloudflare.com/", "https://cdn.jsdelivr.net/npm/", "https://unpkg.com/", "https://cdn.tailwindcss.com", "https://code.jquery.com/"];
const MAX_SCRIPTS: usize = 16;
const MAX_SCRIPT: usize = 5 * 1024 * 1024;

/// Where a page came from: a file added by hand, or a Claude publish (one entry per URL).
pub struct Origin {
    pub origin: String,
    pub source: &'static str,
    pub project: Option<String>,
    pub session: Option<String>,
    /// When it was added or published, in milliseconds since 1970: an older publish never replaces a newer one.
    pub at: u64,
}

impl Origin {
    pub fn hand(src: &Path) -> Origin {
        Origin { origin: src.to_string_lossy().into_owned(), source: "hand", project: None, session: None, at: now_ms() }
    }
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// Stable for one origin, so adding or publishing the same page again refreshes its entry.
    pub id: String,
    pub title: String,
    /// "hand" for Add artifact, "claude" for a page a Claude session published.
    pub source: String,
    /// The file path (or, for a publish, the URL) the page came from: one entry per origin.
    pub origin: String,
    pub project: Option<String>,
    pub session: Option<String>,
    /// Milliseconds since 1970.
    pub added: u64,
    pub size: u64,
    /// The stored page's path inside the entry's folder, with forward slashes.
    pub page: String,
    /// "ok", "unavailable" (on a network share, never read) or "remote" (a machine this one cannot read).
    pub state: String,
}

/// An entry as the library page gets it: whether its stored page is still on disk.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listed {
    #[serde(flatten)]
    entry: Entry,
    stored: bool,
}

pub struct Library {
    dir: PathBuf,
    lock: Mutex<()>,
}

/// FNV-1a: a short id that stays the same for the same origin on every run and every build.
fn id_of(origin: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in origin.bytes() {
        h = (h ^ b as u64).wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// A page on a network share is never opened. WSL's own shares count as this machine.
pub fn on_network_share(path: &Path) -> bool {
    let s = path.to_string_lossy().replace('/', "\\").to_ascii_lowercase();
    if let Some(rest) = s.strip_prefix("\\\\?\\") {
        return rest.starts_with("unc\\") && !(rest.starts_with("unc\\wsl$\\") || rest.starts_with("unc\\wsl.localhost\\"));
    }
    if s.starts_with("\\\\") {
        return !(s.starts_with("\\\\wsl$\\") || s.starts_with("\\\\wsl.localhost\\"));
    }
    mapped_network_drive(&s)
}

#[cfg(windows)]
fn mapped_network_drive(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() < 2 || b[1] != b':' {
        return false;
    }
    let root: Vec<u16> = format!("{}:\\", b[0] as char).encode_utf16().chain([0]).collect();
    // SAFETY: a NUL-terminated wide string that lives across the call.
    unsafe { windows_sys::Win32::Storage::FileSystem::GetDriveTypeW(root.as_ptr()) == 4 } // DRIVE_REMOTE
}

#[cfg(not(windows))]
fn mapped_network_drive(_s: &str) -> bool {
    false // ponytail: network mounts on macOS and Linux are not told apart yet
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string())
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&nbsp;", " ").replace("&amp;", "&")
}

/// The page's title element, tidied and cut to 200 characters; None when there is no usable one.
pub fn title_of(html: &str) -> Option<String> {
    let low = html.to_ascii_lowercase();
    let open = low.find("<title")?;
    let start = open + low[open..].find('>')? + 1;
    let end = start + low[start..].find("</title")?;
    let t = unescape(&html[start..end]).split_whitespace().collect::<Vec<_>>().join(" ");
    (!t.is_empty()).then(|| t.chars().take(200).collect())
}

fn pct(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() && b[i + 1].is_ascii_hexdigit() && b[i + 2].is_ascii_hexdigit() {
            out.push(u8::from_str_radix(&s[i + 1..i + 3], 16).unwrap_or(b'%'));
            i += 3;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The relative paths the page points to through src, href and poster attributes, without query
/// or fragment. Absolute URLs, root paths, data and other schemes, and fragment-only links are left
/// out. ponytail: CSS url() and srcset are not followed; add them when a page needs them offline.
pub fn relative_refs(html: &str) -> Vec<String> {
    let low = html.to_ascii_lowercase();
    let b = html.as_bytes();
    let mut out = Vec::new();
    for name in ["src", "href", "poster"] {
        let pat = format!("{name}=");
        let mut from = 0;
        while let Some(k) = low[from..].find(&pat) {
            let at = from + k;
            from = at + pat.len();
            if at == 0 || !b[at - 1].is_ascii_whitespace() {
                continue;
            }
            let mut i = from;
            let (q, start) = match b.get(i) {
                Some(&c) if c == b'"' || c == b'\'' => {
                    i += 1;
                    (Some(c), i)
                }
                _ => (None, i),
            };
            while i < b.len() && (if let Some(q) = q { b[i] != q } else { !b[i].is_ascii_whitespace() && b[i] != b'>' }) {
                i += 1;
            }
            let v = unescape(html[start..i].trim());
            let v = v.split(['?', '#']).next().unwrap_or("").to_string();
            let scheme = v.find(':').is_some_and(|c| !v[..c].contains('/'));
            if v.is_empty() || scheme || v.starts_with('/') || v.starts_with('\\') {
                continue;
            }
            out.push(pct(&v));
        }
    }
    out
}

/// A path inside an entry's folder from forward-slash parts; None if a part would climb out.
fn inside(base: &Path, rel: &str) -> Option<PathBuf> {
    let mut p = base.to_path_buf();
    for part in rel.split(['/', '\\']).filter(|s| !s.is_empty() && *s != ".") {
        if matches!(Path::new(part).components().next(), Some(Component::Normal(_))) && Path::new(part).components().count() == 1 {
            p.push(part);
        } else {
            return None;
        }
    }
    Some(p)
}

/// The spans of script src values that point at an allow-listed CDN.
pub fn cdn_scripts(html: &str) -> Vec<(usize, usize)> {
    let low = html.to_ascii_lowercase();
    let b = html.as_bytes();
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(k) = low[from..].find("<script") {
        let open = from + k;
        let close = low[open..].find('>').map_or(low.len(), |c| open + c);
        from = open + 7;
        let Some(at) = (open..close.saturating_sub(4)).find(|&i| b[i].is_ascii_whitespace() && low[i + 1..].starts_with("src=")) else { continue };
        let mut i = at + 5;
        let q = b.get(i).copied().filter(|&c| c == b'"' || c == b'\'');
        if q.is_some() {
            i += 1;
        }
        let start = i;
        while i < close && (if let Some(q) = q { b[i] != q } else { !b[i].is_ascii_whitespace() }) {
            i += 1;
        }
        if CDNS.iter().any(|c| low[start..i].starts_with(c)) {
            out.push((start, i));
        }
    }
    out
}

/// Copies of the page's CDN scripts under `cdn/`, and the page pointing at them; None when none
/// was fetched. A script that cannot be fetched keeps its original address.
fn vendor_scripts(html: &str, tmp: &Path, fetch: &dyn Fn(&str) -> Option<Vec<u8>>, total: &mut u64) -> Option<String> {
    let mut page = html.to_string();
    let mut fetched = false;
    for (n, (start, end)) in cdn_scripts(html).into_iter().take(MAX_SCRIPTS).enumerate().collect::<Vec<_>>().into_iter().rev() {
        let Some(body) = fetch(&unescape(&html[start..end])).filter(|b| b.len() <= MAX_SCRIPT) else { continue };
        if *total + body.len() as u64 > MAX_TOTAL || fs::create_dir_all(tmp.join("cdn")).is_err() || fs::write(tmp.join("cdn").join(format!("{n}.js")), &body).is_err() {
            continue;
        }
        *total += body.len() as u64;
        page.replace_range(start..end, &format!("cdn/{n}.js"));
        fetched = true;
    }
    fetched.then_some(page)
}

/// Fetches one CDN script for an entry, within the size cap; None on any failure.
pub fn fetch_script(url: &str) -> Option<Vec<u8>> {
    if !CDNS.iter().any(|c| url.starts_with(c)) {
        return None;
    }
    tauri::async_runtime::block_on(async {
        let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).build().ok()?;
        let r = client.get(url).send().await.ok()?;
        if !r.status().is_success() || r.content_length().is_some_and(|n| n > MAX_SCRIPT as u64) {
            return None;
        }
        let body = r.bytes().await.ok()?;
        (body.len() <= MAX_SCRIPT).then(|| body.to_vec())
    })
}

impl Library {
    pub fn new(dir: PathBuf) -> Library {
        Library { dir, lock: Mutex::new(()) }
    }

    fn index(&self) -> PathBuf {
        self.dir.join("library.json")
    }

    fn read(&self) -> Vec<Entry> {
        fs::read(self.index()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    fn write(&self, list: &[Entry]) -> Result<(), String> {
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let text = serde_json::to_vec_pretty(list).map_err(|e| e.to_string())?;
        crate::files::write_text(&self.index(), &String::from_utf8_lossy(&text))
    }

    /// Newest first.
    pub fn list(&self) -> Vec<Listed> {
        let _g = self.lock.lock();
        let mut list = self.read();
        list.sort_by_key(|a| std::cmp::Reverse(a.added));
        list.into_iter().map(|e| Listed { stored: e.state == "ok" && self.dir.join(&e.id).join(&e.page).is_file(), entry: e }).collect()
    }

    /// Stores a page and the files it points to by relative path inside its own folder, under the
    /// caps, plus copies of the scripts it loads from the allow-listed CDNs (`fetch` gets one).
    /// A page on a network share gets an "unavailable" entry without being read, and a path this
    /// machine cannot read (a WSL or SSH machine's) a "remote" one. The newest store of an origin
    /// replaces the old one; an older one is ignored.
    pub fn add(&self, src: &Path, from: Origin, fetch: &dyn Fn(&str) -> Option<Vec<u8>>) -> Result<Entry, String> {
        let id = id_of(&from.origin);
        if let Some(newer) = self.read().into_iter().find(|e| e.id == id && e.added > from.at) {
            return Ok(newer);
        }
        let name = file_name(src);
        let mut entry = Entry { id: id.clone(), title: name.clone(), source: from.source.into(), origin: from.origin, project: from.project, session: from.session, added: from.at, size: 0, page: name.clone(), state: "unavailable".into() };
        if !src.is_absolute() {
            entry.state = "remote".into();
        } else if !on_network_share(src) {
            let len = fs::metadata(src).map_err(|e| format!("could not read {name}: {e}"))?.len();
            if len > MAX_PAGE {
                return Err(format!("{name} is larger than 10 MB"));
            }
            let html = fs::read(src).map_err(|e| format!("could not read {name}: {e}"))?;
            let text = String::from_utf8_lossy(&html);
            if let Some(t) = title_of(&text) {
                entry.title = t;
            }
            let tmp = self.dir.join(format!(".new-{id}"));
            let _ = fs::remove_dir_all(&tmp);
            fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
            let mut size = self.copy_assets(src, &text, &name, &tmp, html.len() as u64);
            let page = vendor_scripts(&text, &tmp, fetch, &mut size);
            fs::write(tmp.join(&name), page.as_ref().map_or(&html[..], |p| p.as_bytes())).map_err(|e| e.to_string())?;
            entry.size = size;
            let dest = self.dir.join(&id);
            let _ = fs::remove_dir_all(&dest);
            fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
            entry.state = "ok".into();
        }
        let _g = self.lock.lock();
        let mut list = self.read();
        list.retain(|e| e.id != id);
        list.push(entry.clone());
        self.write(&list)?;
        Ok(entry)
    }

    /// Copies what the page points to; returns the stored size. Nothing outside the page's folder.
    fn copy_assets(&self, src: &Path, html: &str, page: &str, tmp: &Path, mut total: u64) -> u64 {
        let Some(folder) = src.parent().and_then(|p| fs::canonicalize(p).ok()) else { return total };
        let mut seen = std::collections::HashSet::from([page.to_string()]);
        for r in relative_refs(html) {
            if seen.len() > MAX_ASSETS {
                break;
            }
            let Ok(real) = fs::canonicalize(folder.join(&r)) else { continue };
            let Ok(rel) = real.strip_prefix(&folder) else { continue }; // outside the page's own folder
            let rel = rel.to_string_lossy().replace('\\', "/");
            let Ok(md) = fs::metadata(&real) else { continue };
            if !md.is_file() || md.len() > MAX_ASSET || total + md.len() > MAX_TOTAL || !seen.insert(rel.clone()) {
                continue;
            }
            let Some(to) = inside(tmp, &rel) else { continue };
            if to.parent().is_some_and(|p| fs::create_dir_all(p).is_ok()) && fs::copy(&real, &to).is_ok() {
                total += md.len();
            }
        }
        total
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let _g = self.lock.lock();
        let mut list = self.read();
        list.retain(|e| e.id != id);
        self.write(&list)?;
        if id.bytes().all(|c| c.is_ascii_hexdigit()) && !id.is_empty() {
            let _ = fs::remove_dir_all(self.dir.join(id));
        }
        Ok(())
    }

    /// A stored file for the viewer: `/<id>/<path>`, never outside that entry's folder.
    pub fn file(&self, url_path: &str) -> Option<(Vec<u8>, &'static str)> {
        let path = pct(url_path);
        let (id, rest) = path.trim_start_matches('/').split_once('/')?;
        if id.len() != 16 || !id.bytes().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let file = inside(&self.dir.join(id), rest)?;
        let body = fs::read(&file).ok()?;
        Some((body, mime(rest)))
    }
}

fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css",
        "js" | "mjs" => "text/javascript",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "txt" | "md" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Clicked links leave the viewer: a link to another stored file of the same entry navigates in
/// place, one to anywhere else on the scheme goes nowhere, and anything else is handed to the app,
/// which opens it in the system browser.
fn link_script(base: &str) -> String {
    format!(
        "<script>document.addEventListener(\"click\",function(e){{var a=e.target&&e.target.closest&&e.target.closest(\"a[href]\");if(!a)return;var u=new URL(a.getAttribute(\"href\"),location.href);if(u.protocol===location.protocol&&u.host===location.host){{if(u.pathname.indexOf({base:?})!==0)e.preventDefault();return}}e.preventDefault();parent.postMessage({{koluxOpen:u.href}},\"*\")}},true)</script>"
    )
}

/// The `kolux-artifact` scheme: the entry's files with a policy that lets the page load only them.
pub fn serve(lib: &Library, req: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::Response;
    let uri = req.uri();
    let path = uri.path();
    let Some((mut body, kind)) = lib.file(path) else {
        return Response::builder().status(404).header("Content-Type", "text/plain").body(b"not in this artifact".to_vec()).unwrap();
    };
    let id = path.trim_start_matches('/').split('/').next().unwrap_or("");
    let base = format!("/{id}/");
    if kind.starts_with("text/html") {
        // After the page, so a doctype stays first and the page keeps standards mode.
        body.extend_from_slice(link_script(&base).as_bytes());
    }
    let only = format!("{ORIGIN}{base}");
    let cdns = CDNS.map(|c| c.trim_end_matches('/')).join(" ");
    let csp = format!("default-src {only} 'unsafe-inline' 'unsafe-eval' data: blob:; script-src {only} 'unsafe-inline' 'unsafe-eval' data: blob: {cdns}; form-action 'none'");
    Response::builder().header("Content-Type", kind).header("Content-Security-Policy", csp).header("Access-Control-Allow-Origin", "*").body(body).unwrap()
}

#[tauri::command]
pub fn artifacts_list(lib: tauri::State<'_, Library>) -> Vec<Listed> {
    lib.list()
}

#[tauri::command]
pub async fn artifact_add(app: tauri::AppHandle, path: String) -> Result<Entry, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || app.state::<Library>().add(Path::new(&path), Origin::hand(Path::new(&path)), &fetch_script)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn artifact_remove(lib: tauri::State<'_, Library>, id: String) -> Result<(), String> {
    lib.remove(&id)
}

/// Opens a web or mail link in the system's own handler; nothing else is let through.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    let low = url.to_ascii_lowercase();
    if !(low.starts_with("http://") || low.starts_with("https://") || low.starts_with("mailto:")) {
        return Err(format!("{url} is not a web or mail link"));
    }
    system_open(&url)
}

/// Hands `url` (a link or a full file path) to the system's own handler. Callers check it first:
/// `open_external` lets only web and mail links through, `links::open_path` reveals programs.
pub(crate) fn system_open(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        let wide = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
        let (verb, file) = (wide("open"), wide(url));
        // SAFETY: NUL-terminated wide strings that live across the call.
        let r = unsafe { windows_sys::Win32::UI::Shell::ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), 1) };
        if (r as isize) <= 32 {
            return Err(format!("Windows could not open {url}"));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        std::process::Command::new(opener).arg(&url).spawn().map(|_| ()).map_err(|e| format!("could not open {url}: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("krs-art-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn titles_and_refs() {
        assert_eq!(title_of("<html><TITLE id=t>\n A &amp; B </title>"), Some("A & B".into()));
        assert_eq!(title_of("<title> </title>"), None);
        assert_eq!(title_of(&format!("<title>{}</title>", "x".repeat(300))).unwrap().len(), 200);
        let refs = relative_refs("<img src=\"img/a%20b.png?v=1\"><link href='s.css'><a href=\"#top\"> <a href=\"https://x.io\"> <script src=/abs.js></script> <img data-src=\"no.png\"> <video poster=p.jpg> <a href=\"mailto:a@b\"> <img src=\"../out.png\">");
        assert_eq!(refs, ["img/a b.png", "../out.png", "s.css", "p.jpg"]);
    }

    #[test]
    fn network_shares_are_told_apart() {
        assert!(on_network_share(Path::new(r"\\server\share\a.html")));
        assert!(on_network_share(Path::new(r"\\?\UNC\server\share\a.html")));
        assert!(!on_network_share(Path::new(r"\\wsl$\Ubuntu\home\a.html")));
        assert!(!on_network_share(Path::new(r"\\wsl.localhost\Ubuntu\a.html")));
        assert!(!on_network_share(&std::env::temp_dir().join("a.html")));
    }

    #[test]
    fn stores_the_page_and_its_own_folder_only_and_refreshes_by_origin() {
        let root = temp_dir("store");
        let site = root.join("site");
        fs::create_dir_all(site.join("img")).unwrap();
        fs::write(root.join("secret.txt"), "no").unwrap();
        fs::write(site.join("img").join("a.png"), "png").unwrap();
        fs::write(site.join("page.html"), "<title>One</title><img src=\"img/a.png\"><img src=\"../secret.txt\">").unwrap();
        let lib = Library::new(root.join("lib"));
        let e = lib.add(&site.join("page.html"), Origin::hand(&site.join("page.html")), &|_| None).unwrap();
        assert_eq!((e.title.as_str(), e.state.as_str()), ("One", "ok"));
        assert!(lib.file(&format!("/{}/img/a.png", e.id)).is_some());
        assert!(lib.file(&format!("/{}/../secret.txt", e.id)).is_none());
        assert!(!root.join("lib").join(&e.id).join("secret.txt").exists());
        assert!(fs::read_dir(root.join("lib").join(&e.id)).unwrap().count() == 2);
        fs::write(site.join("page.html"), "<title>Two</title>").unwrap();
        let again = lib.add(&site.join("page.html"), Origin::hand(&site.join("page.html")), &|_| None).unwrap();
        assert_eq!(again.id, e.id);
        let list = lib.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].entry.title, "Two");
        assert!(!root.join("lib").join(&e.id).join("img").exists());
        assert!(lib.add(&site.join("missing.html"), Origin::hand(&site.join("missing.html")), &|_| None).is_err());
        assert_eq!(lib.list().len(), 1);
        lib.remove(&e.id).unwrap();
        assert!(lib.list().is_empty() && !root.join("lib").join(&e.id).exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cdn_scripts_are_kept_offline_and_a_failed_fetch_keeps_the_address() {
        let html = "<script src=\"https://cdn.jsdelivr.net/npm/a@1/a.js\"></script><script src='https://evil.example/x.js'></script><script defer src=https://unpkg.com/b@2></script><script>var s='src=https://unpkg.com/c'</script><script src=\"https://cdnjs.cloudflare.com/ajax/libs/gone/1/g.js\"></script>";
        let spans: Vec<&str> = cdn_scripts(html).into_iter().map(|(a, b)| &html[a..b]).collect();
        assert_eq!(spans, ["https://cdn.jsdelivr.net/npm/a@1/a.js", "https://unpkg.com/b@2", "https://cdnjs.cloudflare.com/ajax/libs/gone/1/g.js"]);
        let root = temp_dir("cdn");
        let fetch = |u: &str| (!u.contains("gone")).then(|| format!("/* {u} */").into_bytes());
        let mut total = 0;
        let page = vendor_scripts(html, &root, &fetch, &mut total).unwrap();
        assert!(page.contains("src=\"cdn/0.js\"") && page.contains("src=cdn/1.js>"), "{page}");
        assert!(page.contains("https://cdnjs.cloudflare.com/ajax/libs/gone/1/g.js") && page.contains("https://evil.example/x.js"));
        assert_eq!(fs::read_to_string(root.join("cdn").join("1.js")).unwrap(), "/* https://unpkg.com/b@2 */");
        assert!(vendor_scripts("<script src=\"https://cdn.jsdelivr.net/npm/x\"></script>", &root, &|_| None, &mut total).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn one_entry_per_publish_url_newest_wins_and_remote_paths_are_not_read() {
        let root = temp_dir("publish");
        let page = root.join("p.html");
        let lib = Library::new(root.join("lib"));
        let from = |at: u64| Origin { origin: "https://claude.ai/artifact/abc".into(), source: "claude", project: Some("repo".into()), session: Some("s1".into()), at };
        fs::write(&page, "<title>First</title>").unwrap();
        lib.add(&page, from(1000), &|_| None).unwrap();
        fs::write(&page, "<title>Second</title>").unwrap();
        lib.add(&page, from(2000), &|_| None).unwrap();
        fs::write(&page, "<title>Replayed</title>").unwrap();
        lib.add(&page, from(1500), &|_| None).unwrap();
        let list = lib.list();
        assert_eq!(list.len(), 1);
        assert_eq!((list[0].entry.title.as_str(), list[0].entry.source.as_str(), list[0].entry.added), ("Second", "claude", 2000));
        let remote = if cfg!(windows) { "/home/me/site/page.html" } else { "C:\\site\\page.html" };
        let mut o = from(3000);
        o.origin = "https://claude.ai/artifact/remote".into();
        let e = lib.add(Path::new(remote), o, &|_| panic!("a remote page is never read")).unwrap();
        assert_eq!((e.state.as_str(), e.size), ("remote", 0));
        let _ = fs::remove_dir_all(&root);
    }
}
