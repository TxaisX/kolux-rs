import { describe, expect, it } from "vitest";

// Row 955 LOW / 954c: a window or web view made from page script (`new WebviewWindow(`, `new Webview(`,
// under any import name, or the plugin command they call) takes no browser arguments, and the engine
// refuses a second set on the default data folder. Windows are made by Rust (browser_tower.rs), which
// passes the one string every window shares. The in-page Tower fallback in ownWindow.ts is the single
// known exception, until lib.rs registers the command.

const sources = import.meta.glob("/src/**/*.{ts,tsx,js,jsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const KNOWN = ["/src/tower/ownWindow.ts"];
const CLASSES = "(?:WebviewWindow|Webview)";
const MODULES = "@tauri-apps/api/(?:webviewWindow|webview)";
const PLUGIN_COMMAND = /plugin:webview\|create_webview_window/;

/** Every name a file can reach WebviewWindow or Webview by: the classes themselves, their `as` aliases,
 *  a destructured alias, and `import * as ns` namespaces (as `ns.WebviewWindow`). */
function constructorNames(text: string): string[] {
  const names = new Set<string>(["WebviewWindow", "Webview"]);
  const named = new RegExp(`import\\s*(?:type\\s*)?\\{([^}]*)\\}\\s*from\\s*["']${MODULES}["']`, "g");
  for (const m of text.matchAll(named)) {
    for (const part of m[1].split(",")) {
      const [orig, alias] = part.trim().split(/\s+as\s+/);
      if (alias && new RegExp(`^${CLASSES}$`).test(orig)) names.add(alias.trim());
    }
  }
  for (const m of text.matchAll(new RegExp(`import\\s*\\*\\s*as\\s+(\\w+)\\s*from\\s*["']${MODULES}["']`, "g"))) {
    names.add(`${m[1]}\\s*\\.\\s*WebviewWindow`);
    names.add(`${m[1]}\\s*\\.\\s*Webview`);
  }
  for (const m of text.matchAll(new RegExp(`\\b${CLASSES}\\s*:\\s*(\\w+)`, "g"))) names.add(m[1]);
  return [...names];
}

const makesWindow = (text: string): boolean => {
  if (PLUGIN_COMMAND.test(text)) return true;
  // A namespace or alias only counts when the file reaches the Tauri module at all; the bare class names always count.
  const reaches = new RegExp(MODULES).test(text);
  return constructorNames(text).some((n) => (reaches || /^(?:WebviewWindow|Webview)$/.test(n)) && new RegExp(`\\bnew\\s+${n}\\s*\\(`).test(text));
};

/** The files in `files` (path to text) that make a window from page script, minus `except`. */
const pageWindowMakers = (files: Record<string, string>, except: string[]): string[] =>
  Object.entries(files)
    .filter(([path, text]) => !/\.test\.[jt]sx?$/.test(path) && !except.includes(path) && makesWindow(text))
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

  it("row 954c: finds the aliased import, the namespace import, the dynamic one and the plugin command, in .js and .jsx too", () => {
    const files = {
      "/src/alias.ts": `import { WebviewWindow as Win } from "@tauri-apps/api/webviewWindow"; new Win("a", {});`,
      "/src/ns.js": `import * as w from "@tauri-apps/api/webview"; export const v = new w.Webview(x, "b", {});`,
      "/src/dyn.jsx": `const { WebviewWindow: Maker } = await import("@tauri-apps/api/webviewWindow"); new Maker("c", {});`,
      "/src/cmd.ts": `invoke("plugin:webview|create_webview_window", { options });`,
      "/src/multi.ts": `import {\n  getCurrentWebview,\n  Webview as V,\n} from "@tauri-apps/api/webview";\nnew V(win, "d", {});`,
      "/src/ok.ts": `import { WebviewWindow as Win } from "@tauri-apps/api/webviewWindow"; Win.getByLabel("a");`,
      "/src/other.ts": `class Win {} new Win();`,
      "/src/ok.test.js": `new WebviewWindow("t", {})`,
    };
    expect(pageWindowMakers(files, [])).toEqual(["/src/alias.ts", "/src/cmd.ts", "/src/dyn.jsx", "/src/multi.ts", "/src/ns.js"]);
  });

  it("no file under src/ does, except the known Tower fallback", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(pageWindowMakers(sources, KNOWN)).toEqual([]);
  });

  it("the known fallback still exists (drop it from the list when it goes)", () => {
    expect(pageWindowMakers(sources, [])).toEqual(KNOWN);
  });
});
