// T-594 evidence: a line-for-line model of src-tauri/installer-hooks.nsh (KOLUX_PATH_CUT and the append step
// of KOLUX_PATH_ADD), checked against cli_register.rs path_without / path_with for the plain spellings
// Kolux writes (any case, with or without a trailing backslash). Run: node evidence/T-594-path-model.mjs
const BIN = String.raw`C:\Users\Me\AppData\Local\Kolux RS\bin`;
const eq = (a, b) => a.toLowerCase() === b.toLowerCase(); // NSIS StrCmp and LogicLib == ignore case
const same = (e) => eq(e, BIN) || eq(e, BIN + "\\");

function nsisCut(r8) {
  let [r2, r3, r4, r6, r7] = ["", "", 0, 0, 0];
  for (;;) {
    const r5 = r8.slice(r4, r4 + 1); // StrCpy $R5 $R8 1 $R4
    if (r5 === ";" || r5 === "") {
      if (same(r3)) r6 += 1;
      else if (r7 === 0) [r2, r7] = [r3, 1];
      else r2 = `${r2};${r3}`;
      r3 = "";
      if (r5 === "") break;
    } else r3 += r5;
    r4 += 1;
  }
  return [r2, r6];
}

function nsisAdd(r0) {
  let r1 = r0;
  while (r1.slice(-1) === ";") r1 = r1.slice(0, -1); // StrCpy $R5 $R1 1 -1 ; StrCpy $R1 $R1 -1
  return r1 === "" ? BIN : `${r1};${BIN}`;
}

const pathWithout = (p) => (p.split(";").some(same) ? p.split(";").filter((e) => !same(e)).join(";") : null);
function pathWith(p) {
  if (p.split(";").some(same)) return p;
  const kept = p.replace(/;+$/, "");
  return kept.trim() === "" ? BIN : `${kept};${BIN}`;
}

const atoms = ["", String.raw`C:\a`, String.raw`%LOCALAPPDATA%\x`, BIN, BIN.toUpperCase(), BIN + "\\", BIN + "2", String.raw`C:\Users\Me\AppData\Local\Kolux RS`, String.raw`D:\b;c`];
const check = (ok, what) => { if (!ok) throw new Error(what); };
let cases = 0;
function one(p) {
  cases += 1;
  const [cut, k] = nsisCut(p);
  const want = pathWithout(p);
  check(k > 0 === (want !== null), `found? ${JSON.stringify(p)}`);
  check(want !== null ? cut === want : cut === p, `cut ${JSON.stringify(p)} -> ${JSON.stringify(cut)}`);
  if (k === 0 && p.trim() !== "") check(nsisAdd(p) === pathWith(p), `add ${JSON.stringify(p)}`);
  const added = k === 0 ? nsisAdd(p) : p;
  check(nsisCut(added)[1] >= 1, `read-back ${JSON.stringify(added)}`);
  check(nsisCut(nsisCut(added)[0])[1] === 0, `remove all ${JSON.stringify(added)}`);
}
function* product(n) {
  if (n === 0) return yield [];
  for (const rest of product(n - 1)) for (const a of atoms) yield [...rest, a];
}
for (let n = 0; n < 5; n++) for (const combo of product(n)) one(combo.join(";"));
let seed = 7;
const rand = (m) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % m);
for (let i = 0; i < 20000; i++) one(Array.from({ length: rand(9) }, () => atoms[rand(atoms.length)]).join(";"));
console.log(`ok: ${cases} PATH values; NSIS cut == path_without, append == path_with (non-blank), read-back and removal hold`);
