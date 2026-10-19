// Council FIX-3 (FIX-BEFORE 1 of chat e5412ff): a kit role prompt that cannot go in never waits
// without a sign, and nothing is ever sent without a clear reading or the user's own click.
import { describe, expect, it } from "vitest";
import type { KitWait } from "../kits/useKits";
import { ASKING_NOTE } from "./composer";
import { KIT_NOTICE_MS, askFirstText, askingText, failedText, hooksAbsent, kitInFlight, kitNotices, kitPasted, kitStep, kitTickEntry, kitWait, noticeSeen, pasteUnchecked, readyText, sendPrompt, stoppedText, tooLongText, type KitTickDeps } from "./kitPrompt";
import { LIMIT } from "../terminal/paste";
import { UNSEEN_NOTE, type SendOutcome } from "./send";

const wait = (): KitWait => kitWait({ role: "review", upstream: "build", key: 7, prompt: "Review the build." }, "Reviewer", "Codex");

describe("which panes Kolux knows have no hooks", () => {
  it("hooks off, an agent with no hook route, or Codex (its hooks are not written yet) count as known absent", () => {
    expect(hooksAbsent("claude", false)).toBe(true);
    expect(hooksAbsent("codex", true)).toBe(true);
    expect(hooksAbsent("grok", true)).toBe(true);
    expect(hooksAbsent(undefined, true)).toBe(true);
    expect(hooksAbsent("claude", true)).toBe(false);
  });

  it("AFTER 1 of the 38be105 review: the picked agent id is what counts (gemini, amp, antigravity have routes; the vendor mark of their pane is only shell)", () => {
    expect(hooksAbsent("shell", true, "gemini")).toBe(false);
    expect(hooksAbsent("shell", true, "amp")).toBe(false);
    expect(hooksAbsent("claude", true, "claude-agent-teams")).toBe(false);
    expect(hooksAbsent("claude", true, "grok")).toBe(true);
    expect(hooksAbsent("shell", false, "gemini")).toBe(true);
  });
});

describe("where a kit notice counts as seen in place (FIX-SOON 3 of the 38be105 review)", () => {
  it("only on the role's own workspace, its terminals screen, with no page open", () => {
    expect(noticeSeen(true, true, false)).toBe(true);
    expect(noticeSeen(true, false, false)).toBe(false); // Agents, Board, Inbox or Tower screen
    expect(noticeSeen(true, true, true)).toBe(false); // a page open over the terminals
    expect(noticeSeen(false, true, false)).toBe(false); // another workspace
  });

  it("on the Agents screen of the same workspace the notice toasts once, and again never", async () => {
    const said: string[] = [];
    const w = wait();
    const r = { waiting: [w], sent: {} as Record<string, number> };
    const deps = (): KitTickDeps => ({ now: 0, why: () => undefined, absent: true, here: noticeSeen(true, false, false), paste: () => Promise.resolve(null), say: (t) => void said.push(t), changed: () => {}, stamp: () => 9 });
    await kitTickEntry(r, w, deps());
    await kitTickEntry(r, w, deps());
    expect(said).toEqual([readyText("Reviewer", "Codex")]);
  });
});

describe("a role prompt to a pane with hooks known absent", () => {
  it("shows the notice at once, with Send prompt, and never pastes by itself", () => {
    const w = wait();
    const step = kitStep(w, 1000, UNSEEN_NOTE, true);
    expect(step.paste).toBe(false);
    expect(step.changed).toBe(true);
    const [n] = kitNotices([w]);
    expect(n.notice.text).toBe("Reviewer is ready for its prompt, but Kolux can't see whether Codex is asking something.");
    expect(n.notice.text).toBe(readyText("Reviewer", "Codex"));
    expect(n.notice.canSend).toBe(true);
    // Ten minutes on, still no paste of its own.
    expect(kitStep(w, 1000 + 600_000, UNSEEN_NOTE, true)).toEqual({ paste: false, changed: false });
  });
});

