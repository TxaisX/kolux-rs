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
