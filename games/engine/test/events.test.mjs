import test from "node:test";
import assert from "node:assert/strict";
import { makeCtx } from "../engine.js";
import { createState } from "../state.js";
import { applyEffects, drawEvent, evalCond, resolve, resolveChoice, startEvent, validateDeck, weightOf } from "../events.js";

function fixture(overrides = {}) {
  const numbers = { "w.a": 1, "w.b": 3, "amt": 5, "cd": 3, "p.half": 0.5, "big": 2 };
  const days = [];
  const route = {
    id: "fixture", version: 1,
    num: (id) => { if (!(id in numbers)) throw new Error(`unknown number: ${id}`); return numbers[id]; },
    limits: { morale: [0, 100] },
    events: [],
    onDay: (ctx) => days.push(ctx.state.date),
    checkEnd: () => null,
    conditions: { tall: (arg, ctx) => (ctx.state.vars.height ?? 0) > arg },
    effects: { grow: (n, ctx, vars) => { ctx.state.vars.height = (ctx.state.vars.height ?? 0) + resolve(n, ctx, vars); } },
    binders: { someone: (spec, ctx) => (ctx.state.vars.people?.length ? ctx.rng.pick(ctx.state.vars.people) : null) },
    textVar: (name, value, prop) => (prop === "up" ? String(value).toUpperCase() : undefined),
    textVars: () => ({ place: "Albany" }),
    ...overrides,
  };
  const state = createState({ routeId: "fixture", routeVersion: 1, seed: "s", date: "1836-10-01" });
  state.leg = "canal";
  state.place = "albany";
  state.phase = "travel";
  state.res = { food: 10, morale: 50 };
  return { route, state, ctx: makeCtx(route, state), days };
}

test("core conditions", () => {
  const { ctx, state } = fixture();
  state.flags.lowBridgeSeen = true;
  assert.equal(evalCond({ all: [{ leg: "canal" }, { month: [9, 10] }, { flag: "lowBridgeSeen" }] }, ctx), true);
  assert.equal(evalCond({ flag: "!lowBridgeSeen" }, ctx), false);
  assert.equal(evalCond({ any: [{ leg: "lake" }, { place: "albany" }] }, ctx), true);
  assert.equal(evalCond({ not: { phase: "travel" } }, ctx), false);
  assert.equal(evalCond({ res: ["food", "<", "#amt"] }, ctx), false);
  assert.equal(evalCond({ res: ["food", ">=", 10] }, ctx), true);
  assert.equal(evalCond({ cmp: ["res.morale", "==", 50] }, ctx), true);
  assert.equal(evalCond({ before: "1836-12-15" }, ctx), true);
  assert.equal(evalCond({ onOrAfter: "1836-12-15" }, ctx), false);
  assert.equal(evalCond({ season: "autumn" }, ctx), true);
  assert.equal(evalCond({ dow: 6 }, ctx), true); // 1 Oct 1836 was a Saturday
  assert.equal(evalCond({ seen: "nope" }, ctx), false);
  assert.equal(evalCond({ bound: "who" }, ctx, { who: "p1" }), true);
  assert.equal(evalCond(null, ctx), true);
  assert.equal(evalCond([{ leg: "canal" }, { leg: "lake" }], ctx), false);
});

test("route conditions plug in; unknown ones throw", () => {
  const { ctx, state } = fixture();
  state.vars.height = 4;
  assert.equal(evalCond({ tall: 3 }, ctx), true);
  assert.throws(() => evalCond({ nonsense: 1 }, ctx), /unknown condition/);
  assert.throws(() => evalCond({ leg: "canal", month: 9 }, ctx), /exactly one key/);
});

test("values: #numbers and $variables", () => {
  const { ctx } = fixture();
  assert.equal(resolve("#amt", ctx), 5);
  assert.equal(resolve("$who", ctx, { who: "p2" }), "p2");
  assert.equal(resolve(7, ctx), 7);
  assert.throws(() => resolve("#missing", ctx));
});

