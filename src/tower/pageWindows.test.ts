import { describe, expect, it } from "vitest";

// Row 955 LOW: a window or web view made from page script (`new WebviewWindow(`, `new Webview(`) takes
// no browser arguments, and the engine refuses a second set on the default data folder. Windows are
// made by Rust (browser_tower.rs), which passes the one string every window shares. The in-page
// Tower fallback in ownWindow.ts is the single known exception, until lib.rs registers the command.

const sources = import.meta.glob("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const KNOWN = ["/src/tower/ownWindow.ts"];
const PAGE_WINDOW = /\bnew\s+(?:WebviewWindow|Webview)\s*\(/;

/** The files in `files` (path to text) that make a window from page script, minus `except`. */
const pageWindowMakers = (files: Record<string, string>, except: string[]): string[] =>
  Object.entries(files)
    .filter(([path, text]) => !path.endsWith(".test.ts") && !path.endsWith(".test.tsx") && !except.includes(path) && PAGE_WINDOW.test(text))
    .map(([path]) => path)
    .sort();

describe("row 955: windows are made by Rust, not by page script", () => {
  it("finds a file that makes a window or a web view from script", () => {
    const files = {
      "/src/a.ts": "const w = new WebviewWindow('x', {});",
      "/src/b.tsx": "const v = new Webview(win, 'y', {});",
      "/src/c.ts": "const ok = 'WebviewWindow'; new WebviewWindowOptions();",
      "/src/d.test.ts": "new WebviewWindow('t', {})",
    };
    expect(pageWindowMakers(files, [])).toEqual(["/src/a.ts", "/src/b.tsx"]);
    expect(pageWindowMakers(files, ["/src/a.ts"])).toEqual(["/src/b.tsx"]);
  });

  it("no file under src/ does, except the known Tower fallback", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(pageWindowMakers(sources, KNOWN)).toEqual([]);
  });

  it("the known fallback still exists (drop it from the list when it goes)", () => {
    expect(pageWindowMakers(sources, [])).toEqual(KNOWN);
  });
});
