// P2 Phase B review, round 9 (.review/add-michigan-fever.md): PC1-PC4, PC6, PC7. Written
// before the fixes. PC5 is a recorded spec deviation (API.md), with no code change.

import test from "node:test";
import assert from "node:assert/strict";
import { availableActions, makeCtx, newGame, step, view } from "../../engine/engine.js";
import { createRng, cursor } from "../../engine/rng.js";
import { compare, diffDays } from "../../engine/clock.js";
import * as T from "../mechanics/travel.js";
import * as P from "../mechanics/purse.js";
import * as Pa from "../mechanics/paths.js";
import * as H from "../mechanics/health.js";
import { serialize, deserialize } from "../../engine/save.js";
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

// Play a strategy's game with the reviewer's seed scheme: seed `seed`, the player's own
// draws from `player-<seed>`. Stops when `stop(state)` holds or the game ends.
function playSeed(seed, name, i, stop = () => false, r = route) {
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
  assert.ok(!res.beats.some((b) => b.type === "error"), `${typeof id === "string" ? id : id.id}: ${JSON.stringify(res.beats.find((b) => b.type === "error"))}`);
  return res;
}

const NEWS = "win-suspension-news";
const NEWS_DAY = "1837-05-16";
const atNews = (s) => s.pending?.id === NEWS;

// ---- PC1 ---------------------------------------------------------------------------

test("PC1: grief days past 16 May never drop the suspension news unseen (seed probe-carefulDetroit-30)", () => {
  const { state } = playSeed("probe-carefulDetroit-30", "carefulDetroit", 30, atNews);
  assert.equal(state.vars.path, "detroit");
  assert.ok(atNews(state), `the news never came (${state.over?.outcome ?? "playing"} on ${state.date})`);
  assert.equal(state.date, NEWS_DAY);
});

test("PC1: over sixty carefulDetroit games, every family on the Detroit path that lives past 16 May is told the news", () => {
  let past = 0;
  for (let i = 0; i < 60; i++) {
    const seed = `probe-carefulDetroit-${i}`;
    let told = false;
    const { state } = playSeed(seed, "carefulDetroit", i, (s) => {
      if (atNews(s)) told = true;
      return false;
    });
    if (state.vars.path !== "detroit" || compare(state.date, "1837-05-17") < 0) continue;
    if (!state.party.some((p) => p.status !== "dead")) continue;
    past += 1;
    assert.ok(told, `${seed}: on the Detroit path to ${state.date} and never told`);
  }
  assert.ok(past >= 10, `only ${past} games lived past 16 May on the Detroit path`);
});

// A route whose daily tick lets one member of the family die on `date` (a synthetic
// death: the register, the morale, the grief days, as any death).
function withDeathOn(date, r = calm) {
  const d = Object.create(r);
  d.onDay = (ctx) => {
    r.onDay(ctx);
    if (ctx.state.date !== date) return;
    const p = H.living(ctx.state).filter((x) => x.role !== "father" && x.role !== "mother").at(-1) ?? H.living(ctx.state).at(-1);
    H.die(ctx, p, "dysentery");
  };
  return d;
}

// The Detroit winter on `date`, the news queued for 16 May as the pivot queues it,
// nothing else waiting, a full larder and coin for the room.
function detroitWinter(date) {
  const { state } = playSeed("tier-carefulDetroit-21", "carefulDetroit", 21, (s) => s.vars.path === "detroit" && s.phase === "winter" && !s.pending);
  assert.equal(state.phase, "winter");
  const s = structuredClone(state);
  s.date = date;
  s.queue = [{ event: NEWS, due: s.day + diffDays(date, NEWS_DAY), unless: { onOrAfter: "#bank.suspend.detroit" } }];
  s.vars.griefDays = 0;
  s.res.food = 5000;
  s.purse = { coin: 50000, notes: { ne: 0, ny: 0, mi: 20000 } };
  s.party.forEach((p) => { p.status = "well"; p.illness = null; p.health = 100; });
  s.party.forEach((p) => { delete p.died; });
  return s;
}

test("PC1: a death late in a winter week, whose grief days carry past 16 May: the advance stops on the 16th and the news is told", () => {
  const s = detroitWinter("1837-05-08");
  const r = withDeathOn("1837-05-14");
  const after = go(s, "week:rest", r);
  assert.ok(after.beats.some((b) => b.type === "death"), "the synthetic death happened");
  assert.ok(atNews(after.state), `no news: ${after.state.date}, queue ${JSON.stringify(after.state.queue)}`);
  assert.equal(after.state.date, NEWS_DAY);
  // The grief days left over are spent once the news has been answered.
  const answered = go(after.state, "choose:hold", r);
  assert.ok(answered.beats.some((b) => b.cue === "grief"), "the family still stops to grieve");
  assert.equal(answered.state.vars.griefDays, 0);
  assert.equal(diffDays(s.date, answered.state.date), 7 + num("grief.days"), "the grief days are all spent, none lost or added");
});

