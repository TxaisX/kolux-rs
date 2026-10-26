// T-058-b live proof (2026-10-26): the protected-command ask seen through a REAL Claude Code (haiku) in a pane of the hidden
// dev app, signed in with the Txais-approved test account A. Protected rule: "discard" (Throwing away uncommitted work),
// command `git reset --hard`, run in a throwaway repo with one uncommitted change, so nothing outside the repo is touched.
// Legs: manual permission mode (allow once, then refuse), then `--permission-mode auto`. The permissions-skipped leg is NOT run.
// Run: node evidence/prove/T-058-b-live.mjs   (writes evidence/T-058-b.txt)
import { writeFileSync, readFileSync } from "node:fs";
import { ROOT, ACCOUNT_A, startProve, reporter, excerpt, NeedsLogin, sleep, git } from "../../scripts/prove/live-common.mjs";

const { log, lines } = reporter();
const REASON = "Kolux protected action: Throwing away uncommitted work";
const PROMPT = "Run exactly this shell command with the Bash tool, nothing else, then say done: git reset --hard";
let ctx;
let ok = false;
const results = {};

const dirty = (ctx) => writeFileSync(`${ctx.repo}/notes.txt`, "changed\n");
const notes = (ctx) => readFileSync(`${ctx.repo}/notes.txt`, "utf8").trim();

/** One ask: dirty the file, give the prompt, see whether Claude's prompt carries the Kolux reason, answer, read back the file. */
async function leg(ctx, label, answer) {
  dirty(ctx);
  const since = Date.now();
  log(`-- ${label}: notes.txt dirty ("${notes(ctx)}"), git status: ${(await git(ctx.repo, ["status", "--porcelain"])).trim()}`);
  await ctx.say(PROMPT);
  let asked = false;
  try {
    const t = await ctx.waitScreen(/Kolux protected action/i, 90000, "the Kolux reason in Claude's prompt");
    asked = true;
    const row = t.split("\n").map((r) => r.trim()).find((r) => /Kolux protected action/i.test(r)) ?? "";
    const full = t.split("\n").map((r) => r.trim()).filter((r) => /Kolux protected action|The command waits|allow it once|refuse to leave/i.test(r)).join(" ");
    log(`   ask on screen: yes. Reason text seen: "${full.slice(0, 260)}"`);
    log(`   prompt options: ${excerpt(t, 7)}`);
    if (!full.includes(REASON)) log("   WARNING: the reason text differs from the expected one");
    const now = await ctx.screenText();
    const no = /(\d)\.\s*No\b/.exec(now)?.[1];
    if (answer === "allow") await ctx.press("1");
    else if (no) await ctx.press(no);
    else {
      await ctx.focus();
      await ctx.app.cdp("key", "Escape");
    }
    log(`   answered: ${answer === "allow" ? "1 (Yes, allow once)" : no ? `${no} (No, refuse)` : "Escape (refuse)"}`);
  } catch (e) {
    if (e instanceof NeedsLogin) throw e;
    log(`   ask on screen: NO (${e.message.slice(0, 90)}). Screen: ${excerpt(await ctx.screenText(), 6)}`);
  }
  // Claude finishes (Stop) or has nothing more to do.
  await ctx.waitEvent((e) => e.state === "done" && !e.boundary && e.t > since, 90000, "Stop").catch(() => log("   (no Stop event within 90 s; read the file anyway)"));
  await sleep(1500);
  const after = notes(ctx);
  const status = (await git(ctx.repo, ["status", "--porcelain"])).trim();
  log(`   after: notes.txt = "${after}", git status: ${status || "(clean)"} -> the command ${after === "original" ? "RAN (work thrown away)" : "did NOT run (change kept)"}`);
  return { asked, ran: after === "original" };
}

try {
  log("T-058-b live proof, " + new Date().toISOString());
  log("setup: hidden dev app, scratch repo with notes.txt tracked as 'original' and edited to 'changed' (uncommitted); protectedAsk is the default (on); rule discard = `git reset --hard`; claude --model haiku in test account A.");
  ctx = await startProve("T-058-b", { report: { log }, claudeArgs: "--model haiku --permission-mode manual --settings ${SETTINGS}", files: { "notes.txt": "original\n" } });
  await ctx.openClaude();
  await ctx.ready(120000);
  log("== manual permission mode (--permission-mode manual)");
  results.allow = await leg(ctx, "allow once", "allow");
  results.refuse = await leg(ctx, "refuse", "refuse");

  log("== automatic permission mode (--permission-mode auto)");
  await ctx.app.invoke("settings_patch", { set: { agentOptions: { claude: { env: `CLAUDE_CONFIG_DIR=${ACCOUNT_A}`, args: `--model haiku --permission-mode auto --settings ${ctx.settingsFile}` } } }, remove: [] });
  await ctx.openClaude();
  const t = await ctx.ready(120000);
  log(`   new Claude pane: ${/auto mode on/i.test(t) ? "auto mode on" : excerpt(t, 3)}`);
  results.auto = await leg(ctx, "auto mode", "refuse");

  const m = results;
  if (!m.allow.asked || !m.allow.ran) throw new Error("manual leg: allow once did not show the ask and run the command");
  if (!m.refuse.asked || m.refuse.ran) throw new Error("manual leg: refuse did not show the ask and leave the command unrun");
  ok = true;
  log(`RESULT manual: ask shown with the Kolux reason (allow once ran it, refuse left it unrun). auto mode: ask ${m.auto.asked ? "STILL APPEARS" : "does NOT appear"}${m.auto.asked ? "" : "; command " + (m.auto.ran ? "ran" : "did not run")}.`);
  log("permissions-skipped leg: NOT run (prove-lane policy): stays open.");
} catch (e) {
  log(`FAIL: ${e instanceof NeedsLogin ? "NEEDS LOGIN account A: " : ""}${e.message}`);
  try {
    if (ctx) log(`screen at failure:\n${((await ctx.screen()) ?? []).filter((r) => r.trim() && !/^[\s╌─━]+$/.test(r)).slice(0, 30).map((r) => "  | " + r.trim().slice(0, 110)).join("\n")}`);
  } catch {}
  process.exitCode = 1;
} finally {
  if (ctx) log(`close: ${JSON.stringify(await ctx.stop().catch((e) => e.message))}`);
  const out = `${ROOT}/evidence/T-058-b.txt`;
  writeFileSync(out, lines.join("\n") + "\n");
  console.log(`evidence written: ${out} (ok=${ok})`);
}
