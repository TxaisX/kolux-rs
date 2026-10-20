import { describe, expect, it } from "vitest";

// T-027 / VIEW-015: the Agents rail is 268px in the new look and a flat 240px under Classic.
// Vitest returns "" for a .css import, so the stylesheet is read from disk through the global process
// (the project carries no Node types).
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const css = nodeFs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("Agents rail width (T-027)", () => {
  it("is 268px by default and 240px under the classic look", () => {
    expect(css).toMatch(/^\.rail \{[^}]*width: 268px/m);
    expect(css).toMatch(/^\.rail\.classic \{[^}]*width: 240px/m);
  });
});