describe("a role prompt with hooks expected but no reading yet (UNSEEN)", () => {
  it("retries quietly for 60 s from when the role became due, then shows the notice and one toast, and keeps retrying", () => {
    const w = wait();
    expect(kitStep(w, 0, UNSEEN_NOTE, false)).toEqual({ paste: false, changed: false });
    expect(kitStep(w, KIT_NOTICE_MS - 1, UNSEEN_NOTE, false)).toEqual({ paste: false, changed: false });
    expect(kitNotices([w])).toEqual([]);
    const late = kitStep(w, KIT_NOTICE_MS, UNSEEN_NOTE, false);
    expect(late.paste).toBe(false);
    expect(late.changed).toBe(true);
    expect(late.toast).toBe(readyText("Reviewer", "Codex"));
    expect(kitNotices([w])[0].notice.canSend).toBe(true);
    // One toast only.
    expect(kitStep(w, KIT_NOTICE_MS + 10_000, UNSEEN_NOTE, false).toast).toBeUndefined();
    // A clear reading arrives: the prompt goes in, and the notice closes once it has.
    expect(kitStep(w, KIT_NOTICE_MS + 20_000, undefined, false).paste).toBe(true);
    expect(kitPasted(w, "sent")).toEqual({ sent: true, changed: true });
    expect(kitNotices([w])).toEqual([]);
  });

  it("a clear reading inside the 60 s pastes with no notice at all", () => {
    const w = wait();
    kitStep(w, 0, UNSEEN_NOTE, false);
    expect(kitStep(w, 5000, undefined, false)).toEqual({ paste: true, changed: false });
    expect(kitPasted(w, "sent")).toEqual({ sent: true, changed: false });
  });

  it("a paste held at the last moment leaves the role waiting for the next tick", () => {
    const w = wait();
    kitStep(w, 0, undefined, false);
    expect(kitPasted(w, "held")).toEqual({ sent: false, changed: false });
    expect(kitStep(w, 10_000, undefined, false).paste).toBe(true);
  });
});

describe("a role prompt to an agent that is asking something", () => {
  it("waits with no limit; after 60 s it says the prompt is waiting on the agent's question, with no Send button", () => {
    const w = wait();
    expect(kitStep(w, 0, ASKING_NOTE, false)).toEqual({ paste: false, changed: false });
    const late = kitStep(w, KIT_NOTICE_MS, ASKING_NOTE, false);
    expect(late).toEqual({ paste: false, changed: true });
    const [n] = kitNotices([w]);
    expect(n.notice.text).toBe("Reviewer's prompt is waiting: Codex is asking something in its terminal. Answer it there.");
    expect(n.notice.text).toBe(askingText("Reviewer", "Codex"));
    expect(n.notice.canSend).toBe(false);
    expect(kitStep(w, 3_600_000, ASKING_NOTE, false)).toEqual({ paste: false, changed: false });
    // Answered in the terminal: the next tick pastes.
    expect(kitStep(w, 3_610_000, undefined, false).paste).toBe(true);
  });
});

describe("a role prompt that stopped mid-paste (a menu opened)", () => {
  it("is never pasted again by the timer; the notice offers Send prompt instead", () => {
    const w = wait();
    expect(kitStep(w, 0, undefined, false).paste).toBe(true);
    expect(kitPasted(w, "stopped")).toEqual({ sent: false, changed: true });
    const [n] = kitNotices([w]);
    expect(n.notice.text).toBe(stoppedText("Reviewer", "Codex"));
    expect(n.notice.canSend).toBe(true);
    for (const at of [10_000, 20_000, 120_000]) expect(kitStep(w, at, undefined, false)).toEqual({ paste: false, changed: false });
  });
});

describe("Send prompt (the user's own click)", () => {
  it("clears the input line, pastes the prompt as one bracketed paste and presses Enter, with no reading at all", async () => {
    const got: string[] = [];
    expect(await pasteUnchecked(70, "Review the build.", async (_id, d) => void got.push(d), async () => {})).toBe(true);
    expect(got).toEqual(["\x15", "\x1b[200~Review the build.\x1b[201~", "\r"]);
  });
});

