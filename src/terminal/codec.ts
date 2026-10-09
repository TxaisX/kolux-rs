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

export type OutputEvent = { id: number; data: string };
export type ExitEvent = { id: number; code: number | null };

// What the pane header says once the program is gone.
export function endedLabel(code: number | null): string {
  return code === null ? "ended" : code === 0 ? "ended" : `ended (exit ${code})`;
}
