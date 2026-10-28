// LIVE proof, row 989 (MERGE 415): with NO `--settings <scratch>` override on the pane, a real Claude (test account A) reads only its
// account's own settings.json, so Kolux's own pane status can move Working -> Done/Idle only if the app wrote its hooks THERE.
// Asserted on Kolux's side: agent-status events and the pane word. account-a/settings.json is only stat'ed and searched for the hook script name.
import { existsSync, readFileSync, statSync } from "node:fs";
import { scenario, send, paneWord, sleep, ACCOUNT_A } from "./live-claude-common.mjs";
import { trustLogLines } from "./live-trust-common.mjs";

const SETTINGS_A = `${ACCOUNT_A}/settings.json`;
const hooksIn = () => (existsSync(SETTINGS_A) ? { exists: true, bytes: statSync(SETTINGS_A).size, hasKoluxHooks: /agent-hooks/.test(readFileSync(SETTINGS_A, "utf8")) } : { exists: false });

await scenario("ROW-989", { cards: ["ROW-989"], noSettingsFlag: true, settings: { uiLook: "new" } }, async (ctx, h) => {
  h.log(`account-a settings.json at pane start: ${JSON.stringify(hooksIn())}`);
  // What the app's own hook sync says it did for Claude (the same command the Agents page runs); paths only.
  const sync = await ctx.app.invoke("agent_hooks_sync", {}).catch((e) => [{ agent: "claude", error: `invoke failed: ${String(e).slice(0, 200)}` }]);
  for (const o of sync.filter((x) => x.agent === "claude")) h.log(`agent_hooks_sync claude: done=${JSON.stringify(o.done)} error=${String(o.error ?? "none").replace(/\\/g, "/").slice(0, 420)}`);
  const t = await send(ctx, "Reply with the single word ok. Do not use any tools.");
  const seen = [];
  const end = Date.now() + 90000;
  while (Date.now() < end) {
    const w = await paneWord(ctx.app);
    if (seen[seen.length - 1]?.w !== w) seen.push({ ms: Date.now() - t, w });
    const evs = (await ctx.events()).filter((e) => e.t >= t);
    if (evs.some((e) => /done|idle/i.test(String(e.state)))) break;
    await sleep(500);
  }
  await sleep(1500);
  const evs = (await ctx.events()).filter((e) => e.t >= t).map((e) => `${e.t - t}ms ${e.state}${e.tool ? `/${e.tool}` : ""}`);
  h.log(`pane word changes: ${seen.map((s) => `${s.ms}ms ${s.w}`).join(" > ")}`);
  h.log(`hook events after the prompt: ${evs.join(" > ") || "none"}`);
  h.log(`account-a settings.json after: ${JSON.stringify(hooksIn())}`);
  for (const l of trustLogLines(ctx.TEMP, 10, /settings|hook|fence|scratch/i)) h.log(`kolux.log: ${l}`);
  const states = (await ctx.events()).filter((e) => e.t >= t).map((e) => String(e.state).toLowerCase());
  const wi = states.findIndex((s) => /working/.test(s));
  const di = states.findIndex((s, i) => i > wi && /done|idle/.test(s));
  h.check("Kolux's pane status moved Working -> Done/Idle from hook events (no --settings override)", wi >= 0 && di > wi, `events=${states.join(">") || "none"}`);
  h.log(`screenshot: ${await h.shot("after")}`);
});
