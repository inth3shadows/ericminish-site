// P2 Phase B review, round 8 (.review/add-michigan-fever.md): PB1-PB7. Written before
// the fixes, from the reviewer's seeds (scratchpad/review-pb/).

import test from "node:test";
import assert from "node:assert/strict";
import { availableActions, makeCtx, newGame, step, view } from "../../engine/engine.js";
import { createRng, cursor } from "../../engine/rng.js";
import { compare } from "../../engine/clock.js";
import * as T from "../mechanics/travel.js";
import * as P from "../mechanics/purse.js";
import * as Pa from "../mechanics/paths.js";
import * as M from "../mechanics/home.js";
import * as UA from "../ui/actions.js";
import { createRoute } from "../route.js";
import { readData, loadRouteFromDisk } from "./load.mjs";
import { STRATEGIES } from "./strategies.mjs";

const route = loadRouteFromDisk();
const num = route.num;

function routeWith(changes) {
  const d = readData();
  d.numbers = d.numbers.map((n) => (n.id in changes ? { ...n, value: changes[n.id] } : n));
  return createRoute(d);
}
const QUIET = Object.fromEntries(readData().numbers.filter((n) => /^(ague\.base\.|dys\.base|cholera\.base|ev\.p\.|wx\.rain\.)/.test(n.id)).map((n) => [n.id, 0]));
const calm = routeWith(QUIET);

// Play a tier-table game (seed `tier-<name>-<i>`) until `stop(state)` holds or it ends.
// Returns the state, and the beats of the last step.
function play(name, i, stop = () => false, r = route) {
  const seed = `tier-${name}-${i}`;
  const rng = cursor(createRng(`player-${seed}`));
  let { state } = newGame(r, { seed });
  let beats = [];
  for (let n = 0; !state.over && n < 900 && !stop(state); n++) {
    const a = STRATEGIES[name](r, state, availableActions(r, state), { seedIndex: i, rng });
    const res = step(r, state, a);
    assert.ok(!res.beats.some((b) => b.type === "error"), `${seed}: ${a.id}`);
    state = res.state;
    beats = res.beats;
  }
  return { state, beats };
}

function go(s, id, r = route) {
  const res = step(r, s, id);
  assert.ok(!res.beats.some((b) => b.type === "error"), `${id}: ${JSON.stringify(res.beats.find((b) => b.type === "error"))}`);
  return res;
}

const atNews = (s) => s.pending?.id === "win-suspension-news";

// ---- PB1 ---------------------------------------------------------------------------

test("PB1: the suspension news reaches the Detroit winter on or before 16 May, though the winter goes by the week (seed tier-carefulDetroit-21)", () => {
  const { state } = play("carefulDetroit", 21, atNews);
  assert.ok(atNews(state), "the news came");
  assert.equal(state.vars.path, "detroit");
  assert.ok(compare(state.date, "1837-05-16") <= 0, `the news came on ${state.date}, after the banks stopped`);
  // Changing notes that day never pays more than the notes are worth that day.
  const value = P.noteValue(state, num, "mi");
  const after = go(state, "choose:change").state;
  assert.ok(after.purse.coin - state.purse.coin <= value, `${after.purse.coin - state.purse.coin} for notes worth ${value}`);
});

test("PB1: over forty carefulDetroit games, the news never comes after 16 May", () => {
  let seen = 0;
  for (let i = 0; i < 40; i++) {
    const { state } = play("carefulDetroit", i, atNews);
    if (!atNews(state)) continue;
    seen += 1;
    assert.ok(compare(state.date, "1837-05-16") <= 0, `tier-carefulDetroit-${i}: news on ${state.date}`);
  }
  assert.ok(seen >= 10, `only ${seen} games saw the news`);
});

test("PB1: an exchange never pays more than the notes are worth that day, even after the suspension", () => {
  const { state } = play("carefulDetroit", 21, atNews);
  const s = structuredClone(state);
  s.date = "1837-05-19";
  assert.ok(P.suspended(s, num));
  const value = P.noteValue(s, num, "mi");
  const after = go(s, "choose:change").state;
  assert.ok(after.purse.coin - s.purse.coin <= value, `${after.purse.coin - s.purse.coin} coin for Michigan notes worth ${value}`);
});

test("PB1: news held up past the suspension is dropped, not told a day late", () => {
  const { state } = play("carefulDetroit", 21, (s) => s.vars.path === "detroit" && s.phase === "winter" && !s.pending);
  const s = structuredClone(state);
  const q = s.queue.find((x) => x.event === "win-suspension-news");
  assert.ok(q, "queued at the pivot");
  q.due = s.day;
  s.date = "1837-05-18";
  s.vars.griefDays = 0;
  const after = go(s, "week:rest").state;
  assert.ok(!atNews(after), "not told on 25 May that the banks stop tomorrow");
  assert.ok(!(after.queue ?? []).some((x) => x.event === "win-suspension-news"));
});

