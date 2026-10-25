// S5 hard kill: the app process is killed (taskkill /F /T on its own pid, no graceful path) while layout saves are in
// flight, 10 times. Bars each time: settings.json (or its .bak) still parses, state.db passes an integrity check, the
// app relaunches, and the panes it restores are the panes the settings on disk describe.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TERM, addProjectAndOpen, gitInit, installProbe, pageErrors, seedProfile } from "./lib.mjs";

export const title = "Hard kill during layout saves (10 times)";
export const seed = seedProfile;
const KILLS = 10;

// In the page, not awaited: opens and closes terminal tabs every ~40 ms (each one writes the layout), 3..8 panes.
const CHURN_JS = `(() => {
  window.__churn = { stop: false, ops: 0 };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const panes = () => [...document.querySelectorAll(${JSON.stringify(TERM)})];
  (async () => {
    while (!window.__churn.stop) {
      try {
        if (panes().length < 8 && (panes().length < 3 || window.__churn.ops % 3 !== 2)) {
          document.querySelector("button.newtab").click();
          let item = null;
          for (let i = 0; i < 50 && !item; i++) { await sleep(10); item = [...document.querySelectorAll('[role="menu"][aria-label="New tab"] [role="menuitem"]')].find((x) => /^\\s*Terminal\\s*$/.test((x.querySelector(".name") ?? x).textContent || "")); }
          item?.click();
        } else {
          panes()[panes().length - 1]?.querySelector('button[title^="Close pane"]')?.click();
          await sleep(30);
          const d = document.querySelector('[role="alertdialog"] .btn-row');
          if (d) [...d.querySelectorAll("button")].find((x) => /danger|primary/.test(x.className))?.click();
        }
        window.__churn.ops++;
      } catch (e) { /* the page is going away */ }
      await sleep(40);
    }
  })();
  return "churning";
})()`;

// state.db opened read-only in Python's sqlite3 (isolated mode): the integrity check and the kv row count.
const dbCheck = async (app, db) => {
  const code = `import sqlite3,sys\nc=sqlite3.connect('file:'+sys.argv[1].replace('\\\\','/')+'?mode=ro',uri=True)\nprint(c.execute('pragma integrity_check').fetchone()[0],c.execute('select count(*) from kv').fetchone()[0])`;
  try {
    return (await app.run("python", ["-I", "-c", code, db])).stdout.trim();
  } catch (e) {
    return `ERR ${(e.stderr || e.message).toString().trim().split("\n").pop().slice(0, 120)}`;
  }
};
const parses = (f) => {
  if (!existsSync(f)) return "absent";
  try {
    const v = JSON.parse(readFileSync(f, "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? "ok" : "not an object";
  } catch (e) {
    return `BAD ${e.message.slice(0, 60)}`;
  }
};
const savedPanes = (f) => {
  try {
    return (readFileSync(f, "utf8").match(/"agent":/g) ?? []).length;
  } catch {
    return -1;
  }
};

export async function run({ launch, checks }) {
  const app = await launch("s5");
  const repo = join(app.temp, "repo");
  await gitInit(app, repo, "s5");
  await installProbe(app);
  await addProjectAndOpen(app, repo);
  const { profile, settings } = app.paths;
  await app.sleep(2500);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const rows = [];
  for (let k = 1; k <= KILLS; k++) {
    const row = { k };
    await app.evalJs(CHURN_JS);
    const delay = Math.round(200 + rnd() * 1300);
    await app.sleep(delay);
    const pid = app.pid;
    const tree = await app.treeOf(pid);
    // The hard kill: this app's own pid and its descendants, nothing else.
    await app.run("taskkill", ["/PID", String(pid), "/T", "/F"]).catch(() => {});
    await app.treeGone([{ pid, name: "kolux-rs.exe", created: undefined }, ...tree]).catch(() => {});
    await app.sleep(1500);
    row.delay = delay;
    row.settings = parses(settings);
    row.bak = parses(`${settings}.bak`);
    row.db = await dbCheck(app, join(profile, "state.db"));
    row.tmp = readdirSync(profile).filter((f) => /\.tmp$/.test(f));
    row.corruptCopies = readdirSync(profile).filter((f) => /\.(corrupt-|damaged-)/.test(f)).length;
    row.expected = savedPanes(settings);
    const t0 = Date.now();
    try {
      await app.relaunch();
      row.upS = ((Date.now() - t0) / 1000).toFixed(1);
      await installProbe(app);
      await app.sleep(4000);
      row.restored = await app.count(TERM);
      row.errs = (await pageErrors(app)).length;
      row.getSettings = await app.invoke("get_settings").then((s) => (s && typeof s === "object" ? `${Object.keys(s).length} keys` : "empty"), (e) => `ERR ${e.message.slice(0, 80)}`);
    } catch (e) {
      row.relaunchError = e.message.slice(0, 160);
    }
    rows.push(row);
    console.log(`  kill ${k}: ${JSON.stringify(row)}`);
    if (row.relaunchError) break;
  }
  const bad = (pred) => rows.filter(pred).map((r) => r.k);
  checks.add(`app was killed ${KILLS} times mid layout save`, `${KILLS} kills`, `${rows.length} kills; delays after churn start [${rows.map((r) => r.delay).join(" ")}] ms`, rows.length === KILLS);
  checks.add("settings.json parses after every kill (or is absent while the .bak parses)", "10 of 10", `${rows.filter((r) => r.settings === "ok" || (r.settings === "absent" && r.bak === "ok")).length} of ${rows.length}; states [${rows.map((r) => r.settings).join(" ")}]; bad kills [${bad((r) => !(r.settings === "ok" || (r.settings === "absent" && r.bak === "ok"))).join(" ") || "none"}]`, bad((r) => !(r.settings === "ok" || (r.settings === "absent" && r.bak === "ok"))).length === 0);
  checks.add("settings.json.bak is never left unparseable", "ok or absent every time", `[${rows.map((r) => r.bak).join(" ")}]`, rows.every((r) => r.bak === "ok" || r.bak === "absent"));
  checks.add("state.db passes the SQLite integrity check after every kill", "ok every time", `[${rows.map((r) => r.db).join(" | ")}]`, rows.every((r) => r.db.startsWith("ok")));
  checks.add("the app relaunches after every kill", "10 of 10, page up", `${rows.filter((r) => r.upS).length} of ${rows.length}; up in [${rows.map((r) => r.upS ?? "NO").join(" ")}] s${rows.some((r) => r.relaunchError) ? `; ${rows.find((r) => r.relaunchError).relaunchError}` : ""}`, rows.length === KILLS && rows.every((r) => r.upS));
  checks.add("the restored panes are the panes the settings on disk describe", "restored count == saved pane entries, every time", `[${rows.map((r) => `${r.restored ?? "?"}/${r.expected}`).join(" ")}] (restored/saved)`, rows.every((r) => r.restored === r.expected && r.expected > 0));
  checks.add("get_settings answers and page errors stay 0 after every relaunch", "no error", `[${rows.map((r) => `${r.getSettings}${r.errs ? ` errs=${r.errs}` : ""}`).join(" | ")}]`, rows.every((r) => r.getSettings && !String(r.getSettings).startsWith("ERR") && !r.errs));
  checks.note(`leftover .tmp files in the profile after a kill (harmless unless read): [${rows.map((r) => r.tmp.join("+") || "-").join(" ")}]; .corrupt/.damaged copies per kill [${rows.map((r) => r.corruptCopies).join(" ")}]`);
}
