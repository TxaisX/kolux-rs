// ONB-024: the setup card an Explore Kolux stop carries, as pure rules. tasks and PR view show
// GitHub, agent statuses shows a keep-the-computer-awake switch, ship shows the commit message
// writer. Left for T-321-c: usage (connected accounts) and the orchestration / browser skill command
// cards (their terminal belongs to T-244-b).
import { awakeMode, type AwakeMode } from "../launch/KeepAwakeCard";
import { hooksOn } from "../settings/AgentsPage";
import { WRITER_COMMAND_KEY, writerOf, type Writer } from "../scm/generate";

export type StopCard =
  | { kind: "provider"; connected: boolean | null; label: string }
  | { kind: "awake"; mode: AwakeMode; on: boolean; hooksOff: boolean }
  | { kind: "writer"; writer: Writer; hasCommand: boolean };

/** `taskSource` is null while GitHub has not been read; `settings` is null until the saved settings arrive. */
export type StopFacts = { taskSource: boolean | null; settings: Record<string, unknown> | null };

/** The card a stop carries, or null when it has none yet. The two settings cards wait for the saved
 *  settings, so a switch is never drawn from a guessed default and written back over what is saved. */
export function stopCard(stop: string, f: StopFacts): StopCard | null {
  if (stop === "tasks" || stop === "pr") return { kind: "provider", connected: f.taskSource, label: stop === "tasks" ? "Tasks come from GitHub" : "Pull requests come from GitHub" };
  if (!f.settings) return null;
  if (stop === "statuses") {
    const mode = awakeMode(f.settings);
    // Agent mode follows the agent status hooks; with them off it holds nothing (the Settings page says so too).
    return { kind: "awake", mode, on: mode !== "off", hooksOff: mode === "agent" && !hooksOn(f.settings) };
  }
  if (stop === "ship") {
    const command = f.settings[WRITER_COMMAND_KEY];
    return { kind: "writer", writer: writerOf(f.settings), hasCommand: typeof command === "string" && command.trim() !== "" };
  }
  return null;
}

/** The keep-awake switch: off turns on its automatic mode (Agent); either on mode can be switched off. */
export const awakeToggle = (mode: AwakeMode): AwakeMode => (mode === "off" ? "agent" : "off");

/** The mode the commit-writer switch writes when it is turned back on: the one it had before it went off
 *  (custom stays custom). With nothing remembered, a saved command means the user had picked custom. A
 *  custom writer needs its command, so with none it is Claude. */
export function writerBack(before: "claude" | "custom" | null, hasCommand: boolean): "claude" | "custom" {
  const want = before ?? (hasCommand ? "custom" : "claude");
  return want === "custom" && !hasCommand ? "claude" : want;
}