// Stand-in review of chat 1e9613e, FIX-BEFORE 3 (and AFTER 2): Send prompt is unchecked only while
// Kolux cannot see; when it can see a menu open, the click types nothing and says why.
describe("Send prompt while Kolux sees the agent asking", () => {
  const run = (w: KitWait) => ({ waiting: [w], sent: {} as Record<string, number> });
  const deps = (why: () => string | undefined, got: string[], said: string[], terminal: number | undefined = 70) => ({
    terminal,
    why,
    write: async (_id: number, d: string) => void got.push(d),
    say: (t: string) => void said.push(t),
    changed: () => {},
    sleep: async () => {},
    now: () => 5,
  });

  it("refuses with a toast and types nothing on a stopped notice while the agent asks", async () => {
    const w = wait();
    kitPasted(w, "stopped");
    const r = run(w);
    const got: string[] = [];
    const said: string[] = [];
    expect(await sendPrompt(r, w, deps(() => ASKING_NOTE, got, said))).toBe(false);
    expect(got).toEqual([]);
    expect(said).toEqual([askFirstText("Codex")]);
    expect(said[0]).toBe("Codex is asking something. Answer it in its terminal first.");
    expect(r.waiting).toEqual([w]);
  });

  it("refuses on an unseen notice once a permission reading has arrived", async () => {
    const w = wait();
    kitStep(w, 0, UNSEEN_NOTE, false);
    kitStep(w, KIT_NOTICE_MS, UNSEEN_NOTE, false);
    const r = run(w);
    const got: string[] = [];
    const said: string[] = [];
    expect(await sendPrompt(r, w, deps(() => ASKING_NOTE, got, said))).toBe(false);
    expect(got).toEqual([]);
    expect(r.waiting).toEqual([w]);
  });

  it("sends unchecked while Kolux cannot see, and the role leaves the waiting list", async () => {
    const w = wait();
    const r = run(w);
    const got: string[] = [];
    const said: string[] = [];
    let changed = 0;
    expect(await sendPrompt(r, w, { ...deps(() => UNSEEN_NOTE, got, said), changed: () => void changed++ })).toBe(true);
    expect(got).toEqual(["\x15", "\x1b[200~Review the build.\x1b[201~", "\r"]);
    expect(r.waiting).toEqual([]);
    expect(r.sent).toEqual({ review: 5 });
    // Once as the paste starts (the strip hides Send prompt, FIX-SOON 1), once as the role leaves.
    expect(changed).toBe(2);
    expect(said).toEqual([]);
  });

  it("a menu reported mid-paste stops it before the Enter; the role keeps waiting", async () => {
    const w = wait();
    const r = run(w);
    const got: string[] = [];
    const said: string[] = [];
    const why = () => (got.length >= 2 ? ASKING_NOTE : undefined);
    expect(await sendPrompt(r, w, deps(why, got, said))).toBe(false);
    expect(got).not.toContain("\r");
    expect(r.waiting).toEqual([w]);
    expect(said).toEqual([askFirstText("Codex")]);
    expect(kitNotices([w])[0].notice.kind).toBe("stopped");
  });

  it("no terminal, or a prompt too long for one paste, types nothing and says why", async () => {
    const got: string[] = [];
    const said: string[] = [];
    const w = wait();
    expect(await sendPrompt(run(w), w, { ...deps(() => undefined, got, said), terminal: undefined })).toBe(false);
    const long = kitWait({ role: "review", upstream: "build", key: 7, prompt: "x".repeat(LIMIT + 1) }, "Reviewer", "Codex");
    expect(await sendPrompt(run(long), long, deps(() => undefined, got, said))).toBe(false);
    expect(got).toEqual([]);
    expect(said).toEqual(["That agent's terminal is not running, so nothing was sent.", tooLongText("Reviewer")]);
  });
});

