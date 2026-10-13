// TERM-068: a paste arrives through one pane's own text area, so it can only land in the pane
// that has focus, and the browser hands over the clipboard in the same tick, so there is no
// moment in which the target could change. A paste made while the opening prompt is still owed
// (SESS-051) waits and goes in after it. Pure enough to test with a bare EventTarget.
// TERM-071: a large paste goes to the terminal in CHUNK-sized pieces with a timer tick between
// them, so the page stays clickable while a multi-megabyte block is fed; text over LIMIT is
// refused with a message and nothing is sent.
export const CHUNK = 64 * 1024;
export const LIMIT = 8 * 1024 * 1024;

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;

export function attachPaste(target: EventTarget | null | undefined, paste: (text: string) => void, held: () => boolean, refused: (message: string) => void = () => {}) {
  const queued: string[] = [];
  const chunks: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pump = () => {
    timer = null;
    const next = chunks.shift();
    if (next === undefined) return;
    paste(next);
    if (chunks.length > 0) timer = setTimeout(pump, 0);
  };
  const deliver = (text: string) => {
    for (let at = 0; at < text.length; at += CHUNK) chunks.push(text.slice(at, at + CHUNK));
    if (timer === null) pump();
  };
  const onPaste = (e: Event) => {
    const text = (e as ClipboardEvent).clipboardData?.getData("text") ?? "";
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!text) return;
    if (text.length > LIMIT) {
      refused(`Paste of ${mb(text.length)} is over the ${mb(LIMIT)} limit; nothing was sent`);
      return;
    }
    if (held()) queued.push(text);
    else deliver(text);
  };
  target?.addEventListener("paste", onPaste, { capture: true });
  return {
    /** Deliver what waited, oldest first. */
    flush: () => {
      for (const text of queued.splice(0)) deliver(text);
    },
    detach: () => {
      target?.removeEventListener("paste", onPaste, { capture: true });
      if (timer !== null) clearTimeout(timer);
      chunks.length = 0;
    },
  };
}
