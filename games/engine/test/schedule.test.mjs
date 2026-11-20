// The "schedule" effect (P2 A2): an event queued to fire later, after a number
// of days or on reaching a place, unless a condition holds by then. The queue
// lives in state; a due event fires ahead of the random draw.

import test from "node:test";
import assert from "node:assert/strict";
import { makeCtx, newGame, step } from "../engine.js";
import { createState, isPlainJSON } from "../state.js";
import { applyEffects, validateDeck } from "../events.js";
import { deserialize, serialize } from "../save.js";

function fixture(extra = {}) {
  const numbers = { "w.big": 1000, "w.one": 1, "in.three": 3 };
  const route = {
    id: "fixture", version: 1,
    num: (id) => { if (!(id in numbers)) throw new Error(`unknown number: ${id}`); return numbers[id]; },
    events: [
      { id: "common", deck: "road", weight: "#w.big", text: "A common thing.", note: { text: "n", source: "s", url: null, confidence: "invented" } },
      { id: "later", deck: "chain", text: "The consequence.", effects: [{ flag: "laterFired" }], note: { text: "n", source: "s", url: null, confidence: "invented" } },
      { id: "onFoot", deck: "chain", when: { flag: "walking" }, text: "Only on foot.", note: { text: "n", source: "s", url: null, confidence: "invented" } },
      { id: "askMe", deck: "chain", text: "Choose.", choices: [{ id: "a", label: "A" }], note: { text: "n", source: "s", url: null, confidence: "invented" } },
    ],
    places: ["albany", "detroit"],
    checkEnd: () => null,
    ...extra,
  };
  const state = createState({ routeId: "fixture", routeVersion: 1, seed: "s", date: "1836-10-01" });
  state.place = "albany";
  return { route, state, ctx: makeCtx(route, state) };
}

const ids = (beats) => beats.filter((b) => b.type === "event").map((b) => b.id);

test("schedule: a new state has an empty queue, and the effect adds to it", () => {
  const { ctx, state } = fixture();
  assert.deepEqual(state.queue, []);
  applyEffects([{ schedule: { event: "later", in: "#in.three" } }], ctx);
  assert.deepEqual(state.queue, [{ event: "later", due: 3 }]);
  applyEffects([{ schedule: { event: "later", in: 5 } }], ctx);
  assert.equal(state.queue.length, 1, "the same event is not queued twice");
  applyEffects([{ schedule: { event: "askMe", in: { at: "detroit" }, unless: { flag: "paid" } } }], ctx);
  assert.deepEqual(state.queue[1], { event: "askMe", at: "detroit", unless: { flag: "paid" } });
  assert.ok(isPlainJSON(state));
});

test("schedule: a due event fires ahead of the random draw, and not before it is due", () => {
  const { ctx, state } = fixture();
  applyEffects([{ schedule: { event: "later", in: "#in.three" } }], ctx);
  state.day = 2;
  assert.equal(ctx.drawEvent("road"), true);
  assert.deepEqual(ids(ctx.beats), ["common"], "not due yet: the deck draws as usual");
  assert.equal(state.queue.length, 1);
  ctx.beats.length = 0;
  state.day = 3;
  assert.equal(ctx.fireDue(), true);
  assert.deepEqual(ids(ctx.beats), ["later"]);
  assert.equal(state.flags.laterFired, true);
  assert.deepEqual(state.queue, []);
  assert.equal(ctx.fireDue(), false, "nothing left to fire");
  // Through drawEvent too: a due item comes first. It does not take the day's
  // draw away: with no choice open, the deck still draws after it.
  applyEffects([{ schedule: { event: "later", in: 0 } }], ctx);
  ctx.beats.length = 0;
  ctx.drawEvent("road");
  assert.deepEqual(ids(ctx.beats), ["later", "common"]);
});

test("schedule: {at: place} fires only once the family is at that place", () => {
  const { ctx, state, route } = fixture({ atPlace: (s) => (s.phase === "travel" ? null : s.place) });
  applyEffects([{ schedule: { event: "later", in: { at: "detroit" } } }], ctx);
  state.day = 40;
  assert.equal(ctx.fireDue(), false);
  state.place = "detroit";
  state.phase = "travel";
  assert.equal(ctx.fireDue(), false, "passing on the road is not being there");
  state.phase = "town";
  assert.equal(ctx.fireDue(), true);
  assert.ok(route);
});

