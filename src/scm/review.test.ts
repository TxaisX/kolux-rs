import { describe, expect, it } from "vitest";
import type { Check } from "./checks";
import { ANNOTATION_CAP, CHECK_CAP, byFile, capped, checkGroups, cleanComment, fixPrompt, moreNote, relativeTime, tailOf, timeline, visibleReview, type Review } from "./review";

const chk = (name: string, outcome: Check["outcome"]): Check => ({ name, outcome });
const cm = (id: string, author: string, at: string, bot = false) => ({ id, db_id: 1, author, bot, body: id, at });

describe("check groups", () => {
  it("sorts into failing, pending and passing, and keeps neutral out of passing", () => {
    const g = checkGroups([chk("a", "failed"), chk("b", "unresolved"), chk("c", "running"), chk("d", "passed"), chk("e", "neutral"), chk("f", "skipped"), chk("g", "cancelled")]);
    expect(g.failing.map((c) => c.name)).toEqual(["a", "b"]);
    expect(g.pending.map((c) => c.name)).toEqual(["c"]);
    expect(g.passing.map((c) => c.name)).toEqual(["d"]);
    expect(g.other.map((c) => c.name)).toEqual(["e", "f", "g"]);
  });
  it("shows the first 100 checks and the first 20 annotations, each with a note", () => {
    const many = Array.from({ length: 130 }, (_, i) => chk(`c${i}`, "passed"));
    const r = capped(many, CHECK_CAP, "checks");
    expect(r.shown).toHaveLength(100);
    expect(r.note).toBe("Showing the first 100 of 130 checks.");
    expect(capped([1, 2], ANNOTATION_CAP, "annotations").note).toBeNull();
    expect(capped(Array(21).fill(0), ANNOTATION_CAP, "annotations").note).toContain("first 20 of 21");
  });
});

describe("fix with AI", () => {
  it("sends only the final part of a long log, from a line start", () => {
    const log = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n");
    const t = tailOf(log, 200);
    expect(t.startsWith("[earlier output left out]\nline ")).toBe(true);
    expect(t.endsWith("line 4999")).toBe(true);
    expect(t.length).toBeLessThan(260);
    expect(tailOf("short")).toBe("short");
  });
  it("names the check and its workflow", () => {
    const p = fixPrompt({ name: "test", outcome: "failed", workflow: "CI" }, "boom");
    expect(p).toContain('"test" (CI)');
    expect(p).toContain("boom");
  });
});

describe("relative time", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  it("is compact", () => {
    expect(relativeTime("2026-10-19T11:59:40Z", now)).toBe("now");
    expect(relativeTime("2026-10-19T11:55:00Z", now)).toBe("5m");
    expect(relativeTime("2026-10-19T09:00:00Z", now)).toBe("3h");
    expect(relativeTime("2026-10-17T12:00:00Z", now)).toBe("2d");
    expect(relativeTime("2026-09-28T12:00:00Z", now)).toBe("3w");
    expect(relativeTime("2025-10-19T12:00:00Z", now)).toBe("1y");
  });
  it("shows nothing for an invalid or missing time", () => {
    expect(relativeTime("not a date", now)).toBe("");
    expect(relativeTime(null, now)).toBe("");
    expect(relativeTime("", now)).toBe("");
  });
});

describe("review comments", () => {
  const r: Review = {
    talk: [cm("t1", "ann", "2026-10-19T10:00:00Z"), cm("t2", "dependabot", "2026-10-19T09:00:00Z", true)],
    talk_more: 0,
    threads: [
      { id: "T2", path: "src/b.ts", line: 3, resolved: false, more: 0, comments: [cm("c3", "bob", "2026-10-19T11:00:00Z")] },
      { id: "T1", path: "src/a.ts", line: 1, resolved: true, more: 2, comments: [cm("c1", "bob", "2026-10-19T08:00:00Z"), cm("c2", "bot", "2026-10-19T08:30:00Z", true)] },
      { id: "T3", path: "src/c.ts", line: 9, resolved: false, more: 0, comments: [cm("c4", "ci", "2026-10-19T12:00:00Z", true)] },
    ],
  };
  it("groups by file, then the conversation", () => {
    const rows = byFile(r);
    expect(rows.map((x) => (x.kind === "file" ? x.path : x.comment.id))).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "t1", "t2"]);
  });
  it("lists a timeline oldest first", () => {
    expect(timeline(r).map((x) => x.comment.id)).toEqual(["c1", "c2", "t2", "t1", "c3", "c4"]);
  });
  it("hides bots and the threads only bots wrote", () => {
    const v = visibleReview(r, true);
    expect(v.talk.map((c) => c.id)).toEqual(["t1"]);
    expect(v.threads.map((t) => t.id)).toEqual(["T2", "T1"]);
    expect(v.threads[1].comments.map((c) => c.id)).toEqual(["c1"]);
    expect(visibleReview(r, false)).toBe(r);
  });
  it("never sends a blank comment and trims the rest", () => {
    expect(cleanComment("  \n ")).toBeNull();
    expect(cleanComment("  hi \n")).toBe("hi");
  });
  it("says how many comments were left out", () => {
    expect(moreNote(0)).toBeNull();
    expect(moreNote(1)).toContain("1 more comment not shown");
    expect(moreNote(3)).toContain("3 more comments");
  });
});

// ---- VIEW-075: cards ----------------------------------------------------------------------------
import { botNames, cardCount, cardGroups, conflictView, emojiOf, placeOf, reactKind, repliable, reviewPrompt, sendsOnEnter } from "./review";