test("core effects: add with limits, set, flags, narrate", () => {
  const { ctx, state } = fixture();
  applyEffects([{ add: ["food", -3] }, { add: ["morale", 80] }, { set: ["water", 2] }, { flag: "seen" }, { narrate: "At {place}, {who.up}." }], ctx, { who: "eli" });
  assert.equal(state.res.food, 7);
  assert.equal(state.res.morale, 100);
  assert.equal(state.res.water, 2);
  assert.equal(state.flags.seen, true);
  applyEffects([{ flag: "!seen" }, { add: ["food", -100] }], ctx);
  assert.equal(state.flags.seen, undefined);
  assert.equal(state.res.food, 0);
  assert.equal(ctx.beats.find((b) => b.type === "narrate").text, "At Albany, ELI.");
});

test("branching effects and days", () => {
  const { ctx, state, days } = fixture();
  applyEffects([{ if: { leg: "canal" }, then: [{ grow: "#big" }], else: [{ grow: 100 }] }], ctx);
  assert.equal(state.vars.height, 2);
  applyEffects([{ days: 2 }], ctx);
  assert.deepEqual(days, ["1836-10-02", "1836-10-03"]);
  assert.equal(state.day, 2);
  // chance is seeded: the same seed takes the same branch
  const a = fixture(); const b = fixture();
  applyEffects([{ chance: "#p.half", then: [{ grow: 1 }], else: [{ grow: -1 }] }], a.ctx);
  applyEffects([{ chance: "#p.half", then: [{ grow: 1 }], else: [{ grow: -1 }] }], b.ctx);
  assert.equal(a.state.vars.height, b.state.vars.height);
  assert.throws(() => applyEffects([{ explode: 1 }], ctx), /unknown effect/);
});

function deckFixture() {
  const f = fixture();
  f.route.events = [
    { id: "a", deck: "d", weight: "#w.a", once: true, text: "A", choices: [{ id: "x", label: "X", effects: [{ add: ["food", 1] }] }], note: { text: "n", source: "s", url: null, confidence: "invented" } },
    { id: "b", deck: "d", weight: { base: "#w.b", mul: [[{ leg: "lake" }, 0]] }, cooldown: "#cd", text: "B {who}",
      bind: { who: { someone: true } },
      choices: [
        { id: "safe", label: "Safe", effects: [], result: "ok" },
        { id: "risky", label: "Risky {who}", requires: { res: ["food", ">", 50] }, why: "Not enough food", effects: [] },
        { id: "chain", label: "Chain", effects: [], next: "a" },
      ],
      note: { text: "nb", source: "s", url: "https://example.org", confidence: "solid" } },
    { id: "other", deck: "elsewhere", text: "O", effects: [{ add: ["food", 5] }] },
  ];
  return f;
}

test("draw: weights, binding, pending choice, disabled choices carry a reason", () => {
  const f = deckFixture();
  f.state.vars.people = ["ann"];
  let started = 0;
  for (let i = 0; i < 40 && started < 1; i++) if (drawEvent(f.ctx, "d")) started++;
  assert.equal(started, 1);
  assert.ok(f.state.pending);
  const choice = f.ctx.beats.find((b) => b.type === "choice");
  if (f.state.pending.id === "b") {
    assert.equal(f.state.pending.vars.who, "ann");
    const risky = choice.choices.find((c) => c.id === "risky");
    assert.equal(risky.enabled, false);
    assert.equal(risky.reason, "Not enough food");
  }
});

test("binding failure skips the event; mul can zero a weight", () => {
  const f = deckFixture();
  f.state.vars.people = [];
  f.state.events.seen.a = 1; // a is once-only and already seen
  assert.equal(drawEvent(f.ctx, "d"), false);
  const g = deckFixture();
  g.state.vars.people = ["ann"];
  g.state.leg = "lake";
  g.state.events.seen.a = 1;
  assert.equal(drawEvent(g.ctx, "d"), false);
});

