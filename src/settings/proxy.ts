// SET-040 (T-323): the network proxy for Kolux's own traffic, in Settings > General. The address is
// kept sealed in the `httpProxy` setting (SAFE-026, T-157) through secret_set, never in the clear;
// the bypass list and the HTTP/1 switch are plain settings. Values are checked and tidied first.
export const PROXY_FIELD = "httpProxy";
export const BYPASS_FIELD = "httpProxyBypass";
export const HTTP1_FIELD = "httpProxyHttp1";

const SCHEMES = ["http:", "https:", "socks5:", "socks5h:"];

/** A proxy address tidied (`host:port` gets http://, trailing slash dropped), "" for none, or an error. */
export function tidyProxy(input: string): { value: string } | { error: string } {
  const t = input.trim();
  if (!t) return { value: "" };
  const withScheme = /^[a-z0-9+.-]+:\/\//i.test(t) ? t : "http://" + t;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { error: `"${t}" is not a proxy address. Use host:port or http://host:port.` };
  }
  if (!SCHEMES.includes(u.protocol)) return { error: `Proxies here use http, https or socks5, not ${u.protocol.replace(":", "")}.` };
  if (!u.hostname) return { error: "The proxy address needs a host." };
  if (u.pathname !== "/" || u.search || u.hash) return { error: "A proxy address is a host and port only, with no path." };
  const auth = u.username ? `${u.username}${u.password ? ":" + u.password : ""}@` : "";
  return { value: `${u.protocol}//${auth}${u.host}` };
}

const ENTRY = /^(\*\.|\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$|^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$|^<local>$|^\*$/;

/** The bypass list (commas, spaces or new lines between), tidied: lower case, no repeats; or an error
 *  naming the entries that are not host names, addresses or ranges. */
export function tidyBypass(input: string): { value: string[] } | { error: string } {
  const all = input.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const bad = all.filter((e) => !ENTRY.test(e));
  if (bad.length) return { error: `Not a host, address or range: ${bad.join(", ")}.` };
  return { value: [...new Set(all)] };
}

/** The saved bypass list and switch (the address itself is sealed and never read back). */
export function readProxyRest(s: Record<string, unknown>): { bypass: string[]; http1: boolean } {
  const b = s[BYPASS_FIELD];
  return { bypass: Array.isArray(b) ? b.filter((e): e is string => typeof e === "string") : [], http1: s[HTTP1_FIELD] === true };
}

export type ProxyDraft = { address: string; bypass: string };
export type ProxyApply = { address: string; patch: Record<string, unknown> } | { errors: string[] };

/** Checks a whole draft at once: either every error (the earlier ones are gone), or what to store. */
export function applyDraft(d: ProxyDraft, http1: boolean): ProxyApply {
  const a = tidyProxy(d.address);
  const b = tidyBypass(d.bypass);
  const errors = ["error" in a ? a.error : "", "error" in b ? b.error : ""].filter(Boolean);
  if (errors.length || "error" in a || "error" in b) return { errors };
  return { address: a.value, patch: { [BYPASS_FIELD]: b.value, [HTTP1_FIELD]: http1 } };
}
