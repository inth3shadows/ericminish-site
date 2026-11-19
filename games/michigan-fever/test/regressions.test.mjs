// Regression tests for the round-1 review of the Michigan Fever branch
// (findings F2-F5, F8, F9, F12, F13). Each test names its finding.

import test from "node:test";
import assert from "node:assert/strict";
import { availableActions, makeCtx, newGame, step, view } from "../../engine/engine.js";
import { deserialize } from "../../engine/save.js";
import { clone } from "../../engine/state.js";
import * as engine from "../../engine/engine.js";
import { canDriveOn } from "../ui/driveon.js";
import { deadlineText } from "../ui/hud.js";
import { resumeText } from "../ui/resume.js";
import { createRoute } from "../route.js";
import { loadRouteFromDisk, readData } from "./load.mjs";
import { STRATEGIES } from "./strategies.mjs";
import { createRng, cursor } from "../../engine/rng.js";

const route = loadRouteFromDisk();

// A route built from the same data with some numbers replaced.
function routeWith(changes) {
  const data = readData();
  data.numbers = data.numbers.map((n) => (n.id in changes ? { ...n, value: changes[n.id] } : n));
  return createRoute(data);
}

// Play seeded games with a scripted strategy until done(state) holds at a
// moment the player could act (no open event, game not over).
function reach(strategy, done, r = route) {
  for (let i = 0; i < 60; i++) {
    const seed = `reach-${strategy}-${i}`;
    const rng = cursor(createRng(`player-${seed}`));
    let { state } = newGame(r, { seed });
    for (let n = 0; n < 600 && !state.over; n++) {
      if (!state.pending && done(state)) return state;
      const acts = availableActions(r, state);
      state = step(r, state, STRATEGIES[strategy](r, state, acts, { seedIndex: i, rng })).state;
    }
  }
  throw new Error(`no ${strategy} game reached the state`);
}

const adult = (r, p) => p.age >= r.num("age.adult");

// ---- F2: event choices that spend a day -----------------------------------------

const STALE = { kind: "stale", resting: false, meals: true, crowded: true, lodged: true };
const DAY = {
  rest: { resting: true, meals: false, crowded: false, lodged: false },
  restOffice: { resting: true, meals: false, crowded: true, lodged: false },
  halt: { resting: false, meals: false, crowded: false, lodged: false },
  haltOffice: { resting: false, meals: false, crowded: true, lodged: false },
  apart: { resting: false, meals: false, crowded: false, lodged: false },
  cabin: { resting: false, meals: true, crowded: false, lodged: true },
  inn: { resting: true, meals: false, crowded: false, lodged: true },
};

// Where each choice happens, and the day it should spend. All 16 choices in the
// deck that spend days are listed; the test below checks the list is complete.
const SPENDS = [
  ["vt-neighbours", "dinner", "vermont", DAY.rest],
  ["vt-hill-mud", "wait", "vermont", DAY.rest],
  ["vt-wheel", "pay", "vermont", DAY.halt],
  ["canal-cholera-rumour", "off", "packet", DAY.halt],
  ["lake-gale", "shelter", "cabin", DAY.cabin],
  ["swamp-mired", "rails", "swamp", DAY.halt],
  ["swamp-fever", "rest", "swamp", DAY.rest],
  ["ohio-lame-ox", "rest", "swamp", DAY.rest],
  ["road-shaking", "rest", "vermont", DAY.rest],
  ["off-specie-rumour", "ask", "office", DAY.haltOffice],
  ["off-surveyor-tip", "follow", "office", DAY.apart],
  ["off-hire-out", "work", "office", DAY.apart],
  ["off-camp-ague", "away", "office", DAY.apart],
  ["claim-axe", "rest", "claim", DAY.rest],
  ["any-trunk", "rest", "vermont", DAY.rest],
  ["swamp-rain-tavern", "wait", "swamp", DAY.inn],
];

const PLACES = {
  vermont: () => reach("cautious", (s) => s.phase === "travel" && s.leg === "vermont" && s.day > 1),
  packet: () => reach("cautious", (s) => s.phase === "travel" && s.leg === "canal" && s.vars.ticket === "packet"),
  cabin: () => reach("cautious", (s) => s.phase === "travel" && s.leg === "lake" && s.vars.ticket === "cabin"),
  swamp: () => reach("cheap", (s) => s.phase === "travel" && s.vars.terrain === "swamp"),
  office: () => reach("cautious", (s) => s.phase === "office" && s.land.candidates.length < route.num("land.maxCandidates") && !s.land.applied),
  claim: () => reach("cautious", (s) => s.phase === "claim"),
};
const cache = {};
const at = (place) => clone((cache[place] ??= PLACES[place]()));

