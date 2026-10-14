// APP-023: the landing screen's notices for missing or signed-out tools, each dismissable, with a
// manual Check again that probes once more (results are otherwise kept from the first probe).
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentInfo } from "./PlusMenu";
import { dismissKey, toolNotices, type Notice, type Tools } from "./toolChecks";

type ViewProps = { notices: Notice[]; busy: boolean; onDismiss: (id: string) => void; onRefresh: () => void };

export function ToolNoticesView({ notices, busy, onDismiss, onRefresh }: ViewProps) {
  if (notices.length === 0) return null;
  return (
    <div className="tool-notices">
      {notices.map((n) => (
        <div key={n.id} className="notice signin-notice" role="status" data-notice={n.id}>
          <span>{n.text}</span>
          <button className="btn" disabled={busy} onClick={onRefresh}>
            {busy ? "Checking…" : "Check again"}
          </button>
          <button className="btn dismiss" onClick={() => onDismiss(n.id)}>
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}

/** `projects` is the registered project ids; a change reads the hosted projects again (probes stay cached). */
export default function ToolNotices({ projects }: { projects: string }) {
  const [tools, setTools] = useState<Tools | null>(null);
  const [agents, setAgents] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const check = useCallback((refresh: boolean) => {
    setBusy(true);
    Promise.all([
      invoke<Tools>("tools_check", { refresh }).then(setTools),
      invoke<AgentInfo[]>("agent_list").then((list) => setAgents(list.some((a) => a.installed))),
    ])
      .catch(() => {})
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => check(false), [check, projects]);
  if (!tools) return null;
  const dismiss = (id: string) => {
    const under = dismissKey(tools);
    setTools({ ...tools, dismissed: { ...tools.dismissed, [id]: under } });
    invoke("tools_dismiss", { id, under }).catch(() => {});
  };
  return <ToolNoticesView notices={toolNotices(tools, agents)} busy={busy} onDismiss={dismiss} onRefresh={() => check(true)} />;
}