// ---- PB2 ---------------------------------------------------------------------------

for (const i of [36, 22]) {
  test(`PB2: home tier 2 rests on the ties paid in time, not on the luck at home (seed tier-carefulHome-${i})`, () => {
    const { state, beats } = play("carefulHome", i);
    assert.equal(state.vars.path, "home");
    assert.ok(state.party.every((p) => p.status !== "dead"), "the family whole");
    assert.ok(compare(state.vars.homeOn, state.vars.winterDate) < 0, "home before winter");
    assert.ok(state.ties.every((t) => t.status === "settled"), "every tie settled");
    assert.equal(state.over.tier, 2, JSON.stringify(state.ties.map((t) => [t.id, t.status, t.outcome])));
    // The ending still tells the outcome at home as it fell out.
    const end = beats.find((b) => b.type === "end");
    const lines = end.epilogue.map((e) => e.text).join(" ");
    for (const t of state.ties) {
      if (t.outcome === "married") assert.match(lines, /married/);
      if (t.id === "parent" && t.outcome) {
        assert.equal(t.outcome === "died", false, "a parent who died with the keep paid is not told as unpaid");
        if (t.outcome === "passed") assert.match(lines, /cared for to the end/);
      }
    }
    assert.ok(!/had not been paid/.test(lines), lines);
  });
}

test("PB2: a parent who dies with the keep paid is 'passed' (cared for), and still hard news", () => {
  const r = routeWith({ "tie.parent.dieP.paid": 1 });
  const { state } = newGame(r, { seed: "pb2" });
  const s = go(state, "start:vermont", r).state;
  s.ties = [{ id: "parent", who: "Father", amount: 2000, sent: 2000, status: "settled", outcome: null, learned: false }];
  s.date = num("tie.parent.due");
  const after = go(s, "rest", r).state;
  assert.equal(after.ties[0].outcome, "passed");
  assert.equal(after.ties[0].inTime, true);
  assert.ok(M.BAD.has("passed"), "a letter telling of it lowers morale like any death at home");
});

test("PB2: a tie paid after its date at home still blocks tier 2, whatever came of it", () => {
  const { state } = newGame(route, { seed: "pb2b" });
  const s = go(state, "start:vermont").state;
  s.vars.path = "home";
  s.vars.homeOn = "1836-10-20";
  // Rolled unpaid (the creditor waited), then paid on coming home: not seen to in time.
  s.ties = [{ id: "note", amount: 2000, sent: 2000, status: "settled", outcome: "waiting", inTime: false, learned: true }];
  assert.equal(Pa.tierOf(s, num, "home"), 1);
  // Paid in time, and the sweetheart married anyway: the family did its part.
  s.ties = [{ id: "sweetheart", amount: 2000, sent: 2000, status: "settled", outcome: "married", inTime: true, learned: true }];
  assert.equal(Pa.tierOf(s, num, "home"), 2);
  // Never paid: blocks.
  s.ties = [{ id: "note", amount: 2000, sent: 0, status: "open", outcome: "waiting", learned: true }];
  assert.equal(Pa.tierOf(s, num, "home"), 1);
});

// ---- PB3 ---------------------------------------------------------------------------

test("PB3: every leg's travel action has a label (a non-empty string)", () => {
  for (const leg of Object.keys(T.LEGS)) {
    const { state } = newGame(calm, { seed: `pb3-${leg}` });
    const s = go(state, "start:vermont", calm).state;
    s.land.claimMiles = 6;
    s.vars.passageDays = 20;
    T.startLeg(makeCtx(calm, s), leg);
    const a = availableActions(calm, s).find((x) => x.id === "go");
    assert.ok(a, `${leg}: a go action`);
    assert.equal(typeof a.label, "string", `${leg}: ${a.label}`);
    assert.ok(a.label.trim().length > 0 && !/undefined/.test(a.label), `${leg}: "${a.label}"`);
  }
});

test("PB3: the action bar never shows 'undefined' for an action without a label", () => {
  assert.equal(UA.choiceLabel({ id: "go", label: "Another day on the lake" }), "Another day on the lake");
  for (const bad of [{ id: "go" }, { id: "go", label: undefined }, { id: "go", label: "" }, { id: "go", label: null }]) {
    const l = UA.choiceLabel(bad);
    assert.equal(typeof l, "string");
    assert.ok(l.length > 0 && !/undefined|null/.test(l), l);
  }
  assert.equal(UA.choiceLabel({ group: "more", label: "More" }), "More …");
});

