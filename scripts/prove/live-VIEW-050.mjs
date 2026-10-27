// LIVE proof, VIEW-050 box 1 (spec/05): close the left sidebar with Mod+B (Ctrl+B) -> the first tab is still fully visible
// (not clipped, not under the sidebar toggle or the back button); Ctrl+B again brings the sidebar back.
// usage: node live-VIEW-050.mjs [classic]   (default: New look). Hidden app, two tabs, over CDP.
import { reporter, startPlain, finish, sleep, waitFor, TERM, snap, checker } from "./live-views-dom.mjs";

const look = process.argv[2] === "classic" ? "classic" : "new";
const rep = reporter();
const { log, lines: ev } = rep;
const { check, allPassed } = checker(log);
let ctx;
let ok = false;
try {
  ctx = await startPlain(`VIEW-050-${look}`, { report: rep, settings: { uiLook: look } });
  const { app } = ctx;
  await sleep(3000);
  await app.focusPane(TERM, 0, ".xterm-helper-textarea");
  if ((await app.evalJs(`document.querySelectorAll(".tab[role='tab']").length`)) < 2) {
    await app.cdp("key", "t", "2"); // Ctrl+T: a second terminal tab
    await waitFor("two tabs", async () => (await app.evalJs(`[...document.querySelectorAll(".tab[role='tab']")].filter((e) => e.offsetParent !== null).length`)) >= 2, 20000, 500);
  }
  await sleep(2500);
  const read = () =>
    app.evalJs(`(() => {
      const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
      const vis = (e) => e && e.offsetParent !== null;
      const tabs = [...document.querySelectorAll(".tab[role='tab']")].filter(vis);
      const first = tabs[0];
      const strip = first ? first.closest(".tabs") : null;
      const btns = ["button.ib.back", "button.ib.fwd", "button.ib.panel"].map((s) => ({ s, rect: r(document.querySelector(s)) })).filter((x) => x.rect && x.rect.w > 0);
      const f = r(first);
      const hits = btns.filter((x) => f && f.l < x.rect.r && f.r > x.rect.l && f.t < x.rect.b && f.b > x.rect.t).map((x) => x.s);
      const labelClipped = first ? [...first.querySelectorAll("*")].some((n) => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflow !== "visible" && n.textContent.trim().length > 0 && n.clientWidth < 12) : null;
      return { look: ${JSON.stringify(look)}, tabCount: tabs.length, first: f, text: first ? first.textContent.trim().slice(0, 30) : null, strip: r(strip), stripScroll: strip ? { sl: strip.scrollLeft, sw: strip.scrollWidth, cw: strip.clientWidth } : null, viewport: { w: innerWidth, h: innerHeight }, overlapsButtons: hits, btns, labelClipped };
    })()`);
  const fully = (s) => s.first && s.strip && s.first.l >= 0 && s.first.t >= 0 && s.first.r <= s.viewport.w && s.first.b <= s.viewport.h && s.first.l >= s.strip.l - 1 && s.first.r <= s.strip.r + 1 && s.first.w >= 40 && s.overlapsButtons.length === 0 && !s.labelClipped;

  const open0 = await snap(app);
  const a = await read();
  log(`sidebar open (${look}): worktreeSidebar ${open0.worktreeSidebar}; ${JSON.stringify(a)}`);
  check("setup: the worktree sidebar is open and there are two tabs", open0.worktreeSidebar && a.tabCount >= 2, JSON.stringify({ sidebar: open0.worktreeSidebar, tabs: a.tabCount }));
  check("setup: with the sidebar open the first tab is fully visible (the reading is sound)", fully(a), JSON.stringify({ first: a.first, strip: a.strip, hits: a.overlapsButtons }));
  log(`screenshot: ${await ctx.shot(`VIEW-050-${look}-open`)}`);

  await app.focusPane(TERM, 0, ".xterm-helper-textarea");
  await app.cdp("key", "b", "2"); // Ctrl+B
  await sleep(1500);
  const closed = await snap(app);
  const b = await read();
  log(`after Ctrl+B (${look}): worktreeSidebar ${closed.worktreeSidebar}; ${JSON.stringify(b)}`);
  check("Ctrl+B closed the sidebar", !closed.worktreeSidebar, JSON.stringify({ worktreeSidebar: closed.worktreeSidebar }));
  check("with the sidebar closed the first tab is still fully visible (inside the window and its strip, wide enough, not under the toggle or back button)", fully(b), JSON.stringify({ first: b.first, strip: b.strip, hits: b.overlapsButtons, viewport: b.viewport, labelClipped: b.labelClipped }));
  log(`screenshot: ${await ctx.shot(`VIEW-050-${look}-closed`)}`);

  await app.cdp("key", "b", "2");
  await sleep(1500);
  const again = await snap(app);
  const c = await read();
  log(`after Ctrl+B again: worktreeSidebar ${again.worktreeSidebar}; first tab ${JSON.stringify(c.first)}`);
  check("Ctrl+B again brings the sidebar back and the first tab is still fully visible", again.worktreeSidebar && fully(c), JSON.stringify({ worktreeSidebar: again.worktreeSidebar, first: c.first }));
  ok = allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, `VIEW-050-${look}`, ev, ok) : 1);
