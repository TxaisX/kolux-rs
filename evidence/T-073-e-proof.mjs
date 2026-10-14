// T-073-e live proof driver (council MERGE 33 A1): drives the look-lane dev app the smoke left up
// (`pnpm smoke -- --only 2 --keep ... --temp G:/Temp/look-t546`, CDP 9249) and prints raw readings.
// Usage: node evidence/T-073-e-proof.mjs <app pid> <step: tour|look|worktree|open|saves|all>
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const ROOT = "G:/Dev/kolux-rs-lanes/look";
const TEMP = "G:/Temp/look-t546";
const CDP = "9249";
const PID = process.argv[2];
const WT_NAME = "agent-a";
const ED = 'section.pane.editor[aria-label="notes.txt pane"]';
// The tab in front: the main checkout's notes.txt tab stays open in the background once the worktree is active.
const EDV = `[...document.querySelectorAll(${JSON.stringify(ED)})].find(e => e.offsetParent !== null)`;
const run = (f, a, env) => new Promise((res, rej) => execFile(f, a, { env: { ...process.env, ...env }, maxBuffer: 1 << 24 }, (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so.trim()))));
const cdp = (...a) => run(process.execPath, [`${ROOT}/scripts/evidence/cdp.mjs`, "main", ...a], { CDP_PORT: CDP });
const ev = async (js) => {
  const out = await cdp("eval", js);
  let v = JSON.parse(out);
  if (v && typeof v === "object" && v.exceptionDetails) throw new Error(JSON.stringify(v.exceptionDetails));
  if (v && typeof v === "object" && v.result && typeof v.result === "object" && "type" in v.result) v = v.result.value ?? null;
  return v;
};
const ps = (s) => run("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", s]);
const git = (...a) => run("git", ["-C", `${TEMP}/repo`, ...a]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
async function waitFor(what, probe, ms = 8000) {
  const s = Date.now();
  for (;;) {
    const v = await probe();
    if (v) return Date.now() - s;
    if (Date.now() - s > ms) throw new Error(`timed out: ${what}`);
    await sleep(150);
  }
}
const buffer = () => ev(`[...(${EDV}).querySelectorAll(".cm-line")].map(l => l.textContent).join("\\n")`);
const notice = (cls) => ev(`(() => { const p = ${EDV}; const n = p && p.querySelector(".notice.${cls}"); return n ? { text: n.querySelector("span")?.textContent ?? n.textContent, buttons: [...n.querySelectorAll("button")].map(b => b.textContent) } : null; })()`);
const unsaved = () => ev(`!!(${EDV}).querySelector(".unsaved")`);
const focusEd = () => ev(`(() => { const p = ${EDV}; p.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); const f = p.querySelector(".cm-content"); f.focus(); return document.activeElement === f; })()`);
const caretEnd = () => ev(`(() => { const f = (${EDV}).querySelector(".cm-content"); const r = document.createRange(); r.selectNodeContents(f.lastElementChild); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`);
const view = (name) => ev(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === ${JSON.stringify(name)}); if (!b) return "missing"; b.click(); return "clicked"; })()`);
const clickWhere = async (sel, re) => {
  const r = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => ${re}.test((x.querySelector(".name") ?? x).textContent || "")); if (!e) return "missing"; e.click(); return "clicked"; })()`);
  if (r !== "clicked") throw new Error(`no ${sel} matching ${re}`);
};
const rightTab = async (name) => {
  if (!(await ev(`!!document.querySelector('aside.rside [role="tab"]')`))) await ev(`document.querySelector("button.ib.panel").click(), true`);
  await waitFor("the right sidebar", () => ev(`!!document.querySelector('aside.rside [role="tab"]')`), 5000);
  await clickWhere('aside.rside [role="tab"]', `/^\\s*${name}\\s*$/`);
};
const worktreePath = async () => {
  const list = await git("worktree", "list", "--porcelain");
  const m = list.split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9)).find((p) => p.replace(/\\/g, "/").includes(`/${WT_NAME}`));
  return m ? m.replace(/\\/g, "/") : null;
};

const step = process.argv[3] ?? "all";

