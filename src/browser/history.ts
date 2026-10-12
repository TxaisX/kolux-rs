// BROW-005: the history the app keeps for a browser tab. wry has no can-go-back, so the entries
// come from what the toolbar asked and the loads the page starts (see BrowserPane).
export type Hist = { urls: string[]; at: number; busy: boolean };
/** What the toolbar asked for just before a load started: back, forward, the same page (reload), or nothing. */
export type Pending = "back" | "forward" | "same" | null;

export const BLANK = "about:blank";

export function fresh(): Hist {
  return { urls: [BLANK], at: 0, busy: false };
}

/**
 * A page load starting at `url`. What the toolbar asked wins; a load that starts while the last
 * one is still busy is a redirect and replaces the entry; the same address again is the same
 * entry; a load to the neighbouring entry with nothing asked is the page's own back or forward
 * (T-012-b-fix); anything else is a new entry, cutting off what was ahead.
 */
export function started(h: Hist, pending: Pending, url: string): Hist {
  let { urls, at } = h;
  if (pending === "back") at = Math.max(0, at - 1);
  else if (pending === "forward") at = Math.min(urls.length - 1, at + 1);
  else if (h.busy) urls = urls.map((u, i) => (i === at ? url : u));
  else if (pending === "same" || url === urls[at]) {
    // the same page: nothing moves
  } else if (url === urls[at - 1]) at -= 1;
  else if (url === urls[at + 1]) at += 1;
  else {
    urls = [...urls.slice(0, at + 1), url];
    at = urls.length - 1;
  }
  return { urls, at, busy: true };
}

export function can(h: Hist) {
  return { back: h.at > 0, forward: h.at < h.urls.length - 1 };
}
