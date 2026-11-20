// Seeded PRNG (mulberry32) whose whole position lives in a plain object,
// so a saved game resumes on exactly the same draw.

// FNV-1a over the seed string's code points.
export function hashSeed(seed) {
  let h = 0x811c9dc5;
  for (const ch of String(seed)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// The RNG state stored inside game state: {seed, s, n}. n counts draws (debugging aid).
export function createRng(seed) {
  return { seed: String(seed), s: hashSeed(seed), n: 0 };
}

// Advance the stored position and return a float in [0, 1).
export function nextFloat(r) {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  r.n += 1;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// A convenience cursor over a stored RNG object. Every helper consumes exactly
// one draw, so the draw count never depends on the outcome.
export function cursor(r) {
  return {
    float: () => nextFloat(r),
    int(lo, hi) {
      return lo + Math.floor(nextFloat(r) * (hi - lo + 1));
    },
    chance(p) {
      return nextFloat(r) < p;
    },
    pick(arr) {
      const x = nextFloat(r);
      return arr.length ? arr[Math.floor(x * arr.length)] : undefined;
    },
    // items: [[weight, value], ...]; weights <= 0 are skipped.
    weighted(items) {
      const x = nextFloat(r);
      const total = items.reduce((a, [w]) => a + (w > 0 ? w : 0), 0);
      if (total <= 0) return undefined;
      let left = x * total;
      for (const [w, v] of items) {
        if (w <= 0) continue;
        left -= w;
        if (left < 0) return v;
      }
      for (let i = items.length - 1; i >= 0; i--) if (items[i][0] > 0) return items[i][1];
      return undefined;
    },
  };
}
