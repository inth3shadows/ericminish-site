// Play seeded games with a scripted strategy and collect outcomes.
// Used by sim.test.mjs (which prints the distribution).

import { availableActions, newGame, step, view } from "../../engine/engine.js";
import { createRng, cursor } from "../../engine/rng.js";
import { STRATEGIES } from "./strategies.mjs";

export const MAX_STEPS = 600;

// `pace` (optional): (view) -> "steady" | "hard" | "grueling", set on every
// travel action that offers a pace, as the UI's pace control does.
export function playOne(route, strategy, seedIndex, seedPrefix = "sim", { pace = null } = {}) {
  const seed = `${seedPrefix}-${seedIndex}`;
  const rng = cursor(createRng(`player-${seed}`));
  let { state } = newGame(route, { seed });
  let steps = 0;
  const beatTypes = {};
  while (!state.over && steps < MAX_STEPS) {
    const acts = availableActions(route, state);
    let a = strategy(route, state, acts, { seedIndex, rng });
    if (pace && a?.id === "go" && a.paces) a = { ...a, pace: pace(view(route, state)) };
    if (!a) throw new Error(`strategy returned no action (seed ${seed}, phase ${state.phase}, place ${state.place})`);
    const r = step(route, state, a);
    for (const b of r.beats) beatTypes[b.type] = (beatTypes[b.type] ?? 0) + 1;
    if (r.beats.some((b) => b.type === "error")) throw new Error(`invalid action ${a.id} (seed ${seed})`);
    state = r.state;
    steps += 1;
  }
  return {
    seed,
    background: state.vars.background,
    over: Boolean(state.over),
    outcome: state.over?.outcome ?? "unfinished",
    won: Boolean(state.over?.won),
    decisions: state.decisions,
    days: state.day,
    date: state.date,
    deaths: state.party.filter((p) => p.status === "dead").length,
    acres: state.land.paid ? state.land.acres : 0,
    route: state.vars.routeTaken ?? null,
    tier: state.over?.tier ?? 0,
    path: state.vars.path ?? "main",
    beatTypes,
  };
}

export function simulate(route, name, games, seedPrefix = "sim", opts = {}) {
  const strategy = STRATEGIES[name];
  const results = [];
  for (let i = 0; i < games; i++) results.push(playOne(route, strategy, i, `${seedPrefix}-${name}`, opts));
  return results;
}

// Pace policies for the pace trade-off test (N-A2), from the reviewer's p2b
// script: push grueling on good road while the most tired of the family and
// the team would still be under `limit` after the day; otherwise steady.
const BAD_ROAD = new Set(["swamp", "track"]);
const mostTired = (v) => Math.max(...v.party.filter((p) => p.status !== "dead").map((p) => p.fatigue), v.gear.fatigue ?? 0);
export const PACE_POLICIES = {
  steady: () => "steady",
  gruelingUnder40: (v) => (!BAD_ROAD.has(v.travel?.terrain) && mostTired(v) + 12 < 40 ? "grueling" : "steady"),
  gruelingUnder45: (v) => (!BAD_ROAD.has(v.travel?.terrain) && mostTired(v) + 12 < 45 ? "grueling" : "steady"),
  gruelingEverywhere: () => "grueling",
};

export function summarize(results) {
  const n = results.length;
  const outcomes = {};
  for (const r of results) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
  const sorted = results.map((r) => r.decisions).sort((a, b) => a - b);
  const pct = (q) => sorted[Math.min(n - 1, Math.floor(q * n))];
  const byBg = {};
  for (const r of results) {
    byBg[r.background] ??= { n: 0, won: 0 };
    byBg[r.background].n += 1;
    byBg[r.background].won += r.won ? 1 : 0;
  }
  return {
    games: n,
    winRate: results.filter((r) => r.won).length / n,
    outcomes,
    decisions: { min: sorted[0], p5: pct(0.05), median: pct(0.5), p95: pct(0.95), max: sorted[n - 1] },
    inBand: results.filter((r) => r.decisions >= 60 && r.decisions <= 140).length / n,
    anyDeath: results.filter((r) => r.deaths > 0).length / n,
    meanDeaths: results.reduce((a, r) => a + r.deaths, 0) / n,
    byBackground: Object.fromEntries(Object.entries(byBg).map(([k, v]) => [k, +(v.won / v.n).toFixed(2)])),
  };
}

// The tier table (P2 Phase B): shares of tier >= 1 and tier 2, over all games or over the
// games that took `path` (a path strategy that never reached its pivot plays the main route).
export function tierSummary(results, path = null) {
  const rs = path ? results.filter((r) => r.path === path) : results;
  const n = rs.length;
  const dec = rs.map((r) => r.decisions).sort((a, b) => a - b);
  return {
    games: n,
    took: results.length ? n / results.length : 0,
    t0: n ? rs.filter((r) => r.tier === 0).length / n : 0,
    t1: n ? rs.filter((r) => r.tier >= 1).length / n : 0,
    t2: n ? rs.filter((r) => r.tier === 2).length / n : 0,
    decisions: { min: dec[0], median: dec[Math.floor(n / 2)], max: dec[n - 1] },
    outcomes: rs.reduce((o, r) => ({ ...o, [r.outcome]: (o[r.outcome] ?? 0) + 1 }), {}),
  };
}
