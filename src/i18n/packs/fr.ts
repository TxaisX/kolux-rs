// SET-017 (T-210-c): the French pack. Machine-translated 2026-10-20 (Txais approved machine translation);
// a human review pass is in the after-list. Product names (Kolux, Claude, Codex, ChatGPT, Git) stay as they are.
import type { TextKey } from "../en";
import type { PackMeta } from "../packs";

export const META: PackMeta = { language: "fr", machineTranslated: true, translatedOn: "2026-10-20", humanReviewed: false };

const pack = {
  "glossary.repository.plain": "projet",
  "glossary.repository.hover": "Un projet est ici un dossier suivi par Git (un dépôt Git)",
  "glossary.clone.plain": "Copier depuis une adresse web",
  "glossary.clone.hover": "Copier depuis une adresse web : git clone télécharge un dépôt Git depuis son URL",
  "glossary.worktree.plain": "espace de travail",
  "glossary.worktree.hover": "Un espace de travail est une branche dans son propre dossier (un worktree Git)",
  "glossary.checkout.plain": "dossier principal",
  "glossary.checkout.hover": "Le dossier principal du projet (son checkout principal)",
  "glossary.shell.plain": "terminal",
  "glossary.shell.hover": "Un terminal : un shell simple, sans IA dedans",
  "glossary.cli.plain": "programme",
  "glossary.cli.hover": "Le programme propre à l'IA sur ce PC (sa CLI)",
  "glossary.pty.plain": "terminal",
  "glossary.pty.hover": "Un terminal (un PTY, ou pseudo-terminal)",
  "inbox.bell.needs.one": "Boîte de réception, {count} a besoin de vous",
  "inbox.bell.needs.many": "Boîte de réception, {count} ont besoin de vous",
  "connect.claude": "Se connecter ouvre une fois la page de connexion de Claude dans votre navigateur et conserve une clé valable un an.",
  "connect.codex": "Se connecter ajoute un compte ChatGPT dans un dossier Codex propre à Kolux ; votre dossier Codex reste inchangé.",
} satisfies Record<TextKey, string>;

export default pack;
