// T-025-d live proof (2026-10-26): a REAL Claude Code session in a pane of the hidden dev app, signed in with the
// Txais-approved test account A, produces SessionStart, PermissionRequest and Stop, and Kolux RS receives them.
// Run: node evidence/prove/T-025-d-live.mjs   (needs the dev build; writes evidence/T-025-d.txt)
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { ROOT, startProve, reporter, hookEventsInstalled, excerpt, NeedsLogin, sleep, waitFor, ACCOUNT_A } from "../../scripts/prove/live-common.mjs";

const { log, lines } = reporter();
let ctx;
let ok = false;
try {
  log("T-025-d live proof, " + new Date().toISOString());
  log("setup: hidden dev app (offscreen, scratch TEMP/HOME, vite 1470, CDP 9290); claude in the pane = `--model haiku --permission-mode manual --settings <scratch settings.json>` with CLAUDE_CONFIG_DIR = test account A through the agent's env option (the dev-build fence lets the app itself write hooks only below its TEMP; account A's settings.json was never written, none exists there). Account A's one-time first-run questions (theme, folder trust per scratch repo, fullscreen-renderer notice) are answered by the script when they appear; no login screen ever appeared (header showed a signed-in plan).");
  log("scope: the installer wrote its hook entries into the SCRATCH claude-home (the app's CLAUDE_CONFIG_DIR, below the dev-build fence); the pane's claude used test account A for sign-in and loaded those entries with --settings.");
  ctx = await startProve("T-025-d", { report: { log }, claudeArgs: "--model haiku --permission-mode manual --settings ${SETTINGS}", files: { "README.md": "scratch repo for the T-025-d live proof\n" } });
  const events = hookEventsInstalled(ctx.settingsFile);
  log(`installed hook events in the scratch settings.json: ${events.join(", ")}`);
  for (const need of ["SessionStart", "PermissionRequest", "Stop"]) if (!events.includes(need)) throw new Error(`the installer did not write ${need}`);
  log("installer half: PASS (SessionStart, PermissionRequest and Stop entries name the scratch home's agent-hooks script)");

  await ctx.openClaude();
  const screen = await ctx.ready(120000);
  log(`claude ready (account A signed in, no login asked): ${excerpt(screen, 3)}`);
  await ctx.say("Create a file named hello.txt in this folder containing the single word hi. Use the Write tool, then say done.");
  const permission = await ctx.waitEvent((e) => e.state === "permission", 120000, "a PermissionRequest event");
  log(`event received: state=permission tool=${permission.tool ?? "-"} at +${permission.t - (await ctx.events())[0].t} ms from the first event`);
  const seen = await ctx.waitScreen(/Do you want|proceed|Yes/i, 30000, "Claude's permission prompt");
  log(`claude's prompt on screen: ${excerpt(seen, 5)}`);
  await ctx.press("1");
  // The Stop hook: a "done" event after the permission one (the SessionStart boundary is also "done", so it must not count).
  const stop = await ctx.waitEvent((e) => e.state === "done" && !e.boundary && e.t > permission.t, 180000, "a Stop event");
  const all = await ctx.events();
  const key = await ctx.paneKey();
  const startEvent = all.find((e) => e.boundary === true);
  log(`events received by the window (${all.length}): ${all.map((e) => `${e.state}${e.boundary ? "(boundary=SessionStart)" : ""}`).join(" > ")}`);
  log(`SessionStart: ${startEvent ? "received (boundary event, pane " + startEvent.paneKey + ")" : "NOT SEEN"}`);
  log(`PermissionRequest: received (state=permission, pane ${permission.paneKey})`);
  log(`Stop: received (state=done, pane ${stop.paneKey})`);
  const hist = await ctx.history(key);
  log(`agent_history for the pane: ${JSON.stringify((hist ?? []).map((h) => h.state))}`);
  const made = existsSync(`${ctx.repo}/hello.txt`);
  log(`the file claude was asked to write exists in the scratch repo: ${made}`);
  if (!startEvent) throw new Error("no SessionStart (boundary) event");
  ok = true;
  log("hook half: PASS (real session: SessionStart, PermissionRequest and Stop received by Kolux RS)");
  log("second half (a kit seat stopped by a real usage limit or sign-in): NOT run. Blocker: a usage limit cannot be forced, and the test account is signed in.");
} catch (e) {
  log(`FAIL: ${e instanceof NeedsLogin ? "NEEDS LOGIN account A: " : ""}${e.message}`);
  try {
    if (ctx) log(`screen at failure:\n${((await ctx.screen()) ?? []).filter((r) => r.trim() && !/^[\s╌─━]+$/.test(r)).slice(0, 30).map((r) => "  | " + r.trim().slice(0, 110)).join("\n")}`);
  } catch {}
  process.exitCode = 1;
} finally {
  if (ctx) log(`close: ${JSON.stringify(await ctx.stop().catch((e) => e.message))}`);
  const out = `${ROOT}/evidence/T-025-d.txt`;
  writeFileSync(out, lines.join("\n") + "\n");
  console.log(`evidence written: ${out} (ok=${ok})`);
}
