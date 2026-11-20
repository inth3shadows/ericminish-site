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
import { addDays, dayOfWeek } from "../../engine/clock.js";
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
  // N-A2 (user decision 2026-11-19): fatigue costs below the knee too. This
  // replaced "rate(fat.ill.from) equals base" (no cost up to the knee).
  assert.ok(Math.abs(rate(num("fat.ill.from")) - base * (1 + num("fat.ill.low"))) < 1e-12);
  assert.ok(rate(num("fat.ill.from")) > base);
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
  // N-A4: kept exact; the counter drops the odd half cent (was: rounded up to 13).
  assert.equal(M.postage(num, 100, 1), 12.5, "12.5 cents, exact");
  assert.equal(M.charge(M.postage(num, 100, 1)), 12, "paid as 12 cents: the half cent dropped in the family's favour");
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
  assert.match(write.label, /\$0\.12 postage/, "12.5 cents to Albany, the odd half cent dropped (N-A4; was $0.13)");
  const bronson = reach("cautious", (x) => x.phase === "office");
  assert.match(availableActions(route, atPost(bronson)).find((a) => a.choice === "write").label, /\$0\.25 postage/);
  const road = reach("cautious", (x) => x.phase === "travel" && x.leg === "road");
  assert.ok(!ids(road).includes("post"));
  // Asked once a visit; written once a visit. (PA1: this passed vacuously before:
  // "post" was refused, so p had no menu at all. Now the menu is checked.)
  p = step(route, atPost(albany), "choose:write").state;
  assert.equal(p.pending?.id, "post-office");
  assert.ok(choices(p).includes("leave"));
  assert.ok(!choices(p).includes("write"));
  assert.ok(!ids(step(route, step(route, p, "choose:leave").state, "post").state).includes("post"), "one call a visit");
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
  // PA3 (widened): and not once the note's date has come and gone at home (was: settled only).
  assert.deepEqual([q.at, q.unless], ["detroit", { any: [{ tie: ["mortgage", "settled"] }, { tie: ["mortgage", "decided"] }] }]);
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

// ---- Phase A review fixes (PA1-PA10, N-A1-N-A4, boat drive-on) --------------------
// Each test names its finding in .review/add-michigan-fever.md.

const evIds = (beats) => beats.filter((b) => b.type === "event").map((b) => b.id);

// A family in a town, made by hand: the town's actions read only these fields.
function inTown(place, s = started("vermont", `town-${place}`, calm)) {
  s.phase = place === "bronson" ? "office" : "town";
  s.place = place;
  s.leg = null;
  s.vars.terrain = null;
  s.vars.visit = { place, used: {}, since: s.day };
  return s;
}

// Choose the first enabled choice of whatever is open; collect the events that fire.
function settle(r, s, fired = []) {
  for (let i = 0; i < 20 && s.pending && !s.over; i++) {
    const res = step(r, s, availableActions(r, s).find((a) => a.enabled));
    fired.push(...evIds(res.beats));
    s = res.state;
  }
  return s;
}

test("PA1: writing home returns to the post office menu", () => {
  const albany = reach("cautious", (x) => x.phase === "town" && x.place === "albany");
  const p = step(route, atPost(albany), "choose:write").state;
  assert.equal(p.pending?.id, "post-office", "the office stays open after a letter home");
  assert.ok(choices(p).includes("ask"), "letters can still be asked for");
  assert.ok(!choices(p).includes("write"), "written once a visit");
  for (const a of availableActions(route, p)) assert.doesNotMatch(a.label, /[{}]/, a.label);
  // Once nothing is left to do there, the menu closes.
  let q = step(route, p, "choose:ask").state;
  q = settle(route, q);
  assert.equal(q.pending, null);
});

test("PA2: money lost in the mail reads as sent until the letter saying so is collected, and is not offered again before", () => {
  const atAlbany = clone(reach("cautious", (x) => x.phase === "town" && x.place === "albany"));
  atAlbany.purse.notes.ne = 100000;
  atAlbany.purse.coin = 1000;
  const tie = atAlbany.ties[0];
  const r = routeWith({ "post.lossP": 1 });
  let s = step(r, atPost(atAlbany, r), `choose:send-${tie.id}`).state;
  s = step(r, s, "choose:whole").state;
  const shown = view(r, s).ties.find((t) => t.id === tie.id);
  assert.equal(shown.status, "sent", "the HUD says money sent");
  assert.equal(s.pending?.id, "post-office");
  assert.ok(!choices(s, r).includes(`send-${tie.id}`), "no second sending while the first is on its way");
  // The letter saying it never came waits at Bronson; collecting it shows the loss.
  const lostMail = s.mail.find((m) => m.key === "lost" && m.tie === tie.id);
  assert.ok(lostMail);
  const b = clone(inTown("bronson", clone(s)));
  b.pending = null;
  b.date = lostMail.from;
  b.purse.coin += 1000;
  assert.equal(view(r, b).ties.find((t) => t.id === tie.id).status, "sent", "still sent before the letter is read");
  const ctx = makeCtx(r, b);
  assert.equal(M.collectMail(ctx, "bronson"), true);
  assert.equal(view(r, b).ties.find((t) => t.id === tie.id).status, "lost");
});

