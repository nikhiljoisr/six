// A soft two-note chime for timer transitions, synthesised so no asset ships. Only
// called when the user has switched sound on; Six is silent by default.

let ctx: AudioContext | null = null;

export function chime(): void {
  try {
    ctx ??= new AudioContext();
    const now = ctx.currentTime;
    const notes: [number, number][] = [
      [659.25, 0], // E5
      [880.0, 0.18], // A5
    ];
    for (const [freq, at] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.06, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.5);
    }
  } catch {
    // No audio device or a blocked context: stay silent, as always.
  }
}
