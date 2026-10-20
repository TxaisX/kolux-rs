//! T-195 (BROW-042, BROW-046, BROW-047): the `kolux` browser commands. An agent in a worktree
//! runs `kolux goto`, `kolux snapshot`, `kolux click --element e12` and the rest; each command goes
//! to the worktree's active browser tab (or `--page <n>`), where the user can watch. Kolux is its
//! own page-driving helper: every command is a script run inside the page through the web view
//! (no third-party automation helper is pinned; owner decision recorded in the T-195 commit). The
//! helper's state (the element references a snapshot hands out) lives in the page, so a page that
//! is replaced starts clean and an old reference is refused with "run snapshot again".
//!
//! `cli.rs` is a shared file: it gains this module's table, check, run and text by
//! `evidence/browser-T-195-cli.rs.patch`; until that lands nothing here is reachable, hence the allow.
#![allow(dead_code)]

use super::{eval_json, pick_tab, tabs, EVAL_WAIT};
use crate::cli::{Fail, Request};
use serde_json::{json, Map, Value};
use std::time::{Duration, Instant};

pub type Command = (&'static str, &'static str, &'static [&'static str]);

/// Every browser command path, its wire name and its flags (`--worktree`, `--page` and `--json`
/// on all of them; BROW-042 Compat).
pub const COMMANDS: &[Command] = &[
    ("goto", "browser.goto", &["url", "worktree", "page"]),
    ("back", "browser.back", &["worktree", "page"]),
    ("forward", "browser.forward", &["worktree", "page"]),
    ("reload", "browser.reload", &["worktree", "page"]),
    ("wait", "browser.wait", &["selector", "timeout", "text", "url", "load", "fn", "state", "worktree", "page"]),
    ("eval", "browser.eval", &["expression", "worktree", "page"]),
    ("scroll", "browser.scroll", &["direction", "amount", "worktree", "page"]),
    ("snapshot", "browser.snapshot", &["worktree", "page"]),
    ("screenshot", "browser.screenshot", &["format", "worktree", "page"]),
    ("full-screenshot", "browser.full-screenshot", &["format", "worktree", "page"]),
    ("pdf", "browser.pdf", &["worktree", "page"]),
    ("click", "browser.click", &["element", "worktree", "page"]),
    ("dblclick", "browser.dblclick", &["element", "worktree", "page"]),
    ("check", "browser.check", &["element", "worktree", "page"]),
    ("uncheck", "browser.uncheck", &["element", "worktree", "page"]),
    ("focus", "browser.focus", &["element", "worktree", "page"]),
    ("clear", "browser.clear", &["element", "worktree", "page"]),
    ("select-all", "browser.select-all", &["element", "worktree", "page"]),
    ("hover", "browser.hover", &["element", "worktree", "page"]),
    ("scrollintoview", "browser.scrollintoview", &["element", "worktree", "page"]),
    ("fill", "browser.fill", &["element", "value", "worktree", "page"]),
    ("type", "browser.type", &["input", "worktree", "page"]),
    ("inserttext", "browser.inserttext", &["text", "worktree", "page"]),
    ("select", "browser.select", &["element", "value", "worktree", "page"]),
    ("keypress", "browser.keypress", &["key", "worktree", "page"]),
    ("drag", "browser.drag", &["from", "to", "worktree", "page"]),
    ("upload", "browser.upload", &["element", "files", "worktree", "page"]),
    ("download", "browser.download", &["selector", "path", "worktree", "page"]),
    ("highlight", "browser.highlight", &["selector", "worktree", "page"]),
    ("find", "browser.find", &["locator", "value", "action", "text", "worktree", "page"]),
    ("get", "browser.get", &["what", "element", "worktree", "page"]),
    ("is", "browser.is", &["what", "element", "worktree", "page"]),
    ("mouse move", "browser.mouse-move", &["x", "y", "worktree", "page"]),
    ("mouse down", "browser.mouse-down", &["button", "worktree", "page"]),
    ("mouse up", "browser.mouse-up", &["button", "worktree", "page"]),
    ("mouse wheel", "browser.mouse-wheel", &["dy", "dx", "worktree", "page"]),
    ("exec", "browser.exec", &["command", "worktree", "page"]),
];

/// The commands that need the engine's picture or printer. Tauri's public API has no page capture
/// or print on Windows (that is WebView2's CapturePreview / PrintToPdf, reached only through the
/// webview2-com crate, not a dependency of this build), so they are refused with a clear message.
const UNSUPPORTED: &[(&str, &str)] = &[
    ("browser.screenshot", "screenshot needs the engine's page capture, which this build does not reach; use snapshot for the page's content"),
    ("browser.full-screenshot", "full-screenshot needs the engine's page capture, which this build does not reach; use snapshot for the page's content"),
    ("browser.pdf", "pdf needs the engine's printer, which this build does not reach"),
    ("browser.download", "download needs the engine's download handler, which this build does not reach; the page's own link can still be clicked"),
];

