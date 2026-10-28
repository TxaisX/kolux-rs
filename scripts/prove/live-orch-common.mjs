// Shared pieces of the REAL-Claude orchestration proofs (ORCH-007, ORCH-013, CLI-035): a shell pane beside the Claude pane
// (so the app's own kolux-dev CLI can run from a Kolux terminal), CLI calls from it, and Claude's Bash-permission answer.
import { CLAUDE, sleep, waitFor, SHELL } from "./live-common.mjs";
import { runCli } from "./live-cli-common.mjs";

export { runCli, sleep, waitFor };

/** Splits the Claude pane to the right (a shell in the same folder) so a shell pane is shown next to it. */
export async function splitShell(ctx, log) {
  await ctx.app.click(`${CLAUDE} .pane-head button[title^="Split right"]`);
  await waitFor("a shown shell pane", async () => (await ctx.app.shown(SHELL)) >= 1, 20000, 500);
  await waitFor("its input field", () => ctx.app.exists(`${SHELL} .xterm-helper-textarea`), 20000, 500);
  await sleep(2500);
  log(`shell pane beside Claude: shown shells ${await ctx.app.shown(SHELL)}`);
}

/** kolux-dev <args> --json from the shell pane. */
export const cli = (ctx, args, opts = {}) => runCli(ctx, args, opts);

/** Rows of `terminal list`: { handle, agent, title, shown }. */
export async function terminals(ctx) {
  const r = await cli(ctx, "terminal list");
  return r.json?.terminals ?? [];
}

const flat = (s) => s.replace(/[│╭╮╰╯]/g, " ").replace(/\s+/g, " ");
export const flatScreen = async (ctx) => flat(await ctx.screenText());

/**
 * Waits for Claude's Bash permission question, logs the command it names and answers "1. Yes" (Enter) once.
 * Returns the flattened screen text at the question, or null when none came within ms.
 */
export async function approveBash(ctx, log, ms = 90000, what = "a Bash permission question") {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await flatScreen(ctx);
    if (/Do you want to (proceed|create|make this edit|write)/i.test(t) && /1\. Yes/.test(t)) {
      log(`${what}: ${t.slice(Math.max(0, t.search(/Bash command/i)), t.search(/Do you want to/i)).trim().slice(0, 300)}`);
      await ctx.enter();
      await sleep(1500);
      return t;
    }
    await sleep(700);
  }
  return null;
}

/** Waits until the last agent-status event of the pane is neither working nor a permission question, for at least 2 s. */
export async function idleNow(ctx, ms = 90000) {
  return waitFor("the Claude pane to be idle", async () => {
    const ev = await ctx.events();
    const last = ev[ev.length - 1];
    if (!last || /working|permission/i.test(last.state)) return null;
    return Date.now() - last.t > 2000 ? last : null;
  }, ms, 700);
}
