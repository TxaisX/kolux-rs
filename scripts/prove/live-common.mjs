// Live-proof helpers for the prove lane (2026-10-26): launch the dev app hidden, put a throwaway repo in it as a project,
// open a REAL Claude Code pane signed in with the Txais-approved test account A, and read and drive that pane over CDP.
//
// Safety shape (see evidence/T-025-d.txt for why):
//  - the APP runs with CLAUDE_CONFIG_DIR = a scratch folder (below its TEMP, with the scratch marker): a debug build
//    writes agent hook entries only there. Its hook sync is what installs the entries.
//  - the PANE's claude runs with CLAUDE_CONFIG_DIR = account A (agentOptions.claude.env) so the real sign-in is used, and
//    `--settings <the scratch settings.json>` so Claude loads the entries the app installed.
//  - nothing here reads or writes a credential file; the account folder is only named as a variable value.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, sleep, waitFor } from "../evidence/app-launch.mjs";

export { sleep, waitFor };
export const ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]+$/, "");
export const ACCOUNT_A = "G:/Dev/kolux-scratch/live-signin/account-a";
export const BASE = "G:/Temp/prove-v3";
export const LOGS = "G:/Temp/prove-v3-logs";
export const CLAUDE = 'section.pane[data-agent*="claude"]';

// Nothing of the old app, no token variable and no API key may reach the app, its panes or Claude.
for (const k of Object.keys(process.env)) {
  if (k.startsWith("KOLUX_") || k.startsWith("CLAUDE_CODE_") || k === "CLAUDECODE" || k === "CLAUDE_CONFIG_DIR" || k === "ANTHROPIC_API_KEY" || k === "ANTHROPIC_AUTH_TOKEN") delete process.env[k];
}

export class NeedsLogin extends Error {}

/** Evidence lines: printed and kept for the evidence file. */
export function reporter() {
  mkdirSync(LOGS, { recursive: true });
  const lines = [];
  const log = (...a) => {
    const s = a.join(" ");
    lines.push(s);
    console.log(s);
  };
  return { log, lines };
}

const cleanEnv = () => {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (k.startsWith("GIT_TRACE")) delete e[k];
  return e;
};
export const git = (cwd, args) =>
  new Promise((resolve, reject) =>
    execFile("git", ["-c", "user.name=prove", "-c", "user.email=prove@example.invalid", ...args], { cwd, env: cleanEnv(), windowsHide: true, maxBuffer: 1 << 24 }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stdout, stderr })) : resolve(stdout),
    ),
  );

/**
 * id: task id. opts.report: from reporter(). opts.claudeArgs: arguments of the Claude pane ("${SETTINGS}" becomes the scratch
 * settings.json; a permissions-skipping flag is refused). opts.files: {name: text} committed on main.
 * opts.branch: a branch checked out after the first commit. opts.trace: a folder GIT_TRACE2 points at for the app.
 * opts.dirty: {name: text} written (uncommitted) after the first commit.
 */
