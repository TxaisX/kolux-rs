// The 24 px status bar (DESIGN.md section 8): right-aligned "On" dot, the app's memory, the
// number of terminals and the agent count. Memory is asked of the Rust side every two seconds;
// clicking it opens the Resource Manager (APP-054).
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatMemory } from "../status/memory";
import ResourceManager from "../status/ResourceManager";
import { Chip, Cup, Plug } from "./icons";

type Props = { terminals: number; agents?: number; names?: () => Record<number, string>; workspaces?: string[] };

export default function StatusBar({ terminals, agents = 0, names = () => ({}), workspaces = [] }: Props) {
  const [memory, setMemory] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    const tick = () => invoke<number | null>("process_memory").then((b) => live && setMemory(b)).catch(() => {});
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return (
    <footer className="statusbar">
      <span className="item" title="Agent status hooks (not built yet)">
        <Cup size={12} />
        On
        <span className="on" />
      </span>
      <button className="item res-open" title="Memory this app holds right now. Click for every session's memory and CPU" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Chip size={12} />
        {formatMemory(memory)}
      </button>
      {open && <ResourceManager names={names} workspaces={workspaces} onClose={() => setOpen(false)} />}
      <span className="sep">·</span>
      <span className="item" title="Terminals running">
        <span style={{ font: "11px var(--mono-font)" }}>&gt;_</span>
        {terminals}
      </span>
      <span className="item" title="Agents running">
        <Plug size={12} />
        {agents}
      </span>
    </footer>
  );
}
