// LIVE proof, SAFE-003 (spec/10): a real Claude in plan mode; the review sheet's Approve lets it carry the plan out.
//   node live-SAFE-003.mjs b1   plain Approve: Claude leaves plan mode and starts the work, the review button is gone.
//   node live-SAFE-003.mjs b2   a comment written first: Approve is clickable, Claude proceeds, the comment is not kept.
// Asserted on Kolux's side: the sheet DOM, agent-status events, what the window typed into the pane, the window's draft state.
import { scenario, send, sleep, waitFor } from "./live-claude-common.mjs";
import { PLAN_ARGS, PLAN_PROMPT, addComment, clickSheetButton, openSheet, reviewBtn, sheetButton, sheetOpen, stateHolds } from "./live-plan-common.mjs";

const BOX = process.argv[2] === "b2" ? "b2" : "b1";
const COMMENT = "LIVEPROOFCOMMENT keep the file name exactly plan-out.txt";

await scenario(`SAFE-003-${BOX}`, { cards: ["SAFE-003"], claudeArgs: PLAN_ARGS, settings: { uiLook: "new" } }, async (ctx, h) => {
  const t = await send(ctx, PLAN_PROMPT);
  const { blocks } = await openSheet(ctx, h, t);
  h.log(`screenshot: ${await h.shot("sheet")}`);
  if (BOX === "b2") {
    await addComment(ctx.app, Math.min(1, blocks.length - 1), COMMENT);
    h.check("b2: the comment is held by the window before Approve", (await stateHolds(ctx.app, COMMENT)) === true, "draft state contains the comment");
  }
  const ap = await sheetButton(ctx.app, "Approve");
  h.check(`${BOX}: Approve is clickable${BOX === "b2" ? " with a comment written" : ""}`, ap && !ap.disabled, JSON.stringify(ap));
  const tA = Date.now();
  h.check(`${BOX}: Approve clicked`, await clickSheetButton(ctx.app, "Approve"), "clicked");
  await waitFor("the sheet to close", async () => !(await sheetOpen(ctx.app)), 10000, 200);
  const w = await ctx.waitEvent((e) => e.t >= tA && e.state === "working", 60000, "working after Approve");
  h.log(`working event ${w.t - tA} ms after Approve (tool=${w.tool ?? "-"})`);
  await sleep(1500);
  h.check(`${BOX}: the review button is gone`, !(await reviewBtn(ctx.app)), "no .plan-review-btn");
  const text = await ctx.screenText();
  h.check(`${BOX}: Claude left plan mode (pane no longer reads plan mode on)`, !/plan mode on/i.test(text), text.split("\n").filter((l) => /mode|plan/i.test(l)).slice(-3).join(" | ").slice(0, 200));
  const after = (await ctx.events()).filter((e) => e.t >= tA).map((e) => `${e.t - tA}ms ${e.state}${e.tool ? `/${e.tool}` : ""}`);
  h.log(`events after Approve: ${after.join(" > ")}`);
  const step = await waitFor("a tool step after Approve", async () => (await ctx.events()).find((e) => e.t >= tA && e.tool && e.tool !== "ExitPlanMode") ?? null, 45000, 500).catch(() => null);
  h.log(`first tool step after Approve: ${step ? `${step.state}/${step.tool} at ${step.t - tA} ms` : "none"}`);
  h.check(`${BOX}: Claude started the work (a tool step followed Approve)`, !!step, JSON.stringify(step && { state: step.state, tool: step.tool }));
  if (BOX === "b2") {
    h.check("b2: the comment is not kept (no draft holds it any more)", (await stateHolds(ctx.app, COMMENT)) === false, "draft state no longer contains the comment");
    const seen = (await ctx.screenText()).includes("LIVEPROOFCOMMENT");
    h.check("b2: the comment was never typed into the pane (not on Claude's screen)", !seen, seen ? "comment visible in pane" : "comment not in pane");
  }
  h.log(`screenshot: ${await h.shot("after-approve")}`);
});
