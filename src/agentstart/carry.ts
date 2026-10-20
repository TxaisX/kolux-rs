// SESS-031 (carry a conversation to a different agent) and VIEW-087 (continue a past session with the
// same or another agent): the new session starts with the earlier conversation's trimmed transcript
// as its opening prompt, in the same workspace and folder. The transcript is read and trimmed on the
// Rust side (session_carry_context); this decides who may be started, where, and what is said.
import { findAvailable, NO_AGENT, startChecked, targetBlock, type Launch, type StartAgent, type StartResult } from "./rules";

/** The back end's trimmed copy of one session (automations/carry.rs). */
export type CarryContext = { agent: string; id: string; title: string; dir: string | null; turns: number; text: string; trimmed: boolean; omitted: number };

/** The session being continued, as the Agents tab lists it (the fields the flow reads). */
export type CarrySource = { agent: string; id: string; title?: string; dir?: string | null };

/** The opening prompt of the new session: who the conversation was with, where it ran, the trimmed
 *  transcript itself, and what to do with it. */
export function carryPrompt(ctx: CarryContext, sourceName: string, where: string): string {
  const head = `This task continues an earlier conversation with ${sourceName}${ctx.title ? ` ("${ctx.title}")` : ""}, which worked in ${where}.`;
  const note = ctx.trimmed ? " It is trimmed: long messages are cut and the middle may be left out, so check the repository for the current state." : "";
  return `${head} Below is what was said, without tool output.${note}\n\n--- earlier conversation ---\n${ctx.text}\n--- end of earlier conversation ---\n\nRead where it stopped, check the current state of the files, and carry on from there. Ask before redoing work that already looks finished.`;
}

export type CarryRun = {
  ctx: CarryContext;
  agents: StartAgent[];
  /** The agent chosen in the dialog. */
  targetId: string;
  /** The workspace in front: used when the session's own folder no longer exists. */
  workspace: string | null;
  ready: (dir: string) => Promise<void>;
  launch: Launch;
};

/** Starts the target agent with the carried conversation. An unavailable target launches nothing; the
 *  folder is the session's own when it is still there, else the workspace in front; a failed launch and a
 *  failed hand-over of the prompt are reported apart. */
export async function runCarry(o: CarryRun): Promise<StartResult> {
  const agent = findAvailable(o.agents, o.targetId);
  if (!agent) {
    const named = o.agents.find((a) => a.id === o.targetId)?.name ?? o.targetId;
    return { ok: false, stage: "agent", message: o.agents.length === 0 ? NO_AGENT : (targetBlock(o.agents, o.targetId, named) as string) };
  }
  const source = o.agents.find((a) => a.id === o.ctx.agent)?.name ?? o.ctx.agent;
  let dir: string | null = null;
  for (const d of [o.ctx.dir, o.workspace]) {
    if (!d) continue;
    try {
      await o.ready(d);
      dir = d;
      break;
    } catch {
      // try the next folder
    }
  }
  if (!dir) return { ok: false, stage: "folder", message: "The folder this conversation worked in is gone, and there is no workspace open to start in, so nothing was started." };
  return startChecked({ agent, dir, prompt: carryPrompt(o.ctx, source, o.ctx.dir ?? dir), what: "the earlier conversation", ready: o.ready, launch: o.launch });
}

/** What the dialog says about the choice. */
export const carryLine = (sourceName: string, same: boolean): string => (same ? `A new ${sourceName} session starts with the earlier conversation.` : `A new session starts in the chosen agent with the earlier ${sourceName} conversation.`);
