// Native chat, links in the agent's messages (CHAT-025; T-329). Pure text work: which parts of a
// reply are links, what each opens, which file paths may be opened at all, and which browser a
// click chooses. The path and web-link finder is the terminal's (src/terminal/links.ts, imported):
// the same text reads the same way in both places.
import { findLinks, fromFileUrl, resolvePath } from "../terminal/links";
import type { ChatItem } from "./model";

export type LinkTarget =
  | { kind: "web"; url: string }
  | { kind: "mail"; href: string }
  | { kind: "file"; path: string; line?: number; column?: number };
/** A stretch of a message: plain text, or text that opens something. */
export type Part = { text: string; link?: LinkTarget };

const FILE_AT = /^(.*?)(?::(\d+)(?::(\d+))?|\((\d+)(?:,(\d+))?\))?$/;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const DRIVE = /^[A-Za-z]:[\\/]/;
const CONTROL = /[\x00-\x1f\x7f]/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const MD_LINK = /\[([^\]\n]*)\]\(([^)\s]*)\)/g;

const web = (url: string): LinkTarget | null => {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname ? { kind: "web", url } : null;
  } catch {
    return null;
  }
};

/** FIX-1: a mailto link keeps its address and only the subject and body parameters; cc, bcc, to, attach and the rest are
 * dropped (some mail programs have honoured attach= for local files). Null when the address part is not an address. */
const mail = (t: string): LinkTarget | null => {
  const [base, query = ""] = t.split("?", 2);
  if (!/^mailto:[^\s@]+@[^\s@]+$/i.test(base)) return null;
  const kept = query.split("&").filter((pair) => /^(subject|body)=/i.test(pair));
  return { kind: "mail", href: kept.length ? base + "?" + kept.join("&") : base };
};

/** CHAT-025: what the target of a written link opens, or null when it cannot be clicked: an empty link, a page anchor
 * (#heading), a scheme that is not a web, mail or file link, or a file link that does not decode. */
export function classify(raw: string): LinkTarget | null {
  const t = raw.trim();
  if (!t || t.startsWith("#") || CONTROL.test(t)) return null;
  if (/^https?:/i.test(t)) return web(t);
  if (/^mailto:/i.test(t)) return mail(t);
  if (/^file:/i.test(t)) {
    const path = fromFileUrl(t);
    // FIX-1: the path is checked again after the % escapes are decoded (%00 is a NUL only now).
    return path === null || !path.trim() || CONTROL.test(path) ? null : { kind: "file", path };
  }
  if (SCHEME.test(t) && !DRIVE.test(t)) return null;
  const m = FILE_AT.exec(t);
  const path = (m?.[1] ?? t).trim();
  if (!path) return null;
  const line = m?.[2] ?? m?.[4];
  const column = m?.[3] ?? m?.[5];
  return { kind: "file", path, ...(line ? { line: Number(line) } : {}), ...(column ? { column: Number(column) } : {}) };
}

type Span = { start: number; end: number; part: Part };

/** CHAT-025: a message cut into plain text and links. Written links [label](target) first (a dead target keeps its label as
 * plain text), then web addresses, file paths (with :line and :line:column) and email addresses in the rest. */