test("resolving a choice applies effects, narrates, notes, then chains", () => {
  const f = deckFixture();
  f.state.vars.people = ["ann"];
  startEvent(f.ctx, "b", { who: "ann" });
  resolveChoice(f.ctx, "chain");
  const types = f.ctx.beats.map((b) => b.type);
  assert.deepEqual(types, ["event", "choice", "narrate", "note", "event", "choice"]);
  assert.equal(f.state.pending.id, "a");
  resolveChoice(f.ctx, "x");
  assert.equal(f.state.res.food, 11);
  assert.equal(f.state.pending, null);
});

test("an event with no choices applies its effects at once", () => {
  const f = deckFixture();
  startEvent(f.ctx, "other");
  assert.equal(f.state.res.food, 15);
  assert.equal(f.state.pending, null);
});

test("cooldowns and once-only", () => {
  const f = deckFixture();
  f.state.vars.people = ["ann"];
  f.state.events.seen.a = 1;
  startEvent(f.ctx, "b", { who: "ann" });
  f.state.pending = null;
  assert.equal(drawEvent(f.ctx, "d"), false, "b is cooling down");
  f.state.day += 3;
  assert.equal(drawEvent(f.ctx, "d"), true);
});

test("validateDeck catches bad data", () => {
  const f = deckFixture();
  assert.deepEqual(validateDeck(f.route), []);
  f.route.events.push(
    { id: "bad", deck: "d", text: "t", when: { wat: 1 }, choices: [{ id: "only", label: "L", requires: { leg: "x" }, effects: [{ zap: 1 }], next: "ghost" }], weight: "#nope" },
    { id: "bad", deck: "d", text: "t" },
  );
  const errs = validateDeck(f.route).join("\n");
  for (const needle of ["unknown condition wat", "unknown effect zap", "unknown next ghost", "possible dead end", "unknown number #nope", "duplicate id"]) {
    assert.match(errs, new RegExp(needle));
  }
});

// Review F11: the conditions inside a weight's mul list are route vocabulary too.
test("validateDeck checks the conditions in weight.mul", () => {
  const f = deckFixture();
  f.route.events.push({ id: "mulbad", deck: "d", text: "t", weight: { base: 1, mul: [[{ wat: 1 }, 2], [{ all: [{ leg: "x" }, { zork: 2 }] }, 3]] }, effects: [] });
  const errs = validateDeck(f.route).join("\n");
  assert.match(errs, /event mulbad: unknown condition wat/);
  assert.match(errs, /event mulbad: unknown condition zork/);
});

// Review F2: an event that spends days lets the route set each day's conditions
// first ("as" names the kind of day), so a stale day from the last action is not reused.
test("days with a route eventDay hook: the hook runs before each day, with the kind", () => {
  const seen = [];
  const { ctx, state, days } = fixture({ eventDay: (c, as) => { seen.push([as, c.state.date]); c.state.vars.today = as; } });
  applyEffects([{ days: 2, as: "rest" }], ctx);
  assert.deepEqual(seen, [["rest", "1836-10-01"], ["rest", "1836-10-02"]]);
  assert.deepEqual(days, ["1836-10-02", "1836-10-03"]);
  assert.equal(state.vars.today, "rest");
  const f = deckFixture();
  f.route.events.push({ id: "spend", deck: "d", text: "t", choices: [{ id: "c", label: "C", effects: [{ days: 1, as: "rest" }] }] });
  assert.deepEqual(validateDeck(f.route), []);
});

