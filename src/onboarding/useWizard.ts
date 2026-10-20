// T-543: the first-run wizard's state and ways out, moved out of App.tsx as they were and called
// where they used to sit.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { firstFolderAgent, kitLaunch, oneClick, openAt, REOPEN_WIZARD, reopenWizard, wizardCloser, type Outcome } from "./firstRun";
import { projectAddedNote } from "./sidebar";
import { KITS, assignRoles, type Kit, type Vendor } from "../kits/catalog";
import { startValues } from "../kits/Kits";
import { startGridTour } from "./tour";
import { starAfterClose } from "./star";
import type { AgentInfo } from "../launch/PlusMenu";
import { defaultAgentId, menuAgents, offeredAgents } from "../launch/agents";

type WizardDeps = {
  setToast: (text: string) => void;
  agents: AgentInfo[];
  settings: Record<string, unknown>;
  activeDir: string | null;
  kitAIs: Vendor[];
  startIn: (agent: AgentInfo, dir: string, branch: string | null, prompt: string, show: boolean, extra?: string[], title?: string) => Promise<number | null>;
  startKit: (kit: Kit, values: Record<string, string>, assigned: (Vendor | null)[], dir: string) => Promise<boolean>;
  setKitConflict: (v: string | null) => void;
  setKits: (v: { kit: string | null; sampleDir: string | null } | null) => void;
};

export function useWizard({ setToast, agents, settings, activeDir, kitAIs, startIn, startKit, setKitConflict, setKits }: WizardDeps) {
  // ONB-001..005: the first-run wizard floats over the app while its record says it is open.
  const [wizard, setWizard] = useState<number | null>(null);
  const wizardSetup = useRef(false);
  useEffect(() => {
    invoke<{ step: number } | null>("onboarding_get").then((r) => setWizard(openAt(r)), () => {});
  }, []);
  // ONB-007: the close is stored before the wizard goes; a failed store keeps it open with a toast,
  // and the next click on any of its ways out tries that same close again. VIEW-114: a stored close
  // also tells the sidebar slot (FIX-2).
  const [wizardClose] = useState(() =>
    wizardCloser(
      // ONB-007 / ONB-037 (T-208-c): a stored completed close asks the star prompt for its onboarding-finished toast.
      (outcome) => invoke("onboarding_close", { outcome }).then((r) => (starAfterClose(outcome), r)),
      () => {
        setWizard(null);
        wizardSetup.current = false;
      },
      (err) => setToast(`Kolux could not keep your setup progress (${String(err)}). Click the same button again to try once more.`),
    ),
  );
  const endWizard = (outcome: Outcome, after?: () => void) => wizardClose.end(outcome, after);
  // ONB-009: Onboarding in the sidebar help menu starts the wizard over on screen one.
  useEffect(() => {
    const counts = oneClick();
    const reopen = () => {
      if (!counts()) return;
      void reopenWizard(
        () => invoke("onboarding_reopen"),
        () => setWizard(0),
        (err) => setToast(`Kolux could not reopen onboarding (${String(err)}).`),
      );
    };
    window.addEventListener(REOPEN_WIZARD, reopen);
    return () => window.removeEventListener(REOPEN_WIZARD, reopen);
  }, []);
  // ONB-010: armed by Pick a folder, or by Skip while no project exists; the next project added
  // starts the saved default agent in it, once.
  const firstFolder = useRef(false);
  // VIEW-114 (FIX-2): every added project tells the sidebar entry to read its steps again.
  const projectAdded = (dir: string, branch: string | null) => {
    projectAddedNote();
    if (!firstFolder.current) return;
    firstFolder.current = false;
    const agent = firstFolderAgent(offeredAgents(agents, settings), defaultAgentId(settings));
    if (agent) void startIn(agent, dir, branch, "", true);
  };
  // ONB-005: Start kit launches at once in the kit's own sample folder with an AI ready; otherwise
  // the setup dialog opens, the wizard hides behind it, and a start from there completes it.
  const wizardKit = async (id: string) => {
    if (wizardClose.retry()) return;
    const kit = KITS.find((k) => k.id === id);
    if (!kit) return;
    const sampleDir = await invoke<string>("kit_samples_dir", { kit: id }).catch(() => null);
    if (activeDir && kitLaunch(activeDir, sampleDir, kitAIs) === "launch") {
      if (await startKit(kit, startValues(kit, activeDir, sampleDir, settings), assignRoles(kit, kitAIs), activeDir)) return endWizard("completed", startGridTour);
    } else setKitConflict(null);
    wizardSetup.current = true;
    setKits({ kit: id, sampleDir });
  };
  // ONB-005: one plain session on the first available agent (the default first), empty prompt;
  // nothing without an agent and a workspace.
  const wizardSession = async () => {
    if (wizardClose.retry()) return;
    const agent = menuAgents(offeredAgents(agents, settings), defaultAgentId(settings))[0];
    if (!agent || !activeDir) return;
    if ((await startIn(agent, activeDir, null, "", true)) !== null) endWizard("completed", startGridTour);
  };
  return { wizard, setWizard, wizardSetup, wizardClose, endWizard, firstFolder, projectAdded, wizardKit, wizardSession };
}
