// Sound, synthesised in Web Audio (no clip files): textured one-shots built
// from filtered noise and oscillators, a light street-night groove, and tonal
// blips. Everything routes through one master gain; playback is a silent no-op
// until the first tap unlocks the context.

export function createAudio(sdk, tweaks) {
  let audio = null;
  let ctx = null;
  let master = null;
  let musicGain = null;
  let noiseBuf = null;
  let musicOn = true;
  let soundOn = true;
  let nextBeat = 0;
  let beat = 0;

  const ready = sdk.audio
    .getContext()
    .then((a) => {
      audio = a;
      ctx = a.context;
      master = ctx.createGain();
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      applyVolumes();
    })
    .catch(() => {});

  function applyVolumes() {
    if (!master) return;
    master.gain.value = soundOn ? tweaks.get('masterVolume') : 0;
    musicGain.gain.value = musicOn ? tweaks.get('musicVolume') : 0;
  }
  const unsub = [tweaks.subscribe('masterVolume', applyVolumes), tweaks.subscribe('musicVolume', applyVolumes)];

  function unlock() {
    if (audio) void audio.unlock().catch(() => {});
  }
  const live = () => ctx && ctx.state === 'running';

  function noise(t, dur, { type = 'bandpass', freq = 1200, q = 0.8, gain = 0.5, sweep = null, attack = 0.005 } = {}) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }
  function tone(t, dur, { freq = 440, to = null, type = 'sine', gain = 0.3, attack = 0.005, dest = master } = {}) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  const SFX = {
    card: (t) => {
      noise(t, 0.09, { type: 'highpass', freq: 2500, gain: 0.35 });
      noise(t + 0.01, 0.05, { type: 'bandpass', freq: 900, gain: 0.25 });
    },
    summon: (t) => {
      noise(t, 1.0, { type: 'bandpass', freq: 300, sweep: 4000, q: 2, gain: 0.25, attack: 0.4 });
      tone(t + 0.05, 0.9, { freq: 220, to: 660, type: 'triangle', gain: 0.12, attack: 0.3 });
      tone(t + 0.95, 0.5, { freq: 90, to: 40, type: 'sine', gain: 0.6 });
      noise(t + 0.95, 0.3, { type: 'lowpass', freq: 400, gain: 0.4 });
    },
    impact: (t) => {
      tone(t, 0.35, { freq: 140, to: 45, type: 'sine', gain: 0.8 });
      noise(t, 0.22, { type: 'lowpass', freq: 1800, sweep: 300, gain: 0.7 });
      noise(t, 0.06, { type: 'highpass', freq: 3000, gain: 0.4 });
    },
    shatter: (t) => {
      for (let i = 0; i < 7; i++) noise(t + i * 0.035, 0.12 + Math.random() * 0.2, { type: 'bandpass', freq: 3000 + Math.random() * 5000, q: 6, gain: 0.35 });
      tone(t, 0.6, { freq: 1800, to: 900, type: 'triangle', gain: 0.08 });
      noise(t, 0.5, { type: 'lowpass', freq: 600, gain: 0.3 });
    },
    fire: (t) => {
      noise(t, 0.9, { type: 'bandpass', freq: 500, sweep: 1600, q: 0.6, gain: 0.6, attack: 0.08 });
      noise(t + 0.05, 0.8, { type: 'lowpass', freq: 300, gain: 0.4, attack: 0.1 });
    },
    trap: (t) => {
      noise(t, 0.06, { type: 'highpass', freq: 2000, gain: 0.4 });
      [1046, 1568, 2093].forEach((f, i) => tone(t + 0.04 + i * 0.02, 0.7, { freq: f, type: 'sine', gain: 0.1 }));
      tone(t + 0.04, 0.4, { freq: 330, to: 310, type: 'square', gain: 0.05 });
    },
    spell: (t) => {
      [784, 988, 1318].forEach((f, i) => tone(t + i * 0.06, 0.5, { freq: f, type: 'triangle', gain: 0.1 }));
      noise(t, 0.6, { type: 'bandpass', freq: 5000, q: 1.5, gain: 0.08, attack: 0.2 });
    },
  };

  function sfx(name) {
    if (!live() || !soundOn) return;
    SFX[name]?.(ctx.currentTime + 0.005);
  }
  function blip(freq = 880, dur = 0.08, type = 'square') {
    if (!live() || !soundOn) return;
    tone(ctx.currentTime, dur, { freq, type, gain: 0.12 });
  }
  function drain(amount) {
    if (!live() || !soundOn) return;
    const n = Math.min(10, 3 + Math.floor(amount / 500));
    for (let i = 0; i < n; i++) tone(ctx.currentTime + i * 0.045, 0.04, { freq: 900 - i * 45, type: 'square', gain: 0.06 });
  }

  // Street-night groove: kick, snare, hats, a minor bass line and a sparse
  // stab, scheduled a little ahead on the audio clock.
  const BASS = [41, 41, 44, 41, 39, 39, 36, 39];
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function scheduleMusic() {
    if (!live() || !musicOn) return;
    const spb = 60 / 96 / 2; // eighth notes at 96 bpm
    if (nextBeat < ctx.currentTime) nextBeat = ctx.currentTime + 0.05;
    while (nextBeat < ctx.currentTime + 0.25) {
      const t = nextBeat;
      const step = beat % 16;
      if (step % 8 === 0 || step === 11) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.setValueAtTime(120, t);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
        g.gain.setValueAtTime(0.5, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        o.connect(g).connect(musicGain);
        o.start(t);
        o.stop(t + 0.3);
      }
      if (step % 8 === 4) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1800;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.25, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        src.connect(f).connect(g).connect(musicGain);
        src.start(t, Math.random());
        src.stop(t + 0.2);
      }
      {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        const f = ctx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 7000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(step % 2 ? 0.04 : 0.07, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        src.connect(f).connect(g).connect(musicGain);
        src.start(t, Math.random());
        src.stop(t + 0.06);
      }
      if (step % 2 === 0) {
        const note = BASS[Math.floor(beat / 4) % BASS.length];
        tone(t, spb * 1.8, { freq: midi(note), type: 'sawtooth', gain: 0.07, dest: musicGain });
        tone(t, spb * 1.8, { freq: midi(note - 12), type: 'sine', gain: 0.18, dest: musicGain });
      }
      if (step === 6 && beat % 32 < 16) [0, 3, 7].forEach((iv) => tone(t, 0.25, { freq: midi(BASS[Math.floor(beat / 4) % BASS.length] + 24 + iv), type: 'square', gain: 0.025, dest: musicGain }));
      nextBeat += spb;
      beat++;
    }
  }

  function setSound(on) {
    soundOn = on;
    applyVolumes();
  }
  function setMusic(on) {
    musicOn = on;
    applyVolumes();
  }
  function destroy() {
    unsub.forEach((u) => u());
  }

  return { ready, unlock, sfx, blip, drain, scheduleMusic, setSound, setMusic, destroy };
}
