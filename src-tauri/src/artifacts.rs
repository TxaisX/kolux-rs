//! The Artifacts library (SKILL-036, VIEW-012): HTML pages kept in the app's own folder so they
//! can be viewed with no network. Each entry is a folder holding the page and the files it points
//! to by relative path, plus one line in `library.json`. The viewer loads entries through the
//! `kolux-artifact` scheme, which serves only that entry's files.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

pub const SCHEME: &str = "kolux-artifact";
/// Where the web view puts the scheme: Windows' web view reaches custom schemes over http.
const ORIGIN: &str = if cfg!(windows) { "http://kolux-artifact.localhost" } else { "kolux-artifact://localhost" };
const MAX_PAGE: u64 = 10 * 1024 * 1024;
/// A single file that is not a page (an image, a video, an audio track, a document, a PDF) is kept
/// whole, so it gets a larger cap than one page; the viewer plays or shows the kinds it can and
/// hands the rest to the system.
const MAX_FILE: u64 = 100 * 1024 * 1024;
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
    /// "hand" for Add artifact, "claude" for a page a Claude session published or a file it wrote.
    pub source: String,
    /// "page", "image", "text", "pdf" or "other": what the stored file is, so the viewer knows
    /// whether it can show it itself. An entry written before this field existed is a page.
    #[serde(default = "kind_page")]
    pub kind: String,
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
    /// The origin file's own (modified ms, length) when it was stored, so the workspace scan can tell
    /// the exact file it holds from a changed one; `size` holds a page's assets and scripts too. None
    /// for an entry stored before this field existed, or one whose file was never read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stamp: Option<(u64, u64)>,
}

/// The removed entries the workspace scan must not bring back: origin -> the file's (modified ms,
/// length) at removal. A later rewrite has a new stamp and is imported again. Kept beside
/// library.json in its own file, so the index keeps its shape for an older build.
const REMOVED: &str = "removed.json";

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

fn kind_page() -> String {
    "page".into()
}

/// What a stored file is, from its extension. Only a page is copied with the files it points to
/// and made offline; the rest are kept whole and shown by the viewer when it can render them.
pub fn kind_of(path: &Path) -> &'static str {
    match path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default().as_str() {
        "html" | "htm" => "page",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "avif" | "bmp" | "ico" => "image",
        "mp4" | "webm" | "mov" | "m4v" | "ogv" | "mkv" | "avi" => "video",
        "mp3" | "wav" | "m4a" | "ogg" | "oga" | "flac" | "aac" | "opus" => "audio",
        "md" | "txt" | "csv" | "log" | "json" => "text",
        "pdf" => "pdf",
        _ => "other",
    }
}

/// The file types an agent's new file is kept from. Anything else it writes is source, not an
/// artifact, and stays out of the library.
pub const KEPT: &[&str] = &[
    "html", "htm", "png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "md", "txt", "csv",
    "docx", "xlsx", "pptx", "zip",
    "mp4", "webm", "mov", "m4v", "ogv", "mkv", "avi",
    "mp3", "wav", "m4a", "ogg", "oga", "flac", "aac", "opus",
];

