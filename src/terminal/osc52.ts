// TERM-075: a program inside the pane (tmux, Neovim, Zellij) copies with OSC 52 and the text reaches the
// system clipboard. On by default (the pane's `clipboardFromPrograms` prop, a settings switch). A program
// can never read the clipboard back: a query ("?") is answered with an empty payload, so it unblocks
// without learning anything. The payload is capped. Each notice (blocked by the setting, over the cap,
// the write could not be confirmed) is said once per app session, in the pane header.

/** Base64 characters of one write; 100 KB of base64 is about 75 KB of text, more than any yank. */
export const PAYLOAD_CAP = 100_000;

export type Osc52 =
  | { kind: "write"; text: string }
  | { kind: "query" }
  | { kind: "clear" }
  | { kind: "over"; size: number };

/** Decodes "<selection>;<payload>" the way xterm documents it: "?" asks, base64 writes, anything else clears. */
export function parseOsc52(data: string, cap = PAYLOAD_CAP): Osc52 {
  const at = data.indexOf(";");
  const payload = at < 0 ? data : data.slice(at + 1);
  if (payload === "?") return { kind: "query" };
  if (payload.length > cap) return { kind: "over", size: payload.length };
  const clean = payload.replace(/\s+/g, "");
  if (clean === "" || !/^[A-Za-z0-9+/]+=*$/.test(clean)) return { kind: "clear" };
  try {
    const bin = atob(clean.padEnd(clean.length + ((4 - (clean.length % 4)) % 4), "="));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return { kind: "write", text: new TextDecoder("utf-8", { fatal: false }).decode(bytes) };
  } catch {
    return { kind: "clear" };
  }
}

export type Decision = {
  /** Text to put on the clipboard ("" clears it). */
  write?: string;
  /** Bytes to send back to the program (a query's empty answer). */
  reply?: string;
  /** A once-per-session notice for the header. */
  notice?: { key: string; text: string };
};

export const BLOCKED_NOTICE = "A program's copy to the clipboard was blocked by the setting Programs can copy to the clipboard";

/** What the pane does with one OSC 52 sequence. `allowed` is the setting; `shown` is false for a pane
 *  the user cannot see (a hidden tab), which never touches the clipboard or says anything. */
export function decideOsc52(parsed: Osc52, allowed: boolean, shown = true): Decision {
  // A query still gets its empty answer so the program does not hang; nothing else happens off screen.
  if (!shown && parsed.kind !== "query") return {};
  switch (parsed.kind) {
    case "query":
      // Nothing comes back: an empty payload, never the clipboard. The program does not hang on the answer.
      return { reply: "\x1b]52;c;\x1b\\" };
    case "over":
      // While the setting is off the write was never going through: say the setting, not the size.
      if (!allowed) return { notice: { key: "osc52-blocked", text: BLOCKED_NOTICE } };
      return { notice: { key: "osc52-over", text: `A program's clipboard write of ${Math.round(parsed.size / 1024)} KB was over the ${Math.round(PAYLOAD_CAP / 1024)} KB cap and was dropped` } };
    case "clear":
      return allowed ? { write: "" } : {};
    case "write":
      return allowed ? { write: parsed.text } : { notice: { key: "osc52-blocked", text: BLOCKED_NOTICE } };
  }
}

const said = new Set<string>();

/** Says `text` through `show` the first time `key` comes up in this app session. */
export function sayOnce(key: string, text: string, show: (text: string) => void): boolean {
  if (said.has(key)) return false;
  said.add(key);
  show(text);
  return true;
}

/** Tests only. */
export const resetNotices = () => said.clear();
