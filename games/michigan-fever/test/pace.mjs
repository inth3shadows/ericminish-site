// The pace trade-off (N-A2, user decision 2026-11-19): pushing grueling while
// the family and the team are under 40 (or 45) fatigue must not beat a steady
// pace. Seeded games on the sim's own seeds; one file per strategy so the two
// run side by side (pace-cautious.test.mjs, pace-thrifty.test.mjs).

import test from "node:test";
import assert from "node:assert/strict";
import { loadRouteFromDisk } from "./load.mjs";
import { PACE_POLICIES, simulate, summarize } from "./simulate.mjs";

export const PACE_GAMES = 400;
export const NOISE = 0.01; // about one point at 400 seeds

export function paceTradeOff(strategy) {
  const route = loadRouteFromDisk();
  test(`N-A2: ${strategy}: grueling while under 40 or 45 fatigue does not beat a steady pace`, () => {
    const rate = {};
    for (const [name, pace] of Object.entries(PACE_POLICIES)) {
      const s = summarize(simulate(route, strategy, PACE_GAMES, "sim", { pace }));
      rate[name] = s.winRate;
      console.log(`${strategy} ${name}: win ${(s.winRate * 100).toFixed(1)}%  deaths ${s.meanDeaths.toFixed(2)}  outcomes ${JSON.stringify(s.outcomes)}`);
    }
    for (const name of ["gruelingUnder40", "gruelingUnder45"]) {
      assert.ok(rate[name] <= rate.steady + NOISE, `${strategy} ${name} ${rate[name]} vs steady ${rate.steady}`);
    }
  });
}
