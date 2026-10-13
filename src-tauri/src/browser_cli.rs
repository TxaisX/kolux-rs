// T-195: the browser verbs of the command line (BROW-042, BROW-046, BROW-047). Every verb acts
// on the worktree's active browser tab, found in the window's layout report at the moment the
// command runs, so switching tabs moves the target and nothing stale can hold on to one. The
// page is driven through its own DevTools protocol (`browser_drive`); element references come
// from `snapshot` and live in the page.
use crate::browser;
use crate::browser_drive::{self as drive, CALL_WAIT};
use crate::cli::{Command, Ctx, Fail, Request};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const TARGET: &[&str] = &["worktree", "page"];
const ELEMENT: &[&str] = &["element", "worktree", "page"];
pub const COMMANDS: &[Command] = &[
    ("goto", "browser.goto", &["url", "timeout", "worktree", "page"]),
    ("back", "browser.back", TARGET),
    ("forward", "browser.forward", TARGET),
    ("reload", "browser.reload", TARGET),
    ("wait", "browser.wait", &["selector", "timeout", "text", "url", "load", "fn", "state", "worktree", "page"]),
    ("eval", "browser.eval", &["expression", "worktree", "page"]),
    ("scroll", "browser.scroll", &["direction", "amount", "worktree", "page"]),
    ("snapshot", "browser.snapshot", TARGET),
    ("screenshot", "browser.screenshot", &["format", "path", "worktree", "page"]),
    ("full-screenshot", "browser.full-screenshot", &["format", "path", "worktree", "page"]),
    ("pdf", "browser.pdf", &["path", "worktree", "page"]),
    ("click", "browser.click", ELEMENT),
    ("dblclick", "browser.dblclick", ELEMENT),
    ("check", "browser.check", ELEMENT),
    ("uncheck", "browser.uncheck", ELEMENT),
    ("focus", "browser.focus", ELEMENT),
    ("clear", "browser.clear", ELEMENT),
    ("select-all", "browser.select-all", ELEMENT),
    ("hover", "browser.hover", ELEMENT),
    ("scrollintoview", "browser.scrollintoview", ELEMENT),
    ("fill", "browser.fill", &["element", "value", "worktree", "page"]),
    ("type", "browser.type", &["input", "worktree", "page"]),
    ("inserttext", "browser.inserttext", &["text", "worktree", "page"]),
    ("select", "browser.select", &["element", "value", "worktree", "page"]),
    ("keypress", "browser.keypress", &["key", "worktree", "page"]),
    ("drag", "browser.drag", &["from", "to", "worktree", "page"]),
    ("upload", "browser.upload", &["element", "files", "worktree", "page"]),
    ("highlight", "browser.highlight", &["selector", "worktree", "page"]),
    ("find", "browser.find", &["locator", "value", "action", "text", "worktree", "page"]),
    ("get", "browser.get", &["what", "element", "worktree", "page"]),
    ("is", "browser.is", &["what", "element", "worktree", "page"]),
    ("mouse move", "browser.mouse.move", &["x", "y", "worktree", "page"]),
    ("mouse down", "browser.mouse.down", &["button", "worktree", "page"]),
    ("mouse up", "browser.mouse.up", &["button", "worktree", "page"]),
    ("mouse wheel", "browser.mouse.wheel", &["dy", "dx", "worktree", "page"]),
    ("exec", "browser.exec", &["command", "worktree", "page"]),
];

/// `--format` is a switch elsewhere, so `screenshot --format png` leaves png as a bare word.
pub fn bare(path: &[String]) -> Option<&'static str> {
    match (path.len(), path.first().map(String::as_str)) {
        (2, Some("screenshot" | "full-screenshot")) => Some("format"),
        _ => None,
    }
}

/// The default time limit of a wait, in milliseconds.
const WAIT_MS: u64 = 30_000;
/// Typed text goes to the page in pieces this long, in order (BROW-047).
const PIECE: usize = 512;

