// T-591 (brief Phase 1): the JavaScript the main window loads at start may not grow past its ceiling.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { budget, CEILING } from "./bundle-budget.mjs";

// A built dist folder: index.html names the entry and a preload; the entry starts App at once and
// loads a diagram library only when asked; App imports one chunk statically.
const dist = (appBytes) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "krs-dist-"));
  const files = {
    "index.html": '<script type="module" crossorigin src="/assets/index-A1.js"></script>\n<link rel="modulepreload" crossorigin href="/assets/core-B2.js">\n<link rel="stylesheet" href="/assets/index-C3.css">',
    "assets/index-A1.js": 'import{t}from"./core-B2.js";const a=()=>import("./App-D4.js"),d=()=>import("./mermaid-E5.js");',
    "assets/core-B2.js": "export const t=1;",
    "assets/App-D4.js": 'import"./shared-F6.js";' + "x".repeat(appBytes),
    "assets/shared-F6.js": "export{}",
    "assets/mermaid-E5.js": "y".repeat(5_000_000),
    "assets/index-C3.css": "z".repeat(5_000_000),
  };
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
};

describe("first-load bundle budget", () => {
  it("counts the entry, its preloads, App and what they import, never a chunk loaded on demand or the CSS", () => {
    const r = budget(dist(1000), 10_000);
    expect(r.files.sort()).toEqual(["App-D4.js", "core-B2.js", "index-A1.js", "shared-F6.js"]);
    expect(r.ok).toBe(true);
  });

  it("fails once the first load grows past the ceiling", () => {
    const r = budget(dist(20_000), 10_000);
    expect(r.ok).toBe(false);
    expect(r.bytes).toBeGreaterThan(20_000);
  });

  it("refuses to pass a build it cannot read, and keeps its ceiling between the 1.5 MB bar and 2 MB", () => {
    expect(() => budget(path.join(os.tmpdir(), "krs-no-dist"))).toThrow(/vite build/);
    // The ceiling may never be eased back past the 1.5 MB target, nor raised above this cycle's size by more
    // than the small fixes the ceiling already allows for (cycle 3: 1,859,764 bytes measured, 1,880,000 kept).
    expect(CEILING).toBeGreaterThan(1_500_000);
    expect(CEILING).toBeLessThan(2_000_000);
  });
});
