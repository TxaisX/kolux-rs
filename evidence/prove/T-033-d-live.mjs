// T-033-d live proof (2026-10-26): a REAL Claude Code (haiku, --permission-mode acceptEdits) in a pane of the hidden dev app,
// signed in with the Txais-approved test account A, edits two tracked files and creates one in a throwaway repo (branch
// `feature` over `main`). Source Control must list the three within 4 s of the agent's last write, All Changes (Compare =
// branch base) must show them with hunks, a commit from the All Changes box must leave panel, tab and `git status` agreeing,
// and the watcher must read status at most 15 times a minute (git processes counted with GIT_TRACE2).
// Run: node evidence/prove/T-033-d-live.mjs   (writes evidence/T-033-d.txt)
import { writeFileSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { ROOT, BASE, startProve, reporter, excerpt, NeedsLogin, sleep, waitFor, git } from "../../scripts/prove/live-common.mjs";

const { log, lines } = reporter();
const TRACE = `${BASE}/trace-T-033-d`;
const FILES = ["a.txt", "b.txt", "new.txt"];
const one = (s) => (s ?? "").replace(/\s+/g, " ").trim();
let ctx;
let ok = false;

const rightTab = async (name) => {
  const { exists, click, clickWhere } = ctx.app;
  if (!(await exists('aside.rside [role="tab"]'))) await click("button.ib.panel");
  await waitFor("the right sidebar", () => exists('aside.rside [role="tab"]'), 5000);
  await clickWhere('aside.rside [role="tab"]', `/^\\s*${name}\\s*$/`);
};
// Uncommitted rows (the Changes sections) and the "Committed on this branch" rows are told apart by their wrapper.
const rows = () => ctx.app.evalJs(`[...document.querySelectorAll(".scm-row")].filter((r) => !r.closest("[data-committed]")).map((r) => r.getAttribute("title"))`);
const committedRows = () => ctx.app.evalJs(`[...document.querySelectorAll("[data-committed] .scm-row")].map((r) => r.getAttribute("title"))`);
const sections = () => ctx.app.evalJs(`[...document.querySelectorAll('section.pane.editor.all-changes .ac-section')].map((s) => ({ name: (s.querySelector(".ac-name")?.getAttribute("title") ?? "").split("/").pop().split(String.fromCharCode(92)).pop(), lines: (s.querySelector(".ac-lines")?.textContent ?? "").trim() }))`);

/** Every `status --porcelain=v2 ... -z` process the app started (scm::status), with its start time (file birth). */
function statusReads() {
  const out = [];
  for (const f of readdirSync(TRACE)) {
    const p = `${TRACE}/${f}`;
    let text;
    try {
      text = readFileSync(p, "utf8");
    } catch {
      continue;
    }
    if (/ start .*\bstatus\b.*--porcelain=v2.* -z/.test(text.slice(0, 4000))) out.push(statSync(p).birthtimeMs);
  }
  return out.sort((a, b) => a - b);
}
const clock = (t) => new Date(t).toISOString().slice(11, 23);

try {
  log("T-033-d live proof, " + new Date().toISOString());
  log("setup: hidden dev app, scratch repo on branch `feature` (one commit over `main`) with a.txt and b.txt tracked; claude --model haiku --permission-mode acceptEdits in test account A; GIT_TRACE2 points at an empty folder so every git process the app starts leaves one file (the harness's own git runs with it cleared).");
  ctx = await startProve("T-033-d", {
    report: { log },
    claudeArgs: "--model haiku --permission-mode acceptEdits --settings ${SETTINGS}",
    files: { "a.txt": "alpha one\nalpha two\nalpha three\n", "b.txt": "beta one\nbeta two\n" },
    branch: "feature",
    trace: TRACE,
  });
  // The scratch HOME has no git identity: a repo-local one lets the app's own `git commit` run.
  await git(ctx.repo, ["config", "user.name", "prove"]);
  await git(ctx.repo, ["config", "user.email", "prove@example.invalid"]);
  await rightTab("Source Control");
  await waitFor("the Source Control panel", () => ctx.app.exists('button[aria-label="All changes"]'), 10000);
  log(`Source Control open, rows before the agent runs: ${JSON.stringify(await rows())}, git status: ${(await git(ctx.repo, ["status", "--porcelain"])).trim() || "(clean)"}`);

  // The page notes the first moment each row shows (50 ms poll), so "within 4 s of the last write" is read from the page.
  await ctx.app.evalJs(`(() => { window.__rowSeen = {}; setInterval(() => { for (const f of ${JSON.stringify(FILES)}) if (!window.__rowSeen[f] && document.querySelector('.scm-row[title="' + f + '"]')) window.__rowSeen[f] = Date.now(); }, 50); return true; })()`);

  await ctx.openClaude();
  await ctx.ready(120000);
  const reads0 = statusReads().length;
  const sent = Date.now();
  await ctx.say("Do these three things in this order, then say done. You may read a file first if you need to. (1) With the Edit tool change the line 'alpha two' in a.txt to 'ALPHA TWO CHANGED'. (2) With the Edit tool change the line 'beta two' in b.txt to the two lines 'beta two' and 'beta three'. (3) With the Write tool create new.txt containing the single line 'brand new file'.");
  log(`prompt sent at ${clock(sent)}`);
  let allowed = 0;
  let stop;
  const end = Date.now() + 240000;
  while (!stop && Date.now() < end) {
    stop = (await ctx.events()).find((e) => e.state === "done" && !e.boundary && e.t > sent);
    if (stop) break;
    const t = await ctx.screenText();
    if (/Do you want to (create|make|proceed|edit)|1\. Yes/i.test(t) && allowed < 6) {
      allowed += 1;
      log(`   Claude asked for a permission (${allowed}); allowed with 1`);
      await ctx.press("1");
    }
    await sleep(1000);
  }
  if (!stop) throw new Error("no Stop event within 240 s");
  log(`Stop received at ${clock(stop.t)} (${((stop.t - sent) / 1000).toFixed(1)} s after the prompt); permission asks answered: ${allowed}`);
  const missing = FILES.filter((f) => !existsSync(`${ctx.repo}/${f}`));
  if (missing.length) throw new Error(`the agent did not write: ${missing.join(", ")}`);

  // --- (a) Source Control within 4 s of the agent's last write
  const mtimes = Object.fromEntries(FILES.map((f) => [f, statSync(`${ctx.repo}/${f}`).mtimeMs]));
  const lastWrite = Math.max(...Object.values(mtimes));
  await waitFor("the three rows in Source Control", async () => (await rows()).filter((r) => FILES.includes(r)).length === 3, 20000, 200);
  const seen = await ctx.app.evalJs("window.__rowSeen");
  const allSeen = Math.max(...FILES.map((f) => seen[f]));
  log(`agent's files changed on disk: ${FILES.map((f) => `${f} ${clock(mtimes[f])}`).join(", ")}; last write ${clock(lastWrite)}`);
  log(`Source Control rows first shown: ${FILES.map((f) => `${f} ${clock(seen[f])} (${((seen[f] - mtimes[f]) / 1000).toFixed(2)} s after its last write)`).join(", ")}`);
  const delay = (allSeen - lastWrite) / 1000;
  log(`all three rows listed ${delay.toFixed(2)} s after the agent's last write (bound 4 s): ${delay <= 4 ? "PASS" : "FAIL"}`);
  log(`panel rows now: ${JSON.stringify(await rows())}; git status --porcelain: ${JSON.stringify((await git(ctx.repo, ["status", "--porcelain"])).trim().split("\n"))}`);
  const aDiff = await git(ctx.repo, ["diff", "--stat"]);
  log(`git diff --stat (what the agent's hunks should match): ${one(aDiff)}`);
  if (delay > 4) throw new Error(`Source Control took ${delay.toFixed(2)} s to list the three files`);

  // --- (b) All Changes, Compare = branch base
  await ctx.app.click('button[aria-label="All changes"]');
  await waitFor("the All Changes tab", () => ctx.app.exists('section.pane.editor.all-changes[aria-label="All Changes"]'), 10000);
  await ctx.app.evalJs(`(() => { const s = document.querySelector('select.ac-mode[aria-label="Compare"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "base"); s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await waitFor("Branch vs main", async () => /Branch vs main/.test(await ctx.app.evalJs(`document.querySelector('select.ac-mode')?.selectedOptions[0]?.textContent ?? ""`)), 10000);
  const tabState = () => ctx.app.evalJs(`(() => { const t = document.querySelector("section.pane.editor.all-changes"); return t ? "hidden=" + t.hidden + " sections=" + t.querySelectorAll(".ac-section").length + " | " + t.innerText.split(String.fromCharCode(10)).join(" ").slice(0, 300) : "no tab"; })()`);
  for (let i = 0; i < 8; i++) {
    const have = await sections().catch((e) => `ERR ${e.message}`);
    if (Array.isArray(have) && FILES.every((f) => have.some((s) => s.name === f))) break;
    log(`   (+${i * 3} s) tab: ${await tabState().catch((e) => "ERR " + e.message)}`);
    await sleep(3000);
  }
  await sleep(2500);
  const secs = await sections();
  log(`All Changes (Compare = "Branch vs main") sections: ${JSON.stringify(secs)}`);
  const tabText = one(await ctx.app.evalJs(`document.querySelector('section.pane.editor.all-changes')?.innerText ?? ""`));
  const hunks = { "ALPHA TWO CHANGED": /ALPHA TWO CHANGED/.test(tabText), "beta three": /beta three/.test(tabText), "brand new file": /brand new file/.test(tabText) };
  log(`agent's hunk text visible in the tab: ${JSON.stringify(hunks)}`);
  if (!Object.values(hunks).every(Boolean)) throw new Error("the tab does not show every hunk of the agent");
  const counts = Object.fromEntries(secs.map((s) => [s.name, s.lines]));
  log(`the tab also lists branch.txt (the branch's own commit, measured against main): ${"branch.txt" in counts}`);

  // --- (c) a commit from the All Changes box
  await git(ctx.repo, ["add", "-A"]);
  log("harness ran `git add -A` (staging is not under test; the commit is)");
  await waitFor("Commit 3 staged", () => ctx.app.evalJs(`!![...document.querySelectorAll(".ac-commit-row button")].find((b) => /Commit 3 staged/.test(b.textContent))`), 15000, 300);
  log('button reads "Commit 3 staged" (within the 4 s status re-read)');
  await ctx.app.focusField('section.pane.editor.all-changes [aria-label="Commit message"]');
  await ctx.app.cdp("insert", "Agent edits from the live proof");
  await sleep(500);
  await ctx.app.clickWhere(".ac-commit-row button", "/Commit 3 staged/");
  await waitFor("the commit note", () => ctx.app.evalJs(`/Committed [0-9a-f]+/.test(document.querySelector('section.pane.editor.all-changes .ac-commit-row [role="status"]')?.textContent ?? "")`), 15000, 300);
  log(`note: ${one(await ctx.app.evalJs(`document.querySelector('section.pane.editor.all-changes .ac-commit-row [role="status"]')?.textContent ?? ""`))}`);
  await waitFor("the panel to empty", async () => (await rows()).length === 0, 20000, 300);
  const panelAfter = await rows();
  const statusAfter = (await git(ctx.repo, ["status", "--porcelain"])).trim();
  await sleep(4500);
  const panelCommitted = (await committedRows()).sort();
  log(`after the commit: panel uncommitted rows ${JSON.stringify(panelAfter)}, panel "Committed on this branch" rows ${JSON.stringify(panelCommitted)}, git status --porcelain: ${statusAfter || "(clean)"}`);
  log(`git log -1: ${one(await git(ctx.repo, ["log", "-1", "--stat", "--format=%h %s"]))}`);
  if (statusAfter) throw new Error("git status is not clean after the commit");
  // Base mode still measures against main, so the committed files stay in the tab: it must list exactly what git says differs from main.
  const vsMain = (await git(ctx.repo, ["diff", "--name-only", "main"])).trim().split(/\r?\n/).sort();
  await sleep(4500);
  const tabBase = (await sections()).map((s) => s.name).sort();
  log(`tab (Branch vs main) sections ${JSON.stringify(tabBase)}; git diff --name-only main: ${JSON.stringify(vsMain)}; agree: ${JSON.stringify(tabBase) === JSON.stringify(vsMain)}`);
  log(`panel "Committed on this branch" agrees with git diff --name-only main: ${JSON.stringify(panelCommitted) === JSON.stringify(vsMain)}`);
  if (JSON.stringify(tabBase) !== JSON.stringify(vsMain)) throw new Error("the tab and git disagree about what differs from main");
  await ctx.app.evalJs(`(() => { const s = document.querySelector('select.ac-mode[aria-label="Compare"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "tree"); s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await waitFor("no sections in Working tree mode", async () => (await sections()).length === 0, 15000, 300);
  log("tab with Compare = Working tree: 0 sections (agrees with the clean git status)");

  // --- (d) the watcher's reads
  await sleep(20000);
  const all = statusReads();
  const run = all.filter((t) => t >= sent - 2000 && t <= stop.t + 15000);
  log(`status reads (git status --porcelain=v2 ... -z) the app started: ${all.length} in the whole run, ${all.length - reads0} since the agent's prompt; ${run.length} from the prompt to 15 s after Stop`);
  log(`   start times: ${run.map(clock).join(" ")}`);
  const span = Math.max(60000, run.length ? run[run.length - 1] - run[0] : 0);
  let worst = 0;
  for (const t0 of all) worst = Math.max(worst, all.filter((t) => t >= t0 && t < t0 + 60000).length);
  const rate = (run.length / ((stop.t + 15000 - (sent - 2000)) / 1000)) * 60;
  log(`   rate over the agent window (${((stop.t + 15000 - sent + 2000) / 1000).toFixed(0)} s): ${rate.toFixed(1)} a minute; busiest 60 s window of the whole run: ${worst} reads (bound 15)`);
  log("   the app's only other scm::status caller is a 15 s timer (4 reads a minute at most); it is included in these counts, so the watcher alone is at or below them.");
  if (worst > 15) throw new Error(`the busiest minute had ${worst} status reads`);
  ok = true;
  log("RESULT: three rows listed within 4 s of the agent's last write; All Changes (branch base) shows the three with the agent's hunks; the commit from the All Changes box left panel, tab and git status in agreement; status reads stayed within 15 a minute (real Claude, acceptEdits).");
} catch (e) {
  log(`FAIL: ${e instanceof NeedsLogin ? "NEEDS LOGIN account A: " : ""}${e.message}`);
  try {
    if (ctx) log(`screen at failure:\n${((await ctx.screen()) ?? []).filter((r) => r.trim() && !/^[\s╌─━]+$/.test(r)).slice(0, 30).map((r) => "  | " + r.trim().slice(0, 110)).join("\n")}`);
    if (ctx) log(`events: ${(await ctx.events()).map((x) => x.state).join(" > ")}`);
    if (ctx) log(`commit area at failure: ${one(await ctx.app.evalJs(`(() => { const c = document.querySelector("section.pane.editor.all-changes .ac-commit"); return c ? "msg=[" + (c.querySelector("textarea")?.value ?? "") + "] btn=[" + (c.querySelector("button")?.textContent ?? "") + "] disabled=" + c.querySelector("button")?.disabled + " note=[" + (c.querySelector(".note")?.textContent ?? "") + "]" : "no commit box"; })()`))}`);
    if (ctx) log(`All Changes tab at failure: ${one(await ctx.app.evalJs(`(() => { const t = document.querySelector("section.pane.editor.all-changes"); return t ? "hidden=" + t.hidden + " sections=" + t.querySelectorAll(".ac-section").length + " | " + t.innerText.slice(0, 500) : "no tab"; })()`)).slice(0, 700)}`);
  } catch {}
  process.exitCode = 1;
} finally {
  if (ctx) log(`close: ${JSON.stringify(await ctx.stop().catch((e) => e.message))}`);
  const out = `${ROOT}/evidence/T-033-d.txt`;
  writeFileSync(out, lines.join("\n") + "\n");
  console.log(`evidence written: ${out} (ok=${ok})`);
}
