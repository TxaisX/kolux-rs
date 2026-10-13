// T-195 / BROW-042: the channel the app drives a tab's page through. The page is a WebView2
// child web view, so the driver is its own DevTools protocol (Runtime, Input, Page, DOM,
// Emulation): no helper program, no second browser, no port. A call runs on the window's
// thread (`with_webview`) and answers over a channel the calling thread waits on with a time
// limit, so a stuck page can never hang the command line. The page can reach none of this:
// the protocol is only ever called from this side, and the only thing a page can send the
// app is a note navigation (`browser_annotate`), which is data.
//
// The in-page driver (`DRIVER`) is installed on demand into the page's main frame and keeps
// the element references a snapshot hands out (`e1`, `e2`, ...) until the next snapshot or
// page change; every command that names a reference goes through it.
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Url};

/// How long one protocol call may take before the command fails.
pub const CALL_WAIT: Duration = Duration::from_secs(30);

/// What the command line needs from the window's tabs. The live one is installed by the app at
/// start (`install`); the command line's own tests never link the window, so they can stand in
/// a fake. ponytail: a trait object, not a generic, so the vtable is the only runtime reference.
pub trait Tabs: Send + Sync {
    /// The app's own dev-server origin, which a tab never opens (T-500).
    fn app_origin(&self) -> Option<Url>;
    fn navigate(&self, id: u32, url: Url) -> Result<(), String>;
    fn reload(&self, id: u32) -> Result<(), String>;
    /// Runs script in the page without waiting for it.
    fn run(&self, id: u32, js: &str) -> Result<(), String>;
    /// Runs one DevTools protocol method against the tab's page and returns its result object.
    fn cdp(&self, id: u32, method: &str, params: Value, wait: Duration) -> Result<Value, String>;
}

static TABS: OnceLock<Box<dyn Tabs>> = OnceLock::new();

/// Hands the command line the window's tabs; called once from the app's setup.
pub fn install(tabs: Box<dyn Tabs>) {
    let _ = TABS.set(tabs);
}

pub fn tabs() -> Result<&'static dyn Tabs, String> {
    TABS.get().map(|t| t.as_ref()).ok_or_else(|| "the Kolux window is not up yet".to_string())
}

/// The window's tabs, as the running app has them.
pub struct Live(pub AppHandle);

impl Live {
    fn view(&self, id: u32) -> Result<tauri::Webview, String> {
        crate::browser::view(&self.0, id)
    }
}

impl Tabs for Live {
    fn app_origin(&self) -> Option<Url> {
        crate::browser::app_origin(&self.0)
    }
    fn navigate(&self, id: u32, url: Url) -> Result<(), String> {
        self.view(id)?.navigate(url).map_err(|e| e.to_string())
    }
    fn reload(&self, id: u32) -> Result<(), String> {
        self.view(id)?.reload().map_err(|e| e.to_string())
    }
    fn run(&self, id: u32, js: &str) -> Result<(), String> {
        self.view(id)?.eval(js).map_err(|e| e.to_string())
    }
    #[cfg(windows)]
    fn cdp(&self, id: u32, method: &str, params: Value, wait: Duration) -> Result<Value, String> {
        use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
        use windows_core::HSTRING;
        let view = self.view(id)?;
        let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
        let name = method.to_string();
        let args = params.to_string();
        view.with_webview(move |pw| {
            let run = || -> Result<(), String> {
                let core = unsafe { pw.controller().CoreWebView2() }.map_err(|e| e.message())?;
                let m = HSTRING::from(name.as_str());
                let p = HSTRING::from(args.as_str());
                let done = tx.clone();
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |hr, out| {
                    let _ = done.send(hr.map(|_| out).map_err(|e| e.message()));
                    Ok(())
                }));
                unsafe { core.CallDevToolsProtocolMethod(&m, &p, &handler) }.map_err(|e| e.message())
            };
            if let Err(e) = run() {
                let _ = tx.send(Err(e));
            }
        })
        .map_err(|e| e.to_string())?;
        let out = rx.recv_timeout(wait).map_err(|_| format!("{method} did not answer within {} seconds", wait.as_secs()))??;
        serde_json::from_str(&out).map_err(|e| format!("{method} answered with something other than JSON: {e}"))
    }
    #[cfg(not(windows))]
    fn cdp(&self, _id: u32, method: &str, _params: Value, _wait: Duration) -> Result<Value, String> {
        Err(format!("{method}: driving a page needs WebView2, which only Windows has"))
    }
}