test("PA3: money sent by letter settles a tie only if it reaches home by the due date; too late, the choice says why", () => {
  const base = clone(reach("cautious", (x) => x.phase === "town" && x.place === "albany"));
  base.purse.notes.ne = 100000;
  base.purse.coin = 1000;
  const r = routeWith({ "post.lossP": 0 });
  const tie = base.ties[0];
  const due = num(`tie.${tie.id}.due`);
  const transit = num("post.transitDays");
  const menuOn = (date) => { const s = clone(base); s.date = date; return atPost(s, r); };
  const sendChoice = (s) => availableActions(r, s).find((a) => a.choice === `send-${tie.id}`);
  // In time: sent on the last day that still reaches home by the due date.
  const inTime = menuOn(addDays(due, -transit));
  assert.equal(sendChoice(inTime).enabled, true);
  let s = step(r, step(r, inTime, `choose:send-${tie.id}`).state, "choose:whole").state;
  assert.equal(s.ties.find((t) => t.id === tie.id).status, "settled");
  // A day later, and after the date: refused, with the reason.
  for (const date of [addDays(due, -transit + 1), addDays(due, 3)]) {
    const late = menuOn(date);
    const c = sendChoice(late);
    assert.equal(c.enabled, false, date);
    assert.match(c.reason, /too late/i);
    const ctx = makeCtx(r, clone(late));
    const before = clone(ctx.state.purse);
    assert.equal(M.sendMoney(ctx, tie.id, "whole", "albany"), false);
    assert.deepEqual(ctx.state.purse, before, "no money taken");
  }
});

test("PA3 (widened): the mortgage agent takes no money once the note has fallen due", () => {
  const s = started("vermont", "mort-late");
  s.ties = [{ id: "mortgage", amount: 5000, sent: 0, status: "open", outcome: null, learned: false }];
  s.purse.coin = 10000;
  const due = num("tie.mortgage.due");
  s.date = addDays(due, 1);
  const ctx = makeCtx(route, s);
  assert.equal(M.payTieHere(ctx, "mortgage"), false);
  assert.equal(s.purse.coin, 10000);
  // Offered at Detroit after the due date, the pay choice is refused with the reason.
  const d = inTown("detroit", clone(s));
  d.ties[0].outcome = "sued";
  makeCtx(route, d).queueEvent("tie-mortgage-agent");
  assert.equal(d.pending?.id, "tie-mortgage-agent");
  const pay = availableActions(route, d).find((a) => a.choice === "pay");
  assert.equal(pay.enabled, false);
  assert.match(pay.reason, /too late|fell due/i);
  // And the agent does not come at all once the outcome at home is settled.
  const q = inTown("detroit", clone(s));
  q.queue = [];
  M.scheduleTies(makeCtx(route, q));
  q.ties[0].outcome = "sued";
  assert.equal(makeCtx(route, q).fireDue(), false);
  assert.ok(!q.queue.some((x) => x.event === "tie-mortgage-agent"));
  // The reviewer's seed: no payment to the agent after the date.
  const seed = "mo-cheap-15";
  const rng = cursor(createRng(`p-${seed}`));
  let g = newGame(route, { seed }).state;
  while (!g.over) {
    const acts = availableActions(route, g);
    let a = g.pending?.id === "tie-mortgage-agent" ? acts.find((x) => x.id === "choose:pay" && x.enabled) : null;
    if (a) {
      const t = g.ties.find((x) => x.id === "mortgage");
      assert.equal(t.outcome, null, `paid on ${g.date} after the outcome`);
      assert.ok(g.date <= due);
    }
    a ??= STRATEGIES.cheap(route, g, acts, { seedIndex: 15, rng });
    g = step(route, g, a).state;
  }
});

test("PA4: a wedged wheel breaks down the road even after an earlier repair", () => {
  let s = started("vermont", "axle2", calm);
  s.flags.wheelMended = true; // mended once already, earlier on the road
  s.pending = { kind: "event", id: "vt-wheel", vars: {} };
  s = step(calm, s, "choose:wedge").state;
  let fired = false;
  for (let i = 0; i < 40 && !fired && !s.over; i++) {
    const r = step(calm, s, s.pending ? availableActions(calm, s)[0] : "go");
    fired = evIds(r.beats).includes("chain-axle");
    s = r.state;
  }
  assert.ok(fired, "the wedged wheel gives out");
});

test("PA5: a second yoke, or a fresh yoke bought in town, ends the short team", () => {
  const s = started("vermont", "yoke", calm);
  s.flags.teamShort = true;
  s.purse.coin = 50000;
  s.pending = { kind: "event", id: "ohio-second-yoke", vars: {} };
  const y = step(calm, s, "choose:buy").state;
  assert.equal(y.flags.secondYoke, true);
  assert.equal(y.flags.teamShort, undefined, "the second yoke makes up the team");
  for (const place of ["albany", "buffalo", "detroit"]) {
    const t = inTown(place);
    t.flags.teamShort = true;
    t.purse = { coin: 50000, notes: { ne: 0, ny: 0, mi: 0 } };
    const buy = availableActions(calm, t).find((a) => a.id === "buy-yoke");
    assert.ok(buy?.enabled, `${place}: a fresh yoke on offer`);
    assert.equal(buy.cost, Math.round(num("price.oxen") * 100));
    const after = step(calm, t, "buy-yoke").state;
    assert.equal(after.flags.teamShort, undefined);
    assert.equal(after.purse.coin, 50000 - buy.cost);
    assert.ok(!availableActions(calm, after).some((a) => a.id === "buy-yoke"));
  }
  assert.ok(!availableActions(calm, inTown("detroit")).some((a) => a.id === "buy-yoke"), "not offered to a sound team");
});

