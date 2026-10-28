// LIVE proof, SAFE-004 box 2 (spec/10): a real Claude in plan mode; two comments on two sections, then Request changes ->
// Claude gets ONE message that names both line ranges, and comes back with a revised plan.
// Asserted on Kolux's side: the sheet DOM, the terminal writes the window made, and the agent-status events (a new exit-plan request).
import { scenario, send, sleep, waitFor } from "./live-claude-common.mjs";
import { PLAN_ARGS, PLAN_PROMPT, addComment, clickSheetButton, openSheet, reviewBtn, sheetButton, sheetOpen } from "./live-plan-common.mjs";

await scenario("SAFE-004-b2", { cards: ["SAFE-004"], claudeArgs: PLAN_ARGS, settings: { uiLook: "new" } }, async (ctx, h) => {
  const t = await send(ctx, PLAN_PROMPT);
  const { blocks } = await openSheet(ctx, h, t);
  const i1 = Math.min(1, blocks.length - 1);
  const i2 = Math.min(2, blocks.length - 1);
  const r1 = blocks[i1];
  const r2 = blocks[i2];
  h.check("setup: the plan has at least three sections so the two ranges differ", blocks.length >= 3 && r1 !== r2, JSON.stringify(blocks));
  const before = await sheetButton(ctx.app, "Request changes");
  h.check("Request changes is disabled before any comment", before?.disabled === true, JSON.stringify(before));
  await addComment(ctx.app, i1, "FIRSTNOTE use the word hello instead of hi");
  await addComment(ctx.app, i2, "SECONDNOTE add a final step that lists the folder");
  const btn = await sheetButton(ctx.app, "Request changes");
  h.check("the button carries the count of the two comments", btn?.text === "Request changes (2)" && !btn.disabled, JSON.stringify(btn));
  h.log(`screenshot: ${await h.shot("sheet-two-comments")}`);
  const tR = Date.now();
  h.check("Request changes clicked", await clickSheetButton(ctx.app, "Request changes"), "clicked");
  await waitFor("the sheet to close", async () => !(await sheetOpen(ctx.app)), 15000, 200);
  // The window's invoke binding is read-only, so the typed message is read where Claude shows it: its input echo on the pane screen.
  const shown = await waitFor("the feedback to appear in the pane", async () => {
    const txt = await ctx.screenText();
    return txt.includes("FIRSTNOTE") && txt.includes("SECONDNOTE") ? txt : null;
  }, 30000, 500).catch(async () => {
    h.log(`toast: ${await ctx.app.evalJs(`[...document.querySelectorAll('[role=status],[role=alert],.toast')].map((e) => e.textContent.trim()).filter(Boolean).join(' | ').slice(0, 300)`)}`);
    h.log(`pane screen: ${(await ctx.screenText()).split(/\r?\n/).filter((l) => l.trim()).slice(-12).join(" | ").slice(0, 600)}`);
    throw new Error("the feedback never reached the pane");
  });
  const lines = shown.split(/\r?\n/);
  const at = (m) => lines.findIndex((l) => l.includes(m));
  const count = (m) => lines.filter((l) => l.includes(m)).length;
  const echoStart = lines.findIndex((l) => l.startsWith("❯") && l.includes("revise the plan"));
  const echo = lines.slice(Math.max(echoStart, 0), Math.max(echoStart, 0) + 8).join(" | ");
  h.log(`message as Claude echoes it: ${echo.slice(0, 500)}`);
  h.check("one message: each note appears once, under one prompt echo, in order", echoStart >= 0 && count("FIRSTNOTE") === 1 && count("SECONDNOTE") === 1 && echoStart < at("FIRSTNOTE") && at("FIRSTNOTE") < at("SECONDNOTE"), `echo at ${echoStart}, first ${at("FIRSTNOTE")}, second ${at("SECONDNOTE")}`);
  h.check("the message names both line ranges", echo.includes(`${r1}:`) && echo.includes(`${r2}:`), `ranges ${r1} / ${r2}`);
  // Claude answers with a revised plan: a new exit-plan request after the feedback went in.
  const again = await ctx.waitEvent((e) => e.t >= tR && e.tool === "ExitPlanMode" && (e.state === "permission" || e.state === "waiting"), 150000, "a revised plan");
  await waitFor("the Review plan button again", () => reviewBtn(ctx.app), 15000, 300);
  h.log(`revised plan requested ${again.t - tR} ms after Request changes`);
  h.check("Claude came back with a revised plan (a new exit-plan request, Review plan shown again)", true, `${again.state}/${again.tool}`);
  h.log(`screenshot: ${await h.shot("revised-plan")}`);
});
