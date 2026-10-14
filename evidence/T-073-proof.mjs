// T-073 live proof driver. Drives the dev app T-073-run.mjs launched
// over CDP 9249 and prints raw readings. Usage: node evidence/T-073-proof.mjs <app pid> <step>
import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const ROOT = "G:/Dev/kolux-rs-lanes/look";
const CDP = "9249";
const PID = process.argv[2];
const FILE = "G:/Temp/look-t073/repo/notes.txt";
const ED = 'section.pane.editor[aria-label="notes.txt pane"]';
const run = (f, a, env) => new Promise((res, rej) => execFile(f, a, { env: { ...process.env, ...env }, maxBuffer: 1 << 24 }, (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so.trim()))));
const cdp = (...a) => run(process.execPath, [`${ROOT}/scripts/evidence/cdp.mjs`, "main", ...a], { CDP_PORT: CDP });
const ev = async (js) => {
  const out = await cdp("eval", js);
  let v = JSON.parse(out);
  if (v && typeof v === "object" && v.exceptionDetails) throw new Error(JSON.stringify(v.exceptionDetails));
  // cdp.mjs prints the raw result object when the value is null
  if (v && typeof v === "object" && v.result && typeof v.result === "object" && "type" in v.result) v = v.result.value ?? null;
  return v;
};
const ps = (s) => run("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", s]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
async function waitFor(what, probe, ms = 8000) {
  const s = Date.now();
  for (;;) {
    const v = await probe();
    if (v) return Date.now() - s;
    if (Date.now() - s > ms) throw new Error(`timed out: ${what}`);
    await sleep(150);
  }
}
const buffer = () => ev(`[...document.querySelector(${JSON.stringify(ED + " .cm-content")}).querySelectorAll(".cm-line")].map(l => l.textContent).join("\\n")`);
const notice = (cls) => ev(`(() => { const n = document.querySelector(${JSON.stringify(ED)} + " .notice.${cls}"); return n ? { text: n.querySelector("span")?.textContent ?? n.textContent, buttons: [...n.querySelectorAll("button")].map(b => b.textContent) } : null; })()`);
const clickIn = async (sel, label) => {
  const r = await ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)} + " button")].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return "missing"; b.click(); return "clicked"; })()`);
  if (r !== "clicked") throw new Error(`no ${label} in ${sel}`);
};
const disk = () => readFileSync(FILE, "utf8");
const shellWrite = (text) => ps(`Set-Content -LiteralPath '${FILE}' -Value '${text}' -NoNewline -Encoding ascii; (Get-Item -LiteralPath '${FILE}').Length`);
const unsaved = () => ev(`!!document.querySelector(${JSON.stringify(ED + " .unsaved")})`);
const shot = (name) => ps(`& '${ROOT}/scripts/evidence/shot.ps1' -Out '${ROOT}/evidence/${name}' -ProcessId ${PID}`);
const focusEd = () => ev(`(() => { const p = document.querySelector(${JSON.stringify(ED)}); p.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); const f = p.querySelector(".cm-content"); f.focus(); return document.activeElement === f; })()`);
const caretEnd = () => ev(`(() => { const f = document.querySelector(${JSON.stringify(ED + " .cm-content")}); const r = document.createRange(); const last = f.lastElementChild; r.selectNodeContents(last); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; })()`);

const step = process.argv[3] ?? "all";

if (step === "look" || step === "all") {
  log("settings_patch uiLook=new:", JSON.stringify(await ev(`window.__TAURI_INTERNALS__.invoke("settings_patch", { set: { uiLook: "new", appearanceMode: "dark" }, remove: [] }).then(v => v ?? null)`)));
  await ev("location.reload(), true").catch(() => null);
  await sleep(3000);
  await waitFor("the editor after reload", () => ev(`!!document.querySelector(${JSON.stringify(ED + " .cm-content")})`), 30000);
  log("ui look attr:", JSON.stringify(await ev(`[document.documentElement.dataset.look ?? null, document.documentElement.dataset.theme ?? null, document.documentElement.className]`)));
  log("maximise:", await ps(`Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);' -Name S -Namespace U; [U.S]::ShowWindow((Get-Process -Id ${PID}).MainWindowHandle, 3)`));
  await sleep(1000);
}

const view = (name) => ev(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === ${JSON.stringify(name)}); if (!b) return "missing"; b.click(); return "clicked"; })()`);
const edVisible = () => ev(`(() => { const s = document.querySelector(${JSON.stringify(ED)}); return !!s && !s.hidden && s.offsetParent !== null; })()`);

if (step === "tour") {
  // The scratch profile is new, so the first-run tour is up: close it and skip.
  log("tour close:", await ev(`(() => { const d = document.querySelector("[role=dialog]"); const x = d && [...d.querySelectorAll("button")].find(b => b.getAttribute("aria-label") === "Close"); if (!x) return "no tour"; x.click(); return "closed"; })()`));
  await sleep(500);
  log("skip:", await ev(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Skip"); if (!b) return "no skip"; b.click(); return "skipped"; })()`));
  await sleep(500);
}

