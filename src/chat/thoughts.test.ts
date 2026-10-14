import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ThoughtRow } from "./StepRows";
import { thoughtIds, toggled } from "./steps";
import type { ChatItem } from "./model";

const thought = (id: string): ChatItem => ({ id, role: "assistant", kind: "thought", text: `reasoning ${id}`, at: 1 });
const say = (id: string): ChatItem => ({ id, role: "assistant", kind: "text", text: "ok", at: 1 });

describe("Thought rows (STAT-053, T-027)", () => {
  it("a Thought row is a real button, collapsed until opened", () => {
    const shut = renderToStaticMarkup(createElement(ThoughtRow, { item: thought("t1"), open: false, onToggle: () => {} }));
    expect(shut).toContain('<button type="button" class="chat-fold-head" aria-expanded="false">Thought</button>');
    expect(shut).not.toContain("reasoning t1");
    const open = renderToStaticMarkup(createElement(ThoughtRow, { item: thought("t1"), open: true, onToggle: () => {} }));
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain("reasoning t1");
  });

  it("Expand all opens every Thought row and only those; a toggle flips one row and keeps the rest", () => {
    const items = [say("a"), thought("t1"), say("b"), thought("t2"), thought("t3")];
    const all = new Set(thoughtIds(items));
    expect([...all]).toEqual(["t1", "t2", "t3"]);
    const one = toggled(all, "t2");
    expect([...one].sort()).toEqual(["t1", "t3"]);
    expect([...toggled(one, "t2")].sort()).toEqual(["t1", "t2", "t3"]);
    expect(all.size).toBe(3); // the old set is never changed in place
    expect(thoughtIds([say("a")])).toEqual([]);
  });
});
