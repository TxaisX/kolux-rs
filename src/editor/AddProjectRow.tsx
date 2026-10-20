// VIEW-059 (T-224-b): with no workspace the Explorer has nothing to list, so it offers a row that
// adds a project (the project list's own handler, projectDrop.add, takes the chosen folder).
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { FolderPlus } from "../chrome/icons";
import { projectDrop } from "./desktopDrops";

export default function AddProjectRow() {
  const [err, setErr] = useState<string | null>(null);
  const pick = async () => {
    setErr(null);
    try {
      const picked = await open({ directory: true, multiple: true, title: "Choose project folders" });
      const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
      if (!paths.length) return;
      if (projectDrop.add) projectDrop.add(paths);
      else setErr("Show the project list first (the sidebar), then add the folder there.");
    } catch (e) {
      setErr(`The folder chooser did not open: ${String(e)}`);
    }
  };
  return (
    <div className="sb-hint add-project-row">
      <div>Open a workspace to browse its files.</div>
      <button className="menu-item" onClick={() => void pick()} title="Choose a folder to add as a project">
        <FolderPlus size={12} /> Add a project
      </button>
      {err && <div className="menu-hint" role="alert">{err}</div>}
    </div>
  );
}