test("PA6: two {at} consequences at one town both fire, without lodging", () => {
  const s = started("vermont", "two-at", calm);
  s.ties = [{ id: "mortgage", amount: 5000, sent: 0, status: "open", outcome: null, learned: false }];
  T.startLeg(makeCtx(calm, s), "overland");
  s.vars.seg = 2;
  s.vars.terrain = "strip";
  s.vars.segMi = num("mi.perrysburgDetroit") - 1;
  s.queue = [{ event: "tie-mortgage-agent", at: "detroit" }, { event: "chain-loan-due", at: "detroit" }];
  const r = step(calm, s, "go");
  assert.equal(r.state.place, "detroit");
  const fired = evIds(r.beats);
  const end = settle(calm, r.state, fired);
  assert.ok(fired.includes("tie-mortgage-agent") && fired.includes("chain-loan-due"), fired.join(", "));
  assert.equal(end.place, "detroit");
  assert.deepEqual(end.queue.filter((q) => q.at === "detroit"), []);
});

test("PA6: a Buffalo loan always comes due at Detroit", () => {
  let games = 0;
  for (let i = 0; i < 16; i++) {
    const seed = `loan-${i}`;
    const rng = cursor(createRng(`player-${seed}`));
    let s = newGame(route, { seed }).state;
    const play = () => { s = step(route, s, STRATEGIES.cheap(route, s, availableActions(route, s), { seedIndex: i, rng })).state; };
    while (!s.over && !(s.phase === "town" && s.place === "buffalo" && !s.pending)) play();
    if (s.over) continue;
    s = clone(s);
    s.pending = { kind: "event", id: "buf-loan", vars: {} };
    s = step(route, s, "choose:take").state;
    let atDetroit = false;
    let due = false;
    while (!s.over && !(atDetroit && s.place !== "detroit")) {
      if (s.place === "detroit") atDetroit = true;
      if (s.pending?.id === "chain-loan-due") due = true;
      play();
    }
    if (!atDetroit) continue;
    games++;
    assert.ok(due, `${seed}: reached Detroit and the loan never came due`);
  }
  assert.ok(games >= 8, `${games} games reached Detroit`);
});

test("PA7: one scheduled consequence a day from the travel draw, however many are due", () => {
  const r = routeWith({ ...QUIET, "ev.p.travel": 1 });
  const s = started("vermont", "pa7", r);
  s.queue = [{ event: "chain-team-strained", due: 0 }, { event: "chain-light-coin", due: 0 }];
  const res = step(r, s, "go");
  const chain = evIds(res.beats).filter((id) => r.eventIndex.get(id).deck === "chain");
  assert.equal(chain.length, 1, evIds(res.beats).join(", "));
  assert.equal(res.state.queue.length, 1);
});

test("PA8: the tie schedules in text.json are validated like the deck", () => {
  assert.ok(route.schedules.length >= 3, "the tie schedules are handed to validateDeck");
  assert.deepEqual(validateDeck(route), []);
  const d = readData();
  const mort = d.text.ties.find((t) => t.id === "mortgage");
  mort.schedule = [{ event: "tie-ghost", in: { at: "chicago" }, unless: { nonsense: 1 } }];
  const errs = validateDeck(createRoute(d)).join("\n");
  assert.match(errs, /tie mortgage: schedule: unknown event tie-ghost/);
  assert.match(errs, /tie mortgage: schedule: unknown place chicago/);
  assert.match(errs, /tie mortgage: unknown condition nonsense/);
});

test("PA9: a save with a damaged queue, mail, ties or fatigue is refused", () => {
  const s = started("vermont", "pa9");
  const load = (mutate) => {
    const doc = JSON.parse(serialize(s));
    mutate(doc.state);
    return deserialize(route, JSON.stringify(doc));
  };
  assert.equal(load(() => {}).ok, true);
  const before = JSON.parse(serialize(newGame(route, { seed: "pa9" }).state));
  assert.equal(deserialize(route, JSON.stringify(before)).ok, true, "a save from before the start screen loads");
  const cases = {
    "queue: unknown event": (x) => { x.queue = [{ event: "nope", due: 1 }]; },
    "queue: no due or at": (x) => { x.queue = [{ event: "chain-light-coin" }]; },
    "mail: not an array": (x) => { x.mail = 5; },
    "mail: not an object": (x) => { x.mail = [5]; },
    "mail: no date": (x) => { x.mail[0].from = null; },
    "mail: bad date": (x) => { x.mail[0].from = "1836-13-45"; },
    "mail: unknown office": (x) => { x.mail[0].office = "chicago"; },
    "ties: null": (x) => { x.ties = null; },
    "ties: unknown tie": (x) => { x.ties = [{ id: "bogus" }]; },
    "ties: amount not a number": (x) => { x.ties[0].amount = "x"; },
    "fatigue: not a number": (x) => { x.party[0].fatigue = "x"; },
    "team fatigue: not a number": (x) => { x.gear.fatigue = "x"; },
    "pace: unknown": (x) => { x.vars.pace = "zzz"; },
  };
  for (const [name, f] of Object.entries(cases)) assert.deepEqual(load(f), { ok: false, reason: "damaged" }, name);
});

