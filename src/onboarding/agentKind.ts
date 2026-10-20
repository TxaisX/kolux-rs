// FIX-5: the one rule for "this id is an AI agent, not a plain terminal". The guide's agent step and the
// first folder's agent start both ask it, so a spelling such as " Terminal " cannot be read two ways.

/** The id of a plain terminal in the launch lists: it is a shell, not an AI agent. */
export const TERMINAL_ID = "terminal";

/** True for an AI agent's id; false for blank, whitespace-only and the plain terminal in any case or padding. */
export const isAiAgent = (id: string | null | undefined): boolean => {
  const v = (id ?? "").trim().toLowerCase();
  return v !== "" && v !== TERMINAL_ID;
};
