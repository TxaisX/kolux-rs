// APP-070: nothing about the user's work leaves this computer on the app's behalf. This is the whole
// list of connections the app itself makes; privacy.test.ts checks the source for any other network
// client. Feedback and crash reports open GitHub's new-issue page in the user's own browser: the app
// submits nothing (APP-037 adds the message box; this is the link).

export const OUTBOUND: ReadonlyArray<{ to: string; when: string }> = [
  { to: "GitHub Releases (TxaisX/kolux-rs-releases)", when: "checking for a newer version, downloading it and reading its release notes" },
  { to: "the git remotes and the GitHub account you set up", when: "fetch, pull, push and ship, through git on this computer" },
  { to: "the AI providers you connected", when: "each agent's own command-line tool talks to its company with your account; the app neither relays nor records that traffic" },
  { to: "the sites you open in the browser pane", when: "browsing, as in any browser, and fetching the site icon each open page names, which may be on another site such as a CDN; the app fetches it itself, sends no cookies, and never from this computer or your local network unless the page itself is open at such an address" },
  { to: "script CDNs (cdnjs, jsdelivr, unpkg, tailwindcss, jquery)", when: "saving an artifact for offline use, to fetch the scripts its page names" },
  { to: "Microsoft, from the WebView2 runtime", when: "the Edge engine that Windows lends the app's window keeps its own startup checks; they carry nothing of yours and the app neither uses nor can switch them off" },
];

/** GitHub's new-issue page of the project (APP-037 Compat). */
export const FEEDBACK_REPO = "https://github.com/TxaisX/kolux/issues/new";
/** Browsers and GitHub take addresses this long; a longer report is trimmed with a note. */
export const URL_CAP = 8000;

/** The pre-filled new-issue address: a [Feedback] title from the first line (80 characters at most),
 *  the text, then the version and platform. */
export function feedbackUrl(version: string, platform: string, text = ""): string {
  const clean = text.trim();
  const title = `[Feedback] ${clean.split("\n")[0]}`.trim().slice(0, 80);
  const url = (body: string) => `${FEEDBACK_REPO}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  const foot = `\n\n---\nKolux RS ${version} on ${platform}`;
  const whole = url(`${clean}${foot}`);
  if (whole.length <= URL_CAP) return whole;
  const note = "\n\n(trimmed to fit in a browser address)";
  let kept = clean;
  while (kept.length > 0 && url(`${kept}${note}${foot}`).length > URL_CAP) kept = kept.slice(0, Math.floor(kept.length * 0.8));
  return url(`${kept}${note}${foot}`);
}
