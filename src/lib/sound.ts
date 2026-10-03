// The sound for timer transitions, synthesised so no asset ships. Only called when the
// user has switched sound on; Six is silent by default. What each sound is made of lives
// in soundPlan.ts.

import { soundPlan } from "./soundPlan";

let ctx: AudioContext | null = null;

export function chime(style?: string | null, level?: string | null): void {
  try {
    ctx ??= new AudioContext();
    const now = ctx.currentTime;
    for (const v of soundPlan(style, level)) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = v.wave;
      osc.frequency.value = v.freq;
      gain.gain.setValueAtTime(0.0001, now + v.at);
      gain.gain.exponentialRampToValueAtTime(v.peak, now + v.at + v.attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + v.at + v.decay);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + v.at);
      osc.stop(now + v.at + v.decay + 0.05);
    }
  } catch {
    // No audio device or a blocked context: stay silent, as always.
  }
}
