// T-195 (BROW-037): annotating a page. While annotation is on, the page outlines what the mouse
// is over; a click opens a small form on the element (what it is, where it likely comes from,
// what it looks like, and room for a comment); Save hands the note to the app the same way the
// browser chords travel, as a navigation to `kolux-note:<base64 json>` that the tab's navigation
// handler cancels and turns into `NOTE_EVENT`. The notes collect in the tab's tray; sending them
// to an agent is the front end's job (`src/browser/notes.ts`).
use crate::browser;
use base64::Engine;
use serde::Serialize;
use tauri::AppHandle;

pub const NOTE_EVENT: &str = "browser-note";
const NOTE_SCHEME: &str = "kolux-note:";

#[derive(Clone, Serialize)]
pub struct NotePayload {
    pub id: u32,
    pub note: serde_json::Value,
}

/// The note a navigation carries, if it is one of ours and holds a note.
pub fn note_of(url: &str) -> Option<serde_json::Value> {
    let data = url.strip_prefix(NOTE_SCHEME)?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).ok()?;
    serde_json::from_slice(&bytes).ok().filter(serde_json::Value::is_object)
}

/// Turns annotation on or off in a tab's page.
#[tauri::command]
pub async fn browser_annotate(app: AppHandle, id: u32, on: bool) -> Result<(), String> {
    let v = browser::view(&app, id)?;
    v.eval(if on { PICK_SCRIPT } else { "window.__kolux_annotate && window.__kolux_annotate.off()" }).map_err(|e| e.to_string())
}

