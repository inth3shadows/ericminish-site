// P2 Phase B: the five alternative paths, the two-tier outcomes and the new
// save shape. Written before the code (spec B1, B2; ~/.claude/plans/michigan-fever-p2-spec.md).

import test from "node:test";
import assert from "node:assert/strict";
import * as engine from "../../engine/engine.js";
import { availableActions, makeCtx, newGame, step, view } from "../../engine/engine.js";
import { validateDeck } from "../../engine/events.js";
import { deserialize, serialize } from "../../engine/save.js";
import { addDays, compare } from "../../engine/clock.js";
import * as T from "../mechanics/travel.js";
import * as Pa from "../mechanics/paths.js";
import { canDriveOn, driveOn } from "../ui/driveon.js";
import { artFor } from "../ui/scene.js";
import { createRoute, ROUTE_VERSION, SCENES, SCENE_FALLBACK } from "../route.js";
import { readData } from "./load.mjs";

function routeWith(changes) {
  const d = readData();
  d.numbers = d.numbers.map((n) => (n.id in changes ? { ...n, value: changes[n.id] } : n));
  return createRoute(d);
}
const data = readData();
// No illness, no random events: days move only by the rules under test.
const QUIET = Object.fromEntries(data.numbers.filter((n) => /^(ague\.base\.|dys\.base|cholera\.base|ev\.p\.)/.test(n.id)).map((n) => [n.id, 0]));
const calm = routeWith({ ...QUIET, "kin.callP": 0 });
const num = calm.num;
const RICH = { coin: 100000, notes: { ne: 0, ny: 0, mi: 0 } };

function started(seed = "pb", r = calm, bg = "vermont") {
  const { state } = newGame(r, { seed });
  return step(r, state, { id: `start:${bg}` }).state;
}

function at(place, { date = null, s = started(`at-${place}`), purse = RICH } = {}) {
  s.phase = place === "bronson" ? "office" : "town";
  s.place = place;
  s.leg = null;
  s.vars.terrain = null;
  s.vars.visit = { place, used: {}, since: s.day };
  if (date) { s.day += Math.max(0, (Date.parse(date) - Date.parse(s.date)) / 864e5); s.date = date; }
  s.purse = structuredClone(purse);
  s.res.food = 3000;
  s.queue = [];
  return s;
}

const ids = (s, r = calm) => availableActions(r, s).map((a) => a.id);
const act = (s, id, r = calm) => availableActions(r, s).find((a) => a.id === id);
const choice = (s, c, r = calm) => availableActions(r, s).find((a) => a.choice === c);
const go = (s, id, r = calm) => {
  const res = step(r, s, id);
  assert.ok(!res.beats.some((b) => b.type === "error"), `${id}: ${JSON.stringify(res.beats.find((b) => b.type === "error"))}`);
  return res;
};
// Answer any open event with its first enabled choice (the decline comes first on a pivot).
function settle(s, r = calm) {
  for (let i = 0; i < 20 && s.pending && !s.over; i++) s = go(s, availableActions(r, s).find((a) => a.enabled).id, r).state;
  return s;
}
// Step until `done` or the game ends, choosing `pick(acts, s)` or the forward action.
function run(s, done, pick = () => null, r = calm, max = 900) {
  for (let i = 0; i < max && !s.over && !done(s); i++) {
    const acts = availableActions(r, s);
    const a = pick(acts, s) ?? (s.pending ? acts.find((x) => x.enabled) : acts.find((x) => x.enabled && x.forward) ?? acts.find((x) => x.enabled));
    s = go(s, a.id === "go" && a.paces ? { ...a, pace: "steady" } : a, r).state;
  }
  return s;
}
const endBeat = (beats) => beats.find((b) => b.type === "end");

// ---- schema -----------------------------------------------------------------------

