import test from "node:test";
import assert from "node:assert/strict";
import { newGame, step } from "../engine.js";
import { clearSave, defaultStorage, deserialize, hasSave, loadGame, saveGame, serialize } from "../save.js";
import { toyRoute } from "./toy-route.mjs";

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); }, removeItem() { throw new Error("denied"); } };

test("round trip through storage, both slots", () => {
  const route = toyRoute();
  const storage = memoryStorage();
  const { state } = newGame(route, { seed: "save" });
  const s2 = step(route, state, "wade").state;
  assert.equal(saveGame(s2, { slot: "main", storage }), true);
  assert.equal(saveGame(state, { slot: "auto", storage }), true);
  assert.deepEqual(loadGame(route, { slot: "main", storage }), { ok: true, state: s2 });
  assert.deepEqual(loadGame(route, { slot: "auto", storage }).state, state);
  assert.equal(hasSave(route.id, { slot: "main", storage }), true);
  clearSave(route.id, { slot: "main", storage });
  assert.deepEqual(loadGame(route, { slot: "main", storage }), { ok: false, reason: "empty" });
  assert.throws(() => saveGame(state, { slot: "third", storage }));
});

test("a resumed save plays on exactly as the unbroken game", () => {
  const route = toyRoute();
  const storage = memoryStorage();
  let { state } = newGame(route, { seed: "resume" });
  const moves = ["wade", "wade", "portage", "wade", "wade"];
  const run = (s, ms) => ms.reduce((st, m) => {
    const a = st.pending ? `choose:post` : m;
    const r = step(route, st, a);
    return r.beats[0]?.type === "error" ? st : r.state;
  }, s);
  const mid = run(state, moves.slice(0, 2));
  saveGame(mid, { storage });
  const straight = run(mid, moves.slice(2));
  const resumed = run(loadGame(route, { storage }).state, moves.slice(2));
  assert.deepEqual(resumed, straight);
});

test("storage that is missing or throws never throws back", () => {
  const route = toyRoute();
  const { state } = newGame(route, { seed: "x" });
  assert.equal(saveGame(state, { storage: null }), false);
  assert.equal(saveGame(state, { storage: throwing }), false);
  assert.deepEqual(loadGame(route, { storage: throwing }), { ok: false, reason: "no storage" });
  assert.deepEqual(loadGame(route, { storage: null }), { ok: false, reason: "no storage" });
  assert.equal(hasSave(route.id, { storage: throwing }), false);
  assert.equal(clearSave(route.id, { storage: throwing }), false);
  assert.doesNotThrow(() => defaultStorage()); // null in Node without a localStorage file
});

test("version checks: route, engine schema, route version and migration", () => {
  const route = toyRoute();
  const { state } = newGame(route, { seed: "v" });
  const text = serialize(state);
  assert.equal(deserialize({ ...route, id: "other" }, text).reason, "different route");
  assert.equal(deserialize(route, "{not json").reason, "unreadable");
  assert.equal(deserialize(route, JSON.stringify({ format: 99 })).reason, "unknown format");
  const old = JSON.parse(text);
  old.schemaVersion = 0;
  assert.equal(deserialize(route, JSON.stringify(old)).reason, "old engine version");
  assert.equal(deserialize({ ...route, version: 2 }, text).reason, "old route version");
  const migrated = deserialize({ ...route, version: 2, migrate: (s, from) => ({ ...s, routeVersion: 2, migratedFrom: from }) }, text);
  assert.equal(migrated.ok, true);
  assert.equal(migrated.state.migratedFrom, 1);
});
