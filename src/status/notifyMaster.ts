// T-124-b (STAT-042 rest): the Notifications page's master switch and what a failed test offers.
// The master switch is on unless saved off; off, every control beneath it is greyed out and no
// notification is raised (agent notes, the quiet alert and usage alerts alike). A test the system
// did not show offers 'Open Settings' for the system's notification panel on Windows and macOS,
// and on any other system says the platform is not supported. Pure, tested in notifyMaster.test.ts;
// the Settings page, notifications.ts and usage/alerts.ts call it (evidence/hooks-T-124-b-*.patch).

export const MASTER_FIELD = "notificationsOn";

/** The master switch: on unless saved off (a missing value is read as on). */
export const masterOn = (s: Record<string, unknown>): boolean => s[MASTER_FIELD] !== false;

/** The quiet-alert minutes: a saved whole number from 0 (off) to 600, else 10. */
export function quietMinutes(s: Record<string, unknown>, field = "quietMinutes"): number {
  const v = s[field];
  return typeof v === "number" && Number.isFinite(v) ? Math.min(600, Math.max(0, Math.floor(v))) : 10;
}

/** Usage alerts go out only with the master switch and their own switch both on. */
export const usageAlertsAllowed = (s: Record<string, unknown>, alertsOn: (s: Record<string, unknown>) => boolean): boolean => masterOn(s) && alertsOn(s);

export type TestResult = { shown: boolean; blocked: boolean } | { error: string };
export type Outcome = { kind: "shown" } | { kind: "failed"; text: string; openSettings: boolean };

/** Whether `platform` (navigator.platform) is one where Kolux can open the system's notification panel. */
export function hasSystemPanel(platform: string): boolean {
  return /^win/i.test(platform) || /mac|iphone|ipad/i.test(platform);
}

/** What the page says after a test: confirmed when the system showed it; otherwise why not, with
 * 'Open Settings' on Windows and macOS and "not supported" elsewhere. */
export function testOutcome(r: TestResult, platform: string): Outcome {
  if (!("error" in r) && r.shown) return { kind: "shown" };
  if (!hasSystemPanel(platform)) return { kind: "failed", text: "System notifications are not supported on this platform, so the test could not be shown.", openSettings: false };
  const why = "error" in r ? `The test notification could not be shown: ${r.error}` : r.blocked ? "Notifications are switched off for apps in your system settings, so nothing can be shown." : "The system did not show the test notification.";
  return { kind: "failed", text: `${why} Open Settings to allow notifications for Kolux.`, openSettings: true };
}
