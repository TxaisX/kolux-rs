// VIEW-078: the pure parts of the status bar's Ports item. The back end (ports.rs) lists the
// listening ports and says which belong to the active workspace; this file picks up the address a
// dev server printed in its terminal, checks it against the listening ports, and decides where Open
// goes and what a failed scan leaves on screen.

export type PortRow = { port: number; addr: string; pid: number; external: boolean };

// Colours and cursor moves in terminal output are not part of an address.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|[A-Za-z0-9.-]+):(\d{2,5})(?:\/[^\s'"<>)\]]*)?/g;

/** Every web address with a port in a piece of terminal output, as [port, address]. */
export function urlsIn(text: string): [number, string][] {
  const clean = text.replace(ANSI, "");
  const out: [number, string][] = [];
  for (const m of clean.matchAll(URL_RE)) {
    const port = Number(m[1]);
    if (port > 0 && port <= 65535) out.push([port, m[0]]);
  }
  return out;
}

/** The addresses terminals printed, newest per port, capped so a noisy log cannot grow it. */
export class PrintedUrls {
  private seen = new Map<number, string>();
  /** Notes the addresses in `text`; a port printed again keeps its newest address. */
  record(text: string): void {
    for (const [port, url] of urlsIn(text)) {
      this.seen.delete(port);
      this.seen.set(port, url);
    }
    while (this.seen.size > 200) this.seen.delete(this.seen.keys().next().value as number);
  }
  /** The printed address for `port`, only while a process really listens there: an address for a port nothing holds is stale. */
  forPort(port: number, listening: readonly PortRow[]): string | null {
    return listening.some((r) => r.port === port) ? (this.seen.get(port) ?? null) : null;
  }
}

/** The address Open uses: what the dev server printed when known, otherwise plain http on the listening address. */
export function openAddress(row: PortRow, printed: string | null): string {
  if (printed) return printed;
  const any = row.addr === "0.0.0.0" || row.addr === "::" || row.addr === "";
  const host = any ? "localhost" : row.addr.includes(":") ? `[${row.addr}]` : row.addr;
  return `http://${host}:${row.port}`;
}

/** Open goes to the Kolux browser; Shift with Ctrl (or Cmd) goes to the system browser instead. */
export const openWhere = (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): "kolux" | "system" => (e.shiftKey && (e.ctrlKey || e.metaKey) ? "system" : "kolux");

/** What the popover shows after a scan: a failure names its problem and keeps the last good list. */
export type PortsView = { rows: PortRow[]; error: string | null };
export const afterScan = (prev: PortsView, got: { rows: PortRow[] } | { error: string }): PortsView => ("error" in got ? { rows: prev.rows, error: got.error } : { rows: got.rows, error: null });

/** The count the status bar item shows: only the workspace's own ports. */
export const ownCount = (rows: readonly PortRow[]): number => rows.filter((r) => !r.external).length;

/** Terminal output arrives base64 encoded; the text, or empty when it is not text. */
export function decodeOutput(data: string): string {
  try {
    const bin = atob(data);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}
