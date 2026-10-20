// T-158 (BROW-036): what a grabbed or annotated element hands to the AI is scrubbed first. Only a
// chosen safe set of attributes plus the accessibility ones is kept, a fixed set of 16 computed
// style properties, secret-looking values are masked (precisely, so everyday words are never
// touched), addresses lose their query and fragment, unsafe link schemes are removed, and a
// capture whose structure is broken is thrown away.
import type { Pick } from "./annotate";

export const MASK = "[masked]";

/** The attributes kept besides aria-* (coordinator default: the usual test hooks are kept). */
export const SAFE_ATTRS = new Set([
  "role", "name", "type", "href", "src", "alt", "title", "placeholder", "class", "id", "for", "lang", "dir",
  "data-testid", "data-test", "data-cy", "data-component",
]);

/** The fixed 16 computed style properties. */
export const STYLE_PROPS = [
  "color", "background-color", "font-size", "font-family", "font-weight", "line-height", "padding", "margin",
  "border", "border-radius", "display", "position", "width", "height", "opacity", "z-index",
] as const;

const URL_ATTRS = new Set(["href", "src"]);

/** Known secret shapes, plus a long mixed-class run (letters of both cases and digits). */
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g,
  /\b[0-9a-f]{40,}\b/gi,
];
const LONG_RUN = /[A-Za-z0-9_+/=-]{32,}/g;

function mixedRun(s: string): boolean {
  return /[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s);
}

/** The text with every secret-looking value replaced by the mask marker. */
export function maskSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, MASK);
  return out.replace(LONG_RUN, (m) => (mixedRun(m) ? MASK : m));
}

/** An address without query or fragment; `null` for an unsafe scheme (javascript:, data:, file: and the like). */
export function cleanUrl(raw: string): string | null {
  const v = raw.trim();
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(v)?.[1]?.toLowerCase();
  if (scheme && !["http", "https", "mailto", "tel"].includes(scheme)) return null;
  const bare = v.replace(/[?#].*$/, "");
  return maskSecrets(bare);
}

function isRecordOfStrings(v: unknown): v is Record<string, string> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");
}

function optString(v: unknown): boolean {
  return v === undefined || typeof v === "string";
}

/** The capture made safe to hand to the AI, or `null` when its structure is broken. */
export function scrubPick(raw: unknown): Pick | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.selector !== "string" || !p.selector.trim()) return null;
  for (const k of ["path", "tag", "text", "component", "source", "url"]) if (!optString(p[k])) return null;
  if (p.hints !== undefined && !isRecordOfStrings(p.hints)) return null;
  if (p.styles !== undefined && !isRecordOfStrings(p.styles)) return null;
  let box: Pick["box"];
  if (p.box !== undefined) {
    const b = p.box as Record<string, unknown>;
    if (typeof b !== "object" || b === null) return null;
    const nums = ["x", "y", "width", "height"].map((k) => b[k]);
    if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    box = { x: nums[0] as number, y: nums[1] as number, width: nums[2] as number, height: nums[3] as number };
  }
  const out: Pick = { selector: maskSecrets(p.selector) };
  if (p.path !== undefined) out.path = maskSecrets(p.path as string);
  if (p.tag !== undefined) out.tag = p.tag as string;
  if (p.text !== undefined) out.text = maskSecrets(p.text as string);
  if (p.component !== undefined) out.component = maskSecrets(p.component as string);
  if (p.source !== undefined) out.source = maskSecrets((p.source as string).replace(/[?#].*$/, ""));
  if (p.url !== undefined) {
    const u = cleanUrl(p.url as string);
    if (u !== null) out.url = u;
  }
  if (p.hints !== undefined) {
    const hints: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.hints as Record<string, string>)) {
      const name = k.toLowerCase();
      if (!SAFE_ATTRS.has(name) && !name.startsWith("aria-")) continue;
      if (URL_ATTRS.has(name)) {
        const u = cleanUrl(v);
        if (u !== null) hints[name] = u;
      } else hints[name] = maskSecrets(v);
    }
    out.hints = hints;
  }
  if (p.styles !== undefined) {
    const styles: Record<string, string> = {};
    const given = p.styles as Record<string, string>;
    for (const k of STYLE_PROPS) if (given[k] !== undefined) styles[k] = given[k];
    out.styles = styles;
  }
  if (box) out.box = box;
  return out;
}
