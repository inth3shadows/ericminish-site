import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { availableActions, makeCtx, newGame, step, view } from "../../engine/engine.js";
import { validateDeck } from "../../engine/events.js";
import { loadGame, saveGame } from "../../engine/save.js";
import { isPlainJSON } from "../../engine/state.js";
import * as P from "../mechanics/purse.js";
import * as H from "../mechanics/health.js";
import { loadRouteFromDisk, readData } from "./load.mjs";
import { SCENES } from "../route.js";

const route = loadRouteFromDisk();
const data = readData();
const ROOT = fileURLToPath(new URL("../", import.meta.url));

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function started(bg = "vermont", seed = "t", params = {}) {
  const { state } = newGame(route, { seed });
  return step(route, state, { id: `start:${bg}`, ...params }).state;
}

// Drive with a fixed policy: forward actions first, first choice in events.
function driveUntil(state, done, limit = 400) {
  for (let i = 0; i < limit && !state.over && !done(state); i++) {
    const acts = availableActions(route, state).filter((a) => a.enabled);
    const a = acts.find((x) => x.type === "choose") ?? acts.find((x) => x.id === "sell-team") ?? acts.find((x) => x.forward) ?? acts[0];
    state = step(route, state, a).state;
  }
  return state;
}

// ---- data ---------------------------------------------------------------------

test("the event deck validates and is big enough", () => {
  assert.deepEqual(validateDeck(route), []);
  assert.ok(route.events.length >= 40, `${route.events.length} events`);
  const decks = new Set(route.events.map((e) => e.deck));
  for (const d of ["travel", "town", "office", "claim"]) assert.ok(decks.has(d), d);
});

test("every event has a sourced note, or says plainly that it is invented", () => {
  for (const e of route.events) {
    const n = e.note;
    assert.ok(n && n.text && n.source, `${e.id}: note`);
    assert.ok(["solid", "likely", "uncertain", "invented"].includes(n.confidence), `${e.id}: confidence`);
    const sentences = n.text.split(/(?<=[.!?]["”]?)\s+(?=[A-Z"“])/).length;
    assert.ok(sentences >= 1 && sentences <= 3, `${e.id}: note is ${sentences} sentences`);
    if (n.confidence === "invented") assert.match(n.text, /invented/i, `${e.id}: invented note must say so`);
    else if (n.url == null) assert.equal(n.confidence, "uncertain", `${e.id}: a note without a URL must be marked uncertain`);
    else assert.match(n.url, /^https:\/\//, `${e.id}: url`);
  }
});

test("no Oregon Trail phrasing", () => {
  const prose = (e) => [e.text, ...(e.choices ?? []).flatMap((c) => [c.label, c.result])];
  const all = JSON.stringify(data.events.flatMap(prose)) + JSON.stringify(data.text.letters) + JSON.stringify(data.text.burial);
  for (const banned of [/you have died of/i, /tombstone/i, /\bford(ing)?\b/i, /epitaph/i, /you have dysentery/i]) {
    assert.doesNotMatch(all, banned);
  }
});

test("numbers.json: every entry tagged, sourced or explained", () => {
  const ids = new Set();
  for (const n of data.numbers) {
    assert.ok(n.id && !ids.has(n.id), `duplicate or missing id ${n.id}`);
    ids.add(n.id);
    assert.ok(n.unit, `${n.id}: unit`);
    assert.ok(typeof n.value === "number" || (n.unit === "date" && /^\d{4}-\d{2}-\d{2}$/.test(n.value)), `${n.id}: value`);
    assert.ok(["src", "invented"].includes(n.tag), `${n.id}: tag`);
    if (n.tag === "src") {
      assert.ok(n.source && /^https:\/\//.test(n.url), `${n.id}: src needs source and url`);
      assert.ok(["solid", "likely", "uncertain"].includes(n.confidence), `${n.id}: confidence`);
    } else assert.ok(n.note && n.note.length > 10, `${n.id}: invented needs a reason`);
  }
});

function codeFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = `${dir}/${d.name}`;
    if (d.isDirectory()) return ["test", "data", "art", "ui"].includes(d.name) ? [] : codeFiles(p);
    return d.name.endsWith(".js") ? [p] : [];
  });
}

