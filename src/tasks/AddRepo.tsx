// T-314-d (GIT-056): a Projects row whose repository is not open in Kolux offers to add it. The copy
// runs through the same clone dialog and backend as Add project (the dialog opens straight on its
// "copy from a web address" step with the repository's address filled in), so progress, the one-line
// failure reason and Cancel behave exactly as there.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AddProjectView, type Api } from "../projects/AddProject";
import type { Project } from "../projects/model";

const refused = () => Promise.reject("Only copying a repository is offered here");

const API: Api = {
  suggest: (url) => invoke("clone_suggest", { url }),
  clone: (url, dest, ticket) => invoke("project_clone", { url, dest, ticket }),
  cancel: (ticket) => invoke("clone_cancel", { ticket }),
  defaults: refused,
  create: refused,
  progress: (onLine) => {
    const off = listen<{ ticket: string; line: string }>("clone-progress", (e) => onLine(e.payload.ticket, e.payload.line));
    return () => void off.then((stop) => stop());
  },
};

export default function AddRepo({ url, onClose, onAdded }: { url: string; onClose: () => void; onAdded: (p: Project) => void }) {
  // Back from the copy step closes the dialog: there is no other step to go back to here.
  return <AddProjectView step="clone" onStep={onClose} onBrowse={onClose} onClose={onClose} api={API} onAdded={onAdded} start={{ url }} />;
}
