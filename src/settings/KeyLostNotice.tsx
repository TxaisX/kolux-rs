// ACCT-010: a key the system's key store can no longer open (a new Windows profile, a restored
// backup) was cleared at startup; this note in the main window says which one and where to
// reconnect it. It stays until dismissed or until that key is stored again.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openSettings } from "./pages";

const LABELS: Record<string, string> = { claudeOauthToken: "Claude 1-year key", xaiApiKey: "xAI key" };

/** The note's sentence for the cleared settings fields; null when there are none. */
export function lostText(names: string[]): string | null {
  if (names.length === 0) return null;
  const known = names.map((n) => LABELS[n]).filter(Boolean);
  const many = names.length > 1;
  const subject = known.length > 0 ? `Your ${known.join(" and ")}` : many ? "Some stored keys" : "A stored key";
  return `${subject} could not be opened on this computer, so ${many ? "they were" : "it was"} cleared. Reconnect ${many ? "them" : "it"} in Settings › Accounts & keys.`;
}

export function KeyLostView({ names, onOpen, onDismiss }: { names: string[]; onOpen: () => void; onDismiss: () => void }) {
  const text = lostText(names);
  if (!text) return null;
  return (
    <div className="notice signin-notice key-lost" role="status">
      <span>{text}</span>
      <button className="btn" onClick={onOpen}>
        Open Accounts &amp; keys
      </button>
      <button className="btn" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

export default function KeyLostNotice() {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    const read = () => void invoke<string[]>("secrets_dropped").then(setNames).catch(() => {});
    read();
    // Connecting a key again clears its name; the Claude key card and settings saves say so.
    const offs = [listen("claude-key", read), listen("settings-saved", read)];
    return () => offs.forEach((o) => void o.then((u) => u()).catch(() => {}));
  }, []);
  const dismiss = () => {
    setNames([]);
    invoke("secrets_dropped_dismiss").catch(() => {});
  };
  return <KeyLostView names={names} onOpen={() => openSettings("accounts")} onDismiss={dismiss} />;
}
