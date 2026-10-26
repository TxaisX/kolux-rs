// VIEW-015 acceptance: the real railGroups / pickSession feed the real AgentsRail.
// MIRROR src/App.tsx:2276-2278 (groups = railGroups(panes, saved); selected = pickSession(groups, agentSel)) and App.tsx:2781 (onSelect sets agentSel + focus).
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import AgentsRail from "../AgentsRail";
import { pickSession, railGroups } from "../rail";

const status = () => ({ word: "Idle", tone: "", explain: "" });
const ai = (key: number, agentId: string) => ({ key, agentId, agent: agentId, program: agentId, cwd: `C:/w/app${key}` });
const shell = { key: 9, program: null, cwd: "C:/w/app" };
type Over = { selected?: number | null; onSelect?: (k: number) => void };
const railProps = (groups: unknown, o: Over = {}) => ({ groups: groups as never, selected: o.selected ?? null, classic: false, statusOf: status as never, ringOf: () => null, footer: "", onSelect: o.onSelect ?? (() => {}), onAdd: () => {}, onSettings: () => {} });

function walk(el: unknown, hit: (e: ReactElement<Record<string, unknown>>) => boolean, out: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(el)) el.forEach((c) => walk(c, hit, out));
  else if (el && typeof el === "object" && "props" in el) {
    const e = el as ReactElement<Record<string, unknown>>;
    if (hit(e)) out.push(e);
    walk(e.props.children, hit, out);
  }
  return out;
}

test("box 1: one saved agent with two sessions plus one unmatched Codex session gives two groups, the Codex one under Other sessions", () => {
  const saved = [{ id: "claude", name: "Claude Code" }];
  const groups = railGroups([ai(1, "claude"), ai(2, "claude"), ai(3, "codex"), shell], saved);
  expect(groups.map((g) => [g.name, g.sessions.map((p) => p.key)])).toEqual([
    ["Claude Code", [1, 2]],
    ["Other sessions", [3]],
  ]);
  const html = renderToStaticMarkup(createElement(AgentsRail, railProps(groups)));
  const sections = html.split("<section").slice(1);
  expect(sections).toHaveLength(2);
  expect(sections[0]).toContain('aria-label="Claude Code"');
  expect(sections[0].match(/data-session="/g)).toHaveLength(2);
  expect(sections[1]).toContain('aria-label="Other sessions"');
  expect(sections[1]).toContain('data-session="3"');
  expect(sections[1].match(/data-session="/g)).toHaveLength(1);
  expect(html).not.toContain('data-session="9"'); // the plain shell is never listed
});

test("box 2: select a session, switch screens and back, and the same session is selected", () => {
  const saved = [{ id: "claude", name: "Claude Code" }];
  const groups = railGroups([ai(1, "claude"), ai(2, "claude"), ai(3, "codex")], saved);
  // Stand-in for App's agentSel state: the rail's own row click is what sets it.
  let agentSel: number | null = null;
  let screen = "agents";
  const selectedNow = () => (screen === "agents" ? pickSession(groups, agentSel) : agentSel); // App.tsx:2278
  agentSel = selectedNow(); // first open: first agent's newest session
  expect(agentSel).toBe(2);
  const rail = AgentsRail(railProps(groups, { selected: agentSel, onSelect: (k) => (agentSel = k) }) as never) as ReactElement;
  const row = walk(rail, (e) => e.props["data-session"] === 3)[0];
  (row.props.onClick as () => void)();
  expect(agentSel).toBe(3);
  screen = "terminals";
  expect(selectedNow()).toBe(3);
  screen = "board";
  expect(selectedNow()).toBe(3);
  screen = "agents";
  expect(selectedNow()).toBe(3);
  const html = renderToStaticMarkup(createElement(AgentsRail, railProps(groups, { selected: selectedNow() })));
  expect(html).toMatch(/class="sess sel"[^>]*data-session="3"/);
  expect(html.match(/class="sess sel"/g)).toHaveLength(1);
});
