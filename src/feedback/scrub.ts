// APP-037: paths and secrets are scrubbed from the feedback text before it goes into the new-issue
// address, because the report leaves for a public page. Masking is idempotent: the replacements
// ("[path]", "[masked]") match none of the rules. Line endings are never touched.
//
// ponytail: a path with a space in it is cut at the first space (the rest stays); relative paths
// (src/a.ts) are left, since they name nothing outside the project. Raise either only if a real
// report leaks one.

const MASK = "[masked]";
const PATH = "[path]";

/** Where a path may begin: the start, white space, a quote or bracket, `=`, `,` or `;`. */
const AT = String.raw`(^|[\s"'(\[<=,;])`;
const REST = String.raw`[^\s"'<>|*?]*`;
const PATHS = [
  new RegExp(`${AT}([A-Za-z]:[\\\\/]${REST})`, "g"), // C:\Users\me\x, C:/x
  new RegExp(`${AT}(\\\\\\\\[A-Za-z0-9_.$-]+\\\\${REST})`, "g"), // \\server\share\x
  new RegExp(`${AT}(~[\\\\/]${REST})`, "g"), // ~/x, ~\x
  new RegExp(`${AT}(/[\\w.~@%+-]+(?:/${REST})+)`, "g"), // /home/me/x: two parts at least, so /clear stays
];
const TRAILING = /[.,;:!?)\]}'"]+$/;

/** Secret shapes that are secrets wherever they appear. */
const SHAPES = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, // a JSON web token
];

const NAME = String.raw`[A-Za-z0-9_.-]*(?:password|passwd|passphrase|secret|token|api[_-]?key|apikey|private[_-]?key|access[_-]?key|credential|authorization)[A-Za-z0-9_.-]*|(?<![\w.-])(?:pwd|key)`;
/** `name: value`, `name=value`, `"name": "value"`: the value goes, the name stays. */
const PAIR = new RegExp(
  `(${NAME})(["']?\\s*[:=]\\s*)(?!(?:Bearer\\s+)?\\[masked\\])(?:(?:Bearer|Basic)\\s+)?("[^"\\r\\n]*"|'[^'\\r\\n]*'|[^\\s"',;}]+)`,
  "gi",
);
const BEARER = /\bBearer\s+(?!\[masked\])[A-Za-z0-9._~+/=-]{8,}/g;
const SAID = /\b(password|passcode|passphrase)(\s+(?:is|was)\s+)(?!\[masked\])\S+/gi; // "my password is ..."
const URL_LOGIN = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi; // https://user:password@host

function scrubPaths(text: string): string {
  let out = text;
  for (const re of PATHS) {
    out = out.replace(re, (_m, before: string, path: string) => {
      const tail = TRAILING.exec(path)?.[0] ?? "";
      return `${before}${PATH}${tail}`;
    });
  }
  return out;
}

export function scrub(text: string): string {
  let out = text.replace(URL_LOGIN, `$1${MASK}@`);
  for (const re of SHAPES) out = out.replace(re, MASK);
  out = out.replace(PAIR, `$1$2${MASK}`);
  out = out.replace(BEARER, `Bearer ${MASK}`);
  out = out.replace(SAID, `$1$2${MASK}`);
  return scrubPaths(out);
}