// Put the event's choice in front of the player, with the last action's day left over.
function facing(s, id) {
  s.pending = { kind: "event", id, vars: { who: s.party.find((p) => p.status !== "dead" && adult(route, p)).id } };
  s.vars.today = { ...STALE };
  s.vars.griefDays = 0;
  for (const p of s.party) if (p.status !== "dead") Object.assign(p, { status: "well", illness: null });
  s.purse.coin += 5000;
  return s;
}

const flags = (t) => ({ resting: Boolean(t?.resting), meals: Boolean(t?.meals), crowded: Boolean(t?.crowded), lodged: Boolean(t?.lodged) });

test("F2: the list covers every event choice that spends days", () => {
  const spends = (effs = []) => effs.some((e) => "days" in e || spends(e.then) || spends(e.else));
  const found = [];
  for (const e of route.events) for (const c of e.choices ?? []) if (spends(c.effects)) found.push(`${e.id}.${c.id}`);
  assert.deepEqual(found.sort(), SPENDS.map(([e, c]) => `${e}.${c}`).sort());
  assert.equal(found.length, 16);
});

test("F2: each of the 16 choices spends its day with that day's own conditions", () => {
  for (const [id, choice, place, want] of SPENDS) {
    const s = facing(at(place), id);
    const r = step(route, s, `choose:${choice}`);
    assert.ok(!r.beats.some((b) => b.type === "error"), `${id}.${choice}: ${JSON.stringify(r.beats.find((b) => b.type === "error"))}`);
    assert.ok(r.state.day > s.day, `${id}.${choice}: a day passes`);
    assert.deepEqual(flags(r.state.vars.today), want, `${id}.${choice} at ${place}`);
  }
});

// No illness onsets, so health and food move only by the rules being tested.
const calm = routeWith(Object.fromEntries(readData().numbers.filter((n) => /^(ague\.base\.|dys\.base|cholera\.base)/.test(n.id)).map((n) => [n.id, 0])));

test("F2: resting a day for an event heals at the rest rate (road-shaking, swamp-fever)", () => {
  for (const [id, place] of [["road-shaking", "vermont"], ["swamp-fever", "swamp"]]) {
    const s = facing(at(place), id);
    const p = s.party.find((x) => x.status === "well");
    p.health = 50;
    const ev = calm.eventIndex.get(id);
    const noChance = { ...ev, choices: ev.choices.map((c) => ({ ...c, effects: c.effects.filter((e) => !("chance" in e) && !("heal" in e)) })) };
    calm.eventIndex.set(id, noChance);
    try {
      const r = step(calm, s, "choose:rest");
      const after = r.state.party.find((x) => x.id === p.id).health;
      assert.equal(after, 50 + calm.num("health.restRegen"), `${id}: health ${after}`);
    } finally {
      calm.eventIndex.set(id, ev);
    }
  }
});

test("F2: a day ashore off a packet boat eats from the family's own food (canal-cholera-rumour)", () => {
  const s = facing(at("packet"), "canal-cholera-rumour");
  s.res.food = 50;
  const r = step(calm, s, "choose:off");
  assert.ok(r.state.res.food < 50, `food ${r.state.res.food}`);
});

test("F2: moving the tent to higher ground leaves the crowded camp (off-camp-ague)", () => {
  // Ague certain in a crowded camp, near impossible outside it.
  const r0 = routeWith({ "ague.base.office": 1e-9, "crowd.mult": 1e10, "ague.month.9": 1, "ague.month.10": 1, "ague.month.11": 1, "ague.month.12": 1 });
  const s = facing(at("office"), "off-camp-ague");
  const r = step(r0, s, "choose:away");
  assert.equal(r.state.party.filter((p) => p.status === "sick").length, 0);
});

// ---- F3: stranded while something could still get the family moving -------------

function albanyAllSick() {
  const s = reach("cautious", (x) => x.phase === "town" && x.place === "albany" && x.gear.team && !x.vars.teamSold);
  s.purse.coin = 10;
  for (const k of Object.keys(s.purse.notes)) s.purse.notes[k] = 0;
  s.res.quinine = 0;
  for (const p of s.party) if (adult(route, p) && p.status !== "dead") Object.assign(p, { status: "sick", illness: { kind: "dysentery", days: 0 } });
  return s;
}

test("F3: not stranded at Albany while the team could still be sold", () => {
  const s = albanyAllSick();
  assert.ok(availableActions(route, s).some((a) => a.id === "sell-team" && a.enabled));
  assert.equal(route.checkEnd(makeCtx(route, clone(s))), null);
});

test("F3: stranded once nothing could help (team sold, no paper, all adults sick, no lodging money)", () => {
  const s = albanyAllSick();
  s.gear.team = null;
  s.gear.wagon = false;
  s.vars.teamSold = true;
  assert.equal(route.checkEnd(makeCtx(route, clone(s)))?.outcome, "stranded");
});

