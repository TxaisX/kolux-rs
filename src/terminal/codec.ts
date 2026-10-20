// How terminal bytes cross the Rust/JS border.
// Output comes as base64 (the Rust side encodes raw PTY bytes, so a multi-byte character split
// across two chunks is reassembled by xterm's own decoder, not lost). Input goes back as the
// string xterm produced; the Rust side writes its UTF-8 bytes.

export function decodeOutput(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export type OutputEvent = { id: number; data: string; pane?: number | null; generation?: number };

/**
 * TERM-098: whether an output chunk belongs to this pane. By terminal id once known; before the
 * spawn call has answered, by the pane key the chunk was tagged with, so the program's first frame
 * (and its cursor question, which the console waits on) is drawn instead of dropped.
 */
export function forPane(e: { id: number; pane?: number | null }, id: number | null, key: number | undefined): boolean {
  return id === null ? key !== undefined && e.pane === key : e.id === id;
}
export type ExitEvent = { id: number; code: number | null };

// What the pane header says once the program is gone.
export function endedLabel(code: number | null): string {
  return code === null ? "ended" : code === 0 ? "ended" : `ended (exit ${code})`;
}
