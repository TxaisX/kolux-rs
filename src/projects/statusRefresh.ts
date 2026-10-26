// The Board announces a status or nest change as "kolux:workspace-status"; the sidebar refreshes at once
// instead of waiting for its 5 s poll. Returns the remover (call it on unmount).
export const WORKSPACE_STATUS = "kolux:workspace-status";

export function onWorkspaceStatus(target: EventTarget, refresh: () => void): () => void {
  target.addEventListener(WORKSPACE_STATUS, refresh);
  return () => target.removeEventListener(WORKSPACE_STATUS, refresh);
}
