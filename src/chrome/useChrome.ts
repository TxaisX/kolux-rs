// T-543: the window's passing chrome state, moved out of App.tsx as it was: the worktree palette's
// open flag, the notice line and the toast that clears itself.
import { useRef, useState } from "react";

export function useChrome() {
  const [palette, setPalette] = useState(false); // PROJ-057 / VIEW-037: the worktree palette is open
  const [notice, setNotice] = useState<string | null>(null);
  // A toast is a passing note (SESS-024 "starting 3 sessions"); it clears itself.
  const [toast, setToastText] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const setToast = (text: string) => {
    setToastText(text);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastText(null), 4000);
  };
  return { palette, setPalette, notice, setNotice, toast, setToast };
}