if (step === "front") {
  log("Board view:", await view("Board"));
  await sleep(500);
  log("notes.txt tab shown:", await edVisible(), "buffer:", JSON.stringify(await buffer()), "unsaved:", await unsaved());
  log("shell rewrite while the tab is in the background ->", await shellWrite("rewritten while hidden"), "bytes");
  await sleep(4500);
  log("4.5 s later, tab still hidden:", !(await edVisible()), "buffer (untouched):", JSON.stringify(await buffer()));
  log("Terminals view:", await view("Terminals"));
  const ms = await waitFor("the reload on coming forward", async () => (await buffer()) === "rewritten while hidden");
  log(`tab in front again; buffer took the disk copy ${ms} ms after it came forward:`, JSON.stringify(await buffer()), "banner:", JSON.stringify(await notice("disk-changed")));
}

if (step === "banner" || step === "all") {
  log("disk before:", JSON.stringify(disk()));
  log("buffer before:", JSON.stringify(await buffer()));
  log("focus editor:", await focusEd());
  await caretEnd();
  await cdp("insert", " MY EDIT");
  await sleep(300);
  log("buffer after typing:", JSON.stringify(await buffer()), "unsaved marker:", await unsaved(), "disk:", JSON.stringify(disk()));
  log("shell rewrite (Set-Content) ->", await shellWrite("agent rewrite one"), "bytes");
  const ms = await waitFor("the banner", () => notice("disk-changed"));
  log(`banner shown ${ms} ms after the shell write:`, JSON.stringify(await notice("disk-changed")));
  log("buffer while banner up (edits kept):", JSON.stringify(await buffer()));
  log("shot:", await shot("T-073.png"));
  await clickIn(ED + " .notice.disk-changed", "Reload");
  await waitFor("the undo toast", () => notice("disk-undo"));
  log("after Reload: buffer:", JSON.stringify(await buffer()), "disk:", JSON.stringify(disk()), "unsaved marker:", await unsaved());
  log("toast:", JSON.stringify(await notice("disk-undo")), "banner:", JSON.stringify(await notice("disk-changed")));
  await clickIn(ED + " .notice.disk-undo", "Undo");
  await sleep(400);
  log("after Undo: buffer:", JSON.stringify(await buffer()), "unsaved marker:", await unsaved(), "disk:", JSON.stringify(disk()));
  await sleep(2500);
  log("2.5 s after Undo, banner:", JSON.stringify(await notice("disk-changed")));
}

if (step === "compare" || step === "all") {
  log("shell rewrite 2 ->", await shellWrite("agent rewrite two"), "bytes");
  const ms = await waitFor("the banner", () => notice("disk-changed"));
  log(`banner shown ${ms} ms after write 2`);
  await clickIn(ED + " .notice.disk-changed", "Compare");
  await waitFor("the compare view", () => ev(`!!document.querySelector(${JSON.stringify(ED + " .compare-view .cm-mergeView")})`));
  await sleep(500);
  log("compare heads:", JSON.stringify(await ev(`[...document.querySelectorAll(${JSON.stringify(ED + " .compare-head")})].map(e => e.textContent)`)));
  log("compare left (disk) first line:", JSON.stringify(await ev(`document.querySelector(${JSON.stringify(ED + " .cm-merge-a .cm-line")})?.textContent ?? null`)));
  log("compare right (buffer) first line:", JSON.stringify(await ev(`document.querySelector(${JSON.stringify(ED + " .cm-merge-b .cm-line")})?.textContent ?? null`)));
  log("compare bar:", JSON.stringify(await notice("compare-bar")));
  log("shot:", await shot("T-073-compare.png"));
  await clickIn(ED + " .compare-view", "Keep my edits");
  await sleep(300);
  log("after Keep (compare): compare open:", await ev(`!!document.querySelector(${JSON.stringify(ED + " .compare-view")})`), "banner:", JSON.stringify(await notice("disk-changed")));
  await sleep(4500);
  log("4.5 s after Keep, banner:", JSON.stringify(await notice("disk-changed")), "buffer:", JSON.stringify(await buffer()));
}