test("schema: the route version is 3, so a Phase A (version 2) save is refused cleanly", () => {
  assert.equal(ROUTE_VERSION, 3);
  const old = JSON.parse(serialize(started()));
  old.routeVersion = 2;
  old.state.routeVersion = 2;
  assert.deepEqual(deserialize(calm, JSON.stringify(old)), { ok: false, reason: "old route version" });
});

test("schema: a save with an unknown path, a malformed lot or a malformed western kin is damaged", () => {
  const s = started();
  assert.equal(deserialize(calm, serialize(s)).ok, true);
  for (const bad of [
    (x) => { x.vars.path = "oregon"; },
    (x) => { x.vars.path = "chicago"; x.vars.lot = { price: "lots" }; },
    (x) => { x.vars.west = { where: "texas" }; },
    (x) => { x.vars.homeOn = 5; },
  ]) {
    const c = structuredClone(s);
    bad(c);
    assert.deepEqual(deserialize(calm, serialize(c)), { ok: false, reason: "damaged" });
  }
});

// ---- B1: tiers --------------------------------------------------------------------

test("B1: every ending reports a tier 0-2, stated in words, never as a score", () => {
  const tiers = data.text.tiers;
  for (const key of ["main", ...Pa.PATHS]) {
    for (const t of ["0", "1", "2"]) {
      assert.ok(tiers[key]?.[t]?.length > 20, `${key} tier ${t} has words`);
      assert.doesNotMatch(tiers[key][t], /\d|tier|score|points/i, `${key} ${t}: words, not a score`);
    }
  }
});

test("B1: the main route: settled and whole is 2; settled with a death is 1; never reaching Bronson is 0", () => {
  const s = at("bronson");
  s.flags.reachedBronson = true;
  s.land.paid = true;
  s.land.acres = 40;
  s.land.shelter = 100;
  assert.equal(Pa.tierOf(s, num, "settled"), 2);
  s.party[5].status = "dead";
  assert.equal(Pa.tierOf(s, num, "settled"), 1);
  delete s.flags.reachedBronson;
  assert.equal(Pa.tierOf(s, num, "winter"), 0);
  // A household is at least one adult left: only children alive is a failure.
  const kids = at("bronson");
  kids.flags.reachedBronson = true;
  for (const p of kids.party) if (p.age >= num("age.adult")) p.status = "dead";
  assert.equal(Pa.tierOf(kids, num, "roofless"), 0);
});

test("B1: the end beat and the end record carry the tier and its words", () => {
  let s = at("bronson");
  s.flags.reachedBronson = true;
  s.phase = "claim";
  s.place = "claim";
  s.land.paid = true;
  s.land.acres = 40;
  s.land.tract = { id: "t1", kind: "openings", poor: false, known: true, miles: 6 };
  s.land.shelter = 99.9;
  const r = go(s, "build");
  const end = endBeat(r.beats);
  assert.equal(end.outcome, "settled");
  assert.equal(end.tier, 2);
  assert.equal(r.state.over.tier, 2);
  assert.equal(end.tierText, data.text.tiers.main["2"]);
});

// ---- B2: pivots in general ----------------------------------------------------------

test("B2: every pivot is one-way with a confirm, and its decline comes first", () => {
  for (const id of ["pivot-detroit", "pivot-chicago", "pivot-home", "pivot-ohio", "pivot-kin", "ohio-offer", "kin-call"]) {
    const ev = calm.eventIndex.get(id);
    assert.ok(ev, id);
    assert.ok(ev.choices.length >= 2, `${id}: a choice`);
    const first = ev.choices[0];
    assert.ok(first.requires == null && first.only == null, `${id}: the first choice is always open`);
    assert.ok(!JSON.stringify(first.effects ?? []).includes("pivot"), `${id}: the first choice does not pivot`);
  }
  for (const id of ["pivot-detroit", "pivot-chicago", "pivot-home", "pivot-ohio", "pivot-kin"]) {
    assert.match(calm.eventIndex.get(id).text, /cannot be undone|no going back|one way/i, `${id}: says it is one-way`);
  }
  assert.deepEqual(validateDeck(calm), []);
});