test("PC1: a death in the week that reaches 16 May: the news comes first, then the grief", () => {
  const s = detroitWinter("1837-05-11");
  const r = withDeathOn("1837-05-13");
  const after = go(s, "week:rest", r);
  assert.ok(after.beats.some((b) => b.type === "death"));
  assert.ok(atNews(after.state), `no news: ${after.state.date}`);
  assert.equal(after.state.date, NEWS_DAY);
  const answered = go(after.state, "choose:hold", r);
  assert.ok(answered.beats.some((b) => b.cue === "grief"));
  assert.equal(answered.state.date, "1837-05-18");
});

// On the Territorial Road in the spring of 1837 (the Detroit path), on `date`.
function springRoad(date) {
  const s = detroitWinter(date);
  s.phase = "travel";
  s.place = "detroit";
  s.gear = { ...s.gear, team: "oxen", wagon: true, wagonCond: num("wagon.max"), teamster: false, fatigue: 0 };
  T.startLeg(makeCtx(calm, s), "road");
  return s;
}

test("PC1: a rest on the road that lands on 16 May (no day's draw) still tells the news that day", () => {
  const s = springRoad("1837-05-15");
  const after = go(s, "rest", calm).state;
  assert.equal(after.date, NEWS_DAY);
  assert.ok(atNews(after), "told on the 16th, not dropped on the next day's travel");
});

test("PC1: a two-day repair from 15 May stops on the 16th for the news, and the rest of it is done after", () => {
  const s = springRoad("1837-05-15");
  s.gear.wagonCond = 0;
  s.vars.skills = s.vars.skills.filter((k) => k !== "repair");
  const mend = availableActions(calm, s).find((a) => a.id === "repair:slow");
  assert.equal(mend?.days, 2);
  const after = go(s, "repair:slow", calm).state;
  assert.equal(after.date, NEWS_DAY);
  assert.ok(atNews(after), "the news on its day");
  assert.equal(after.gear.wagonCond, 0, "the wagon is not mended yet");
  const answered = go(after, "choose:hold", calm).state;
  const rest = availableActions(calm, answered).find((a) => a.id === "repair:slow");
  assert.equal(rest?.days, 1, "one day of the repair is left");
  assert.match(rest.label, /\(1 day\)/);
  const mended = go(answered, "repair:slow", calm).state;
  assert.equal(mended.date, "1837-05-17");
  assert.ok(mended.gear.wagonCond > 0, "mended after the two days in all");
  assert.equal(availableActions(calm, mended).find((a) => a.id.startsWith("repair"))?.days, undefined);
});

// ---- PC2 ---------------------------------------------------------------------------

// On the last day of the passage home, `due` - 1, with one tie (`id`) still owed.
function homeEve(id, date) {
  const { state } = newGame(calm, { seed: "pc2" });
  const s = go(state, "start:vermont", calm).state;
  s.vars.path = "home";
  s.ties = [{ id, amount: 2000, sent: 0, status: "open", outcome: null, learned: false }];
  s.mail = s.mail.filter((m) => m.tie === null || m.tie === id);
  s.queue = [];
  s.date = date;
  s.purse = { coin: 50000, notes: { ne: 0, ny: 0, mi: 0 } };
  s.res.food = 5000;
  s.vars.passageDays = 3;
  T.startLeg(makeCtx(calm, s), "homePassage");
  s.vars.segMi = 2;
  s.vars.legMi = 2;
  return s;
}

test("PC2: a tie paid on arrival home on its own due date counts as paid in time (inTime's arrives <= due)", () => {
  const due = num("tie.note.due");
  const s = homeEve("note", "1836-10-24");
  assert.equal(due, "1836-10-25");
  const home = go(s, "go", calm).state;
  assert.equal(home.date, due);
  assert.equal(home.pending?.id, "home-again");
  const end = go(home, "choose:pay", calm).state;
  assert.ok(end.over, "the path ends at home");
  const t = end.ties[0];
  assert.equal(t.status, "settled");
  assert.equal(t.inTime, true, "paid on the date itself");
  assert.equal(t.outcome, "repaid", "it fell out as a paid tie");
  assert.equal(end.over.tier, 2);
});