// Review N1: with a route eventDay hook, a "days" effect needs an "as" the route
// knows (route.eventDayKinds), and "as" anywhere else is a mistake in the data.
test("validateDeck: days need a known 'as' when the route has an eventDay hook; 'as' elsewhere is an error", () => {
  const f = deckFixture();
  f.route.eventDay = () => {};
  f.route.eventDayKinds = ["rest", "halt"];
  const choice = (id, effects) => ({ id, label: id, effects });
  f.route.events.push({
    id: "kinds", deck: "d", text: "t",
    choices: [
      choice("none", [{ days: 1 }]),
      choice("typo", [{ days: 1, as: "resst" }]),
      choice("stray", [{ narrate: "hi", as: "rest" }]),
      choice("nested", [{ chance: 0.5, then: [{ days: 2 }], else: [] }]),
      choice("good", [{ days: 1, as: "rest" }, { chance: 0.5, then: [{ days: 1, as: "halt" }] }]),
    ],
  });
  const errs = validateDeck(f.route);
  const at = (c) => errs.filter((e) => e.startsWith(`event kinds.${c}:`));
  assert.equal(at("none").length, 1, errs.join("\n"));
  assert.match(at("none")[0], /days.*"as"/);
  assert.equal(at("typo").length, 1, errs.join("\n"));
  assert.match(at("typo")[0], /resst/);
  assert.equal(at("stray").length, 1, errs.join("\n"));
  assert.match(at("stray")[0], /"as".*narrate/);
  assert.equal(at("nested").length, 1, errs.join("\n"));
  assert.deepEqual(at("good"), []);
  assert.equal(errs.length, 4, errs.join("\n"));
});

test("validateDeck: without an eventDay hook, 'as' on days is allowed and on other effects is an error", () => {
  const f = deckFixture();
  f.route.events.push({ id: "plain", deck: "d", text: "t", effects: [{ days: 1 }, { days: 1, as: "rest" }, { add: ["food", 1], as: "rest" }] });
  const errs = validateDeck(f.route);
  assert.equal(errs.length, 1, errs.join("\n"));
  assert.match(errs[0], /event plain: .*"as".*add/);
});

test("PA1: a choice's next event binds its own variables fresh and inherits the rest", () => {
  const f = fixture();
  let n = 0;
  f.route.binders = { ...f.route.binders, count: () => `call ${++n}` };
  f.route.events = [
    { id: "menu", deck: "d", text: "Menu {label} {extra}", bind: { label: { count: true } },
      choices: [{ id: "again", label: "Again {label}", effects: [], next: "menu" }, { id: "leave", label: "Leave" }] },
  ];
  startEvent(f.ctx, "menu", { extra: "kept" });
  assert.equal(f.state.pending.vars.label, undefined, "startEvent with vars does not bind");
  f.state.pending = null;
  f.ctx.beats.length = 0;
  f.ctx.queueEvent("menu", { extra: "kept" });
  assert.equal(f.state.pending.vars.label, "call 1");
  resolveChoice(f.ctx, "again");
  assert.equal(f.state.pending.id, "menu");
  assert.equal(f.state.pending.vars.label, "call 2", "the next event's own binder runs again");
  assert.equal(f.state.pending.vars.extra, "kept");
});

test("N-A2: weight.scale multiplies by a route scale (a continuous curve); validateDeck knows the route's scales", () => {
  const f = fixture();
  f.route.scales = { worn: (ctx) => 1 + (ctx.state.res.food ?? 0) / 100 };
  const ev = { id: "s", deck: "d", text: "S", weight: { base: 10, scale: "worn" } };
  f.route.events = [ev];
  f.state.res.food = 0;
  assert.equal(weightOf(ev, f.ctx), 10);
  f.state.res.food = 50;
  assert.equal(weightOf(ev, f.ctx), 15);
  assert.deepEqual(validateDeck(f.route).filter((e) => /scale/.test(e)), []);
  f.route.events.push({ id: "t", deck: "d", text: "T", weight: { base: 1, scale: "nope" } });
  assert.match(validateDeck(f.route).join("\n"), /event t: unknown weight scale nope/);
});
