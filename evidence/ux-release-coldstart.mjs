// RELEASE-build cold start driver (lane ux, 2026-10-25). Starts src-tauri/target/release/kolux-rs.exe directly
// (no vite: the frontend is embedded), as scripts/evidence/app-launch.mjs relaunch() does, with the same scratch env.
// usage: node evidence/ux-release-coldstart.mjs <label> <plan>   plan = comma list of fresh|setup|warm, e.g. fresh,fresh,setup,warm
// The caller holds the `ux` slot for the whole session. Raw readings go to evidence/ux-release-coldstart.txt (JSON lines).
import { createApp, sleep, ps, run, waitFor, moveScript } from "../scripts/evidence/app-launch.mjs";
import { mkdirSync, rmSync, writeFileSync, openSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir, freemem } from "node:os";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const TEMP = "G:/Temp/ux-v3/run";
const CDP = 9280;
const ID = "com.txaisxiong.kolux-rs.ux.smoke";
const EXE = join(root, "src-tauri", "target", "release", "kolux-rs.exe");
const OUT = join(root, "evidence", "ux-release-coldstart.txt");
const [, , label = "busy", planArg = "fresh"] = process.argv;

if (!ID.endsWith(".smoke")) throw new Error("refusing to wipe a profile whose identifier does not end in .smoke");
const app = createApp({ root, port: 1460, cdp: CDP, identifier: ID, temp: TEMP, suffix: ".smoke", offscreen: true, keep: true });
const { appTemp, claudeConfig, codexHome, userHome, roaming, local, profile } = app.paths;
const realHome = homedir();
// Same variables as app-launch.mjs appEnv(): scratch HOME/USERPROFILE/CLAUDE_CONFIG_DIR/CODEX_HOME, WebView2 debugging port.
const appEnv = () => ({ ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP}`, CLAUDE_CONFIG_DIR: claudeConfig, CODEX_HOME: codexHome, TEMP: appTemp, TMP: appTemp, USERPROFILE: userHome, HOME: userHome, APPDATA: roaming, LOCALAPPDATA: local, CARGO_HOME: process.env.CARGO_HOME ?? join(realHome, ".cargo"), RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(realHome, ".rustup") });

const note = (o) => { appendFileSync(OUT, JSON.stringify(o) + "\n"); console.log(JSON.stringify(o)); };
const listening = async () => (await run("cmd", ["/c", "netstat -ano"]).then((r) => r.stdout).catch(() => "")).split(/\r?\n/).filter((l) => /LISTENING/.test(l) && /:(1440|9260|1460|9280)\s/.test(l));
async function portsFree() {
  for (let i = 0; i < 120; i++) { const l = await listening(); if (l.length === 0) return; console.log("ports busy, waiting:", l.length); await sleep(5000); }
  throw new Error("ports 1440/9260/1460/9280 stayed busy for 10 min");
}
async function load() {
  const cpu = await ps("(Get-CimInstance Win32_Processor).LoadPercentage").catch(() => "?");
  const slots = await run(process.execPath, ["G:/Dev/kolux-rs-slots/slot.mjs", "status"]).then((r) => (r.stdout.match(/(\d+)\/\d+ held/) ?? [])[1] ?? "?").catch(() => "?");
  return { cpuPct: Number(cpu) || cpu, freeMemMB: Math.round(freemem() / 1048576), slotsHeld: Number(slots) };
}

// ---- minimal persistent CDP page connection ----
let ws = null, mid = 0;
const waiting = new Map();
async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  const t = targets.find((x) => x.type === "page" && /tauri\.localhost|localhost:1460/.test(x.url));
  if (!t) throw new Error("no page");
  const s = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { s.onopen = r; s.onerror = j; });
  s.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  ws = s;
}
const send = (method, params = {}) => new Promise((res, rej) => {
  if (!ws || ws.readyState !== 1) return rej(new Error("closed"));
  const i = ++mid; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (waiting.delete(i)) rej(new Error("cdp timeout")); }, 8000);
});
async function ev(expr) {
  if (!ws || ws.readyState !== 1) await connect();
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error("page threw");
  return r.result?.result?.value;
}
async function key(name, vk) {
  const base = { key: name, code: name, windowsVirtualKeyCode: vk };
  await send("Input.dispatchKeyEvent", { type: name === "Enter" ? "keyDown" : "rawKeyDown", ...base, ...(name === "Enter" ? { text: "\r" } : {}) });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

const PROBE = `(() => { const ps = [...document.querySelectorAll("section.pane")]; return JSON.stringify({ n: ps.length, heads: ps.map(p => (p.querySelector("header")?.innerText ?? "").replace(/\\s+/g, " ").slice(0, 80)), dlg: document.querySelector("[role=dialog]")?.getAttribute("aria-label") ?? null, proj: document.querySelectorAll("aside.sidebar .proj").length, side: !!document.querySelector("aside.sidebar") }); })()`;
const WELCOME = `!!document.querySelector('[role=dialog][aria-label="Get started with Kolux"]')`;

function wipe() {
  rmSync(profile, { recursive: true, force: true });
  rmSync(join(local, ID), { recursive: true, force: true }); // WebView2 cache of this identifier only
}
function scratch() {
  mkdirSync(claudeConfig, { recursive: true });
  writeFileSync(join(claudeConfig, ".kolux-rs-scratch"), "");
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(local, { recursive: true });
  mkdirSync(roaming, { recursive: true });
  writeFileSync(join(userHome, ".kolux-rs-scratch"), "");
}

async function startOnce(kind, settle) {
  await portsFree();
  if (kind === "fresh") wipe();
  scratch();
  ws = null;
  const before = await load();
  const out = openSync(join(TEMP, "app.log"), "a");
  const t0 = performance.now();
  const child = spawn(EXE, [], { cwd: join(root, "src-tauri"), windowsHide: true, stdio: ["ignore", out, out], env: appEnv() });
  if (!child.pid) throw new Error("no pid");
  const pid = child.pid;
  const r = {};
  let moved = false;
  for (;;) {
    const t = Math.round(performance.now() - t0);
    if (r.target == null) { try { const ts = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); if (ts.some((x) => x.type === "page" && /tauri\.localhost|localhost:1460/.test(x.url))) r.target = t; } catch {} }
    if (r.target != null && r.dom == null) { try { if (await ev("document.readyState")) r.dom = t; } catch {} }
    if (r.dom != null) {
      try {
        const s = JSON.parse(await ev(PROBE));
        const tt = Math.round(performance.now() - t0);
        if (r.sidebar == null && s.side) { r.sidebar = tt; if (!moved) { moved = true; ps(moveScript(pid, true)).catch(() => {}); } }
        if (r.sidebar != null && r.welcome == null && s.dlg === "Get started with Kolux") r.welcome = tt;
        if (r.firstPane == null && s.n > 0) { r.firstPane = tt; }
        if (r.ready == null && s.heads.some((h) => /Ready/.test(h))) { r.ready = tt; r.readyHead = s.heads.find((h) => /Ready/.test(h)); }
        if (r.dlg == null && s.dlg) { r.dlg = tt; r.dlgName = s.dlg; }
        const h0 = s.heads[0] ?? null;
        if ((r.trans ??= []).length === 0 ? h0 != null : r.trans.at(-1)[1] !== h0) r.trans.push([tt, h0]);
        r.last = s;
        if (settle(r, s)) break;
      } catch {}
    }
    if (t > 60000) { r.timedOut = true; break; }
    await sleep(20);
  }
  return { pid, r, before, t0, child };
}

async function closeApp(pid) {
  const tree = await app.treeOf(pid);
  let how = "";
  try { how = await app.gracefulClose(pid); } catch (e) { how = "close failed: " + e.message; }
  const survivors = await app.survivorsOf(tree);
  for (const s of survivors) await run("taskkill", ["/PID", String(s.pid), "/F"]).catch(() => {});
  const gone = !(await app.alive(pid));
  ws = null;
  await sleep(500);
  return { how, tree: tree.length, survivors: survivors.length, gone, listeningAfter: (await listening()).length };
}

for (const step of planArg.split(",")) {
  if (step === "fresh") {
    const { pid, r, before } = await startOnce("fresh", (r) => r.welcome != null);
    const after = await load();
    const c = await closeApp(pid);
    note({ build: "RELEASE", label, kind: "fresh", ms: { target: r.target, dom: r.dom, sidebar: r.sidebar, welcome: r.welcome ?? null }, timedOut: !!r.timedOut, before, after, close: c });
  } else if (step === "setup") {
    const { pid, r } = await startOnce("fresh", (r) => r.welcome != null);
    // skip the wizard (Escape asks "Skip setup?"), then add the demo project by path through the sidebar gear
    await key("Escape", 27); await sleep(400);
    await ev(`(() => { const b = [...document.querySelectorAll("button")].find(x => x.offsetParent && /^Skip$/.test(x.textContent.trim())); b?.click(); return !!b; })()`);
    await waitFor("wizard gone", async () => (JSON.parse(await ev(PROBE)).dlg) == null, 10000, 200);
    await ev(`document.querySelector(".sb-foot button.ib").click()`);
    await sleep(300);
    await ev(`document.querySelector('input[aria-label="project folder"]').focus()`);
    await send("Input.insertText", { text: "G:\\Temp\\ux-v3\\repos\\demo-app" });
    await key("Enter", 13);
    await waitFor("project row and Ready pane", async () => { const s = JSON.parse(await ev(PROBE)); return s.proj > 0 && s.heads.some((h) => /Ready/.test(h)); }, 30000, 200);
    const s = JSON.parse(await ev(PROBE));
    await sleep(1500); // let the layout and project state persist
    const c = await closeApp(pid);
    note({ build: "RELEASE", label, kind: "setup", ms: { welcome: r.welcome }, state: s, close: c });
  } else if (step === "warm") {
    const { pid, r, before } = await startOnce("warm", (r) => r.ready != null);
    const after = await load();
    const c = await closeApp(pid);
    note({ build: "RELEASE", label, kind: "warm", ms: { target: r.target, dom: r.dom, sidebar: r.sidebar, firstPane: r.firstPane ?? null, ready: r.ready ?? null, dialog: r.dlg ?? null }, dialog: r.dlgName ?? null, readyHead: r.readyHead ?? null, trans: r.trans, timedOut: !!r.timedOut, before, after, close: c });
  }
}
process.exit(0);
