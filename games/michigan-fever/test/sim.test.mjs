// Balance simulation: seeded games with scripted strategies.
// The bands come from the P1 spec: every game ends, 60-140 decisions per game,
// the cautious win rate between 35 and 75 percent, the cheap line-boat and
// Black Swamp route (played sensibly) between 15 and 30 percent and well below
// the steamer, and the three backgrounds within 15 points of each other.

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
    console.log(`  decisions min ${s.decisions.min} p5 ${s.decisions.p5} median ${s.decisions.median} p95 ${s.decisions.p95} max ${s.decisions.max}  in 60-140: ${pct(s.inBand)}`);
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

test("scripted games last 60-140 decisions", () => {
  for (const name of ["cautious", "thrifty", "cheap"]) {
    const bad = results[name].filter((r) => r.decisions < 60 || r.decisions > 140);
    assert.deepEqual(bad.map((r) => `${r.seed}: ${r.decisions}`), [], name);
  }
  // A random clicker wastes turns on shops and rests; hold it to the band at the median.
  const m = summaries.random.decisions.median;
  assert.ok(m >= 60 && m <= 140, `random median ${m}`);
});

test("cautious win rate is in the 35-75 percent band", () => {
  const c = summaries.cautious.winRate;
  assert.ok(c >= 0.35 && c <= 0.75, `cautious ${c}`);
  assert.ok(summaries.random.winRate < c);
});

test("the swamp route is a gamble, not a trap: 15-30 percent, clearly below the steamer", () => {
  const cheap = summaries.cheap.winRate;
  assert.ok(cheap >= 0.15 && cheap <= 0.3, `cheap ${cheap}`);
  assert.ok(cheap <= summaries.cautious.winRate - 0.2, `cheap ${cheap} vs cautious ${summaries.cautious.winRate}`);
  assert.ok(cheap < summaries.thrifty.winRate, "the swamp is worse than deck passage too");
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
