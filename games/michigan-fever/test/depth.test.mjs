// P2 Phase A: pace and fatigue, consequence chains, home ties, post offices and
// money sent home, and the accuracy upgrades (r3 §5). Written before the code.

import test from "node:test";
import assert from "node:assert/strict";
import * as engine from "../../engine/engine.js";
import { availableActions, makeCtx, newGame, step, view } from "../../engine/engine.js";
import { validateDeck, weightOf } from "../../engine/events.js";
import { deserialize, loadGame, saveGame, serialize } from "../../engine/save.js";
import { clone, isPlainJSON } from "../../engine/state.js";
import { createRng, cursor } from "../../engine/rng.js";
import { dayOfWeek } from "../../engine/clock.js";
import * as T from "../mechanics/travel.js";
import * as H from "../mechanics/health.js";
import * as M from "../mechanics/home.js";
import * as Pm from "../mechanics/purse.js";
import { canDriveOn, driveOn } from "../ui/driveon.js";
import { createRoute, ROUTE_VERSION } from "../route.js";
import { loadRouteFromDisk, readData } from "./load.mjs";
import { STRATEGIES } from "./strategies.mjs";

const route = loadRouteFromDisk();
const data = readData();
const num = route.num;

function routeWith(changes) {
  const d = readData();
  d.numbers = d.numbers.map((n) => (n.id in changes ? { ...n, value: changes[n.id] } : n));
  return createRoute(d);
}
// No illness and no random events: days move only by the rules under test.
const QUIET = Object.fromEntries(readData().numbers.filter((n) => /^(ague\.base\.|dys\.base|cholera\.base|ev\.p\.)/.test(n.id)).map((n) => [n.id, 0]));
const calm = routeWith(QUIET);

function started(bg = "vermont", seed = "d", r = route) {
  const { state } = newGame(r, { seed });
  return step(r, state, { id: `start:${bg}` }).state;
}

