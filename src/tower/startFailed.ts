// FIX-5 (council d2 AFTER 4): the window starts hidden and is shown after the first draw. When the
// start fails (the App chunk did not load, a restore step threw) nothing would ever draw or show it:
// a hidden window with no message. This puts a plain message in the page and shows the window.

type Node_ = { setAttribute(k: string, v: string): void; textContent: string | null; append(...n: unknown[]): void };
type Page = { getElementById(id: string): Node_ | null; createElement(tag: string): Node_ };

/** The words under the heading: the error's own message when it has one, never a stack. */
export function startFailureText(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const one = raw.split(/\r?\n/)[0].trim().slice(0, 200);
  return one ? `Kolux RS could not start: ${one}. Close it and open it again.` : "Kolux RS could not start. Close it and open it again.";
}

/** Writes the message into the page's root and shows the window. Returns the message. */
export function showStartFailure(error: unknown, page: Page, show: () => Promise<unknown>): string {
  const text = startFailureText(error);
  const root = page.getElementById("root");
  if (root) {
    const p = page.createElement("p");
    p.setAttribute("role", "alert");
    p.setAttribute("style", "padding:24px;font:14px system-ui,sans-serif;color:inherit");
    p.textContent = text;
    root.textContent = "";
    root.append(p);
  }
  void show().catch(() => {});
  return text;
}