/// Runs in the page when annotation turns on. Nothing of it is left behind once it is off.
pub const PICK_SCRIPT: &str = r##"(() => {
  if (window.__kolux_annotate) { window.__kolux_annotate.on(); return; }
  const K = "kolux-annotate";
  const outline = document.createElement("div");
  outline.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #4f8cff;background:rgba(79,140,255,.12);border-radius:3px;display:none";
  outline.className = K;
  let form = null, picked = null, active = false;
  const selectorOf = (el) => {
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && parts.length < 5; e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      if (e.id) { parts.unshift("#" + CSS.escape(e.id)); break; }
      const cls = [...e.classList].filter((c) => !c.startsWith(K)).slice(0, 2);
      if (cls.length) s += "." + cls.map((c) => CSS.escape(c)).join(".");
      const same = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e.tagName) : [];
      if (same.length > 1) s += ":nth-of-type(" + (same.indexOf(e) + 1) + ")";
      parts.unshift(s);
    }
    return parts.join(" > ");
  };
  const components = (el) => {
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    const names = [];
    for (let f = key ? el[key] : null; f && names.length < 6; f = f.return) {
      const t = f.type;
      const n = typeof t === "function" ? (t.displayName || t.name) : (t && typeof t === "object" && (t.displayName || (t.render && t.render.name))) || null;
      if (n && n !== names[names.length - 1]) names.push(n);
    }
    return names;
  };
  const sources = (el) => {
    const hints = [];
    for (const a of el.attributes) if (/^data-(testid|test|component|source|file|cy)$|^data-v-|^data-astro/.test(a.name)) hints.push(a.name + "=" + a.value);
    const own = el.closest("[data-source-file],[data-sourceloc],[data-inspector-relative-path]");
    if (own) for (const n of ["data-source-file", "data-sourceloc", "data-inspector-relative-path"]) if (own.getAttribute(n)) hints.push(own.getAttribute(n));
    return hints;
  };
  const styles = (el) => {
    const cs = getComputedStyle(el);
    const out = {};
    for (const p of ["display", "position", "width", "height", "margin", "padding", "color", "background-color", "font-family", "font-size", "font-weight", "line-height", "border", "border-radius", "gap", "flex-direction"]) {
      const v = cs.getPropertyValue(p);
      if (v && v !== "none" && v !== "normal" && v !== "0px" && v !== "auto" && v !== "static") out[p] = v;
    }
    return out;
  };
  const place = (el) => {
    const r = el.getBoundingClientRect();
    outline.style.cssText += ";display:block;left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px";
  };
  const move = (e) => {
    if (form || !active) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el.closest("." + K)) return;
    place(el);
  };
  const closeForm = () => { if (form) { form.remove(); form = null; } outline.style.display = "none"; };
  const click = (e) => {
    if (!active) return;
    const el = e.target.closest ? e.target : e.target.parentElement;
    if (!el || el.closest("." + K)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (form) closeForm();
    picked = el;
    place(el);
    const r = el.getBoundingClientRect();
    form = document.createElement("form");
    form.className = K;
    form.style.cssText = "position:fixed;z-index:2147483647;left:" + Math.min(r.left, innerWidth - 340) + "px;top:" + Math.min(r.bottom + 6, innerHeight - 220) + "px;width:320px;background:#1b1d22;color:#e6e6e6;font:12px system-ui,sans-serif;border:1px solid #3a3d44;border-radius:8px;padding:10px;box-shadow:0 8px 30px rgba(0,0,0,.5)";
    const tag = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + ([...el.classList].filter((c) => !c.startsWith(K)).slice(0, 2).map((c) => "." + c).join(""));
    const comp = components(el);
    form.innerHTML = '<div style="font-weight:600;margin-bottom:6px;word-break:break-all">' + tag.replace(/</g, "&lt;") + '</div>' +
      (comp.length ? '<div style="color:#9aa0a6;margin-bottom:6px;word-break:break-all">' + comp.join(" &lsaquo; ").replace(/</g, "&lt;") + '</div>' : "") +
      '<select name="intent" style="width:100%;margin-bottom:6px;background:#111;color:#e6e6e6;border:1px solid #3a3d44;border-radius:4px;padding:4px"><option value="change">Change this</option><option value="bug">This is broken</option><option value="question">Question</option><option value="remove">Remove this</option><option value="keep">Keep, note only</option></select>' +
      '<textarea name="comment" rows="3" placeholder="What should happen here?" style="width:100%;box-sizing:border-box;background:#111;color:#e6e6e6;border:1px solid #3a3d44;border-radius:4px;padding:4px;resize:vertical"></textarea>' +
      '<div style="display:flex;gap:6px;justify-content:flex-end;margin-top:6px"><button type="button" name="cancel" style="background:#2a2d33;color:#e6e6e6;border:0;border-radius:4px;padding:4px 10px">Cancel</button><button type="submit" style="background:#4f8cff;color:#fff;border:0;border-radius:4px;padding:4px 10px">Save</button></div>';
    document.body.appendChild(form);
    form.querySelector("textarea").focus();
    form.querySelector('[name=cancel]').onclick = closeForm;
    form.onsubmit = (ev) => {
      ev.preventDefault();
      const note = {
        url: location.href, selector: selectorOf(picked), tag: picked.tagName.toLowerCase(),
        text: (picked.innerText || picked.value || picked.alt || "").trim().slice(0, 200),
        html: picked.outerHTML.slice(0, 400), components: comp, sources: sources(picked), styles: styles(picked),
        intent: form.intent.value, comment: form.comment.value.trim(), at: new Date().toISOString(),
      };
      closeForm();
      location.assign("kolux-note:" + btoa(unescape(encodeURIComponent(JSON.stringify(note)))));
    };
  };
  const key = (e) => { if (e.key === "Escape" && form) { e.preventDefault(); e.stopImmediatePropagation(); closeForm(); } };
  const on = () => {
    if (active) return;
    active = true;
    document.documentElement.appendChild(outline);
    addEventListener("mousemove", move, true);
    addEventListener("click", click, true);
    addEventListener("keydown", key, true);
  };
  const off = () => {
    active = false;
    closeForm();
    outline.remove();
    removeEventListener("mousemove", move, true);
    removeEventListener("click", click, true);
    removeEventListener("keydown", key, true);
  };
  window.__kolux_annotate = { on, off };
  on();
})();"##;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brow037_a_saved_note_travels_as_a_navigation_the_app_cancels() {
        let note = serde_json::json!({ "selector": "#buy", "comment": "make it green", "intent": "change" });
        let url = format!("{NOTE_SCHEME}{}", base64::engine::general_purpose::STANDARD.encode(note.to_string()));
        assert_eq!(note_of(&url), Some(note));
        assert_eq!(note_of("kolux-note:not base64!"), None, "garbage is dropped, not a note");
        assert_eq!(note_of("kolux-chord:back"), None, "a chord is not a note");
        assert_eq!(note_of("https://example.com/kolux-note:x"), None);
        assert!(PICK_SCRIPT.contains("kolux-note:") && PICK_SCRIPT.contains("__reactFiber$") && PICK_SCRIPT.contains("getComputedStyle"), "the form gathers selector, component tree and styles");
    }
}
