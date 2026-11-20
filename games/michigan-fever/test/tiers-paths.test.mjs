// P2 Phase B tier bands on the five paths (spec B1, B3): each path's careful player lands a
// full win in 15-50 percent of the games THAT TOOK THE PATH (a game that never reaches its
// pivot plays the main route and is left out; n per path is printed). The exception is the
// Chicago trap: holding the lot into the spring of 1837 never wins.

import test from "node:test";
import assert from "node:assert/strict";
import { decisionSpread, tierRow } from "./tiers.mjs";

const PATHS = { carefulDetroit: "detroit", carefulChicago: "chicago", carefulOhio: "ohio", carefulHome: "home", carefulKin: "kin" };
const rows = {};
console.log("\nTier table, the paths (over the games that took the path)");
for (const [name, path] of Object.entries(PATHS)) rows[name] = tierRow(name, 500, path);
rows.holdLot = tierRow("holdLot", 200, "chicago");

for (const [name, path] of Object.entries(PATHS)) {
  test(`${path} path (games that took it, n printed): careful tier 2 in 15-50 percent`, () => {
    const { t } = rows[name];
    console.log(`${path}: n=${t.games}, tier >=1 ${(t.t1 * 100).toFixed(1)}%, tier 2 ${(t.t2 * 100).toFixed(1)}%`);
    assert.ok(t.games >= 200, `${path}: only ${t.games} games took the path`);
    assert.ok(t.t2 >= 0.15 && t.t2 <= 0.5, `${path} tier 2 ${t.t2}`);
  });
}

test("chicago path (games that took it): holding the lot into 1837 is the trap: no full win", () => {
  const { t } = rows.holdLot;
  assert.ok(t.games >= 100);
  assert.equal(t.t2, 0, `holdLot tier 2 ${t.t2}`);
});

test("the paths (games that took them): median decisions in 70-180, except the kin path, which ends on arrival", () => {
  for (const [name, path] of Object.entries(PATHS)) {
    const d = decisionSpread(rows[name].results.filter((r) => r.path === path));
    console.log(`${path} decisions p5 ${d.p5} median ${d.median} p95 ${d.p95} (min ${d.min}, max ${d.max})`);
    if (path === "kin") continue; // reported, not met: see API.md "The paths"
    assert.ok(d.median >= 70 && d.median <= 180, `${path}: ${JSON.stringify(d)}`);
  }
});