/// One DevTools protocol call against a tab's page.
pub fn cdp(id: u32, method: &str, params: Value, wait: Duration) -> Result<Value, String> {
    tabs()?.cdp(id, method, params, wait)
}

/// Runs a script expression in the page's main frame and returns its value (a promise is
/// awaited). A thrown error is the command's error.
pub fn eval(id: u32, expression: &str, wait: Duration) -> Result<Value, String> {
    let r = cdp(id, "Runtime.evaluate", json!({ "expression": expression, "returnByValue": true, "awaitPromise": true }), wait)?;
    if let Some(ex) = r.get("exceptionDetails") {
        let what = ex["exception"]["description"].as_str().or(ex["text"].as_str()).unwrap_or("the script failed");
        return Err(what.lines().next().unwrap_or(what).to_string());
    }
    Ok(r["result"]["value"].clone())
}

/// A call into the in-page driver, installing it first when the page does not have it yet.
pub fn driver(id: u32, call: &str, wait: Duration) -> Result<Value, String> {
    eval(id, &format!("(() => {{ if (!window.__kd) {{ {DRIVER} }} return window.__kd.{call}; }})()"), wait)
}

/// A key name as the protocol wants it (`Input.dispatchKeyEvent`): the key, its code, the
/// virtual key code and the text it types, if any. Modifiers come as `Control+Shift+a`.
pub fn key_event(name: &str) -> Result<Value, String> {
    let mut mods = 0;
    let mut key = name;
    while let Some((m, rest)) = key.split_once('+').filter(|(_, r)| !r.is_empty()) {
        mods |= match m.to_ascii_lowercase().as_str() {
            "alt" => 1,
            "control" | "ctrl" => 2,
            "meta" | "cmd" | "command" => 4,
            "shift" => 8,
            other => return Err(format!("unknown modifier {other}")),
        };
        key = rest;
    }
    let (key, code, vk, text): (&str, String, u32, Option<String>) = match key {
        "Enter" | "Return" => ("Enter", "Enter".into(), 13, Some("\r".into())),
        "Tab" => ("Tab", "Tab".into(), 9, None),
        "Escape" | "Esc" => ("Escape", "Escape".into(), 27, None),
        "Backspace" => ("Backspace", "Backspace".into(), 8, None),
        "Delete" => ("Delete", "Delete".into(), 46, None),
        "ArrowLeft" | "Left" => ("ArrowLeft", "ArrowLeft".into(), 37, None),
        "ArrowUp" | "Up" => ("ArrowUp", "ArrowUp".into(), 38, None),
        "ArrowRight" | "Right" => ("ArrowRight", "ArrowRight".into(), 39, None),
        "ArrowDown" | "Down" => ("ArrowDown", "ArrowDown".into(), 40, None),
        "Home" => ("Home", "Home".into(), 36, None),
        "End" => ("End", "End".into(), 35, None),
        "PageUp" => ("PageUp", "PageUp".into(), 33, None),
        "PageDown" => ("PageDown", "PageDown".into(), 34, None),
        "Space" | " " => (" ", "Space".into(), 32, Some(" ".into())),
        k if k.chars().count() == 1 => {
            let c = k.chars().next().unwrap_or(' ');
            let code = if c.is_ascii_alphabetic() { format!("Key{}", c.to_ascii_uppercase()) } else if c.is_ascii_digit() { format!("Digit{c}") } else { String::new() };
            (k, code, c.to_ascii_uppercase() as u32, (mods & 6 == 0).then(|| k.to_string()))
        }
        other => return Err(format!("unknown key {other}; use a name like Enter, Tab, Escape, ArrowDown or a single character, with Control+ Shift+ Alt+ in front")),
    };
    let mut ev = json!({ "key": key, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk, "modifiers": mods });
    if let Some(t) = text {
        ev["text"] = json!(t);
    }
    Ok(ev)
}

