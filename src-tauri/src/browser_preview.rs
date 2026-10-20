//! BROW-039: a worktree's HTML document previewed in a browser tab. The file's folder is served
//! from a loopback port (http://127.0.0.1:<port>/<token>/<file>), so the page's relative styles,
//! scripts and images resolve and the tab's address gate (T-500: http/https only, never a
//! `*.localhost` host) stays as it is. One token per folder; a path may not leave its folder.
//! ponytail: a thread per connection and whole files in memory; a worktree's own documents are small.
use serde_json::{json, Value};
use std::hash::{Hash, Hasher};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

#[derive(Clone, Debug)]
pub struct Preview {
    pub token: String,
    pub root: PathBuf,
}

static PREVIEWS: Mutex<Vec<Preview>> = Mutex::new(Vec::new());
static PORT: OnceLock<u16> = OnceLock::new();
/// The most a request line and its headers may take.
const REQUEST_MAX: usize = 8 * 1024;
pub const EXTENSIONS: &[&str] = &["html", "htm"];

fn port() -> Result<u16, String> {
    if let Some(p) = PORT.get() {
        return Ok(*p);
    }
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("preview port: {e}"))?;
    let p = listener.local_addr().map_err(|e| e.to_string())?.port();
    std::thread::spawn(move || {
        for s in listener.incoming().flatten() {
            std::thread::spawn(move || serve(s));
        }
    });
    Ok(*PORT.get_or_init(|| p))
}

fn token_of(root: &Path) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    root.to_string_lossy().to_lowercase().hash(&mut h);
    format!("{:016x}", h.finish())
}

/// Is this address an HTML document on disk? (`tab create --url` takes a path as well.)
pub fn is_document(path: &str) -> bool {
    let p = Path::new(path);
    p.is_file() && p.extension().and_then(|e| e.to_str()).is_some_and(|e| EXTENSIONS.contains(&e.to_lowercase().as_str()))
}

/// The preview of a document: its address, folder and file name.
pub fn add(path: &str) -> Result<Value, String> {
    if !is_document(path) {
        return Err(format!("{path} is not an HTML document on disk (.html or .htm)"));
    }
    let real = Path::new(path).canonicalize().map_err(|e| format!("{path}: {e}"))?;
    let root = real.parent().ok_or("the document has no folder")?.to_path_buf();
    let file = real.file_name().unwrap_or_default().to_string_lossy().to_string();
    let token = token_of(&root);
    if let Ok(mut p) = PREVIEWS.lock() {
        if !p.iter().any(|p| p.token == token) {
            p.push(Preview { token: token.clone(), root: root.clone() });
        }
    }
    let url = format!("http://127.0.0.1:{}/{token}/{}", port()?, encode(&file));
    Ok(json!({ "url": url, "folder": plain(&root), "file": file, "path": plain(&real) }))
}

/// What a tab's address previews, if it is one of ours: folder, file and the file's full path.
pub fn of(url: &str) -> Option<Value> {
    let port = *PORT.get()?;
    let rest = url.strip_prefix(&format!("http://127.0.0.1:{port}/"))?;
    let (token, file) = rest.split_once('/')?;
    let file = decode(file.split(['?', '#']).next().unwrap_or_default());
    let root = PREVIEWS.lock().ok()?.iter().find(|p| p.token == token)?.root.clone();
    let path = root.join(&file);
    Some(json!({ "folder": plain(&root), "file": file, "path": plain(&path) }))
}