test("PA10: every amount in an event prints in the game's money format", () => {
  for (const e of route.events) {
    for (const t of [e.text, ...(e.choices ?? []).flatMap((c) => [c.label, c.result, c.why])]) {
      if (t) assert.doesNotMatch(t, /\$\{/, `${e.id}: a bare $ before a number`);
    }
  }
  const s = inTown("detroit", started("vermont", "pa10"));
  s.ties = [{ id: "mortgage", amount: 5000, sent: 0, status: "open", outcome: null, learned: false }];
  const ctx = makeCtx(route, s);
  ctx.queueEvent("tie-mortgage-agent");
  const text = ctx.beats.find((b) => b.type === "event").text;
  assert.match(text, /\$50\.00/);
  ctx.state.pending = null;
  ctx.queueEvent("chain-loan-due");
  assert.match(ctx.beats.filter((b) => b.type === "event")[1].text, new RegExp(`\\${Pm.money(Pm.cents(num("ev.loan.due"))).replace(".", "\\.")}`));
});

test("N-A1: selling the team, or buying a new outfit, drops the old outfit's queued troubles", () => {
  const OUTFIT = ["chain-axle", "chain-team-strained", "chain-ox-worse", "chain-corduroy-spring"];
  const queued = () => [...OUTFIT, "chain-light-coin"].map((event) => ({ event, due: 99 }));
  const albany = inTown("albany");
  albany.queue = queued();
  const sold = step(calm, albany, "sell-team").state;
  assert.deepEqual(sold.queue.map((q) => q.event), ["chain-light-coin"]);
  const detroit = inTown("detroit");
  detroit.gear.team = null;
  detroit.gear.wagon = false;
  detroit.purse.coin = 50000;
  detroit.queue = queued();
  assert.deepEqual(step(calm, detroit, "buy-team").state.queue.map((q) => q.event), ["chain-light-coin"]);
  // The reviewer's seeds: no trouble of the sold team turns up on the new outfit.
  for (const seed of ["ax-16", "ax-7", "ax-12"]) {
    const rng = cursor(createRng(`p-${seed}`));
    let g = newGame(route, { seed }).state;
    let sold2 = false;
    const queuedSince = new Set(); // outfit troubles of the new outfit, queued after the sale
    while (!g.over && g.day < 200) {
      const acts = availableActions(route, g);
      const a = acts.find((x) => x.enabled && ["choose:wedge", "choose:push"].includes(x.id)) ?? STRATEGIES.cautious(route, g, acts, { seedIndex: Number(seed.slice(3)), rng });
      const r = step(route, g, a);
      if (a.id === "sell-team") {
        sold2 = true;
        assert.deepEqual(r.state.queue.filter((q) => OUTFIT.includes(q.event)), [], `${seed}: the sold outfit's troubles left the queue`);
      } else if (sold2) {
        for (const id of evIds(r.beats)) if (OUTFIT.includes(id)) assert.ok(queuedSince.has(id), `${seed}: ${id} of the sold outfit fired on the new one (${r.state.leg})`);
      }
      if (sold2) for (const q of r.state.queue) if (OUTFIT.includes(q.event)) queuedSince.add(q.event);
      g = r.state;
    }
    assert.ok(sold2, `${seed}: the team was sold`);
  }
});

test("N-A2: fatigue costs from the first point: illness odds rise a little, then steeply past the knee, with no cliff", () => {
  const s = started();
  const p = s.party[0];
  const rate = (f) => { p.fatigue = f; return H.onsetRate(makeCtx(route, s), "ague", false, p); };
  const base = rate(0);
  const knee = num("fat.ill.from");
  assert.equal(knee, 40);
  assert.ok(rate(1) > base, "one point of fatigue already costs");
  assert.ok(Math.abs(rate(knee) - base * (1 + num("fat.ill.low"))) < 1e-12);
  assert.ok(Math.abs(rate(100) - base * (1 + num("fat.ill.mult"))) < 1e-12);
  const below = (rate(knee) - rate(0)) / knee;
  const above = (rate(100) - rate(knee)) / (100 - knee);
  assert.ok(above > 3 * below, "much steeper past the knee");
  assert.ok(Math.abs(rate(knee + 1e-6) - rate(knee - 1e-6)) < 1e-6 * base, "continuous at the knee");
  for (let f = 0; f < 100; f += 5) assert.ok(rate(f + 5) > rate(f), `rises at ${f}`);
});

test("N-A2: accident odds rise with any fatigue; hard and grueling wear the team at once", () => {
  const ev = (id) => route.eventIndex.get(id);
  const s = started();
  s.phase = "travel";
  s.leg = "vermont";
  const wear = (f, team = 0) => { for (const p of s.party) p.fatigue = f; s.gear.fatigue = team; };
  const w = (id) => weightOf(ev(id), makeCtx(route, s));
  for (const id of ["any-trunk", "travel-stumble"]) {
    wear(0);
    const fresh = w(id);
    wear(10);
    assert.ok(w(id) > fresh, `${id}: dearer at fatigue 10`);
  }
  // The team: the first hard day already opens shoe wear and raises lameness.
  wear(0, 7);
  s.vars.pace = "steady";
  const ctx = () => makeCtx(route, s);
  assert.equal(ctx().evalCond(ev("team-cast-shoe").when), false, "steady and fresh: no cast shoe");
  const lameSteady = w("ohio-lame-ox");
  s.vars.pace = "hard";
  assert.equal(ctx().evalCond(ev("team-cast-shoe").when), true, "a hard pace wears shoes from the first day");
  assert.ok(w("ohio-lame-ox") > lameSteady, "a hard pace makes lameness likelier at once");
  s.vars.pace = "grueling";
  const lameHard = (() => { s.vars.pace = "hard"; return w("ohio-lame-ox"); })();
  s.vars.pace = "grueling";
  assert.ok(w("ohio-lame-ox") > lameHard);
});

test("N-A3: letters at Bronson come out to the claim only when the postage can be paid, and never two days running", () => {
  const s = clone(reach("cautious", (x) => x.phase === "claim", calm));
  s.queue = [];
  s.mail.push({ id: "mx", key: "kin", tie: null, office: "bronson", from: s.date, written: s.date, sheets: 1, status: "waiting" });
  s.purse = Pm.emptyPurse();
  let g = s;
  const fires = [];
  for (let i = 0; i < 12 && !g.over; i++) {
    const r = step(calm, g, g.pending ? availableActions(calm, g).find((a) => a.enabled) : "rest");
    assert.ok(!evIds(r.beats).includes("claim-mail"), "no neighbour brings letters the family cannot pay for");
    g = r.state;
  }
  if (!g.over) {
    g = clone(g);
    g.purse.coin = 1000;
    for (let i = 0; i < 12 && !g.over; i++) {
      const r = step(calm, g, g.pending ? availableActions(calm, g).find((a) => a.enabled) : "rest");
      if (evIds(r.beats).includes("claim-mail")) fires.push(r.state.day);
      assert.ok(!r.beats.some((b) => b.type === "narrate" && /not enough in the purse/.test(b.text)));
      g = r.state;
    }
    assert.equal(fires.length, 1);
    assert.equal(M.waitingMail(g, "bronson").length, 0);
  }
  // The reviewer's seed, played to the end.
  const seed = "cm-152";
  const rng = cursor(createRng(`p-${seed}`));
  let h = newGame(route, { seed }).state;
  const days = [];
  while (!h.over) {
    const r = step(route, h, STRATEGIES.cheap(route, h, availableActions(route, h), { seedIndex: 152, rng }));
    if (evIds(r.beats).includes("claim-mail")) {
      days.push(r.state.day);
      assert.ok(!r.beats.some((b) => b.type === "narrate" && /not enough in the purse/.test(b.text)), `${seed}: unpaid claim-mail on ${r.state.date}`);
    }
    h = r.state;
  }
  for (let i = 1; i < days.length; i++) assert.ok(days[i] - days[i - 1] > 1, `${seed}: claim-mail on consecutive days ${days}`);
});

test("N-A4: postage is kept exact in fractions of a cent; the counter drops an odd half cent in the family's favour", () => {
  assert.equal(M.postage(num, 100, 1), 12.5);
  assert.equal(M.postage(num, 100, 2), 25);
  assert.equal(M.postage(num, 200, 1), 18.75);
  assert.equal(M.postage(num, 200, 2), 37.5);
  assert.equal(M.postage(num, 200, 4), 75);
  assert.equal(M.charge(12.5), 12);
  assert.equal(M.charge(25), 25);
  assert.equal(M.charge(12.5 + 25), 37);
  assert.equal(M.charge(18.75), 18);
  assert.match(route.numbers.get("post.band.3.rate").note, /half cent/i);
  // At Albany: one sheet is 12 cents paid, two sheets exactly 25, and both at one counter 37.
  const s = clone(reach("cautious", (x) => x.phase === "town" && x.place === "albany"));
  s.mail = s.mail.filter((m) => m.office !== "albany");
  s.mail.push({ id: "a1", key: "kin", tie: null, office: "albany", from: s.date, written: s.date, sheets: 1, status: "waiting" });
  assert.equal(M.mailCost(s, num, "albany"), 12);
  s.mail.push({ id: "a2", key: "kin", tie: null, office: "albany", from: s.date, written: s.date, sheets: 2, status: "waiting" });
  assert.equal(M.mailCost(s, num, "albany"), 37);
  assert.equal(M.sendPostage(num, "albany", "whole"), 25);
  assert.equal(M.sendPostage(num, "albany", "halves"), 50);
  const coinOnly = clone(s);
  coinOnly.purse = { coin: 1000, notes: { ne: 0, ny: 0, mi: 0 } };
  const wrote = step(route, atPost(coinOnly), "choose:write").state;
  assert.equal(wrote.purse.coin, 1000 - 12);
});

test("boat drive-on: aboard the canal boat or the steamer a worn-out family may drive on, and it still equals pressing go", () => {
  for (const leg of ["canal", "lake"]) {
    const s = clone(reach("cautious", (x) => x.phase === "travel" && x.leg === leg, calm));
    for (const p of s.party) p.fatigue = 95;
    assert.equal(canDriveOn(engine, calm, s).ok, true, leg);
    const r = driveOn(engine, calm, s);
    assert.notEqual(r.reason, "tired", leg);
    assert.ok(r.days.length >= 1);
    let g = s;
    for (let k = 0; k < r.days.length; k++) g = step(calm, g, "go").state;
    assert.equal(JSON.stringify(g), JSON.stringify(r.state), leg);
  }
});

test("N-A2: a worn team pulls slower from the first point, so a pushed day costs miles on the days after", () => {
  const s = started("vermont", "slow", calm);
  s.vars.terrain = "hill";
  const miles = (f) => { s.gear.fatigue = f; return T.dayMiles(makeCtx(calm, s), "fair"); };
  const fresh = miles(0);
  assert.ok(miles(1) < fresh);
  assert.ok(Math.abs(miles(40) - fresh * (1 - 40 * num("fat.team.slow"))) < 1e-9);
  // A hired teamster's team is not the family's to wear out.
  s.gear.teamster = true;
  s.gear.fatigue = 60;
  assert.equal(T.teamWearMult(makeCtx(calm, s)), 1);
});

// ---- Round 6 verify fixes (V1-V7) ------------------------------------------------
// Each test names its finding in .review/add-michigan-fever.md ("Round 6 results").

// A family stopped at a place, made by hand: a town, the land office at Bronson, or the claim.
function stoppedAt(place, s = started("vermont", `stop-${place}`, calm)) {
  if (place === "claim") {
    inTown("claim", s);
    s.phase = "claim";
    s.land.paid = true;
    s.land.acres = 40;
    return s;
  }
  return inTown(place, s);
}

test("V1: a short team can be made whole at the end of every leg where an ox can give out", () => {
  const legs = route.eventIndex.get("team-ox-down").when.all.find((c) => c.leg).leg;
  assert.ok(legs.includes("road") && legs.includes("claim"));
  for (const leg of legs) {
    const dest = T.LEGS[leg].segments.at(-1).to;
    for (const paid of [false, true]) {
      const s = stoppedAt(dest);
      if (paid) s.land.paid = true;
      s.flags.teamShort = true;
      s.purse = { coin: 50000, notes: { ne: 0, ny: 0, mi: 0 } };
      const buy = availableActions(calm, s).find((a) => a.id === "buy-yoke");
      assert.ok(buy?.enabled, `${leg} -> ${dest}${paid ? " (land paid)" : ""}: a fresh yoke on offer`);
      const after = step(calm, s, "buy-yoke").state;
      assert.equal(after.flags.teamShort, undefined, `${dest}: the team is whole`);
      assert.equal(after.purse.coin, 50000 - buy.cost);
    }
  }
});

test("V1: an ox gives out on the Territorial Road; the family goes on short and makes the team whole at Bronson", () => {
  let s = started("vermont", "v1-road", calm);
  T.startLeg(makeCtx(calm, s), "road");
  s.res.food = 5000;
  s.purse.coin = 50000;
  s.gear.fatigue = 80;
  s.queue = [];
  s.pending = { kind: "event", id: "team-ox-down", vars: {} };
  s = step(calm, s, "choose:short").state;
  assert.equal(s.flags.teamShort, true);
  for (let i = 0; i < 80 && !s.over && s.place !== "bronson"; i++) s = settle(calm, step(calm, s, s.pending ? availableActions(calm, s).find((a) => a.enabled) : "go").state);
  assert.equal(s.place, "bronson", "reached Bronson");
  assert.equal(s.flags.teamShort, true, "still short on arrival");
  const buy = availableActions(calm, s).find((a) => a.id === "buy-yoke");
  assert.ok(buy?.enabled, "a fresh yoke at Bronson");
  assert.equal(step(calm, s, "buy-yoke").state.flags.teamShort, undefined);
});

// Saves taken from real games: a strategy, with visits to the post office that send money home
// (half of it lost in the mail), so ties, lost-money letters and the queue are all in the saves.
function playSaving(r, strategy, seedIndex, check) {
  const seed = `v2-${strategy}-${seedIndex}`;
  const rng = cursor(createRng(`player-${seed}`));
  let s = newGame(r, { seed }).state;
  for (let n = 0; n < 600 && !s.over; n++) {
    check(s);
    const acts = availableActions(r, s);
    let a = null;
    if (s.pending?.id === "post-office") a = acts.find((x) => x.enabled && x.choice.startsWith("send-")) ?? acts.find((x) => x.enabled && x.choice === "ask");
    if (s.pending?.id === "post-send-how") a = acts.find((x) => x.enabled && x.choice === (seedIndex % 2 ? "halves" : "whole"));
    if (!s.pending && !s.vars.visit?.used?.postCall) a = acts.find((x) => x.id === "post" && x.enabled);
    a ??= STRATEGIES[strategy](r, s, acts, { seedIndex, rng });
    s = step(r, s, a).state;
  }
  check(s);
  return s;
}

test("V2: a save from any point of a real game loads back unchanged", () => {
  const r = routeWith({ "post.lossP": 0.5 });
  let saves = 0;
  const keys = new Set();
  for (const strategy of ["cautious", "thrifty", "cheap"]) {
    for (let i = 0; i < 4; i++) {
      playSaving(r, strategy, i, (s) => {
        const loaded = deserialize(r, serialize(s));
        assert.equal(loaded.ok, true, `${strategy} ${i} day ${s.day} ${s.phase}: ${loaded.reason}`);
        assert.deepEqual(loaded.state, s);
        for (const m of s.mail) keys.add(m.key);
        saves++;
      });
    }
  }
  assert.ok(saves > 1000, `${saves} saves`);
  assert.deepEqual([...keys].sort(), ["kin", "lost", "news", "outcome"], "every kind of letter was in a save");
});

test("V2: a save whose letters have an unknown kind, or name a tie the family does not have, is damaged", () => {
  const s = started("vermont", "v2-mail");
  const news = s.mail.find((m) => m.key === "news");
  const load = (mutate) => {
    const doc = JSON.parse(serialize(s));
    mutate(doc.state);
    return deserialize(route, JSON.stringify(doc));
  };
  assert.equal(load(() => {}).ok, true);
  const other = M.TIE_IDS.find((id) => !s.ties.some((t) => t.id === id));
  const cases = {
    "key: unknown": (x) => { x.mail[0].key = "zzz"; },
    "key: missing": (x) => { delete x.mail[0].key; },
    "news: tie not the family's": (x) => { x.mail.find((m) => m.id === news.id).tie = other; },
    "news: no tie": (x) => { x.mail.find((m) => m.id === news.id).tie = null; },
    "outcome: no tie": (x) => { x.mail.find((m) => m.key === "outcome").tie = null; },
    "lost: tie not the family's": (x) => { x.mail.push({ id: "m99", key: "lost", tie: other, office: "bronson", from: "1836-11-01", written: "1836-10-20", sheets: 1, status: "waiting" }); },
    "kin: names a tie": (x) => { x.mail.find((m) => m.key === "kin").tie = s.ties[0].id; },
  };
  for (const [name, f] of Object.entries(cases)) assert.deepEqual(load(f), { ok: false, reason: "damaged" }, name);
});

test("V3: halves go by the next mail, so their last day is earlier than whole notes'", () => {
  const base = clone(reach("cautious", (x) => x.phase === "town" && x.place === "albany"));
  base.purse.notes.ne = 100000;
  base.purse.coin = 1000;
  const r = routeWith({ "post.lossP": 0 });
  const tie = base.ties[0];
  const due = num(`tie.${tie.id}.due`);
  const transit = num("post.transitDays");
  const gap = num("post.halves.gapDays");
  assert.ok(gap > 0);
  const howMenu = (date) => {
    const s = clone(base);
    s.date = date;
    return step(r, atPost(s, r), `choose:send-${tie.id}`).state;
  };
  const how = (s, id) => availableActions(r, s).find((a) => a.choice === id);
  // The last day for halves: both ways reach home in time.
  const lastHalves = addDays(due, -transit - gap);
  let s = howMenu(lastHalves);
  assert.equal(how(s, "halves").enabled, true);
  s = step(r, s, "choose:halves").state;
  assert.equal(s.ties.find((t) => t.id === tie.id).status, "settled");
  // A day later the second halves would come after the date: halves refused, with the reason; whole still goes.
  for (const date of [addDays(lastHalves, 1), addDays(due, -transit)]) {
    s = howMenu(date);
    const halves = how(s, "halves");
    assert.equal(halves.enabled, false, date);
    assert.match(halves.reason, /too late/i);
    assert.match(halves.reason, /next mail/i);
    assert.equal(how(s, "whole").enabled, true, date);
    const ctx = makeCtx(r, clone(s));
    const before = clone(ctx.state.purse);
    assert.equal(M.sendMoney(ctx, tie.id, "halves", "albany"), false);
    assert.deepEqual(ctx.state.purse, before, "no money taken");
    const sent = step(r, s, "choose:whole").state;
    assert.equal(sent.ties.find((t) => t.id === tie.id).status, "settled", date);
  }
  // Past the last day for whole notes the post office refuses both (PA3).
  const late = clone(base);
  late.date = addDays(due, -transit + 1);
  assert.equal(availableActions(r, atPost(late, r)).find((a) => a.choice === `send-${tie.id}`).enabled, false);
  // The letter saying halves never came is written after the second halves were due home.
  const lost = clone(base);
  lost.date = lastHalves;
  const lr = routeWith({ "post.lossP": 1 });
  const gone = step(lr, step(lr, atPost(lost, lr), `choose:send-${tie.id}`).state, "choose:halves").state;
  const word = gone.mail.find((m) => m.key === "lost" && m.tie === tie.id);
  assert.equal(word.written, addDays(lastHalves, transit + gap));
  assert.equal(word.from, addDays(lastHalves, 2 * transit + gap));
});

test("V4: every sending reads as sent in the view until word comes, whether it arrived or went astray", () => {
  const base = clone(reach("cautious", (x) => x.phase === "town" && x.place === "albany"));
  base.purse.notes.ne = 100000;
  base.purse.coin = 1000;
  const tie = base.ties[0];
  const sendWith = (lossP) => {
    const r = routeWith({ "post.lossP": lossP });
    return { r, s: step(r, step(r, atPost(clone(base), r), `choose:send-${tie.id}`).state, "choose:whole").state };
  };
  const ok = sendWith(0);
  const astray = sendWith(1);
  assert.equal(ok.s.ties.find((t) => t.id === tie.id).status, "settled", "internally it arrived");
  assert.equal(astray.s.ties.find((t) => t.id === tie.id).status, "sent", "internally it went astray");
  const lostWord = astray.s.mail.find((m) => m.key === "lost" && m.tie === tie.id);
  const shown = (x, date) => {
    const s = clone(x.s);
    s.date = date;
    const t = view(x.r, s).ties.find((y) => y.id === tie.id);
    return { status: t.status, sent: t.sent, news: t.news };
  };
  const transit = num("post.transitDays");
  for (const date of [base.date, addDays(base.date, transit), addDays(base.date, transit + 3), addDays(lostWord.from, -1), lostWord.from]) {
    assert.deepEqual(shown(ok, date), shown(astray, date), date);
    assert.equal(shown(ok, date).status, "sent", date);
  }
  // Word comes at Bronson: the outcome letter for the money that arrived, the lost-money letter for the other.
  const outcome = ok.s.mail.find((m) => m.key === "outcome" && m.tie === tie.id);
  const b = inTown("bronson", clone(ok.s));
  b.pending = null;
  b.date = outcome.from;
  b.purse.coin += 1000;
  makeCtx(ok.r, b).advanceDays(0);
  M.resolveTies(makeCtx(ok.r, b));
  assert.equal(M.collectMail(makeCtx(ok.r, b), "bronson"), true);
  assert.equal(view(ok.r, b).ties.find((t) => t.id === tie.id).status, "settled");
  // Paid in person, it is settled at once (the family paid it with their own hands).
  const p = inTown("detroit", started("vermont", "v4-agent"));
  p.ties = [{ id: "mortgage", amount: 5000, sent: 0, status: "open", outcome: null, learned: false }];
  p.purse.coin = 10000;
  assert.equal(M.payTieHere(makeCtx(route, p), "mortgage"), true);
  assert.equal(view(route, p).ties[0].status, "settled");
});

// Play one step; note the queued events (in the queue when the step began) and the random ones it fired.
function stepCounting(r, s, a, log) {
  const queued = new Set((s.queue ?? []).map((q) => q.event));
  const res = step(r, s, a);
  const fired = evIds(res.beats);
  const q = fired.filter((id) => queued.has(id));
  const rnd = fired.filter((id) => !queued.has(id) && r.eventIndex.get(id).deck !== "post");
  log.push({ day: res.state.day, queued: q, random: rnd, phase: res.state.phase });
  return res.state;
}

// Arrive, then try to leave at once (answering whatever opens) until the family is on the road.
function arriveAndLeave(r, s, leave) {
  const log = [];
  s = stepCounting(r, s, "go", log);
  for (let i = 0; i < 20 && !s.over && s.phase !== "travel"; i++) {
    s = stepCounting(r, s, s.pending ? availableActions(r, s).find((a) => a.enabled) : leave, log);
  }
  return { s, log };
}

// No random event can be drawn at all (every deck weight 0): only the queue fires.
const NO_DRAW = Object.fromEntries(readData().numbers.filter((n) => /^w\./.test(n.id)).map((n) => [n.id, 0]));

for (const [variant, r] of [["with a random town event", routeWith({ ...QUIET, "ev.p.town": 1 })], ["with no random event", routeWith({ ...QUIET, ...NO_DRAW })]]) test(`V5: at Detroit (${variant}), a due chain event, a loan come due and the mortgage agent all fire before the family leaves, one queued event a step and one random event a day`, () => {
  const s = started("vermont", "v5-detroit", r);
  s.ties = [{ id: "mortgage", amount: 5000, sent: 0, status: "open", outcome: null, learned: false }];
  s.purse.coin = 50000;
  s.res.food = 5000;
  T.startLeg(makeCtx(r, s), "overland");
  s.vars.seg = 2;
  s.vars.terrain = "strip";
  s.vars.segMi = num("mi.perrysburgDetroit") - 1;
  s.queue = [{ event: "chain-light-coin", due: s.day }, { event: "chain-loan-due", at: "detroit" }, { event: "tie-mortgage-agent", at: "detroit" }];
  const { s: end, log } = arriveAndLeave(r, s, "set-out");
  assert.equal(end.leg, "road", "the family left on the Territorial Road");
  const fired = log.flatMap((l) => l.queued);
  assert.deepEqual(fired.sort(), ["chain-light-coin", "chain-loan-due", "tie-mortgage-agent"], JSON.stringify(log));
  for (const l of log) assert.ok(l.queued.length <= 1, `one queued event a step: ${JSON.stringify(l)}`);
  const randomByDay = {};
  for (const l of log) randomByDay[l.day] = (randomByDay[l.day] ?? 0) + l.random.length;
  for (const [day, n] of Object.entries(randomByDay)) assert.ok(n <= 1, `day ${day}: ${n} random events`);
  assert.deepEqual(end.queue.filter((q) => q.at === "detroit"), [], "nothing left waiting at Detroit");
});

for (const [variant, r] of [["with a random town event", routeWith(QUIET)], ["with no random event", routeWith({ ...QUIET, ...NO_DRAW })]]) test(`V5: at Buffalo (${variant}), a consequence with no choice and one with a choice both fire before the steamer leaves`, () => {
  const s = started("vermont", "v5-buffalo", r);
  s.ties = [{ id: "store", amount: 1000, sent: 0, status: "open", outcome: null, learned: false }];
  s.purse.coin = 50000;
  s.res.food = 5000;
  s.vars.ticket = "packet";
  T.startLeg(makeCtx(r, s), "canal");
  s.vars.segMi = num("mi.canal") - 1;
  s.queue = [{ event: "tie-store-drummer", at: "buffalo" }, { event: "chain-fight-buffalo", at: "buffalo" }];
  const { s: end, log } = arriveAndLeave(r, s, "book:deck");
  assert.equal(end.leg, "lake", "on the lake");
  assert.deepEqual(log.flatMap((l) => l.queued).sort(), ["chain-fight-buffalo", "tie-store-drummer"], JSON.stringify(log));
  for (const l of log) assert.ok(l.queued.length <= 1, JSON.stringify(l));
});

test("V6: a spent team crawls but never stops, and wears the same on bad road, under its cap", () => {
  const floor = num("fat.team.floor");
  assert.ok(floor > 0 && floor < 1);
  for (const [terrain, leg] of [["hill", "vermont"], ["swamp", "overland"], ["track", "claim"]]) {
    const s = started("vermont", "v6", calm);
    s.leg = leg;
    s.vars.terrain = terrain;
    const miles = (pace, f) => { s.vars.pace = pace; s.gear.fatigue = f; return T.dayMiles(makeCtx(calm, s), "fair"); };
    const fresh = miles("steady", 0);
    assert.ok(miles("steady", 100) > 0, `${terrain}: a spent team still moves`);
    assert.ok(Math.abs(miles("steady", 100) - fresh * floor) < 1e-9, `${terrain}: floored`);
    assert.ok(miles("steady", 30) < fresh, `${terrain}: a tired team is slower`);
    assert.ok(Math.abs(miles("steady", 30) - fresh * (1 - 30 * num("fat.team.slow"))) < 1e-9, terrain);
    if (terrain !== "hill") {
      for (const f of [0, 30, 70, 100]) {
        for (const pace of ["hard", "grueling"]) assert.equal(miles(pace, f), miles("steady", f), `${terrain} ${pace} at ${f}: the cap holds`);
        assert.ok(miles("grueling", f) <= fresh, `${terrain} at ${f}: never faster than a fresh team at the road's pace`);
      }
    }
  }
});

test("V7: buying a fresh yoke for an ox that gave out rests the team once", () => {
  const r = routeWith({ ...QUIET, "ev.team.fresh": -20 });
  const s = started("vermont", "v7", r);
  s.gear.fatigue = 90;
  s.purse = { coin: 50000, notes: { ne: 0, ny: 0, mi: 0 } };
  s.queue = [];
  s.pending = { kind: "event", id: "team-ox-down", vars: {} };
  const after = step(r, s, "choose:buy").state;
  assert.equal(after.gear.fatigue, 70);
  assert.equal(after.flags.teamShort, undefined);
  assert.equal(after.purse.coin, 50000 - Math.round(num("price.oxen") * 100));
});