/// Runs in the page: element references, the snapshot, and what the reference commands do.
/// It lives on `window.__kd` and is replaced whenever the page is.
pub const DRIVER: &str = r#"
const kd = { refs: {}, n: 0 };
const vis = (el) => { if (!el || !el.isConnected) return false; const s = getComputedStyle(el); if (s.visibility === "hidden" || s.display === "none") return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const text = (s) => (s || "").replace(/\s+/g, " ").trim();
const roleOf = (el) => {
  const r = el.getAttribute("role"); if (r) return r;
  const t = el.tagName.toLowerCase();
  if (t === "a" && el.hasAttribute("href")) return "link";
  if (t === "button" || (t === "input" && /^(button|submit|reset)$/.test(el.type))) return "button";
  if (t === "input") return el.type === "checkbox" ? "checkbox" : el.type === "radio" ? "radio" : el.type === "file" ? "file" : "textbox";
  if (t === "textarea") return "textbox";
  if (t === "select") return "combobox";
  if (/^h[1-6]$/.test(t)) return "heading";
  if (t === "img") return "img";
  if (t === "li") return "listitem";
  if (t === "option") return "option";
  if (t === "summary") return "button";
  if (t === "label") return "label";
  if (t === "p") return "paragraph";
  return null;
};
const nameOf = (el) => {
  const aria = el.getAttribute("aria-label"); if (aria) return text(aria);
  const by = el.getAttribute("aria-labelledby"); if (by) { const l = document.getElementById(by); if (l) return text(l.textContent); }
  if (el.labels && el.labels.length) return text(el.labels[0].textContent);
  if (el.tagName === "IMG") return text(el.alt);
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return text(el.placeholder || el.title || el.name);
  return text(el.textContent).slice(0, 120);
};
kd.snapshot = () => {
  kd.refs = {}; kd.n = 0;
  const out = [];
  const walk = (node, depth) => {
    for (const el of node.children) {
      if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || !vis(el)) continue;
      const role = roleOf(el);
      let d = depth;
      if (role) {
        const ref = "e" + (++kd.n); kd.refs[ref] = el;
        let line = "  ".repeat(depth) + "- " + role + (nameOf(el) ? ' "' + nameOf(el) + '"' : "") + " [ref=" + ref + "]";
        if (role === "heading") line += " level=" + (el.getAttribute("aria-level") || el.tagName[1]);
        if (role === "textbox" || role === "combobox") line += ' value="' + text(el.value).slice(0, 80) + '"';
        if (role === "checkbox" || role === "radio") line += el.checked ? " checked" : "";
        if (role === "link") line += " href=" + el.getAttribute("href");
        out.push(line); d = depth + 1;
      }
      walk(el, d);
    }
  };
  walk(document.body, 0);
  return out.join("\n");
};
kd.el = (ref) => {
  if (/^e\d+$/.test(ref)) { const el = kd.refs[ref]; if (!el || !el.isConnected) throw new Error(ref + " is not an element of the current page; run snapshot first"); return el; }
  const el = document.querySelector(ref); if (!el) throw new Error("no element matches the selector " + ref); return el;
};
kd.box = (ref) => { const el = kd.el(ref); el.scrollIntoView({ block: "center", inline: "center" }); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; };
const setValue = (el, v) => {
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const d = Object.getOwnPropertyDescriptor(proto, "value");
  if (d && d.set) d.set.call(el, v); else el.value = v;
  el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
};
kd.act = (action, ref, value) => {
  const el = kd.el(ref);
  switch (action) {
    case "focus": el.focus(); return true;
    case "fill": el.focus(); setValue(el, value); return true;
    case "clear": el.focus(); setValue(el, ""); return true;
    case "select": { setValue(el, value); if (el.tagName === "SELECT" && el.value !== value) { const o = [...el.options].find((o) => o.text.trim() === value); if (!o) throw new Error("no option " + value); setValue(el, o.value); } return el.value; }
    case "check": case "uncheck": { const want = action === "check"; if (el.checked !== want) el.click(); return el.checked; }
    case "select-all": { el.focus(); if (el.select) el.select(); else { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } return true; }
    case "scrollintoview": el.scrollIntoView({ block: "center", inline: "center" }); return true;
    case "highlight": { el.style.outline = "3px solid #ff5a36"; el.style.outlineOffset = "2px"; setTimeout(() => { el.style.outline = ""; el.style.outlineOffset = ""; }, 3000); return true; }
    default: throw new Error("unknown action " + action);
  }
};
kd.get = (what, ref) => {
  if (what === "count") return ref ? (/^e\d+$/.test(ref) ? 1 : document.querySelectorAll(ref).length) : Object.keys(kd.refs).length;
  const el = ref ? kd.el(ref) : null;
  switch (what) {
    case "text": return el ? text(el.innerText || el.textContent) : text(document.body.innerText);
    case "html": return el ? el.outerHTML : document.documentElement.outerHTML;
    case "value": return el ? el.value : document.activeElement && document.activeElement.value;
    case "url": return location.href;
    case "title": return document.title;
    case "box": { if (!el) throw new Error("--element is required for box"); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }
    default: throw new Error("unknown --what " + what);
  }
};
kd.is = (what, ref) => {
  const el = kd.el(ref);
  if (what === "visible") return vis(el);
  if (what === "enabled") return !el.disabled && el.getAttribute("aria-disabled") !== "true";
  if (what === "checked") return !!el.checked || el.getAttribute("aria-checked") === "true";
  throw new Error("unknown --what " + what);
};
kd.find = (locator, value) => {
  const v = text(value).toLowerCase();
  const all = [...document.querySelectorAll("*")].filter(vis);
  let el = null;
  if (locator === "role") el = all.find((e) => roleOf(e) === v);
  else if (locator === "text") el = all.filter((e) => text(e.innerText || e.textContent).toLowerCase().includes(v)).sort((a, b) => a.textContent.length - b.textContent.length)[0];
  else if (locator === "label" || locator === "placeholder") el = all.find((e) => (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.tagName === "SELECT") && nameOf(e).toLowerCase().includes(v));
  else if (locator === "selector" || locator === "css") el = document.querySelector(value);
  else if (locator === "testid") el = document.querySelector('[data-testid="' + value + '"]');
  else throw new Error("unknown --locator " + locator + "; use role, text, label, placeholder, selector or testid");
  if (!el) throw new Error("no element matches " + locator + " " + value);
  for (const [ref, e] of Object.entries(kd.refs)) if (e === el) return ref;
  const ref = "e" + (++kd.n); kd.refs[ref] = el; return ref;
};
kd.scroll = (direction, amount) => { const d = amount || Math.round(innerHeight * 0.8); scrollBy(0, direction === "up" ? -d : d); return scrollY; };
// HTML5 drag and drop never comes from synthetic mouse events, so the drag events are sent as well.
kd.drag = (from, to) => {
  const a = kd.el(from), b = kd.el(to), dt = new DataTransfer();
  const ev = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  ev(a, "dragstart"); ev(b, "dragenter"); ev(b, "dragover"); ev(b, "drop"); ev(a, "dragend");
  return true;
};
kd.visible = (selector) => { const el = document.querySelector(selector); return !!el && vis(el); };
window.__kd = kd;
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brow047_keys_become_protocol_key_events() {
        let enter = key_event("Enter").unwrap();
        assert_eq!(enter["windowsVirtualKeyCode"], 13);
        assert_eq!(enter["text"], "\r");
        let a = key_event("Control+a").unwrap();
        assert_eq!(a["modifiers"], 2);
        assert_eq!(a["key"], "a");
        assert!(a.get("text").is_none(), "a chord types nothing");
        let plus = key_event("Shift+ArrowDown").unwrap();
        assert_eq!((plus["modifiers"].as_i64(), plus["code"].as_str()), (Some(8), Some("ArrowDown")));
        assert_eq!(key_event("x").unwrap()["code"], "KeyX");
        assert!(key_event("Hyper+a").unwrap_err().contains("unknown modifier"));
        assert!(key_event("Bogus").unwrap_err().contains("unknown key"));
    }

    #[test]
    fn brow046_the_in_page_driver_hands_out_element_references() {
        for needle in ["kd.snapshot", "[ref=\" + ref", "kd.act", "kd.find", "kd.is", "kd.get", "window.__kd = kd"] {
            assert!(DRIVER.contains(needle), "{needle}");
        }
        assert!(driver_call("snapshot()").contains("window.__kd.snapshot()"));
    }

    fn driver_call(call: &str) -> String {
        format!("(() => {{ if (!window.__kd) {{ {DRIVER} }} return window.__kd.{call}; }})()")
    }
}
