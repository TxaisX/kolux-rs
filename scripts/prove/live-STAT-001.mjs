// LIVE proof, STAT-001 box 1 (spec/04): real Claude + a prompt -> the pane shows Working about a second after the Enter, Done once the reply ends.
// Asserted on Kolux's side only: the pane header word (aria-label of the .st dot) and the agent-status events the window received.
import { scenario, send, paneWord, sleep } from "./live-claude-common.mjs";

await scenario("STAT-001", { cards: ["STAT-001"] }, async (ctx, h) => {
  const t0 = await send(ctx, "Reply with the single word ok and nothing else.");
  let workingMs = null;
  let doneMs = null;
  const words = [];
  const end = t0 + 120000;
  while (Date.now() < end && doneMs === null) {
    const w = await paneWord(ctx.app);
    if (words.at(-1)?.w !== w) words.push({ ms: Date.now() - t0, w });
    if (workingMs === null && w === "Working") workingMs = Date.now() - t0;
    if (workingMs !== null && w === "Done") doneMs = Date.now() - t0;
    await sleep(100);
  }
  const ev = (await ctx.events()).filter((e) => e.t >= t0).map((e) => `${e.t - t0}ms ${e.state}${e.tool ? `/${e.tool}` : ""}`);
  h.log(`pane word timeline after Enter: ${words.map((x) => `${x.ms}ms ${x.w}`).join(" > ")}`);
  h.log(`agent-status events after Enter: ${ev.join(" > ")}`);
  h.check("the pane shows Working within about a second (<= 2500 ms incl. one poll) of the Enter", workingMs !== null && workingMs <= 2500, `working at ${workingMs} ms`);
  h.check("the pane shows Done once the reply ends", doneMs !== null, `done at ${doneMs} ms`);
  h.check("the hook events went working then done", ev.some((x) => / working/.test(x)) && /done$/.test(ev.at(-1) ?? ""), ev.join(" > "));
  h.log(`screenshot: ${await h.shot("done")}`);
});