// ---- PB4 ---------------------------------------------------------------------------

function confirmHome(s) {
  const r = go(s, "pivot:home");
  assert.equal(r.state.pending?.id, "pivot-home");
  return r.beats.find((b) => b.type === "event").text;
}

test("PB4: the turn-back confirm at Buffalo describes the way home from Buffalo (seed tier-careful-3)", () => {
  const { state } = play("careful", 3, (s) => s.phase === "town" && s.place === "buffalo" && !s.pending);
  assert.equal(state.place, "buffalo");
  const text = confirmHome(state);
  assert.ok(!/to Buffalo/.test(text), text);
  assert.match(text, /Albany/);
  assert.match(text, /about \d+ days/);
});

test("PB4: the turn-back confirm at Detroit describes the lake (or the stage) to Buffalo", () => {
  const { state } = play("careful", 3, (s) => s.phase === "town" && s.place === "detroit" && !s.pending);
  assert.equal(state.place, "detroit");
  const text = confirmHome(state);
  assert.match(text, /to Buffalo/);
  assert.match(text, /about \d+ days/);
});

test("PB4: the turn-back confirm at Bronson describes the Territorial Road back to Detroit", () => {
  const { state } = play("careful", 3, (s) => s.phase === "office" && s.place === "bronson" && !s.pending && !s.land.paid);
  assert.equal(state.place, "bronson");
  const text = confirmHome(state);
  assert.match(text, /Territorial Road back to Detroit/);
});

// ---- PB5, PB7 ----------------------------------------------------------------------

// A family on the Ohio road at the Black Swamp's edge, `past` miles beyond Sandusky's mark
// in the road segment (an inconsistent state that the old `progress` effect could make).
function atSwampEdge(past, r = calm) {
  const { state } = newGame(r, { seed: "pb5" });
  const s = go(state, "start:vermont", r).state;
  T.startLeg(makeCtx(r, s), "overland");
  const len = T.segMiles(s, r.num, "overland", 0);
  Object.assign(s.vars, { seg: 0, terrain: "road", segMi: len + past, legMi: len + past, pace: "grueling", tollMi: 0 });
  s.gear.fatigue = 0;
  s.res.food = 5000;
  s.purse = { coin: 50000, notes: { ne: 0, ny: 0, mi: 0 } };
  s.queue = [];
  return s;
}

const fullDay = (s, terrain, r = calm) => {
  const c = structuredClone(s);
  c.vars.terrain = terrain;
  return T.dayMiles(makeCtx(r, c), "fair", terrain);
};

test("PB5: a day that starts at or past a segment's end never runs a negative piece or more than a full day", () => {
  for (const past of [0, 4]) {
    const s = atSwampEdge(past);
    const swamp = fullDay(s, "swamp");
    const run = T.dayRun(makeCtx(calm, structuredClone(s)), "fair");
    assert.ok(run.every((p) => p.miles >= 0), `past ${past}: ${JSON.stringify(run)}`);
    const total = run.reduce((a, p) => a + p.miles, 0);
    assert.ok(total <= swamp + 1e-9, `past ${past}: ${total} miles vs a full swamp day ${swamp}`);
    const after = go(s, { id: "go", pace: "grueling" }, calm).state;
    assert.equal(after.vars.seg, 1);
    assert.ok(after.vars.legMi - s.vars.legMi <= swamp + 1e-9, `past ${past}: moved ${after.vars.legMi - s.vars.legMi}, a swamp day is ${swamp}`);
    assert.ok(after.vars.tollMi <= swamp + 1e-9, `past ${past}: toll miles ${after.vars.tollMi}`);
  }
});

test("PB5: a day crossing several short segments splits at each boundary", () => {
  // The swamp cut to 2 miles: a guided day from 1 mile short of Sandusky crosses it into the strip.
  const r = routeWith({ ...QUIET, "mi.sanduskyPerrysburg": 2 });
  const s = atSwampEdge(-1, r);
  s.vars.pace = "steady";
  s.flags.swampGuide = true;
  const road = fullDay(s, "road", r);
  const swamp = fullDay(s, "swamp", r);
  const strip = fullDay(s, "strip", r);
  const fracLeft = 1 - 1 / road - 2 / swamp;
  assert.ok(fracLeft > 0, "the day reaches the strip");
  const run = T.dayRun(makeCtx(r, structuredClone(s)), "fair");
  assert.deepEqual(run.map((p) => p.terrain), ["road", "swamp", "strip"]);
  assert.ok(Math.abs(run[0].miles - 1) < 1e-9 && Math.abs(run[1].miles - 2) < 1e-9);
  assert.ok(Math.abs(run[2].miles - fracLeft * strip) < 1e-9);
  const after = go(s, "go", r).state;
  assert.equal(after.vars.seg, 2);
  assert.ok(Math.abs(after.vars.segMi - fracLeft * strip) < 1e-9);
});