/// Reference-based element commands (BROW-047).
const ELEMENT: &[&str] = &["browser.click", "browser.dblclick", "browser.check", "browser.uncheck", "browser.focus", "browser.clear", "browser.select-all", "browser.hover", "browser.scrollintoview"];
const WAIT_CONDITIONS: &[&str] = &["selector", "text", "url", "load", "fn", "state"];
const LOAD_STATES: &[&str] = &["load", "domcontentloaded", "networkidle"];
const GET_WHAT: &[&str] = &["text", "html", "value", "url", "title", "count", "box"];
const IS_WHAT: &[&str] = &["visible", "enabled", "checked"];
const BUTTONS: &[&str] = &["left", "right", "middle"];
const FIND_ACTIONS: &[&str] = &["click", "dblclick", "check", "uncheck", "focus", "clear", "select-all", "hover", "scrollintoview", "fill", "type", "select", "highlight"];
const LOCATORS: &[&str] = &["role", "text", "label", "selector", "placeholder"];
/// A wait with no `--timeout`, and the longest one accepted.
pub const WAIT_DEFAULT_MS: u64 = 5_000;
pub const WAIT_MAX_MS: u64 = 300_000;
/// How often a wait asks the page again.
const WAIT_STEP: Duration = Duration::from_millis(100);
/// Inserted text goes to the page in pieces this long, in order (BROW-047).
pub const TYPE_PIECE: usize = 500;
/// Upload: the most file bytes carried into the page in one command.
const UPLOAD_MAX: u64 = 8 * 1024 * 1024;

fn args(message: impl Into<String>) -> Fail {
    Fail::new("invalid_arguments", message)
}

pub fn is_browser(command: &str) -> bool {
    COMMANDS.iter().any(|c| c.1 == command)
}

/// What a browser command needs, checked before the app is asked (the parse step's arm).
pub fn check(command: &str, flags: &Map<String, Value>) -> Result<Map<String, Value>, Fail> {
    let text = |k: &str| flags.get(k).and_then(Value::as_str).map(str::trim);
    if let Some(k) = flags.keys().find(|k| !["text", "input", "value", "expression", "command", "fn"].contains(&k.as_str()) && text(k).is_some_and(str::is_empty)) {
        return Err(args(format!("--{k} cannot be empty")));
    }
    let need = |k: &str| text(k).filter(|v| !v.is_empty()).ok_or_else(|| args(format!("--{k} is required")));
    let one_of = |k: &str, set: &[&str]| match text(k) {
        Some(v) if set.contains(&v) => Ok(()),
        Some(v) => Err(args(format!("--{k} {v} is not one of {}", set.join("|")))),
        None => Ok(()),
    };
    let number = |k: &str| match text(k) {
        Some(v) if v.parse::<f64>().is_ok() => Ok(()),
        Some(v) => Err(args(format!("--{k} takes a number, not {v}"))),
        None => Ok(()),
    };
    if let Some(p) = text("page") {
        if p.parse::<u32>().is_err() {
            return Err(args(format!("--page takes a tab number, not {p}")));
        }
    }
    match command {
        "browser.goto" => {
            need("url")?;
        }
        "browser.wait" => {
            if !WAIT_CONDITIONS.iter().any(|k| flags.contains_key(*k)) {
                return Err(args("wait needs a condition: --selector, --text, --url, --load, --fn or --state (with --selector)"));
            }
            if flags.contains_key("state") && !flags.contains_key("selector") {
                return Err(args("--state hidden|visible says what to wait for about --selector; give both"));
            }
            one_of("state", &["hidden", "visible"])?;
            one_of("load", LOAD_STATES)?;
            if let Some(t) = text("timeout") {
                match t.parse::<u64>() {
                    Ok(ms) if ms > 0 && ms <= WAIT_MAX_MS => {}
                    _ => return Err(args(format!("--timeout takes milliseconds from 1 to {WAIT_MAX_MS}"))),
                }
            }
        }
        "browser.eval" => {
            need("expression")?;
        }
        "browser.scroll" => {
            need("direction")?;
            one_of("direction", &["up", "down"])?;
            number("amount")?;
        }
        c if ELEMENT.contains(&c) => {
            need("element")?;
        }
        "browser.fill" | "browser.select" => {
            need("element")?;
            if text("value").is_none() {
                return Err(args("--value is required"));
            }
        }
        "browser.type" => {
            if text("input").is_none() {
                return Err(args("--input is required"));
            }
        }
        "browser.inserttext" => {
            if text("text").is_none() {
                return Err(args("--text is required"));
            }
        }
        "browser.keypress" => {
            need("key")?;
        }
        "browser.drag" => {
            need("from")?;
            need("to")?;
        }
        "browser.upload" => {
            need("element")?;
            need("files")?;
        }
        "browser.download" => {
            need("selector")?;
            need("path")?;
        }
        "browser.highlight" => {
            need("selector")?;
        }
        "browser.find" => {
            need("locator")?;
            need("value")?;
            need("action")?;
            one_of("locator", LOCATORS)?;
            one_of("action", FIND_ACTIONS)?;
        }
        "browser.get" => {
            need("what")?;
            one_of("what", GET_WHAT)?;
            if !["url", "title"].contains(&text("what").unwrap_or_default()) {
                need("element")?;
            }
        }
        "browser.is" => {
            need("what")?;
            one_of("what", IS_WHAT)?;
            need("element")?;
        }
        "browser.mouse-move" => {
            need("x")?;
            need("y")?;
            number("x")?;
            number("y")?;
        }
        "browser.mouse-down" | "browser.mouse-up" => one_of("button", BUTTONS)?,
        "browser.mouse-wheel" => {
            need("dy")?;
            number("dy")?;
            number("dx")?;
        }
        "browser.exec" => {
            need("command")?;
        }
        _ => {}
    }
    Ok(flags.clone())
}

