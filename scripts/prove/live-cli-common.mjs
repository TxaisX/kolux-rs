// Shared pieces of the spec/08, 09 and 20 LIVE proofs: run the app's own dev CLI (kolux-dev) from a shell pane of the hidden app,
// read hidden panes' terminal buffers, and switch the sidebar's workspace. Never runs an unqualified `kolux`.
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { sleep, TERM, SHELL } from "./live-common.mjs";
import { poll } from "./live-edit-common.mjs";

export { poll, sleep, TERM, SHELL };

let seq = 0;

/**
 * Types `kolux-dev <args> --json > <file>` into the n-th shown shell pane, waits for its exit-code file, and returns
 * { exit, json, raw }.
 */
export async function runCli(ctx, args, { pane = 0, json = true, timeout = 60000 } = {}) {
  const n = ++seq;
  const dir = `${ctx.TEMP}/cli`;
  mkdirSync(dir, { recursive: true });
  const out = `${dir}/${n}.txt`;
  rmSync(out, { force: true });
  const done = `${out}.exit`;
  rmSync(done, { force: true });
  const line = `kolux-dev ${args}${json ? " --json" : ""} > '${out}' 2>&1; $LASTEXITCODE | Out-File -Encoding ascii '${done}'`;
  await ctx.typeInto(pane, line, SHELL);
  // The exit code goes to a file, not the pane: an --activate run switches the grid away from the calling pane.
  const got = await poll(() => existsSync(done) && readFileSync(done, "utf8").trim() !== "", timeout, 400);
  const exit = got ? Number(readFileSync(done, "utf8").trim()) : null;
  // PowerShell's > writes UTF-16 with a BOM.
  const buf = existsSync(out) ? readFileSync(out) : Buffer.alloc(0);
  const raw = (buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8")).replace(/^﻿/, "");
  let parsed = null;
  if (json) {
    try {
      const j = JSON.parse(raw);
      parsed = j?.result ?? j;
    } catch {
      parsed = null;
    }
  }
  return { ok: !!got, exit, json: parsed, raw };
}

/** Every pane section (shown or not) matching sel, with its xterm buffer text. Hidden panes are read too. */
export const allPaneBuffers = (app, sel = "section.pane[data-agent]") =>
  app.evalJs(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(p => { let text = null; for (const d of p.querySelectorAll("div")) { const t = d.__koluxTerm; if (t) { const b = t.buffer.active; const out = []; for (let y = 0; y < b.length; y++) out.push(b.getLine(y)?.translateToString(true) ?? ""); text = out.join("\\n"); break; } } return { agent: p.getAttribute("data-agent"), label: p.getAttribute("aria-label"), shown: p.offsetParent !== null, text }; })`);

/** Sidebar rows: label, folder, selected flag and nesting depth (data-depth). */
export const rowsOf = (app) =>
  app.evalJs(`[...document.querySelectorAll("[data-worktree]")].map(e => ({ label: e.dataset.worktree, path: e.dataset.path, sel: !!e.querySelector(".sess.sel"), depth: Number(e.dataset.depth) }))`);

/** Clicks the sidebar row whose label is `label`. */
export const selectRow = (app, label) =>
  app.evalJs(`(() => { const e = [...document.querySelectorAll("[data-worktree]")].find(e => e.dataset.worktree === ${JSON.stringify(label)}); if (!e) return false; (e.querySelector(".sess") ?? e).dispatchEvent(new MouseEvent("click", { bubbles: true })); return true; })()`);

/** The tab strip's labels. */
export const tabsOf = (app) => app.evalJs(`[...document.querySelectorAll("div[role=tab]")].map(t => t.textContent.trim())`);
