import { api } from "./api";

// Idle detection needs to know the user is here. Any pointer or key activity stamps the
// running session, at most once a minute. Rust ignores the call when nothing is running.

const EVERY_MS = 60_000;
let last = 0;

function onInteract() {
  const now = Date.now();
  if (now - last < EVERY_MS) return;
  last = now;
  api.touch().catch(() => {
    /* not important enough to surface */
  });
}

export function installInteractionStamps(): () => void {
  window.addEventListener("pointerdown", onInteract, { passive: true });
  window.addEventListener("keydown", onInteract, { passive: true });
  return () => {
    window.removeEventListener("pointerdown", onInteract);
    window.removeEventListener("keydown", onInteract);
  };
}
