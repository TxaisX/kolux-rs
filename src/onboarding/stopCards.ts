// ONB-024: the setup card an Explore Kolux stop carries, as pure rules. tasks and PR view show
// GitHub, agent statuses shows a keep-the-computer-awake switch, ship shows the commit message
// writer. Left for T-321-c: usage (connected accounts) and the orchestration / browser skill command
// cards (their terminal belongs to T-244-b).
import { awakeMode, type AwakeMode } from "../launch/KeepAwakeCard";
import { writerOf, type Writer } from "../scm/generate";

export type StopCard =
  | { kind: "provider"; connected: boolean; label: string }
  | { kind: "awake"; mode: AwakeMode; on: boolean }
  | { kind: "writer"; writer: Writer };

export type StopFacts = { taskSource: boolean; settings: Record<string, unknown> | null };

/** The card a stop carries, or null when it has none yet. */
export function stopCard(stop: string, f: StopFacts): StopCard | null {
  if (stop === "tasks" || stop === "pr") return { kind: "provider", connected: f.taskSource, label: stop === "tasks" ? "Tasks come from GitHub" : "Pull requests come from GitHub" };
  if (stop === "statuses") {
    const mode = awakeMode(f.settings);
    return { kind: "awake", mode, on: mode !== "off" };
  }
  if (stop === "ship") return { kind: "writer", writer: writerOf(f.settings ?? {}) };
  return null;
}

/** The keep-awake switch: off turns on its automatic mode (Agent); either on mode can be switched off. */
export const awakeToggle = (mode: AwakeMode): AwakeMode => (mode === "off" ? "agent" : "off");