export function partsOf(text: string): Part[] {
  const spans: Span[] = [];
  for (const m of text.matchAll(MD_LINK)) {
    const link = classify(m[2]);
    spans.push({ start: m.index!, end: m.index! + m[0].length, part: { text: m[1] || m[2], ...(link ? { link } : {}) } });
  }
  const free = (start: number, end: number) => !spans.some((s) => start < s.end && end > s.start);
  for (const f of findLinks(text)) {
    if (!free(f.start, f.end)) continue;
    const raw = text.slice(f.start, f.end);
    const link: LinkTarget = f.kind === "url" ? { kind: "web", url: f.target } : { kind: "file", path: f.target, ...(f.line !== undefined ? { line: f.line } : {}), ...(f.column !== undefined ? { column: f.column } : {}) };
    spans.push({ start: f.start, end: f.end, part: { text: raw, link } });
  }
  for (const m of text.matchAll(EMAIL)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (free(start, end)) spans.push({ start, end, part: { text: m[0], link: { kind: "mail", href: "mailto:" + m[0] } } });
  }
  spans.sort((a, b) => a.start - b.start);
  const out: Part[] = [];
  let at = 0;
  for (const s of spans) {
    if (s.start < at) continue;
    if (s.start > at) out.push({ text: text.slice(at, s.start) });
    out.push(s.part);
    at = s.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** The comparison form of a path: slashes forward, no trailing slash, case folded on Windows-style paths. */
export function pathKey(path: string): string {
  const p = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return DRIVE.test(path) || path.startsWith("\\\\") ? p.toLowerCase() : p;
}

/** CHAT-025: how many of the newest messages count as "printed recently". */
export const RECENT_ITEMS = 200;

/** CHAT-025: the paths the agent itself printed recently: those in its own replies and plans, and those of the files its
 * tools read or wrote. Text the user typed (or a hook relayed as theirs) never adds one. */
export function printedPaths(items: readonly ChatItem[], cwd: string | null): Set<string> {
  const out = new Set<string>();
  const add = (p: string) => {
    const r = resolvePath(p, cwd);
    if (r) out.add(pathKey(r));
  };
  const scan = (text: string) => {
    for (const part of partsOf(text)) if (part.link?.kind === "file") add(part.link.path);
  };
  for (const it of items.slice(-RECENT_ITEMS)) {
    if (it.role !== "assistant") continue;
    if (it.kind === "text" || it.kind === "plan") scan(it.text);
    if (it.kind === "tool" && it.tool) {
      for (const d of it.tool.diffs ?? []) add(d.path);
      if (it.tool.group === "read" || it.tool.group === "edit") {
        const c = classify(it.tool.preview);
        if (c?.kind === "file") add(c.path);
      }
    }
  }
  return out;
}

/** CHAT-025: a file link opens only when the agent printed that path recently. Returns the full path to open, or null. */
export function openablePath(link: Extract<LinkTarget, { kind: "file" }>, cwd: string | null, printed: ReadonlySet<string>): string | null {
  const full = resolvePath(link.path, cwd);
  return full && printed.has(pathKey(full)) ? full : null;
}

export type Browser = "kolux" | "system";
/** CHAT-025: what a click on a web link does. A plain click asks (a small choice between the in-app and the system browser);
 * the link modifier (Ctrl, Cmd on a Mac) takes the main choice, with Shift the other one. inKolux: the setting that makes
 * the in-app viewer the main choice; viewer: an in-app viewer is wired at all (without one every link goes to the system browser). */
export function webClick(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, mac: boolean, inKolux: boolean, viewer: boolean): "ask" | Browser {
  if (!viewer) return "system";
  if (!(mac ? e.metaKey : e.ctrlKey)) return "ask";
  const main: Browser = inKolux ? "kolux" : "system";
  return e.shiftKey ? (main === "kolux" ? "system" : "kolux") : main;
}

/** T-329-b: the settings key behind "Open links in Kolux" (off unless it is exactly true). Settings > General writes it, the chat reads it. */
export const LINKS_IN_KOLUX_FIELD = "linksOpenInKolux";
export const linksOpenInKolux = (settings: Record<string, unknown> | null | undefined): boolean => settings?.[LINKS_IN_KOLUX_FIELD] === true;

/** T-329-b: where the editor puts the cursor for a file link `path:line:column`. Lines and columns are counted from 1 in the
 * text and the editor's column from 0; a missing, zero, negative or fractional number gives nothing for the line (no jump)
 * or the line's start for the column. */
export function fileJump(line?: number, column?: number): { line: number; col: number } | undefined {
  if (typeof line !== "number" || !Number.isFinite(line) || line < 1) return undefined;
  const col = typeof column === "number" && Number.isFinite(column) && column >= 1 ? Math.floor(column) - 1 : 0;
  return { line: Math.floor(line), col };
}
