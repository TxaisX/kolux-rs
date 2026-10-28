// Shared reading for the folder-trust proofs (SAFE-023, SAFE-024): looks at every Claude pane's screen and never answers the trust question.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { CLAUDE, NeedsLogin, sleep } from "./live-common.mjs";

export const TRUST_RE = /trust this folder|Do you trust|Yes, I trust|Is this a project you created/i;
const LOGIN_RE = /login method|please run \/login|not logged in|log in to claude|Paste code here|Invalid API key|Anthropic Console|Sign in/i;
const PROMPT_RE = /\? for shortcuts|shift\+tab to cycle|(plan|auto|manual|default) mode on|accept edits on|esc to interrupt/i;

/** Screen text of every Claude pane (shown or not) that has a terminal, in DOM order. */
export const paneScreens = (app) =>
  app.evalJs(`(() => [...document.querySelectorAll(${JSON.stringify(CLAUDE)})].map((sec) => { for (const d of sec.querySelectorAll("div")) { const t = d.__koluxTerm; if (t) { const b = t.buffer.active; const rows = []; for (let y = 0; y < t.rows; y++) rows.push(b.getLine(b.viewportY + y)?.translateToString(true) ?? ""); return { key: sec.getAttribute("aria-label") || sec.dataset.key || "", text: rows.join("\\n") }; } } return { key: sec.getAttribute("aria-label") || "", text: "" }; }))()`);

/**
 * Polls until `want` Claude panes each show their prompt box (state "prompt") or a trust menu ("trust").
 * Nothing is answered. A login screen throws NeedsLogin. Returns [{key, state, text}] at the end or on timeout.
 */
export async function watchPanes(app, want, ms, log) {
  const end = Date.now() + ms;
  let last = [];
  for (;;) {
    const raw = await paneScreens(app).catch(() => []);
    last = raw.map((p) => ({ key: p.key, text: p.text, state: TRUST_RE.test(p.text) ? "trust" : LOGIN_RE.test(p.text) ? "login" : PROMPT_RE.test(p.text) ? "prompt" : "starting" }));
    const login = last.find((p) => p.state === "login");
    if (login) throw new NeedsLogin(`claude asks for a login: ${login.text.split("\n").filter(Boolean).slice(0, 3).join(" | ").slice(0, 160)}`);
    const settled = last.filter((p) => p.state === "prompt" || p.state === "trust");
    if (last.length >= want && settled.length >= want) return last;
    if (last.some((p) => p.state === "trust") && Date.now() > end - ms + 8000 && last.length >= want) return last; // a trust menu will not go away on its own
    if (Date.now() > end) return last;
    await sleep(1000);
  }
}

/** Lines of Kolux's own log that mention trust (paths only; redacted by the evidence writer). */
export function trustLogLines(root, max = 8) {
  const files = [];
  const walk = (d, depth) => {
    if (depth > 6) return;
    for (const n of readdirSync(d)) {
      const p = `${d}/${n}`;
      let s;
      try { s = statSync(p); } catch { continue; }
      if (s.isDirectory()) walk(p, depth + 1);
      else if (/kolux\.log$/i.test(n)) files.push(p);
    }
  };
  try { walk(root, 0); } catch { /* none */ }
  const out = [];
  for (const f of files) {
    let t = "";
    try { t = readFileSync(f, "utf8"); } catch { continue; }
    for (const l of t.split(/\r?\n/)) if (/trust/i.test(l)) out.push(l.replace(/\\/g, "/").slice(0, 260));
  }
  return out.slice(-max);
}
