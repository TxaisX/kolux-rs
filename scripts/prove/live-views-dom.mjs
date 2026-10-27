// DOM readings shared by the spec/05 live proofs (VIEW-*): which workspace screen is up and what chrome is visible.
import { reporter, startPlain, finish, sleep, waitFor, TERM } from "./live-common.mjs";

export { reporter, startPlain, finish, sleep, waitFor, TERM };

/** One reading of the page: the highlighted switch label(s) and which screen roots / sidebars are really visible. */
export const SNAP_JS = `(() => {
  const vis = (e) => !!e && e.offsetParent !== null && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
  const q = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  return {
    labels: all(".switcher button").map((b) => b.textContent.trim()),
    pressed: all(".switcher button[aria-pressed='true']").map((b) => b.textContent.trim()),
    topbar: vis(q("header.topbar, .topbar")),
    board: vis(q(".board")),
    grid: vis(q(".grid:not(.agents)")),
    agentsGrid: vis(q(".grid.agents")),
    worktreeSidebar: all(".sidebar-wrap:not(.rail-wrap)").some(vis),
    rail: all(".rail-wrap").some(vis),
    panes: all(${JSON.stringify(TERM)}).filter(vis).length,
    cards: all("section.pane.card").filter(vis).length,
  };
})()`;

export const snap = (app) => app.evalJs(SNAP_JS);

/** Clicks the switch label with this exact text. */
export const pickScreen = (app, label) => app.clickWhere(".switcher button", `/^\\s*${label}\\s*$/`);

/** Sets up the shared pass/fail bookkeeping of a live script. */
export function checker(log) {
  const asserts = [];
  const check = (name, pass, detail) => {
    asserts.push(!!pass);
    log(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`);
  };
  return { check, allPassed: () => asserts.length > 0 && asserts.every(Boolean) };
}