test("B2: after a pivot no other pivot is offered", () => {
  let s = at("detroit", { date: "1836-11-02" });
  s = go(s, "pivot:detroit").state;
  s = go(s, "choose:yes").state;
  assert.equal(s.vars.path, "detroit");
  assert.ok(!ids(s).some((i) => i.startsWith("pivot:")), ids(s).join(" "));
});

test("B2: no new art: every scene key maps to an existing painting, directly or by the fallback map", () => {
  for (const key of Object.keys(SCENES)) {
    assert.ok(artFor(key, "day"), `${key}: a painting`);
    if (SCENE_FALLBACK[key]) assert.ok(SCENES[SCENE_FALLBACK[key]] && !SCENE_FALLBACK[SCENE_FALLBACK[key]], `${key}: falls back to a base scene`);
  }
  for (const leg of Object.values(T.LEGS)) assert.ok(SCENES[leg.scene], `${leg.label}: scene ${leg.scene}`);
});

// ---- 1. Winter in Detroit ----------------------------------------------------------

test("Detroit: the winter is offered at Detroit from 1 November, or when Bronson by 15 December looks unlikely", () => {
  assert.ok(!ids(at("detroit", { date: "1836-10-10" })).includes("pivot:detroit"));
  assert.ok(ids(at("detroit", { date: "1836-11-01" })).includes("pivot:detroit"));
  assert.ok(!ids(at("buffalo", { date: "1836-11-05" })).includes("pivot:detroit"));
  // Late October with the Territorial Road and the window still to go: not yet unlikely.
  assert.equal(Pa.bronsonUnlikely(at("detroit", { date: "1836-10-30" }), num), false);
  assert.equal(Pa.bronsonUnlikely(at("detroit", { date: "1836-12-05" }), num), true);
});