test("PC2: a tie paid on arrival home the day after its date is late (tier 1)", () => {
  const s = homeEve("note", "1836-10-25");
  const home = go(s, "go", calm).state;
  assert.equal(home.date, "1836-10-26");
  const end = go(home, "choose:pay", calm).state;
  assert.equal(end.ties[0].inTime, false);
  assert.equal(end.over.tier, 1);
});

// ---- PC3 ---------------------------------------------------------------------------

// At Buffalo on `date`, with Uncle Amos's letter read: the kin-call, then its confirm.
function maumeeConfirm(date, { team = true } = {}) {
  const { state } = newGame(calm, { seed: "pc3" });
  const s = go(state, "start:vermont", calm).state;
  s.vars.west = { where: "ohio", name: "Uncle Amos", work: false, tie: null, bg: "vermont" };
  Object.assign(s, { phase: "town", place: "buffalo", leg: null, date, queue: [] });
  s.vars.visit = { place: "buffalo", used: {}, since: s.day };
  s.purse = { coin: 50000, notes: { ne: 0, ny: 0, mi: 0 } };
  s.res.food = 5000;
  if (!team) s.gear = { ...s.gear, team: null, wagon: false, wagonCond: 0 };
  makeCtx(calm, s).queueEvent("kin-call");
  assert.equal(s.pending?.id, "kin-call");
  const r = go(s, "choose:go", calm);
  assert.equal(r.state.pending?.id, "pivot-kin");
  return { state: r.state, text: r.beats.find((b) => b.type === "event")?.text ?? "" };
}

test("PC3: before 25 November the Maumee kin go by steamboat, deck passage", () => {
  const { state, text } = maumeeConfirm("1836-11-10");
  assert.match(text, /Deck passage to the Maumee/);
  const yes = availableActions(calm, state).find((a) => a.choice === "yes");
  assert.ok(yes?.enabled, "the boat is on offer");
  const after = go(state, "choose:yes", calm).state;
  assert.equal(after.leg, "toMaumee");
  assert.equal(T.LEGS[after.leg].mode, "steamer");
});

test("PC3: from 25 November (date.lakeLate) no steamboat takes the family to the Maumee; the Ohio road does, with a team", () => {
  assert.equal(num("date.lakeLate"), "1836-11-25");
  const { state, text } = maumeeConfirm("1836-11-25");
  assert.ok(!/[Dd]eck passage|steamboat/.test(text), text);
  const acts = availableActions(calm, state);
  const boat = acts.find((a) => a.choice === "yes");
  assert.ok(!boat || boat.enabled === false, "no boat after the lakes close");
  const road = acts.find((a) => a.choice === "road");
  assert.ok(road?.enabled, "the road with the family's own wagon");
  const coin = state.purse.coin;
  const after = go(state, "choose:road", calm).state;
  assert.equal(after.vars.path, "kin");
  assert.equal(T.LEGS[after.leg].mode, "wagon", "by the wagon");
  assert.ok(T.LEGS[after.leg].segments.some((g) => g.terrain === "swamp"), "through the Black Swamp");
  assert.equal(after.purse.coin, coin, "no fare");
  // The road ends among the kin on the Maumee.
  let s = after;
  for (let n = 0; n < 400 && !s.pending && !s.over; n++) {
    s = go(s, availableActions(calm, s).find((a) => a.id === "go" || a.id.startsWith("repair")).id, calm).state;
  }
  assert.equal(s.pending?.id, "kin-welcome");
  assert.equal(s.place, "maumee");
});

test("PC3: from 25 November without a team, the road choice is shown disabled with its reason", () => {
  const { state } = maumeeConfirm("1836-11-30", { team: false });
  const acts = availableActions(calm, state);
  assert.ok(!acts.some((a) => a.choice === "yes" && a.enabled), "no boat");
  const road = acts.find((a) => a.choice === "road");
  assert.ok(road, "the road choice is shown");
  assert.equal(road.enabled, false);
  assert.match(road.reason, /team/);
  assert.ok(acts.some((a) => a.choice === "no" && a.enabled), "the family can still decline");
});

// ---- PC4 ---------------------------------------------------------------------------

// Chicago in the spring of 1837, a lot bought for cash on `bought` and still held.
function chicagoWithLot(date = "1837-04-10") {
  const { state } = newGame(calm, { seed: "pc4" });
  const s = go(state, "start:vermont", calm).state;
  Object.assign(s, { phase: "lots", place: "chicago", leg: null, date, queue: [] });
  s.vars.path = "chicago";
  s.vars.visit = { place: "chicago", used: {}, since: s.day };
  s.flags.reachedChicago = true;
  s.purse = { coin: 50000, notes: { ne: 0, ny: 0, mi: 0 } };
  s.res.food = 5000;
  s.vars.lot = { price: 20000, paid: 20000, note: 0, bought: "1836-11-01", sold: null, forfeit: null, offer: null, soldFor: null };
  return s;
}