/// `*` matches any run of characters; everything else is literal (the `--url` pattern of wait).
pub fn wildcard(pattern: &str, text: &str) -> bool {
    fn go(p: &[char], t: &[char]) -> bool {
        match p.split_first() {
            None => t.is_empty(),
            Some(('*', rest)) => (0..=t.len()).any(|i| go(rest, &t[i..])),
            Some((c, rest)) => t.first() == Some(c) && go(rest, &t[1..]),
        }
    }
    if !pattern.contains('*') {
        return text.contains(pattern);
    }
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    go(&p, &t)
}

/// Splits a helper command line into words: spaces separate, single or double quotes group, a
/// backslash keeps the next character.
pub fn split_command(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut word = String::new();
    let mut quote: Option<char> = None;
    let mut open = false;
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => word.push(c),
            (None, '\'' | '"') => {
                quote = Some(c);
                open = true;
            }
            (None, '\\') => {
                if let Some(n) = chars.next() {
                    word.push(n);
                }
            }
            (None, c) if c.is_whitespace() => {
                if open || !word.is_empty() {
                    out.push(std::mem::take(&mut word));
                }
                open = false;
            }
            (None, c) => word.push(c),
        }
    }
    if open || !word.is_empty() {
        out.push(word);
    }
    out
}

/// Text in pieces of at most `n` characters, never splitting a character.
pub fn pieces(text: &str, n: usize) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    chars.chunks(n.max(1)).map(|c| c.iter().collect()).collect()
}

/// The command word after `browser.` (the driver's `cmd`).
fn short(command: &str) -> &str {
    command.strip_prefix("browser.").unwrap_or(command)
}

/// Why a page answer is a failure, by its code: a reference the page no longer knows asks for a
/// new snapshot; a timeout counts towards restarting the helper.
pub fn fail_of(answer: &Value) -> Option<Fail> {
    let e = answer["error"].as_str()?;
    let code = if e.contains("run snapshot again") { "stale_reference" } else { "failed" };
    Some(Fail { code, message: e.to_string(), data: json!({ "hint": if code == "stale_reference" { "the page changed since the snapshot; run snapshot and use its new references" } else { "" } }) })
}

/// Runs one page command and hands back its answer object.
fn page(id: u32, cmd: &str, a: Value, wait: Duration) -> Result<Value, Fail> {
    let script = DRIVER.replace("__REQ__", &json!({ "cmd": cmd, "args": a }).to_string());
    let answer = eval_json(id, &script, wait).map_err(|e| Fail { code: if e.contains("did not answer") { "timeout" } else { "failed" }, message: e, data: Value::Null })?;
    match fail_of(&answer) {
        Some(f) => Err(f),
        None => Ok(answer),
    }
}

/// How long a wait runs, from `--timeout` (milliseconds) or the default.
pub fn wait_limit(a: &Value) -> Duration {
    Duration::from_millis(a["timeout"].as_str().and_then(|t| t.parse::<u64>().ok()).unwrap_or(WAIT_DEFAULT_MS).min(WAIT_MAX_MS))
}

/// BROW-046: a wait asks the page again every tenth of a second until the condition holds or the
/// time is up; an address pattern is checked here against the page's own location.
fn wait(id: u32, a: &Value) -> Result<Value, Fail> {
    let limit = wait_limit(a);
    let until = Instant::now() + limit;
    let pattern = a["url"].as_str();
    let mut asked = 0u32;
    loop {
        let left = until.saturating_duration_since(Instant::now());
        let answer = page(id, "check-wait", a.clone(), left.min(EVAL_WAIT).max(Duration::from_millis(50)))?;
        asked += 1;
        let holds = answer["value"].as_bool().unwrap_or(false) && pattern.is_none_or(|p| answer["url"].as_str().is_some_and(|u| wildcard(p, u)));
        if holds {
            return Ok(json!({ "page": id, "satisfied": true, "asked": asked, "url": answer["url"] }));
        }
        if Instant::now() >= until {
            return Err(Fail { code: "timeout", message: format!("the condition did not hold within {} ms", limit.as_millis()), data: json!({ "page": id, "asked": asked, "url": answer["url"] }) });
        }
        std::thread::sleep(WAIT_STEP);
    }
}

/// `kolux exec --command "<helper command>"`: the helper is Kolux itself, so the command is one
/// of the browser commands above, in the same words (`click --element e12`); never another exec.
pub fn exec_words(line: &str) -> Result<crate::cli::Parsed, Fail> {
    let words = split_command(line);
    let (_, parsed) = crate::cli::parse(&words);
    let Some(p) = parsed? else {
        return Err(args("exec needs a browser command, such as \"click --element e12\""));
    };
    if !is_browser(&p.command) {
        return Err(args(format!("exec runs browser commands only; {} is not one", words.first().map(String::as_str).unwrap_or_default())));
    }
    if p.command == "browser.exec" {
        return Err(args("exec does not run another exec"));
    }
    Ok(p)
}

fn exec(req: &Request, worktree: Option<&str>, line: &str) -> Result<Value, Fail> {
    let p = exec_words(line)?;
    let inner = Request { command: p.command, args: Value::Object(p.args), ..req.clone() };
    run(&inner, worktree)
}

