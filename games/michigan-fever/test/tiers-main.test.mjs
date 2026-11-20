// P2 Phase B tier bands on the main route (spec B1, B3). These REPLACE the P1 bands
// (see sim.test.mjs). Bands: careful tier 2 in 35-45 percent over 1,500 seeded games;
// careful tier 1 at least 90 percent (user decision 2026-11-20 "Hard at the end", which
// dropped the spec's 70-80 percent band); careless tier 2 at most 5 percent and tier 1 at
// most 75 percent; random (main route only) tier 2 about 0; 70-180 decisions a game.

import test from "node:test";
import assert from "node:assert/strict";
import { decisionSpread, tierRow } from "./tiers.mjs";

const rows = {};
console.log("\nTier table, main route (tier >=1 is arrived or better; tier 2 is the full win)");
for (const [name, n] of [["careful", 1500], ["careless", 500], ["randomMain", 500], ["sendsHome", 500]]) rows[name] = tierRow(name, n);
// For information only, not asserted (round 8): the careless tier-1 band (at most 75 percent)
// holds only through the swamp crawl. Careless with the deck passage, or at a steady pace,
// arrives far more often; the next reader should see how fragile that band is.
console.log("careless variants (printed, not asserted):");
for (const name of ["carelessDeck", "carelessSteady"]) tierRow(name, 200);

test("main route, careful: tier 2 (land, a roof before winter, no deaths) in 35-45 percent of 1,500 games", () => {
  const { t } = rows.careful;
  assert.ok(t.games >= 1500);
  assert.ok(t.t2 >= 0.35 && t.t2 <= 0.45, `careful tier 2 ${t.t2}`);
});

test("main route, careful: tier 1 (reach the land office as a household) at least 90 percent (hard at the end)", () => {
  const { t } = rows.careful;
  console.log(`careful tier >=1 measured: ${(t.t1 * 100).toFixed(1)}%`);
  assert.ok(t.t1 >= 0.9, `careful tier 1 ${t.t1}`);
});

test("main route, careless (grueling, cheapest everything): tier 2 at most 5 percent, tier 1 at most 75 percent", () => {
  const { t } = rows.careless;
  console.log(`careless tier >=1 measured: ${(t.t1 * 100).toFixed(1)}%, tier 2 ${(t.t2 * 100).toFixed(1)}%`);
  assert.ok(t.t2 <= 0.05, `careless tier 2 ${t.t2}`);
  assert.ok(t.t1 <= 0.75, `careless tier 1 ${t.t1}`);
});

test("main route, random (never pivots): tier 2 about 0 (at most 1 percent)", () => {
  assert.ok(rows.randomMain.t.t2 <= 0.01, `random tier 2 ${rows.randomMain.t.t2}`);
});

test("main route, sends money home: a full win costs more when the ties are paid (printed; no band in the spec)", () => {
  assert.ok(rows.sendsHome.t.t2 <= rows.careful.t.t2, `sendsHome ${rows.sendsHome.t.t2} vs careful ${rows.careful.t.t2}`);
});

test("main route: scripted games run 70-180 decisions (median, and 5th to 95th percentile); random at the median", () => {
  for (const name of ["careful", "careless", "sendsHome"]) {
    const d = decisionSpread(rows[name].results);
    console.log(`${name} decisions p5 ${d.p5} median ${d.median} p95 ${d.p95} (min ${d.min}, max ${d.max})`);
    assert.ok(d.p5 >= 70 && d.p95 <= 180, `${name}: ${JSON.stringify(d)}`);
  }
  const r = decisionSpread(rows.randomMain.results);
  assert.ok(r.median >= 70 && r.median <= 180, `random median ${r.median}`);
});
