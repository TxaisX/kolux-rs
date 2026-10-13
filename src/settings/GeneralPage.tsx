// Settings > General: the Classic or New look and the screen that opens first (SET-037).
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import type { AppInfo } from "../app-info";
import { screens } from "../chrome/TopBar";
import { useSettings } from "./useSettings";
import { FIRST_FIELD, LOOK_FIELD, readLook, savedFirst, type Look } from "./general";
import { feedbackUrl, OUTBOUND } from "./privacy";

/** A row of buttons that behaves as one radio group. */
export function Segmented<T extends string>({ label, options, value, onPick, off = [] }: { label: string; options: Array<{ id: T; label: string }>; value: T; onPick: (v: T) => void; off?: T[] }) {
  return (
    <div className="seg-row" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} disabled={off.includes(o.id)} onClick={() => onPick(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function GeneralView({ settings, onSave }: { settings: Record<string, unknown>; onSave: (patch: Record<string, unknown>) => void }) {
  const look = readLook(settings);
  const classic = look === "classic";
  return (
    <section className="conn-card" data-section="views">
      <h2 className="conn-name">Look and first screen</h2>
      <div className="look-select">
        <span>Look</span>
        <Segmented<Look> label="Look" options={[{ id: "classic", label: "Classic" }, { id: "new", label: "New" }]} value={look} onPick={(v) => onSave({ [LOOK_FIELD]: v })} />
      </div>
      <p className="conn-detail">New shows the redesigned screens with Agents, Board and Terminals in the top bar; Classic keeps the earlier layout.</p>
      <div className="look-select">
        <span>Opens first</span>
        <Segmented label="Opens first" options={screens} value={classic ? "terminals" : savedFirst(settings)} off={classic ? ["agents", "board"] : []} onPick={(v) => onSave({ [FIRST_FIELD]: v })} />
      </div>
      {classic && <p className="conn-detail">Switch the look to New to open on Agents or Board.</p>}
    </section>
  );
}

/** APP-041: the app's own log, copied or reviewed by the user; nothing leaves the computer by itself. */
export function DiagnosticsCard() {
  const [note, setNote] = useState("");
  const run = (label: string, job: () => Promise<string>) => void job().then(setNote).catch((e: unknown) => setNote(`${label} failed: ${String(e)}`));
  const copy = async () => {
    const text = await invoke<string>("diag_bundle");
    await invoke("clip_write", { text }).catch(() => navigator.clipboard.writeText(text));
    return "Copied to the clipboard with keys, passwords and tokens masked.";
  };
  return (
    <section className="conn-card" data-section="diagnostics">
      <h2 className="conn-name">Diagnostics</h2>
      <p className="conn-detail">
        Kolux keeps a short log of its own starts, exits and terminal sessions in your profile folder, readable only by you. Nothing is sent anywhere: copy it yourself when you report a problem. Keys, passwords and tokens are masked before the text leaves the folder.
      </p>
      <div className="btn-row">
        <button className="btn" onClick={() => run("Copy", copy)}>
          Copy diagnostics
        </button>
        <button className="btn" onClick={() => run("Review copy", async () => `Review copy opened: ${await invoke<string>("diag_review")}`)}>
          Write a review copy and open it
        </button>
        <button className="btn" onClick={() => run("Throw away", async () => invoke("diag_review_discard").then(() => "Review copy thrown away."))}>
          Throw the review copy away
        </button>
      </div>
      {note && <p className="conn-detail">{note}</p>}
    </section>
  );
}

/** APP-070: what leaves this computer (the whole list), and the feedback link that opens in the browser instead. */
export function PrivacyCard() {
  const [note, setNote] = useState("");
  const send = () =>
    void invoke<AppInfo>("app_info")
      .then((i) => invoke("open_external", { url: feedbackUrl(i.version, navigator.platform) }))
      .then(() => setNote("A new-issue page opened in your browser; the app sent nothing. Read it over there, then submit it or close it."))
      .catch((e: unknown) => setNote(`Could not open the browser: ${String(e)}`));
  return (
    <section className="conn-card" data-section="privacy">
      <h2 className="conn-name">Privacy</h2>
      <p className="conn-detail">
        Your work stays on this computer. What you type, the files you open, terminal output, projects, settings and saved keys live only in your profile folder. The app sends no usage data and has no server to send it to. The app itself connects only to:
      </p>
      <ul className="conn-detail conn-list">
        {OUTBOUND.map((o) => (
          <li key={o.to}>
            <b>{o.to}</b>: {o.when}.
          </li>
        ))}
      </ul>
      <div className="btn-row">
        <button className="btn" onClick={send}>
          Send feedback
        </button>
      </div>
      {note && <p className="conn-detail">{note}</p>}
    </section>
  );
}

export default function GeneralPage() {
  const { settings, error, save } = useSettings();
  return (
    <>
      {error && <p className="conn-detail warn">{error}</p>}
      {settings && <GeneralView settings={settings} onSave={save} />}
      <DiagnosticsCard />
      <PrivacyCard />
    </>
  );
}
