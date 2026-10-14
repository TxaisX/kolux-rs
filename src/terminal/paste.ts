// TERM-068: a paste arrives through one pane's own text area, so it can only land in the pane
// that has focus, and the browser hands over the clipboard in the same tick, so there is no
// moment in which the target could change. A paste made while the opening prompt is still owed
// (SESS-051) waits and goes in after it. Pure enough to test with a bare EventTarget.
// TERM-071: a large paste goes to the program in CHUNK-sized pieces, each sent only after the one
// before it landed, so the page stays clickable while a multi-megabyte block is fed; text over
// LIMIT is refused with a message and nothing is sent.
// Council D2 MERGE 31 (2): a chunk is never cut between "\r" and "\n" or inside a surrogate pair
// (an emoji split in two reaches the program as two broken characters), the whole paste is
// bracketed once (xterm's own paste would wrap every chunk, which a program reads as several
// pastes), newlines are rewritten the way xterm does it, and Ctrl+C or Esc drops what is still
// queued and closes the open bracket before the key goes.
export const CHUNK = 64 * 1024;
export const LIMIT = 8 * 1024 * 1024;
export const BRACKET_OPEN = "\x1b[200~";
export const BRACKET_CLOSE = "\x1b[201~";

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;

/** Cuts `text` into pieces of at most `size` chars, stepping back one when the cut would fall between "\r" and "\n" or inside a surrogate pair. */
export function cutChunks(text: string, size = CHUNK): string[] {
  const out: string[] = [];
  for (let at = 0; at < text.length; ) {
    let end = Math.min(at + size, text.length);
    if (end < text.length) {
      const c = text.charCodeAt(end);
      if ((c >= 0xdc00 && c <= 0xdfff) || (c === 0x0a && text.charCodeAt(end - 1) === 0x0d)) end = Math.max(end - 1, at + 1);
    }
    out.push(text.slice(at, end));
    at = end;
  }
  return out;
}

/** What xterm does to pasted text before the program sees it: every line end becomes a carriage return.
 *  T-278-d (council D2 MERGE 32 A1): inside a bracketed paste every ESC byte is dropped too, so a clipboard
 *  holding ESC[201~ can never close the bracket early and type what follows straight into the shell (the
 *  rule is "every ESC", not only the two bracket sequences: simpler, and no control sequence belongs in a paste). */
export const prepareForTerminal = (text: string, bracketed = false) => (bracketed ? text.replace(/\x1b/g, "") : text).replace(/\r?\n/g, "\r");

type Chunk = { data: string; open: boolean };

/** How many lines a paste holds (a trailing line end does not add an empty one). A bare "\r" ends a line
 *  too (council D2 MERGE 47 F1): a terminal runs on it just as on "\n". */
export const lineCount = (text: string) => stripEnd(text).split(/\r\n|\r|\n/).length;
const stripEnd = (text: string) => text.replace(/(\r\n|\r|\n)$/, "");

/** T-151-b (council FIX-SOON, TERM-069): a paste of 2+ lines into a program that has not turned on bracketed
 *  paste runs each line as it lands (Windows PowerShell 5.1 under ConPTY never sees the brackets), so the
 *  pane asks first, like Windows Terminal's warning. One line, or a program that brackets, goes straight in. */
export const needsAsk = (text: string, bracketed: boolean) => !bracketed && lineCount(text) >= 2;

export function attachPaste(
  target: EventTarget | null | undefined,
  send: (data: string) => unknown,
  held: () => boolean,
  refused: (message: string) => void = () => {},
  bracketed: () => boolean = () => false,
  /** TERM-069: true (Windows) forces a multi-line paste onto the bracketed path even when the
   *  program has not asked for it; a program that honours brackets then takes the lines as one
   *  paste, and the console layer drops the markers for one that does not (measured: Windows
   *  PowerShell 5.1 under ConPTY shows nothing of them). Single-line text keeps the fast path. */
  forceMultiLine: () => boolean = () => false,
  /** T-151-b: given, a multi-line paste into a program without bracketed paste is handed here with the line
   *  count and a `go` that sends it; the caller shows "Paste N lines?" and calls `go` on Paste, nothing on Cancel. */
  ask?: (lines: number, go: () => void) => void,
) {
  const queued: string[] = [];
  const chunks: Chunk[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The last chunk's write has not landed yet (a `send` that returns a promise); the next waits for it. */
  let inFlight = false;
  /** A bracket pair is open: its opening went to the program and its closing has not. */
  let open = false;
  const pump = () => {
    timer = null;
    inFlight = false;
    const next = chunks.shift();
    if (next === undefined) return;
    open = next.open;
    const landed = send(next.data);
    if (landed instanceof Promise) {
      inFlight = true;
      landed.then(pump, () => {
        inFlight = false;
        chunks.length = 0; // the program side refused the write (already said out loud); the rest would fail the same way
      });
    } else if (chunks.length > 0) timer = setTimeout(pump, 0);
  };
  const deliver = (text: string) => {
    const wrap = bracketed() || (/[\r\n]/.test(text) && forceMultiLine());
    const pieces = cutChunks(text).map((piece) => prepareForTerminal(piece, wrap));
    const last = pieces.length - 1;
    pieces.forEach((data, i) => {
      if (wrap && i === 0) data = BRACKET_OPEN + data;
      if (wrap && i === last) data += BRACKET_CLOSE;
      chunks.push({ data, open: wrap && i < last });
    });
    if (timer === null && !inFlight) pump();
  };
  const onPaste = (e: Event) => {
    let text = (e as ClipboardEvent).clipboardData?.getData("text") ?? "";
    e.preventDefault();
    e.stopImmediatePropagation();
    // Council D2 MERGE 47 F1: one line with a line end at the end ("evil-cmd\n") is typed without it, like
    // Windows Terminal's trimPaste, so a single-line paste never runs by itself.
    if (lineCount(text) === 1) text = stripEnd(text);
    if (!text) return;
    if (text.length > LIMIT) {
      refused(`Paste of ${mb(text.length)} is over the ${mb(LIMIT)} limit; nothing was sent`);
      return;
    }
    const go = () => {
      if (held()) queued.push(text);
      else deliver(text);
    };
    if (ask && needsAsk(text, bracketed())) ask(lineCount(text), go);
    else go();
  };
  target?.addEventListener("paste", onPaste, { capture: true });
  return {
    /** Deliver what waited, oldest first. */
    flush: () => {
      for (const text of queued.splice(0)) deliver(text);
    },
    /** Ctrl+C or Esc mid-paste: drop what has not gone yet and close the bracket the program is still inside. */
    cancel: () => {
      chunks.length = 0;
      queued.length = 0;
      if (open) {
        open = false;
        void send(BRACKET_CLOSE);
      }
    },
    detach: () => {
      target?.removeEventListener("paste", onPaste, { capture: true });
      if (timer !== null) clearTimeout(timer);
      chunks.length = 0;
    },
  };
}