test("PC4: prairie land is not entered while the lot is held: farm:* is shown disabled with the reason", () => {
  const s = chicagoWithLot();
  assert.ok(Pa.lotHeld(s));
  const farms = availableActions(calm, s).filter((a) => a.id.startsWith("farm:"));
  assert.equal(farms.length, 2);
  for (const f of farms) {
    assert.equal(f.enabled, false, f.id);
    assert.match(f.reason, /lot/, f.reason);
  }
  assert.ok(step(calm, s, "farm:40").beats.some((b) => b.type === "error"), "not on offer");
});

test("PC4: once the lot is sold (or let go), the prairie is open again", () => {
  const sold = chicagoWithLot();
  sold.vars.lot.sold = "1837-03-01";
  sold.vars.lot.soldFor = 25000;
  const f = availableActions(calm, sold).find((a) => a.id === "farm:40");
  assert.ok(f?.enabled, JSON.stringify(f));
  const gone = chicagoWithLot();
  gone.vars.lot.forfeit = "1837-05-01";
  assert.ok(availableActions(calm, gone).find((a) => a.id === "farm:40")?.enabled);
});

// ---- PC6 ---------------------------------------------------------------------------

test("PC6: Chicago wages are Illinois paper, and on 20 May 1837 they pass at face though Michigan notes are down", () => {
  const r = routeWith({ ...QUIET, "winter.findP": 1 });
  const s = chicagoWithLot("1837-05-13");
  s.vars.lot = null;
  s.purse = { coin: 5000, notes: { ne: 0, ny: 0, mi: 10000 } };
  const after = go(s, "week:work", r);
  const st = after.state;
  assert.equal(st.date, "1837-05-20");
  assert.ok(P.suspended(st, num), "the Detroit banks have stopped");
  // The room is paid in the worst paper first, so Michigan notes can only go down: no wage went into them.
  assert.ok(st.purse.notes.mi <= 10000, `the wages are not Michigan notes: ${st.purse.notes.mi}`);
  assert.ok(st.purse.notes.il > 0, `Illinois notes: ${JSON.stringify(st.purse.notes)}`);
  assert.match(after.beats.filter((b) => b.type === "narrate").map((b) => b.text).join(" "), /Illinois/);
  const v = view(r, st);
  const il = v.purse.notes.find((n) => n.region === "il");
  const mi = v.purse.notes.find((n) => n.region === "mi");
  assert.equal(il.discount, 0, "Illinois paper at face before the Illinois banks stop");
  assert.equal(il.value, il.face);
  assert.ok(mi.discount >= num("disc.miSuspended"), "Michigan paper is down");
  assert.equal(v.purse.valueHere, st.purse.coin + il.face + mi.value);
});

test("PC6: Illinois paper falls when the Illinois banks stop (bank.suspend.illinois, 29 May 1837)", () => {
  assert.equal(num("bank.suspend.illinois"), "1837-05-29");
  const s = chicagoWithLot("1837-05-28");
  s.purse = { coin: 0, notes: { ne: 0, ny: 0, mi: 0, il: 10000 } };
  const zone = P.zoneOf(s, num);
  assert.equal(P.noteValue(s, num, "il"), 10000, "the day before");
  s.date = "1837-05-29";
  assert.equal(P.discount("il", zone, num, s), num("disc.ilSuspended"));
  assert.equal(P.noteValue(s, num, "il"), Math.floor(10000 * (1 - num("disc.ilSuspended"))));
});

test("PC6: a lot sold at Chicago on 20 May 1837 is paid in Illinois paper, at face that day", () => {
  const s = chicagoWithLot("1837-05-20");
  s.vars.lot.offer = 3000;
  const before = s.purse.notes.mi;
  const after = go(s, "lot:sell", calm).state;
  assert.equal(after.purse.notes.mi, before);
  assert.equal(after.purse.notes.il, 3000);
  assert.equal(P.noteValue(after, num, "il"), 3000);
});

test("PC6: a save from before Illinois paper (notes without il) still loads and values", () => {
  const s = chicagoWithLot("1837-05-20");
  s.purse = { coin: 100, notes: { ne: 0, ny: 0, mi: 1000 } };
  const v = view(calm, s);
  assert.ok(Number.isFinite(v.purse.valueHere), JSON.stringify(v.purse));
  assert.ok(availableActions(calm, s).length > 0);
});

