// Shared by the tier-band tests (P2 Phase B): run a strategy's seeded games once, and
// print its tier table row.
import { loadRouteFromDisk } from "./load.mjs";
import { simulate, tierSummary } from "./simulate.mjs";

export const route = loadRouteFromDisk();
export const pct = (x) => `${(x * 100).toFixed(1)}%`;

export function tierRow(name, games, path = null) {
  const results = simulate(route, name, games, "tier");
  const t = tierSummary(results, path);
  const where = path ? `${path} path, n=${t.games} of ${games} games took it` : `main route, n=${t.games}`;
  console.log(`${name.padEnd(16)} ${where.padEnd(38)} tier 0 ${pct(t.t0).padStart(6)}  tier >=1 ${pct(t.t1).padStart(6)}  tier 2 ${pct(t.t2).padStart(6)}  decisions median ${t.decisions.median} min ${t.decisions.min} max ${t.decisions.max}`);
  return { results, t };
}

// The share of games whose decisions fall in [lo, hi], and the 5th and 95th percentiles.
export function decisionSpread(results) {
  const d = results.map((r) => r.decisions).sort((a, b) => a - b);
  const q = (x) => d[Math.min(d.length - 1, Math.floor(x * d.length))];
  return { p5: q(0.05), median: q(0.5), p95: q(0.95), min: d[0], max: d.at(-1) };
}
