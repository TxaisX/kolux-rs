// Shared fixtures and page readings for the spec/11 LIVE proofs (GIT-*): Source Control panel, worktree switching and git traces.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, LIVE_BASE } from "./live-common.mjs";

export * from "./live-edit-common.mjs";
export { git, LIVE_BASE };

const pad = (i) => String(i).padStart(2, "0");
export const SCM = ".sidebar.scm";
/** The top bar has two button.ib.panel: the first hides the left sidebar, the one titled for the right panel opens and closes Source Control. */
export const RIGHT_TOGGLE = `[...document.querySelectorAll("button.ib.panel")].find(b=>/right panel|Source Control/.test(b.title))`;
/** n numbered lines; `mark` replaces the line numbers in `at` with a changed text. */
export const rows = (n, label, changed = {}) => Array.from({ length: n }, (_, i) => changed[i + 1] ?? `${label} line ${i + 1}`).join("\n") + "\n";

/** A repo whose branch `feature` has no upstream while main is published to a local bare origin. */
export async function addUnpublishedBranch(repo, originDir, branch = "feature") {
  rmSync(originDir, { recursive: true, force: true });
  mkdirSync(originDir, { recursive: true });
  await git(originDir, ["init", "-q", "--bare", "-b", "main"]);
  await git(repo, ["config", "user.name", "prove"]);
  await git(repo, ["config", "user.email", "prove@example.invalid"]);
  await git(repo, ["remote", "add", "origin", originDir]);
  await git(repo, ["push", "-q", "-u", "origin", "main"]);
  await git(repo, ["checkout", "-q", "-b", branch]);
}

export const ident = async (repo) => {
  await git(repo, ["config", "user.name", "prove"]);
  await git(repo, ["config", "user.email", "prove@example.invalid"]);
};

export const panelVisible = (app) => app.evalJs(`(()=>{const e=document.querySelector("${SCM}"); return !!e && e.offsetParent!==null && e.getBoundingClientRect().width>0;})()`);

/** Opens the right panel on Source Control (toggles the top bar button only when it is closed). */
export async function ensurePanel(app) {
  // The toggle's own state decides: geometry can read "hidden" while the panel is still laying out, and a click would then close it.
  if ((await app.evalJs(`${RIGHT_TOGGLE}?.getAttribute("aria-pressed")`)) !== "true") {
    await app.evalJs(`${RIGHT_TOGGLE}.click()`);
    await app.sleep(1200);
  }
  await app.evalJs(`(()=>{const t=[...document.querySelectorAll("[role=tab]")].find(t=>t.textContent.trim()==="Source Control"); if(t){t.dispatchEvent(new MouseEvent("mousedown",{bubbles:true})); t.click();} return !!t;})()`);
  await app.sleep(1000);
  return panelVisible(app);
}

/** Counts of the panel: header count, per-section counts, row and folder-row totals, and which view button shows. */
export const scmReading = (app) =>
  app.evalJs(`(()=>{const p=document.querySelector("${SCM}"); if(!p) return null;
    const secs={}; for(const s of p.querySelectorAll(".scm-sec-wrap[data-section]")) secs[s.dataset.section]=Number(s.querySelector(".scm-sec .count")?.textContent||0);
    const rowsAll=[...p.querySelectorAll(".scm-sec-wrap[data-section] .scm-row")]; const committed=p.querySelectorAll(".scm-sec-wrap[data-committed] .scm-row").length; const viewBtn=p.querySelector('.scm-head button[aria-label="View as tree"],.scm-head button[aria-label="View as list"]');
    return {head:p.querySelector(".scm-head .count")?.textContent??null, secs, files:rowsAll.filter(r=>!r.classList.contains("scm-dir")).length, dirs:rowsAll.filter(r=>r.classList.contains("scm-dir")).length, committed, view:viewBtn?viewBtn.getAttribute("aria-label"):null, pressed:viewBtn?viewBtn.getAttribute("aria-pressed"):null, branch:p.querySelector(".scm-summary .branch")?.textContent??null};})()`);

/** The commit box of the open panel: its text, and whether the main button reads Commit. */
export const commitBox = (app) =>
  app.evalJs(`(()=>{const p=document.querySelector("${SCM}"); const t=p&&p.querySelector(".scm-commit textarea"); const b=p&&p.querySelector(".scm-main button.btn.primary"); return t?{value:t.value, disabled:t.disabled, main:b?b.textContent.trim():null, mainDisabled:b?b.disabled:null}:null;})()`);

