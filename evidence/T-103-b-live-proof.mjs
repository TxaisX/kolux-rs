// LIVE PROOF PENDING (T-103-b VIEW-036, T-101-b TERM-002): run by the merge resolver on main, never by a builder.
//
// Proves: with sessions.add and sessions.remove bound in a keybindings.json inside the SCRATCH home that
// the smoke launcher gives the app, pressing the add key adds a session pane, and pressing the remove key
// ASKS first (an empty chooser too, coordinator decision 2026-10-25) and only closes the pane on Remove.
// Cancel keeps the pane. The real ~/.kolux/keybindings.json is never touched: `seed` refuses any folder
// that is not scratch.
//
//   1. node evidence/T-103-b-live-proof.mjs seed --home G:\Temp\kolux-rs-smoke\home
//        (the folder smoke.mjs uses as USERPROFILE/HOME; it must sit under a folder holding .kolux-rs-scratch)
//   2. start the app on that home, window hidden:  pnpm smoke -- --keep --offscreen --only 1
//        (or any launch with USERPROFILE/HOME set to that folder and --remote-debugging-port=9240)
//   3. node evidence/T-103-b-live-proof.mjs press --cdp 9240
//        prints one PASS or FAIL line per check and exits 1 on a FAIL.
//
// Keys: Ctrl+Alt+Shift+J adds, Ctrl+Alt+Shift+K removes (no built-in default uses either; src/keys/sessionKeys.test.ts).
// Panes are counted as section.pane.chooser (not the New session page) plus section.pane[data-agent].
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

for (const k of Object.keys(process.env)) if (k.startsWith("KOLUX_")) delete process.env[k];
const [cmd, ...rest] = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : fallback;
};
const here = dirname(fileURLToPath(import.meta.url));
const cdpScript = join(here, "..", "scripts", "evidence", "cdp.mjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEYS = { "sessions.add": "Mod+Alt+Shift+J", "sessions.remove": "Mod+Alt+Shift+K" };
// The CDP key command takes Alt=1 Ctrl=2 Shift=8; Mod is Ctrl on Windows and Linux.
const MODS = 1 + 2 + 8;

function seed() {
  const home = resolve(opt("home", ""));
  if (!opt("home", "")) throw new Error("seed needs --home <scratch home>");
  if (home.toLowerCase() === resolve(homedir()).toLowerCase()) throw new Error("refusing the real home folder");
  // a scratch home sits under a folder that carries the .kolux-rs-scratch marker (v3 SAFETY RULE)
  let dir = home;
  let marked = false;
  for (let i = 0; i < 4 && !marked; i++, dir = dirname(dir)) marked = existsSync(join(dir, ".kolux-rs-scratch"));
  if (!marked) throw new Error(`refusing ${home}: no .kolux-rs-scratch marker in it or the three folders above it`);
  const file = join(home, ".kolux", "keybindings.json");
  mkdirSync(dirname(file), { recursive: true });
  const existing = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { version: 1, keybindings: {}, platforms: { darwin: {}, linux: {}, win32: {} } };
  writeFileSync(file, `${JSON.stringify({ ...existing, keybindings: { ...existing.keybindings, ...KEYS } }, null, 2)}\n`);
  console.log(`seeded ${file}`);
}

const cdp = (...a) =>
  new Promise((res) => execFile(process.execPath, [cdpScript, "main", ...a], { env: { ...process.env, CDP_PORT: opt("cdp", "9240") }, maxBuffer: 1 << 22 }, (e, so, se) => res((so + se).trim())));
const evalJs = async (js) => {
  const out = await cdp("eval", js);
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
};
const count = () => evalJs(`document.querySelectorAll('section.pane.chooser:not(.sheet), section.pane[data-agent]').length`);
const dialog = () => evalJs(`!!document.querySelector('[role="alertdialog"]')`);
const sheet = () => evalJs(`!!document.querySelector('section.pane.chooser.sheet')`);
const until = async (f, ms = 5000) => {
  const t0 = Date.now();
  let v;
  while (!(v = await f()) && Date.now() - t0 < ms) await sleep(150);
  return v;
};
const press = async (letter) => {
  await evalJs(`(document.activeElement && document.activeElement.blur && document.activeElement.blur(), true)`);
  await cdp("key", letter, String(MODS));
};
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};

async function run() {
  const n0 = await count();
  check("the grid has panes to start from", Number(n0) >= 1, `${n0} panes`);

  // 1. add
  await press("J");
  const opened = await until(async () => (await count()) === n0 + 1 || (await sheet()));
  const viaSheet = (await sheet()) === true;
  check("the add key adds a session pane", opened === true, viaSheet ? "the New session page opened (new look: the panes appear when it launches)" : `${n0} -> ${await count()} panes`);
  if (viaSheet) {
    await cdp("key", "Escape");
    console.log("NOTE new look: the New session page is the add; the remove half runs on the grid as it stands.");
  }

  // 2. remove then Cancel: the question shows, nothing closes
  const n1 = await count();
  await press("K");
  check("the remove key asks before any pane closes", (await until(dialog)) === true && (await count()) === n1, `${n1} panes while the question is open`);
  await cdp("key", "Escape");
  await sleep(300);
  check("Cancel keeps the pane", (await dialog()) === false && (await count()) === n1, `${await count()} panes`);

  // 3. remove then Remove (or Stop): the pane goes and the grid is back where it began
  await press("K");
  await until(dialog);
  await evalJs(`(document.querySelector('[role="alertdialog"] .btn.danger')?.click(), true)`);
  const back = await until(async () => (await count()) === n1 - 1);
  check("confirming removes exactly one pane", back === true, `${n1} -> ${await count()} panes`);
  if (!viaSheet) check("add then remove returns the grid to its previous pane count", (await count()) === n0, `started ${n0}, now ${await count()}`);
}

if (cmd === "seed") seed();
else if (cmd === "press") {
  await run();
  console.log(failed ? `${failed} check(s) FAILED` : "all checks PASSED");
  process.exit(failed ? 1 : 0);
} else {
  console.error("usage: node evidence/T-103-b-live-proof.mjs seed --home <scratch home> | press --cdp <port>");
  process.exit(2);
}
