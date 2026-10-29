// ONB-011 rest (T-298-b): the copied terminal diagnostics list when each first-run milestone happened, so a bug
// report shows how far a new profile had got. Only the times are added, as UTC dates; the milestone times are
// kept on this machine (onboarding.rs) and carry no names, paths or text.
import { invoke } from "@tauri-apps/api/core";
import type { Milestone } from "./firstRun";

const NAMES: [Milestone, string][] = [
  ["aiConnected", "AI connected"],
];

/** The record's milestone times in ms, or null when the profile has no first-run record (it had its firsts
 *  before the wizard existed, ONB-008). */
export type Milestones = Partial<Record<Milestone, unknown>> | null;

const when = (ms: unknown): string => (typeof ms === "number" && Number.isFinite(ms) && ms > 0 && new Date(ms).getFullYear() < 10000 ? new Date(ms).toISOString().replace(/\.\d+Z$/, "Z") : "not yet");

/** The block appended to the diagnostics text. */
export function milestoneBlock(m: Milestones): string {
  if (m === null) return "First milestones: no record on this profile";
  return ["First milestones", ...NAMES.map(([k, label]) => `  ${label}: ${when(m[k])}`)].join("\n");
}

/** The diagnostics text with the block after it. */
export const withBlock = (text: string, m: Milestones): string => `${text.replace(/\s+$/, "")}\n\n${milestoneBlock(m)}\n`;

/** Reads the record and appends the block; if the record cannot be read the text goes out unchanged (the report
 *  is still worth having). */
export async function withMilestones(text: string, read: () => Promise<{ firstRun: { milestones: Milestones } | null }> = () => invoke("guide_get")): Promise<string> {
  try {
    const g = await read();
    return withBlock(text, g.firstRun ? g.firstRun.milestones : null);
  } catch {
    return text;
  }
}