// ---- F4: drive on with meals in the passage --------------------------------------

test("F4: drive on is allowed on a packet boat with meals and no rations, refused on the line boat", () => {
  const s = clone(PLACES.packet());
  s.res.food = 0;
  assert.deepEqual(canDriveOn(engine, route, s), { ok: true });
  s.vars.ticket = "line";
  assert.equal(canDriveOn(engine, route, s).reason, "Not with food this low.");
});

test("F4: cabin passage on the lake counts as meals too", () => {
  const s = clone(PLACES.cabin());
  s.res.food = 0;
  assert.equal(canDriveOn(engine, route, s).ok, true);
});

// ---- F5: a damaged save -------------------------------------------------------------

test("F5: saves with state {} / 5 / {phase: travel} are refused, so view() never sees them", () => {
  for (const st of [{}, 5, { phase: "travel" }]) {
    const text = JSON.stringify({ format: 1, schemaVersion: 1, routeId: route.id, routeVersion: route.version, state: st });
    assert.equal(deserialize(route, text).ok, false, JSON.stringify(st));
  }
});

// ---- F8: lodging in a town has its own event chance ------------------------------

test("F8: a day's lodging in town draws town events at ev.p.town", () => {
  const town = (r) => reach("cautious", (s) => s.phase === "town" && s.place === "albany", r);
  const events = (r) => {
    let n = 0;
    for (let i = 0; i < 20; i++) {
      const s = clone(town(r));
      s.purse.coin += 10000;
      s.rng = createRng(`stay-${i}`);
      if (step(r, s, "stay").beats.some((b) => b.type === "event")) n++;
    }
    return n;
  };
  assert.equal(route.numbers.get("ev.p.town")?.tag, "invented");
  assert.equal(events(routeWith({ "ev.p.town": 0, "ev.p.office": 1 })), 0);
  assert.ok(events(routeWith({ "ev.p.town": 1, "ev.p.office": 0 })) > 0);
});

// ---- F9: resume text --------------------------------------------------------------

test("F9: resuming another game's save does not show the stored event title", () => {
  const state = { seed: "new", pending: { kind: "event", id: "x", vars: {} } };
  const v = { dateLabel: "Monday, 3 October 1836", placeLabel: "Albany" };
  const meta = { seed: "old", line: "Old line", pending: { text: "Old event", title: "Old title" } };
  const other = resumeText(state, meta, v);
  assert.equal(other.title, null);
  assert.equal(other.text, "Monday, 3 October 1836. Albany.");
  assert.equal(other.pendingEvent, null);
  const same = resumeText({ ...state, seed: "old" }, meta, v);
  assert.deepEqual([same.text, same.title, same.kind], ["Old event", "Old title", "event"]);
});

// ---- F12: the deadline line ------------------------------------------------------

test("F12: the deadline line on 15 December and the day before", () => {
  const d = (daysLeft) => ({ date: "1836-12-15", daysLeft, passed: daysLeft < 0 });
  for (const snow of [false, true]) {
    for (const small of [false, true]) {
      const last = deadlineText(d(0), { snow, small });
      const one = deadlineText(d(1), { snow, small });
      assert.doesNotMatch(last, /\b0\b/, last);
      assert.match(last, /last day/, last);
      assert.doesNotMatch(one, /\b1 (more )?days\b/, one);
      assert.match(one, /\b1 (more )?day\b/, one);
      assert.match(deadlineText(d(9), { snow, small }), /\b9 (more )?days\b/);
    }
  }
  assert.equal(deadlineText(d(-1), { snow: true, small: false }), "The land office takes only coin now");
});

// ---- F13: endings and other lines that open with the family -----------------------

test("F13: no line opens with a lowercase 'the X family'", () => {
  const data = readData();
  const strings = [];
  const walk = (x) => {
    if (typeof x === "string") strings.push(x);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") Object.values(x).forEach(walk);
  };
  walk(data.text);
  walk(data.backgrounds);
  walk(data.events);
  const bad = strings.filter((t) => /(^|[.!?]["”]?\s+|\n)\{family\}/.test(t));
  assert.deepEqual(bad, []);
  // And the rendered endings start with a capital.
  const s = reach("cautious", (x) => x.phase === "travel");
  for (const outcome of Object.keys(data.text.endings)) {
    const text = route.ending(makeCtx(route, clone(s)), { outcome }).text;
    assert.match(text, /^[A-Z0-9]/, `${outcome}: ${text}`);
  }
});

test("view() of a reached state still works (sanity for the helpers above)", () => {
  assert.ok(view(route, at("vermont")).food);
});
