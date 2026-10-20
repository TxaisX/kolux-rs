// T-240 (BROW-028) and T-158 (BROW-029): the words around a cookie import. Google sign-ins are
// never brought in; the menu says so up front, and the result gives Google-specific advice only
// when Google rows really were left out.

/** What a cookie import reports. */
export type CookieReport = { imported: number; sites: number; skipped: number; google: number; reasons: string[] };

/** The line at the bottom of the Import Cookies menu. */
export const GOOGLE_NOTE = "Google cookies are left out: sign in to Google directly in this pane.";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The toast after an import. */
export function cookieReportText(r: CookieReport): string {
  const parts = [`${plural(r.imported, "cookie")} for ${plural(r.sites, "site")} imported`];
  if (r.skipped) parts.push(`${r.skipped} skipped (${r.reasons.join("; ")})`);
  if (r.google > 0) parts.push(`${plural(r.google, "Google sign-in cookie")} left out; sign in to Google directly in this pane`);
  return parts.join("; ");
}

/** T-240 (BROW-028): where an import comes from. Chrome is a guided export, never a read of Chrome's own store. */
export type CookieSource = "chrome" | "file";

/** The Import Cookies menu, in order. */
export const IMPORT_SOURCES: { source: CookieSource; label: string }[] = [
  { source: "chrome", label: "Import from Google Chrome…" },
  { source: "file", label: "Import from a file…" },
];

/**
 * The guided steps for Chrome. Chrome locks its cookie store to itself (app-bound encryption), so
 * Kolux never opens it: the user exports the sites they want from inside Chrome, then picks that file.
 */
export const CHROME_STEPS: string[] = [
  "In Google Chrome, add a cookies.txt export extension from the Chrome Web Store (one that saves the Netscape cookies.txt format).",
  "Open each site you want signed in here, then use the extension to export its cookies (or all cookies) to a cookies.txt file.",
  "Come back and choose that file below; the cookies go into this tab's profile. Delete the file afterwards: it holds your sign-ins.",
];

/** The file picker for a source: Chrome's export is cookies.txt; a plain file may be either shape. */
export function pickerFor(source: CookieSource): { title: string; filters: { name: string; extensions: string[] }[] } {
  if (source === "chrome") return { title: "Choose the cookies.txt file exported from Chrome", filters: [{ name: "cookies.txt export", extensions: ["txt"] }] };
  return { title: "Import cookies from a file", filters: [{ name: "Cookie file (cookies.txt or JSON list)", extensions: ["txt", "json"] }] };
}
