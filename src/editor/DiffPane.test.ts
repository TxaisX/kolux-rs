import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { Chunk } from "@codemirror/merge";
import { withoutWhitespace } from "./DiffPane";

const chunks = (a: string, b: string, override?: typeof withoutWhitespace) => Chunk.build(Text.of(a.split("\n")), Text.of(b.split("\n")), override && { override });

describe("diff tab whitespace (EDIT-027)", () => {
  const a = "one\n  two\nthree\nfour";
  const b = "one\ntwo   \nthree\nFOUR";
  it("shows whitespace-only changes when asked", () => {
    expect(chunks(a, b).length).toBe(2);
  });
  it("leaves them out by default, keeping real changes where they are", () => {
    const left = chunks(a, b, withoutWhitespace);
    expect(left.length).toBe(1);
    expect(Text.of(b.split("\n")).lineAt(left[0].fromB).number).toBe(4);
  });
});
