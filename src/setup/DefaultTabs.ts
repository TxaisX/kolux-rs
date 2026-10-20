// PROJ-034 / COMPAT 5.6: kolux.yaml's `defaultTabs` open in every new workspace. Rust reads the file
// (limits, trimming, colours) and holds back the commands until the repository's "tabs" trust is
// given (SAFE-025); this side asks once, then hands back the tabs to open. It only reports what to
// open: opening the terminals belongs to the workspace-creation flow that calls it.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { askTrust, trusted, type TrustAnswer, type TrustAsk } from "./TrustPrompt";

/** One default tab; a field the file left out or that failed its limits is null. */
export type SharedTab = { title: string | null; color: string | null; command: string | null };
/** What `workspace_default_tabs` returns: while `ask` is set the commands are already left out. */
export type DefaultTabsOut = { tabs: SharedTab[]; ask: TrustAsk | null; refused: string | null };
type Invoke = <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;

/** The title a default tab shows when the file gave none. */
export const FALLBACK_TAB_TITLE = "Terminal";

/** The words a tab shows: its title, else its command's first word, else the fallback. */
export function tabTitle(t: SharedTab): string {
  return t.title ?? t.command?.trim().split(/\s+/)[0] ?? FALLBACK_TAB_TITLE;
}

/** The default tabs for the new workspace at `path` of the repository at `root`: asks for the
 *  tab commands' trust first when the shared file has any (once per text, or never when the whole
 *  kolux.yaml is trusted). A "Don't run" answer still opens the tabs, without their commands. A
 *  refused file (too big, aliases out of control) gives no tabs and says why. */
export async function defaultTabs(root: string, path: string, invoke: Invoke = tauriInvoke, ask: (a: TrustAsk) => Promise<TrustAnswer> = askTrust): Promise<{ tabs: SharedTab[]; refused: string | null }> {
  await trusted(path, "tabs", { root }, invoke, ask);
  const out = await invoke<DefaultTabsOut>("workspace_default_tabs", { root, path });
  return { tabs: out.tabs, refused: out.refused };
}
