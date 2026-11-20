// Balance simulation: seeded games with scripted strategies.
// P2 Phase B REPLACED the P1 bands that lived here (60-140 decisions per game, the cautious
// win rate 35-75 percent, the cheap Black Swamp route 15-30 percent and below the steamer)
// with the tier bands in tiers-main.test.mjs and tiers-paths.test.mjs (spec B3; user
// decision 2026-11-20 "Hard at the end"). What stays here holds as before: every game
// ends, the backgrounds within 15 points, and deaths in some but not most cautious games.

import test from "node:test";
import assert from "node:assert/strict";
import { loadRouteFromDisk } from "./load.mjs";
import { MAX_STEPS, simulate, summarize } from "./simulate.mjs";

const route = loadRouteFromDisk();
const GAMES = { cautious: 500, cheap: 500, thrifty: 200, random: 200 };
const LABEL = {
  cautious: "cautious (packet boat, steamer cabin when affordable, land looker)",
  thrifty: "thrifty (line boat with meals, steamer deck)",
  cheap: "cheap (line boat, own food, overland through the Black Swamp, played sensibly)",
  random: "random (uniform over enabled actions)",
};

const results = {};
const summaries = {};
for (const [name, n] of Object.entries(GAMES)) {
  results[name] = simulate(route, name, n);
  summaries[name] = summarize(results[name]);
}

test("balance simulation: outcome distribution", () => {
  const total = Object.values(GAMES).reduce((a, b) => a + b, 0);
  console.log(`\n${total} seeded games`);
  for (const [name, s] of Object.entries(summaries)) {
    const pct = (x) => `${(x * 100).toFixed(1)}%`;
    const outcomes = Object.entries(s.outcomes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
    console.log(LABEL[name]);
    console.log(`  games ${s.games}  win ${pct(s.winRate)}  outcomes: ${outcomes}`);
    console.log(`  decisions min ${s.decisions.min} p5 ${s.decisions.p5} median ${s.decisions.median} p95 ${s.decisions.p95} max ${s.decisions.max}`);
    console.log(`  a death in ${pct(s.anyDeath)} of games, ${s.meanDeaths.toFixed(2)} deaths per game; win by background ${JSON.stringify(s.byBackground)}`);
  }
  assert.ok(total >= 500);
});

test("no crashes and every game ends", () => {
  for (const [name, rs] of Object.entries(results)) {
    for (const r of rs) {
      assert.ok(r.over, `${name} ${r.seed} did not end`);
      assert.notEqual(r.outcome, "unfinished");
      assert.ok(r.decisions < MAX_STEPS);
    }
  }
});

test("backgrounds (cautious play) win within 15 points of each other", () => {
  const rates = Object.values(summaries.cautious.byBackground);
  const spread = Math.max(...rates) - Math.min(...rates);
  assert.ok(spread <= 0.15, `spread ${spread.toFixed(2)}: ${JSON.stringify(summaries.cautious.byBackground)}`);
});

test("deaths happen, but not in most cautious games", () => {
  assert.ok(summaries.cautious.anyDeath > 0);
  assert.ok(summaries.cautious.anyDeath < 0.5);
  assert.ok(summaries.cheap.anyDeath > summaries.cautious.anyDeath, "more swamp-route families lose someone");
});
