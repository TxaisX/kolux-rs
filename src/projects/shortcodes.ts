// PROJ-061 (T-303): typing a colon and a word in a text field (rename, the details, the palette)
// offers emoji; Enter takes one, Escape closes the list and the typed text stays. Flags are found
// by country name or ISO code. No skin-tone variants are in the table, so none are offered.

export type Shortcode = { code: string; emoji: string; words: string[] };

const plain: [string, string, string?][] = [
  ["fire", "\u{1F525}", "hot lit"],
  ["rocket", "\u{1F680}", "launch ship"],
  ["sparkles", "✨", "new shiny"],
  ["star", "⭐"],
  ["bug", "\u{1F41B}"],
  ["check", "✅", "done yes tick"],
  ["x", "❌", "no cross"],
  ["warning", "⚠️", "caution"],
  ["eyes", "\u{1F440}", "look"],
  ["thinking", "\u{1F914}", "hmm"],
  ["tada", "\u{1F389}", "party celebrate"],
  ["heart", "❤️", "love"],
  ["thumbsup", "\u{1F44D}", "+1 like"],
  ["thumbsdown", "\u{1F44E}", "-1"],
  ["smile", "\u{1F604}", "happy"],
  ["joy", "\u{1F602}", "lol"],
  ["sob", "\u{1F62D}", "cry"],
  ["wave", "\u{1F44B}", "hi hello"],
  ["pray", "\u{1F64F}", "thanks please"],
  ["clap", "\u{1F44F}"],
  ["muscle", "\u{1F4AA}", "strong"],
  ["zap", "⚡", "lightning fast"],
  ["bulb", "\u{1F4A1}", "idea"],
  ["wrench", "\u{1F527}", "fix tool"],
  ["hammer", "\u{1F528}", "build"],
  ["gear", "⚙️", "settings"],
  ["lock", "\u{1F512}", "secure"],
  ["key", "\u{1F511}"],
  ["package", "\u{1F4E6}", "box"],
  ["memo", "\u{1F4DD}", "note write"],
  ["book", "\u{1F4D6}", "docs"],
  ["bookmark", "\u{1F516}"],
  ["pin", "\u{1F4CC}", "pushpin"],
  ["link", "\u{1F517}"],
  ["mag", "\u{1F50D}", "search"],
  ["calendar", "\u{1F4C5}", "date"],
  ["clock", "\u{1F550}", "time"],
  ["hourglass", "⏳", "wait"],
  ["coffee", "☕"],
  ["moon", "\u{1F319}", "night"],
  ["sun", "☀️"],
  ["cloud", "☁️"],
  ["umbrella", "☂️", "rain"],
  ["seedling", "\u{1F331}", "plant grow"],
  ["tree", "\u{1F333}"],
  ["cat", "\u{1F431}"],
  ["dog", "\u{1F436}"],
  ["bird", "\u{1F426}"],
  ["fish", "\u{1F41F}"],
  ["pizza", "\u{1F355}"],
  ["cake", "\u{1F370}", "birthday"],
  ["house", "\u{1F3E0}", "home"],
  ["car", "\u{1F697}"],
  ["plane", "✈️", "airplane flight"],
  ["globe", "\u{1F30D}", "earth world"],
  ["computer", "\u{1F4BB}", "laptop"],
  ["phone", "\u{1F4F1}", "mobile"],
  ["robot", "\u{1F916}", "bot agent"],
  ["ghost", "\u{1F47B}"],
  ["skull", "\u{1F480}", "dead"],
  ["100", "\u{1F4AF}", "hundred"],
  ["question", "❓", "?"],
  ["exclamation", "❗", "!"],
  ["construction", "\u{1F6A7}", "wip"],
  ["recycle", "♻️"],
  ["trophy", "\u{1F3C6}", "win"],
  ["medal", "\u{1F3C5}"],
  ["gift", "\u{1F381}", "present"],
  ["money", "\u{1F4B0}", "cash"],
  ["chart", "\u{1F4C8}", "graph up"],
  ["art", "\u{1F3A8}", "palette design"],
  ["music", "\u{1F3B5}", "note"],
  ["game", "\u{1F3AE}", "controller"],
  ["mountain", "⛰️"],
  ["ocean", "\u{1F30A}", "wave water"],
  ["snowflake", "❄️", "cold"],
  ["rainbow", "\u{1F308}"],
  ["sleep", "\u{1F634}", "zzz"],
  ["shrug", "\u{1F937}"],
  ["facepalm", "\u{1F926}"],
  ["sunglasses", "\u{1F60E}", "cool"],
  ["wink", "\u{1F609}"],
  ["rage", "\u{1F621}", "angry"],
  ["scream", "\u{1F631}"],
  ["sweat", "\u{1F605}", "phew"],
  ["hug", "\u{1F917}"],
  ["nerd", "\u{1F913}"],
  ["poop", "\u{1F4A9}"],
  ["kolux", "\u{1F9ED}", "compass"],
];

