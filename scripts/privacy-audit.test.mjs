// APP-070: a network client anywhere in the shipped source would be a connection the privacy
// statement (src/settings/privacy.ts) does not name.
import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|rs|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
};

const CLIENTS = [/\bfetch\(\s*["'`]https?:/, /XMLHttpRequest/, /sendBeacon/, /new WebSocket\(/, /\breqwest::/, /tauri_plugin_updater/, /\bureq::/, /\bhyper::/, /TcpStream::connect/];
const ALLOWED = {
  "src-tauri/src/artifacts.rs": [/\breqwest::/], // the script CDNs, when saving an artifact for offline use
  "src-tauri/src/update.rs": [/tauri_plugin_updater/, /\breqwest::/], // GitHub Releases (APP-031 checks the installer the manifest names is there)
  "src-tauri/src/lib.rs": [/tauri_plugin_updater/],
  "src-tauri/src/cli.rs": [/TcpStream::connect/], // kolux-dev talking to the app on 127.0.0.1
};

test("app070: no network client in the shipped source beyond the connections the statement names", () => {
  // scripts/evidence drives a dev build over loopback for proofs and never ships.
  const files = [...walk(path.join(root, "src")), ...walk(path.join(root, "src-tauri/src")), ...walk(path.join(root, "scripts")).filter((f) => !f.includes(`${path.sep}evidence${path.sep}`))];
  expect(files.length).toBeGreaterThan(50);
  const found = [];
  for (const f of files) {
    const rel = path.relative(root, f).replace(/\\/g, "/");
    // Rust tests sit at the end of each file behind #[cfg(test)]; a client used only there is not shipped.
    const text = fs.readFileSync(f, "utf8").split("#[cfg(test)]")[0];
    for (const re of CLIENTS) {
      if (re.test(text) && !(ALLOWED[rel] ?? []).some((a) => a.source === re.source)) found.push(`${rel}: ${re.source}`);
    }
  }
  expect(found).toEqual([]);
});
