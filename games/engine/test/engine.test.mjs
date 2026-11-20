import test from "node:test";
import assert from "node:assert/strict";
import { availableActions, newGame, step, view } from "../engine.js";
import { isPlainJSON } from "../state.js";
import { toyRoute } from "./toy-route.mjs";

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
}

function play(route, seed, pick) {
  let { state } = newGame(route, { seed });
  const log = [];
  for (let i = 0; i < 50 && !state.over; i++) {
    const acts = availableActions(route, state).filter((a) => a.enabled);
    const a = pick(acts, i);
    const r = step(route, state, a);
    log.push(...r.beats);
    state = r.state;
  }
  return { state, log };
}

test("a differently shaped route (boats, rapids, market) runs on the unchanged engine", () => {
  const route = toyRoute();
  const { state, log } = play(route, "convoy", (acts) => acts.find((a) => a.id === "portage") ?? acts.find((a) => a.id === "post") ?? acts.find((a) => a.id === "sail") ?? acts[0]);
  assert.ok(state.over, "game ended");
  assert.equal(state.over.outcome, "home");
  assert.equal(state.date.slice(0, 4), "0950");
  assert.ok(log.some((b) => b.type === "end" && b.boats === 3));
});

test("same seed and same choices replay identically", () => {
  const pick = (acts, i) => acts[i % acts.length];
  const a = play(toyRoute(), "replay", pick);
  const b = play(toyRoute(), "replay", pick);
  assert.deepEqual(a.state, b.state);
  assert.deepEqual(a.log, b.log);
});

test("step and availableActions never mutate their input", () => {
  const route = toyRoute();
  const { state } = newGame(route, { seed: "pure" });
  const frozen = deepFreeze(structuredClone(state));
  const before = JSON.stringify(frozen);
  availableActions(route, frozen);
  const r = step(route, frozen, "wade");
  assert.equal(JSON.stringify(frozen), before);
  assert.notEqual(r.state, frozen);
  assert.equal(r.state.decisions, 1);
});

test("an action not on offer returns an error beat and the same state", () => {
  const route = toyRoute();
  const { state } = newGame(route, { seed: "bad" });
  const r = step(route, state, { id: "fly" });
  assert.equal(r.state, state);
  assert.equal(r.beats[0].type, "error");
  const disabled = step(route, { ...state, phase: "market", res: { silk: 50 } }, "buy-silk");
  assert.equal(disabled.beats[0].type, "error");
});

test("pending events turn the action list into the event's choices", () => {
  const route = toyRoute();
  let { state } = newGame(route, { seed: "pending" });
  for (let i = 0; i < 20 && !state.pending && !state.over; i++) state = step(route, state, "wade").state;
  assert.ok(state.pending, "a rapid event fired");
  const acts = availableActions(route, state);
  assert.ok(acts.every((a) => a.type === "choose"));
  assert.deepEqual(acts.map((a) => a.choice), ["post", "row"]);
});

test("state stays plain JSON after play", () => {
  const { state } = play(toyRoute(), "json", (acts, i) => acts[i % acts.length]);
  assert.ok(isPlainJSON(state));
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
  assert.deepEqual(view(toyRoute(), state), {});
});

test("ended games offer nothing", () => {
  const { state } = play(toyRoute(), "over", (acts) => acts.find((a) => a.id === "portage") ?? acts.find((a) => a.id === "sail") ?? acts[0]);
  assert.ok(state.over);
  assert.deepEqual(availableActions(toyRoute(), state), []);
});