/// Where the mouse was last moved to, per tab (CSS pixels in the page's viewport).
static MOUSE: Mutex<Option<HashMap<u32, (f64, f64)>>> = Mutex::new(None);

fn mouse_at(id: u32) -> (f64, f64) {
    MOUSE.lock().ok().and_then(|m| m.as_ref().and_then(|m| m.get(&id).copied())).unwrap_or((0.0, 0.0))
}

fn mouse_to(id: u32, x: f64, y: f64) {
    if let Ok(mut m) = MOUSE.lock() {
        m.get_or_insert_with(HashMap::new).insert(id, (x, y));
    }
}

/// BROW-042: the tab a command acts on. `--page` names one by its id; otherwise it is the
/// worktree's active browser tab: the one in view and focused, else the one in view, else the
/// one it has. `rows` is the window's layout report.
pub fn pick(rows: &[Value], page: Option<&str>, worktree: &str, same: impl Fn(&str) -> bool) -> Result<u32, Fail> {
    let tabs: Vec<&Value> = rows.iter().filter(|r| r["browser"].is_u64()).collect();
    let id = |r: &Value| r["browser"].as_u64().unwrap_or_default() as u32;
    if let Some(p) = page {
        let want: u64 = p.trim_start_matches("browser-").parse().map_err(|_| Fail::args(format!("--page {p} is not a tab id; kolux-dev terminal list --include-visual-layouts shows them")))?;
        return tabs.iter().find(|r| r["browser"] == want).map(|r| id(r)).ok_or_else(|| Fail::new("not_found", format!("no browser tab {want} is open")));
    }
    let mine: Vec<&Value> = tabs.iter().copied().filter(|r| r["dir"].as_str().is_some_and(&same)).collect();
    let shown = |r: &Value| r["shown"] == true;
    let best = mine.iter().find(|r| shown(r) && r["focused"] == true).or_else(|| mine.iter().find(|r| shown(r))).or_else(|| mine.first());
    best.map(|r| id(r)).ok_or_else(|| Fail {
        code: "not_found",
        message: format!("no browser tab is open in the worktree at {worktree}"),
        data: json!({ "hint": "open one there first (the tab strip's New tab menu, Browser), or name a tab with --page <id>" }),
    })
}

fn target(ctx: &Ctx<'_>, req: &Request) -> Result<u32, Fail> {
    let text = |k: &str| req.args[k].as_str().map(str::trim).filter(|s| !s.is_empty());
    match text("page") {
        Some(p) => pick(&ctx.terminals.layout(), Some(p), "", |_| false),
        None => {
            let (_, w) = crate::cli::pick_worktree(ctx, text("worktree").unwrap_or("current"), &req.cwd)?;
            pick(&ctx.terminals.layout(), None, &w.path, |d| crate::cli::same_dir(d, &w.path))
        }
    }
}

fn fail(e: String) -> Fail {
    Fail::new("failed", e)
}

fn ms(a: &Value) -> Duration {
    Duration::from_millis(a["timeout"].as_str().and_then(|t| t.parse().ok()).unwrap_or(WAIT_MS))
}

fn js(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_default()
}

fn num(a: &Value, k: &str) -> Result<f64, Fail> {
    a[k].as_str().and_then(|v| v.parse().ok()).ok_or_else(|| Fail::args(format!("--{k} must be a number")))
}

fn mouse(id: u32, kind: &str, x: f64, y: f64, extra: Value) -> Result<(), Fail> {
    let mut ev = json!({ "type": kind, "x": x, "y": y });
    if let (Some(m), Some(o)) = (ev.as_object_mut(), extra.as_object()) {
        m.extend(o.clone());
    }
    drive::cdp(id, "Input.dispatchMouseEvent", ev, CALL_WAIT).map(|_| ()).map_err(fail)
}

