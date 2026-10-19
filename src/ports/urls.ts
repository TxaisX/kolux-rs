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

/** The addresses terminals printed, by port; a later print of a port replaces an earlier one. A web address cut by a chunk edge is joined from the tail kept per terminal. */
export class UrlBook {
  private byPort = new Map<number, string>();
  private tails = new Map<number, string>();

  feed(terminal: number, chunk: string) {
    const text = (this.tails.get(terminal) ?? "") + chunk;
    for (const p of printedUrls(text)) this.byPort.set(p.port, p.url);
    // only the unfinished last word can still become a longer address
    const cut = Math.max(text.lastIndexOf("\n"), text.lastIndexOf(" "), text.lastIndexOf("\r"));
    this.tails.set(terminal, text.slice(cut + 1).slice(-300));
  }

  forget(terminal: number) {
    this.tails.delete(terminal);
  }

  get(port: number): string | undefined {
    return this.byPort.get(port);
  }

  /** Addresses of ports nothing listens on any more are dropped, so a later program on that port is not given a stale one. */
  keepOnly(listening: Iterable<number>) {
    const live = new Set(listening);
    for (const p of [...this.byPort.keys()]) if (!live.has(p)) this.byPort.delete(p);
  }
}

/** The address "Open" goes to: the one the dev server printed when known, otherwise plain http on the listening address. */
export function openUrl(port: number, address: string, printed?: string): string {
  if (printed) return printed;
  const a = address.trim().toLowerCase();
  const host = a === "" || a === "*" || a === "0.0.0.0" || a === "::" ? "localhost" : a.includes(":") ? `[${a.replace(/^\[|\]$/g, "")}]` : a;
  return `http://${host}:${port}`;
}
