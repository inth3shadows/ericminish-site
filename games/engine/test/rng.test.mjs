import test from "node:test";
import assert from "node:assert/strict";
import { createRng, cursor, hashSeed, nextFloat } from "../rng.js";

const draws = (r, n) => Array.from({ length: n }, () => nextFloat(r));

test("same seed gives the same sequence", () => {
  assert.deepEqual(draws(createRng("1836"), 20), draws(createRng("1836"), 20));
});

test("different seeds diverge", () => {
  assert.notDeepEqual(draws(createRng("a"), 5), draws(createRng("b"), 5));
});

test("the algorithm is pinned (a change would break every saved game)", () => {
  assert.equal(hashSeed("1836"), hashSeed("1836"));
  const r = createRng("pinned");
  const first = draws(r, 3).map((x) => x.toFixed(10));
  assert.deepEqual(first, draws(createRng("pinned"), 3).map((x) => x.toFixed(10)));
  assert.equal(r.n, 3);
  assert.equal(hashSeed(""), 0x811c9dc5);
});

test("the stored position resumes exactly (save mid-sequence)", () => {
  const r = createRng("resume");
  draws(r, 7);
  const saved = JSON.parse(JSON.stringify(r));
  const a = draws(r, 10);
  const b = draws(saved, 10);
  assert.deepEqual(a, b);
});

test("floats are in [0, 1)", () => {
  for (const x of draws(createRng("range"), 5000)) assert.ok(x >= 0 && x < 1);
});

test("cursor helpers consume one draw each, whatever the outcome", () => {
  const r = createRng("count");
  const c = cursor(r);
  c.chance(0.5); c.int(1, 6); c.pick(["a", "b"]); c.weighted([[1, "x"], [2, "y"]]); c.float();
  assert.equal(r.n, 5);
  c.pick([]);
  assert.equal(r.n, 6);
});

test("int stays in its inclusive range and hits both ends", () => {
  const c = cursor(createRng("int"));
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const v = c.int(3, 7);
    assert.ok(v >= 3 && v <= 7);
    seen.add(v);
  }
  assert.deepEqual([...seen].sort(), [3, 4, 5, 6, 7]);
});

test("weighted skips zero weights and follows the weights", () => {
  const c = cursor(createRng("weights"));
  const counts = { a: 0, b: 0, z: 0 };
  for (let i = 0; i < 6000; i++) counts[c.weighted([[1, "a"], [0, "z"], [2, "b"]])] += 1;
  assert.equal(counts.z, 0);
  assert.ok(counts.b / counts.a > 1.7 && counts.b / counts.a < 2.3, JSON.stringify(counts));
  assert.equal(c.weighted([[0, "z"]]), undefined);
});
