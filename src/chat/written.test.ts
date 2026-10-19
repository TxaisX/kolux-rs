// T-332 (CHAT-028): the files the agent wrote, listed under a finished turn, and sent to another agent's draft.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { ChatItem, Row } from "./model";
import { handOver } from "./model";
import { WRITTEN_LIMIT, fold, writtenFiles, type FileDiff, type View } from "./steps";
import { FilesRow } from "./ChatView";

const msg = (item: ChatItem): Row => ({ ...item, row: "message" });
const user = (id: string, at: number) => msg({ id, role: "user", kind: "text", text: "go", at });
const say = (id: string, at: number) => msg({ id, role: "assistant", kind: "text", text: "done", at });
const wrote = (id: string, at: number, path: string, change: FileDiff["change"] = "added") =>
  msg({ id, role: "assistant", kind: "tool", text: "", at, tool: { call: id, name: "Write", group: "edit", preview: path, done: true, failed: false, background: false, diffs: [{ path, change, lines: [], hidden: 0 }] } });
const files = (v: View[]) => v.filter((x): x is Extract<View, { row: "files" }> => x.row === "files");
const names = (v: View[]) => files(v).flatMap((f) => f.files.map((x) => x.path));
const six = ["C:/w/a.md", "C:/w/b.md", "C:/w/c.md", "C:/w/d.md", "C:/w/e.md", "C:/w/f.md"];
const turnWith = (paths: string[]) => [user("u", 0), ...paths.map((p, i) => wrote(`w${i}`, 1000 + i, p)), say("m", 9000)];

describe("the files a finished turn wrote (CHAT-028 acceptance 1)", () => {
  it("lists the four newest of six, newest first", () => {
    const v = fold(turnWith(six), false);
    expect(WRITTEN_LIMIT).toBe(4);
    expect(names(v)).toEqual(["C:/w/f.md", "C:/w/e.md", "C:/w/d.md", "C:/w/c.md"]);
  });
  it("sits under the turn's last reply, below the worked-for line", () => {
    const v = fold(turnWith(six), false);
    expect(v.map((x) => x.row)).toEqual(["message", "diff", "diff", "diff", "diff", "diff", "diff", "message", "worked", "files"]);
  });
  it("lists a file edited twice once, at its latest place", () => {
    const v = fold([user("u", 0), wrote("1", 1000, "C:/w/a.md"), wrote("2", 2000, "C:/w/b.md"), wrote("3", 3000, "C:/w/a.md", "edited"), say("m", 4000)], false);
    expect(files(v)[0].files).toEqual([
      { path: "C:/w/a.md", change: "edited" },
      { path: "C:/w/b.md", change: "added" },
    ]);
  });
  it("folds Windows spellings of one path into one", () => {
    expect(writtenFiles([wrote("1", 1, "C:\\W\\a.md"), wrote("2", 2, "c:/w/A.md", "edited")].map((r) => r as ChatItem))).toHaveLength(1);
  });
  it("leaves out deleted files and lists the new name of a renamed one", () => {
    const v = fold([user("u", 0), wrote("1", 1000, "C:/w/gone.md", "deleted"), wrote("2", 2000, "C:/w/new.md", "renamed"), say("m", 3000)], false);
    expect(names(v)).toEqual(["C:/w/new.md"]);
  });
  it("shows no row when the turn wrote nothing, and reads do not count", () => {
    const read = msg({ id: "r", role: "assistant", kind: "tool", text: "", at: 1, tool: { call: "r", name: "Read", group: "read", preview: "a.md", done: true, failed: false, background: false } });
    expect(files(fold([user("u", 0), read, say("m", 5000)], false))).toHaveLength(0);
  });
  it("waits for the turn to finish: a turn still under way lists nothing yet", () => {
    expect(files(fold([user("u", 0), wrote("1", 1000, "C:/w/a.md")], true))).toHaveLength(0);
    expect(files(fold([user("u", 0), wrote("1", 1000, "C:/w/a.md")], false))).toHaveLength(1);
  });
  it("gives each finished turn its own row under it, before the next message", () => {
    const v = fold([user("u1", 0), wrote("1", 1000, "C:/w/a.md"), say("m1", 2000), user("u2", 3000), wrote("2", 4000, "C:/w/b.md"), say("m2", 5000)], false);
    expect(files(v).map((f) => f.files.map((x) => x.path))).toEqual([["C:/w/a.md"], ["C:/w/b.md"]]);
    const firstAt = v.findIndex((x) => x.row === "files");
    expect(v[firstAt + 1]).toMatchObject({ row: "message", id: "u2" });
  });
  it("still lists what an interrupted turn wrote before it stopped", () => {
    const stop = msg({ id: "i", role: "status", kind: "interrupted", text: "Interrupted", at: 2000 });
    expect(names(fold([user("u", 0), wrote("1", 1000, "C:/w/a.md"), stop], false))).toEqual(["C:/w/a.md"]);
  });
});