test("schedule: 'unless' drops the item; an event whose 'when' fails waits in the queue", () => {
  const { ctx, state } = fixture();
  applyEffects([{ schedule: { event: "later", in: 0, unless: { flag: "mended" } } }, { schedule: { event: "onFoot", in: 0 } }], ctx);
  state.flags.mended = true;
  assert.equal(ctx.fireDue(), false);
  assert.deepEqual(state.queue.map((q) => q.event), ["onFoot"], "dropped 'later', kept 'onFoot'");
  state.flags.walking = true;
  assert.equal(ctx.fireDue(), true);
  assert.deepEqual(ids(ctx.beats), ["onFoot"]);
});

test("schedule: a due event with choices opens them, and nothing fires while one is open", () => {
  const { ctx, state } = fixture();
  applyEffects([{ schedule: { event: "askMe", in: 0 } }, { schedule: { event: "later", in: 0 } }], ctx);
  assert.equal(ctx.fireDue(), true);
  assert.equal(state.pending?.id, "askMe");
  assert.equal(ctx.fireDue(), false);
  assert.equal(ctx.drawEvent("road"), false);
  assert.deepEqual(state.queue.map((q) => q.event), ["later"]);
});

test("validateDeck checks scheduled events: the id exists, 'in' is days or {at}, and 'unless' is a known condition", () => {
  const { route } = fixture();
  assert.deepEqual(validateDeck(route), []);
  route.events.push({
    id: "bad", deck: "chain", text: "x", note: { text: "n", source: "s", url: null, confidence: "invented" },
    choices: [
      { id: "a", label: "A", effects: [{ schedule: { event: "nope", in: 2 } }] },
      { id: "b", label: "B", effects: [{ schedule: { event: "later", in: "soon" } }] },
      { id: "c", label: "C", effects: [{ schedule: { event: "later", in: { at: "chicago" } } }] },
      { id: "d", label: "D", effects: [{ schedule: { event: "later", in: 2, unless: { whatever: 1 } } }] },
      { id: "e", label: "E", effects: [{ if: { flag: "x" }, then: [{ schedule: { event: "missing", in: "#in.three" } }] }] },
    ],
  });
  const errs = validateDeck(route).join("\n");
  assert.match(errs, /bad\.a: schedule: unknown event nope/);
  assert.match(errs, /bad\.b: schedule: "in" must be days or \{at: place\}/);
  assert.match(errs, /bad\.c: schedule: unknown place chicago/);
  assert.match(errs, /bad\.d: unknown condition whatever/);
  assert.match(errs, /bad\.e: schedule: unknown event missing/);
});

// A route that schedules, then steps on: same seed, same game; the queue survives a save.
function chainRoute() {
  const { route } = fixture();
  return {
    ...route,
    startDate: () => "1836-10-01",
    init(ctx) { ctx.state.phase = "road"; },
    actions: () => [{ id: "plan", type: "x", label: "Plan" }, { id: "walk", type: "x", label: "Walk" }],
    act(ctx, a) {
      if (a.id === "plan") ctx.applyEffects([{ schedule: { event: "later", in: 2 } }]);
      else { ctx.advanceDays(1); ctx.drawEvent("road"); }
    },
  };
}

test("schedule: deterministic, and a saved queue resumes identically", () => {
  const route = chainRoute();
  const run = (s, moves) => { const beats = []; for (const m of moves) { const r = step(route, s, m); s = r.state; beats.push(...r.beats); } return { s, beats }; };
  const start = newGame(route, { seed: "q" }).state;
  const a = run(start, ["plan", "walk"]);
  assert.deepEqual(a.s.queue, [{ event: "later", due: 2 }]);
  const loaded = deserialize(route, serialize(a.s));
  assert.equal(loaded.ok, true);
  const b = run(loaded.state, ["walk", "walk"]);
  const c = run(a.s, ["walk", "walk"]);
  assert.deepEqual(b, c);
  assert.ok(c.beats.some((x) => x.type === "event" && x.id === "later"));
  assert.deepEqual(c.s.queue, []);
  const damaged = JSON.parse(serialize(a.s));
  damaged.state.queue = "soon";
  assert.equal(deserialize(route, JSON.stringify(damaged)).reason, "damaged");
});
