// EDIT-011 (T-316): which icon a file name gets. A well-known whole name (a lock file, a config
// file) decides before the extension does, and multi-part endings (.test.ts, .d.ts, .tar.gz) are
// recognised; anything unknown is a plain file. Folders sort above files in natural order in
// Rust (files.rs list_dir); this file only picks the picture.
export type FileKind = "file" | "code" | "markup" | "data" | "table" | "doc" | "image" | "archive" | "lock" | "config" | "package" | "shell" | "notebook" | "test" | "media";

const words = (kind: FileKind, list: string) => list.split(" ").map((w): [string, FileKind] => [w, kind]);

const WHOLE = new Map<string, FileKind>([
  ...words("lock", "package-lock.json yarn.lock pnpm-lock.yaml cargo.lock gemfile.lock poetry.lock composer.lock bun.lockb bun.lock go.sum flake.lock pipfile.lock uv.lock"),
  ...words("package", "package.json cargo.toml go.mod pyproject.toml gemfile composer.json requirements.txt pom.xml build.gradle pubspec.yaml"),
  ...words("config", ".gitignore .gitattributes .gitmodules .editorconfig .npmrc .nvmrc .dockerignore dockerfile makefile tsconfig.json jsconfig.json docker-compose.yml docker-compose.yaml"),
  ...words("shell", ".bashrc .zshrc .profile"),
  ...words("doc", "readme license licence changelog contributing authors notice"),
]);

const EXT = new Map<string, FileKind>([
  ...words("code", "ts tsx js jsx mjs cjs rs py go java kt c h cc cpp hpp cs rb php swift lua nim nims astro svelte vue dart scala ex exs hs sql r zig"),
  ...words("markup", "html htm xml svg css scss sass less xsl"),
  ...words("data", "json jsonl ndjson yaml yml toml ini env lock proto graphql"),
  ...words("table", "csv tsv xls xlsx ods"),
  ...words("doc", "md markdown mdx txt rst pdf doc docx rtf"),
  ...words("image", "png jpg jpeg gif webp bmp ico tiff avif"),
  ...words("media", "mp3 wav ogg flac m4a mp4 mov mkv webm avi"),
  ...words("archive", "zip gz tgz bz2 xz 7z rar tar"),
  ...words("lock", "lock"),
  ...words("config", "conf cfg config editorconfig"),
  ...words("shell", "sh bash zsh fish ps1 bat cmd"),
  ...words("notebook", "ipynb"),
]);

export function fileKind(name: string): FileKind {
  const n = name.toLowerCase();
  const whole = WHOLE.get(n);
  if (whole) return whole;
  const parts = n.split(".");
  // README.md, LICENSE-MIT, .env.local and the like: the leading word decides.
  const lead = WHOLE.get(parts[0]);
  if (lead === "doc") return "doc";
  if (n.startsWith(".env")) return "config";
  if (/^\.(eslint|prettier|babel|stylelint|npm|yarn)rc/.test(n) || /^tsconfig.*\.json$/.test(n)) return "config";
  if (parts.length < 2) return "file";
  const ext = parts[parts.length - 1];
  const middle = parts.slice(1, -1);
  const kind = EXT.get(ext) ?? "file";
  if (kind === "code" || kind === "data" || kind === "markup") {
    if (middle.includes("test") || middle.includes("spec")) return "test";
    if (middle.includes("config")) return "config";
  }
  return kind;
}
