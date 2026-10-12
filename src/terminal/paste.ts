// TERM-068: a paste arrives through one pane's own text area, so it can only land in the pane
// that has focus, and the browser hands over the clipboard in the same tick, so there is no
// moment in which the target could change. A paste made while the opening prompt is still owed
// (SESS-051) waits and goes in after it. Pure enough to test with a bare EventTarget.
export function attachPaste(target: EventTarget | null | undefined, paste: (text: string) => void, held: () => boolean) {
  const queued: string[] = [];
  const onPaste = (e: Event) => {
    const text = (e as ClipboardEvent).clipboardData?.getData("text") ?? "";
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!text) return;
    if (held()) queued.push(text);
    else paste(text);
  };
  target?.addEventListener("paste", onPaste, { capture: true });
  return {
    /** Deliver what waited, oldest first. */
    flush: () => {
      for (const text of queued.splice(0)) paste(text);
    },
    detach: () => target?.removeEventListener("paste", onPaste, { capture: true }),
  };
}