test("every number the code or data names exists, and none is unused", () => {
  const ids = new Set(data.numbers.map((n) => n.id));
  const text = codeFiles(ROOT.replace(/\/$/, "")).map((f) => readFileSync(f, "utf8")).join("\n");
  const json = JSON.stringify([data.events, data.backgrounds, data.text]);
  const named = new Set([
    ...[...text.matchAll(/(?:num|usd)\((?:ctx, )?"([\w.]+)"\)/g)].map((m) => m[1]),
    ...[...json.matchAll(/"#([\w.]+)"/g)].map((m) => m[1]),
  ]);
  for (const id of named) assert.ok(ids.has(id), `missing number ${id}`);
  // ids built from a prefix in code (zone.${...}, ague.base.${...}, ...) count as used by prefix
  const prefixes = [...text.matchAll(/`([\w.]+)\.\$\{/g)].map((m) => `${m[1]}.`);
  const fromSegments = [...text.matchAll(/miles: "([\w.]+)"/g)].map((m) => m[1]);
  const unused = [...ids].filter((id) => !named.has(id) && !fromSegments.includes(id) && !prefixes.some((p) => id.startsWith(p)) && !text.includes(`"${id}"`));
  assert.deepEqual(unused, []);
});

test("events.json holds no bare game numbers (all go through numbers.json)", () => {
  const offenders = [];
  const walk = (node, key, where) => {
    if (typeof node === "number") {
      if (key === "month" || key === "dow" || node === 0 || node === 1) return;
      offenders.push(`${where}: ${node}`);
    } else if (Array.isArray(node)) {
      const parentKey = key;
      node.forEach((n) => walk(n, parentKey, where));
    } else if (node && typeof node === "object") Object.entries(node).forEach(([k, v]) => walk(v, k, where));
  };
  for (const e of data.events) walk(e, null, e.id);
  assert.deepEqual(offenders, []);
});

// ---- purse ----------------------------------------------------------------------

test("note discounts: Detroit paper at 7.5 percent in New York, eastern paper loses value going west", () => {
  const n = route.num;
  assert.equal(P.discount("mi", n("zone.albany"), n), 0.075);
  assert.equal(P.discount("mi", n("zone.detroit"), n), 0);
  assert.equal(P.discount("ne", n("zone.home"), n), 0);
  const west = ["albany", "buffalo", "detroit", "bronson"].map((z) => P.discount("ne", n(`zone.${z}`), n));
  assert.deepEqual([...west].sort((a, b) => a - b), west);
  assert.ok(west[3] > west[0]);
  assert.ok(P.discount("ne", 99, n) <= n("disc.max"));
});

test("merchants are paid in the worst paper first, then coin", () => {
  const s = started();
  s.place = "detroit"; s.phase = "town";
  s.purse = { coin: 1000, notes: { ne: 1000, ny: 1000, mi: 1000 } };
  assert.equal(P.pay(s, route.num, 500), true);
  assert.ok(s.purse.notes.ne < 1000, "New England notes (worst at Detroit) spent first");
  assert.equal(s.purse.notes.mi, 1000);
  assert.equal(s.purse.coin, 1000);
  assert.equal(P.pay(s, route.num, 999999), false);
});

test("the Receiver: Michigan notes yes, New England no, New York depends, coin only after 15 December", () => {
  const n = route.num;
  const s = started();
  s.purse = { coin: 100, notes: { ne: 5000, ny: 3000, mi: 2000 } };
  let t = P.landTender(s, n, 80, false, true);
  assert.deepEqual(t, { coin: 100, mi: 2000, ny: 0 });
  t = P.landTender(s, n, 80, true, true);
  assert.equal(t.ny, 3000);
  t = P.landTender(s, n, 80, true, false);
  assert.deepEqual(t, { coin: 100, mi: 0, ny: 0 });
  t = P.landTender(s, n, 400, true, true);
  assert.equal(t.mi, 0, "more than the settler limit pays in coin");
});

test("brokers are capped by the coin they hold", () => {
  const s = started();
  s.place = "bronson"; s.phase = "office";
  s.purse = { coin: 0, notes: { ne: 50000, ny: 0, mi: 0 } };
  const got = P.brokerToCoin(s, route.num, P.cents(route.num("broker.capBronson")));
  assert.equal(got, P.cents(route.num("broker.capBronson")));
  assert.ok(s.purse.notes.ne > 0 && s.purse.notes.ne < 50000);
});

// ---- the journey ------------------------------------------------------------------

test("start: three backgrounds, editable names, sanitised", () => {
  const { state } = newGame(route, { seed: "names" });
  const acts = availableActions(route, state);
  assert.deepEqual(acts.map((a) => a.id), ["start:vermont", "start:connecticut", "start:widow"]);
  assert.ok(acts.every((a) => a.party.length >= 4 && a.editable.includes("names")));
  const s = step(route, state, { id: "start:widow", surname: "Ames<script>", names: { p1: "Prudence", p2: "", p3: "x".repeat(60) } }).state;
  assert.equal(s.vars.surname, "Amesscript");
  assert.equal(s.party[0].name, "Prudence");
  assert.equal(s.party[1].name, "Caleb");
  assert.equal(s.party[2].name.length, 24);
  assert.equal(s.leg, "vermont");
});

test("the Albany decision: sell the team, or ship it as freight on the canal", () => {
  let s = driveUntil(started(), (st) => st.place === "albany" && st.phase === "town" && !st.pending);
  const acts = availableActions(route, s);
  const sell = acts.find((a) => a.id === "sell-team");
  const keep = acts.find((a) => a.id === "board:line");
  assert.ok(sell && keep);
  const sold = step(route, s, "sell-team").state;
  const soldFare = availableActions(route, sold).find((a) => a.id === "board:line").cost;
  assert.ok(keep.cost > soldFare, "keeping the team costs freight");
  assert.equal(sold.gear.team, null);
});

test("packet is faster than the line boat", () => {
  const atAlbany = driveUntil(started("vermont", "boats"), (st) => st.place === "albany" && st.phase === "town" && !st.pending);
  const daysToBuffalo = (id) => {
    let s = step(route, atAlbany, id).state;
    const start = s.day;
    s = driveUntil(s, (st) => st.place === "buffalo");
    return s.day - start;
  };
  assert.ok(daysToBuffalo("board:packet") < daysToBuffalo("board:line"));
});

test("a full cautious-style game reaches an ending with an epilogue", () => {
  const s = driveUntil(started("widow", "full"), () => false, 600);
  assert.ok(s.over, "game ended");
  assert.ok(isPlainJSON(s));
});

// ---- death register ------------------------------------------------------------------

test("a death gives the fixed register: factual line, fiction letter, sourced note; then grief", () => {
  const s = started("vermont", "death");
  const ctx = makeCtx(route, s);
  const child = s.party.find((p) => p.id === "p6");
  H.sicken(ctx, child.id, "ague");
  child.health = 0.5;
  s.vars.today = { kind: "travel" };
  ctx.advanceDays(1);
  const types = ctx.beats.map((b) => b.type);
  const i = types.indexOf("death");
  assert.ok(i >= 0, "death beat");
  assert.deepEqual(types.slice(i, i + 3), ["death", "letter", "note"]);
  const [death, letter, note] = ctx.beats.slice(i, i + 3);
  assert.match(death.text, /^Ruth Hale, aged 4, died of fever and ague on \d+ September 1836, on the road to Albany\./);
  assert.match(death.text, /buried her/);
  assert.equal(letter.fiction, true);
  assert.match(letter.label, /fiction/i);
  assert.match(letter.text, /Dear Brother/);
  assert.match(letter.text, /Asa Hale$/);
  assert.doesNotMatch(letter.text, /\{|\}/);
  assert.ok(note.source && note.text);
  assert.equal(s.vars.griefDays, route.num("grief.days"));
  assert.equal(s.res.morale, route.num("morale.start") - route.num("grief.morale"));
  for (const b of ctx.beats) assert.equal(b.score, undefined, "no score for deaths");
});

test("grief costs days after the action", () => {
  let s = started("vermont", "grief");
  s.party[5].status = "sick"; s.party[5].illness = { kind: "dysentery", days: 0 }; s.party[5].health = 1;
  const day = s.day;
  const r = step(route, s, "go");
  assert.ok(r.beats.some((b) => b.type === "death"));
  assert.ok(r.beats.some((b) => b.cue === "grief"));
  assert.equal(r.state.day - day, 1 + route.num("grief.days"));
});

test("letters never name a real person: signed by the fictional family or a nameless traveller", () => {
  for (const t of [...data.text.letters.adult, ...data.text.letters.child, ...data.text.letters.stranger]) {
    assert.match(t, /\{sign\}$/);
  }
  assert.match(data.text.letterLabel, /fiction/i);
});

// ---- the land office and the deadline ------------------------------------------------

function atOffice(seed, bg = "vermont") {
  return driveUntil(started(bg, seed), (st) => st.phase === "office" && !st.pending);
}

test("land: look, enter at the window, wait, pay, go to the claim", () => {
  let s = atOffice("land");
  assert.equal(s.phase, "office");
  s.purse.coin += P.cents(500);
  s = step(route, s, "plat").state;
  const apply = availableActions(route, s).find((a) => a.type === "apply" && a.acres === 40);
  s = step(route, s, apply).state;
  assert.ok(s.land.applied);
  for (let i = 0; i < 60 && !s.land.ready && s.land.applied && !s.over; i++) {
    s = step(route, s, s.pending ? availableActions(route, s)[0] : "wait").state;
  }
  // An office event can open on the day the description clears: answer it before paying.
  for (let i = 0; i < 10 && s.pending && !s.over; i++) s = step(route, s, availableActions(route, s)[0]).state;
  if (!s.land.applied) return; // a conflicting claim took it: covered by the sim
  const coin = s.purse.coin;
  s = step(route, s, "pay:coin").state;
  assert.equal(s.land.paid, true);
  assert.equal(coin - s.purse.coin, P.cents(40 * route.num("price.land")));
  assert.ok(availableActions(route, s).some((a) => a.id === "go-claim"));
});

test("after 15 December the Receiver takes coin only, and too little coin means the end", () => {
  let s = atOffice("deadline");
  s.date = "1836-12-16";
  s.vars.snowDate = "1836-12-30"; s.vars.winterDate = "1836-12-31";
  s.purse = { coin: P.cents(10), notes: { ne: 0, ny: 0, mi: P.cents(20) } };
  s.land.candidates = [{ id: "t9", kind: "openings", poor: false, known: true, miles: 5, via: "looker" }];
  const acts = availableActions(route, s);
  assert.ok(acts.filter((a) => a.type === "apply").every((a) => a.enabled === false), "paper no longer counts");
  const r = step(route, s, "rest");
  assert.equal(r.state.over?.outcome, "deadline");
  assert.ok(r.beats.some((b) => b.type === "end" && b.title && b.epilogue.length));
});

// ---- determinism and saving ------------------------------------------------------------

test("same seed, same moves, same game; a save resumes identically", () => {
  const storage = memoryStorage();
  const policy = (s) => {
    const acts = availableActions(route, s).filter((a) => a.enabled);
    return acts.find((a) => a.type === "choose") ?? acts.find((a) => a.forward) ?? acts[0];
  };
  const run = (s, n) => { for (let i = 0; i < n && !s.over; i++) s = step(route, s, policy(s)).state; return s; };
  const a = run(started("connecticut", "det"), 200);
  const b = run(started("connecticut", "det"), 200);
  assert.deepEqual(a, b);
  const mid = run(started("connecticut", "det"), 40);
  assert.equal(saveGame(mid, { storage }), true);
  const loaded = loadGame(route, { storage });
  assert.equal(loaded.ok, true);
  assert.deepEqual(run(loaded.state, 160), a);
});

test("the HUD view is plain data", () => {
  const s = driveUntil(started(), (st) => st.leg === "canal");
  const v = view(route, s);
  assert.ok(isPlainJSON(v));
  assert.equal(v.travel.leg, "canal");
  assert.equal(v.purse.notes.length, 4); // ne, ny, mi, and Illinois paper (PC6; 3 before round 9)
  assert.equal(v.deadline.date, "1836-12-15");
  assert.ok(v.party.every((p) => ["well", "sick", "dead"].includes(p.status)));
});

test("every scene key emitted by code or data is listed in SCENES", () => {
  const text = codeFiles(ROOT.replace(/\/$/, "")).map((f) => readFileSync(f, "utf8")).join("\n") + JSON.stringify(data.events);
  const keys = new Set([
    ...[...text.matchAll(/scene: "([\w-]+)"/g)].map((m) => m[1]),
    ...[...text.matchAll(/"scene": "([\w-]+)"/g)].map((m) => m[1]),
    ...[...text.matchAll(/\? "([\w-]+)" : "([\w-]+)"/g)].flatMap((m) => [m[1], m[2]]).filter((k) => k in SCENES || k.includes("-")),
    "town-albany", "town-buffalo", "town-detroit",
  ]);
  for (const k of keys) assert.ok(k in SCENES, `scene ${k} is not in SCENES`);
});

// Review N1: the route lists the kinds of day an event's "days" effect may spend,
// so validateDeck can check every "as" in the deck.
test("the route exports its event-day kinds, and every event's days use one of them", () => {
  assert.deepEqual([...route.eventDayKinds].sort(), ["aboard", "apart", "halt", "inn", "rest"]);
  assert.deepEqual(validateDeck(route), []);
});
