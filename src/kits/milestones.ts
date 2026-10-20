// SKILL-016: kits tick off the newcomer checklist's first-run milestones (onboarding keeps each one
// the first time only, ONB-011) and give a contextual tour an anchor on the kit results strip.
import { milestone, type Milestone } from "../onboarding/firstRun";
import { ranOnOwnFile } from "../onboarding/newcomer";
import { underDir } from "../workspaces";
import type { Kit } from "./catalog";

/** The kit results strip carries this anchor; a tour step targets it with KIT_RESULTS_TARGET. */
export const TOUR_ANCHOR = "kit-results";
export const KIT_RESULTS_TARGET = `[data-tour-anchor="${TOUR_ANCHOR}"]`;

// The recorder may report whether the record was kept (firstRun.milestone gives a boolean); kits ignore it.
type Recorder = (name: Milestone) => Promise<unknown>;

/** A launch counts once at least one of the kit's AIs started; a kit where none started is no launch. */
export const noteKitLaunch = (started: number, record: Recorder = milestone): Promise<void> => (started > 0 ? record("kitLaunched").then(() => undefined) : Promise.resolve());

/** Open results or Collect results: the first-results milestone. */
export const noteResults = (record: Recorder = milestone): Promise<void> => record("resultsOpened").then(() => undefined);

/** Open results: does what the strip's owner asked, then records the milestone. */
export const openResults =
  (onOpen: () => void, record: Recorder = milestone) =>
  () => {
    onOpen();
    void noteResults(record);
  };

/** ONB-013: did the user pick a file of their own? A file field filled with something outside the kit's
 * samples folder says so; a text answer, an empty field or an unknown samples folder never does. */
export const usesOwnFile = (kit: Kit, values: Record<string, string>, sampleDir: string | null): boolean =>
  sampleDir !== null && kit.inputs.some((i) => i.kind === "file" && (values[i.id] ?? "").trim() !== "" && !underDir(values[i.id].trim(), sampleDir));

/** ONB-013: once a kit has really started (`launched` settles true) on a file the user picked, mark the
 * checklist's own-file item. A launch that did not start, an unknown outcome or a failed one marks nothing. */
export const noteOwnFile = async (kit: Kit, values: Record<string, string>, sampleDir: string | null, launched: Promise<boolean | void> | void, mark: () => Promise<void> = ranOnOwnFile): Promise<void> => {
  if (!usesOwnFile(kit, values, sampleDir)) return;
  const started = await Promise.resolve(launched).catch(() => false);
  if (started === true) await mark();
};
