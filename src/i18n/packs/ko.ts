// SET-017 (T-210-c): the Korean pack. Machine-translated 2026-10-20 (Txais approved machine translation);
// a human review pass is in the after-list. Product names (Kolux, Claude, Codex, ChatGPT, Git) stay as they are.
import type { TextKey } from "../en";
import type { PackMeta } from "../packs";

export const META: PackMeta = { language: "ko", machineTranslated: true, translatedOn: "2026-10-20", humanReviewed: false };

const pack = {
  "glossary.repository.plain": "프로젝트",
  "glossary.repository.hover": "여기서 프로젝트는 Git이 추적하는 폴더입니다(Git 저장소)",
  "glossary.clone.plain": "웹 주소에서 복사",
  "glossary.clone.hover": "웹 주소에서 복사: git clone은 URL에서 Git 저장소를 내려받습니다",
  "glossary.worktree.plain": "작업 공간",
  "glossary.worktree.hover": "작업 공간은 자체 폴더에 있는 브랜치입니다(Git worktree)",
  "glossary.checkout.plain": "기본 폴더",
  "glossary.checkout.hover": "프로젝트의 기본 폴더(메인 체크아웃)",
  "glossary.shell.plain": "터미널",
  "glossary.shell.hover": "터미널: AI가 들어 있지 않은 일반 셸입니다",
  "glossary.cli.plain": "프로그램",
  "glossary.cli.hover": "이 PC에 있는 AI 전용 프로그램(CLI)",
  "glossary.pty.plain": "터미널",
  "glossary.pty.hover": "터미널(PTY, 즉 의사 터미널)",
  "connect.claude": "연결을 누르면 브라우저에서 Claude 로그인 페이지가 한 번 열리고, 1년간 유효한 키가 저장됩니다.",
  "connect.codex": "연결을 누르면 Kolux 전용 Codex 홈에 ChatGPT 계정이 추가됩니다. 기존 Codex 폴더는 그대로 유지됩니다.",
} satisfies Record<TextKey, string>;

export default pack;
