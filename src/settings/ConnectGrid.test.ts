import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { CONNECT, InstallCardView, stageOf, type ConnectId, type InstallView } from "./ConnectGrid";
import type { AgentInfo } from "../launch/PlusMenu";

const mk = (id: string, installed: boolean): AgentInfo => ({ id, name: id, program: id, args: [], installed, path: installed ? `C:\bin\${id}.exe` : null });
const onlyClaude = [mk("claude", true), mk("codex", false), mk("grok", false), mk("aider", true)];
const noop = () => {};
const card = (id: ConnectId, agents: AgentInfo[] | null, install?: InstallView, canInstall = true) =>
  renderToString(createElement(InstallCardView, { id, stage: stageOf(id, agents, install), install, canInstall, onInstall: noop, onCancel: noop, onPage: noop }));

test("the cards run Claude, Codex, Grok, each with a one-line tagline", () => {
  expect(CONNECT.map((c) => c.id)).toEqual(["claude", "codex", "grok"]);
  for (const c of CONNECT) expect(c.tagline).toMatch(/^[^\n]{10,80}$/);
});

test("only Claude installed: Claude goes to its own card, Codex and Grok offer to install", () => {
  expect(stageOf("claude", onlyClaude)).toBe("installed");
  for (const id of ["codex", "grok"] as const) {
    expect(stageOf(id, onlyClaude)).toBe("not-installed");
    const h = card(id, onlyClaude);
    expect(h).toContain("Not installed");
    expect(h).toContain(">Install<");
  }
});

test("until detection answers, a card is a placeholder and never offers an install", () => {
  for (const c of CONNECT) {
    expect(stageOf(c.id, null)).toBe("loading");
    const h = card(c.id, null);
    expect(h).toContain('aria-busy="true"');
    expect(h).not.toContain("Install");
    expect(h).not.toContain("not on this PC");
  }
});

test("installing shows a progress bar with Cancel and nothing else to press", () => {
  const h = card("codex", onlyClaude, { running: true, progress: 42, attention: null });
  expect(h).toContain('role="progressbar"');
  expect(h).toContain('aria-valuenow="42"');
  expect(h).toContain("width:42%");
  expect(h).toContain(">Cancel<");
  expect(h).not.toContain(">Install<");
  // Even before detection answers, a running install is what the card shows.
  expect(stageOf("codex", null, { running: true, progress: null, attention: null })).toBe("installing");
});

test("a failed install offers Try installing again; a blocked one offers the install page", () => {
  const hung = card("codex", onlyClaude, { running: false, progress: null, attention: { reason: "install-failed", message: "The install was still going after 15 minutes, so Kolux stopped it.", resetsAt: null } });
  expect(hung).toContain("15 minutes");
  expect(hung).toContain("Try installing again");
  expect(hung).not.toContain(">Install<");
  const blocked = card("grok", onlyClaude, { running: false, progress: null, attention: { reason: "smartscreen", message: "Blocked.", resetsAt: null } });
  expect(blocked).toContain("Open install page");
});

test("without the package manager the card offers the install page instead", () => {
  const h = card("grok", onlyClaude, undefined, false);
  expect(h).toContain("Open install page");
  expect(h).not.toContain(">Install<");
});
