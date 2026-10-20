// AUTO-010 / onboarding: whether a repository has a setup script. A question for the page's own read
// (repo_setup_get), never for the runner: the runner asks the trust question and refuses a joined
// script it cannot run, and a probe that errors there would read as "no setup" or fail closed.
import { invoke } from "@tauri-apps/api/core";
import { hasSetup, type RepoSetup } from "./setupChoice";

/** True when the repository at `path` has a setup script that its choice would run. A read that fails
 *  is `onError`: true for a picker (the option is there to be chosen), false for a count. */
export async function probeSetup(path: string, onError: boolean): Promise<boolean> {
  try {
    return hasSetup(await invoke<RepoSetup>("repo_setup_get", { path }));
  } catch {
    return onError;
  }
}
