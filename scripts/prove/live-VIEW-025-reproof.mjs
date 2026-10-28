// LIVE re-proof, VIEW-025 boxes 1+2 and row 992 (MERGE 413), real Claude (test account A), ONE session, three asks at a permission prompt:
// (a) Deny from the Board card, (b) Esc typed straight into the pane, (c) the chat card's Deny (Agents screen).
// Pass for each = within ~6 s the pane leaves Permission (Interrupted/Idle/Done, not Working, not Permission). Asserted on Kolux's own readings only.
import { existsSync } from "node:fs";
import { scenario, send, boardChip, clickChipButton, paneWord, goScreen, sleep, waitFor, excerpt } from "./live-claude-common.mjs";

const BAD = /permission|needs you|working|asking|question/i;
const LIMIT = 6000;

await scenario("VIEW-025-12b", { cards: ["VIEW-025"], settings: { uiLook: "new" } }, async (ctx, h) => {
  const { app } = ctx;
  const waitPerm = (after, what) => ctx.waitEvent((e) => e.t >= after && e.state === "permission", 90000, what);
  const ask = async (file) => {
    const t = await send(ctx, `Use the Bash tool to run exactly this command: touch ${file} . Then reply with the word done.`);
    const p = await waitPerm(t, `a permission event for ${file}`);
    h.log(`ask ${file}: permission event tool=${p.tool} ${p.t - t} ms after the prompt`);
    return p;
  };
  // Samples a reading every ~250 ms for ms; returns [{ms, w}] (changes only) so the log stays short.
  const sample = async (t0, read, ms = 12000) => {
    const out = [];
    while (Date.now() - t0 < ms) {
      const w = await read();
      if (out[out.length - 1]?.w !== w) out.push({ ms: Date.now() - t0, w });
      await sleep(250);
    }
    return out;
  };
  const at = (s, ms) => [...s].reverse().find((x) => x.ms <= ms)?.w ?? s[0]?.w; // the reading in force at ms
  const verdict = (name, s) => {
    const seq = s.map((x) => `${x.ms}ms ${x.w}`).join(" > ");
    h.log(`${name}: ${seq}`);
    const w6 = at(s, LIMIT);
    const w12 = at(s, 12000);
    h.check(`${name}: at ${LIMIT} ms the pane is out of Permission and not Working`, !!w6 && !BAD.test(w6), `at ${LIMIT} ms: ${w6}`);
    h.check(`${name}: still not Permission/Working at 12 s`, !!w12 && !BAD.test(w12), `at 12 s: ${w12}`);
  };
  const backToPrompt = async () => {
    await goScreen(app, "Terminals");
    await sleep(3000);
    await ctx.ready().catch(() => null);
  };

  // ---- (a) Deny from the Board card ----
  await ask("a.txt");
  await goScreen(app, "Board");
  const c1 = await waitFor("the Board card with its buttons", async () => {
    const c = await boardChip(app);
    return c?.buttons?.length ? c : null;
  }, 20000, 500);
  h.log(`(a) Board card before: ${JSON.stringify(c1)}`);
  h.check("(a) the card says Needs you with Approve and Deny", c1.word === "Needs you" && c1.buttons.includes("Deny"), JSON.stringify(c1));
  const ta = Date.now();
  h.check("(a) Deny clicked on the card", await clickChipButton(app, "Deny"), "button found");
  verdict("(a) Board Deny, card word", await sample(ta, async () => (await boardChip(app))?.word ?? null));
  h.log(`(a) screenshot: ${await h.shot("a-board")}`);
  h.check("(a) the command did not run (a.txt missing)", !existsSync(`${ctx.repo}/a.txt`), "");

  // ---- (b) Esc typed straight into the pane ----
  await backToPrompt();
  await ask("b.txt");
  // The hook event fires before Claude draws the menu; an Esc sent that early is dropped (first run), so wait for the menu a user would see.
  await ctx.waitScreen(/Esc to cancel/i, 30000, "the permission menu on the screen");
  await sleep(500);
  await ctx.focus();
  const tb = Date.now();
  await app.cdp("key", "Escape");
  verdict("(b) typed Esc, pane word", await sample(tb, () => paneWord(app)));
  h.log(`(b) screen after: ${excerpt(await ctx.screenText(), 5)}`);
  h.check("(b) the command did not run (b.txt missing)", !existsSync(`${ctx.repo}/b.txt`), "");

  // ---- (c) the chat card's Deny (Agents screen) ----
  await backToPrompt();
  await ask("c.txt");
  await goScreen(app, "Agents");
  const card = await waitFor("the chat permission card", async () => ((await app.evalJs(`!!document.querySelector(".chat-permission .deny")`)) ? true : null), 25000, 500).catch(() => null);
  h.log(`(c) chat permission card shown: ${!!card}`);
  h.log(`(c) screenshot: ${await h.shot("c-chat-before")}`);
  h.check("(c) the chat shows the permission card with Deny", !!card, "");
  if (card) {
    const tc = Date.now();
    await app.evalJs(`(() => { document.querySelector(".chat-permission .deny").click(); return true; })()`);
    const gone = await waitFor("the chat card to go", async () => ((await app.evalJs(`!document.querySelector(".chat-permission")`)) ? true : null), 15000, 100).catch(() => null);
    h.log(`(c) chat card gone after ${gone ? Date.now() - tc : "never"} ms`);
    await goScreen(app, "Terminals");
    verdict("(c) chat Deny, pane word", await sample(tc, () => paneWord(app)));
    h.check("(c) the command did not run (c.txt missing)", !existsSync(`${ctx.repo}/c.txt`), "");
  }
  h.log(`events: ${(await ctx.events()).map((e) => `${e.state}${e.tool ? `/${e.tool}` : ""}`).join(" > ").slice(0, 400)}`);
  h.log(`screenshot: ${await h.shot("end")}`);
});