/// A click (or two) at an element's centre, as the mouse would do it.
fn click(id: u32, el: &str, count: u32) -> Result<Value, Fail> {
    let b = drive::driver(id, &format!("box({})", js(el)), CALL_WAIT).map_err(fail)?;
    let (x, y) = (b["cx"].as_f64().unwrap_or_default(), b["cy"].as_f64().unwrap_or_default());
    mouse(id, "mouseMoved", x, y, json!({}))?;
    for n in 1..=count {
        mouse(id, "mousePressed", x, y, json!({ "button": "left", "clickCount": n }))?;
        mouse(id, "mouseReleased", x, y, json!({ "button": "left", "clickCount": n }))?;
    }
    mouse_to(id, x, y);
    Ok(json!({ "element": el, "x": x, "y": y }))
}

fn insert(id: u32, text: &str) -> Result<(), Fail> {
    let chars: Vec<char> = text.chars().collect();
    for piece in chars.chunks(PIECE) {
        drive::cdp(id, "Input.insertText", json!({ "text": piece.iter().collect::<String>() }), CALL_WAIT).map_err(fail)?;
    }
    Ok(())
}

fn save(req: &Request, data: &str, kind: &str, ext: &str) -> Result<String, Fail> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| fail(e.to_string()))?;
    let path = match req.args["path"].as_str().map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => std::path::Path::new(&req.cwd).join(p),
        None => {
            let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or_default();
            std::path::Path::new(&req.cwd).join(format!("kolux-{kind}-{t}.{ext}"))
        }
    };
    std::fs::write(&path, bytes).map_err(|e| fail(format!("could not save {}: {e}", path.display())))?;
    Ok(path.to_string_lossy().into_owned())
}

/// The one condition a wait looks for, as a page expression that is true once it holds.
pub fn wait_condition(a: &Value) -> Result<String, Fail> {
    let s = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty());
    if let Some(sel) = s("selector") {
        return Ok(match s("state") {
            Some("hidden") => format!("!window.__kd.visible({})", js(sel)),
            Some("visible") => format!("window.__kd.visible({})", js(sel)),
            Some(other) => return Err(Fail::args(format!("--state {other} is not hidden or visible"))),
            None => format!("!!document.querySelector({})", js(sel)),
        });
    }
    if let Some(t) = s("text") {
        return Ok(format!("document.body.innerText.includes({})", js(t)));
    }
    if let Some(u) = s("url") {
        return Ok(format!("new RegExp({}).test(location.href)", js(u)));
    }
    if let Some(l) = s("load") {
        return Ok(match l {
            "load" | "complete" | "networkidle" => "document.readyState === 'complete'".into(),
            "domcontentloaded" | "interactive" => "document.readyState !== 'loading'".into(),
            other => return Err(Fail::args(format!("--load {other} is not load, domcontentloaded or networkidle"))),
        });
    }
    if let Some(f) = s("fn") {
        return Ok(format!("!!({f})"));
    }
    Err(Fail::args("wait needs one of --selector, --text, --url, --load or --fn"))
}

