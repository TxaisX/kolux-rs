// SKILL-017: closing the Skills page goes back to whichever view was open before it. The view it
// came from is kept here, so the window's own state stays as it is.
import type { Screen } from "../chrome/TopBar";

let from: Screen = "terminals";

/** The sidebar button: opens the page, or closes it when it is already up. */
export function toggleSkills(screen: Screen, setScreen: (s: Screen) => void) {
  if (screen === "skills") setScreen(from);
  else {
    from = screen;
    setScreen("skills");
  }
}

export const closeSkills = (setScreen: (s: Screen) => void) => setScreen(from);
