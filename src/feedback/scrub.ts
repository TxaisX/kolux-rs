// APP-037: paths and secrets are scrubbed from the feedback text before it goes into the new-issue
// address, because the report leaves for a public page. Masking is idempotent: the replacements
// ("[path]", "[masked]") match none of the rules. Line endings are never touched.
//
// ponytail: a path with a space in it is cut at the first space (the rest stays), except under a user
// profile folder (C:\Users\<name>, /home/<name>, /Users/<name>, \Users\<name>), whose name may hold a
// space: that one masks the rest of the line, or up to the quote or backtick that closes it (FIX-1,
// council review of 9b6e5841). Relative paths (src/a.ts) are left, since they name nothing outside the
// project. Raise either only if a real report leaks one.

const MASK = "[masked]";
const PATH = "[path]";

/** Where a path may begin: the start, white space, a quote, backtick or bracket, `=`, `,`, `;` or `:`. */
const AT = "(^|[\\s\"'`(\\[<{=,;:])";
const REST = "[^\\s\"'`<>|*?]*";
/** The front of a user profile path: the name that follows may hold spaces, so the rest is masked whole. */
const PROFILE = "(?:[A-Za-z]:[\\\\/]+Users[\\\\/]+|\\\\Users[\\\\/]+|/(?:home|Users)/+)";
/** A profile path inside a quote or backtick: masked up to the matching mark (an apostrophe inside a word, O'Brien, does not close it). */
const QUOTED_PROFILE = new RegExp(`(["'\`])(${PROFILE}[^\\r\\n]*?)(?=\\1(?!\\w))`, "g");
const PROFILE_LINE = new RegExp(`${AT}(${PROFILE}[^\\s][^\\r\\n]*)`, "g");
/** `file:///C:/x` and `file:///home/x`: the address start goes, the path is then found as any other. */
const FILE_URL = /\bfile:\/\/(?:\/(?=[A-Za-z]:[\\/])|(?=\/[\w.~@%+-]+\/))/gi;
const PATHS = [
  new RegExp(`${AT}([A-Za-z]:[\\\\/]${REST})`, "g"), // C:\Users\me\x, C:/x
  new RegExp(`${AT}(\\\\\\\\[A-Za-z0-9_.$-]+\\\\${REST})`, "g"), // \\server\share\x
  new RegExp(`${AT}(~[\\\\/]${REST})`, "g"), // ~/x, ~\x
  new RegExp(`${AT}(/[\\w.~@%+-]+(?:/${REST})+)`, "g"), // /home/me/x: two parts at least, so /clear stays
];
const TRAILING = /[.,;:!?)\]}'"`]+$/;

/** Secret shapes that are secrets wherever they appear. */
const SHAPES = [
  /-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?(?:-----END \1-----|$)/g, // a PEM block, key or certificate; one cut off before its END goes to the end of the text
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/g, // Stripe secret and restricted keys
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g, // GitLab
  /\bnpm_[A-Za-z0-9]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, // a JSON web token
];

const NAME = String.raw`[A-Za-z0-9_.-]*(?:password|passwd|passphrase|secret|token|api[_-]?key|apikey|private[_-]?key|access[_-]?key|credential|authorization)[A-Za-z0-9_.-]*|(?<![\w.-])(?:pwd|key|pass)`;
/** `name: value`, `name=value`, `"name": "value"`: the value goes, the name stays. */
const PAIR = new RegExp(
  `(${NAME})(["']?\\s*[:=]\\s*)(?!(?:Bearer\\s+)?\\[masked\\])(?:(?:Bearer|Basic)\\s+)?("[^"\\r\\n]*"|'[^'\\r\\n]*'|[^\\s"',;}]+)`,
  "gi",
);
/** `--password hunter2`, `--auth-token abc`: a flag named like a secret takes the next word. */
const FLAG = /(--(?:[a-z0-9]+-)*(?:password|passwd|passphrase|secret|token|api-?key)[ \t]+)(?!\[masked\]|-)("[^"\r\n]*"|'[^'\r\n]*'|\S+)/gi;
const BEARER = /\bBearer\s+(?!\[masked\])[A-Za-z0-9._~+/=-]{8,}/g;
const SAID = /\b(password|passcode|passphrase)(\s+(?:is|was)\s+)(?!\[masked\])\S+/gi; // "my password is ..."
const URL_LOGIN = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi; // https://user:password@host

function scrubPaths(text: string): string {
  let out = text.replace(FILE_URL, "");
  out = out.replace(QUOTED_PROFILE, `$1${PATH}`);
  out = out.replace(PROFILE_LINE, (_m, before: string) => `${before}${PATH}`);
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
  out = out.replace(FLAG, `$1${MASK}`);
  out = out.replace(BEARER, `Bearer ${MASK}`);
  out = out.replace(SAID, `$1$2${MASK}`);
  return scrubPaths(out);
}
