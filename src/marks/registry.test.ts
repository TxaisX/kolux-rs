// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { CREDIT_NAMES } from "../launch/paneMark";
import AgentMark from "./AgentMark";
import { VENDOR_MARKS, vendorFiles, vendorMark, vendorUrl } from "./registry";

// Vite lists and reads the files, so no Node types are needed.
const svgText = import.meta.glob("../assets/vendors/*.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const noticeText = Object.values(import.meta.glob("../assets/vendors/NOTICE.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>)[0] ?? "";
const sources = import.meta.glob("/src/**/*.{ts,tsx,css}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const fileOf = (key: string) => key.slice(key.lastIndexOf("/") + 1);
const sha256 = async (text: string) => {
  const bytes = new TextEncoder().encode(text.split("\r\n").join("\n"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};
/** NOTICE.md table rows: file name -> the SHA-256 in that row. */
const noticeRows = () => {
  const rows = new Map<string, string>();
  for (const line of noticeText.split("\n")) {
    const file = /^\| `([^`]+\.svg)` \|/.exec(line)?.[1];
    const hash = /`([0-9a-f]{64})` \|\s*$/.exec(line)?.[1];
    if (file) rows.set(file, hash ?? "");
  }
  return rows;
};

describe("T-335 vendor mark files", () => {
  test("every svg in the vendors folder has one NOTICE.md row, and every row names a file that ships", () => {
    const files = Object.keys(svgText).map(fileOf).sort();
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect([...noticeRows().keys()].sort()).toEqual(files);
  });

  test("each file is byte-for-byte what NOTICE.md recorded from the kit (SHA-256 over the text, LF line ends)", async () => {
    const rows = noticeRows();
    for (const [key, text] of Object.entries(svgText)) {
      expect(await sha256(text), fileOf(key)).toBe(rows.get(fileOf(key)));
    }
  });

  test("no file reaches out: no script, link, embedded picture, import or event handler", () => {
    for (const [key, text] of Object.entries(svgText)) {
      expect(text, fileOf(key)).not.toMatch(/<script|<foreignObject|<image|<use[^>]+href="(?!#)|@import|url\(\s*["']?https?:|\son[a-z]+=|data:/i);
      expect(text.match(/https?:\/\/[^"' )]+/g)?.filter((u) => u !== "http://www.w3.org/2000/svg" && u !== "http://www.w3.org/1999/xlink") ?? [], fileOf(key)).toEqual([]);
    }
  });

  test("every registry entry names files that ship, and every shipped file is used by an entry", () => {
    const used = new Set(VENDOR_MARKS.flatMap((m) => [m.light, m.dark]));
    for (const f of used) expect(vendorUrl(f), f).toBeTruthy();
    expect([...used].sort()).toEqual(vendorFiles().sort());
  });

  test("a vendor with two colour sets uses two different files; ids are unique", () => {
    const ids = VENDOR_MARKS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["codex", "copilot", "github", "linear"]) {
      const m = vendorMark(id)!;
      expect(m.light, id).not.toBe(m.dark);
    }
    for (const id of ["claude", "vscode"]) expect(vendorMark(id)!.light).toBe(vendorMark(id)!.dark);
  });

  test("every agent id in the registry is an agent the credit rule knows", () => {
    const credit = new Set(CREDIT_NAMES.map(([id]) => id));
    for (const id of ["claude", "codex", "copilot"]) expect(credit.has(id), id).toBe(true);
  });
});

describe("T-335 AgentMark", () => {
  const html = (id: string, label?: string) => renderToStaticMarkup(createElement(AgentMark, { id, size: 14, label }));
  /** The picture addresses in rendered markup, with the HTML escaping undone (small SVGs are inlined as data addresses). */
  const srcs = (out: string) =>
    [...out.matchAll(/src="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));

  test("Codex draws the OpenAI mark twice, black for light surfaces and white for dark, and names itself once", () => {
    const out = html("codex");
    expect(out.match(/<img/g)).toHaveLength(2);
    expect(srcs(out)).toEqual([vendorUrl("openai-blossom-black.svg"), vendorUrl("openai-blossom-white.svg")]);
    expect(vendorUrl("openai-blossom-black.svg")).not.toBe(vendorUrl("openai-blossom-white.svg"));
    expect(out.match(/alt="Codex"/g)).toHaveLength(1);
    expect(out).toContain('class="vmark vmark-light"');
    expect(out).toContain('class="vmark vmark-dark"');
  });

  test("Claude draws its one coloured mark once", () => {
    const out = html("claude");
    expect(out.match(/<img/g)).toHaveLength(1);
    expect(srcs(out)).toEqual([vendorUrl("anthropic-claude-spark.svg")]);
    expect(out).toContain('alt="Claude"');
  });

  test("an agent with no kit file draws the neutral glyph with its name as the text alternative, and no picture file", () => {
    const out = html("mistral-vibe", "Mistral Vibe");
    expect(out).not.toContain("<img");
    expect(out).toContain('aria-label="Mistral Vibe"');
    expect(out).toContain("<svg");
    expect(html("mistral-vibe")).toContain('aria-label="mistral-vibe"');
  });
});

describe("T-335 nothing is fetched at run time", () => {
  test("no source asks a favicon or icon service for a picture, and none points an img at a remote host", () => {
    for (const [f, text] of Object.entries(sources)) {
      if (f.endsWith("registry.test.ts") || f.endsWith("noPetArt.test.ts")) continue;
      expect(text, f).not.toMatch(/s2\/favicons|favicon\.ico\?|gstatic\.com\/faviconV2|icon\.horse|logo\.clearbit|simpleicons\.org\/|cdn\.simpleicons/i);
      expect(text, f).not.toMatch(/<img[^>]+src=["']https?:/i);
    }
  });
});
