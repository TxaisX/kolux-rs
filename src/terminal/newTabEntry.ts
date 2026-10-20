// TERM-042 (T-219): the new tab entry box. What typed text means (a web address, a local file, a
// search of the open tabs and history), the result rows in the order they show, the remembered
// recent entries and the arrow-key highlight. Pure: the window supplies the open tabs, the history,
// and a check that a path is a real file.

const PRIVATE_V4 = /^(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;
const octets = (h: string) => h.split(".").every((o) => Number(o) <= 255);

/**
 * A web address in `text`, or null. http/https URLs as typed; localhost-style dev hosts
 * (localhost, *.localhost, 127.x) and private IPv4 addresses, with or without a scheme, port or
 * path, are web addresses too, and a bare one gets http.
 */
export function webAddress(text: string): string | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  if (/^https?:\/\/\S+$/i.test(t)) {
    try {
      return new URL(t).protocol.startsWith("http") ? t : null;
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return null; // another scheme is not a web address
  const m = /^([^/:?#]+)(?::(\d{1,5}))?([/?#].*)?$/.exec(t);
  if (!m) return null;
  const host = m[1].toLowerCase();
  if (m[2] !== undefined && Number(m[2]) > 65535) return null;
  const dev = host === "localhost" || host.endsWith(".localhost");
  const priv = PRIVATE_V4.test(host) && octets(host);
  return dev || priv ? `http://${t}` : null;
}

/** Whether `text` reads as a local path (absolute, home-relative, dot-relative, or folder/name.ext). */
export function looksLikePath(text: string): boolean {
  const t = text.trim();
  if (!t || /[\r\n]/.test(t)) return false;
  if (/^[a-z]:[\\/]/i.test(t) || t.startsWith("\\\\") || t.startsWith("/") || t.startsWith("~/") || t.startsWith("~\\") || /^\.\.?[\\/]/.test(t)) return true;
  return /[\\/]/.test(t) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(t) && /[^\\/]+\.[a-z0-9]+$/i.test(t);
}

/** The file name and the folder it sits in, for rows that show the name first. */
export function splitPath(path: string): { name: string; folder: string } {
  const p = path.replace(/[\\/]+$/, "");
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i < 0 ? { name: p, folder: "" } : { name: p.slice(i + 1), folder: p.slice(0, i) };
}

export type Row =
  | { kind: "url"; url: string; label: string; detail: string }
  | { kind: "file"; path: string; label: string; detail: string }
  | { kind: "tab"; key: number; label: string; detail: string }
  | { kind: "history"; value: string; label: string; detail: string }
  | { kind: "recent"; value: string; label: string; detail: string };

export type EntryContext = {
  tabs: { key: number; name: string }[];
  /** Addresses and files opened before, newest first. */
  history: string[];
  /** Entries typed here before, newest first. */
  recents: string[];
  /** True when `path` is a real file on disk. */
  fileExists: (path: string) => boolean;
};

const MAX_ROWS = 12;

/**
 * The rows for what was typed, best first: the address or file it names, then open tabs and
 * history that contain it. With nothing typed, the remembered recent entries by recency.
 */
export function entryRows(text: string, ctx: EntryContext): Row[] {
  const t = text.trim();
  if (!t) return ctx.recents.slice(0, MAX_ROWS).map((value) => ({ kind: "recent", value, label: splitOrSelf(value).name, detail: splitOrSelf(value).folder }));
  const rows: Row[] = [];
  const url = webAddress(t);
  if (url) rows.push({ kind: "url", url, label: `Open ${url}`, detail: "in the browser" });
  else if (looksLikePath(t) && ctx.fileExists(t)) {
    const { name, folder } = splitPath(t);
    rows.push({ kind: "file", path: t, label: name, detail: folder });
  }
  const q = t.toLowerCase();
  for (const tab of ctx.tabs) if (tab.name.toLowerCase().includes(q)) rows.push({ kind: "tab", key: tab.key, label: tab.name, detail: "open tab" });
  for (const h of ctx.history) {
    if (!h.toLowerCase().includes(q) || rows.some((r) => (r.kind === "url" && r.url === h) || (r.kind === "file" && r.path === h))) continue;
    const { name, folder } = splitOrSelf(h);
    rows.push({ kind: "history", value: h, label: name, detail: folder });
  }
  return rows.slice(0, MAX_ROWS);
}

const splitOrSelf = (v: string): { name: string; folder: string } => (webAddress(v) || /^https?:\/\//i.test(v) ? { name: v, folder: "" } : splitPath(v));

/** Remember an entry: newest first, no repeats, at most `max`. */
export function rememberEntry(recents: string[], entry: string, max = 20): string[] {
  const e = entry.trim();
  return e ? [e, ...recents.filter((r) => r !== e)].slice(0, max) : recents;
}

/** Arrow keys: down and up move the highlight through `count` rows, stopping at the ends. */
export const moveHighlight = (at: number, count: number, step: 1 | -1): number => (count <= 0 ? 0 : Math.max(0, Math.min(count - 1, at + step)));

/** What Enter does on the highlighted row, or null when there is none. */
export function runRow(rows: Row[], at: number): Row | null {
  return rows[at] ?? null;
}
