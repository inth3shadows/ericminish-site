// Review F1 (round 3): the playback chain is journey-scoped (ui/journey.js).
// begin() during an old journey's playback must not let the old play() take
// the new journey's waiter after an awaited scene change resolves, and the old
// journey's beats (notes) must never reach the new one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Cancelled, createJourneys } from "../ui/journey.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Settles p, or fails the test if it is still pending after a few turns of the event loop.
async function soon(p, what) {
  let timer;
  const late = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${what}: still pending`)), 20); });
  try {
    return await Promise.race([p, late]);
  } finally {
    clearTimeout(timer);
  }
}

test("an old journey's play() resumes after a scene decode and cannot steal the new journey's waiter", async () => {
  const journeys = createJourneys();
  const notes = [];
  const old = journeys.begin();
  const decode = deferred();
  // The old play(): a scene beat (await img.decode), then a note beat, then a narrate beat.
  const oldPlay = (async () => {
    await old.settle(decode.promise);
    old.check();
    notes.push("old note");
    await old.wait();
    notes.push("old after say");
  })();
  const neu = journeys.begin();
  let introDone = false;
  const intro = (async () => {
    await neu.wait(); // the new journey's first say()
    introDone = true;
  })();
  decode.resolve(); // the old decode resolves after begin()
  await assert.rejects(soon(oldPlay, "old play"), Cancelled);
  assert.equal(journeys.waiting(), true, "the new intro is still waiting for the player");
  assert.equal(journeys.advance(), true);
  await soon(intro, "new intro");
  assert.equal(introDone, true);
  assert.deepEqual(notes, [], "no old beat ran after begin()");
});

test("an old journey's waits settle as cancelled, at once, when a new journey begins", async () => {
  const journeys = createJourneys();
  const old = journeys.begin();
  const said = old.wait();
  const decoding = old.settle(new Promise(() => {})); // a decode that never finishes
  journeys.begin();
  await assert.rejects(soon(said, "old say"), Cancelled);
  await assert.rejects(soon(decoding, "old decode"), Cancelled);
  assert.equal(old.live, false);
  assert.throws(() => old.check(), Cancelled);
  await assert.rejects(soon(old.wait(), "a wait started after cancel"), Cancelled);
});

test("advance ignores a resolver that belongs to an old journey", async () => {
  const journeys = createJourneys();
  const old = journeys.begin();
  const said = old.wait().then(() => "resolved", (e) => e);
  const neu = journeys.begin();
  assert.equal(journeys.waiting(), false, "the new journey is not waiting yet");
  assert.equal(journeys.advance(), false, "nothing of the new journey's to resolve");
  assert.equal(old.advance(), false, "the old journey's own resolver is dead");
  assert.ok((await soon(said, "old say")) instanceof Cancelled);
  const p = neu.wait();
  assert.equal(journeys.advance(), true);
  await soon(p, "new say");
});

test("a live journey's settle passes values and real errors through", async () => {
  const journeys = createJourneys();
  const j = journeys.begin();
  assert.equal(await j.settle(Promise.resolve(7)), 7);
  await assert.rejects(j.settle(Promise.reject(new TypeError("boom"))), TypeError);
  assert.equal(j.live, true);
  j.check();
});
