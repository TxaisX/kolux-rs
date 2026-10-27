// LIVE proof, VIEW-004 box 1 (spec/05): New look: Agents and Board show no worktree list; Terminals shows it.
// Also a control for VIEW-002: the cycle chord (Ctrl+Alt+V) does move the screen in the New look, so "nothing changes" in
// Classic is not just an undelivered key. Hidden app, over CDP.
import { reporter, startPlain, finish, sleep, snap, pickScreen, checker } from "./live-views-dom.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const { check, allPassed } = checker(log);
let ctx;
let ok = false;
try {
  ctx = await startPlain("VIEW-004", { report: rep });
  const { app } = ctx;
  await sleep(3000);
  for (const label of ["Agents", "Board", "Terminals", "Board", "Terminals"]) {
    await pickScreen(app, label);
    await sleep(1200);
    const s = await snap(app);
    log(`${label}: ${JSON.stringify(s)}`);
    if (label === "Terminals") check("Terminals shows the worktree list", s.worktreeSidebar && s.pressed[0] === "Terminals", JSON.stringify({ worktreeSidebar: s.worktreeSidebar, pressed: s.pressed }));
    else check(`${label} shows no worktree list`, !s.worktreeSidebar && s.pressed[0] === label, JSON.stringify({ worktreeSidebar: s.worktreeSidebar, pressed: s.pressed, rail: s.rail }));
  }
  log(`screenshot: ${await ctx.shot("VIEW-004-terminals")}`);
  await pickScreen(app, "Board");
  await sleep(800);
  log(`screenshot: ${await ctx.shot("VIEW-004-board")}`);
  // The sidebar is hidden, not torn down: the workbench behind it is still running (rule of the card).
  const pids = await ctx.shellPids();
  await pickScreen(app, "Terminals");
  await sleep(1200);
  const pids2 = await ctx.shellPids();
  check("rule: the shell kept running behind the hidden sidebar (same shell pids)", pids.length > 0 && pids.join() === pids2.join(), `${pids.join()} -> ${pids2.join()}`);

  // Control for VIEW-002: the chord cycles the screen in the New look.
  await pickScreen(app, "Agents");
  await sleep(800);
  const seen = [];
  await app.evalJs(`document.activeElement && document.activeElement.blur && document.activeElement.blur()`);
  for (let i = 0; i < 4; i++) {
    await app.cdp("key", "v", "3");
    await sleep(900);
    seen.push((await snap(app)).pressed.join("+"));
  }
  log(`chord control, from Agents, four presses: ${seen.join(" -> ")}`);
  check("control: in the New look the chord moves the highlighted screen on every press", new Set(seen).size >= 3 && seen.every((x, i) => x !== (i ? seen[i - 1] : "Agents")), seen.join(" -> "));
  ok = allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "VIEW-004", ev, ok) : 1);
