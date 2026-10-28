// LIVE proof, VIEW-025 boxes 1 and 2 (spec/05): on the Board, a real Claude that asks to run a command shows Approve and Deny on its card;
// Approve -> the command runs (file made); Deny -> the command does not run, the card leaves needs-you. One session, two asks.
// Asserted on Kolux's side: chip word/buttons in the DOM, agent-status events, and the files the command would write.
import { existsSync } from "node:fs";
import { scenario, send, boardChip, clickChipButton, paneWord, goScreen, sleep, waitFor, excerpt } from "./live-claude-common.mjs";

await scenario("VIEW-025", { cards: ["VIEW-025"], settings: { uiLook: "new" } }, async (ctx, h) => {
  const waitState = (state, after, what, ms = 90000) => ctx.waitEvent((e) => e.t >= after && e.state === state, ms, what);

  // ---- box 1: approve ----
  let t = await send(ctx, "Use the Bash tool to run exactly this command: touch approved.txt . Then reply with the word done.");
  const perm1 = await waitState("permission", t, "a permission event for the first ask");
  h.log(`ask 1: permission event tool=${perm1.tool} ${perm1.t - t} ms after the prompt`);
  await goScreen(ctx.app, "Board");
  const c1 = await waitFor("the Board card with its buttons", async () => {
    const c = await boardChip(ctx.app);
    return c?.buttons?.length ? c : null;
  }, 20000, 500);
  h.log(`Board card: ${JSON.stringify(c1)}`);
  h.log(`screenshot: ${await h.shot("board-ask1")}`);
  h.check("box 1: the card says Needs you and shows both Approve and Deny", c1.word === "Needs you" && c1.buttons.includes("Approve") && c1.buttons.includes("Deny"), JSON.stringify(c1));
  const tApprove = Date.now();
  h.check("box 1: Approve clicked on the card", await clickChipButton(ctx.app, "Approve"), "button found");
  const w1 = await waitState("working", tApprove, "working after Approve");
  const d1 = await waitState("done", tApprove, "done after Approve");
  const made = existsSync(`${ctx.repo}/approved.txt`);
  const c1b = await boardChip(ctx.app);
  h.log(`after Approve: working ${w1.t - tApprove} ms, done ${d1.t - tApprove} ms; card ${JSON.stringify(c1b)}`);
  h.check("box 1: the agent proceeded (the command ran: approved.txt exists)", made, `approved.txt ${made ? "exists" : "missing"}`);
  h.check("box 1: the card left needs-you", c1b?.word !== "Needs you" && !c1b?.buttons?.length, JSON.stringify(c1b));

  // ---- box 2: deny ----
  await goScreen(ctx.app, "Terminals");
  await sleep(1500);
  t = await send(ctx, "Use the Bash tool to run exactly this command: touch denied.txt . Then reply with the word done.");
  const perm2 = await waitState("permission", t, "a permission event for the second ask");
  h.log(`ask 2: permission event tool=${perm2.tool} ${perm2.t - t} ms after the prompt`);
  await goScreen(ctx.app, "Board");
  const c2 = await waitFor("the Board card with its buttons (ask 2)", async () => {
    const c = await boardChip(ctx.app);
    return c?.buttons?.length ? c : null;
  }, 20000, 500);
  h.check("box 2: the card shows Deny (and Approve) for the second ask", c2.buttons.includes("Deny") && c2.buttons.includes("Approve"), JSON.stringify(c2));
  const tDeny = Date.now();
  h.check("box 2: Deny clicked on the card", await clickChipButton(ctx.app, "Deny"), "button found");
  const left = await waitFor("the card to leave needs-you", async () => {
    const c = await boardChip(ctx.app);
    return c && c.word !== "Needs you" ? c : null;
  }, 30000, 250);
  h.log(`after Deny: card ${JSON.stringify(left)} after ${Date.now() - tDeny} ms`);
  h.check("box 2: the card left needs-you with no buttons", left.word !== "Needs you" && !left.buttons.length, JSON.stringify(left));
  // The refusal goes back to the agent; give it time to react, then read what Kolux shows (an interrupt may fire no Stop hook).
  await sleep(12000);
  const w12 = await boardChip(ctx.app);
  h.log(`card 12 s after Deny: ${JSON.stringify(w12)}`);
  const ran = existsSync(`${ctx.repo}/denied.txt`);
  const after = (await ctx.events()).filter((e) => e.t >= tDeny).map((e) => `${e.t - tDeny}ms ${e.state}`);
  await goScreen(ctx.app, "Terminals");
  await sleep(1000);
  h.log(`events after Deny: ${after.join(" > ")}`);
  h.log(`agent screen after Deny: ${excerpt(await ctx.screenText(), 6)}`);
  h.check("box 2: the agent received the refusal (the command did not run: denied.txt missing)", !ran, `denied.txt ${ran ? "EXISTS" : "missing"}`);
  h.log(`pane word 12 s+ after Deny (Terminals view): ${await paneWord(ctx.app)}`);
  h.log(`screenshot: ${await h.shot("after-deny")}`);
});
