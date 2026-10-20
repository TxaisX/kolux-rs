// VIEW-078: the address a dev server printed, picked out of terminal output, and the rules for which
// address "Open" uses for a listening port. Pure text work, so it is tested without a terminal.

/** What the terminal paints besides text: colour and cursor sequences, OSC titles and links. */
// eslint-disable-next-line no-control-regex
const ESC = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
export const stripAnsi = (s: string) => s.replace(ESC, "");

const URL_RE = /\bhttps?:\/\/(?:\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.*_-]+)(?::\d{1,5})?(?:[/?#][^\s<>"'`\])]*)?/g;
const TRAIL = /[.,;:!?)\]}>'"`]+$/;

export type Printed = { port: number; url: string };

/** Every web address in `text` that names a port (the scheme's own port counts), with a listen-everywhere host turned into localhost. */
export function printedUrls(text: string): Printed[] {
  const out: Printed[] = [];
  for (const m of stripAnsi(text).matchAll(URL_RE)) {
    const url = m[0].replace(TRAIL, "").replace(/^(https?:\/\/)(?:\*|\[::\]|0\.0\.0\.0)(?=[:/?#]|$)/i, "$1localhost");
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      continue;
    }
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    if (port >= 1 && port <= 65535) out.push({ port, url });
  }
  return out;
}

/** A printed address with the terminal that printed it and, once a scan has seen the port, the terminal's own program holding it. */
type Entry = { url: string; terminal: number; pid?: number };

/** One holder of a port as the scan reports it: the program and the terminal whose pane started it. */
type Holder = { port: number; pid: number; terminal: number | null };

/**
 * The addresses terminals printed, by port; a later print of a port replaces an earlier one. A web
 * address cut by a chunk edge is joined from the tail kept per terminal. Each address stays tied to
 * the terminal that printed it and binds only to a program under that terminal's pane, so neither a
 * program another terminal (or nothing in Kolux) started nor a later program on the port inherits it.
 */
export class UrlBook {
  private byPort = new Map<number, Entry>();
  private tails = new Map<number, string>();

  feed(terminal: number, chunk: string) {
    const text = (this.tails.get(terminal) ?? "") + chunk;
    for (const p of printedUrls(text)) this.byPort.set(p.port, { url: p.url, terminal });
    // only the unfinished last word can still become a longer address
    const cut = Math.max(text.lastIndexOf("\n"), text.lastIndexOf(" "), text.lastIndexOf("\r"));
    this.tails.set(terminal, text.slice(cut + 1).slice(-300));
  }

  /** The terminal ended: its unfinished tail and every address it printed go with it. */
  forget(terminal: number) {
    this.tails.delete(terminal);
    for (const [port, e] of [...this.byPort]) if (e.terminal === terminal) this.byPort.delete(port);
  }

  get(port: number): string | undefined {
    return this.byPort.get(port)?.url;
  }

  /**
   * After each scan: an address whose port no program under its terminal holds is dropped (nothing
   * listens, or only a program another terminal or nothing in Kolux started); the first such scan
   * after a print ties the address to the terminal's program on the port; when that program is gone,
   * the address goes with it rather than to whoever holds the port next. A port may have several
   * holders (two servers' IPv4 and IPv6 sockets), so every holder is looked at.
   */
  sync(listening: Iterable<Holder>) {
    const live = new Map<number, Holder[]>();
    for (const l of listening) live.set(l.port, [...(live.get(l.port) ?? []), l]);
    for (const [port, e] of [...this.byPort]) {
      const holders = live.get(port) ?? [];
      const own = e.pid === undefined ? holders.find((h) => h.terminal === e.terminal) : holders.find((h) => h.pid === e.pid && h.terminal === e.terminal);
      if (own === undefined) this.byPort.delete(port);
      else e.pid = own.pid;
    }
  }
}

/** The address "Open" goes to: the one the dev server printed when known, otherwise plain http on the listening address. */
export function openUrl(port: number, address: string, printed?: string): string {
  if (printed) return printed;
  const a = address.trim().toLowerCase();
  const host = a === "" || a === "*" || a === "0.0.0.0" || a === "::" ? "localhost" : a.includes(":") ? `[${a.replace(/^\[|\]$/g, "")}]` : a;
  return `http://${host}:${port}`;
}