/// What stands between a request and the page: a command this build cannot do, then the tab it
/// goes to (BROW-042). Pure, so it is tested without the app.
pub fn gate(command: &str, page_no: Option<u32>, worktree: Option<&str>, tabs: &[super::Tab]) -> Result<u32, Fail> {
    if let Some((_, why)) = UNSUPPORTED.iter().find(|(c, _)| *c == command) {
        return Err(Fail { code: "unsupported", message: (*why).to_string(), data: Value::Null });
    }
    pick_tab(tabs, page_no, worktree).map_err(|m| Fail { code: "not_found", message: m, data: json!({ "hint": "open a browser tab in the worktree (Ctrl+T, Browser) or name one with --page <n>" }) })
}

/// Upload: the files are read here and carried into the page as bytes (a page cannot open a path).
fn files_of(list: &str) -> Result<Vec<Value>, Fail> {
    let mut out = Vec::new();
    let mut total = 0u64;
    for p in list.split(',').map(str::trim).filter(|p| !p.is_empty()) {
        let path = std::path::Path::new(p);
        let bytes = std::fs::read(path).map_err(|e| Fail::new("failed", format!("{p}: {e}")))?;
        total += bytes.len() as u64;
        if total > UPLOAD_MAX {
            return Err(Fail::new("failed", format!("the files exceed {} MB together", UPLOAD_MAX / (1024 * 1024))));
        }
        use base64::Engine as _;
        out.push(json!({ "name": path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| p.to_string()), "type": "", "data": base64::engine::general_purpose::STANDARD.encode(bytes) }));
    }
    if out.is_empty() {
        return Err(args("--files names no file"));
    }
    Ok(out)
}