function reach(strategy, done, r = route) {
  for (let i = 0; i < 60; i++) {
    const seed = `depth-${strategy}-${i}`;
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

const ids = (s, r = route) => availableActions(r, s).map((a) => a.id);
const adults = (s) => s.party.filter((p) => p.status !== "dead" && p.age >= num("age.adult"));
const P1_EVENTS = ["vt-neighbours", "vt-hill-mud", "vt-note-shaver", "vt-wheel", "vt-emigrant-wagon", "vt-stage", "alb-wharf", "alb-family-rate", "alb-baggage",
  "canal-low-bridge", "canal-crowding", "canal-packet-cabin", "canal-overboard", "canal-team-change", "canal-cholera-rumour", "canal-mosquitoes", "buf-emigrants",
  "buf-broker", "buf-late-season", "lake-gale", "lake-deck-spray", "lake-wave", "lake-sparks", "swamp-mired", "swamp-worst-road", "swamp-fever", "ohio-lame-ox",
  "strip-tavern", "ohio-toll-road", "det-tavern-floor", "det-banks", "det-paper-city", "det-land-office", "det-stage", "road-corduroy", "road-mile-an-hour",
  "road-nail-kegs", "road-wolves", "road-ague-saying", "road-shaking", "road-potawatomi", "road-crowded-inn", "road-flour-scarce", "off-land-mania",
  "off-speculator", "off-specie-rumour", "off-conflict", "off-coin-clerk", "off-surveyor-tip", "off-hire-out", "off-camp-ague", "off-flour", "claim-raising",
  "claim-quinine", "claim-axe", "claim-wet-tract", "claim-letter-postage", "any-flux", "any-trunk", "any-fair-day", "ohio-swamp-guide", "ohio-second-yoke",
  "swamp-rain-tavern"];

// ---- the route version ------------------------------------------------------------

test("the route version is bumped, so a P1 save is refused cleanly", () => {
  assert.equal(ROUTE_VERSION, 2);
  assert.equal(route.version, 2);
  const s = started();
  const old = JSON.parse(serialize(s));
  old.routeVersion = 1;
  old.state.routeVersion = 1;
  assert.deepEqual(deserialize(route, JSON.stringify(old)), { ok: false, reason: "old route version" });
});

// ---- A1: pace and fatigue ---------------------------------------------------------

const goOf = (r, s) => availableActions(r, s).find((a) => a.id === "go");

test("A1: the pace rides on the travel action: a wagon with its own team has three; boats and a teamster none", () => {
  const s = started();
  assert.equal(s.vars.pace, "steady");
  assert.equal(view(route, s).pace, "steady");
  const go = goOf(route, s);
  assert.equal(go.pace, "steady");
  assert.deepEqual(go.paces.map((p) => p.pace), ["steady", "hard", "grueling"]);
  assert.ok(go.paces.every((p) => p.label && p.detail));
  assert.ok(!availableActions(route, s).some((a) => a.type === "pace"), "no separate pace actions");
  const hard = step(calm, s, { id: "go", pace: "hard" }).state;
  assert.equal(hard.vars.pace, "hard");
  assert.equal(goOf(calm, hard).pace, "hard");
  assert.equal(step(calm, hard, "go").state.vars.pace, "hard", "the pace holds until changed");
  assert.equal(step(calm, s, { id: "go", pace: "flying" }).state.vars.pace, "steady", "an unknown pace is ignored");
  const canal = reach("cautious", (x) => x.phase === "travel" && x.leg === "canal");
  assert.equal(goOf(route, canal).paces, undefined, "the boat sets the pace");
  const teamster = clone(s);
  teamster.gear.team = null;
  teamster.gear.teamster = true;
  assert.equal(goOf(route, teamster).paces, undefined, "the teamster sets the pace");
  assert.equal(step(route, teamster, { id: "go", pace: "grueling" }).state.vars.pace, "steady");
});

test("A1: hard and grueling are faster only on good road; the swamp and the forest track cap the speed", () => {
  const miles = (pace, terrain, leg) => {
    const s = started();
    s.vars.pace = pace;
    s.vars.terrain = terrain;
    s.leg = leg;
    return T.dayMiles(makeCtx(route, s), "fair");
  };
  const steady = miles("steady", "hill", "vermont");
  assert.ok(Math.abs(miles("hard", "hill", "vermont") - steady * num("speed.pace.hard")) < 1e-9);
  assert.ok(Math.abs(miles("grueling", "hill", "vermont") - steady * num("speed.pace.grueling")) < 1e-9);
  assert.ok(num("speed.pace.grueling") > num("speed.pace.hard") && num("speed.pace.hard") > 1);
  for (const [terrain, leg] of [["swamp", "overland"], ["track", "claim"]]) {
    assert.equal(miles("grueling", terrain, leg), miles("steady", terrain, leg), `${terrain}: no faster for pushing`);
  }
});

test("A1: fatigue rises with pace and bad road, faster for the team, slower for children", () => {
  const gain = (pace, terrain) => {
    const s = started("vermont", "fat", calm);
    s.vars.terrain = terrain;
    const before = { p1: s.party[0].fatigue, p6: s.party[5].fatigue, team: s.gear.fatigue };
    const r = step(calm, s, { id: "go", pace }).state;
    return { adult: r.party[0].fatigue - before.p1, child: r.party[5].fatigue - before.p6, team: r.gear.fatigue - before.team };
  };
  const steady = gain("steady", "hill");
  const hard = gain("hard", "hill");
  const grueling = gain("grueling", "hill");
  assert.equal(steady.adult, num("fat.day.steady"));
  assert.equal(hard.adult, num("fat.day.hard"));
  assert.equal(grueling.adult, num("fat.day.grueling"));
  assert.equal(grueling.child, num("fat.day.grueling") * num("fat.childMult"));
  assert.equal(grueling.team, num("fat.teamDay.grueling"));
  assert.ok(grueling.team > grueling.adult, "the oxen pay most for the pace");
  const swamp = gain("steady", "swamp");
  assert.equal(swamp.adult, num("fat.day.steady") + num("fat.badRoad"));
  assert.equal(swamp.team, num("fat.teamDay.steady") + num("fat.team.badRoad"));
});

test("A1: rest, lodging and the Sabbath bring fatigue down; it stays within 0-100", () => {
  const tired = () => {
    const s = started("vermont", "rest", calm);
    for (const p of s.party) p.fatigue = 60;
    s.gear.fatigue = 60;
    return s;
  };
  const r = step(calm, tired(), "rest").state;
  assert.equal(r.party[0].fatigue, 60 - num("fat.rest"));
  assert.equal(r.gear.fatigue, 60 - num("fat.team.rest"));
  const s = tired();
  for (const p of s.party) p.fatigue = 3;
  assert.equal(step(calm, s, "rest").state.party[0].fatigue, 0);
  const g = started("vermont", "max", calm);
  for (const p of g.party) p.fatigue = 99;
  assert.equal(step(calm, g, { id: "go", pace: "grueling" }).state.party[0].fatigue, num("fat.max"));
  assert.equal(num("fat.max"), 100);
});

test("A1: keep the Sabbath on a Sunday: a day's rest with more recovery and a morale gain", () => {
  let s = started("vermont", "sab", calm);
  while (dayOfWeek(s.date) !== 0) s = step(calm, s, "go").state;
  assert.ok(ids(s, calm).includes("sabbath"));
  const before = clone(s);
  for (const p of before.party) p.fatigue = 50;
  before.res.morale = 50;
  const kept = step(calm, before, "sabbath").state;
  assert.equal(kept.party[0].fatigue, 50 - num("fat.sabbath"));
  assert.ok(num("fat.sabbath") > num("fat.rest"));
  assert.equal(kept.res.morale, 50 + num("morale.rest") + num("morale.sabbath"));
  assert.ok(!ids(kept, calm).includes("sabbath"), "Monday: no Sabbath");
  const travelled = step(calm, before, "go").state;
  assert.equal(travelled.res.morale, 50, "travelling on Sunday costs nothing but the rest");
});

test("A1: on the boats the pace is the boat's, but crowding rests you less than a berth", () => {
  const recover = (ticket) => {
    const s = clone(reach("cautious", (x) => x.phase === "travel" && x.leg === "canal", calm));
    s.vars.ticket = ticket;
    for (const p of s.party) p.fatigue = 50;
    return 50 - step(calm, s, "go").state.party[0].fatigue;
  };
  assert.equal(recover("packet"), num("fat.boat.berth"));
  assert.equal(recover("line"), num("fat.boat.crowded"));
  assert.ok(num("fat.boat.berth") > num("fat.boat.crowded"));
});

test("A1: high fatigue multiplies the chance of illness", () => {
  const s = started();
  const p = s.party[0];
  const rate = (f) => {
    p.fatigue = f;
    return H.onsetRate(makeCtx(route, s), "ague", false, p);
  };
  const base = rate(0);
  assert.ok(base > 0);
  assert.equal(rate(num("fat.ill.from")), base);
  assert.ok(Math.abs(rate(100) - base * (1 + num("fat.ill.mult"))) < 1e-12);
  assert.ok(rate(85) > rate(60));
});

test("A1: fatigue drives quarrels, injuries, lameness, shoe wear and an ox lost", () => {
  const ev = (id) => route.eventIndex.get(id);
  const FATIGUE_EVENTS = ["travel-quarrel", "travel-stumble", "team-cast-shoe", "team-ox-down"];
  const s = started();
  const ctx = makeCtx(route, s);
  const eligible = (id) => ctx.evalCond(ev(id).when);
  const wear = (f) => { for (const p of s.party) p.fatigue = f; s.gear.fatigue = f; };
  wear(0);
  for (const id of FATIGUE_EVENTS) assert.equal(eligible(id), false, `${id} needs fatigue`);
  wear(num("fat.high"));
  for (const id of FATIGUE_EVENTS) assert.equal(eligible(id), true, `${id} when worn out`);
  // Existing injury and lameness events weigh more when the family or team is worn out.
  const weight = (id, f) => {
    wear(f);
    const claim = id === "claim-axe";
    s.phase = claim ? "claim" : "travel";
    s.leg = claim ? null : "vermont";
    return weightOf(ev(id), makeCtx(route, s));
  };
  for (const id of ["ohio-lame-ox", "any-trunk", "claim-axe"]) assert.ok(weight(id, 90) > weight(id, 0), `${id} weighs more when worn out`);
  // An ox lost: going on short-handed slows the wagon until a new yoke is bought.
  const t = started("vermont", "ox", calm);
  t.vars.terrain = "hill";
  const full = T.dayMiles(makeCtx(calm, t), "fair");
  t.flags.teamShort = true;
  assert.ok(Math.abs(T.dayMiles(makeCtx(calm, t), "fair") - full * num("team.short.mult")) < 1e-9);
});

test("A1: daily quarrels: high fatigue wears down morale", () => {
  const s = started("vermont", "q", calm);
  for (const p of s.party) p.fatigue = num("fat.morale.from");
  s.res.morale = 50;
  const r = step(calm, s, "go").state;
  assert.equal(r.res.morale, 50 - num("fat.morale.loss"));
});

test("A1: drive on stops when anyone's fatigue crosses the high mark, refuses while worn out, and still equals pressing go", () => {
  const s = started("vermont", "drive", calm);
  for (const p of s.party) p.fatigue = num("fat.high") - num("fat.day.grueling") * 2 - 1;
  s.gear.fatigue = 0;
  s.vars.pace = "grueling";
  assert.equal(canDriveOn(engine, calm, s).ok, true);
  const r = driveOn(engine, calm, s);
  assert.equal(r.reason, "tired");
  assert.ok(r.days.length >= 2 && r.days.length <= 4, `${r.days.length} days`);
  assert.ok(r.state.party.some((p) => p.fatigue >= num("fat.high")));
  for (const d of r.days.slice(0, -1)) assert.ok(d.view.party.every((p) => p.fatigue < num("fat.high")));
  let g = s;
  for (let k = 0; k < r.days.length; k++) g = step(calm, g, "go").state;
  assert.equal(JSON.stringify(g), JSON.stringify(r.state));
  assert.deepEqual(canDriveOn(engine, calm, r.state), { ok: false, reason: "Not while the family is this worn out." });
  // The team counts too.
  const t = started("vermont", "drive2", calm);
  t.gear.fatigue = num("fat.high");
  assert.equal(canDriveOn(engine, calm, t).ok, false);
});

test("A1: the HUD view carries fatigue, the pace and the thresholds", () => {
  const s = started();
  s.party[0].fatigue = num("fat.high");
  s.party[1].fatigue = num("fat.tired");
  const v = view(route, s);
  assert.equal(v.pace, "steady");
  assert.deepEqual(v.fatigue, { tired: num("fat.tired"), high: num("fat.high") });
  assert.equal(v.party[0].fatigue, num("fat.high"));
  assert.equal(v.party[0].tired, "worn");
  assert.equal(v.party[1].tired, "tired");
  assert.equal(v.party[2].tired, null);
  assert.equal(typeof v.gear.fatigue, "number");
  assert.ok(isPlainJSON(v));
});

// ---- A2: consequence chains -------------------------------------------------------

function schedulesIn(effects = [], out = []) {
  for (const e of effects) {
    if (e.schedule) out.push(e.schedule.event);
    schedulesIn(e.then, out);
    schedulesIn(e.else, out);
  }
  return out;
}

test("A2: at least 15 existing choices gain a delayed consequence, and 20 new follow-ups exist", () => {
  assert.deepEqual(validateDeck(route), []);
  const p1 = new Set(P1_EVENTS);
  assert.equal(P1_EVENTS.length, 63);
  for (const id of P1_EVENTS) assert.ok(route.eventIndex.get(id), `P1 event ${id} kept`);
  const gained = [];
  for (const e of route.events) if (p1.has(e.id)) for (const c of e.choices ?? []) if (schedulesIn(c.effects).length) gained.push(`${e.id}.${c.id}`);
  assert.ok(gained.length >= 15, `${gained.length} existing choices schedule a consequence: ${gained.join(", ")}`);
  const chain = route.events.filter((e) => e.deck === "chain");
  assert.ok(chain.length >= 20, `${chain.length} follow-up events`);
  // Every follow-up is scheduled by something (an event, a tie at the start), so none is dead data.
  const scheduled = new Set(route.events.flatMap((e) => [...schedulesIn(e.effects), ...(e.choices ?? []).flatMap((c) => schedulesIn(c.effects))]));
  for (const t of data.text.ties) for (const ev of t.schedule ?? []) scheduled.add(ev.event);
  for (const e of chain) assert.ok(scheduled.has(e.id), `${e.id} is never scheduled`);
});

test("A2: a skipped repair breaks the wagon down the road", () => {
  let s = started("vermont", "axle", calm);
  s.pending = { kind: "event", id: "vt-wheel", vars: {} };
  s = step(calm, s, "choose:wedge").state;
  assert.ok(s.queue.some((q) => q.event === "chain-axle"));
  const due = s.queue.find((q) => q.event === "chain-axle").due;
  let fired = false;
  for (let i = 0; i < 40 && !fired && !s.over; i++) {
    const r = step(calm, s, s.pending ? availableActions(calm, s)[0] : "go");
    if (r.beats.some((b) => b.type === "event" && b.id === "chain-axle")) {
      fired = true;
      assert.ok(r.state.day >= due);
    }
    s = r.state;
  }
  assert.ok(fired, "the wedged wheel gives out");
});

test("A2: a Buffalo debt comes due at Detroit, unless it was paid", () => {
  const atBuffalo = reach("cautious", (x) => x.phase === "town" && x.place === "buffalo", calm);
  let s = clone(atBuffalo);
  s.pending = { kind: "event", id: "buf-loan", vars: {} };
  s = step(calm, s, "choose:take").state;
  const q = s.queue.find((x) => x.event === "chain-loan-due");
  assert.deepEqual(q.at, "detroit");
  // Arriving at Detroit fires it ahead of any random town event.
  const ctx = makeCtx(calm, s);
  s.phase = "town";
  s.place = "detroit";
  assert.equal(ctx.fireDue(), true);
  assert.equal(s.pending?.id, "chain-loan-due");
});

// ---- A3: home ties ----------------------------------------------------------------

test("A3: each family draws 2-3 ties from the pool of six, weighted by background", () => {
  const counts = {};
  for (const bg of ["vermont", "connecticut", "widow"]) {
    counts[bg] = {};
    for (let i = 0; i < 150; i++) {
      const s = started(bg, `ties-${i}`);
      assert.ok(s.ties.length >= num("tie.count.min") && s.ties.length <= num("tie.count.max"), `${s.ties.length} ties`);
      assert.equal(new Set(s.ties.map((t) => t.id)).size, s.ties.length);
      for (const t of s.ties) {
        assert.ok(M.TIE_IDS.includes(t.id));
        assert.equal(t.amount, Math.round(num(`tie.${t.id}.amount`) * 100));
        counts[bg][t.id] = (counts[bg][t.id] ?? 0) + 1;
      }
    }
  }
  assert.equal(M.TIE_IDS.length, 6);
  assert.equal(counts.connecticut.sweetheart ?? 0, 0, "no grown child to leave a sweetheart");
  assert.ok((counts.widow.sweetheart ?? 0) > (counts.vermont.sweetheart ?? 0), "the widow's grown son is the likelier betrothed");
  assert.ok((counts.vermont.parent ?? 0) > (counts.widow.parent ?? 0));
  for (const id of M.TIE_IDS) {
    assert.equal(route.numbers.get(`tie.${id}.amount`).tag, "invented", `${id}: sizes are invented (r3 §7)`);
    assert.match(route.numbers.get(`tie.${id}.amount`).note, /invented|unresolved|no source/i);
  }
  const v = view(route, started("vermont", "ties-0"));
  assert.ok(v.ties.length >= 2 && v.ties.every((t) => t.label && typeof t.amount === "number" && ["open", "settled", "lost"].includes(t.status)));
});

// ---- A3: post offices and postage ------------------------------------------------

test("A3: postage by distance band, doubled per sheet (Act of 1825)", () => {
  const rate = (mi) => M.bandRate(num, mi);
  assert.deepEqual([30, 31, 80, 81, 150, 151, 400, 401].map(rate), [0.06, 0.1, 0.1, 0.125, 0.125, 0.1875, 0.1875, 0.25]);
  assert.equal(M.postage(num, 500, 1), 25);
  assert.equal(M.postage(num, 500, 2), 50);
  assert.equal(M.postage(num, 500, 3), 75);
  assert.equal(M.postage(num, 500, 6), 100, "a packet of four or more pieces pays four times");
  assert.equal(M.postage(num, 100, 1), 13, "12.5 cents, rounded to the cent");
  assert.equal(M.officeMiles(num, "albany"), num("mi.vermont"));
  for (const o of ["buffalo", "perrysburg", "detroit", "bronson"]) assert.ok(M.officeMiles(num, o) > 400, o);
  for (const id of ["post.band.1.rate", "post.band.5.rate", "post.band.4.miles"]) {
    const n = route.numbers.get(id);
    assert.equal(n.tag, "src");
    assert.equal(n.confidence, "solid");
  }
});

// At the post office: the one action opens the post-office event.
const atPost = (s, r = route) => step(r, s, "post").state;
const choices = (s, r = route) => availableActions(r, s).map((a) => a.choice);

test("A3: post offices at Albany, Buffalo, Detroit and Bronson; a letter home costs the band's postage", () => {
  const albany = reach("cautious", (x) => x.phase === "town" && x.place === "albany");
  assert.ok(ids(albany).includes("post"));
  let p = atPost(albany);
  assert.equal(p.pending?.id, "post-office");
  assert.ok(choices(p).includes("ask") && choices(p).includes("write") && choices(p).includes("leave"));
  for (const t of albany.ties) assert.ok(choices(p).includes(`send-${t.id}`), `send for ${t.id}`);
  assert.equal(availableActions(route, p).filter((a) => a.choice.startsWith("send-")).length, albany.ties.length, "only the family's own ties");
  const write = availableActions(route, p).find((a) => a.choice === "write");
  assert.match(write.label, /\$0\.13 postage/, "12.5 cents to Albany, rounded");
  const bronson = reach("cautious", (x) => x.phase === "office");
  assert.match(availableActions(route, atPost(bronson)).find((a) => a.choice === "write").label, /\$0\.25 postage/);
  const road = reach("cautious", (x) => x.phase === "travel" && x.leg === "road");
  assert.ok(!ids(road).includes("post"));
  // Asked once a visit; written once a visit.
  p = step(route, step(route, atPost(albany), "choose:write").state, "post").state;
  assert.ok(!choices(p).includes("write"));
});

test("A3: writing home is a fiction letter beat", () => {
  const s = reach("cautious", (x) => x.phase === "town" && x.place === "albany");
  const r = step(route, atPost(s), "choose:write");
  const letter = r.beats.find((b) => b.type === "letter");
  assert.ok(letter);
  assert.equal(letter.fiction, true);
  assert.match(letter.label, /fiction/i);
  assert.notEqual(letter.from, "home");
  assert.doesNotMatch(letter.text, /[{}]/);
  assert.equal(r.state.vars.lettersHome, 1);
});

test("A3: letters wait at the post office; collecting costs postage and gives from-home letter beats", () => {
  const s = clone(reach("cautious", (x) => x.phase === "town" && x.place === "albany"));
  s.purse.coin += 500;
  const waiting = M.waitingMail(s, "albany");
  assert.ok(waiting.length >= 1, "a letter from home waits at Albany");
  let r = step(route, atPost(s), "choose:ask");
  assert.equal(r.state.pending?.id, "post-letters");
  const cost = waiting.reduce((a, m) => a + M.postage(num, M.officeMiles(num, "albany"), m.sheets), 0);
  const expected = clone(r.state);
  assert.equal(Pm.pay(expected, num, cost), true);
  r = step(route, r.state, "choose:take");
  const letters = r.beats.filter((b) => b.type === "letter");
  assert.equal(letters.length, waiting.length);
  for (const b of letters) {
    assert.equal(b.fiction, true);
    assert.equal(b.from, "home");
    assert.ok(b.sender && b.to && b.text && b.label);
    assert.match(b.label, /fiction/i);
    assert.doesNotMatch(b.text, /[{}]/);
    // A letter is dated when it was written at home, before it could reach the office.
    assert.ok(b.date < r.state.date, `letter dated ${b.date}, collected ${r.state.date}`);
  }
  assert.deepEqual(r.state.purse, expected.purse, "postage paid like any purchase, paper first");
  assert.equal(M.waitingMail(r.state, "albany").length, 0);
  // The post office menu comes back after the letters, with its own labels filled in.
  assert.equal(r.state.pending?.id, "post-office");
  for (const a of availableActions(route, r.state)) assert.doesNotMatch(a.label, /[{}]/, a.label);
  assert.ok(!choices(r.state).includes("ask"), "asked once a visit");
  const write = availableActions(route, r.state).find((a) => a.choice === "write");
  assert.equal(write.enabled, true, "the postage for a letter home is still affordable");
  assert.ok(!ids(step(route, r.state, "choose:leave").state).includes("post"), "one call at the post office a visit");
  // Left uncollected: advertised, then the dead-letter office.
  const left = step(route, step(route, atPost(s), "choose:ask").state, "choose:leave");
  assert.ok(left.beats.some((b) => b.type === "narrate" && /advertised/.test(b.text) && /dead-letter/i.test(b.text)));
});

test("A3: money home goes in notes cut in halves (two letters) or whole (one); only a lost half pair loses it", () => {
  const atAlbany = clone(reach("cautious", (x) => x.phase === "town" && x.place === "albany"));
  const tie = atAlbany.ties[0];
  atAlbany.purse.notes.ne = 100000;
  atAlbany.purse.coin = 1000;
  const send = (r, how) => {
    let s = step(r, atPost(atAlbany, r), `choose:send-${tie.id}`).state;
    assert.equal(s.pending?.id, "post-send-how");
    return step(r, s, `choose:${how}`);
  };
  for (const [p, how, lost] of [[0, "halves", false], [1, "halves", true], [0, "whole", false], [1, "whole", true]]) {
    const r = send(routeWith({ "post.lossP": p }), how);
    const t = r.state.ties.find((x) => x.id === tie.id);
    assert.equal(t.status === "settled", !lost, `${how} at loss ${p}`);
    // New England paper goes at face (it is worth par at home); the postage is paid like any purchase.
    const one = M.postage(num, M.officeMiles(num, "albany"), 2);
    const expected = clone(atAlbany);
    expected.purse.notes.ne -= tie.amount;
    Pm.pay(expected, num, how === "halves" ? 2 * one : one);
    assert.deepEqual(r.state.purse, expected.purse);
    assert.ok(r.beats.some((b) => b.type === "letter" && b.fiction));
  }
  // Halves: with a coin-flip per letter, the money is lost only when both halves are.
  const half = routeWith({ "post.lossP": 0.5 });
  const losses = (how) => {
    let n = 0;
    for (let i = 0; i < 200; i++) {
      const s = clone(atAlbany);
      s.rng = createRng(`half-${i}`);
      let st = step(half, atPost(s, half), `choose:send-${tie.id}`).state;
      st = step(half, st, `choose:${how}`).state;
      if (st.ties.find((x) => x.id === tie.id).status !== "settled") n++;
    }
    return n;
  };
  const h = losses("halves");
  const w = losses("whole");
  assert.ok(h < w, `halves lost ${h}, whole lost ${w}`);
  assert.ok(h > 20 && h < 80 && w > 70 && w < 130);
});

test("A3: an unpaid tie goes wrong at home on its date; a paid one mostly goes right; the news comes by letter and ends in the epilogue", () => {
  const s = started("vermont", "parent", routeWith({ "tie.parent.dieP.unpaid": 1, "tie.parent.dieP.paid": 0 }));
  s.ties = [{ id: "parent", amount: 2000, sent: 0, status: "open", outcome: null, learned: false }, { id: "store", amount: 1000, sent: 1000, status: "settled", outcome: null, learned: false }];
  s.date = route.num("tie.parent.due");
  const r1 = routeWith({ "tie.parent.dieP.unpaid": 1, "tie.parent.dieP.paid": 0, "tie.store.postP": 1 });
  const after = step(r1, s, "rest").state;
  assert.equal(after.ties[0].outcome, "died");
  assert.equal(after.ties[1].outcome, "cleared", "the paid store account, past its own date, comes out cleared");
  const r2 = routeWith({ "tie.parent.dieP.unpaid": 1, "tie.parent.dieP.paid": 0 });
  const paid = clone(s);
  paid.ties[0].status = "settled";
  assert.equal(step(r2, paid, "rest").state.ties[0].outcome, "cared");
  // The epilogue carries the ties, marked as fiction.
  const ctx = makeCtx(route, clone(after));
  const end = route.ending(ctx, { outcome: "winter" });
  const home = end.epilogue.filter((e) => e.fiction);
  assert.ok(home.length >= 1 && home.every((e) => e.text && !/[{}]/.test(e.text)));
});

test("A3: tie events: a mortgage agent waits at Detroit unless the mortgage is paid", () => {
  const s = started("vermont", "mort");
  s.ties = [{ id: "mortgage", amount: 5000, sent: 0, status: "open", outcome: null, learned: false }];
  s.queue = [];
  const ctx = makeCtx(route, s);
  M.scheduleTies(ctx);
  const q = s.queue.find((x) => x.event === "tie-mortgage-agent");
  assert.deepEqual([q.at, q.unless], ["detroit", { tie: ["mortgage", "settled"] }]);
});

// ---- A4: accuracy upgrades (r3 §5) -----------------------------------------------

test("A4: the r3 §5 table, id by id", () => {
  const n = (id) => route.numbers.get(id);
  assert.deepEqual([n("mi.marshallBronson").value, n("mi.marshallBronson").tag, n("mi.marshallBronson").confidence], [25, "src", "likely"]);
  assert.match(n("mi.marshallBronson").source, /Blois/);
  assert.deepEqual([n("canal.lineMph").value, n("canal.lineMph").tag], [3, "src"]);
  assert.match(n("canal.lineMph").note, /more than a week/);
  assert.deepEqual([n("price.flour.east").value, n("price.flour.east").tag], [8.38, "src"]);
  for (const [id, v] of [["price.pork.lb", 0.25], ["price.potatoes.bu", 1], ["price.salt.barrel", 10]]) {
    assert.deepEqual([n(id).value, n(id).tag], [v, "src"], id);
    assert.match(n(id).source, /Pioneer and Historical Collections vol\. 18/);
  }
  assert.deepEqual([n("fare.winterStage").value, n("fare.winterStage").tag, n("fare.winterStage").confidence], [25, "src", "solid"]);
  assert.deepEqual([n("mi.detroitChicago").value, n("fare.stage.chicago").value], [254, 21]);
  assert.equal(n("mi.detroitChicago").tag, "src");
  assert.equal(n("fare.stage.chicago").tag, "src");
  // Michigan provisions are priced from the PC18 pork and potatoes.
  const s = reach("cautious", (x) => x.phase === "travel" && x.leg === "road" && ids(x).includes("buy:provisions"));
  const want = Math.round((num("food.provisions.porkLb") * num("price.pork.lb") + num("food.provisions.potatoBu") * num("price.potatoes.bu")) * 100);
  assert.equal(availableActions(route, s).find((a) => a.id === "buy:provisions").cost, want);
  // The §7 items stay invented.
  for (const id of ["winter.graceDays", "date.snowEarliest", "price.wagon", "price.flour.detroit", "post.lossP"]) assert.equal(n(id).tag, "invented", id);
});

// ---- determinism and saving with the new state -----------------------------------

test("determinism and a save round trip cover fatigue, the queue, ties and letters", () => {
  // A policy that uses the new systems: pushes hard, keeps the Sabbath, collects letters, sends money home.
  const policy = (s) => {
    const acts = availableActions(route, s).filter((a) => a.enabled);
    const pick = (id) => acts.find((a) => a.id === id);
    if (s.pending) return acts.find((a) => ["take", "halves", "wedge"].includes(a.choice)) ?? acts.find((a) => a.choice?.startsWith("send-")) ?? acts.find((a) => a.choice === "ask") ?? acts[0];
    const go = pick("go");
    if (go?.paces) return { ...go, pace: "hard" };
    return pick("sabbath") ?? (!s.vars.visit.used.post ? pick("post") : undefined) ?? acts.find((a) => a.forward) ?? acts[0];
  };
  const run = (s, n) => { for (let i = 0; i < n && !s.over; i++) s = step(route, s, policy(s)).state; return s; };
  const a = run(started("vermont", "det2"), 220);
  const b = run(started("vermont", "det2"), 220);
  assert.deepEqual(a, b);
  const mid = run(started("vermont", "det2"), 60);
  assert.ok(mid.party.some((p) => p.fatigue > 0), "fatigue in the save");
  assert.ok(mid.ties.length && mid.mail.length, "ties and letters in the save");
  assert.ok(mid.mail.some((m) => m.status !== "waiting") || mid.ties.some((t) => t.status !== "open"), "the policy used the post office");
  const withQueue = run(started("vermont", "det2"), 220);
  assert.ok(isPlainJSON(withQueue));
  const storage = (() => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; })();
  // Find a moment with something in the queue, save it, and play on from the load.
  let q = started("vermont", "det2");
  for (let i = 0; i < 220 && !q.over && !(q.queue.length && !q.pending); i++) q = step(route, q, policy(q)).state;
  assert.ok(q.queue.length, "a queued consequence to save");
  assert.equal(saveGame(q, { storage }), true);
  const loaded = loadGame(route, { storage });
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.state, q);
  assert.deepEqual(run(loaded.state, 120), run(q, 120));
});
