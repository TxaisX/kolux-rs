// SKILL-009 / SKILL-010: the kit strip above the session grid, and the polling behind it.
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown } from "../chrome/icons";
import { KITS, VENDOR_NAME, type Vendor } from "./catalog";
import { KitIcon } from "./Kits";
import { moveTargets, roleDone, roleRow, type RoleRow, type RunCheck, type SeatInfo } from "./run";

export const POLL_MS = 10_000;

/** SKILL-009: the folder's kit run, looked at once when it shows, again on window focus, and every
 * ten seconds while a run exists, the strip is unfolded and the window is visible, and again
 * whenever `nudge` changes (a kit just started, or a waiting role was sent its prompt). */
export function useKitCheck(dir: string | null, folded: boolean, nudge = 0): [RunCheck | null, () => void] {
  const [check, setCheck] = useState<RunCheck | null>(null);
  const look = useCallback(() => {
    if (!dir) return setCheck(null);
    invoke<RunCheck | null>("kit_check", { dir }).then(setCheck, () => setCheck(null));
  }, [dir]);
  useEffect(() => {
    setCheck(null);
    look();
    window.addEventListener("focus", look);
    return () => window.removeEventListener("focus", look);
  }, [look]);
  useEffect(() => {
    if (nudge) look();
  }, [nudge, look]);
  const running = check !== null;
  useEffect(() => {
    if (!running || folded) return;
    look(); // unfolding looks at once
    const t = window.setInterval(() => document.visibilityState === "visible" && look(), POLL_MS);
    return () => window.clearInterval(t);
  }, [running, folded, look]);
  return [check, look];
}

type Props = {
  check: RunCheck;
  seats: (SeatInfo | null)[];
  sent: Record<string, number>;
  now: number;
  folded: boolean;
  onFold: (folded: boolean) => void;
  onOpen: () => void;
  onFocusSeat: (key: number) => void;
  /** SKILL-011: the connected AIs a stopped role can move to. */
  connected?: Vendor[];
  onCollect?: () => void;
  onPreview?: (role: number, file: string) => void;
  onOpenFile?: (role: number, file: string) => void;
  /** SKILL-011: start the role again in a new session on this AI. */
  onRestart?: (role: number, ai: string) => void;
};

export function kitRows(check: RunCheck, seats: (SeatInfo | null)[], sent: Record<string, number>, now: number): RoleRow[] {
  const kit = KITS.find((k) => k.id === check.record.kit);
  if (!kit) return [];
  return check.record.roles.map((r, i) => {
    const role = kit.roles.find((x) => x.id === r.id);
    return role ? roleRow(kit, role, check, seats[i] ?? null, sent[r.id] ?? null, now) : { state: "not-ready", text: "Not ready yet", key: null };
  });
}

const noop = () => {};

export default function KitStrip({ check, seats, sent, now, folded, onFold, onOpen, onFocusSeat, connected = [], onCollect = noop, onPreview = noop, onOpenFile = noop, onRestart = noop }: Props) {
  const kit = KITS.find((k) => k.id === check.record.kit);
  const roles = check.record.roles;
  const done = roles.filter((r) => roleDone(check, r.id)).length;
  const rows = kitRows(check, seats, sent, now);
  return (
    <section className="kit-strip" aria-label="Kit results">
      <div className="kit-strip-head">
        <span className="kit-icon">
          <KitIcon id={check.record.kit} size={16} />
        </span>
        <span className="kit-strip-title">{kit?.title ?? check.record.title}</span>
        <span className="kit-strip-count">
          {done} of {roles.length} done
        </span>
        <span className="kit-gap" />
        <button className="btn" onClick={onOpen}>
          Open results
        </button>
        <button className="btn" onClick={onCollect}>
          Collect results
        </button>
        <button className={folded ? "ib kit-fold folded" : "ib kit-fold"} title={folded ? "Show each role" : "Hide the roles"} aria-expanded={!folded} onClick={() => onFold(!folded)}>
          <ChevronDown />
        </button>
      </div>
      {!folded && (
        <ul className="kit-strip-rows">
          {roles.map((r, i) => {
            const row = rows[i];
            const role = kit?.roles.find((x) => x.id === r.id);
            const title = role?.title ?? r.id;
            const key = row?.key ?? null;
            // Buttons inside a row never count as a click on the row.
            const hold = (e: { stopPropagation: () => void }) => e.stopPropagation();
            const ai = seats[i]?.ai || r.ai || null;
            return (
              <li key={r.id} className={`kit-strip-row ${row?.state ?? ""}${key === null ? "" : " can"}`} {...(key === null ? {} : { role: "button", tabIndex: 0, onClick: () => onFocusSeat(key), onKeyDown: (e: { key: string }) => e.key === "Enter" && onFocusSeat(key) })}>
                <span className="kit-strip-role">{title}</span>
                <span className="kit-strip-state">{row?.text}</span>
                {row?.state === "done" && role && (
                  <span className="kit-strip-files" onClick={hold} onKeyDown={hold}>
                    {role.delivers.map((f) => (
                      <span key={f} className="kit-strip-file">
                        <span className="kit-strip-name">{f}</span>
                        <button className="btn small" aria-label={`Preview ${f}`} onClick={() => onPreview(i, f)}>
                          Preview
                        </button>
                        <button className="btn small" aria-label={`Open ${f}`} onClick={() => onOpenFile(i, f)}>
                          Open
                        </button>
                      </span>
                    ))}
                  </span>
                )}
                {row?.state === "stopped" && (
                  <span className="kit-strip-files" onClick={hold} onKeyDown={hold}>
                    {moveTargets(ai, connected).map((v) => (
                      <button key={v} className="btn small" onClick={() => onRestart(i, v)}>
                        {`Move to ${VENDOR_NAME[v]}`}
                      </button>
                    ))}
                    {ai && (
                      <button className="btn small" onClick={() => onRestart(i, ai)}>
                        Restart
                      </button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
