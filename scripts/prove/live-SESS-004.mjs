// LIVE proof, SESS-004 box 1 (spec/02): the pane header's plus, then Claude Code -> a new pane appears with Claude Code running in it.
// Claude is a stand-in claude.cmd on PATH (banner + argv + folder), so no agent is signed in and nothing leaves the PC.
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, STANDIN_BODY, STANDIN_BANNER, CLAUDE_PANE, panes, tabLabels } from "./live-proj-common.mjs";

export const PLUS = 'section.pane[data-agent] button.ib[title^="New session"]';

export async function run004(ctx, { check, log }) {
  const { app } = ctx;
  const before = await panes(app);
  log(`panes before: ${JSON.stringify(before)} tabs ${JSON.stringify(await tabLabels(app))}`);
  await app.evalJs(`document.querySelector(${JSON.stringify(PLUS)}).click()`);
  const menu = await poll(() => app.evalJs(`(() => { const m = document.querySelector('[role=menu][aria-label="New session"]'); return m ? [...m.querySelectorAll('[role=menuitem]')].map(b => b.textContent.trim().replace(/\\s+/g, " ")) : null; })()`), 8000, 300);
  log(`plus menu items: ${JSON.stringify(menu)}`);
  check("the plus menu opens and lists Claude Code", Array.isArray(menu) && menu.some((t) => /^Claude Code/.test(t)), JSON.stringify(menu?.slice(0, 6)));
  await app.clickWhere('[role=menu][aria-label="New session"] [role=menuitem]', "/^\\s*Claude Code/");
  const claude = await poll(async () => ((await app.shown(CLAUDE_PANE)) >= 1 ? true : null), 20000, 400);
  const afterPanes = await panes(app);
  log(`panes after: ${JSON.stringify(afterPanes)} tabs ${JSON.stringify(await tabLabels(app))}`);
  check("a new pane appeared (pane count +1, hidden ones included)", afterPanes.length === before.length + 1, `${before.length} -> ${afterPanes.length}`);
  check("the new pane is a Claude Code pane", !!claude, `data-agent values ${JSON.stringify(afterPanes.map((p) => p.agent))}`);
  const text = await poll(async () => {
    const t = await ctx.text(0, CLAUDE_PANE);
    return t && t.includes(STANDIN_BANNER) ? t : null;
  }, 20000, 500);
  const rows = (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  log(`claude pane text: ${JSON.stringify(rows.slice(0, 6))}`);
  check("Claude Code is running in that pane (the stand-in's banner is in its terminal)", !!text, rows.slice(0, 3).join(" | ").slice(0, 200));
  log(`screenshot: ${await ctx.shot("SESS-004")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("SESS-004", { report: rep, standin: STANDIN_BODY });
    await sleep(3000);
    await run004(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, "SESS-004", ev, ok) : 1);
}