fn plain(p: &Path) -> String {
    p.to_string_lossy().trim_start_matches(r"\\?\").to_string()
}

fn encode(s: &str) -> String {
    s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-._~/".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// The answer to one GET: status, media type and body. Pure, so it is tested without a socket.
pub fn respond(previews: &[Preview], target: &str) -> (u16, &'static str, Vec<u8>) {
    let path = target.split(['?', '#']).next().unwrap_or_default();
    let Some((token, rest)) = path.trim_start_matches('/').split_once('/') else {
        return (404, "text/plain", b"not a preview address".to_vec());
    };
    let Some(p) = previews.iter().find(|p| p.token == token) else {
        return (404, "text/plain", b"no such preview".to_vec());
    };
    let rest = decode(rest);
    if rest.split(['/', '\\']).any(|seg| seg == "..") || rest.contains('\0') {
        return (403, "text/plain", b"a preview stays in its folder".to_vec());
    }
    let file = p.root.join(rest.trim_start_matches('/'));
    let file = if file.is_dir() { file.join("index.html") } else { file };
    match (file.canonicalize(), p.root.canonicalize()) {
        (Ok(real), Ok(root)) if real.starts_with(&root) => match std::fs::read(&real) {
            Ok(bytes) => (200, mime(&real), bytes),
            Err(_) => (404, "text/plain", b"not found".to_vec()),
        },
        (Ok(_), Ok(_)) => (403, "text/plain", b"a preview stays in its folder".to_vec()),
        _ => (404, "text/plain", b"not found".to_vec()),
    }
}

fn mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(str::to_lowercase).as_deref() {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("json" | "map") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("wasm") => "application/wasm",
        Some("pdf") => "application/pdf",
        Some("txt" | "md") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn serve(mut s: TcpStream) {
    let _ = s.set_read_timeout(Some(std::time::Duration::from_secs(5)));
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") && buf.len() < REQUEST_MAX {
        match s.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    }
    let head = String::from_utf8_lossy(&buf);
    let mut words = head.lines().next().unwrap_or_default().split(' ');
    let (status, kind, body) = match (words.next(), words.next()) {
        (Some("GET") | Some("HEAD"), Some(target)) => respond(&PREVIEWS.lock().map(|p| p.clone()).unwrap_or_default(), target),
        _ => (405, "text/plain", b"GET only".to_vec()),
    };
    let reason = match status {
        200 => "OK",
        403 => "Forbidden",
        405 => "Method Not Allowed",
        _ => "Not Found",
    };
    let _ = write!(s, "HTTP/1.1 {status} {reason}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n", body.len());
    if head.starts_with("GET") {
        let _ = s.write_all(&body);
    }
    let _ = s.flush();
}

/// The front end asks for a document's preview address (a drop or a menu); the command line goes
/// through `add` itself.
#[tauri::command]
pub fn browser_preview(path: String) -> Result<Value, String> {
    add(&path)
}

/// Whether a tab's address is a preview of ours, and of which file (the pane shows a folder/file
/// chip instead of the address).
#[tauri::command]
pub fn browser_preview_of(url: String) -> Option<Value> {
    of(&url)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn site(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kolux-preview-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("css")).unwrap();
        std::fs::write(dir.join("index.html"), "<link rel=stylesheet href=css/a.css><h1>Hi</h1>").unwrap();
        std::fs::write(dir.join("css").join("a.css"), "h1{color:red}").unwrap();
        std::fs::write(dir.join("a b.html"), "<p>space</p>").unwrap();
        dir
    }

    #[test]
    fn brow039_a_preview_serves_its_folder_and_nothing_outside_it() {
        let dir = site("serve");
        let p = vec![Preview { token: "t1".into(), root: dir.clone() }];
        let (s, k, b) = respond(&p, "/t1/index.html?x=1");
        assert_eq!((s, k), (200, "text/html; charset=utf-8"));
        assert!(b.starts_with(b"<link"));
        assert_eq!(respond(&p, "/t1/css/a.css").1, "text/css; charset=utf-8");
        assert_eq!(respond(&p, "/t1/").0, 200, "a folder answers with its index");
        assert_eq!(respond(&p, "/t1/a%20b.html").2, b"<p>space</p>");
        assert_eq!(respond(&p, "/t1/../secret.txt").0, 403);
        assert_eq!(respond(&p, "/t1/css/..%2F..%2Fsecret.txt").0, 403);
        assert_eq!(respond(&p, "/t1/missing.css").0, 404);
        assert_eq!(respond(&p, "/nope/index.html").0, 404);
        assert_eq!(respond(&p, "/t1").0, 404);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn brow039_a_document_gets_a_loopback_address_and_the_address_names_the_document() {
        let dir = site("add");
        let doc = dir.join("index.html").to_string_lossy().to_string();
        assert!(is_document(&doc));
        assert!(!is_document(&dir.join("css").join("a.css").to_string_lossy()));
        assert!(!is_document("https://example.com/index.html"));
        let v = add(&doc).unwrap();
        let url = v["url"].as_str().unwrap();
        assert!(url.starts_with("http://127.0.0.1:") && url.ends_with("/index.html"), "{url}");
        assert_eq!(v["file"], "index.html");
        let back = of(url).unwrap();
        assert_eq!(back["file"], "index.html");
        assert_eq!(back["folder"], v["folder"]);
        assert!(of("https://example.com/").is_none());
        assert!(add(&dir.join("css").join("a.css").to_string_lossy()).unwrap_err().contains("not an HTML document"));
        // The same folder keeps one token, so two documents share the port and prefix.
        let v2 = add(&dir.join("a b.html").to_string_lossy()).unwrap();
        assert_eq!(v2["url"].as_str().unwrap().rsplit_once('/').unwrap().0, url.rsplit_once('/').unwrap().0);
        assert!(v2["url"].as_str().unwrap().ends_with("/a%20b.html"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