if (step === "save" || step === "all") {
  // The disk moved on after the load, so Mod+S is refused by the hash check: Keep mine overwrites.
  await focusEd();
  await cdp("key", "s", "2");
  await waitFor("the stale choice", () => notice("save-stale:not(.disk-changed)"));
  log("Mod+S after Keep: stale choice:", JSON.stringify(await notice("save-stale:not(.disk-changed)")), "disk:", JSON.stringify(disk()));
  await clickIn(ED + " .notice.save-stale:not(.disk-changed)", "Keep mine");
  await waitFor("the overwrite", async () => disk().includes("MY EDIT"));
  log("after Keep mine: disk:", JSON.stringify(disk()), "unsaved marker:", await unsaved());
  await sleep(3000);
  log("3 s after the app's own save: banner:", JSON.stringify(await notice("disk-changed")));
  await focusEd();
  await caretEnd();
  await cdp("insert", " +saved");
  await cdp("key", "s", "2");
  await waitFor("the plain save", async () => disk().includes("+saved"));
  log("plain Mod+S: disk:", JSON.stringify(disk()), "unsaved marker:", await unsaved());
  await sleep(3000);
  log("3 s after plain Mod+S: banner:", JSON.stringify(await notice("disk-changed")), "stale:", JSON.stringify(await notice("save-stale")));
}

if (step === "quiet" || step === "all") {
  log("tab clean (unsaved marker):", await unsaved());
  log("shell rewrite 3 ->", await shellWrite("agent rewrite three"), "bytes");
  const ms = await waitFor("the quiet reload", async () => (await buffer()) === "agent rewrite three");
  log(`clean tab took the disk copy ${ms} ms after write 3; buffer:`, JSON.stringify(await buffer()), "banner:", JSON.stringify(await notice("disk-changed")), "toast:", JSON.stringify(await notice("disk-undo")));
}

if (step === "guard" || step === "all") {
  await focusEd();
  await caretEnd();
  await cdp("insert", "!");
  log("typed '!': buffer:", JSON.stringify(await buffer()), "unsaved:", await unsaved());
  const before = statSync(FILE);
  // Same size, old modified time put back: the stamp cannot tell.
  log("same-size rewrite + mtime restored:", await ps(`$f='${FILE}'; $t=(Get-Item -LiteralPath $f).LastWriteTimeUtc; Set-Content -LiteralPath $f -Value 'AGENT REWRITE THREE' -NoNewline -Encoding ascii; (Get-Item -LiteralPath $f).LastWriteTimeUtc=$t; "$((Get-Item -LiteralPath $f).Length) bytes, mtime $((Get-Item -LiteralPath $f).LastWriteTimeUtc.ToString('o'))"`));
  const after = statSync(FILE);
  log("stamp before/after:", before.mtimeMs, before.size, "/", after.mtimeMs, after.size);
  await sleep(4500);
  log("4.5 s later: banner (advisory, expected none):", JSON.stringify(await notice("disk-changed")));
  await focusEd();
  await cdp("key", "s", "2");
  await waitFor("the guard's refusal", () => notice("save-stale:not(.disk-changed)"));
  log("Mod+S: refused with:", JSON.stringify(await notice("save-stale:not(.disk-changed)")), "disk:", JSON.stringify(disk()));
  await clickIn(ED + " .notice.save-stale:not(.disk-changed)", "Reload");
  await sleep(500);
  log("Reload from the refusal: buffer:", JSON.stringify(await buffer()), "unsaved:", await unsaved());
}
if (step === "readfail") {
  const { spawn } = await import("node:child_process");
  await focusEd();
  await caretEnd();
  await cdp("insert", " edit4");
  log("shell rewrite 4 ->", await shellWrite("agent rewrite four"), "bytes");
  await waitFor("the banner", () => notice("disk-changed"));
  log("banner:", JSON.stringify(await notice("disk-changed")));
  // Hold the file open with no sharing, so the Compare view's read fails.
  const lock = spawn("powershell", ["-NoProfile", "-Command", `$f=[IO.File]::Open('${FILE}','Open','ReadWrite','None'); 'locked'; Start-Sleep 8; $f.Close()`], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((r) => lock.stdout.once("data", r));
  log("file locked (FileShare None)");
  await clickIn(ED + " .notice.disk-changed", "Compare");
  await waitFor("the failed read", () => ev(`!!document.querySelector(${JSON.stringify(ED + " .compare-failed")})`));
  log("compare left side:", JSON.stringify(await ev(`document.querySelector(${JSON.stringify(ED + " .compare-failed")}).textContent`)));
  log("compare right (buffer) first line:", JSON.stringify(await ev(`document.querySelector(${JSON.stringify(ED + " .compare-view .cm-content .cm-line")})?.textContent ?? null`)));
  await clickIn(ED + " .compare-view", "Close");
  await new Promise((r) => lock.once("exit", r));
  log("lock released; banner back after Close:", JSON.stringify(await notice("disk-changed")));
  await clickIn(ED + " .notice.disk-changed", "Keep my edits");
}
log("done");