/// Polls `expr` in the page until it is true or the time runs out. A page mid-navigation
/// cannot answer; that counts as not yet.
fn wait_for(id: u32, expr: &str, limit: Duration, what: &str) -> Result<u128, Fail> {
    let start = Instant::now();
    loop {
        if drive::driver(id, &format!("visible && ({expr})"), CALL_WAIT).ok().is_some_and(|v| v == true) {
            return Ok(start.elapsed().as_millis());
        }
        if start.elapsed() >= limit {
            return Err(Fail { code: "timeout", message: format!("{what} did not happen within {} ms", limit.as_millis()), data: json!({ "hint": "raise --timeout, or check the page with kolux-dev snapshot" }) });
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

pub fn dispatch(ctx: &Ctx<'_>, req: &Request) -> Result<Value, Fail> {
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let need = |k: &str| text(k).ok_or_else(|| Fail::args(format!("--{k} is required")));
    // Typed text keeps its spaces: a leading one is part of what the user asked for.
    let raw = |k: &str| a[k].as_str().filter(|s| !s.is_empty()).map(str::to_string).ok_or_else(|| Fail::args(format!("--{k} is required")));
    let id = target(ctx, req)?;
    let tabs = drive::tabs().map_err(fail)?;
    let call = |c: String| drive::driver(id, &c, CALL_WAIT).map_err(fail);
    let verb = req.command.strip_prefix("browser.").unwrap_or(&req.command);
    let out = match verb {
        "goto" => {
            let url = browser::parse(&need("url")?).map_err(Fail::args)?;
            browser::allowed(&url, tabs.app_origin().as_ref()).map_err(Fail::args)?;
            let before = drive::eval(id, "location.href", CALL_WAIT).unwrap_or_default();
            tabs.navigate(id, url.clone()).map_err(fail)?;
            // BROW-046: a load cut short by a download leaves the page as it was; that shows as
            // the same address still complete after a moment, and is not a failure.
            let start = Instant::now();
            let limit = ms(a);
            let state = loop {
                std::thread::sleep(Duration::from_millis(100));
                let now = drive::eval(id, "[location.href, document.readyState]", CALL_WAIT).unwrap_or_default();
                let moved = now[0] != before || now[0] == url.as_str();
                if now[1] == "complete" && (moved || start.elapsed() > Duration::from_millis(1500)) {
                    break now;
                }
                if start.elapsed() >= limit {
                    return Err(Fail { code: "timeout", message: format!("{url} did not finish loading within {} ms", limit.as_millis()), data: json!({ "url": url.as_str() }) });
                }
            };
            let unchanged = state[0] == before && state[0] != url.as_str();
            // A page the browser could not reach shows its own error page; that is a failure, not a load.
            if state[0].as_str().is_some_and(|u| u.starts_with("chrome-error://")) {
                let why = drive::eval(id, "document.body.innerText.split('\\n').filter(Boolean).slice(0, 2).join(' ')", CALL_WAIT).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default();
                return Err(Fail { code: "load_failed", message: format!("{url} could not be loaded: {why}"), data: json!({ "url": url.as_str() }) });
            }
            json!({ "tab": id, "url": state[0], "unchanged": unchanged })
        }
        "back" | "forward" => {
            tabs.run(id, browser::script(verb).unwrap_or_default()).map_err(fail)?;
            json!({ "tab": id, "did": verb })
        }
        "reload" => {
            tabs.reload(id).map_err(fail)?;
            json!({ "tab": id, "did": verb })
        }
        "wait" => {
            let cond = wait_condition(a)?;
            let took = wait_for(id, &cond, ms(a), "the condition")?;
            json!({ "tab": id, "ms": took })
        }
        "eval" => json!({ "tab": id, "value": drive::eval(id, &need("expression")?, CALL_WAIT).map_err(fail)? }),
        "scroll" => {
            let dir = text("direction").unwrap_or_else(|| "down".into());
            if dir != "up" && dir != "down" {
                return Err(Fail::args("--direction must be up or down"));
            }
            let amount = text("amount").map(|s| s.parse::<f64>().map_err(|_| Fail::args("--amount must be a number of pixels"))).transpose()?;
            json!({ "tab": id, "scrollY": call(format!("scroll({}, {})", js(&dir), amount.map_or("null".to_string(), |n| n.to_string())))? })
        }
        "snapshot" => json!({ "tab": id, "snapshot": call("snapshot()".into())? }),
        "screenshot" | "full-screenshot" => {
            let format = text("format").unwrap_or_else(|| "png".into());
            if format != "png" && format != "jpeg" {
                return Err(Fail::args("--format must be png or jpeg"));
            }
            let mut params = json!({ "format": format });
            if verb == "full-screenshot" {
                let m = drive::cdp(id, "Page.getLayoutMetrics", json!({}), CALL_WAIT).map_err(fail)?;
                let size = &m["cssContentSize"];
                params["captureBeyondViewport"] = json!(true);
                params["clip"] = json!({ "x": 0, "y": 0, "width": size["width"], "height": size["height"], "scale": 1 });
            }
            let shot = drive::cdp(id, "Page.captureScreenshot", params, CALL_WAIT).map_err(fail)?;
            let ext = if format == "jpeg" { "jpg" } else { "png" };
            json!({ "tab": id, "path": save(req, shot["data"].as_str().unwrap_or_default(), verb, ext)?, "full": verb == "full-screenshot" })
        }
        "pdf" => {
            let pdf = drive::cdp(id, "Page.printToPDF", json!({ "printBackground": true }), CALL_WAIT).map_err(fail)?;
            json!({ "tab": id, "path": save(req, pdf["data"].as_str().unwrap_or_default(), "page", "pdf")? })
        }
        "click" => click(id, &need("element")?, 1)?,
        "dblclick" => click(id, &need("element")?, 2)?,
        "hover" => {
            let el = need("element")?;
            let b = call(format!("box({})", js(&el)))?;
            let (x, y) = (b["cx"].as_f64().unwrap_or_default(), b["cy"].as_f64().unwrap_or_default());
            mouse(id, "mouseMoved", x, y, json!({}))?;
            mouse_to(id, x, y);
            json!({ "element": el, "x": x, "y": y })
        }
        "check" | "uncheck" | "focus" | "clear" | "select-all" | "scrollintoview" => {
            let el = need("element")?;
            json!({ "element": el, "result": call(format!("act({}, {}, null)", js(verb), js(&el)))? })
        }
        "fill" => {
            let (el, v) = (need("element")?, raw("value")?);
            json!({ "element": el, "result": call(format!("act('fill', {}, {})", js(&el), js(&v)))? })
        }
        "select" => {
            let (el, v) = (need("element")?, need("value")?);
            json!({ "element": el, "value": call(format!("act('select', {}, {})", js(&el), js(&v)))? })
        }
        "highlight" => {
            let el = need("selector")?;
            json!({ "element": el, "result": call(format!("act('highlight', {}, null)", js(&el)))? })
        }
        "type" | "inserttext" => {
            let t = raw(if verb == "type" { "input" } else { "text" })?;
            insert(id, &t)?;
            json!({ "tab": id, "typed": t.chars().count() })
        }
        "keypress" => {
            let ev = drive::key_event(&need("key")?).map_err(Fail::args)?;
            let mut down = ev.clone();
            down["type"] = json!(if ev.get("text").is_some() { "keyDown" } else { "rawKeyDown" });
            drive::cdp(id, "Input.dispatchKeyEvent", down, CALL_WAIT).map_err(fail)?;
            let mut up = ev.clone();
            up["type"] = json!("keyUp");
            if let Some(m) = up.as_object_mut() {
                m.remove("text");
            }
            drive::cdp(id, "Input.dispatchKeyEvent", up, CALL_WAIT).map_err(fail)?;
            json!({ "tab": id, "key": ev["key"] })
        }
        "drag" => {
            let (from, to) = (need("from")?, need("to")?);
            let a = call(format!("box({})", js(&from)))?;
            let (x1, y1) = (a["cx"].as_f64().unwrap_or_default(), a["cy"].as_f64().unwrap_or_default());
            mouse(id, "mouseMoved", x1, y1, json!({}))?;
            mouse(id, "mousePressed", x1, y1, json!({ "button": "left", "clickCount": 1 }))?;
            let b = call(format!("box({})", js(&to)))?;
            let (x2, y2) = (b["cx"].as_f64().unwrap_or_default(), b["cy"].as_f64().unwrap_or_default());
            mouse(id, "mouseMoved", (x1 + x2) / 2.0, (y1 + y2) / 2.0, json!({ "button": "left" }))?;
            mouse(id, "mouseMoved", x2, y2, json!({ "button": "left" }))?;
            mouse(id, "mouseReleased", x2, y2, json!({ "button": "left", "clickCount": 1 }))?;
            mouse_to(id, x2, y2);
            call(format!("drag({}, {})", js(&from), js(&to)))?;
            json!({ "from": from, "to": to })
        }
        "upload" => {
            let el = need("element")?;
            let files: Vec<String> = need("files")?.split(',').map(|f| std::path::Path::new(&req.cwd).join(f.trim()).to_string_lossy().into_owned()).collect();
            for f in &files {
                if !std::path::Path::new(f).is_file() {
                    return Err(Fail::args(format!("{f} is not a file")));
                }
            }
            let r = drive::cdp(id, "Runtime.evaluate", json!({ "expression": format!("(() => {{ if (!window.__kd) {{ {} }} return window.__kd.el({}); }})()", drive::DRIVER, js(&el)) }), CALL_WAIT).map_err(fail)?;
            let object = r["result"]["objectId"].as_str().ok_or_else(|| fail(format!("{el} is not an element of the current page; run snapshot first")))?;
            drive::cdp(id, "DOM.setFileInputFiles", json!({ "files": files, "objectId": object }), CALL_WAIT).map_err(fail)?;
            json!({ "element": el, "files": files })
        }
        "find" => {
            let (locator, value) = (need("locator")?, need("value")?);
            let el = call(format!("find({}, {})", js(&locator), js(&value)))?.as_str().unwrap_or_default().to_string();
            let action = text("action").unwrap_or_else(|| "click".into());
            let done = match action.as_str() {
                "click" => click(id, &el, 1)?,
                "dblclick" => click(id, &el, 2)?,
                "fill" | "select" => {
                    let t = need("text")?;
                    json!({ "result": call(format!("act({}, {}, {})", js(&action), js(&el), js(&t)))? })
                }
                "hover" => {
                    let b = call(format!("box({})", js(&el)))?;
                    mouse(id, "mouseMoved", b["cx"].as_f64().unwrap_or_default(), b["cy"].as_f64().unwrap_or_default(), json!({}))?;
                    json!({ "result": true })
                }
                "none" | "locate" => json!({}),
                other => json!({ "result": call(format!("act({}, {}, null)", js(other), js(&el)))? }),
            };
            json!({ "element": el, "action": action, "done": done })
        }
        "get" => {
            let what = need("what")?;
            json!({ "what": what, "value": call(format!("get({}, {})", js(&what), text("element").map_or("null".to_string(), |e| js(&e))))? })
        }
        "is" => {
            let (what, el) = (need("what")?, need("element")?);
            json!({ "what": what, "element": el, "value": call(format!("is({}, {})", js(&what), js(&el)))? })
        }
        "mouse.move" => {
            let (x, y) = (num(a, "x")?, num(a, "y")?);
            mouse(id, "mouseMoved", x, y, json!({}))?;
            mouse_to(id, x, y);
            json!({ "x": x, "y": y })
        }
        "mouse.down" | "mouse.up" => {
            let (x, y) = mouse_at(id);
            let button = text("button").unwrap_or_else(|| "left".into());
            mouse(id, if verb == "mouse.down" { "mousePressed" } else { "mouseReleased" }, x, y, json!({ "button": button, "clickCount": 1 }))?;
            json!({ "x": x, "y": y, "button": button })
        }
        "mouse.wheel" => {
            let (x, y) = mouse_at(id);
            let dy = num(a, "dy")?;
            let dx = a["dx"].as_str().and_then(|v| v.parse().ok()).unwrap_or(0.0);
            mouse(id, "mouseWheel", x, y, json!({ "deltaX": dx, "deltaY": dy }))?;
            json!({ "x": x, "y": y, "dx": dx, "dy": dy })
        }
        "exec" => {
            // BROW-042: the raw pass-through is a DevTools protocol call, "<Domain.method> {json}".
            let c = need("command")?;
            let (method, params) = c.split_once(char::is_whitespace).unwrap_or((&c, "{}"));
            let params: Value = serde_json::from_str(params.trim()).map_err(|e| Fail::args(format!("the parameters after {method} are not JSON: {e}")))?;
            json!({ "tab": id, "method": method, "result": drive::cdp(id, method, params, ms(a)).map_err(fail)? })
        }
        other => return Err(Fail::args(format!("unknown browser command {other}"))),
    };
    Ok(out)
}

/// What a browser command prints without `--json`.
pub fn text(command: &str, r: &Value) -> Option<String> {
    let verb = command.strip_prefix("browser.")?;
    let s = |k: &str| r[k].as_str().unwrap_or_default().to_string();
    Some(match verb {
        "goto" if r["unchanged"] == true => format!("the page stayed at {} (the load went to a download or did not start)", s("url")),
        "goto" => format!("tab {} is at {}", r["tab"], s("url")),
        "back" | "forward" | "reload" => format!("tab {}: {verb}", r["tab"]),
        "wait" => format!("ok after {} ms", r["ms"]),
        "eval" | "get" | "is" => match &r["value"] {
            Value::String(v) => v.clone(),
            v => serde_json::to_string_pretty(v).unwrap_or_default(),
        },
        "scroll" => format!("scrolled to y={}", r["scrollY"]),
        "snapshot" => s("snapshot"),
        "screenshot" | "full-screenshot" | "pdf" => format!("saved {}", s("path")),
        "click" | "dblclick" | "hover" => format!("{verb} {} at {}, {}", s("element"), r["x"], r["y"]),
        "select" => format!("{} selected {}", s("element"), r["value"]),
        "type" | "inserttext" => format!("typed {} characters", r["typed"]),
        "keypress" => format!("pressed {}", s("key")),
        "drag" => format!("dragged {} to {}", s("from"), s("to")),
        "upload" => format!("{} takes {}", s("element"), r["files"].as_array().map(|f| f.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", ")).unwrap_or_default()),
        "find" => format!("{} {}: {}", s("action"), s("element"), if r["done"]["result"].is_null() { "done".to_string() } else { r["done"]["result"].to_string() }),
        "mouse.move" | "mouse.down" | "mouse.up" | "mouse.wheel" => format!("mouse at {}, {}", r["x"], r["y"]),
        "exec" => serde_json::to_string_pretty(&r["result"]).unwrap_or_default(),
        _ => format!("{verb} {}: ok", s("element")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brow042_the_target_is_the_worktrees_active_browser_tab() {
        let rows = vec![
            json!({ "handle": "term-1", "dir": "G:/w/a", "shown": true }),
            json!({ "browser": 4, "dir": "G:/w/a", "shown": false, "focused": false }),
            json!({ "browser": 7, "dir": "G:/w/a", "shown": true, "focused": false }),
            json!({ "browser": 9, "dir": "G:/w/a", "shown": true, "focused": true }),
            json!({ "browser": 12, "dir": "G:/w/b", "shown": false, "focused": false }),
        ];
        let in_a = |d: &str| d == "G:/w/a";
        assert_eq!(pick(&rows, None, "G:/w/a", in_a).unwrap(), 9, "in view and focused wins");
        let rows2: Vec<Value> = rows.iter().filter(|r| r["browser"] != 9).cloned().collect();
        assert_eq!(pick(&rows2, None, "G:/w/a", in_a).unwrap(), 7, "then the one in view");
        assert_eq!(pick(&rows, None, "G:/w/b", |d| d == "G:/w/b").unwrap(), 12, "a hidden tab is still driven");
        let none = pick(&rows, None, "G:/w/c", |d| d == "G:/w/c").unwrap_err();
        assert_eq!(none.code, "not_found");
        assert!(none.message.contains("no browser tab is open in the worktree at G:/w/c"), "{}", none.message);
        assert_eq!(pick(&rows, Some("12"), "", |_| false).unwrap(), 12, "--page names any tab");
        assert_eq!(pick(&rows, Some("3"), "", |_| false).unwrap_err().code, "not_found");
        assert_eq!(pick(&rows, Some("x"), "", |_| false).unwrap_err().code, "invalid_arguments");
    }

    #[test]
    fn brow046_wait_conditions_are_page_expressions() {
        assert_eq!(wait_condition(&json!({ "text": "Done" })).unwrap(), "document.body.innerText.includes(\"Done\")");
        assert_eq!(wait_condition(&json!({ "selector": "#x", "state": "hidden" })).unwrap(), "!window.__kd.visible(\"#x\")");
        assert_eq!(wait_condition(&json!({ "selector": "#x" })).unwrap(), "!!document.querySelector(\"#x\")");
        assert_eq!(wait_condition(&json!({ "load": "load" })).unwrap(), "document.readyState === 'complete'");
        assert_eq!(wait_condition(&json!({ "url": "docs/.*" })).unwrap(), "new RegExp(\"docs/.*\").test(location.href)");
        assert_eq!(wait_condition(&json!({ "fn": "window.ready" })).unwrap(), "!!(window.ready)");
        assert_eq!(wait_condition(&json!({})).unwrap_err().code, "invalid_arguments");
        assert_eq!(ms(&json!({ "timeout": "2000" })), Duration::from_millis(2000));
        assert_eq!(ms(&json!({})), Duration::from_millis(WAIT_MS));
    }

    #[test]
    fn brow046_the_command_line_keeps_a_browser_verbs_flags() {
        let words: Vec<String> = ["goto", "--url", "https://example.com", "--page", "7", "--timeout", "500"].iter().map(|w| w.to_string()).collect();
        let (_, parsed) = crate::cli::parse(&words);
        let p = parsed.expect("parses").expect("a command");
        assert_eq!(p.command, "browser.goto");
        assert_eq!(p.args["url"], "https://example.com");
        assert_eq!(p.args["page"], "7");
        assert_eq!(p.args["timeout"], "500");
        let words: Vec<String> = ["mouse", "wheel", "--dy", "300"].iter().map(|w| w.to_string()).collect();
        let p = crate::cli::parse(&words).1.unwrap().unwrap();
        assert_eq!((p.command.as_str(), p.args["dy"].as_str()), ("browser.mouse.wheel", Some("300")));
    }

    #[test]
    fn brow046_047_every_card_verb_is_a_command_and_prints_as_text() {
        for verb in ["goto", "back", "forward", "reload", "wait", "eval", "scroll", "snapshot", "screenshot", "full-screenshot", "pdf", "click", "dblclick", "fill", "type", "inserttext", "select", "keypress", "drag", "upload", "find", "get", "is", "mouse move", "mouse wheel", "exec", "highlight", "check", "uncheck", "focus", "clear", "select-all", "hover", "scrollintoview"] {
            assert!(COMMANDS.iter().any(|c| c.0 == verb), "{verb}");
        }
        assert!(COMMANDS.iter().all(|c| c.2.contains(&"worktree") && c.2.contains(&"page")), "every browser command takes --worktree and --page");
        assert_eq!(text("browser.snapshot", &json!({ "snapshot": "- link \"Docs\" [ref=e1]" })).as_deref(), Some("- link \"Docs\" [ref=e1]"));
        assert_eq!(text("browser.get", &json!({ "value": "hello" })).as_deref(), Some("hello"));
        assert_eq!(text("browser.is", &json!({ "value": false })).as_deref(), Some("false"));
        assert_eq!(text("browser.goto", &json!({ "tab": 3, "url": "https://example.com/", "unchanged": false })).as_deref(), Some("tab 3 is at https://example.com/"));
        assert!(text("browser.goto", &json!({ "url": "https://a/", "unchanged": true })).unwrap().contains("stayed"));
        assert_eq!(text("terminal.list", &json!({})), None);
        assert_eq!(bare(&["screenshot".into(), "png".into()]), Some("format"));
        assert_eq!(bare(&["click".into(), "e1".into()]), None);
    }
}
