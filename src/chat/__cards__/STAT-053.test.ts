// STAT-053 acceptance, box 1: a session with reasoning shows its Thought rows collapsed; Expand all opens every one.
// MIRROR src/chat/ChatView.tsx:270-288 and ViewRow:334: the start state (empty set), the Expand all handler
// and `open={thoughts.has(id)}` are re-stated around the real fold, thoughtIds and ThoughtRow.
import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThoughtRow } from "../StepRows";
import { fold, thoughtIds } from "../steps";
import type { ChatItem } from "../model";

const item = (id: string, role: ChatItem["role"], kind: string, text: string, at: number): ChatItem => ({ id, role, kind, text, at });
const rows = [
  item("u1", "user", "text", "refactor the parser", 1),
  item("t1", "assistant", "thought", "first reasoning", 2),
  item("a1", "assistant", "text", "done with part one", 3),
  item("t2", "assistant", "thought", "second reasoning", 4),
  item("t3", "assistant", "thought", "third reasoning", 5),
];
const thoughtsShown = (open: ReadonlySet<string>) =>
  fold(rows.map((r) => ({ ...r, row: "message" as const })), false)
    .filter((v) => v.row === "message" && (v as unknown as ChatItem).kind === "thought")
    .map((v) => renderToStaticMarkup(createElement(ThoughtRow, { item: v as never, open: open.has((v as unknown as ChatItem).id), onToggle: () => {} })));

test("box 1: the Thought rows start collapsed; Expand all opens all of them", () => {
  const closed = thoughtsShown(new Set<string>()); // ChatView's initial state
  expect(closed).toHaveLength(3);
  for (const h of closed) {
    expect(h).toContain('aria-expanded="false">Thought</button>');
    expect(h).not.toContain("reasoning");
  }
  const open = thoughtsShown(new Set(thoughtIds(rows))); // what the Expand all button sets
  expect(open).toHaveLength(3);
  open.forEach((h, i) => {
    expect(h).toContain('aria-expanded="true"');
    expect(h).toContain(`${["first", "second", "third"][i]} reasoning`);
  });
});

test("box 2 (supporting only; the key presses need a window): a Thought row is a real button", () => {
  const h = renderToStaticMarkup(createElement(ThoughtRow, { item: rows[1], open: false, onToggle: () => {} }));
  expect(h).toContain('<button type="button" class="chat-fold-head" aria-expanded="false">Thought</button>');
});