// Stand-in review of chat 1e9613e, FIX-SOON 1, 3, 4 and AFTER 3: one paste per role even when the
// 10 s tick and a Send prompt click race; notices reach the user from every workspace.
describe("the kit tick for one waiting role", () => {
  const run = (...w: KitWait[]) => ({ waiting: [...w], sent: {} as Record<string, number> });
  const later = <T,>() => {
    let done!: (v: T) => void;
    const p = new Promise<T>((r) => (done = r));
    return { p, done };
  };
  const tickDeps = (paste: () => Promise<SendOutcome | null>, said: string[], over: Partial<KitTickDeps> = {}): KitTickDeps => ({
    now: 0,
    why: () => undefined,
    absent: false,
    here: true,
    paste,
    say: (t) => void said.push(t),
    changed: () => {},
    stamp: () => 9,
    ...over,
  });

  it("a Send prompt click while the tick's paste is in flight types nothing, and the buttons hide", async () => {
    const w = wait();
    const r = run(w);
    const gate = later<SendOutcome | null>();
    let pastes = 0;
    const ticking = kitTickEntry(r, w, tickDeps(() => (pastes++, gate.p), []));
    await Promise.resolve();
    expect(kitInFlight(w)).toBe(true);
    const got: string[] = [];
    expect(await sendPrompt(r, w, { terminal: 70, why: () => undefined, write: async (_i, d) => void got.push(d), say: () => {}, changed: () => {} })).toBe(false);
    expect(got).toEqual([]);
    gate.done("sent");
    await ticking;
    expect(pastes).toBe(1);
    expect(kitInFlight(w)).toBe(false);
    expect(r.waiting).toEqual([]);
    expect(r.sent).toEqual({ review: 9 });
    // The tick's snapshot still holds the entry: a second pass over it pastes nothing.
    await kitTickEntry(r, w, tickDeps(() => (pastes++, Promise.resolve("sent")), []));
    expect(pastes).toBe(1);
  });

  it("a role the user sent by hand is skipped by a tick still walking its snapshot", async () => {
    const w = wait();
    const r = run(w);
    expect(await sendPrompt(r, w, { terminal: 70, why: () => UNSEEN_NOTE, write: async () => {}, say: () => {}, changed: () => {} })).toBe(true);
    let pastes = 0;
    await kitTickEntry(r, w, tickDeps(() => (pastes++, Promise.resolve("sent")), []));
    expect(pastes).toBe(0);
  });

  it("while a click's paste is in flight, the tick does not paste the same role", async () => {
    const w = wait();
    const r = run(w);
    const gate = later<void>();
    const clicking = sendPrompt(r, w, { terminal: 70, why: () => UNSEEN_NOTE, write: () => gate.p, say: () => {}, changed: () => {} });
    await Promise.resolve();
    expect(kitInFlight(w)).toBe(true);
    let pastes = 0;
    await kitTickEntry(r, w, tickDeps(() => (pastes++, Promise.resolve("sent")), []));
    expect(pastes).toBe(0);
    gate.done();
    expect(await clicking).toBe(true);
    expect(kitInFlight(w)).toBe(false);
  });

  it("in another workspace every notice kind toasts once per role (hookless, stopped)", async () => {
    const said: string[] = [];
    const a = wait();
    await kitTickEntry(run(a), a, tickDeps(() => Promise.resolve(null), said, { absent: true, here: false }));
    await kitTickEntry(run(a), a, tickDeps(() => Promise.resolve(null), said, { absent: true, here: false, now: 120_000 }));
    expect(said).toEqual([readyText("Reviewer", "Codex")]);
    const b = wait();
    await kitTickEntry(run(b), b, tickDeps(() => Promise.resolve("stopped"), said, { here: false }));
    expect(said).toEqual([readyText("Reviewer", "Codex"), stoppedText("Reviewer", "Codex")]);
  });

  it("in the active workspace the strip shows a stopped notice with no toast", async () => {
    const said: string[] = [];
    const w = wait();
    await kitTickEntry(run(w), w, tickDeps(() => Promise.resolve("stopped"), said));
    expect(said).toEqual([]);
    expect(kitNotices([w])[0].notice.kind).toBe("stopped");
  });

  it("a gated paste whose write failed shows a notice and is not pasted again by the timer (AFTER 3)", async () => {
    const w = wait();
    const r = run(w);
    let pastes = 0;
    await kitTickEntry(r, w, tickDeps(() => (pastes++, Promise.resolve(null)), []));
    expect(kitNotices([w])[0].notice).toEqual({ kind: "failed", text: failedText("Reviewer"), canSend: true });
    await kitTickEntry(r, w, tickDeps(() => (pastes++, Promise.resolve("sent")), [], { now: 10_000 }));
    expect(pastes).toBe(1);
    expect(r.waiting).toEqual([w]);
  });
});
