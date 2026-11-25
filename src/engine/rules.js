// Seeded PRNG (mulberry32). The state lives in the duel object so every draw,
// shuffle, coin and die is reproducible from the duel's seed and survives the
// engine's snapshot/restore. Shuffles are genuine Fisher-Yates: no stacking.
export function nextRandom(d) {
  let t = (d.rng = (d.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(d, n) {
  return Math.floor(nextRandom(d) * n);
}

export function shuffleInPlace(d, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(d, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function freshSeed() {
  // Seed source for a new duel only; never used during play.
  const buf = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(buf);
  else buf[0] = Math.floor(Math.random() * 4294967296);
  return buf[0] | 0;
}
