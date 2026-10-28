// Shared steps of the plan-review live proofs (SAFE-003, SAFE-004): a real Claude in plan mode, the review sheet over CDP.
// Everything is read from Kolux's side: the sheet DOM, agent-status events, what the window typed into the terminal, the window's own draft state.
import { sleep, waitFor } from "./live-claude-common.mjs";

export const PLAN_ARGS = "--model haiku --permission-mode plan --settings ${SETTINGS}";
export const PLAN_PROMPT =
  "Make a plan to create a file named plan-out.txt that contains the word hi. Write the plan as four blocks separated by blank lines: a title line, then three one-line steps. Present it for approval with the exit plan mode tool.";

/** Records every terminal_write the window makes (what Kolux typed or pasted into a pane). */
export const watchWrites = (app) =>
  app.evalJs(`(() => { if (window.__proveWrites) return true; window.__proveWrites = []; const i = window.__TAURI_INTERNALS__; const orig = i.invoke.bind(i); i.invoke = (cmd, args, opts) => { if (cmd === "terminal_write") window.__proveWrites.push({ t: Date.now(), data: String(args?.data ?? "") }); return orig(cmd, args, opts); }; return true; })()`);
export const writes = (app, since = 0) => app.evalJs(`window.__proveWrites.filter((w) => w.t >= ${since})`);

/** True when any React state or reducer value held by the window contains the text (the plan drafts live there; in memory only). */
export const stateHolds = (app, text) =>
  app.evalJs(`(() => { const root = document.getElementById("root"); const k = root && Object.keys(root).find((x) => x.startsWith("__reactContainer$")); if (!k) return "no-root"; const seen = new Set(); const stack = [root[k]]; let n = 0; while (stack.length && n++ < 200000) { const f = stack.pop(); if (!f || seen.has(f)) continue; seen.add(f); let h = f.memoizedState; let g = 0; while (h && typeof h === "object" && "next" in h && g++ < 200) { const v = h.memoizedState; if (v && typeof v === "object" && !(v instanceof Node) && !("current" in v && Object.keys(v).length === 1)) { try { if (JSON.stringify(v).includes(${JSON.stringify(text)})) return true; } catch {} } h = h.next; } stack.push(f.child, f.sibling); } return false; })()`);

export const reviewBtn = (app) => app.exists(".plan-review-btn");
export const sheetOpen = (app) => app.exists(".plan-sheet");

/** Waits for Claude's exit-plan request, then opens the sheet from the pane header. Returns the sheet's block labels. */
export async function openSheet(ctx, h, after) {
  const ev = await ctx.waitEvent((e) => e.t >= after && e.tool === "ExitPlanMode" && (e.state === "permission" || e.state === "waiting"), 120000, "Claude's exit-plan request");
  h.log(`plan request: state=${ev.state} tool=${ev.tool} ${ev.t - after} ms after the prompt`);
  await waitFor("the Review plan button", () => reviewBtn(ctx.app), 15000, 300);
  await ctx.app.click(".plan-review-btn");
  await waitFor("the review sheet", () => sheetOpen(ctx.app), 10000, 300);
  const blocks = await ctx.app.evalJs(`[...document.querySelectorAll(".plan-sheet .plan-block")].map((b) => b.getAttribute("aria-label"))`);
  h.log(`sheet blocks: ${JSON.stringify(blocks)}`);
  return { blocks, ev };
}

/** Adds one comment on the i-th block through the sheet. */
export async function addComment(app, i, text) {
  const r = await app.evalJs(`(() => { const b = document.querySelectorAll(".plan-sheet .plan-block")[${i}]; const a = b && [...b.querySelectorAll("button")].find((x) => x.textContent.trim() === "Add comment"); if (!a) return false; a.click(); return true; })()`);
  if (!r) throw new Error(`no Add comment button on block ${i}`);
  await waitFor("the comment box", () => app.exists('.plan-sheet textarea[aria-label^="Comment on"]'), 5000, 200);
  await app.focusField('.plan-sheet textarea[aria-label^="Comment on"]');
  await app.cdp("insert", text);
  await sleep(300);
  const ok = await app.evalJs(`(() => { const b = [...document.querySelectorAll(".plan-sheet .plan-write button")].find((x) => x.textContent.trim() === "Add"); if (!b || b.disabled) return false; b.click(); return true; })()`);
  if (!ok) throw new Error("Add button missing or disabled");
  await sleep(300);
}

export const sheetButton = (app, label) =>
  app.evalJs(`(() => { const b = [...document.querySelectorAll(".plan-sheet-actions button")].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)})); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null; })()`);
export const clickSheetButton = (app, label) =>
  app.evalJs(`(() => { const b = [...document.querySelectorAll(".plan-sheet-actions button")].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)})); if (!b || b.disabled) return false; b.click(); return true; })()`);
