// P2 Phase B, step 0: the two low findings left open by the Phase A review
// (.review/add-michigan-fever.md, round 7). Written before the fixes.

import test from "node:test";
import assert from "node:assert/strict";
import { availableActions, makeCtx, newGame, step } from "../../engine/engine.js";
import * as T from "../mechanics/travel.js";
import { createRoute } from "../route.js";
import { readData } from "./load.mjs";

function routeWith(changes) {
  const d = readData();
  d.numbers = d.numbers.map((n) => (n.id in changes ? { ...n, value: changes[n.id] } : n));
  return createRoute(d);
}
// No illness, no random events, no wet days: days move only by the rules under test.
const QUIET = Object.fromEntries(readData().numbers.filter((n) => /^(ague\.base\.|dys\.base|cholera\.base|ev\.p\.|wx\.rain\.)/.test(n.id)).map((n) => [n.id, 0]));
const calm = routeWith(QUIET);
const num = calm.num;

function started(seed) {
  const { state } = newGame(calm, { seed });
  return step(calm, state, { id: "start:vermont" }).state;
}

// ---- L1 ---------------------------------------------------------------------------

test("L1: no fresh yoke is sold at the claim, where no leg starts", () => {
  const s = started("l1");
  s.phase = "claim";
  s.place = "claim";
  s.leg = null;
  s.vars.terrain = null;
  s.vars.visit = { place: "claim", used: {}, since: s.day };
  s.land.paid = true;
  s.land.acres = 40;
  s.land.tract = { id: "t1", kind: "openings", poor: false, known: true, miles: 6 };
  s.flags.teamShort = true;
  s.purse = { coin: 50000, notes: { ne: 0, ny: 0, mi: 0 } };
  assert.ok(!availableActions(calm, s).some((a) => a.id === "buy-yoke"), "an $80 yoke that pulls nothing");
});

// ---- L2 ---------------------------------------------------------------------------

// A family on the Ohio road `left` miles short of Sandusky, at a pace.
function nearSandusky(left, pace, flags = {}) {
  const s = started("l2");
  const ctx = makeCtx(calm, s);
  T.startLeg(ctx, "overland");
  s.vars.segMi = num("mi.buffaloSandusky") - left;
  s.vars.legMi = s.vars.segMi;
  s.vars.pace = pace;
  s.res.food = 5000;
  s.purse = { coin: 50000, notes: { ne: 0, ny: 0, mi: 0 } };
  Object.assign(s.flags, flags);
  s.queue = [];
  return s;
}

// A full day's miles on one terrain, from a copy of the state.
function fullDay(s, terrain) {
  const c = structuredClone(s);
  c.vars.terrain = terrain;
  return T.dayMiles(makeCtx(calm, c), "fair");
}

test("L2: a day that crosses into the Black Swamp runs the rest of the day at the swamp's own pace", () => {
  const s = nearSandusky(3, "grueling");
  const road = fullDay(s, "road");
  const swamp = fullDay(s, "swamp");
  assert.ok(road > 3, "the day would carry past Sandusky");
  const r = step(calm, s, { id: "go", pace: "grueling" });
  const after = r.state;
  assert.equal(after.vars.seg, 1, "now in the swamp");
  assert.equal(after.vars.terrain, "swamp");
  const expect = (1 - 3 / road) * swamp;
  assert.ok(Math.abs(after.vars.segMi - expect) < 1e-6, `swamp miles ${after.vars.segMi} vs ${expect}`);
  // Before the fix the whole grueling day ran at the turnpike's pace: 29.9 of the swamp's 32 miles.
  assert.ok(after.vars.segMi < 9, "a grueling start does not carry across the swamp");
});

test("L2: tolls are charged on the swamp miles of a day that entered the swamp", () => {
  // A guide doubles the swamp pace, so the part of the day in the swamp passes a toll gate.
  const s = nearSandusky(1, "steady", { swampGuide: true });
  const road = fullDay(s, "road");
  const swamp = fullDay(s, "swamp");
  const swampMiles = (1 - 1 / road) * swamp;
  assert.ok(swampMiles >= num("toll.gapMiles"), `${swampMiles} swamp miles pass a gate`);
  const r = step(calm, s, "go");
  const toll = Math.round(num("price.toll") * 100);
  assert.ok(r.beats.some((b) => b.type === "narrate" && /toll gate/.test(b.text)), "a toll gate");
  assert.equal(r.state.purse.coin, 50000 - toll);
  assert.ok(Math.abs(r.state.vars.tollMi - (swampMiles - num("toll.gapMiles"))) < 1e-6);
});

test("L2: leaving the swamp, the rest of the day runs at the strip's pace, and only swamp miles pay tolls", () => {
  const s = nearSandusky(0, "steady");
  s.vars.seg = 1;
  s.vars.terrain = "swamp";
  s.vars.segMi = num("mi.sanduskyPerrysburg") - 2;
  s.vars.legMi = num("mi.buffaloSandusky") + s.vars.segMi;
  s.vars.tollMi = 8;
  const swamp = fullDay(s, "swamp");
  const strip = fullDay(s, "strip");
  assert.ok(swamp > 2);
  const after = step(calm, s, "go").state;
  assert.equal(after.vars.seg, 2);
  assert.ok(Math.abs(after.vars.segMi - (1 - 2 / swamp) * strip) < 1e-6);
  // 8 + 2 swamp miles passes one gate; the strip miles pay none.
  assert.ok(Math.abs(after.vars.tollMi - 1) < 1e-6, `toll miles ${after.vars.tollMi}`);
});

test("L2: a day within one segment is unchanged", () => {
  const s = nearSandusky(100, "hard");
  const road = fullDay(s, "road");
  const after = step(calm, s, { id: "go", pace: "hard" }).state;
  assert.ok(Math.abs(after.vars.segMi - (num("mi.buffaloSandusky") - 100 + road)) < 1e-6);
});
