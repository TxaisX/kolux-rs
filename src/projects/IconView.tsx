// PROJ-019: draws a project's icon (see projectIcon.ts): an emoji, one of Kolux's own line glyphs,
// a small picture, or the automatic icon (the first letter of the name).
import type { ReactElement } from "react";
import { Bell, Book, Box, Chip, Clock, Cup, Globe, Megaphone, Merge, Moon, Pin, Plug, Pulse, Rocket, Shell, Spark, Table, Target } from "../chrome/icons";
import { iconView, type AutoIcon } from "./projectIcon";

const Folder = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1.75 4.5v7.75h12.5V5.75H7.5L6.25 4.25h-4.5Z" />
  </svg>
);

const GLYPHS: Record<string, (p: { size?: number }) => ReactElement> = { folder: Folder, rocket: Rocket, box: Box, globe: Globe, chip: Chip, book: Book, pulse: Pulse, megaphone: Megaphone, cup: Cup, moon: Moon, clock: Clock, table: Table, plug: Plug, spark: Spark, target: Target, merge: Merge, shell: Shell, pin: Pin, bell: Bell };

export function ProjectIcon({ value, name, size = 14, auto }: { value: string | undefined; name: string; size?: number; auto?: AutoIcon | null }) {
  const v = iconView(value, name, auto);
  const box = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: size + 2, height: size + 2, marginRight: 6, flex: "none", fontSize: size - 1, lineHeight: 1 } as const;
  if (v.kind === "emoji") return <span style={box} data-project-icon="emoji" aria-hidden="true">{v.emoji}</span>;
  // no-referrer: an avatar request must not tell the hosting site which page asked (as MentionField does)
  if (v.kind === "image") return <img src={v.src} alt="" width={size + 2} height={size + 2} referrerPolicy="no-referrer" style={{ ...box, objectFit: "contain", borderRadius: 3 }} data-project-icon="image" />;
  if (v.kind === "icon") {
    const Glyph = GLYPHS[v.name] ?? Folder;
    return <span style={box} data-project-icon={GLYPHS[v.name] ? v.name : "folder"} aria-hidden="true"><Glyph size={size} /></span>;
  }
  return <span style={{ ...box, borderRadius: 3, background: "var(--bg-hover, rgba(127,127,127,.2))", fontSize: size - 3, fontWeight: 600 }} data-project-icon="auto" aria-hidden="true">{v.letter}</span>;
}

export { GLYPHS as BUILT_IN_GLYPHS };
