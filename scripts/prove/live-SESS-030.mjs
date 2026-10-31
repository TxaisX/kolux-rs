// LIVE proof, SESS-030 boxes 1 and 2 (spec/02): a REAL Claude conversation carries on in the same pane after
//   b1: the app is quit through its window and reopened with the same profile;
//   b2: the app process is killed (only the pid this script started, then its recorded children) and reopened.
// Usage: node live-SESS-030.mjs b1|b2. Asserted on Kolux's side: the session id in the saved layout, the restart line (--resume <id>) on
// the process, one Claude only, the pane key unchanged, and the agent's answer after the reopen (it names the code only the first prompt held).
import { readFileSync } from "node:fs";
import { scenario, send, sleep, excerpt } from "./live-claude-common.mjs";
import { waitFor, CLAUDE, dismissFirstRun } from "./live-common.mjs";

const mode = process.argv[2] === "b2" ? "b2" : "b1";
const CODE = mode === "b1" ? "blue-heron-5521" : "green-otter-6637";
const norm = (p) => String(p ?? "").replace(/\\/g, "/").toLowerCase();
const count = (t, s) => t.split(s).length - 1;
const flat = (t) => t.replace(/[│╭╮╰╯]/g, " ").replace(/\s+/g, " ");

await scenario(
  `SESS-030-${mode}`,
  { cards: ["SESS-030"], claudeArgs: "--model haiku --permission-mode manual --settings ${SETTINGS}", settings: { uiLook: "new" } },
  async (ctx, h) => {
    const { app } = ctx;
    const settingsPath = `${app.paths.profile}/settings.json`;
    const saved = () => {
      try {
        let l = JSON.parse(readFileSync(settingsPath, "utf8")).savedLayout;
        if (typeof l === "string") l = JSON.parse(l);
        return (l?.panes ?? []).filter((p) => /claude/i.test(`${p.agent}${p.agentId}`));
      } catch {
        return [];
      }
    };
    const claudes = async () => {
      const tree = await app.treeOf(app.pid);
      const mine = tree.filter((p) => /^claude(\.exe)?$/i.test(p.name));
      const rows = (await app.ps(`Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)|$($_.CommandLine)" }`)).split(/\r?\n/).filter(Boolean);
      return rows.filter((l) => mine.some((c) => l.startsWith(`${c.pid}|`)));
    };

    // Launch 1: one fixed prompt the second launch can be asked about.
    const tSend = await send(ctx, `Remember this code: ${CODE}. Reply with only the word noted.`);
    await ctx.waitEvent((e) => e.t >= tSend && e.state === "done", 120000, "the agent to finish its answer");
    const key1 = await ctx.paneKey();
    h.log(`launch 1: pane key ${key1}; events ${(await ctx.events()).map((e) => e.state).join(">")}`);
    const sess = await waitFor("the session id in the saved layout", async () => saved().find((p) => p.session)?.session ?? null, 30000, 1000);
    const pane1 = saved().find((p) => p.session);
    h.log(`saved layout: ${saved().length} Claude pane(s), pane key ${pane1?.key}, session id ${String(sess).slice(0, 8)}...(${String(sess).length} chars)`);
    h.check("the saved layout holds the Claude pane's session id", !!sess, String(sess).slice(0, 8));
    const before = await claudes();
    h.log(`launch 1 claude: ${before.map((l) => l.replace(/\\/g, "/").slice(0, 200)).join(" ;; ")}`);
    h.check("launch 1 ran with no --resume (a fresh conversation)", before.length === 1 && !/--resume|(^| )-r /.test(before[0]), `count=${before.length}`);
    h.log(`screenshot: ${await h.shot("before")}`);

    // End the app.
    if (mode === "b1") {
      const closed = await app.closeAndCount(app.pid);
      h.log(`b1 quit: ${closed.how}; pre-close tree ${closed.tree.length} (${app.byName(closed.tree)}); survivors ${closed.survivors.length} (${app.byName(closed.survivors)})`);
      await app.killAll(closed.survivors);
    } else {
      const tree = await app.treeOf(app.pid);
      const pid = app.pid;
      h.log(`b2 kill: app pid ${pid} (tree of ${tree.length}); taskkill /PID ${pid} /F (no /T)`);
      await app.run("taskkill", ["/PID", String(pid), "/F"]);
      const gone = await waitFor("the app pid to be gone", async () => !(await app.alive(pid)), 20000, 300).then(() => true, () => false);
      h.check("the app process is dead (killed, not closed)", gone, `pid ${pid}`);
      const left = await app.survivorsOf(tree);
      h.log(`children of the killed app still running: ${left.length} (${app.byName(left)}); ending exactly those recorded pids so the old Claude is not left beside the resumed one`);
      await app.killAll(left);
    }
    await sleep(3000);
    const stillClaude = await app.ps(`(Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Where-Object { $_.CommandLine -like '*${ctx.TEMP.replace(/'/g, "''")}*' } | Measure-Object).Count`);
    h.check("no Claude of this run is left between the two launches", stillClaude === "0", `count ${stillClaude}`);

    // Launch 2: the same profile.
    try {
      await app.relaunch();
    } catch (e) {
      const body = await app.evalJs(`document.body.innerText.replace(/\\s+/g, " ").slice(0, 500) + " || root children " + (document.getElementById("root")?.children.length ?? "none")`).catch((x) => `no page: ${x.message}`);
      h.log(`relaunch did not reach the sidebar: ${e.message}; page says: ${body}; screenshot ${await h.shot("relaunch-stuck")}`);
      throw e;
    }
    await app.evalJs(`(async () => { window.__proveEvents = []; const cb = window.__TAURI_INTERNALS__.transformCallback((e) => window.__proveEvents.push({ t: Date.now(), ...e.payload })); await window.__TAURI_INTERNALS__.invoke("plugin:event|listen", { event: "agent-status", target: { kind: "Any" }, handler: cb }); return true; })()`);
    h.log(`first-run guide on the relaunched profile: ${(await dismissFirstRun(app, h.log)) ? "closed" : "still open"}`);
    await waitFor("a Claude pane back", () => app.shown(CLAUDE), 90000, 500);
    await waitFor("its input field", () => app.exists(`${CLAUDE} .xterm-helper-textarea`), 30000, 500);
    const screen2 = await ctx.ready(120000);
    h.log(`launch 2 screen: ${excerpt(screen2, 4)}`);
    const after = await claudes();
    for (const l of after) h.log(`launch 2 claude: ${l.replace(/\\/g, "/").slice(0, 240)}`);
    h.check("exactly one Claude runs and its exe is the Claude on the registry PATH", after.length === 1 && norm(after[0].split("|")[1]) === norm("%USERPROFILE%/.local/bin/claude.exe"), `count=${after.length}`);
    h.check("it was started on the resume line with the saved session id", after.length === 1 && after[0].includes(sess) && /--resume|(^| )-r /.test(after[0]), `resume=${/--resume/.test(after[0] ?? "")} id=${(after[0] ?? "").includes(sess)}`);
    h.check("one Claude pane is shown (the tab list and the panes agree)", (await app.shown(CLAUDE)) === 1, `${await app.shown(CLAUDE)}`);
    const keptKey = saved().find((p) => p.session === sess)?.key;
    h.check("the same pane key carries the session", keptKey === pane1?.key, `${keptKey} vs ${pane1?.key}`);

    // The conversation itself: ask for the code, which only the first prompt held.
    const rowsWith = async () => (await ctx.screenText()).split("\n").map((l) => flat(l).trim()).filter((l) => l.includes(CODE));
    const n0 = (await rowsWith()).length;
    const t2 = await send(ctx, "What code did I ask you to remember? Reply with the code only.");
    const sawWork = await ctx.waitEvent((e) => e.t >= t2 && e.state === "done", 120000, "the agent to answer").then(() => true, () => false);
    await sleep(1500);
    const rows = await rowsWith();
    const answer = rows.find((l) => new RegExp(`^●\\s*\`?${CODE}`).test(l));
    h.log(`after the reopen: screen rows holding the code: ${n0} before the question, ${rows.length} after; answer row: ${answer ?? "(none)"}; rows: ${JSON.stringify(rows.map((l) => l.slice(0, 80)))}; tail: ${excerpt(await ctx.screenText(), 6)}`);
    h.check("the resumed agent answers with the code from before the quit", sawWork && !!answer, `answer row ${answer ?? "none"}`);
    const key2 = await ctx.paneKey();
    h.log(`launch 2 events: ${(await ctx.events()).map((e) => `${e.state}${e.tool ? `/${e.tool}` : ""}`).join(">")}; pane key ${key2}`);
    h.log(`screenshot: ${await h.shot("after")}`);
  },
);