export async function startProve(id, opts) {
  const { log } = opts.report;
  if (/dangerously|bypassPermissions|yolo/i.test(opts.claudeArgs)) throw new Error("refused: a permissions-skipping flag is not allowed in this lane");
  const TEMP = `${BASE}/run-${id}`;
  const repo = `${BASE}/work/${id}`;
  const settingsFile = `${TEMP}/tmp/claude-config/settings.json`;
  const app = createApp({ root: ROOT, port: "1470", cdp: "9290", identifier: "com.txaisxiong.kolux-rs.prove", temp: TEMP, suffix: ".prove", offscreen: true, buildMinutes: 30, log });
  const { profile } = app.paths;
  // A fresh run folder: only a folder this lane made (it carries the marker) is wiped.
  if (existsSync(TEMP)) {
    if (!existsSync(join(TEMP, ".prove-run"))) throw new Error(`${TEMP} exists without the prove marker`);
    rmSync(TEMP, { recursive: true, force: true });
  }
  mkdirSync(TEMP, { recursive: true });
  writeFileSync(join(TEMP, ".prove-run"), "made by scripts/prove/live-common.mjs\n");
  if (existsSync(repo)) rmSync(repo, { recursive: true, force: true });
  mkdirSync(repo, { recursive: true });
  for (const [name, text] of Object.entries(opts.files ?? {})) writeFileSync(join(repo, name), text);
  await git(repo, ["init", "-q", "-b", "main"]);
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-q", "-m", "start"]);
  if (opts.branch) {
    await git(repo, ["checkout", "-q", "-b", opts.branch]);
    writeFileSync(join(repo, "branch.txt"), "one commit over main\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-q", "-m", "branch work"]);
  }
  for (const [name, text] of Object.entries(opts.dirty ?? {})) writeFileSync(join(repo, name), text);
  if (opts.trace) {
    rmSync(opts.trace, { recursive: true, force: true });
    mkdirSync(opts.trace, { recursive: true });
    process.env.GIT_TRACE2 = opts.trace;
  }
  const seeded = {
    confirmCloseRunning: false,
    agentStatusHooks: true,
    agentOptions: { claude: { env: `CLAUDE_CONFIG_DIR=${ACCOUNT_A}`, args: opts.claudeArgs.replaceAll("${SETTINGS}", settingsFile) } },
  };
  await app.launch({
    prepare: () => {
      rmSync(profile, { recursive: true, force: true });
      mkdirSync(profile, { recursive: true });
      writeFileSync(join(profile, "settings.json"), JSON.stringify(seeded, null, 2));
    },
  });
  delete process.env.GIT_TRACE2;
  const { evalJs, cdp, click, clickWhere, exists, shown, focusPane, focusField } = app;
  // The app's hook sync wrote its entries into the scratch settings.json (the file --settings points at).
  await waitFor("the hook entries in the scratch settings.json", () => existsSync(settingsFile) && /agent-hooks/.test(readFileSync(settingsFile, "utf8")), 30000, 500);
  // Hook events as the window hears them.
  await evalJs(`(async () => { window.__proveEvents = []; const cb = window.__TAURI_INTERNALS__.transformCallback((e) => window.__proveEvents.push({ t: Date.now(), ...e.payload })); await window.__TAURI_INTERNALS__.invoke("plugin:event|listen", { event: "agent-status", target: { kind: "Any" }, handler: cb }); return true; })()`);
  // The repo as a project: its first shell opens.
  await waitFor("the sidebar add button", () => exists('.sb-foot button[title^="Add a project by path"]'), 30000);
  await click('.sb-foot button[title^="Add a project by path"]');
  await waitFor("the project folder field", () => exists('input[aria-label="project folder"]'), 5000);
  await focusField('input[aria-label="project folder"]');
  await cdp("insert", repo, "enter");
  await waitFor("the first shell pane", async () => (await shown("section.pane[data-agent]")) >= 1, 30000);

  const ctx = {
    app, TEMP, repo, settingsFile, log,
    events: () => evalJs("window.__proveEvents"),
    screen: () =>
      evalJs(`(() => { for (const sec of document.querySelectorAll(${JSON.stringify(CLAUDE)})) { if (sec.offsetParent === null) continue; for (const d of sec.querySelectorAll("div")) { const t = d.__koluxTerm; if (t) { const b = t.buffer.active; const rows = []; for (let y = 0; y < t.rows; y++) rows.push(b.getLine(b.viewportY + y)?.translateToString(true) ?? ""); return rows; } } } return null; })()`),
    async screenText() {
      return ((await ctx.screen()) ?? []).join("\n");
    },
    async openClaude() {
      await click("button.newtab");
      await waitFor("the New tab menu", () => exists('[role="menu"][aria-label="New tab"]'), 5000);
      await clickWhere('[role="menu"][aria-label="New tab"] [role="menuitem"]', "/^\\s*Claude Code\\s*$/");
      await waitFor("a Claude pane", () => shown(CLAUDE), 20000);
      await waitFor("its input field", () => exists(`${CLAUDE} .xterm-helper-textarea`), 20000);
    },
    /** Waits for the Claude prompt box, answering only the folder-trust question; a login screen means NEEDS LOGIN. */
    async ready(ms = 120000) {
      const end = Date.now() + ms;
      let last = 0;
      for (;;) {
        const t = await ctx.screenText();
        if (/login method|please run \/login|not logged in|log in to claude|Paste code here|Invalid API key|Anthropic Console|Sign in/i.test(t)) throw new NeedsLogin(`claude asks for a login: ${t.split("\n").filter(Boolean).slice(0, 4).join(" | ").slice(0, 200)}`);
        // First-run questions of the test account (the sign-in is already there): accept the pre-selected answer, one Enter each.
        const first = /Choose the text style|Press Enter to continue|trust this folder|Do you trust|Yes, I trust|Use recommended settings/i.exec(t);
        if (first) {
          if (Date.now() - last > 4000) {
            last = Date.now();
            // The trust question starts on "No, exit": move to "Yes, I trust this folder" (a scratch repo made by this script).
            const trust = /trust this folder|Do you trust|Yes, I trust/i.test(t);
            log(`  (first-run screen "${first[0]}": ${trust ? "chose Yes, I trust this folder for the scratch repo" : "accepted the pre-selected answer"})`);
            if (trust && /❯\s*No, exit/.test(t)) {
              await ctx.focus();
              await cdp("key", "ArrowDown");
              await sleep(300);
            }
            await ctx.enter();
          }
        } else if (/Try the new fullscreen renderer/i.test(t)) {
          if (Date.now() - last > 4000) {
            last = Date.now();
            log('  (first-run notice "Try the new fullscreen renderer?": answered 2, Not now)');
            await ctx.press("2");
          }
        } else if (/\? for shortcuts|shift\+tab to cycle|(plan|auto|manual|default) mode on|accept edits on|esc to interrupt/i.test(t)) return t;
        if (Date.now() > end) throw new Error(`claude was not ready after ${ms} ms; screen: ${t.split("\n").filter(Boolean).slice(-8).join(" | ").slice(0, 400)}`);
        await sleep(1000);
      }
    },
    focus: () => focusPane(CLAUDE, 0, ".xterm-helper-textarea"),
    async press(text) {
      await ctx.focus();
      await cdp("insert", text);
    },
    async enter() {
      await ctx.focus();
      await cdp("key", "Enter");
    },
    async say(text) {
      await ctx.press(text);
      await sleep(500);
      await ctx.enter();
    },
    waitScreen: (re, ms = 120000, what = String(re)) =>
      waitFor(`the screen to show ${what}`, async () => {
        const t = await ctx.screenText();
        return re.test(t) ? t : null;
      }, ms, 1000),
    waitEvent: (pred, ms = 120000, what = "an event") => waitFor(what, async () => (await ctx.events()).find(pred) ?? null, ms, 500),
    async paneKey() {
      return (await ctx.events())[0]?.paneKey ?? null;
    },
    history: (paneKey) => app.invoke("agent_history", { paneKey }),
    stop: () => app.closeApp(),
  };
  return ctx;
}

/** The scratch hook entries as Claude would load them: the event names whose entries name Kolux's hook script. */
export function hookEventsInstalled(settingsFile) {
  const j = JSON.parse(readFileSync(settingsFile, "utf8"));
  return Object.entries(j.hooks ?? {})
    .filter(([, groups]) => JSON.stringify(groups).includes("agent-hooks"))
    .map(([name]) => name);
}

/** Rows of the screen with the blank ones dropped, trimmed for the evidence file (a short excerpt only). */
export const excerpt = (text, n = 6) => text.split("\n").map((l) => l.trim()).filter(Boolean).slice(-n).join(" | ").slice(0, 400);
