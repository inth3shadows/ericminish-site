// "Drive on" (ui/driveon.js) loops step() over routine travel days. These tests
// play seeded games and use it wherever it is offered, checking that it never
// runs past a beat that needs the player and that it gives exactly the state
// that pressing "go" the same number of times gives.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as engine from "../../engine/engine.js";
import { canDriveOn, driveOn, MAX_DAYS, LOW_FOOD_DAYS, WEAK } from "../ui/driveon.js";
import { loadRouteFromDisk } from "./load.mjs";
import { STRATEGIES } from "./strategies.mjs";
import { createRng, cursor } from "../../engine/rng.js";

const route = loadRouteFromDisk();
const NEEDS_INPUT = new Set(["event", "choice", "arrive", "death", "letter", "note", "end", "error", "scene"]);
const CUES = new Set(["illness", "broken", "grief", "conflict", "ready"]);

function needsInput(beats) {
  return beats.some((b) => NEEDS_INPUT.has(b.type) || (b.type === "narrate" && CUES.has(b.cue)) || (b.type === "weather" && b.first));
}

function play(seed, seedIndex, strategy, onDrive) {
  const rng = cursor(createRng(`player-${seed}`));
  let { state } = engine.newGame(route, { seed });
  for (let n = 0; n < 800 && !state.over; n++) {
    if (canDriveOn(engine, route, state).ok && n % 2 === 0) {
      const r = driveOn(engine, route, state);
      onDrive(state, r);
      state = r.state;
      continue;
    }
    const acts = engine.availableActions(route, state);
    state = engine.step(route, state, STRATEGIES[strategy](route, state, acts, { seedIndex, rng })).state;
  }
  return state;
}

test("drive on never passes a beat that needs the player, and matches pressing go", () => {
  let drives = 0;
  let days = 0;
  let multi = 0;
  const reasons = {};
  for (const strategy of ["cautious", "cheap"]) {
    for (let i = 0; i < 60; i++) {
      const end = play(`drive-${strategy}-${i}`, i, strategy, (start, r) => {
        drives += 1;
        days += r.days.length;
        if (r.days.length > 1) multi += 1;
        reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
        assert.ok(r.days.length >= 1 && r.days.length <= MAX_DAYS);
        r.days.forEach((d, k) => {
          const last = k === r.days.length - 1;
          if (!last) {
            assert.equal(needsInput(d.beats), false, `day ${k + 1} of ${r.days.length} had a beat needing input`);
            assert.equal(d.state.pending, null);
            assert.equal(Boolean(d.state.over), false);
            // F4: low food only stops a drive when the passage doesn't feed the family.
            assert.ok(d.view.food.days > LOW_FOOD_DAYS || d.view.food.meals);
            assert.ok(!d.view.party.some((p) => p.status === "sick" && p.health < WEAK));
          }
        });
        // An event that stopped the drive is in the last day's beats, so the UI shows it.
        if (r.state.pending) assert.ok(r.days.at(-1).beats.some((b) => b.type === "event"));
        // Same as pressing "go" day by day.
        let s = start;
        for (let k = 0; k < r.days.length; k++) s = engine.step(route, s, "go").state;
        assert.equal(JSON.stringify(s), JSON.stringify(r.state));
      });
      assert.ok(end.over, "every game still ends");
    }
  }
  console.log(`drive-ons: ${drives}, days: ${days}, multi-day: ${multi}, mean ${(days / drives).toFixed(2)} days`, reasons);
  assert.ok(drives > 100 && multi > 20, "drive on is offered and covers more than one day");
});

test("drive on is refused when the food is nearly gone or someone is very ill", () => {
  let checked = 0;
  for (let i = 0; i < 40; i++) {
    const rng = cursor(createRng(`r-${i}`));
    let { state } = engine.newGame(route, { seed: `refuse-${i}` });
    for (let n = 0; n < 800 && !state.over; n++) {
      const v = engine.view(route, state);
      const goOk = engine.availableActions(route, state).some((a) => a.id === "go" && a.enabled !== false);
      if (state.phase === "travel" && !state.pending && goOk && (v.food.days <= LOW_FOOD_DAYS || v.party.some((p) => p.status === "sick" && p.health < WEAK))) {
        assert.equal(canDriveOn(engine, route, state).ok, false);
        checked += 1;
      }
      const acts = engine.availableActions(route, state);
      state = engine.step(route, state, STRATEGIES.random(route, state, acts, { seedIndex: i, rng })).state;
    }
  }
  assert.ok(checked > 0, "the random player reaches a hazard at least once");
});
