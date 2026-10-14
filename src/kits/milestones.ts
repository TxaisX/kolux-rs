// SKILL-016: kits tick off the newcomer checklist's first-run milestones (onboarding keeps each one
// the first time only, ONB-011) and give a contextual tour an anchor on the kit results strip.
import { milestone, type Milestone } from "../onboarding/firstRun";

/** The kit results strip carries this anchor; a tour step targets it with KIT_RESULTS_TARGET. */
export const TOUR_ANCHOR = "kit-results";
export const KIT_RESULTS_TARGET = `[data-tour-anchor="${TOUR_ANCHOR}"]`;

type Record = (name: Milestone) => Promise<void>;

/** A launch counts once at least one of the kit's AIs started; a kit where none started is no launch. */
export const noteKitLaunch = (started: number, record: Record = milestone): Promise<void> => (started > 0 ? record("kitLaunched") : Promise.resolve());

/** Open results or Collect results: the first-results milestone. */
export const noteResults = (record: Record = milestone): Promise<void> => record("resultsOpened");

/** Open results: does what the strip's owner asked, then records the milestone. */
export const openResults =
  (onOpen: () => void, record: Record = milestone) =>
  () => {
    onOpen();
    void noteResults(record);
  };