// ---- PC7 ---------------------------------------------------------------------------

const FAILS = ["lost", "stranded"];

// The ending beat for `outcome` on `path`, from a family on that path.
function endingOn(path, outcome) {
  const { state } = newGame(calm, { seed: `pc7-${path}` });
  const s = go(state, "start:vermont", calm).state;
  s.vars.path = path;
  s.vars.west = { where: "ohio", name: "Uncle Amos", work: false, tie: null, bg: "vermont" };
  s.place = "buffalo";
  if (outcome === "lost") s.party.forEach((p) => { p.status = "dead"; p.died = { date: s.date, leg: "town", place: "buffalo", cause: "cholera" }; });
  return calm.ending(makeCtx(calm, s), { outcome, won: false, tier: 0 });
}

test("PC7: every path has its own 'lost' and 'stranded' ending, and none names a claim", () => {
  const text = readData().text;
  for (const path of Pa.PATHS) {
    for (const outcome of FAILS) {
      const E = text.paths[path].endings?.[outcome];
      assert.ok(E && E.title && E.text, `${path} ${outcome}`);
      assert.notEqual(E.text, text.endings[outcome].text, `${path} ${outcome} is the main route's`);
      assert.ok(!/claim/i.test(E.title + E.text), `${path} ${outcome}: ${E.text}`);
      const end = endingOn(path, outcome);
      assert.ok(!/claim/i.test(end.text), `${path} ${outcome}: ${end.text}`);
      assert.ok(!/\{\w+(\.\w+)?\}/.test(end.text), `${path} ${outcome}: unfilled ${end.text}`);
      assert.ok(/^[A-Z]/.test(end.text), `${path} ${outcome}: ${end.text}`);
    }
  }
  // The main route's own are unchanged.
  assert.match(text.endings.lost.text, /claim/);
});

test("PC7: endings of paths that never have a claim (Detroit, home, kin) never say claim", () => {
  const text = readData().text;
  for (const path of ["detroit", "home", "kin"]) {
    for (const [outcome, E] of Object.entries(text.paths[path].endings)) {
      assert.ok(!/claim/i.test(E.title + E.text), `${path} ${outcome}: ${E.text}`);
    }
  }
});

test("PC7: the kin path's failure endings name the kin's own place, wherever the family stopped", () => {
  for (const outcome of FAILS) {
    const end = endingOn("kin", outcome);
    assert.match(end.text, /Uncle Amos/);
    assert.match(end.text, /Maumee/);
    assert.ok(!/Buffalo/.test(end.text), end.text);
  }
});

test("PC7: a family lost on a path ends with that path's words, after the death register", () => {
  const r = withDeathOn("1836-11-02");
  const s = springRoad("1836-11-01");
  s.vars.path = "detroit";
  s.party = [s.party.find((p) => p.role === "father" || p.role === "mother")];
  const res = go(s, "rest", r);
  const kinds = res.beats.map((b) => b.type);
  const d = kinds.indexOf("death");
  assert.ok(d >= 0, kinds.join(","));
  assert.deepEqual(kinds.slice(d, d + 3), ["death", "letter", "note"], "the register's form");
  const end = res.beats.find((b) => b.type === "end");
  assert.equal(end.outcome, "lost");
  assert.equal(end.text, makeCtx(calm, res.state).text(readData().text.paths.detroit.endings.lost.text));
  assert.ok(kinds.indexOf("end") > d + 2);
});

// ---- saves ---------------------------------------------------------------------------

test("PC1, PC6: the new fields round-trip through a save; malformed ones are refused as damaged", () => {
  const s = springRoad("1837-05-15");
  s.gear.wagonCond = 0;
  const held = go(go(s, "repair:slow", calm).state, "choose:hold", calm).state;
  assert.equal(held.vars.repairLeft, 1);
  held.purse.notes.il = 1234;
  held.vars.griefHeld = true;
  const back = deserialize(calm, serialize(held));
  assert.ok(back.ok, back.reason);
  assert.deepEqual(back.state, held);
  // A save made before Illinois paper (no "il") loads.
  const old = structuredClone(held);
  delete old.purse.notes.il;
  assert.ok(deserialize(calm, serialize(old)).ok);
  for (const bad of [(x) => { x.vars.repairLeft = 0; }, (x) => { x.vars.repairLeft = "1"; }, (x) => { x.vars.griefHeld = 1; }, (x) => { x.purse.notes.il = "x"; }]) {
    const b = structuredClone(held);
    bad(b);
    assert.deepEqual(deserialize(calm, serialize(b)), { ok: false, reason: "damaged" });
  }
});