describe("sending a file to another agent (CHAT-028 acceptance 2)", () => {
  const log = () => {
    const l = { drafts: new Map<number, string>([[2, ""]]), picked: [] as number[], said: [] as string[], terminalWrites: 0 };
    return { l, io: { draftOf: (k: number) => l.drafts.get(k) ?? "", keepDraft: (k: number, t: string) => void l.drafts.set(k, t), pick: (k: number) => void l.picked.push(k), say: (t: string) => void l.said.push(t) } };
  };
  it("puts the path in the other agent's draft after what is typed there, and writes to no terminal", () => {
    const { l, io } = log();
    l.drafts.set(2, "please review");
    expect(handOver(2, "docs", "C:/w/a.md", io)).toBe(true);
    expect(l.drafts.get(2)).toBe("please review\n\nC:/w/a.md");
    expect(l.terminalWrites).toBe(0);
  });
  it("quotes a path with a space so the other agent reads it as one", () => {
    const { l, io } = log();
    handOver(2, "docs", "C:/my files/a.md", io);
    expect(l.drafts.get(2)).toBe('"C:/my files/a.md"');
  });
  it("lists the sessions to send to beside each file, and tells which file was picked", () => {
    const picked: [number, string][] = [];
    const html = renderToStaticMarkup(
      createElement(FilesRow, { id: "files-u", files: [{ path: "C:/w/a.md", change: "added" }, { path: "C:/w/b.md", change: "edited" }], targets: [{ key: 2, label: "docs" }], onSend: (k: number, p: string) => void picked.push([k, p]), note: null }),
    );
    expect(html).toContain("a.md");
    expect(html).toContain('title="C:/w/a.md"');
    expect(html.match(/Send to…/g)).toHaveLength(2);
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain("docs");
  });
  it("shows the file's name for a Windows path, the full path on hover", () => {
    const html = renderToStaticMarkup(createElement(FilesRow, { id: "f", files: [{ path: "C:\\repo\\docs\\plan.md", change: "edited" }], targets: [], onSend: () => {}, note: null }));
    expect(html).toContain(">plan.md</span>");
    expect(html).toContain("C:\\repo\\docs\\plan.md");
  });
  it("offers no send menu when there is no other agent, and shows a refusal note", () => {
    const html = renderToStaticMarkup(createElement(FilesRow, { id: "f", files: [{ path: "C:/w/a.md", change: "added" }], targets: [], onSend: () => {}, note: "That is too long." }));
    expect(html).not.toContain("Send to");
    expect(html).toContain("That is too long.");
  });
});

// FIX-2 (stand-in review of 47de0346, item 6): a Codex patch names files relative to the agent's own folder; handed to
// another agent in another folder that path would mean a different file. The list holds full paths, resolved against the
// pane's working folder, and a path that cannot be resolved is not offered for sending.
describe("FIX-2: written paths are resolved against the pane's folder", () => {
  const cwd = "C:\\work\\x";
  it("lists a Codex relative path as a full path in the pane's folder", () => {
    const v = fold([user("u", 0), wrote("1", 1000, "src/app.ts"), wrote("2", 2000, "..\\y\\b.ts", "edited"), say("m", 3000)], false, cwd);
    expect(names(v)).toEqual(["C:\\work\\y\\b.ts", "C:\\work\\x\\src\\app.ts"]);
  });
  it("keeps an absolute path as it is", () => {
    expect(names(fold([user("u", 0), wrote("1", 1000, "C:/w/a.md"), say("m", 3000)], false, cwd))).toEqual(["C:/w/a.md"]);
  });
  it("folds a relative and an absolute spelling of one file into one entry", () => {
    const got = writtenFiles([wrote("1", 1, "src/app.ts"), wrote("2", 2, "C:\\work\\x\\src\\app.ts", "edited")].map((r) => r as ChatItem), 4, cwd);
    expect(got).toEqual([{ path: "C:\\work\\x\\src\\app.ts", change: "edited" }]);
  });
  it("uses a posix folder's own separator", () => {
    expect(writtenFiles([wrote("1", 1, "src/app.ts")].map((r) => r as ChatItem), 4, "/home/u/repo")).toEqual([{ path: "/home/u/repo/src/app.ts", change: "added" }]);
  });
  it("what is handed to another agent's draft is the full path, not the relative one", () => {
    const l = { drafts: new Map<number, string>([[2, ""]]) };
    const [f] = writtenFiles([wrote("1", 1, "src/app.ts")].map((r) => r as ChatItem), 4, cwd);
    handOver(2, "docs", f.path, { draftOf: (k) => l.drafts.get(k) ?? "", keepDraft: (k, t) => void l.drafts.set(k, t), pick: () => {}, say: () => {} });
    expect(l.drafts.get(2)).toBe("C:\\work\\x\\src\\app.ts");
  });
  it("with no folder known a relative path stays relative and is not offered for sending", () => {
    const [f] = writtenFiles([wrote("1", 1, "src/app.ts")].map((r) => r as ChatItem), 4, null);
    expect(f.path).toBe("src/app.ts");
    const html = renderToStaticMarkup(createElement(FilesRow, { id: "f", files: [f, { path: "C:/w/a.md", change: "added" }], targets: [{ key: 2, label: "docs" }], onSend: () => {}, note: null }));
    expect(html.match(/Send to…/g)).toHaveLength(1);
    expect(html).toContain("src/app.ts");
  });
});
