// T-238-b (BROW-013): the pane's strip of downloads. The back end sends one `browser-download`
// event per change (requested, bytes written, total learned, finished, failed, cancelled); the
// strip keeps one row per download key, shows bytes received and the total when both are known,
// says when one finished, and lets a finished row go after a while or at a click.
export type DownloadState = "running" | "done" | "failed" | "cancelled";
export type Download = { id: number; key: number; url: string; name: string; path: string; received: number; total: number | null; state: DownloadState };
export type Row = Download & { since: number };

/** A finished, failed or cancelled row leaves the strip on its own after this long. */
export const LINGER_MS = 8000;

export function reduce(rows: Row[], e: Download, now: number): Row[] {
  const i = rows.findIndex((r) => r.key === e.key);
  const row: Row = { ...e, since: i >= 0 && e.state === rows[i].state ? rows[i].since : now };
  if (i < 0) return [...rows, row];
  return rows.map((r, j) => (j === i ? row : r));
}

/** Rows whose end is older than LINGER_MS are gone; running rows stay. */
export function prune(rows: Row[], now: number): Row[] {
  return rows.filter((r) => r.state === "running" || now - r.since < LINGER_MS);
}

export function dismiss(rows: Row[], key: number): Row[] {
  return rows.filter((r) => r.key !== key);
}

export function human(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i += 1;
  }
  return i === 0 ? `${bytes} B` : `${v.toFixed(1)} ${units[i]}`;
}

/** "1.5 KB of 4.5 MB" while the total is known, the bytes alone otherwise. */
export function progressText(received: number, total: number | null): string {
  return total && total > 0 ? `${human(received)} of ${human(total)}` : human(received);
}

export function fraction(d: Download): number | null {
  return d.total && d.total > 0 ? Math.min(1, d.received / d.total) : null;
}

/** The row's status words. */
export function status(d: Download): string {
  switch (d.state) {
    case "running":
      return progressText(d.received, d.total);
    case "done":
      return `finished, ${human(d.received)}`;
    case "failed":
      return d.path && !/[\\/]/.test(d.path) ? `failed: ${d.path}` : "failed";
    case "cancelled":
      return "cancelled";
  }
}

/** Whether a tab still writes a download (BROW-013: the memory budget leaves such a page alone). */
export function busy(rows: Row[]): boolean {
  return rows.some((r) => r.state === "running");
}
