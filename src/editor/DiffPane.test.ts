import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { Chunk } from "@codemirror/merge";
import { bigDiff, withoutWhitespace } from "./DiffPane";

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

describe("very large diffs ask first (EDIT-028)", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");
  it("asks for a generated file of 50,000 lines", () => {
    expect(bigDiff({ original: "", modified: many(50_000) })).toBe(50_000);
  });
  it("asks for a heavily changed file and for one huge line", () => {
    expect(bigDiff({ original: many(12_000), modified: many(12_000) })).toBe(24_000);
    expect(bigDiff({ original: "", modified: "x".repeat(3_000_000) })).toBe(1);
  });
  it("draws ordinary diffs straight away", () => {
    expect(bigDiff({ original: many(5_000), modified: many(5_001) })).toBe(0);
  });
});
