// Model marks: a vendor's own public symbol stands for its agent (nominative use; Txais's call
// of 2026-10-08). Files live in src/assets/vendors with their source and terms in NOTICE.md.
// A plain shell keeps Kolux's neutral glyph (TERM-020).
import claudeSpark from "../assets/vendors/anthropic-claude-spark.svg";
import openaiKnot from "../assets/vendors/openai-knot.svg";
import { Shell } from "./icons";

export type Agent = "claude" | "codex" | "shell";

const marks: Record<Exclude<Agent, "shell">, { src: string; name: string }> = {
  claude: { src: claudeSpark, name: "Claude" },
  codex: { src: openaiKnot, name: "Codex" },
};

export default function VendorMark({ agent, size = 13 }: { agent: Agent; size?: number }) {
  if (agent === "shell") return <Shell size={size} />;
  const m = marks[agent];
  // The OpenAI knot is a line drawing that takes the text colour; the spark is Anthropic's clay.
  return agent === "codex" ? (
    <span style={{ display: "inline-flex", width: size, height: size, WebkitMaskImage: `url(${m.src})`, maskImage: `url(${m.src})`, WebkitMaskSize: "contain", maskSize: "contain", background: "currentColor" }} role="img" aria-label={m.name} />
  ) : (
    <img src={m.src} width={size} height={size} alt={m.name} draggable={false} />
  );
}