// Flags: the country name and its ISO 3166-1 alpha-2 code both find the flag.
const countries: [string, string][] = [
  ["AR", "Argentina"], ["AU", "Australia"], ["AT", "Austria"], ["BE", "Belgium"], ["BR", "Brazil"], ["CA", "Canada"], ["CL", "Chile"],
  ["CN", "China"], ["CO", "Colombia"], ["CZ", "Czechia"], ["DK", "Denmark"], ["EG", "Egypt"], ["FI", "Finland"], ["FR", "France"],
  ["DE", "Germany"], ["GR", "Greece"], ["HK", "Hong Kong"], ["HU", "Hungary"], ["IN", "India"], ["ID", "Indonesia"], ["IE", "Ireland"],
  ["IL", "Israel"], ["IT", "Italy"], ["JP", "Japan"], ["KE", "Kenya"], ["KR", "South Korea"], ["LA", "Laos"], ["MY", "Malaysia"],
  ["MX", "Mexico"], ["NL", "Netherlands"], ["NZ", "New Zealand"], ["NG", "Nigeria"], ["NO", "Norway"], ["PK", "Pakistan"], ["PE", "Peru"],
  ["PH", "Philippines"], ["PL", "Poland"], ["PT", "Portugal"], ["RO", "Romania"], ["RU", "Russia"], ["SA", "Saudi Arabia"], ["SG", "Singapore"],
  ["ZA", "South Africa"], ["ES", "Spain"], ["SE", "Sweden"], ["CH", "Switzerland"], ["TW", "Taiwan"], ["TH", "Thailand"], ["TR", "Turkey"],
  ["UA", "Ukraine"], ["AE", "United Arab Emirates"], ["GB", "United Kingdom"], ["US", "United States"], ["VN", "Vietnam"],
];

/** The flag emoji for an ISO 3166-1 alpha-2 code (two regional-indicator letters). */
export const flagOf = (iso: string): string => String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

export const SHORTCODES: Shortcode[] = [
  ...plain.map(([code, emoji, words]) => ({ code, emoji, words: words ? words.split(" ") : [] })),
  ...countries.map(([iso, name]) => ({ code: `flag_${name.toLowerCase().replace(/ /g, "_")}`, emoji: flagOf(iso), words: [iso.toLowerCase(), name.toLowerCase(), "flag"] })),
];

/** The `:word` being typed just before the caret: where the colon is and the word after it; null when none. */
export function shortcodeAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s):([a-z0-9_+-]{1,32})$/i.exec(before);
  if (!m) return null;
  return { start: before.length - m[2].length - 1, query: m[2] };
}

/** Suggestions for a query: exact code first, then codes that start with it, then words and codes that contain it. */
export function suggest(query: string, max = 8): Shortcode[] {
  const q = query.toLowerCase().replace(/ /g, "_");
  if (!q) return [];
  const rank = (s: Shortcode): number => {
    if (s.code === q || s.words.includes(q)) return 0;
    if (s.code.startsWith(q) || s.words.some((w) => w.startsWith(q))) return 1;
    if (s.code.includes(q) || s.words.some((w) => w.includes(q))) return 2;
    return 3;
  };
  return SHORTCODES.map((s) => [rank(s), s] as const)
    .filter(([r]) => r < 3)
    .sort((a, b) => a[0] - b[0])
    .slice(0, max)
    .map(([, s]) => s);
}

/** The text with the shortcode at `start..caret` replaced by the emoji; everything after the caret is kept. */
export function withEmoji(text: string, start: number, caret: number, emoji: string): { text: string; caret: number } {
  const next = text.slice(0, start) + emoji + text.slice(caret);
  return { text: next, caret: start + emoji.length };
}

/** What a key does while the list is open: take the pick, close it, move in it, or nothing (an IME composing is never interrupted). */
export function shortcodeKey(key: string, composing: boolean, open: boolean): "take" | "close" | "down" | "up" | null {
  if (composing || !open) return null;
  if (key === "Enter" || key === "Tab") return "take";
  if (key === "Escape") return "close";
  if (key === "ArrowDown") return "down";
  if (key === "ArrowUp") return "up";
  return null;
}