/** Replaces the commit box text through the input pipeline (select all, then insert). */
export async function typeDraft(app, text) {
  await app.evalJs(`(()=>{const t=document.querySelector("${SCM} .scm-commit textarea"); t.focus(); t.select(); return true;})()`);
  await app.cdp("insert", text);
  await app.sleep(500);
}

/** The second worktree made the way a person makes one: the + on the project header, a name, Enter. */
export async function makeWorktree(app, name, log) {
  await app.click('.proj button.ib[title^="New workspace"]');
  await app.waitFor("the workspace name field", () => app.exists('input[aria-label="workspace name"]'), 8000);
  await app.focusField('input[aria-label="workspace name"]');
  await app.sleep(1500);
  await app.evalJs(`document.querySelector('input[aria-label="workspace name"]').select()`);
  await app.cdp("insert", name);
  const read = () => app.evalJs(`({preview:document.querySelector(".sb-form .preview")?.textContent||"", field:document.querySelector('input[aria-label="workspace name"]')?.value??null})`);
  await app.waitFor(`the preview names ${name}`, async () => new RegExp(`^branch .*${name}`).test((await read()).preview), 8000).catch(async (e) => {
    throw new Error(`${e.message}; form reads ${JSON.stringify(await read())}`);
  });
  await app.cdp("key", "Enter");
  await app.sleep(5000);
  const labels = () => app.evalJs(`[...document.querySelectorAll("button.branch .name, [data-worktree]")].map(e=>e.dataset&&e.dataset.worktree?e.dataset.worktree:e.textContent.trim())`);
  const end = Date.now() + 30000;
  let l = await labels();
  while (!l.includes(name) && Date.now() < end) {
    await app.sleep(800);
    l = await labels();
  }
  await app.sleep(2500);
  log?.(`worktrees in the sidebar: ${JSON.stringify(l)}`);
  return l.includes(name);
}
export const selectedWorktree = (app) =>
  app.evalJs(`(()=>{const m=document.querySelector("button.branch.sel"); if(m) return "main"; const o=[...document.querySelectorAll("[data-worktree]")].find(e=>e.querySelector(".sess.sel")); return o?o.dataset.worktree:null;})()`);
export const pickMain = (app) => app.evalJs(`document.querySelector("button.branch").click()`);

/** Git processes the app started, read from a GIT_TRACE2 folder: one file per process. */
export function readTrace(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    let text = "";
    try {
      text = readFileSync(join(dir, f), "utf8");
    } catch {
      continue;
    }
    const m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)\.(\d+)Z/.exec(f);
    const t = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], Math.floor(+m[7] / 1000)) : null;
    const start = /\bstart\s+(.*)$/m.exec(text)?.[1]?.trim() ?? "";
    const name = /\bcmd_name\s+(\S+)/.exec(text)?.[1] ?? "";
    out.push({ file: f, t, name, start });
  }
  return out.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
}
/** A command that talks to a remote: fetch, ls-remote, push, pull, remote update/show, or a transport helper. */
export const isRemoteCall = (e) => /^(fetch|ls-remote|push|pull|remote-curl|remote-https|remote-http|remote-ssh|upload-pack|receive-pack|fetch-pack|send-pack|fetch-http|http-fetch)$/.test(e.name) || /\bremote\s+(update|show|prune)\b/.test(e.start);

/** Review fixture (GIT-037/038/040/003): multi.txt has two separate hunks, ws.txt only a whitespace change, g01..g08 one hunk each; 10 files change in all. */
export function reviewRepo() {
  const body = (label) => Array.from({ length: 40 }, (_, i) => `${label} line ${i + 1}`).join("\n") + "\n";
  const multi = Array.from({ length: 60 }, (_, i) => `row ${i + 1}`).join("\n") + "\n";
  const files = { "README.md": "# fixture\n", "multi.txt": multi, "ws.txt": body("ws") };
  const dirty = { "multi.txt": multi.replace("row 20\n", "row 20 CHANGED\n").replace("row 45\n", "row 45 CHANGED\n"), "ws.txt": body("ws").replace("ws line 10\n", "ws    line   10\n") };
  for (let i = 1; i <= 8; i++) {
    const n = pad(i);
    files[`g${n}.txt`] = body(`g${n}`);
    dirty[`g${n}.txt`] = body(`g${n}`).replace(`g${n} line 15\n`, `g${n} line 15 CHANGED\n`).replace(`g${n} line 30\n`, `g${n} line 30 CHANGED\n`);
  }
  return { files, dirty };
}
