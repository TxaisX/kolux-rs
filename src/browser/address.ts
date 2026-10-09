// BROW-003: the address bar's reading of typed text. A full web or file address is taken as
// is; a local host opens over HTTP; something shaped like a domain opens over HTTPS; an
// absolute path on disk becomes a file address; anything else is a web search. Any other
// scheme (javascript:, mailto:, ...) is refused, so a pasted script can never run as a page.
export const BLANK = "about:blank";

export const ENGINES = {
  google: "https://www.google.com/search?q=",
  duckduckgo: "https://duckduckgo.com/?q=",
  bing: "https://www.bing.com/search?q=",
  kagi: "https://kagi.com/search?q=",
} as const;
export type Engine = keyof typeof ENGINES;
/** OD-18: with the browser settings page cut, the engine is a fixed standard web search. */
export const DEFAULT_ENGINE: Engine = "google";

export type Resolved = { url: string } | { error: string };

function parse(u: string): Resolved {
  try {
    return { url: new URL(u).href };
  } catch {
    return { error: `invalid address: ${u}` };
  }
}

export function resolveAddress(text: string, engine: Engine = DEFAULT_ENGINE): Resolved {
  const t = text.trim();
  if (!t || t === BLANK) return { url: BLANK };
  if (/^(https?|file):/i.test(t)) return parse(t);
  if (/^([a-z]:[\\/]|\/)/i.test(t)) return parse("file:///" + encodeURI(t.replace(/^\/+/, "").replace(/\\/g, "/")).replace(/#/g, "%23"));
  // A scheme is letters then a colon; "localhost:3000" has digits after its colon, so it is a host.
  const scheme = /^([a-z][a-z0-9+.-]*):(?![0-9])/i.exec(t);
  if (scheme) return { error: `invalid address: ${scheme[1]}: is not a web, file or blank address` };
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#]|$)/i.test(t)) return parse("http://" + t);
  if (!/\s/.test(t) && /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]|$)/.test(t)) return parse("https://" + t);
  return { url: ENGINES[engine] + encodeURIComponent(t) };
}
