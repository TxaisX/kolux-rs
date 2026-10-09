// The status bar's memory figure: the app's working set in bytes (from the Rust side), shown the
// way DESIGN.md section 8 shows it ("717.9 MB"), one decimal, GB past 1024 MB.

const MB = 1024 * 1024;

export function formatMemory(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "– MB";
  const mb = bytes / MB;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}