if (step === "tour" || step === "all") {
  log("tour close:", await ev(`(() => { const d = document.querySelector("[role=dialog]"); const x = d && [...d.querySelectorAll("button")].find(b => b.getAttribute("aria-label") === "Close"); if (!x) return "no tour"; x.click(); return "closed"; })()`));
  await sleep(500);
  log("skip:", await ev(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Skip"); if (!b) return "no skip"; b.click(); return "skipped"; })()`));
  await sleep(500);
}

if (step === "look" || step === "all") {
  // The runner already wrote uiLook=new / dark into settings.json before launch and maximised.
  log("ui look attr:", JSON.stringify(await ev(`[document.documentElement.dataset.look ?? null, document.documentElement.dataset.theme ?? null, document.documentElement.className]`)));
  log("Terminals view:", await view("Terminals"));
  await sleep(500);
}

if (step === "worktree" || step === "all") {
  // The project row's "New workspace" button opens the composer with the project picked; the name
  // preview (workspace_preview) must have answered before Enter creates (create() returns otherwise).
  log("composer:", await ev(`(() => { const b = document.querySelector('button.ib[title^="New workspace"]'); if (!b) return "missing"; b.click(); return "clicked"; })()`));
  await waitFor("the composer", () => ev(`!!document.querySelector('.sb-form.composer input[aria-label="workspace name"]')`), 5000);
  await cdp("focus", '.sb-form.composer input[aria-label="workspace name"]');
  await cdp("insert", WT_NAME);
  await waitFor("the name preview", () => ev(`(() => { const t = document.querySelector(".sb-form.composer .preview")?.textContent ?? ""; return t.includes(${JSON.stringify(WT_NAME)}) ? t : ""; })()`), 10000);
  log("preview:", JSON.stringify(await ev(`document.querySelector(".sb-form.composer .preview")?.textContent`)));
  await cdp("key", "Enter");
  const ms = await waitFor("the worktree on disk", worktreePath, 60000);
  log(`worktree created ${ms} ms after Enter:`, await worktreePath());
  await waitFor("a shell pane in the new workspace", () => ev(`[...document.querySelectorAll('section.pane[data-agent="shell"]')].some(e => e.offsetParent !== null)`), 30000);
  log("workspace rows:", JSON.stringify(await ev(`[...document.querySelectorAll(".branch .name")].map(e => e.textContent)`)));
}

if (step === "open" || step === "all") {
  await rightTab("Explorer");
  await waitFor("notes.txt in the Explorer", () => ev(`!!document.querySelector('[role="tree"] .ex-row[role="treeitem"]')`), 10000);
  await clickWhere('[role="tree"] .ex-row[role="treeitem"]', "/^\\s*notes\\.txt\\s*$/");
  await waitFor("the editor tab in front", () => ev(`!!(${EDV} && (${EDV}).querySelector(".cm-content"))`), 10000);
  log("editor tabs (all / shown):", await ev(`document.querySelectorAll(${JSON.stringify(ED)}).length`), "/", await ev(`[...document.querySelectorAll(${JSON.stringify(ED)})].filter(e => e.offsetParent !== null).length`));
  log("buffer:", JSON.stringify(await buffer()));
}

if (step === "saves" || step === "all") {
  const wt = await worktreePath();
  const file = `${wt}/notes.txt`;
  log("file under test:", file, "exists:", existsSync(file));
  let flashes = 0;
  const perSave = [];
  for (let i = 1; i <= 10; i++) {
    await focusEd();
    await caretEnd();
    await cdp("insert", ` s${i}`);
    await waitFor("the unsaved marker", unsaved, 3000);
    // In-page sampler: every 100 ms for 3 s, is the changed-on-disk banner in the tab in front?
    await ev(`(window.__t073e = { n: 0, hits: 0, first: null, done: false }, (() => { const t = setInterval(() => { const p = ${EDV}; const s = window.__t073e; s.n++; if (p && p.querySelector(".notice.disk-changed")) { s.hits++; if (s.first === null) s.first = s.n; } }, 100); setTimeout(() => { clearInterval(t); window.__t073e.done = true; }, 3000); })(), true)`);
    await cdp("key", "s", "2");
    const saved = await waitFor("the bytes on disk", () => readFileSync(file, "utf8").includes(` s${i}`), 10000);
    await waitFor("the sampler", () => ev(`window.__t073e.done`), 6000);
    const s = await ev(`window.__t073e`);
    flashes += s.hits;
    perSave.push(`save ${i}: on disk after ${saved} ms, ${s.n} samples, banner seen ${s.hits}x${s.first ? ` (first at sample ${s.first})` : ""}, unsaved marker now ${await unsaved()}`);
    log(perSave[perSave.length - 1]);
  }
  log(`TOTAL banner flashes over 10 Mod+S in ${wt}: ${flashes}`);
  log("disk ends with:", JSON.stringify(readFileSync(file, "utf8").slice(-60)));
  log("banner now:", JSON.stringify(await notice("disk-changed")), "stale:", JSON.stringify(await notice("save-stale")));
}
log("done");
