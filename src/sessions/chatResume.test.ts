import { expect, test } from "vitest";
import { chatResumeBlock, isRemoteDir, NO_CHAT_AGENT, NO_WORKSPACE, OTHER_WORKSPACE, REMOTE_SESSION } from "./chatResume";

const s = (over: Partial<{ agent: string; dir: string | null; turns: number }> = {}) => ({ agent: "claude", dir: "C:/Dev/kolux", turns: 3, ...over });

test("VIEW-086: a Claude session from another workspace is not offered as chat", () => {
  expect(chatResumeBlock(s({ dir: "C:/Dev/other" }), "C:/Dev/kolux")).toBe(OTHER_WORKSPACE);
  expect(chatResumeBlock(s({ dir: null }), "C:/Dev/kolux")).toBe(OTHER_WORKSPACE);
});

test("VIEW-086: a Claude session in its own workspace is offered, however the slashes and case are written", () => {
  expect(chatResumeBlock(s(), "C:/Dev/kolux")).toBeNull();
  expect(chatResumeBlock(s({ dir: "C:\\Dev\\Kolux\\" }), "c:/dev/kolux")).toBeNull();
});

test("VIEW-086: a Codex session from any workspace is offered", () => {
  expect(chatResumeBlock(s({ agent: "codex", dir: "C:/Dev/other" }), "C:/Dev/kolux")).toBeNull();
  expect(chatResumeBlock(s({ agent: "codex", dir: null }), "C:/Dev/kolux")).toBeNull();
});

test("VIEW-086: remote and WSL sessions are refused, even for Codex", () => {
  for (const dir of ["\\\\wsl$\\Ubuntu\\home\\me\\app", "\\\\wsl.localhost\\Ubuntu\\home\\me", "ssh://box/home/me", "me@box:/srv/app"]) {
    expect(isRemoteDir(dir)).toBe(true);
    expect(chatResumeBlock(s({ agent: "codex", dir }), "C:/Dev/kolux")).toBe(REMOTE_SESSION);
  }
  expect(isRemoteDir("C:/Dev/kolux")).toBe(false);
  expect(isRemoteDir("D:\\work\\a@b")).toBe(false);
  expect(isRemoteDir(null)).toBe(false);
});

test("VIEW-086: agents the chat cannot read, and no open workspace, are told plainly", () => {
  expect(chatResumeBlock(s({ agent: "gemini" }), "C:/Dev/kolux")).toBe(NO_CHAT_AGENT);
  expect(chatResumeBlock(s({ agent: "codex" }), null)).toBe(NO_WORKSPACE);
});