// legMi always equals the finished segments plus segMi.
function consistent(s, r = route) {
  let before = 0;
  for (let i = 0; i < s.vars.seg; i++) before += T.segMiles(s, r.num, s.leg, i);
  return Math.abs(s.vars.legMi - (before + s.vars.segMi)) < 1e-9;
}

test("PB5: miles gained by an event stop at the next place, and keep segMi and legMi together", () => {
  const s = atSwampEdge(-1);
  assert.ok(consistent(s, calm));
  const ctx = makeCtx(calm, s);
  ctx.applyEffects([{ progress: 5 }]);
  assert.ok(s.vars.segMi <= T.segMiles(s, num, "overland", 0) + 1e-9, `segMi ${s.vars.segMi}`);
  assert.ok(consistent(s, calm));
});

test("PB7: miles lost by an event keep legMi and segMi together; the HUD's progress never jumps back past a town or below 0", () => {
  const s = atSwampEdge(0);
  s.vars.seg = 1;
  s.vars.terrain = "swamp";
  s.vars.segMi = 3;
  s.vars.legMi = T.segMiles(s, num, "overland", 0) + 3;
  const shown = T.progressView(s, num).done;
  makeCtx(calm, s).applyEffects([{ progress: -10 }]);
  assert.ok(consistent(s, calm), `legMi ${s.vars.legMi} segMi ${s.vars.segMi}`);
  const now = T.progressView(s, num).done;
  assert.ok(now >= 0 && shown - now <= 3, `progress ${shown} -> ${now}`);
  // At the very start of a leg, a loss leaves the family where it is.
  const t = atSwampEdge(0);
  Object.assign(t.vars, { seg: 0, segMi: 4, legMi: 4 });
  makeCtx(calm, t).applyEffects([{ progress: -10 }]);
  assert.equal(t.vars.legMi, 0);
  assert.equal(T.progressView(t, num).done, 0);
});

// ---- PB6 ---------------------------------------------------------------------------

// The Detroit path at Bronson in the spring of 1837, looking for land, the speculator at hand.
function springSpeculator(purse) {
  const { state } = play("carefulDetroit", 28, (s) => s.vars.path === "detroit" && s.phase === "office" && !s.pending);
  assert.equal(state.phase, "office");
  const s = structuredClone(state);
  s.purse = structuredClone(purse);
  s.party.forEach((p) => { if (p.status === "dead") p.status = "well"; });
  const ctx = makeCtx(route, s);
  ctx.startEvent("off-speculator", {});
  return s;
}

test("PB6: Detroit tier 2 needs the land bought in coin: the speculator's forty paid in paper is tier 1", () => {
  const paper = go(springSpeculator({ coin: 0, notes: { ne: 0, ny: 0, mi: 50000 } }), "choose:buy").state;
  assert.ok(paper.over, "the path ends with land bought");
  assert.equal(paper.over.outcome, "spring-land");
  assert.equal(paper.over.tier, 1, "bought in paper");
  const coin = go(springSpeculator({ coin: 50000, notes: { ne: 0, ny: 0, mi: 0 } }), "choose:buy").state;
  assert.equal(coin.over?.tier, 2, "bought in coin");
});

test("PB6: seed tier-carefulDetroit-28 does not reach tier 2 on land paid for in paper", () => {
  let paperLand = false;
  const seed = "tier-carefulDetroit-28";
  const rng = cursor(createRng(`player-${seed}`));
  let { state } = newGame(route, { seed });
  for (let n = 0; !state.over && n < 900; n++) {
    const a = STRATEGIES.carefulDetroit(route, state, availableActions(route, state), { seedIndex: 28, rng });
    const before = state;
    state = step(route, state, a).state;
    const face = (x) => x.purse.notes.ne + x.purse.notes.ny + x.purse.notes.mi;
    if (!before.land.paid && state.land.paid && face(state) < face(before)) paperLand = true;
  }
  if (paperLand) assert.notEqual(state.over.tier, 2, "land in paper is not land in coin");
  else assert.equal(state.over.tier === 2, state.land.paid && state.land.coin === true && state.party.every((p) => p.status !== "dead"));
});
