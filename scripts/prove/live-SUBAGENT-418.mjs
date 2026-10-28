// LIVE check after MERGE 418 (cards 44-46, rows 991/1002(a)/1005), real Claude (test account A), ONE session, four asks:
// (A) a SUB-AGENT's Bash permission prompt, Deny from the Board card; (B) another sub-agent prompt, an Esc byte written to the pane's pty
// (terminal_write, what the CLI interrupt does); (C) a plain prompt, the same Esc byte; (D) a plain prompt, the chat card's Deny.
// Pass for each = within 6 s the pane word is out of Permission and not Working (Interrupted/Idle), still so at 12 s.
// Asserted on Kolux's own readings only. Also logs the count of hook lines in kolux.log before/after each Esc.
import { existsSync } from "node:fs";
import { scenario, send, boardChip, clickChipButton, paneWord, goScreen, sleep, waitFor } from "./live-claude-common.mjs";
import { trustLogLines } from "./live-trust-common.mjs";

const BAD = /permission|needs you|working|asking|question/i;
const LIMIT = 6000;

await scenario("SUBAGENT-418", { cards: ["VIEW-025"], settings: { uiLook: "new" } }, async (ctx, h) => {
  const { app } = ctx;
  const brief = (e) => JSON.stringify(e).slice(0, 260);
  const hookCount = () => trustLogLines(ctx.TEMP, 5000, /hook|agent-status|permission/i).length;
  const sample = async (t0, read, ms = 12000) => {
    const out = [];
    while (Date.now() - t0 < ms) {
      const w = await read();
      if (out[out.length - 1]?.w !== w) out.push({ ms: Date.now() - t0, w });
      await sleep(250);
    }
    return out;
  };
  const at = (s, ms) => [...s].reverse().find((x) => x.ms <= ms)?.w ?? s[0]?.w;
  const verdict = (name, s) => {
    h.log(`${name}: ${s.map((x) => `${x.ms}ms ${x.w}`).join(" > ")}`);
    const w6 = at(s, LIMIT);
    const w12 = at(s, 12000);
    h.check(`${name}: at ${LIMIT} ms out of Permission and not Working`, !!w6 && !BAD.test(w6), `at 6 s: ${w6}`);
    h.check(`${name}: still not Permission/Working at 12 s`, !!w12 && !BAD.test(w12), `at 12 s: ${w12}`);
  };
  const backToPrompt = async () => {
    await goScreen(app, "Terminals");
    await sleep(3000);
    await ctx.ready().catch(() => null);
  };
  // The agent's pty id is the `terminal` of its hook events (the dev app has no background service, so terminal_host_sessions is empty).
  const writeEsc = async () => {
    const info = await app.invoke("terminal_service_info", {});
    const ev = [...(await ctx.events())].reverse().find((e) => e.terminal != null);
    h.log(`terminal_write target: id ${ev?.terminal} generation ${info?.generation}`);
    await app.invoke("terminal_write", { id: ev.terminal, data: "", generation: info?.generation ?? null });
  };
  const waitPerm = (after, what) => ctx.waitEvent((e) => e.t >= after && e.state === "permission", 90000, what);
  const askPlain = async (file) => {
    const t = await send(ctx, `Use the Bash tool to run exactly this command: touch ${file} . Then reply with the word done.`);
    const p = await waitPerm(t, `a permission event for ${file}`);
    h.log(`ask ${file}: permission event ${brief(p)}`);
    return p;
  };
  const askSub = async (file) => {
    const t = await send(ctx, `Use the Task tool to start exactly one sub-agent. Tell that sub-agent to use the Bash tool to run exactly this command: touch ${file} . When it is done, reply with the word done.`);
    let p = await waitPerm(t, `a permission event for the sub-agent (${file})`);
    h.log(`ask ${file}: first permission event ${brief(p)}`);
    // The main agent may ask about the Task tool itself first; approve that one so the next prompt is the sub-agent's.
    for (let i = 0; i < 2 && /^(task|agent)$/i.test(String(p.tool ?? "")); i++) {
      await goScreen(app, "Board");
      await waitFor("the Board card buttons", async () => ((await boardChip(app))?.buttons?.includes("Approve") ? true : null), 20000, 500);
      await clickChipButton(app, "Approve");
      const after = Date.now();
      p = await waitPerm(after, `the sub-agent's own permission event (${file})`);
      h.log(`ask ${file}: next permission event ${brief(p)}`);
    }
    return p;
  };

  // ---- (A) sub-agent prompt, Board Deny ----
  const pa = await askSub("s1.txt");
  await goScreen(app, "Board");
  const c1 = await waitFor("the Board card with its buttons", async () => { const c = await boardChip(app); return c?.buttons?.length ? c : null; }, 20000, 500);
  h.log(`(A) Board card before: ${JSON.stringify(c1)}; event tool ${pa.tool}`);
  h.log(`(A) screenshot before: ${await h.shot("a-before")}`);
  const ta = Date.now();
  h.check("(A) Deny clicked on the card", await clickChipButton(app, "Deny"), "button found");
  verdict("(A) sub-agent prompt, Board Deny, card word", await sample(ta, async () => (await boardChip(app))?.word ?? null));
  h.log(`(A) screenshot after: ${await h.shot("a-after")}`);
  h.check("(A) the command did not run (s1.txt missing)", !existsSync(`${ctx.repo}/s1.txt`), "");

  // ---- (B) sub-agent prompt, Esc byte to the pty ----
  await backToPrompt();
  await askSub("s2.txt");
  await goScreen(app, "Terminals");
  await ctx.waitScreen(/Esc to cancel|Esc to/i, 30000, "the permission menu on the screen").catch(() => h.log("(B) menu text not seen"));
  await sleep(500);
  const hb0 = hookCount();
  const tb = Date.now();
  await writeEsc();
  verdict("(B) sub-agent prompt, Esc byte, pane word", await sample(tb, () => paneWord(app)));
  h.log(`(B) hook/permission lines in kolux.log: before ${hb0}, after ${hookCount()}`);
  h.log(`(B) screenshot: ${await h.shot("b-after")}`);
  h.check("(B) the command did not run (s2.txt missing)", !existsSync(`${ctx.repo}/s2.txt`), "");

  // ---- (C) plain prompt, Esc byte to the pty (row 992 without the keyboard path) ----
  await backToPrompt();
  await askPlain("c.txt");
  await goScreen(app, "Terminals");
  await ctx.waitScreen(/Esc to cancel/i, 30000, "the permission menu on the screen").catch(() => h.log("(C) menu text not seen"));
  await sleep(500);
  const hc0 = hookCount();
  const tc = Date.now();
  await writeEsc();
  verdict("(C) plain prompt, Esc byte, pane word", await sample(tc, () => paneWord(app)));
  h.log(`(C) hook/permission lines in kolux.log: before ${hc0}, after ${hookCount()}`);
  h.check("(C) the command did not run (c.txt missing)", !existsSync(`${ctx.repo}/c.txt`), "");

  // ---- (D) plain prompt, the chat card's Deny ----
  await backToPrompt();
  await askPlain("d.txt");
  await goScreen(app, "Agents");
  const card = await waitFor("the chat permission card", async () => ((await app.evalJs(`!!document.querySelector(".chat-permission .deny")`)) ? true : null), 25000, 500).catch(() => null);
  h.log(`(D) chat permission card shown: ${!!card}`);
  h.check("(D) the chat shows the permission card with Deny", !!card, "");
  if (card) {
    const td = Date.now();
    await app.evalJs(`(() => { document.querySelector(".chat-permission .deny").click(); return true; })()`);
    const gone = await waitFor("the chat card to go", async () => ((await app.evalJs(`!document.querySelector(".chat-permission")`)) ? true : null), 15000, 100).catch(() => null);
    h.log(`(D) chat card gone after ${gone ? Date.now() - td : "never"} ms`);
    await goScreen(app, "Terminals");
    verdict("(D) chat Deny, pane word", await sample(td, () => paneWord(app)));
    h.check("(D) the command did not run (d.txt missing)", !existsSync(`${ctx.repo}/d.txt`), "");
  }
  h.log(`events: ${(await ctx.events()).map((e) => `${e.state}${e.tool ? `/${e.tool}` : ""}`).join(" > ").slice(0, 600)}`);
  h.log(`screenshot: ${await h.shot("end")}`);
});
