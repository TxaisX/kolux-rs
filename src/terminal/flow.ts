import { invoke } from "@tauri-apps/api/core";

/** ACCT-054: acknowledgements of drawn output go in running totals, one call per ACK_EVERY bytes
 * (or every ACK_DELAY_MS during a trickle) instead of one per chunk. */
export const ACK_EVERY = 32 * 1024;
export const ACK_DELAY_MS = 50;

export function batchAcks(send: (bytes: number) => void) {
  let pending = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const n = pending;
    pending = 0;
    if (n > 0) send(n);
  };
  return {
    drew(bytes: number) {
      pending += bytes;
      if (pending >= ACK_EVERY) flush();
      else timer ??= setTimeout(flush, ACK_DELAY_MS);
    },
    flush,
    stop() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = 0;
    },
  };
}

export type MemoryProfile = { profile: string; totalMb: number; scrollback: number };
let cached: Promise<MemoryProfile> | null = null;
const FALLBACK: MemoryProfile = { profile: "medium", totalMb: 0, scrollback: 5000 };

/** ACCT-059: this machine's memory profile and the scrollback each pane keeps, asked once per start. */
export function memoryProfile(): Promise<MemoryProfile> {
  cached ??= invoke<MemoryProfile>("terminal_memory_profile").catch(() => FALLBACK);
  return cached;
}
