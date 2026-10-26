// T-032-c live proof (2026-10-26): a REAL Claude Code (haiku, --permission-mode plan) in a pane of the hidden dev app,
// signed in with the Txais-approved test account A. Request changes from the plan review sheet brings back a revised plan;
// Approve from the sheet starts the work.
// Run: node evidence/prove/T-032-c-live.mjs   (writes evidence/T-032-c.txt)
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { ROOT, startProve, reporter, excerpt, NeedsLogin, sleep, waitFor } from "../../scripts/prove/live-common.mjs";

const { log, lines } = reporter();
const SHEET = "aside.plan-sheet";
let ctx;
let ok = false;
const one = (s) => (s ?? "").replace(/\s+/g, " ").trim();

async function openSheet() {
  await waitFor("the Review plan button", () => ctx.app.exists("button.plan-review-btn"), 30000, 500);
  await ctx.app.click("button.plan-review-btn");
  await waitFor("the plan sheet", () => ctx.app.exists(SHEET), 10000, 300);
}
const sheetText = () => ctx.app.evalJs(`document.querySelector(${JSON.stringify(SHEET)})?.innerText ?? ""`);

try {
  log("T-032-c live proof, " + new Date().toISOString());
  log("setup: hidden dev app, scratch repo, claude --model haiku --permission-mode plan in test account A (the app's own hook installer wrote the hooks into the scratch claude-home; the pane loads them with --settings).");
  ctx = await startProve("T-032-c", { report: { log }, claudeArgs: "--model haiku --permission-mode plan --settings ${SETTINGS}", files: { "README.md": "scratch repo for the T-032-c live proof\n" } });
  await ctx.openClaude();
  const first = await ctx.ready(120000);
  log(`claude ready: ${/plan mode on/i.test(first) ? "plan mode on" : excerpt(first, 3)}`);

  await ctx.say("Plan how to add a file greeting.txt containing the single word hello. Keep the plan to three short lines, then present it for approval.");
  const p1 = await ctx.waitEvent((e) => e.state === "permission" && one(e.plan).length > 0, 180000, "the first plan (a permission event carrying the plan text)");
  log(`plan 1 received: ${one(p1.plan).length} characters, cut=${!!p1.planCut}, tool=${p1.tool ?? "-"}`);
  await openSheet();
  const s1 = await sheetText();
  log(`plan sheet opened (Review plan button): ${one(s1).slice(0, 230)}`);

  // --- Request changes
  const asked = Date.now();
  await ctx.app.focusField('textarea[aria-label="Overall feedback"]');
  await ctx.app.cdp("insert", "Also add a second line to greeting.txt: the word bye. Update the plan to say so.");
  await sleep(500);
  await ctx.app.clickWhere(`${SHEET} button`, "/^\\s*Request changes/");
  log("clicked Request changes with one overall note");
  const p2 = await ctx.waitEvent((e) => e.state === "permission" && e.t > asked && one(e.plan).length > 0 && one(e.plan) !== one(p1.plan), 180000, "a revised plan");
  log(`revised plan received: ${one(p2.plan).length} characters; differs from plan 1: ${one(p2.plan) !== one(p1.plan)}; mentions bye: ${/bye/i.test(p2.plan)}`);
  log(`revised plan excerpt: ${one(p2.plan).slice(0, 220)}`);

  // --- Approve
  await sleep(1500);
  const sheetOpen = await ctx.app.exists(SHEET);
  if (!sheetOpen) await openSheet();
  const s2 = await sheetText();
  log(`sheet now shows the revised plan: ${/bye/i.test(s2)}`);
  const approvedAt = Date.now();
  await ctx.app.clickWhere(`${SHEET} button`, "/^\\s*Approve\\s*$/");
  log("clicked Approve");
  await ctx.waitEvent((e) => e.state === "working" && e.t > approvedAt, 60000, "a working event after Approve");
  log("work started: a working event arrived after Approve");
  // Plan mode ends with the approval; Claude may still ask once for the write.
  const end = Date.now() + 150000;
  let allowed = 0;
  while (Date.now() < end && !existsSync(`${ctx.repo}/greeting.txt`)) {
    const t = await ctx.screenText();
    if (/Do you want to (create|make|proceed)|1\. Yes/i.test(t) && allowed < 3) {
      allowed += 1;
      log(`   Claude asks about the write; allowed with 1 (${allowed})`);
      await ctx.press("1");
    }
    await sleep(2000);
  }
  const made = existsSync(`${ctx.repo}/greeting.txt`);
  log(`greeting.txt created after Approve: ${made}${made ? `, ${readFileSync(`${ctx.repo}/greeting.txt`, "utf8").trim().split(/\s+/).length} word(s)` : ""}`);
  if (!made) throw new Error("the work did not start: no greeting.txt after Approve");
  ok = true;
  log("RESULT: Request changes brought back a revised plan; Approve started the work (real Claude, plan mode).");
} catch (e) {
  log(`FAIL: ${e instanceof NeedsLogin ? "NEEDS LOGIN account A: " : ""}${e.message}`);
  try {
    if (ctx) log(`screen at failure:\n${((await ctx.screen()) ?? []).filter((r) => r.trim() && !/^[\s╌─━]+$/.test(r)).slice(0, 30).map((r) => "  | " + r.trim().slice(0, 110)).join("\n")}`);
    if (ctx) log(`events: ${(await ctx.events()).map((x) => x.state).join(" > ")}`);
  } catch {}
  process.exitCode = 1;
} finally {
  if (ctx) log(`close: ${JSON.stringify(await ctx.stop().catch((e) => e.message))}`);
  const out = `${ROOT}/evidence/T-032-c.txt`;
  writeFileSync(out, lines.join("\n") + "\n");
  console.log(`evidence written: ${out} (ok=${ok})`);
}
