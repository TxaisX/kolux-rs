// Council FIX-3 (FIX-BEFORE 1 of chat e5412ff): a kit role prompt that cannot go in never waits
// without a sign, and nothing is ever sent without a clear reading or the user's own click.
import { describe, expect, it } from "vitest";
import type { KitWait } from "../kits/useKits";
import { ASKING_NOTE } from "./composer";
import { KIT_NOTICE_MS, askingText, hooksAbsent, kitNotices, kitPasted, kitStep, kitWait, pasteUnchecked, readyText, stoppedText } from "./kitPrompt";
import { UNSEEN_NOTE } from "./send";

const wait = (): KitWait => kitWait({ role: "review", upstream: "build", key: 7, prompt: "Review the build." }, "Reviewer", "Codex");

describe("which panes Kolux knows have no hooks", () => {
  it("hooks off, an agent with no hook route, or Codex (its hooks are not written yet) count as known absent", () => {
    expect(hooksAbsent("claude", false)).toBe(true);
    expect(hooksAbsent("codex", true)).toBe(true);
    expect(hooksAbsent("grok", true)).toBe(true);
    expect(hooksAbsent(undefined, true)).toBe(true);
    expect(hooksAbsent("claude", true)).toBe(false);
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