/// A file in a workspace's explicit `artifacts/` folder is a deliverable by definition, so every
/// top-level file counts there even when the same extension would be source elsewhere. Dotfiles and
/// half-written downloads are not deliverables.
fn is_workspace_file(path: &Path) -> bool {
    let name = path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default();
    if name.starts_with('.') {
        return false;
    }
    let ext = path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    !matches!(ext.as_str(), "tmp" | "part" | "crdownload" | "lock")
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

/// `b` with the saved proxy plan applied (T-323-b, APP-032). The error never carries the address.
fn proxied(plan: &crate::resources::app_http::Plan, b: reqwest::ClientBuilder) -> Result<reqwest::ClientBuilder, String> {
    use crate::resources::app_proxy::Route;
    let b = match &plan.route {
        Route::Default => b,
        Route::Direct => b.no_proxy(),
        Route::Via(p) => b.proxy(reqwest::Proxy::all(p.as_str()).map_err(|_| "the network proxy setting cannot be used by this build; app traffic that needs it stays off until it is cleared".to_string())?),
    };
    Ok(if plan.http1 { b.http1_only() } else { b })
}

/// Fetches one CDN script for an entry, within the size cap; None on any failure.
pub fn fetch_script(app: &tauri::AppHandle, url: &str) -> Option<Vec<u8>> {
    if !CDNS.iter().any(|c| url.starts_with(c)) {
        return None;
    }
    // T-323-b (APP-032): through the saved proxy; a setting that cannot be used fetches nothing.
    let plan = crate::resources::app_http::plan_for(app, &url.parse().ok()?).ok()?;
    let builder = proxied(&plan, reqwest::Client::builder()).ok()?;
    tauri::async_runtime::block_on(async {
        let client = builder.timeout(std::time::Duration::from_secs(20)).build().ok()?;
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

    /// The removed origins the scan must leave alone (see REMOVED). Callers hold `lock`.
    pub fn removed(&self) -> HashMap<String, (u64, u64)> {
        fs::read(self.dir.join(REMOVED)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    fn write_removed(&self, map: &HashMap<String, (u64, u64)>) {
        if map.is_empty() {
            let _ = fs::remove_file(self.dir.join(REMOVED));
            return;
        }
        if let Ok(text) = serde_json::to_vec_pretty(map) {
            let _ = fs::create_dir_all(&self.dir);
            let _ = crate::files::write_text(&self.dir.join(REMOVED), &String::from_utf8_lossy(&text));
        }
    }

    /// Forgets the tombstones of `origins` (a file stored again, or one that is gone).
    fn forget_removed(&self, origins: &[String]) {
        let mut map = self.removed();
        let before = map.len();
        map.retain(|k, _| !origins.contains(k));
        if map.len() != before {
            self.write_removed(&map);
        }
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
    /// A file that is not a page (an image, a document, a PDF) is stored whole, on its own.
    /// A page on a network share gets an "unavailable" entry without being read, and a path this
    /// machine cannot read (a WSL or SSH machine's) a "remote" one. The newest store of an origin
    /// replaces the old one; an older one is ignored.
    pub fn add(&self, src: &Path, from: Origin, fetch: &dyn Fn(&str) -> Option<Vec<u8>>) -> Result<Entry, String> {
        let id = id_of(&from.origin);
        if let Some(newer) = self.read().into_iter().find(|e| e.id == id && e.added > from.at) {
            return Ok(newer);
        }
        let name = file_name(src);
        let kind = kind_of(src);
        let mut entry = Entry { id: id.clone(), title: name.clone(), source: from.source.into(), kind: kind.into(), origin: from.origin, project: from.project, session: from.session, added: from.at, size: 0, page: name.clone(), state: "unavailable".into(), stamp: None };
        if !src.is_absolute() {
            entry.state = "remote".into();
        } else if !on_network_share(src) {
            let len = fs::metadata(src).map_err(|e| format!("could not read {name}: {e}"))?.len();
            let cap = if kind == "page" { MAX_PAGE } else { MAX_FILE };
            if len > cap {
                return Err(format!("{name} is larger than {} MB", cap / (1024 * 1024)));
            }
            entry.stamp = Some((modified_ms(src), len));
            let tmp = self.dir.join(format!(".new-{id}"));
            let _ = fs::remove_dir_all(&tmp);
            fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
            let mut size = len;
            if kind == "page" {
                let html = fs::read(src).map_err(|e| format!("could not read {name}: {e}"))?;
                let text = String::from_utf8_lossy(&html);
                if let Some(t) = title_of(&text) {
                    entry.title = t;
                }
                size = self.copy_assets(src, &text, &name, &tmp, html.len() as u64);
                let page = vendor_scripts(&text, &tmp, fetch, &mut size);
                fs::write(tmp.join(&name), page.as_ref().map_or(&html[..], |p| p.as_bytes())).map_err(|e| e.to_string())?;
            } else {
                fs::copy(src, tmp.join(&name)).map_err(|e| format!("could not read {name}: {e}"))?;
            }
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
        // Stored again by hand, by a Claude Write or by the scan: an earlier remove no longer applies.
        self.forget_removed(std::slice::from_ref(&entry.origin));
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

    /// Drops the entry and its stored copy. When its origin is a file that is still there, the scan
    /// is told not to bring that exact file back (REMOVED); a URL origin leaves no such note.
    pub fn remove(&self, id: &str) -> Result<(), String> {
        let _g = self.lock.lock();
        let mut list = self.read();
        let gone: Vec<Entry> = list.iter().filter(|e| e.id == id).cloned().collect();
        list.retain(|e| e.id != id);
        self.write(&list)?;
        if id.bytes().all(|c| c.is_ascii_hexdigit()) && !id.is_empty() {
            let _ = fs::remove_dir_all(self.dir.join(id));
        }
        let mut removed = self.removed();
        let mut noted = false;
        for e in gone {
            let path = Path::new(&e.origin);
            if path.is_absolute() {
                if let Some(meta) = fs::metadata(path).ok().filter(|m| m.is_file()) {
                    removed.insert(e.origin.clone(), (modified_ms(path), meta.len()));
                    noted = true;
                }
            }
        }
        if noted {
            self.write_removed(&removed);
        }
        Ok(())
    }

    /// A stored file for the viewer: `/<id>/<path>`, never outside that entry's folder.
    pub fn open(&self, url_path: &str) -> Option<(PathBuf, &'static str)> {
        let path = pct(url_path);
        let (id, rest) = path.trim_start_matches('/').split_once('/')?;
        if id.len() != 16 || !id.bytes().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let file = inside(&self.dir.join(id), rest)?;
        file.is_file().then(|| (file, mime(rest)))
    }

    /// The whole stored file, for a page or a small one-shot read.
    pub fn file(&self, url_path: &str) -> Option<(Vec<u8>, &'static str)> {
        let (file, kind) = self.open(url_path)?;
        Some((fs::read(file).ok()?, kind))
    }
}

/// The folder a workspace keeps its finished artifacts in: `<workspace>/artifacts`.
pub const WORKSPACE_DIR: &str = "artifacts";

/// Every file directly in `<workspace>/artifacts`, in a stable order, whatever its extension.
/// Subfolders are not entries: they hold a page's own assets (copied with the page) or a test run's
/// screenshots, not a second deliverable. The scan never leaves the folder: a link or junction where
/// the folder should be is not followed (read_dir would follow it; symlink_metadata's is_dir is false
/// for one, the idiom files::list_templates uses), a linked file inside it is not a file, and each
/// file's real path has to sit under the workspace's. A dotfile or a half-written download is not an
/// artifact.
pub fn workspace_files(workspace: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let dir = workspace.join(WORKSPACE_DIR);
    if !fs::symlink_metadata(&dir).is_ok_and(|m| m.is_dir()) {
        return out;
    }
    let Ok(real_ws) = fs::canonicalize(workspace) else { return out };
    for entry in fs::read_dir(&dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if entry.file_type().is_ok_and(|kind| kind.is_file()) && is_workspace_file(&path) && fs::canonicalize(&path).is_ok_and(|real| real.starts_with(&real_ws)) {
            out.push(path);
        }
    }
    out.sort();
    out
}

fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Last (modified, size) seen for each workspace file, so the page's 3 s scan does not re-add a file
/// that has not changed. One map for the app's life; the library is the durable record.
static SCANNED: OnceLock<Mutex<HashMap<String, (u64, u64)>>> = OnceLock::new();

/// What one scan did: how many entries it stored or refreshed, and one reason per file it could
/// not keep (over the cap, unreadable), so the page can tell the user once.
#[derive(Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scanned {
    pub changed: usize,
    pub skipped: Vec<String>,
}

/// Imports every kept file under `<workspace>/artifacts`, one entry per file. A changed file
/// (a new modified time or length, even an older time: a restore from a backup) refreshes its
/// origin instead of adding a second entry; the exact file the library holds, or one the user
/// removed since, is left alone. `seen` is the caller's memory of files it has judged, so a file
/// that cannot be kept is reported once and tried again only when it changes.
pub fn scan_workspace(lib: &Library, workspace: &Path, project: Option<String>, fetch: &dyn Fn(&str) -> Option<Vec<u8>>, seen: &mut HashMap<String, (u64, u64)>) -> Scanned {
    let project = project.filter(|p| !p.trim().is_empty()).or_else(|| workspace.file_name().map(|n| n.to_string_lossy().into_owned()));
    let known: HashMap<String, Option<(u64, u64)>> = lib.list().into_iter().map(|e| (e.entry.origin, e.entry.stamp)).collect();
    let removed = {
        let _g = lib.lock.lock();
        lib.removed()
    };
    let mut out = Scanned::default();
    for file in workspace_files(workspace) {
        let Ok(meta) = fs::metadata(&file) else { continue };
        let stamp = (modified_ms(&file), meta.len());
        let key = file.to_string_lossy().into_owned();
        if seen.get(&key) == Some(&stamp) {
            continue;
        }
        // The library already holds this exact file, or the user removed this exact file: move on.
        if known.get(&key) == Some(&Some(stamp)) || removed.get(&key) == Some(&stamp) {
            seen.insert(key, stamp);
            continue;
        }
        // Added now: `added` is when the entry was stored, the file's own time lives in its stamp.
        let from = Origin { origin: key.clone(), source: "workspace", project: project.clone(), session: None, at: now_ms() };
        match lib.add(&file, from, fetch) {
            Ok(_) => out.changed += 1,
            Err(e) => {
                eprintln!("artifacts: could not keep {}: {e}", file.display());
                out.skipped.push(e);
            }
        }
        seen.insert(key, stamp);
    }
    // A removed file that is gone from the folder needs no note any more.
    let gone: Vec<String> = removed.keys().filter(|k| !Path::new(k).is_file()).cloned().collect();
    if !gone.is_empty() {
        let _g = lib.lock.lock();
        lib.forget_removed(&gone);
    }
    out
}

/// Scans the active workspace's `artifacts/` folder. The Artifacts page calls this when it opens and
/// every few seconds, so a page an agent writes lands in the tab without Add artifact. A network
/// share is left alone (DT-R21); the library never reads one. Async and on a blocking worker, like
/// `artifact_add`: the scan copies files of up to MAX_FILE and fetches a page's CDN scripts with a
/// 20 s timeout each, none of which may hold the window's thread (and the path checks stat a drive
/// that may be gone). A tick that finds the last scan still running does nothing; the next retries.
#[tauri::command]
pub async fn artifacts_scan(app: tauri::AppHandle, path: String, project: Option<String>) -> Result<Scanned, String> {
    use tauri::{Emitter, Manager};
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = PathBuf::from(path);
        if !workspace.is_absolute() || !workspace.is_dir() || on_network_share(&workspace) {
            return Ok(Scanned::default());
        }
        let lib = app.state::<Library>();
        let scanned = {
            let mut seen = match SCANNED.get_or_init(Default::default).try_lock() {
                Ok(seen) => seen,
                Err(std::sync::TryLockError::WouldBlock) => return Ok(Scanned::default()),
                Err(std::sync::TryLockError::Poisoned(e)) => e.into_inner(),
            };
            scan_workspace(lib.inner(), &workspace, project, &|u| fetch_script(&app, u), &mut seen)
        };
        if scanned.changed > 0 {
            let _ = app.emit(crate::capture::EVENT, ());
        }
        Ok(scanned)
    })
    .await
    .map_err(|e| e.to_string())?
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
        "txt" | "md" | "log" => "text/plain; charset=utf-8",
        "csv" => "text/csv; charset=utf-8",
        "pdf" => "application/pdf",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "ogv" => "video/ogg",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "ogg" | "oga" => "audio/ogg",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "opus" => "audio/opus",
        "zip" => "application/zip",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
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

/// A `Range: bytes=start-end` request against a file of `total` bytes, clamped to the file. A
/// suffix (`bytes=-N`) asks for the last N bytes; malformed, reversed and multi-part ranges get the
/// whole file instead of an error, which every browser can still play.
fn parse_range(header: &str, total: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?;
    if spec.contains(',') || total == 0 {
        return None;
    }
    let (a, b) = spec.split_once('-')?;
    let (start, end) = if a.trim().is_empty() {
        let n: u64 = b.trim().parse().ok()?;
        if n == 0 {
            return None;
        }
        (total.saturating_sub(n), total - 1)
    } else {
        let start: u64 = a.trim().parse().ok()?;
        let end = if b.trim().is_empty() { total - 1 } else { b.trim().parse::<u64>().ok()?.min(total - 1) };
        (start, end)
    };
    (start <= end && start < total).then_some((start, end))
}

fn read_range(file: &Path, start: u64, end: u64) -> Option<Vec<u8>> {
    let mut f = fs::File::open(file).ok()?;
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut body = vec![0; (end - start + 1) as usize];
    f.read_exact(&mut body).ok()?;
    Some(body)
}

/// The `kolux-artifact` scheme: the entry's files with a policy that lets the page load only them.
/// Media answers byte ranges, so a video or an audio track can seek without loading the whole file.
pub fn serve(lib: &Library, req: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::Response;
    let uri = req.uri();
    let path = uri.path();
    let Some((file, kind)) = lib.open(path) else {
        return Response::builder().status(404).header("Content-Type", "text/plain").body(b"not in this artifact".to_vec()).unwrap();
    };
    let total = fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
    let wants_range = !kind.starts_with("text/html");
    let range = wants_range.then(|| req.headers().get("range").and_then(|v| v.to_str().ok()).and_then(|v| parse_range(v, total))).flatten();
    let (mut body, status, content_range) = match range.and_then(|(start, end)| read_range(&file, start, end).map(|b| (start, end, b))) {
        Some((start, end, b)) => (b, 206, Some(format!("bytes {start}-{end}/{total}"))),
        None => (fs::read(&file).unwrap_or_default(), 200, None),
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
    let mut out = Response::builder()
        .status(status)
        .header("Content-Type", kind)
        .header("Content-Length", body.len().to_string())
        .header("Accept-Ranges", "bytes")
        .header("Content-Security-Policy", csp)
        .header("Access-Control-Allow-Origin", "*");
    if let Some(cr) = content_range {
        out = out.header("Content-Range", cr);
    }
    out.body(body).unwrap()
}

#[tauri::command]
pub fn artifacts_list(lib: tauri::State<'_, Library>) -> Vec<Listed> {
    lib.list()
}

#[tauri::command]
pub async fn artifact_add(app: tauri::AppHandle, path: String) -> Result<Entry, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || app.state::<Library>().add(Path::new(&path), Origin::hand(Path::new(&path)), &|u| fetch_script(&app, u))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn artifact_remove(lib: tauri::State<'_, Library>, id: String) -> Result<(), String> {
    lib.remove(&id)
}

/// Opens a web or mail link in the system's own handler; nothing else is let through, and no more than a
/// handful in a row (links::admit_browser_open). The command runs on a worker, never the window's thread.
#[tauri::command(async)]
pub fn open_external(url: String) -> Result<(), String> {
    let low = url.to_ascii_lowercase();
    if !(low.starts_with("http://") || low.starts_with("https://") || low.starts_with("mailto:")) {
        return Err(format!("{url} is not a web or mail link"));
    }
    crate::links::admit_browser_open()?;
    system_open(&url)
}

/// Hands `url` (a link or a full file path) to the system's own handler. Callers check it first:
/// `open_external` lets only web and mail links through, `links::open_path` reveals programs.
pub(crate) fn system_open(url: &str) -> Result<(), String> {
    if url.contains('\0') {
        return Err("That path holds a control character; Kolux never opens it".into());
    }
    #[cfg(windows)]
    {
        let wide = |s: &str| s.encode_utf16().chain([0]).collect::<Vec<u16>>();
        let (verb, file) = (wide("open"), wide(url));
        use windows_sys::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
        // FIX-5 (council P2 P12): ShellExecute may hand the link to shell extensions that use COM, so
        // the calling thread joins COM for the call (the documented way) and leaves it again after.
        // A negative result (the thread already joined another way) means nothing to undo.
        // SAFETY: NUL-terminated wide strings that live across the call; every successful
        // CoInitializeEx is matched by one CoUninitialize on this thread.
        let r = unsafe {
            let com = CoInitializeEx(std::ptr::null(), (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32);
            let r = windows_sys::Win32::UI::Shell::ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), 1);
            if com >= 0 {
                CoUninitialize();
            }
            r
        };
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

    #[test]
    fn app_032_each_route_reaches_the_client() {
        use crate::resources::{app_http::Plan, app_proxy::Route};
        let u = |s: &str| tauri::Url::parse(s).unwrap();
        assert!(proxied(&Plan { route: Route::Via(u("http://p:8080")), http1: true }, reqwest::Client::builder()).unwrap().build().is_ok());
        for route in [Route::Default, Route::Direct] {
            assert!(proxied(&Plan { route, http1: false }, reqwest::Client::builder()).unwrap().build().is_ok());
        }
        // socks5 needs reqwest's socks feature, which this build leaves out: that stops the request.
        if let Err(e) = proxied(&Plan { route: Route::Via(u("socks5://me:SECRET@p:1080")), http1: false }, reqwest::Client::builder()) {
            assert!(!e.contains("SECRET") && !e.contains("socks5://"), "{e}");
        }
    }

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
    fn a_file_that_is_not_a_page_is_kept_whole_and_typed() {
        let root = temp_dir("files");
        let shot = root.join("shot.png");
        fs::write(&shot, b"\x89PNG\r\n").unwrap();
        let lib = Library::new(root.join("lib"));
        let e = lib.add(&shot, Origin::hand(&shot), &|_| panic!("a file that is not a page fetches no script")).unwrap();
        assert_eq!((e.kind.as_str(), e.state.as_str(), e.size), ("image", "ok", 6));
        assert_eq!(e.title, "shot.png");
        let (body, kind) = lib.file(&format!("/{}/shot.png", e.id)).unwrap();
        assert_eq!((body.as_slice(), kind), (&b"\x89PNG\r\n"[..], "image/png"));
        // A document is kept the same way and reads as text.
        let doc = root.join("notes.md");
        fs::write(&doc, "# Plan").unwrap();
        assert_eq!(lib.add(&doc, Origin::hand(&doc), &|_| None).unwrap().kind, "text");
        // An entry written before kinds existed is still a page.
        let old: Entry = serde_json::from_str(r#"{"id":"a","title":"t","source":"hand","origin":"x","project":null,"session":null,"added":1,"size":1,"page":"a.html","state":"ok"}"#).unwrap();
        assert_eq!(old.kind, "page");
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
    fn video_audio_and_pdf_are_kept_and_media_ranges_are_clamped() {
        for (name, kind) in [("clip.mp4", "video"), ("clip.webm", "video"), ("track.mp3", "audio"), ("track.m4a", "audio"), ("paper.pdf", "pdf")] {
            assert_eq!(kind_of(Path::new(name)), kind, "{name}");
            assert!(KEPT.contains(&name.rsplit('.').next().unwrap()));
        }
        assert_eq!(kind_of(Path::new("data.json")), "text");
        assert!(!KEPT.contains(&"json"), "a project JSON is not auto-captured from a Write");
        assert!(is_workspace_file(Path::new("data.json")));
        assert!(is_workspace_file(Path::new("model.psd")), "any file in the artifacts folder counts");
        assert_eq!(mime("clip.mp4"), "video/mp4");
        assert_eq!(mime("track.mp3"), "audio/mpeg");
        assert_eq!(mime("paper.pdf"), "application/pdf");
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=100-", 1000), Some((100, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=0-2000", 1000), Some((0, 999)));
        assert_eq!(parse_range("bytes=1000-", 1000), None);
        assert_eq!(parse_range("bytes=10-5", 1000), None);
        assert_eq!(parse_range("items=0-5", 1000), None);
        assert_eq!(parse_range("bytes=0-5,10-15", 1000), None);
        let root = temp_dir("range");
        let file = root.join("clip.mp4");
        fs::write(&file, (0..=255).collect::<Vec<u8>>()).unwrap();
        assert_eq!(read_range(&file, 10, 12), Some(vec![10, 11, 12]));
        assert_eq!(read_range(&file, 254, 300), None, "a range past the end is refused, never short");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn media_is_served_in_byte_ranges_from_the_artifact_scheme() {
        let root = temp_dir("serve");
        let lib = Library::new(root.join("lib"));
        let file = root.join("clip.mp4");
        fs::write(&file, (0..=255).collect::<Vec<u8>>()).unwrap();
        let e = lib.add(&file, Origin::hand(&file), &|_| None).unwrap();
        let uri = format!("http://kolux-artifact.localhost/{}/clip.mp4", e.id);
        let ranged = tauri::http::Request::builder().uri(&uri).header("range", "bytes=10-12").body(Vec::new()).unwrap();
        let r = serve(&lib, &ranged);
        assert_eq!(r.status(), 206);
        assert_eq!(r.headers().get("content-range").and_then(|v| v.to_str().ok()), Some("bytes 10-12/256"));
        assert_eq!(r.headers().get("accept-ranges").and_then(|v| v.to_str().ok()), Some("bytes"));
        assert_eq!(r.body().as_slice(), &[10, 11, 12]);
        let full = tauri::http::Request::builder().uri(&uri).body(Vec::new()).unwrap();
        let r = serve(&lib, &full);
        assert_eq!(r.status(), 200);
        assert_eq!(r.body().len(), 256);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn workspace_artifacts_are_found_imported_once_and_refreshed_on_change() {
        let root = temp_dir("workspace");
        let ws = root.join("Project");
        fs::create_dir_all(ws.join("artifacts").join("nested")).unwrap();
        fs::create_dir_all(ws.join("artifacts").join("node_modules")).unwrap();
        fs::write(ws.join("artifacts").join("a.html"), "<title>A</title>").unwrap();
        fs::write(ws.join("artifacts").join("nested").join("b.png"), b"png").unwrap();
        fs::write(ws.join("artifacts").join("notes.md"), "# Notes").unwrap();
        fs::write(ws.join("artifacts").join("data.json"), "{}").unwrap();
        fs::write(ws.join("artifacts").join("skip.exe"), "no").unwrap();
        fs::write(ws.join("artifacts").join("page.html.tmp"), "partial").unwrap();
        fs::write(ws.join("artifacts").join(".DS_Store"), "noise").unwrap();
        fs::write(ws.join("artifacts").join("node_modules").join("c.html"), "<title>C</title>").unwrap();

        let files = workspace_files(&ws);
        assert_eq!(files.len(), 4, "every top-level file; a subfolder is not an entry: {files:?}");
        assert!(workspace_files(&root.join("missing")).is_empty());

        let lib = Library::new(root.join("lib"));
        let mut seen = std::collections::HashMap::new();
        let scan = |seen: &mut HashMap<String, (u64, u64)>| scan_workspace(&lib, &ws, Some("Project".into()), &|_| None, seen);
        assert_eq!(scan(&mut seen), Scanned { changed: 4, skipped: vec![] });
        let first = lib.list();
        assert_eq!(first.len(), 4);
        assert!(first.iter().all(|e| e.entry.source == "workspace" && e.entry.project.as_deref() == Some("Project")));
        assert_eq!(scan(&mut seen).changed, 0, "an unchanged folder adds nothing");

        fs::write(ws.join("artifacts").join("a.html"), "<title>A2</title>").unwrap();
        assert_eq!(scan(&mut seen).changed, 1, "only the changed page is refreshed");
        let again = lib.list();
        assert_eq!(again.len(), 4);
        assert!(again.iter().any(|e| e.entry.title == "A2"));
        let mut fresh = std::collections::HashMap::new();
        assert_eq!(scan(&mut fresh).changed, 0, "a new app run does not re-add entries the library already holds");

        // A page with its own assets: the stored size counts the assets too, which must not read as a change.
        fs::write(ws.join("artifacts").join("nested").join("c.png"), b"pngpngpng").unwrap();
        fs::write(ws.join("artifacts").join("site.html"), "<title>Site</title><img src=\"nested/c.png\">").unwrap();
        assert_eq!(scan(&mut fresh).changed, 1);
        let site = lib.list().into_iter().find(|e| e.entry.title == "Site").unwrap();
        assert!(site.entry.size > fs::metadata(ws.join("artifacts").join("site.html")).unwrap().len(), "the stored size holds the page and its asset");
        let mut fresh = std::collections::HashMap::new();
        assert_eq!(scan(&mut fresh).changed, 0, "a new app run does not re-add a page whose stored size includes its assets");
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_artifacts_folder_is_not_followed() {
        let root = temp_dir("linked");
        let ws = root.join("Project");
        let outside = root.join("outside");
        fs::create_dir_all(&ws).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("id_rsa"), "SECRET").unwrap();
        std::os::unix::fs::symlink(&outside, ws.join("artifacts")).unwrap();
        assert!(workspace_files(&ws).is_empty(), "a linked artifacts/ folder is never followed");
        let lib = Library::new(root.join("lib"));
        let mut seen = HashMap::new();
        assert_eq!(scan_workspace(&lib, &ws, Some("Project".into()), &|_| None, &mut seen).changed, 0);
        assert!(lib.list().is_empty());
        // A real folder still yields its file, and a linked file inside it is not followed either.
        fs::remove_file(ws.join("artifacts")).unwrap();
        fs::create_dir_all(ws.join("artifacts")).unwrap();
        fs::write(ws.join("artifacts").join("a.txt"), "ok").unwrap();
        std::os::unix::fs::symlink(outside.join("id_rsa"), ws.join("artifacts").join("key.txt")).unwrap();
        assert_eq!(workspace_files(&ws), vec![ws.join("artifacts").join("a.txt")]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_removed_workspace_file_stays_removed_until_it_changes() {
        let root = temp_dir("removed");
        let ws = root.join("Project");
        fs::create_dir_all(ws.join("artifacts").join("img")).unwrap();
        let a = ws.join("artifacts").join("a.html");
        fs::write(&a, "<title>A</title>").unwrap();
        let lib = Library::new(root.join("lib"));
        let scan = |seen: &mut HashMap<String, (u64, u64)>| scan_workspace(&lib, &ws, Some("Project".into()), &|_| None, seen).changed;
        let mut seen = HashMap::new();
        assert_eq!(scan(&mut seen), 1);
        let id = lib.list()[0].entry.id.clone();
        lib.remove(&id).unwrap();
        assert_eq!(scan(&mut seen), 0, "the same run keeps it removed");
        assert!(lib.list().is_empty());
        let mut fresh = HashMap::new();
        assert_eq!(scan(&mut fresh), 0, "the next app run must keep it removed too");
        assert!(lib.list().is_empty(), "a removed entry does not come back on the next launch");
        // A real rewrite is a new deliverable and is imported again.
        fs::write(&a, "<title>A rewritten</title>").unwrap();
        let mut fresh = HashMap::new();
        assert_eq!(scan(&mut fresh), 1, "a rewritten file is imported again");
        assert_eq!(lib.list()[0].entry.title, "A rewritten");
        // Removed again: a page with assets is kept removed by the file's own stamp, not the stored size.
        fs::write(ws.join("artifacts").join("img").join("p.png"), b"png").unwrap();
        fs::write(&a, "<title>With asset</title><img src=\"img/p.png\">").unwrap();
        let mut fresh = HashMap::new();
        assert_eq!(scan(&mut fresh), 1);
        lib.remove(&id).unwrap();
        let mut fresh = HashMap::new();
        assert_eq!(scan(&mut fresh), 0, "a removed page with assets stays removed");
        assert!(lib.list().is_empty());
        // Adding the same file by hand after a remove keeps it: the remove is forgotten.
        let hand = lib.add(&a, Origin::hand(&a), &|_| None).unwrap();
        assert_eq!(hand.id, id);
        let mut fresh = HashMap::new();
        assert_eq!(scan(&mut fresh), 0);
        assert_eq!(lib.list().len(), 1, "a hand-added file is kept after an earlier remove");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_restored_file_with_an_older_mtime_is_refreshed() {
        let root = temp_dir("restored");
        let ws = root.join("Project");
        fs::create_dir_all(ws.join("artifacts")).unwrap();
        let a = ws.join("artifacts").join("a.html");
        fs::write(&a, "<title>A</title>").unwrap();
        let lib = Library::new(root.join("lib"));
        let mut seen = HashMap::new();
        assert_eq!(scan_workspace(&lib, &ws, None, &|_| None, &mut seen).changed, 1);
        // Restored from a backup that kept the old time (cp -p, robocopy /COPY:DAT): older mtime, new content.
        fs::write(&a, "<title>Restored</title>").unwrap();
        let older = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        fs::File::options().write(true).open(&a).unwrap().set_modified(older).unwrap();
        let mut fresh = HashMap::new();
        assert_eq!(scan_workspace(&lib, &ws, None, &|_| None, &mut fresh).changed, 1);
        let list = lib.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].entry.title, "Restored", "a restored file counted as changed must also be refreshed");
        assert_eq!(scan_workspace(&lib, &ws, None, &|_| None, &mut HashMap::new()).changed, 0, "and it is then known");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_file_that_cannot_be_kept_is_reported_once_and_not_retried() {
        let root = temp_dir("toobig");
        let ws = root.join("Project");
        fs::create_dir_all(ws.join("artifacts")).unwrap();
        // A sparse file over the cap: nothing is written, only its length.
        fs::File::create(ws.join("artifacts").join("clip.mkv")).unwrap().set_len(MAX_FILE + 1).unwrap();
        fs::write(ws.join("artifacts").join("ok.txt"), "fine").unwrap();
        let lib = Library::new(root.join("lib"));
        let mut seen = HashMap::new();
        let first = scan_workspace(&lib, &ws, None, &|_| None, &mut seen);
        assert_eq!(first, Scanned { changed: 1, skipped: vec!["clip.mkv is larger than 100 MB".into()] });
        assert_eq!(lib.list().len(), 1);
        let second = scan_workspace(&lib, &ws, None, &|_| None, &mut seen);
        assert_eq!(second, Scanned::default(), "the same unchanged file is neither retried nor reported again");
        // A change to the file is tried again.
        fs::File::options().write(true).open(ws.join("artifacts").join("clip.mkv")).unwrap().set_len(10).unwrap();
        assert_eq!(scan_workspace(&lib, &ws, None, &|_| None, &mut seen).changed, 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_scan_command_runs_off_the_window_thread() {
        // An AppHandle is not to be had in a unit test, so the shape is checked in the source: like
        // artifact_add, the scan is async and does its copies and fetches on a blocking worker, and a
        // tick that finds one running does nothing instead of queueing behind it.
        let src = include_str!("artifacts.rs");
        let src = &src[..src.find("#[cfg(test)]").unwrap()]; // the code, not this test's own words
        let at = src.find("pub async fn artifacts_scan(").expect("artifacts_scan must be an async command: it copies files and fetches scripts");
        let body = &src[at..at + 1200];
        assert!(body.contains("spawn_blocking"), "the scan runs on a blocking worker");
        assert!(body.contains("try_lock()"), "an overlapping tick does not wait");
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