const card = (id: string, at: string, author = "ann") => ({ id, db_id: Number(id.replace(/\D/g, "")) || null, author, bot: false, body: id, at });
const thr = (id: string, resolved: boolean, at: string, path: string | null = "src/a.ts", line: number | null = 3) => ({ id, path, line, resolved, comments: [card(`c${id}`, at)], more: 0 });

it("VIEW-075: cards come as open, conversation and resolved, each oldest first", () => {
  const r: Review = { threads: [thr("2", false, "2026-10-19T12:00:00Z"), thr("1", false, "2026-10-19T10:00:00Z"), thr("3", true, "2026-10-19T09:00:00Z")], talk: [card("t2", "2026-10-19T08:00:00Z"), card("t1", "2026-10-19T07:00:00Z")], talk_more: 0 };
  const g = cardGroups(r);
  expect(g.open.map((t) => t.id)).toEqual(["1", "2"]);
  expect(g.resolved.map((t) => t.id)).toEqual(["3"]);
  expect(g.conversation.map((c) => c.id)).toEqual(["t1", "t2"]);
  expect(cardCount(r)).toBe(5);
  expect(timeline(r).map((x) => x.comment.id)).toEqual(["t1", "t2", "c3", "c1", "c2"]);
});

it("VIEW-075: Enter sends, Shift+Enter does not, and Enter while an input method composes does not", () => {
  expect(sendsOnEnter({ key: "Enter", shiftKey: false })).toBe(true);
  expect(sendsOnEnter({ key: "Enter", shiftKey: true })).toBe(false);
  expect(sendsOnEnter({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
  expect(sendsOnEnter({ key: "Enter", shiftKey: false, keyCode: 229 })).toBe(false);
  expect(sendsOnEnter({ key: "a", shiftKey: false })).toBe(false);
});

it("VIEW-075: reactions, places and bot names read as the cards need them", () => {
  expect(emojiOf("heart")).toBe("\u2764\uFE0F");
  expect(emojiOf("unknown")).toBe("unknown");
  expect(reactKind(true)).toBe("react");
  expect(reactKind(false)).toBe("react_talk");
  expect(placeOf({ path: "src/a.ts", line: 7 })).toBe("src/a.ts:7");
  expect(placeOf({ path: "src/a.ts", line: null })).toBe("src/a.ts");
  expect(placeOf({ path: null, line: null })).toBe("");
  expect(botNames(["ci", 3, "x"])).toEqual(["ci", "x"]);
  expect(botNames("no")).toEqual([]);
});

it("GIT-031: the queued comments become one prompt with where each is; only repliable threads are offered", () => {
  const mk = (id: string, author: string, body: string, db: number | null, path: string | null, line: number | null) => ({ id, path, line, resolved: false, more: 0, comments: [{ id: "c" + id, db_id: db, author, bot: false, body, at: "2026-10-19T10:00:00Z" }] });
  const a = mk("t1", "alice", "Rename this", 11, "src/a.ts", 12);
  const b = mk("t2", "bob", "Why?", null, null, null);
  const p = reviewPrompt([a, b]);
  expect(p).toContain("1. src/a.ts:12\n  alice: Rename this");
  expect(p).toContain("2. pull request conversation\n  bob: Why?");
  expect(repliable([a, b]).map((t) => t.id)).toEqual(["t1"]);
});

it("GIT-032: a conflict lists files; a clean local merge says GitHub may be stale and offers commands", () => {
  const files = conflictView({ state: "conflicts", files: ["a.rs"], base: "main", note: "These files conflict", prompt: "p" });
  expect(files).toMatchObject({ kind: "files", commands: [] });
  const stale = conflictView({ state: "clean", files: [], base: "main", note: "", prompt: null });
  expect(stale.kind).toBe("stale");
  expect(stale.commands[0]).toBe("git fetch origin main");
  expect(conflictView(null).kind).toBe("unknown");
});

import { reactionCall } from "./review";

it("GIT-030: pressing a reaction you gave takes it back by the comment's node id, otherwise adds it", () => {
  const c = { id: "IC_1", db_id: 42, author: "ann", bot: false, body: "x", at: "" };
  expect(reactionCall(c, { content: "heart", count: 2, mine: true }, true)).toEqual({ kind: "unreact", id: "IC_1", text: "heart" });
  expect(reactionCall(c, { content: "heart", count: 2, mine: true }, false)).toEqual({ kind: "unreact", id: "IC_1", text: "heart" });
  expect(reactionCall(c, { content: "+1", count: 1, mine: false }, true)).toEqual({ kind: "react", id: "42", text: "+1" });
  expect(reactionCall(c, { content: "+1", count: 1, mine: false }, false)).toEqual({ kind: "react_talk", id: "42", text: "+1" });
  expect(reactionCall({ ...c, db_id: null }, { content: "+1", count: 1, mine: false }, true)).toBeNull();
});

import { ownCall } from "./review";

it("GIT-030: only your own comments can be edited or deleted, each by the call that fits where it sits", () => {
  const c = { author: "Ann", db_id: 7 };
  expect(ownCall(c, "ann", true, "edit")).toEqual({ kind: "edit", id: "7" });
  expect(ownCall(c, "ann", false, "edit")).toEqual({ kind: "edit_talk", id: "7" });
  expect(ownCall(c, "ANN", true, "delete")).toEqual({ kind: "delete", id: "7" });
  expect(ownCall(c, "ann", false, "delete")).toEqual({ kind: "delete_talk", id: "7" });
  expect(ownCall(c, "bob", true, "edit")).toBeNull();
  expect(ownCall(c, "", true, "edit")).toBeNull();
  expect(ownCall(c, undefined, true, "delete")).toBeNull();
  expect(ownCall({ ...c, db_id: null }, "ann", true, "edit")).toBeNull();
});
