// LIVE proof, TERM-028 box 2 (spec/03): in the clean look, a session group holding one tab shows no tab strip.
// Hidden app on the New (clean) look, one workspace with one shell: no tab strip in its cell; a second tab brings the strip;
// switching to Classic shows the strip with a single tab.
import { reporter, startPlain, finish, sleep, waitFor, TERM } from "./live-common.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
let ctx;
let ok = false;
const asserts = [];
const check = (name, pass, detail) => {
  asserts.push(pass);
  log(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
const STRIP = '.cell .tabs[role="tablist"][aria-label="Tabs"]';
try {
  ctx = await startPlain("TERM-028", { report: rep });
  const { app } = ctx;
  await sleep(3000);
  const look = (await app.invoke("get_settings"))?.uiLook;
  log(`settings uiLook = ${look}`);
  const cells = () => app.evalJs(`[...document.querySelectorAll(".cell")].filter(c => c.offsetParent !== null).map(c => ({ panes: c.querySelectorAll("section.pane[data-agent]").length, strips: c.querySelectorAll('.tabs[role="tablist"][aria-label="Tabs"]').length, tabs: c.querySelectorAll('.tabs [role="tab"]').length }))`);
  const one = await cells();
  log(`New look, one tab: cells ${JSON.stringify(one)}`);
  check("New look: one visible cell with one pane and NO tab strip", one.length === 1 && one[0].panes === 1 && one[0].strips === 0, JSON.stringify(one));
  await ctx.shot("TERM-028-one-tab-clean");

  // A second tab in the same cell: Ctrl+T.
  await app.focusPane(TERM, 0, ".xterm-helper-textarea");
  await app.cdp("key", "t", "2");
  await waitFor("a second pane in the cell", async () => (await app.count(TERM)) === 2, 30000, 250);
  await sleep(1500);
  const two = await cells();
  log(`New look, two tabs: cells ${JSON.stringify(two)}`);
  check("New look: with two tabs the strip appears (2 tabs)", two.length === 1 && two[0].strips === 1 && two[0].tabs === 2, JSON.stringify(two));
  await ctx.shot("TERM-028-two-tabs-clean");

  // Back to one tab: close the second tab, the strip goes again.
  const closed = await app.evalJs(`(() => { const t = [...document.querySelectorAll('.cell .tabs [role="tab"]')]; const b = t.at(-1)?.querySelector('button[aria-label^="Close"], button[title^="Close"]'); if (!b) return "no close button"; b.click(); return "clicked"; })()`);
  log(`close the second tab: ${closed}`);
  if (closed === "clicked") {
    await waitFor("one pane again", async () => (await app.count(TERM)) === 1, 15000, 250).catch(() => {});
    await sleep(1500);
    const back = await cells();
    log(`New look, back to one tab: cells ${JSON.stringify(back)}`);
    check("New look: back to one tab the strip is gone again", back.length === 1 && back[0].strips === 0, JSON.stringify(back));
  }

  // Classic: the strip shows even for one tab.
  await app.invoke("settings_patch", { set: { uiLook: "classic" }, remove: [] });
  await sleep(2500);
  const classic = await cells();
  log(`Classic look: cells ${JSON.stringify(classic)}`);
  check("Classic look: the strip shows with a single tab", classic.length >= 1 && classic[0].strips === 1 && classic[0].tabs >= 1, JSON.stringify(classic));
  log(`screenshot: ${await ctx.shot("TERM-028-classic")}`);
  ok = asserts.every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "TERM-028", ev, ok) : 1);