test("Detroit: a week of work pays wages in Michigan notes; the room is 50 cents a night; the family eats", () => {
  let s = at("detroit", { date: "1836-11-02", purse: { coin: 2000, notes: { ne: 0, ny: 0, mi: 0 } } });
  s = go(go(s, "pivot:detroit").state, "choose:yes").state;
  assert.equal(s.phase, "winter");
  const before = structuredClone(s);
  const r = go(s, "week:work");
  const after = r.state;
  assert.equal(after.day - before.day, 7);
  const roomPaid = 7 * Math.round(num("winter.room") * 100);
  const line = r.beats.find((b) => b.type === "narrate" && /week's work brings in/.test(b.text));
  assert.ok(line, "some days found work");
  const earned = Math.round(Number(line.text.match(/\$(\d+\.\d\d)/)[1]) * 100);
  assert.equal(earned % 100, 0, "whole dollars a day");
  assert.match(line.text, /Michigan notes/);
  // The room comes out of the purse each night, paper first (Michigan notes pass at par here).
  assert.equal(view(calm, after).purse.valueHere, view(calm, before).purse.valueHere - roomPaid + earned);
  assert.ok(after.res.food < before.res.food, "the family eats");
});

test("Detroit: a week without the room's rent is a week without a roof", () => {
  let s = at("detroit", { date: "1836-12-20", purse: { coin: 0, notes: { ne: 0, ny: 0, mi: 0 } } });
  s.vars.snowDate = "1836-12-01";
  s.vars.path = "detroit";
  s.phase = "winter";
  const h = s.party.map((p) => p.health);
  s = go(s, "week:rest").state;
  assert.ok(s.party.some((p, i) => p.health < h[i]), "the cold tells");
});

test("Detroit: Michigan notes lose value once the Detroit banks suspend, 17 May 1837", () => {
  const s = at("detroit", { date: "1837-05-16", purse: { coin: 0, notes: { ne: 0, ny: 0, mi: 10000 } } });
  s.vars.path = "detroit";
  s.phase = "winter";
  const before = view(calm, s).purse.valueHere;
  s.date = "1837-05-17";
  const afterV = view(calm, s).purse.valueHere;
  assert.equal(before, 10000);
  assert.equal(afterV, Math.floor(10000 * (1 - num("disc.miSuspended"))));
});

test("Detroit: in the spring the family goes west and buys land in coin only; 40 acres by June, whole, is tier 2", () => {
  let s = at("detroit", { date: "1837-03-30", purse: { coin: 9000, notes: { ne: 0, ny: 0, mi: 5000 } } });
  s.vars.path = "detroit";
  s.phase = "winter";
  assert.equal(act(s, "spring").enabled, false, "not before the thaw");
  s.date = "1837-04-01";
  s = go(s, "spring").state;
  assert.equal(s.leg, "road");
  s = run(s, (x) => x.place === "bronson" && x.phase === "office");
  assert.equal(s.place, "bronson");
  // Spring 1837: past 15 December, so the Receiver takes coin only.
  s = run(s, (x) => x.land.applied, (acts) => acts.find((a) => a.id === "explore" && a.enabled) ?? acts.find((a) => a.type === "apply" && a.acres === 40 && a.enabled));
  s = run(s, (x) => x.land.ready, (acts) => acts.find((a) => a.id === "wait"));
  assert.ok(!act(s, "pay:notes"), "no paper taken in 1837");
  const r = go(s, "pay:coin");
  const end = endBeat(r.beats);
  assert.ok(end, "the path ends with the land");
  assert.equal(end.outcome, "spring-land");
  assert.equal(end.tier, 2);
});

test("Detroit: through the winter alive without land by June is tier 1; the path ends on its last day", () => {
  let s = at("detroit", { date: "1837-06-25", purse: { coin: 100, notes: { ne: 0, ny: 0, mi: 0 } } });
  s.vars.path = "detroit";
  s.phase = "winter";
  const r = go(s, "week:rest");
  const end = endBeat(r.beats);
  assert.ok(end);
  assert.equal(end.tier, 1);
});

// ---- 2. Chicago --------------------------------------------------------------------

test("Chicago: offered at Detroit (the road, or the $21 stage) and at Buffalo (cabin by the lakes, $20)", () => {
  assert.ok(ids(at("detroit", { date: "1836-10-05" })).includes("pivot:chicago"));
  assert.ok(ids(at("buffalo", { date: "1836-10-05" })).includes("pivot:chicago"));
  assert.ok(!ids(at("albany")).includes("pivot:chicago"));
  // Buffalo: the lakes, the fare by the head (children at the child share).
  let b = go(at("buffalo", { date: "1836-10-05" }), "pivot:chicago").state;
  const lakes = choice(b, "lakes");
  assert.ok(lakes?.enabled);
  const units = b.party.reduce((a, p) => a + (p.age < num("age.adult") ? num("fare.childShare") : 1), 0);
  const coin = b.purse.coin;
  b = go(b, "choose:lakes").state;
  assert.equal(b.leg, "chicagoLakes");
  assert.ok(coin - b.purse.coin >= Math.round(units * num("fare.cabin.chicago") * 100));
  // Detroit without a team: the stage; with one, the road (254 miles).
  const d = at("detroit", { date: "1836-10-05" });
  d.gear.team = null;
  d.gear.wagon = false;
  const dd = go(d, "pivot:chicago").state;
  assert.ok(choice(dd, "stage")?.enabled);
  assert.ok(!choice(dd, "road"), "no road without a team");
  const withTeam = go(at("detroit", { date: "1836-10-05" }), "pivot:chicago").state;
  const s = go(withTeam, "choose:road").state;
  assert.equal(s.vars.path, "chicago");
  const out = go(s, "set-out").state;
  assert.equal(out.leg, "chicagoRoad");
  assert.equal(T.legMiles(out, num, "chicagoRoad"), 254);
});

function inChicago(date, purse = RICH) {
  const s = at("detroit", { date, purse });
  s.vars.path = "chicago";
  s.flags.reachedChicago = true;
  s.place = "chicago";
  s.phase = "lots";
  s.vars.visit = { place: "chicago", used: {}, since: s.day };
  s.vars.lot = null;
  return s;
}

test("Chicago: a lot bought in cash or on credit; the note gathers ten per cent a year", () => {
  const s = inChicago("1836-10-20");
  const cash = act(s, "lot:cash");
  const credit = act(s, "lot:credit");
  assert.equal(cash.cost, Pa.lotMarket(s, num));
  assert.equal(credit.cost, Math.round(cash.cost * num("lot.down")));
  const c = go(s, "lot:credit").state;
  assert.equal(c.vars.lot.note, cash.cost - credit.cost);
  const later = structuredClone(c);
  later.date = addDays(c.date, 365);
  assert.equal(Pa.lotOwed(later, num), Math.round(c.vars.lot.note * 1.1));
});

test("Chicago: lot values slide through the winter and fall to a tenth or a twentieth once the banks suspend", () => {
  const s = inChicago("1836-10-01");
  const oct = Pa.lotMarket(s, num);
  const feb = Pa.lotMarket(s, num, "1837-02-01");
  const jun = Pa.lotMarket(s, num, "1837-06-01");
  assert.ok(feb < oct);
  assert.ok(jun <= Math.round(num("lot.price") * 100 / 10) && jun >= Math.round(num("lot.price") * 100 / 20));
});

test("Chicago: a buyer's offer sells the lot; a credit lot's note is paid from the price", () => {
  let s = inChicago("1836-10-20");
  s = go(s, "lot:credit").state;
  s.vars.lot.offer = 40000;
  const owed = Pa.lotOwed(s, num);
  const mi = s.purse.notes.mi;
  const il = s.purse.notes.il ?? 0; // the RICH purse predates Illinois paper (reads as none)
  const coin = s.purse.coin;
  s = go(s, "lot:sell").state;
  assert.equal(s.vars.lot.sold, s.date);
  // The buyer pays in Illinois paper (PC6; was Michigan notes before round 9).
  assert.equal(s.purse.notes.il + s.purse.notes.mi + s.purse.coin - il - mi - coin, 40000 - owed);
  assert.equal(s.purse.notes.il - il, 40000 - owed);
});

test("Chicago: holding the lot into spring 1837 is the trap: tier 1 at best, even with a farm and a roof", () => {
  const s = inChicago("1837-06-30");
  s.vars.lot = { price: 30000, paid: 30000, note: 0, bought: "1836-10-20", sold: null, forfeit: null, offer: null };
  s.land.paid = true;
  s.land.acres = 40;
  s.land.shelter = 100;
  assert.equal(Pa.tierOf(s, num, "prairie-farm"), 1);
  s.vars.lot.sold = "1837-03-01";
  assert.equal(Pa.tierOf(s, num, "prairie-farm"), 2);
});

test("Chicago: tier 2 is selling out of the boom before spring: a family that never bought a lot has nothing to sell out of", () => {
  const s = inChicago("1837-06-30");
  s.land.paid = true;
  s.land.acres = 40;
  s.land.shelter = 100;
  assert.equal(Pa.tierOf(s, num, "prairie-farm"), 1, "no lot bought");
  s.vars.lot = { price: 30000, paid: 30000, note: 0, bought: "1836-10-20", sold: "1837-04-02", forfeit: null, offer: null };
  assert.equal(Pa.tierOf(s, num, "prairie-farm"), 1, "sold after the thaw");
  s.vars.lot.sold = "1837-03-31";
  assert.equal(Pa.tierOf(s, num, "prairie-farm"), 2, "sold before the thaw");
  s.vars.lot = { ...s.vars.lot, sold: null, forfeit: "1837-03-01" };
  assert.equal(Pa.tierOf(s, num, "prairie-farm"), 1, "a lot let go for its note is not sold");
});

test("Home: a tie paid on coming home after it went wrong at home does not count as seen to in time", () => {
  const s = at("detroit");
  s.vars.path = "home";
  s.vars.homeOn = "1836-10-20";
  for (const t of s.ties) { t.status = "settled"; t.outcome = null; }
  assert.equal(Pa.tierOf(s, num, "home"), 2);
  s.ties[0].outcome = [...["died", "pressed", "sued", "posted", "named", "married", "managing"]].find((o) => o) ;
  assert.equal(Pa.tierOf(s, num, "home"), 1);
});

test("Chicago: government land nine miles out, then the claim; a roof on it ends the path", () => {
  let s = inChicago("1837-04-10", { coin: 20000, notes: { ne: 0, ny: 0, mi: 0 } });
  s.vars.lot = { price: 30000, paid: 30000, note: 0, bought: "1836-10-20", sold: "1837-02-01", forfeit: null, offer: null, soldFor: 28000 };
  const farm = act(s, "farm:40");
  assert.ok(farm?.enabled);
  assert.equal(farm.cost, 5000);
  s = go(s, "farm:40").state;
  assert.equal(s.land.paid, true);
  assert.equal(s.leg, "claim");
  assert.equal(s.land.claimMiles, num("farm.chicago.miles"));
  s = run(s, (x) => x.over, (acts) => acts.find((a) => a.id === "hire-hands" && a.enabled) ?? acts.find((a) => a.id === "build"));
  const end = s.over;
  assert.equal(end.outcome, "prairie-farm");
  assert.equal(end.tier, 2);
});

// ---- 3. Ohio -----------------------------------------------------------------------

// A family on the swamp road half a mile short of Perrysburg; one day's go passes it.
function nearPerrysburg() {
  const s = started("ohio");
  T.startLeg(makeCtx(calm, s), "overland");
  Object.assign(s.vars, { seg: 1, terrain: "swamp", segMi: num("mi.sanduskyPerrysburg") - 0.5, legMi: num("mi.buffaloSandusky") + num("mi.sanduskyPerrysburg") - 0.5 });
  s.res.food = 3000;
  s.queue = [];
  let t = go(s, "go").state;
  // The Perrysburg post office note comes first; the Lima offer follows it.
  for (let i = 0; i < 5 && t.pending && t.pending.id !== "ohio-offer"; i++) t = go(t, availableActions(calm, t).find((a) => a.enabled).id).state;
  return t;
}

test("Ohio: passing Perrysburg on the swamp road offers Lima; the confirm turns the wagon south", () => {
  let t = nearPerrysburg();
  assert.equal(t.pending?.id, "ohio-offer");
  t = go(t, "choose:south").state;
  assert.equal(t.pending?.id, "pivot-ohio");
  t = go(t, "choose:yes").state;
  assert.equal(t.vars.path, "ohio");
  assert.equal(t.leg, "toLima");
  // Declining (the first choice of each) keeps the main route and the Detroit road.
  const d = settle(nearPerrysburg());
  assert.equal(d.vars.path ?? null, null);
  assert.equal(d.leg, "overland");
});

test("Ohio: at Lima the Receiver takes coin (and New York paper if he will), not Michigan notes; land and a roof, whole, is tier 2", () => {
  let s = at("detroit", { purse: { coin: 2000, notes: { ne: 0, ny: 0, mi: 20000 } } });
  s.vars.path = "ohio";
  s.place = "lima";
  s.phase = "office";
  s.flags.reachedLima = true;
  s.land.candidates = [{ id: "t1", kind: "openings", poor: false, known: true, miles: 5, via: "alone" }];
  const a = act(s, "apply:t1:40");
  assert.equal(a.enabled, false, "Michigan notes are refused at Lima");
  s.purse.coin = 6000;
  assert.equal(act(s, "apply:t1:40").enabled, true);
  s.land.paid = true;
  s.land.acres = 40;
  s.land.shelter = 100;
  assert.equal(Pa.tierOf(s, num, "settled"), 2);
});

test("Ohio: the Lima window keeps its own (invented) queue, not Bronson's crowd", () => {
  const s = at("detroit");
  s.vars.path = "ohio";
  s.place = "lima";
  s.phase = "office";
  s.land.candidates = [{ id: "t1", kind: "openings", poor: false, known: true, miles: 5, via: "alone" }];
  s.purse.coin = 6000;
  for (let i = 0; i < 30; i++) {
    const c = structuredClone(s);
    c.rng.n += i;
    const q = go(c, "apply:t1:40").state.land.queue;
    assert.ok(q >= num("land.queue.lima.min") && q <= num("land.queue.lima.max"), `queue ${q}`);
  }
  assert.equal(calm.numbers.get("land.queue.lima.max").tag, "invented");
});

// ---- 4. Turning back ---------------------------------------------------------------

test("Home: offered anywhere after Albany: Buffalo, Detroit, Bronson; not at Albany", () => {
  assert.ok(!ids(at("albany")).includes("pivot:home"));
  for (const p of ["buffalo", "detroit", "bronson"]) assert.ok(ids(at(p)).includes("pivot:home"), p);
});

test("Home: the way back costs deck passage ($3), or the $25 winter stage once the lakes close", () => {
  const s = at("detroit", { date: "1836-10-10" });
  const units = s.party.reduce((a, p) => a + (p.age < num("age.adult") ? num("fare.childShare") : 1), 0);
  const early = Pa.passage(s, num, "detroit", units);
  s.date = "1836-11-26";
  const late = Pa.passage(s, num, "detroit", units);
  assert.equal(late.cost - early.cost,
    Math.round(units * (num("fare.winterStage") - num("fare.deck")) * 100) - Math.round((s.gear.goods * num("freight.lake.cwt") + num("freight.lake.team") + num("wagon.cwt") * num("freight.lake.cwt")) * 100));
  assert.ok(late.days > early.days);
});

test("Home: home before winter, whole, with the ties paid on arriving, is tier 2; ties unpaid is tier 1", () => {
  for (const pay of [true, false]) {
    let s = at("buffalo", { date: "1836-10-01" });
    s = go(s, "pivot:home").state;
    s = go(s, "choose:yes").state;
    assert.equal(s.vars.path, "home");
    assert.equal(s.leg, "homePassage");
    s = run(s, (x) => x.pending?.id === "home-again");
    assert.equal(s.place, "home");
    const r = go(s, `choose:${pay ? "pay" : "keep"}`);
    const end = endBeat(r.beats);
    assert.equal(end.outcome, "home");
    assert.equal(end.tier, pay ? 2 : 1, `paid ${pay}`);
    if (pay) assert.ok(r.state.ties.every((t) => t.status === "settled"));
  }
});

test("Home: from Bronson the family first goes back down the Territorial Road, then takes passage at Detroit", () => {
  let s = at("bronson", { date: "1836-10-20" });
  s = go(go(s, "pivot:home").state, "choose:yes").state;
  assert.equal(s.leg, "backRoad");
  s = run(s, (x) => x.place === "detroit" && x.phase === "town");
  assert.ok(act(s, "passage")?.enabled);
  assert.ok(!act(s, "set-out"), "no Territorial Road west again");
});

// ---- 5. Kin ------------------------------------------------------------------------

const kinRoute = routeWith({ ...QUIET, "kin.callP": 1, "kin.w.ohio": 0, "kin.w.illinois": 0, "kin.workP": 1 });

test("Kin: a relative's letter waits at a post office; reading it brings the offer; refusing costs morale", () => {
  let s = started("kin", kinRoute);
  assert.equal(s.vars.west.where, "allens");
  const call = s.mail.find((m) => m.key === "call");
  assert.ok(call && call.office === "detroit");
  assert.ok(Pa.PATHS.includes("kin"));
  s = at("detroit", { s, date: "1836-10-05" });
  s = go(s, "post", kinRoute).state;
  s = go(s, "choose:ask", kinRoute).state;
  const r = go(s, "choose:take", kinRoute);
  const letter = r.beats.find((b) => b.type === "letter" && b.from === "west");
  assert.ok(letter?.fiction && letter.label, "a labelled fiction letter from the West");
  assert.ok(compare(letter.date, s.date) < 0, "dated when written");
  s = go(r.state, "choose:leave", kinRoute).state;
  assert.equal(s.pending?.id, "kin-call");
  const m = s.res.morale;
  s = go(s, "choose:stay", kinRoute).state;
  assert.ok(s.res.morale < m);
  assert.equal(s.vars.path ?? null, null);
});

test("Kin: accepting reroutes the journey to them; arriving before snow, whole, with work or land, is tier 2", () => {
  let s = started("kin2", kinRoute);
  s = at("detroit", { s, date: "1836-10-05" });
  // As if the letter had just been read at the counter: the offer waits for this place.
  s.queue = [{ event: "kin-call", at: "detroit" }];
  s = go(s, "buy:flour", kinRoute).state;
  assert.equal(s.pending?.id, "kin-call");
  s = go(s, "choose:go", kinRoute).state;
  assert.equal(s.pending?.id, "pivot-kin");
  s = go(s, "choose:yes", kinRoute).state;
  assert.equal(s.vars.path, "kin");
  s = go(s, "set-out", kinRoute).state;
  assert.equal(s.leg, "toAllens");
  s = run(s, (x) => x.pending?.id === "kin-welcome", () => null, kinRoute);
  assert.equal(s.place, "allens");
  const r = go(s, "choose:work", kinRoute);
  const end = endBeat(r.beats);
  assert.equal(end.tier, 2);
});

// ---- the shared mechanics hold on the paths ------------------------------------------

test("paths: drive on along a path leg equals pressing go", () => {
  let s = at("detroit", { date: "1836-10-05" });
  s = go(go(s, "pivot:chicago").state, "choose:road").state;
  s = go(s, "set-out").state;
  assert.ok(canDriveOn(engine, calm, s).ok);
  const d = driveOn(engine, calm, s);
  let t = s;
  for (let i = 0; i < d.days.length; i++) t = step(calm, t, "go").state;
  assert.deepEqual(t, d.state);
});

test("paths: a death on a path keeps the register's form: death, letter (fiction), note", () => {
  let s = inChicago("1836-11-20");
  s.party[5].health = 1;
  s.party[5].status = "sick";
  s.party[5].illness = { kind: "dysentery", days: 1 };
  const r = go(s, "week:rest");
  const i = r.beats.findIndex((b) => b.type === "death");
  assert.ok(i >= 0);
  assert.deepEqual(r.beats.slice(i, i + 3).map((b) => b.type), ["death", "letter", "note"]);
  assert.equal(r.beats[i + 1].fiction, true);
  assert.doesNotMatch(r.beats[i].text, /you have died of/i);
});

test("paths: a save mid-path loads back unchanged and plays on the same", () => {
  let s = inChicago("1836-10-20");
  s = go(s, "lot:cash").state;
  const back = deserialize(calm, serialize(s));
  assert.equal(back.ok, true);
  assert.deepEqual(back.state, s);
  assert.deepEqual(step(calm, back.state, "week:work"), step(calm, s, "week:work"));
});

test("paths: no Oregon Trail phrasing in the new text", () => {
  const all = JSON.stringify([data.text.paths, data.text.tiers, data.events.filter((e) => e.deck === "path" || e.deck === "winter")]);
  for (const banned of [/you have died of/i, /tombstone/i, /\bford(ing)?\b/i, /epitaph/i, /\bhunt(ing)?\b/i]) assert.doesNotMatch(all, banned);
});
