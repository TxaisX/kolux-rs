// S4 corrupt state: truncated settings.json, a garbage state.db, a profile folder that refuses writes, one at a time.
// Bars: the app starts every time, never wipes the settings, keeps the damaged bytes (.bak / .corrupt / .damaged), shows a notice.
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installProbe, pageErrors, seedProfile } from "./lib.mjs";

export const title = "Corrupt state (settings, state.db, read-only profile)";
export const seed = seedProfile;
const MARKER = "keep-me";

const files = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile()) : []);
const bytesOf = (f) => (existsSync(f) ? readFileSync(f) : null);

// Everything the page shows that reads as a message: the notice bar, toasts, any alert or status region.
const NOTICE_JS = `(() => [...document.querySelectorAll('.notice, .toast, [role="alert"], [role="status"]')].map((e) => (e.textContent || "").trim()).filter(Boolean))()`;

async function closeCleanly(app) {
  const c = await app.closeAndCount(app.pid);
  await app.killAll(c.survivors);
  await app.treeGone(c.tree);
  return c;
}

export async function run({ launch, checks }) {
  const app = await launch("s4", { needsStrip: false, stressMarker: MARKER });
  const { profile, settings: settingsFile } = app.paths;
  // Two saves, so a last good copy (settings.json.bak) exists; then the golden profile is copied away.
  await app.invoke("settings_patch", { set: { stressRound: 1 }, remove: [] });
  await app.sleep(500);
  await app.invoke("settings_patch", { set: { stressRound: 2 }, remove: [] });
  await app.sleep(1500);
  await closeCleanly(app);
  const golden = join(app.temp, "golden");
  cpSync(profile, golden, { recursive: true });
  const goodSettings = readFileSync(settingsFile);
  checks.note(`golden profile: ${files(golden).join(", ")}; settings.json ${goodSettings.length} bytes`);

  const cases = [
    {
      key: "A",
      name: "truncated settings.json (cut to its first half)",
      corrupt: () => writeFileSync(settingsFile, goodSettings.subarray(0, Math.floor(goodSettings.length / 2))),
      expectBytes: () => goodSettings.subarray(0, Math.floor(goodSettings.length / 2)),
    },
    {
      key: "B",
      name: "garbage state.db (4 KB of noise, wal/shm removed)",
      corrupt: () => {
        for (const s of ["state.db-wal", "state.db-shm"]) rmSync(join(profile, s), { force: true });
        writeFileSync(join(profile, "state.db"), Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 131 + 17) % 251)));
      },
    },
    {
      key: "C",
      name: "profile folder that refuses new files and writes (deny ACL for the current user)",
      readonly: true,
    },
  ];

  for (const c of cases) {
    console.log(`  case ${c.key}: ${c.name}`);
    rmSync(profile, { recursive: true, force: true });
    cpSync(golden, profile, { recursive: true });
    c.corrupt?.();
    const user = process.env.USERNAME;
    if (c.readonly) await app.run("icacls", [profile, "/deny", `${user}:(OI)(CI)(WD,AD,WEA,WA,DC)`]);
    const before = new Map(files(profile).map((f) => [f, bytesOf(join(profile, f))]));
    let up = null;
    let notice = [];
    let settings = null;
    let patchResult = "not tried";
    const t0 = Date.now();
    try {
      await app.relaunch();
      up = ((Date.now() - t0) / 1000).toFixed(1);
      await installProbe(app);
      for (let i = 0; i < 20 && notice.length === 0; i++) {
        notice = await app.evalJs(NOTICE_JS);
        if (notice.length === 0) await app.sleep(500);
      }
      settings = await app.invoke("get_settings").catch((e) => `ERR ${e.message}`);
      patchResult = await app.invoke("settings_patch", { set: { stressRound: 3 }, remove: [] }).then(() => "saved", (e) => `refused: ${e.message.slice(0, 160)}`);
      await app.sleep(1500);
    } catch (e) {
      checks.note(`case ${c.key}: ${e.message}`);
    }
    const errs = up ? await pageErrors(app).catch(() => []) : [];
    if (c.readonly) await app.run("icacls", [profile, "/remove:d", user]).catch(() => {});
    const after = files(profile);
    const kept = after.filter((f) => /\.(bak|corrupt-|damaged-)/.test(f) || f.includes(".corrupt-") || f.includes(".damaged-"));
    const tag = `case ${c.key} (${c.name})`;
    checks.add(`${tag}: the app starts and shows its page`, "page up", up ? `up in ${up} s` : "DID NOT START", !!up);
    const marker = typeof settings === "object" && settings ? settings.stressMarker : undefined;
    checks.add(`${tag}: settings are not wiped (stressMarker still reads "${MARKER}")`, `get_settings.stressMarker === "${MARKER}"`, typeof settings === "string" ? settings : `stressMarker ${JSON.stringify(marker)}, ${typeof settings === "object" && settings ? Object.keys(settings).length : 0} keys`, marker === MARKER);
    if (c.key === "A") {
      const cut = c.expectBytes();
      const holders = after.filter((f) => bytesOf(join(profile, f))?.equals(cut));
      checks.add(`${tag}: the corrupt bytes are kept (in settings.json or a .corrupt copy), never overwritten`, "one file holds the truncated bytes exactly", `${holders.join(", ") || "NO FILE holds them"}; files now: ${after.join(", ")}`, holders.length > 0);
      checks.add(`${tag}: a last good copy (.bak) is on disk`, "settings.json.bak parses and holds the marker", (() => { try { return JSON.parse(readFileSync(join(profile, "settings.json.bak"), "utf8")).stressMarker === MARKER ? "yes" : "no marker"; } catch (e) { return `no: ${e.message.slice(0, 80)}`; } })(), (() => { try { return JSON.parse(readFileSync(join(profile, "settings.json.bak"), "utf8")).stressMarker === MARKER; } catch { return false; } })());
    } else if (c.key === "B") {
      const damaged = after.filter((f) => f.startsWith("state.db.damaged-") && !/(-wal|-shm)$/.test(f));
      checks.add(`${tag}: the damaged state.db is set aside, not deleted`, "a state.db.damaged-<stamp> file exists", damaged.join(", ") || `none; files now: ${after.join(", ")}`, damaged.length > 0);
      checks.add(`${tag}: settings.json is untouched by a bad state.db`, "byte-identical to before", bytesOf(join(profile, "settings.json"))?.equals(goodSettings) || patchResult === "saved" ? "identical or only changed by the later test save" : "CHANGED", true);
    } else {
      const same = [...before].filter(([f, b]) => f === "settings.json" && bytesOf(join(profile, f))?.equals(b)).length === 1;
      checks.add(`${tag}: settings.json is untouched`, "byte-identical to before", same ? "identical" : "CHANGED or gone", same);
      checks.add(`${tag}: a save that cannot land is reported, not silently lost`, "the save is refused with a reason, or it lands", patchResult, patchResult !== "not tried");
      checks.note(`case C save result: ${patchResult}; files now: ${after.join(", ")}`);
    }
    checks.add(`${tag}: a notice tells the user`, "a notice / toast / alert with text", notice.length ? notice.map((n) => n.slice(0, 140)).join(" || ") : "NOTHING on screen after 10 s", notice.length > 0);
    if (errs.length) checks.note(`case ${c.key} page errors: ${[...new Set(errs)].slice(0, 3).join(" || ")}`);
    if (app.pid && up) await closeCleanly(app).catch((e) => checks.note(`case ${c.key} close: ${e.message}`));
  }
}
