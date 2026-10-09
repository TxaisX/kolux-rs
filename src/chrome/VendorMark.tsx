// Model marks: a vendor's own public symbol stands for its agent (nominative use; Txais's call
// of 2026-10-08: vendor logos come only from public brand kits). Files live in src/assets/vendors
// with their source and terms in NOTICE.md. Codex has no kit file yet (openai.com/brand refuses
// every fetch), so it gets Kolux's neutral spark glyph until one is obtained. A plain shell keeps
// Kolux's neutral prompt glyph (TERM-020).
import claudeSpark from "../assets/vendors/anthropic-claude-spark.svg";
import { Shell, Spark } from "./icons";

export type Agent = "claude" | "codex" | "shell";

export default function VendorMark({ agent, size = 13 }: { agent: Agent; size?: number }) {
  if (agent === "shell") return <Shell size={size} />;
  if (agent === "codex") return <Spark size={size} role="img" aria-label="Codex" />;
  return <img src={claudeSpark} width={size} height={size} alt="Claude" draggable={false} />;
}