/// The app side of every browser command (the dispatch arm). `worktree` is the folder the command
/// is for: `--worktree` resolved, or the caller's own worktree, or none.
pub fn run(req: &Request, worktree: Option<&str>) -> Result<Value, Fail> {
    let a = &req.args;
    let text = |k: &str| a[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let page_no = text("page").and_then(|p| p.parse::<u32>().ok());
    let id = gate(&req.command, page_no, worktree, &tabs())?;
    let cmd = short(&req.command);
    match req.command.as_str() {
        "browser.goto" => {
            let url = text("url").ok_or_else(|| args("--url is required"))?;
            let to = super::navigate_to(id, &url)?;
            Ok(json!({ "page": id, "url": to, "summary": format!("page {id} is going to {to}") }))
        }
        "browser.back" | "browser.forward" | "browser.reload" => {
            super::go(id, cmd)?;
            Ok(json!({ "page": id, "summary": format!("page {id}: {cmd}") }))
        }
        "browser.wait" => wait(id, a),
        "browser.exec" => exec(req, worktree, &text("command").unwrap_or_default()),
        "browser.type" | "browser.inserttext" => {
            let key = if cmd == "type" { "input" } else { "text" };
            let whole = a[key].as_str().unwrap_or_default().to_string();
            let mut sent = 0usize;
            for piece in pieces(&whole, TYPE_PIECE) {
                page(id, cmd, json!({ key: piece }), EVAL_WAIT)?;
                sent += piece.chars().count();
            }
            Ok(json!({ "page": id, "characters": sent, "summary": format!("{cmd}: {sent} character(s) went to the focused field") }))
        }
        "browser.upload" => {
            let files = files_of(&text("files").unwrap_or_default())?;
            let mut answer = page(id, cmd, json!({ "element": a["element"], "files": files }), EVAL_WAIT)?;
            answer["page"] = json!(id);
            Ok(answer)
        }
        _ => {
            let mut answer = page(id, cmd, a.clone(), EVAL_WAIT)?;
            answer["page"] = json!(id);
            Ok(answer)
        }
    }
}

/// The readable form of a browser answer.
pub fn text(command: &str, r: &Value) -> Option<String> {
    if !is_browser(command) {
        return None;
    }
    Some(match command {
        "browser.snapshot" => format!("{} ({})\n{}", r["title"].as_str().unwrap_or_default(), r["url"].as_str().unwrap_or_default(), r["tree"].as_str().unwrap_or_default()),
        "browser.get" | "browser.eval" => match &r["value"] {
            Value::String(s) => s.clone(),
            Value::Null => "null".into(),
            v => v.to_string(),
        },
        "browser.is" => r["value"].as_bool().unwrap_or(false).to_string(),
        "browser.wait" => format!("the condition holds (asked {} time(s)) at {}", r["asked"], r["url"].as_str().unwrap_or_default()),
        _ => r["summary"].as_str().map(str::to_string).unwrap_or_else(|| "ok".into()),
    })
}

/// The page-side helper. It installs itself once per page as `window.__kx` (references, mouse
/// position) and answers one request per run as a JSON object: `{ok, ...}` or `{error}`.
/// `__REQ__` is replaced with the request before the script runs.
const DRIVER: &str = r#"(function(){
if(!window.__kx){
 const K={refs:{},n:0,mouse:{x:0,y:0}};
 const vis=e=>{ if(!(e instanceof Element)) return false; const r=e.getBoundingClientRect(); const s=getComputedStyle(e); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; };
 const role=e=>{ const r=e.getAttribute('role'); if(r) return r; const t=e.tagName.toLowerCase();
  if(t==='a'&&e.hasAttribute('href')) return 'link'; if(t==='button'||t==='summary') return 'button';
  if(t==='input'){ const ty=(e.type||'text').toLowerCase(); return ty==='checkbox'?'checkbox':ty==='radio'?'radio':(ty==='submit'||ty==='button'||ty==='reset')?'button':ty==='range'?'slider':ty==='file'?'textbox':'textbox'; }
  if(t==='textarea'||e.isContentEditable) return 'textbox'; if(t==='select') return 'combobox'; if(/^h[1-6]$/.test(t)) return 'heading';
  if(t==='img') return 'img'; if(t==='li') return 'listitem'; if(t==='option') return 'option'; if(t==='nav') return 'navigation'; if(t==='main') return 'main';
  if(t==='form') return 'form'; if(t==='table') return 'table'; if(t==='label') return 'label'; if(t==='p') return 'paragraph';
  if(e.hasAttribute('onclick')||(e.tabIndex>=0&&t!=='body')) return 'generic'; return null; };
 const name=e=>{ const l=e.getAttribute('aria-label'); if(l) return l; const lb=e.labels&&e.labels[0]; if(lb) return (lb.textContent||'').trim();
  if(e.tagName==='IMG') return e.alt||''; if(e.tagName==='INPUT'&&e.placeholder) return e.placeholder; return (e.innerText||e.textContent||'').trim().replace(/\s+/g,' ').slice(0,80); };
 K.snapshot=function(){ K.refs={}; K.n=0; const out=[];
  const walk=(e,d)=>{ if(!(e instanceof Element)) return; const t=e.tagName.toLowerCase(); if(t==='script'||t==='style'||t==='noscript'||t==='template') return; if(!vis(e)) return;
   const r=role(e); let dd=d; if(r&&K.n<500){ K.n++; const id='e'+K.n; K.refs[id]=e; let line=' '.repeat(d*2)+'- '+r; const nm=name(e); if(nm) line+=' "'+nm.replace(/"/g,'\\"')+'"';
    if(r==='heading') line+=' [level='+(e.getAttribute('aria-level')||t.slice(1))+']'; if(r==='checkbox'||r==='radio') line+=' [checked='+!!e.checked+']'; if(e.disabled) line+=' [disabled]';
    if(r==='link') line+=' [href='+e.href+']'; line+=' [ref='+id+']'; out.push(line); dd=d+1; }
   for(const c of e.children) walk(c,dd); };
  walk(document.body,0); return {ok:true,url:location.href,title:document.title,count:K.n,tree:out.join('\n')}; };
 const el=ref=>{ const e=K.refs[ref]; if(!e||!e.isConnected) throw new Error(ref+' is not known to this page; run snapshot again'); return e; };
 const ev=(e,type,init)=>{ const C=(type==='click'||type==='dblclick'||type.startsWith('mouse'))?MouseEvent:type.startsWith('key')?KeyboardEvent:(type.startsWith('drag')||type==='drop')?DragEvent:Event; return e.dispatchEvent(new C(type,Object.assign({bubbles:true,cancelable:true,composed:true},init||{}))); };
 const setValue=(e,v)=>{ e.focus(); if(e.isContentEditable){ e.textContent=v; } else { const p=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value'); if(p&&p.set) p.set.call(e,v); else e.value=v; } ev(e,'input'); ev(e,'change'); };
 const target=()=>{ let a=document.activeElement; while(a&&a.shadowRoot&&a.shadowRoot.activeElement) a=a.shadowRoot.activeElement; if(a&&a.tagName==='IFRAME'){ try{ const d=a.contentDocument; if(d&&d.activeElement) a=d.activeElement; }catch(_){} } return a||document.body; };
 const insert=txt=>{ const t=target(); if(t.isContentEditable){ t.focus(); document.execCommand('insertText',false,txt); return; } if('value' in t&&t.tagName!=='BUTTON'){ const s=t.selectionStart==null?t.value.length:t.selectionStart, en=t.selectionEnd==null?t.value.length:t.selectionEnd; setValue(t,t.value.slice(0,s)+txt+t.value.slice(en)); try{ t.setSelectionRange(s+txt.length,s+txt.length); }catch(_){} return; } throw new Error('nothing that takes text has the focus; focus or click a field first'); };
 const locate=(type,value)=>{ const v=String(value).toLowerCase(); if(type==='selector') return document.querySelector(value); const all=[...document.querySelectorAll('*')].filter(vis);
  if(type==='role') return all.find(e=>role(e)===v)||null; if(type==='placeholder') return all.find(e=>(e.placeholder||'').toLowerCase().includes(v))||null;
  if(type==='label') return all.find(e=>name(e).toLowerCase()===v)||all.find(e=>name(e).toLowerCase().includes(v))||null;
  const has=e=>(e.innerText||'').trim().toLowerCase().includes(v); return all.find(e=>has(e)&&![...e.children].some(has))||null; };
 const at=(x,y)=>document.elementFromPoint(x,y)||document.body;
 const sum=e=>e.tagName.toLowerCase()+(e.id?'#'+e.id:'');
 const act=(action,e,arg)=>{ switch(action){
  case 'click': e.scrollIntoView({block:'center'}); ev(e,'mouseover'); ev(e,'mousedown',{button:0}); if(e.focus) e.focus(); ev(e,'mouseup',{button:0}); e.click(); return 'clicked '+sum(e);
  case 'dblclick': e.click(); e.click(); ev(e,'dblclick'); return 'double-clicked '+sum(e);
  case 'check': if(!e.checked) e.click(); return 'checked '+sum(e);
  case 'uncheck': if(e.checked) e.click(); return 'unchecked '+sum(e);
  case 'focus': e.focus(); return 'focused '+sum(e);
  case 'clear': setValue(e,''); return 'cleared '+sum(e);
  case 'select-all': e.focus(); if(e.select) e.select(); else { const s=getSelection(); const r=document.createRange(); r.selectNodeContents(e); s.removeAllRanges(); s.addRange(r); } return 'selected all in '+sum(e);
  case 'hover': e.scrollIntoView({block:'center'}); ev(e,'mouseover'); ev(e,'mouseenter',{bubbles:false}); ev(e,'mousemove'); return 'hovering '+sum(e);
  case 'scrollintoview': e.scrollIntoView({block:'center'}); return 'scrolled to '+sum(e);
  case 'fill': setValue(e,arg==null?'':String(arg)); return 'filled '+sum(e);
  case 'type': e.focus(); insert(arg==null?'':String(arg)); return 'typed into '+sum(e);
  case 'select': { const opts=[...(e.options||[])]; const o=opts.find(o=>o.value===arg)||opts.find(o=>o.text.trim()===arg); if(!o) throw new Error('no option '+arg+' in '+sum(e)); e.value=o.value; ev(e,'input'); ev(e,'change'); return 'selected '+o.value+' in '+sum(e); }
  case 'highlight': e.style.outline='3px solid #ff5a00'; e.style.outlineOffset='2px'; return 'highlighted '+sum(e);
  default: throw new Error('unknown action '+action); } };
 K.run=function(q){ try{ const a=q.args||{}; switch(q.cmd){
  case 'snapshot': return K.snapshot();
  case 'eval': { const v=(0,eval)(a.expression); return {ok:true,value:v===undefined?null:v}; }
  case 'scroll': { const n=Number(a.amount||500); window.scrollBy(0,a.direction==='up'?-n:n); return {ok:true,summary:'scrolled '+a.direction+' '+n+' px',scrollY:window.scrollY}; }
  case 'click': case 'dblclick': case 'check': case 'uncheck': case 'focus': case 'clear': case 'select-all': case 'hover': case 'scrollintoview': return {ok:true,summary:act(q.cmd,el(a.element))};
  case 'fill': return {ok:true,summary:act('fill',el(a.element),a.value)};
  case 'type': insert(a.input==null?'':String(a.input)); return {ok:true};
  case 'inserttext': insert(a.text==null?'':String(a.text)); return {ok:true};
  case 'select': return {ok:true,summary:act('select',el(a.element),a.value)};
  case 'keypress': { const t=target(); const k=String(a.key); const init={key:k,code:k.length===1?'Key'+k.toUpperCase():k}; ev(t,'keydown',init); ev(t,'keypress',init); if(k==='Enter'&&t.form&&t.tagName==='INPUT'){ if(t.form.requestSubmit) t.form.requestSubmit(); else t.form.submit(); } ev(t,'keyup',init); return {ok:true,summary:'pressed '+k}; }
  case 'drag': { const f=el(a.from), t=el(a.to); const dt=new DataTransfer(); ev(f,'dragstart',{dataTransfer:dt}); ev(t,'dragenter',{dataTransfer:dt}); ev(t,'dragover',{dataTransfer:dt}); ev(t,'drop',{dataTransfer:dt}); ev(f,'dragend',{dataTransfer:dt}); return {ok:true,summary:'dragged '+sum(f)+' to '+sum(t)}; }
  case 'upload': { const e=el(a.element); if(!(e instanceof HTMLInputElement)||e.type!=='file') throw new Error(a.element+' is not a file input'); const dt=new DataTransfer(); for(const f of a.files){ const bin=atob(f.data); const buf=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i); dt.items.add(new File([buf],f.name,{type:f.type||''})); } e.files=dt.files; ev(e,'input'); ev(e,'change'); return {ok:true,summary:'attached '+a.files.length+' file(s) to '+sum(e)}; }
  case 'highlight': { const e=K.refs[a.selector]||document.querySelector(a.selector); if(!e) throw new Error('nothing matches '+a.selector); return {ok:true,summary:act('highlight',e)}; }
  case 'find': { const e=locate(a.locator,a.value); if(!e) throw new Error('no '+a.locator+' matches '+JSON.stringify(a.value)); return {ok:true,summary:act(a.action,e,a.text)}; }
  case 'get': { const w=a.what; if(w==='url') return {ok:true,value:location.href}; if(w==='title') return {ok:true,value:document.title}; if(w==='count') return {ok:true,value:K.refs[a.element]?1:document.querySelectorAll(a.element).length};
   const e=el(a.element); if(w==='text') return {ok:true,value:(e.innerText!=null?e.innerText:e.textContent)||''}; if(w==='html') return {ok:true,value:e.outerHTML}; if(w==='value') return {ok:true,value:e.value===undefined?null:e.value};
   if(w==='box'){ const r=e.getBoundingClientRect(); return {ok:true,value:{x:r.x,y:r.y,width:r.width,height:r.height}}; } throw new Error('unknown property '+w); }
  case 'is': { const e=el(a.element); const w=a.what; if(w==='visible') return {ok:true,value:vis(e)}; if(w==='enabled') return {ok:true,value:!e.disabled}; if(w==='checked') return {ok:true,value:!!e.checked}; throw new Error('unknown state '+w); }
  case 'mouse-move': { K.mouse={x:Number(a.x),y:Number(a.y)}; ev(at(K.mouse.x,K.mouse.y),'mousemove',{clientX:K.mouse.x,clientY:K.mouse.y}); return {ok:true,summary:'mouse at '+K.mouse.x+','+K.mouse.y}; }
  case 'mouse-down': case 'mouse-up': { const b={left:0,middle:1,right:2}[a.button||'left']; ev(at(K.mouse.x,K.mouse.y),q.cmd==='mouse-down'?'mousedown':'mouseup',{button:b,clientX:K.mouse.x,clientY:K.mouse.y}); return {ok:true,summary:q.cmd.replace('-',' ')+' ('+(a.button||'left')+')'}; }
  case 'mouse-wheel': { const dx=Number(a.dx||0), dy=Number(a.dy||0); const e=at(K.mouse.x,K.mouse.y); e.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:dx,deltaY:dy,clientX:K.mouse.x,clientY:K.mouse.y})); window.scrollBy(dx,dy); return {ok:true,summary:'wheel '+dx+','+dy}; }
  case 'check-wait': { let ok=true; if(a.selector){ const e=document.querySelector(a.selector); ok=ok&&(a.state==='hidden'?!(e&&vis(e)):!!e&&(a.state!=='visible'||vis(e))); }
   if(a.text) ok=ok&&((document.body&&document.body.innerText)||'').includes(a.text); if(a.load) ok=ok&&(a.load==='domcontentloaded'?document.readyState!=='loading':document.readyState==='complete'); if(a.fn) ok=ok&&!!(0,eval)(a.fn); return {ok:true,value:ok,url:location.href}; }
  default: throw new Error('unknown command '+q.cmd);
 } } catch(e){ return {error:String((e&&e.message)||e)}; } };
 window.__kx=K;
}
return window.__kx.run(__REQ__);
})()"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn flags(pairs: &[(&str, &str)]) -> Map<String, Value> {
        pairs.iter().map(|(k, v)| (k.to_string(), json!(v))).collect()
    }

    #[test]
    fn every_browser_command_takes_worktree_page_and_a_unique_wire_name() {
        let mut wires = std::collections::HashSet::new();
        for (path, wire, flags) in COMMANDS {
            assert!(flags.contains(&"worktree") && flags.contains(&"page"), "{path}");
            assert!(wire.starts_with("browser."), "{wire}");
            assert!(wires.insert(*wire), "duplicate wire {wire}");
        }
        assert!(is_browser("browser.click") && !is_browser("terminal.list"));
    }

    #[test]
    fn check_wants_the_flags_each_command_lives_on() {
        assert_eq!(check("browser.goto", &flags(&[])).unwrap_err().message, "--url is required");
        assert!(check("browser.goto", &flags(&[("url", "https://example.com")])).is_ok());
        assert!(check("browser.wait", &flags(&[("timeout", "2000")])).unwrap_err().message.starts_with("wait needs a condition"));
        assert!(check("browser.wait", &flags(&[("text", "Done"), ("timeout", "2000")])).is_ok());
        assert!(check("browser.wait", &flags(&[("text", "Done"), ("timeout", "0")])).unwrap_err().message.contains("--timeout takes milliseconds"));
        assert!(check("browser.wait", &flags(&[("state", "visible")])).unwrap_err().message.contains("--selector"));
        assert!(check("browser.wait", &flags(&[("load", "ready")])).unwrap_err().message.contains("load|domcontentloaded|networkidle"));
        assert_eq!(check("browser.click", &flags(&[])).unwrap_err().message, "--element is required");
        assert_eq!(check("browser.fill", &flags(&[("element", "e5")])).unwrap_err().message, "--value is required");
        // A blank value is a value for fill, type and inserttext (clearing a field by filling "").
        assert!(check("browser.fill", &flags(&[("element", "e5"), ("value", "")])).is_ok());
        assert!(check("browser.type", &flags(&[("input", "")])).is_ok());
        assert_eq!(check("browser.get", &flags(&[("what", "value")])).unwrap_err().message, "--element is required");
        assert!(check("browser.get", &flags(&[("what", "url")])).is_ok());
        assert!(check("browser.get", &flags(&[("what", "colour"), ("element", "e1")])).unwrap_err().message.contains("text|html|value|url|title|count|box"));
        assert!(check("browser.is", &flags(&[("what", "visible"), ("element", "e5")])).is_ok());
        assert!(check("browser.mouse-move", &flags(&[("x", "ten"), ("y", "2")])).unwrap_err().message.contains("--x takes a number"));
        assert!(check("browser.mouse-down", &flags(&[("button", "back")])).unwrap_err().message.contains("left|right|middle"));
        assert!(check("browser.find", &flags(&[("locator", "role"), ("value", "button"), ("action", "poke")])).unwrap_err().message.contains("is not one of"));
        assert_eq!(check("browser.scroll", &flags(&[("direction", "left")])).unwrap_err().message, "--direction left is not one of up|down");
        assert_eq!(check("browser.snapshot", &flags(&[("page", "two")])).unwrap_err().message, "--page takes a tab number, not two");
        assert_eq!(check("browser.snapshot", &flags(&[("worktree", " ")])).unwrap_err().message, "--worktree cannot be empty");
        assert_eq!(check("browser.exec", &flags(&[])).unwrap_err().message, "--command is required");
        assert_eq!(check("browser.exec", &flags(&[])).unwrap_err().code, "invalid_arguments");
    }

    #[test]
    fn wildcard_matches_addresses_the_way_wait_url_means() {
        assert!(wildcard("*/done", "https://a.test/x/done"));
        assert!(wildcard("https://a.test/*", "https://a.test/x/done"));
        assert!(!wildcard("https://b.test/*", "https://a.test/x/done"));
        assert!(wildcard("done", "https://a.test/x/done")); // no star: a plain substring
        assert!(wildcard("*", ""));
        assert!(!wildcard("a*c", "ab"));
    }

    #[test]
    fn exec_lines_split_like_a_shell_and_text_goes_in_pieces() {
        assert_eq!(split_command(r#"fill --element e5 --value "hello world""#), vec!["fill", "--element", "e5", "--value", "hello world"]);
        assert_eq!(split_command("type --input ''"), vec!["type", "--input", ""]);
        assert_eq!(split_command(r"click --element e1\ 2"), vec!["click", "--element", "e1 2"]);
        assert_eq!(split_command("  "), Vec::<String>::new());
        let text: String = "ab".repeat(600) + "😀";
        let p = pieces(&text, TYPE_PIECE);
        assert_eq!(p.len(), 3);
        assert_eq!(p[0].chars().count(), 500);
        assert_eq!(p[2], "ab".repeat(100) + "😀");
        assert_eq!(pieces("", 500), Vec::<String>::new());
    }

    #[test]
    fn a_page_error_becomes_a_fail_and_a_stale_reference_asks_for_a_new_snapshot() {
        let f = fail_of(&json!({ "error": "e12 is not known to this page; run snapshot again" })).unwrap();
        assert_eq!(f.code, "stale_reference");
        assert_eq!(fail_of(&json!({ "error": "no option x" })).unwrap().code, "failed");
        assert!(fail_of(&json!({ "ok": true })).is_none());
        assert_eq!(wait_limit(&json!({})), Duration::from_millis(WAIT_DEFAULT_MS));
        assert_eq!(wait_limit(&json!({ "timeout": "2000" })), Duration::from_millis(2000));
        assert_eq!(wait_limit(&json!({ "timeout": "9999999" })), Duration::from_millis(WAIT_MAX_MS));
    }

    // The functions that reach the page (run, eval_json, navigate_to, go) are not called from tests:
    // linking them pulls the window toolkit into the test binary, which then needs the app's
    // manifest to load (comctl32 v6). What stands before them, `gate`, is tested here instead.
    #[test]
    fn with_no_browser_tab_every_command_fails_clearly_and_nothing_opens() {
        let f = gate("browser.goto", None, Some("G:/Temp/wt"), &[]).unwrap_err();
        assert_eq!(f.code, "not_found");
        assert_eq!(f.message, "no browser tab is open in G:/Temp/wt");
        assert!(f.data["hint"].as_str().unwrap().contains("--page"));
        assert_eq!(gate("browser.snapshot", Some(7), None, &[]).unwrap_err().message, "browser tab 7 is not open");
        let tabs = [super::super::Tab { id: 3, worktree: Some("G:/Temp/wt".into()), shown: true, seen: 1 }];
        assert_eq!(gate("browser.snapshot", None, Some("G:/Temp/wt"), &tabs).unwrap(), 3);
    }

    #[test]
    fn capture_and_print_commands_say_why_they_are_refused() {
        for c in ["browser.screenshot", "browser.full-screenshot", "browser.pdf", "browser.download"] {
            let f = gate(c, Some(1), None, &[]).unwrap_err();
            assert_eq!(f.code, "unsupported", "{c}");
            assert!(f.message.contains("this build does not reach"), "{c}: {}", f.message);
        }
    }

    #[test]
    fn exec_runs_browser_commands_only_and_never_another_exec() {
        // Without the cli.rs patch the parser does not know the browser words yet, so the refusal
        // is the parser's; with it, exec_words refuses non-browser words and nested execs.
        assert_eq!(exec_words("terminal list").unwrap_err().code, "invalid_arguments");
        assert_eq!(exec_words("").unwrap_err().code, "invalid_arguments");
        assert_eq!(exec_words("exec --command 'click --element e1'").unwrap_err().code, "invalid_arguments");
    }

    #[test]
    fn readable_answers() {
        assert_eq!(text("browser.snapshot", &json!({ "title": "T", "url": "https://a.test/", "tree": "- button \"Go\" [ref=e1]" })).unwrap(), "T (https://a.test/)\n- button \"Go\" [ref=e1]");
        assert_eq!(text("browser.get", &json!({ "value": "hello" })).unwrap(), "hello");
        assert_eq!(text("browser.get", &json!({ "value": { "x": 1 } })).unwrap(), "{\"x\":1}");
        assert_eq!(text("browser.is", &json!({ "value": false })).unwrap(), "false");
        assert_eq!(text("browser.click", &json!({ "summary": "clicked button#go" })).unwrap(), "clicked button#go");
        assert_eq!(text("browser.wait", &json!({ "asked": 3, "url": "https://a.test/" })).unwrap(), "the condition holds (asked 3 time(s)) at https://a.test/");
        assert!(text("terminal.list", &json!({})).is_none());
    }

    #[test]
    fn the_driver_script_carries_the_request_and_every_command_word() {
        let script = DRIVER.replace("__REQ__", &json!({ "cmd": "snapshot", "args": {} }).to_string());
        assert!(script.ends_with("return window.__kx.run({\"cmd\":\"snapshot\",\"args\":{}});\n})()"));
        for (_, wire, _) in COMMANDS {
            let cmd = short(wire);
            if ["goto", "back", "forward", "reload", "wait", "exec", "screenshot", "full-screenshot", "pdf", "download"].contains(&cmd) {
                continue;
            }
            assert!(DRIVER.contains(&format!("case '{cmd}'")), "the driver answers {cmd}");
        }
        assert!(DRIVER.contains("case 'check-wait'"));
    }
}
