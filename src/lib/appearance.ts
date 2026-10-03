// Light, as Six has always been, unless Settings says otherwise. The stylesheet remaps its
// colour variables under `data-theme="dark"`; this file only decides when that applies.

export type Appearance = "light" | "dark" | "auto";

/** Which of the two the page shows: "auto" follows macOS, anything unknown is light. */
export function resolveAppearance(setting: string | null | undefined, systemDark: boolean): "light" | "dark" {
  if (setting === "dark") return "dark";
  if (setting === "auto") return systemDark ? "dark" : "light";
  return "light";
}

// The last setting seen, kept so a window opens in the right appearance before Rust has
// answered (both windows share it). Never the source of truth: the snapshot is.
const KEY = "six.appearance";
let current: string = "light";

const system = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null);

export function applyAppearance(setting: string | null | undefined): void {
  current = setting ?? "light";
  const root = document.documentElement;
  if (resolveAppearance(current, !!system()?.matches) === "dark") root.dataset.theme = "dark";
  else delete root.dataset.theme;
  try {
    localStorage.setItem(KEY, current);
  } catch {
    // No storage: the next launch starts light for a moment, then follows the snapshot.
  }
}

/** Before the first render: the remembered appearance, and a watch on macOS for "auto". */
export function installAppearance(): void {
  let remembered: string | null = null;
  try {
    remembered = localStorage.getItem(KEY);
  } catch {
    remembered = null;
  }
  applyAppearance(remembered);
  system()?.addEventListener("change", () => applyAppearance(current));
}
