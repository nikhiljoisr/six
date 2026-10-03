// What each sound is made of. Pure numbers, so they can be tested; `sound.ts` plays them.
// Every sound is synthesised from a few oscillators: no asset ships, nothing is loaded.

export type SoundStyle = "two_note" | "bell" | "knock";
export type SoundLevel = "soft" | "normal" | "loud";

export interface Voice {
  freq: number;
  wave: "sine" | "triangle";
  /** Seconds after the sound starts. */
  at: number;
  /** Seconds to reach the peak, and to fade to silence. */
  attack: number;
  decay: number;
  /** Peak gain, already scaled by the level. */
  peak: number;
}

/** "Normal" is the level Six has always had; soft is half of it, loud a little over twice. */
const LEVEL: Record<SoundLevel, number> = { soft: 0.03, normal: 0.06, loud: 0.14 };

type Shape = Omit<Voice, "peak"> & { weight: number };

const SHAPES: Record<SoundStyle, Shape[]> = {
  // The original: E5 then A5, a rising fourth.
  two_note: [
    { freq: 659.25, wave: "sine", at: 0, attack: 0.02, decay: 0.45, weight: 1 },
    { freq: 880.0, wave: "sine", at: 0.18, attack: 0.02, decay: 0.45, weight: 1 },
  ],
  // One struck note that rings: C5 with two quieter partials above it.
  bell: [
    { freq: 523.25, wave: "sine", at: 0, attack: 0.005, decay: 1.4, weight: 1 },
    { freq: 1046.5, wave: "sine", at: 0, attack: 0.005, decay: 0.9, weight: 0.35 },
    { freq: 1568.0, wave: "sine", at: 0, attack: 0.005, decay: 0.5, weight: 0.15 },
  ],
  // Two short, low knocks on wood: G3, close together.
  knock: [
    { freq: 196.0, wave: "triangle", at: 0, attack: 0.003, decay: 0.12, weight: 1.6 },
    { freq: 196.0, wave: "triangle", at: 0.16, attack: 0.003, decay: 0.12, weight: 1.6 },
  ],
};

/** The voices of a sound at a level. Unknown names fall back to the original and to normal. */
export function soundPlan(style: string | null | undefined, level: string | null | undefined): Voice[] {
  const shapes = SHAPES[(style ?? "two_note") as SoundStyle] ?? SHAPES.two_note;
  const scale = LEVEL[(level ?? "normal") as SoundLevel] ?? LEVEL.normal;
  return shapes.map(({ weight, ...v }) => ({ ...v, peak: Math.min(0.3, scale * weight) }));
}
