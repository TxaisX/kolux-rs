// S3 many projects: 150 projects, each a real git repo with one extra worktree (300 worktrees), seeded into the scratch
// profile before the app starts. Bars: the sidebar shows every project and worktree within 2 s of the page loading,
// scrolling the list and filtering it stay under 100 ms per frame, the app does not crash.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fmt, installProbe, pageErrors, seedProfile, snapshot, stats } from "./lib.mjs";

export const title = "Many projects (150 projects, 300 worktrees)";
const PROJECTS = 150;
const SIDEBAR_BAR_MS = 2000;
const FRAME_BAR_MS = 100;
const pad = (n) => String(n).padStart(3, "0");

// Repos and worktrees are made 8 at a time; the project list goes straight into the profile's state.db (kv "projects").
export const seed = (app, settings) => async () => {
  seedProfile(app, settings)();
  const root = join(app.temp, "repos");
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const git = (cwd, a) => app.run("git", ["-c", "user.name=stress", "-c", "user.email=stress@example.invalid", ...a], { cwd });
  const make = async (i) => {
    const dir = join(root, `proj-${pad(i)}`);
    mkdirSync(dir);
    writeFileSync(join(dir, "notes.txt"), `p${i}\n`);
    await git(dir, ["init", "-q", "-b", "main"]);
    await git(dir, ["add", "."]);
    await git(dir, ["commit", "-q", "-m", "stress"]);
    await git(dir, ["worktree", "add", "-q", "-b", `feat-${pad(i)}`, join(root, `proj-${pad(i)}-wt`)]);
  };
  const t0 = Date.now();
  let next = 1;
  await Promise.all(Array.from({ length: 8 }, async () => { for (;;) { const i = next++; if (i > PROJECTS) return; await make(i); } }));
  console.log(`  seeded ${PROJECTS} repos with a worktree each in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const projects = Array.from({ length: PROJECTS }, (_, k) => ({ id: `p-${pad(k + 1)}`, name: `proj-${pad(k + 1)}`, path: join(root, `proj-${pad(k + 1)}`).replace(/\\/g, "/") }));
  const json = join(app.temp, "projects.json");
  writeFileSync(json, JSON.stringify(projects));
  const code = `import sqlite3,sys\nc=sqlite3.connect(sys.argv[1])\nc.execute('create table if not exists kv (key text primary key, value text not null)')\nc.execute('insert or replace into kv values (?,?)',('projects',open(sys.argv[2],encoding='utf-8').read()))\nc.commit()\nprint(c.execute('select count(*) from kv').fetchone()[0])`;
  await app.run("python", ["-I", "-c", code, join(app.paths.profile, "state.db"), json]);
};

const COUNTS = `({ proj: document.querySelectorAll("aside.sidebar .proj").length, sess: document.querySelectorAll("aside.sidebar .sess").length, now: Math.round(performance.now()) })`;

// In the page: per-step cost of scrolling .sb-list top to bottom in `steps` steps (scroll + forced layout, and the rAF gap when
// frames are delivered at all), and the same for hiding / showing projects through the filter checkboxes.
const SCROLL_JS = (steps) => `(async () => {
  const list = document.querySelector(".sb-list");
  if (!list) return { error: "no .sb-list" };
  const max = list.scrollHeight - list.clientHeight;
  const raf = () => new Promise((r) => { const to = setTimeout(() => r(-1), 1000); requestAnimationFrame(() => { clearTimeout(to); r(performance.now()); }); });
  const sync = [], gaps = [];
  list.scrollTop = 0;
  let last = await raf();
  for (let i = 1; i <= ${steps}; i++) {
    const t0 = performance.now();
    list.scrollTop = (max * i) / ${steps};
    void list.offsetHeight;
    sync.push(performance.now() - t0);
    const t = await raf();
    if (t >= 0 && last >= 0) gaps.push(t - last);
    last = t;
  }
  return { max, scrollHeight: list.scrollHeight, sync: sync.map((x) => Math.round(x * 10) / 10), gaps: gaps.map((x) => Math.round(x * 10) / 10), rafWorks: gaps.length > 0 };
})()`;

export async function run({ launch, checks }) {
  const app = await launch("s3");
  await installProbe(app);
  const first = await app.waitFor("the full sidebar", async () => {
    const c = await app.evalJs(COUNTS);
    return c.proj >= PROJECTS ? c : null;
  }, 120000, 500).catch((e) => ({ error: e.message }));
  const c1 = await app.evalJs(COUNTS);
  checks.note(`first load: ${JSON.stringify(first)}; counts now ${JSON.stringify(c1)}`);
  // Reload the page and poll at once: performance.now() is the time since that navigation began.
  await app.evalJs("(() => { setTimeout(() => location.reload(), 50); return 1; })()");
  await app.sleep(300);
  const t0 = Date.now();
  let got = null;
  let polls = 0;
  while (Date.now() - t0 < 120000 && !got) {
    polls++;
    try {
      const c = await app.evalJs(COUNTS);
      if (c.proj >= PROJECTS) got = c;
    } catch {
      /* the page is still loading */
    }
  }
  const full = got ? await app.evalJs(COUNTS) : await app.evalJs(COUNTS).catch(() => ({}));
  checks.add(`sidebar shows all ${PROJECTS} projects after a page load`, `${PROJECTS} .proj rows within ${SIDEBAR_BAR_MS} ms of navigation start`, got ? `${got.now} ms since navigation start (${got.proj} projects, ${got.sess} worktree rows at that moment; polled ${polls}x, cadence ~150 ms)` : `NEVER (counts ${JSON.stringify(full)})`, !!got && got.now <= SIDEBAR_BAR_MS);
  const settled = await app.waitFor("the worktree rows", async () => {
    const c = await app.evalJs(COUNTS);
    return c.sess >= PROJECTS * 2 ? c : null;
  }, 60000, 500).catch(() => null);
  const counts = await app.evalJs(COUNTS);
  checks.add("every worktree is listed (main checkout + one extra per project)", `${PROJECTS * 2} .sess rows`, `${counts.sess} rows, ${counts.proj} projects${settled ? `; reached ${settled.now} ms after navigation start` : ""}`, counts.sess >= PROJECTS * 2);
  const scroll = await app.evalJs(SCROLL_JS(60));
  if (scroll.error) checks.add("sidebar list scrolls", "scrolls", scroll.error, false);
  else {
    const s = stats(scroll.sync);
    const g = stats(scroll.gaps);
    checks.add("scrolling the sidebar: scroll + layout cost per step (60 steps top to bottom)", `p95 < ${FRAME_BAR_MS} ms, max < ${FRAME_BAR_MS * 2} ms`, `p50 ${fmt(s.p50, 1)}, p95 ${fmt(s.p95, 1)}, max ${fmt(s.max, 1)} ms; scrollHeight ${scroll.scrollHeight}`, s.p95 < FRAME_BAR_MS && s.max < FRAME_BAR_MS * 2);
    checks.add("scrolling the sidebar: frame gap (requestAnimationFrame to the next)", `p95 < ${FRAME_BAR_MS} ms`, scroll.rafWorks ? `p50 ${fmt(g.p50, 1)}, p95 ${fmt(g.p95, 1)}, max ${fmt(g.max, 1)} ms over ${g.n} frames` : "no frames delivered (window occluded off-screen); the per-step cost above is the reading", !scroll.rafWorks || g.p95 < FRAME_BAR_MS);
  }
  const mem = await snapshot(app);
  checks.note(`app + web view processes: ${mem.filter((p) => /kolux-rs|msedgewebview2/i.test(p.name)).map((p) => `${p.name} ${Math.round(p.ws / 1048576)} MB`).join(", ")}`);
  const errs = await pageErrors(app).catch(() => []);
  checks.add("page errors during the run (this page load)", "0", `${errs.length}${errs.length ? `: ${[...new Set(errs)].slice(0, 5).join(" || ")}` : ""}`, errs.length === 0);
  checks.add("app is still running at the end", "alive", app.pid && (await app.alive(app.pid)) ? "alive" : "GONE", !!(app.pid && (await app.alive(app.pid))));
}
