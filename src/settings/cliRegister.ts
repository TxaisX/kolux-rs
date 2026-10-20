// CLI-008 (T-250-c): what Settings > CLI says about the kolux command, as plain functions.

/** What the app's cli_register_state / cli_register / cli_unregister commands answer. */
export type Registration = {
  state: "registered" | "not-registered" | "unknown" | "conflict";
  command: string;
  place: string;
  note: string | null;
  canChange: boolean;
};

export type Os = "windows" | "mac" | "linux";

export function osOf(userAgent: string): Os {
  if (/windows/i.test(userAgent)) return "windows";
  if (/mac/i.test(userAgent)) return "mac";
  return "linux";
}

/** Where the command will be registered on this operating system, in words. */
export function whereText(os: Os, command: string): string {
  if (os === "windows") return `Kolux adds its command folder to your user PATH, so ${command} works in any new terminal.`;
  if (os === "mac") return `Kolux makes a link in /usr/local/bin so ${command} works in any new terminal. If that folder cannot be written, macOS asks for your administrator password.`;
  return `Kolux writes a small launcher named ${command} in ~/.local/bin (your programs folder). If that folder is not on your PATH, add it in your shell profile.`;
}

export type View = { headline: string; canRegister: boolean; canRemove: boolean; warn: boolean };

export function viewOf(r: Registration): View {
  switch (r.state) {
    case "registered":
      return { headline: `${r.command} is registered (${r.place}).`, canRegister: false, canRemove: r.canChange, warn: false };
    case "not-registered":
      return { headline: `${r.command} is not registered yet.`, canRegister: r.canChange, canRemove: false, warn: false };
    case "conflict":
      return { headline: `Something else is at ${r.place}.`, canRegister: false, canRemove: false, warn: true };
    default:
      return { headline: `Kolux cannot read where ${r.command} is registered, so it offers no change.`, canRegister: false, canRemove: false, warn: true };
  }
}

/** A failed change never reads as success: the message names what went wrong. */
export function failureText(what: "register" | "remove", err: unknown): string {
  return `Could not ${what} the command: ${String(err)}`;
}

/** The skill Kolux offers to install for agents after the command is registered. */
export const SKILL_NAME = "kolux-cli";
