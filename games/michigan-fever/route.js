// Michigan Fever, 1836: Vermont or Connecticut to a claim near the Bronson
// (Kalamazoo) land office before the settler exemption ends on 15 December.
// This file wires the route-owned mechanics into the engine's route
// interface (see games/engine/engine.js). No DOM.

import { compare, diffDays, addDays, format, dayOfWeek, fromDayNumber, toDayNumber } from "../engine/clock.js";
import { addRes, resolve } from "../engine/events.js";
import * as P from "./mechanics/purse.js";
import * as H from "./mechanics/health.js";
import * as T from "./mechanics/travel.js";
import * as L from "./mechanics/landoffice.js";
import * as M from "./mechanics/home.js";
import * as Pa from "./mechanics/paths.js";

// Every scene key a "scene" beat can carry, for the UI and art to map to images.
export const SCENES = {
  farm: "The worn-out hill farm in Vermont or Connecticut, the morning of leaving",
  "road-vermont": "Wagon on a hill road toward Albany, autumn",
  "town-albany": "The Albany canal basin and wharf, crowded with emigrants",
  canal: "On the Erie Canal: a packet or line boat, towpath, low bridges",
  "town-buffalo": "Buffalo harbour, steamboats and emigrants waiting",
  lake: "A steamboat on Lake Erie",
  "lake-storm": "A steamboat in a gale on Lake Erie",
  "ohio-road": "Wagon on the Ohio turnpike west of Buffalo",
  "black-swamp": "The Black Swamp road: standing water, deep mud, corduroy",
  "toledo-strip": "The Maumee country near Perrysburg and Toledo",
  "town-detroit": "Detroit street, crowded taverns, the land office window",
  "territorial-road": "The corduroy Territorial Road west of Detroit",
  "land-office": "Bronson (Kalamazoo): tents of the land lookers around the land offices",
  "claim-track": "A wagon track through oak openings out to the claim",
  claim: "The family's own land, untouched trees",
  cabin: "A log cabin going up, neighbours helping",
  // The alternative paths (P2 Phase B). No new art: each falls back to a scene above (SCENE_FALLBACK).
  "winter-detroit": "Detroit in winter: a rented room, the river frozen, work by the day",
  "chicago-road": "The Chicago road west through Michigan: oak openings and prairie",
  "town-chicago": "Chicago in 1836: land auctions, speculators and emigrants in the street",
  "lima-road": "A forest track south through the Ohio swamp country to Lima",
  "lima-office": "The land office at Lima, Ohio",
  "road-home": "The long way home: the lake, the canal and the hill road east",
  home: "The hill farm again, the family come back",
  "kin-farm": "Kin already settled: a cabin and a cleared field",
};

// New places reuse the paintings: each new scene key stands for one of the
// scenes above (the UI's art map reads it; no new art, user decision).
export const SCENE_FALLBACK = {
  "winter-detroit": "town-detroit",
  "chicago-road": "territorial-road",
  "town-chicago": "town-detroit",
  "lima-road": "claim-track",
  "lima-office": "land-office",
  "road-home": "road-vermont",
  home: "farm",
  "kin-farm": "claim",
};

export const ROUTE_ID = "michigan-fever";
export const ROUTE_VERSION = 3; // 2: P2 Phase A (pace and fatigue, the schedule queue, home ties, letters); 3: Phase B (the paths, tiers)
const list = (x) => (Array.isArray(x) ? x : [x]);
const usd = (ctx, id) => P.cents(ctx.num(id));
const TOWNS = new Set(["albany", "buffalo", "detroit"]);
const NOTE_KIND = { albany: "ny", buffalo: "ny", detroit: "mi", bronson: "mi" };
// Post offices where the family stops (Perrysburg, passed on the Ohio road, has its own event).
const POST_TOWNS = new Set(["albany", "buffalo", "detroit", "bronson"]);
const PACE_LABEL = { steady: "steady", hard: "hard", grueling: "grueling" };

// ---- setup --------------------------------------------------------------------

function init(ctx) {
  const { state: s, num, rng } = ctx;
  const T0 = ctx.route.data.text;
  s.phase = "start";
  s.place = "home";
  s.party = [];
  s.purse = P.emptyPurse();
  s.gear = { team: null, wagon: false, wagonCond: 0, goods: 0, teamster: false, fatigue: 0 };
  s.land = L.newLand();
  s.ties = [];
  s.mail = [];
  s.res = { food: 0, morale: num("morale.start"), quinine: 0 };
  const spread = diffDays(num("date.snowEarliest"), num("date.snowLatest"));
  Object.assign(s.vars, {
    background: null, surname: "", kin: null, skills: [], ticket: null, teamSold: false,
    seg: 0, segMi: 0, legMi: 0, terrain: null, tollMi: 0,
    visit: { place: "home", used: {} }, griefDays: 0, today: null,
    pace: "steady", lettersHome: 0, sendTie: null,
    // The paths (Phase B): which one (null = the main route), the kin out west,
    // the Chicago lot, the day home or among kin, and the passage home's days.
    path: null, west: null, lot: null, homeOn: null, arrivedOn: null, passageDays: 0,
    snowDate: addDays(num("date.snowEarliest"), rng.int(0, spread)),
  });
  // Deep winter closes the season a few days after the first snow, and never later than the year's end.
  const close = addDays(s.vars.snowDate, num("winter.graceDays"));
  s.vars.winterDate = compare(close, num("date.yearEnd")) < 0 ? close : num("date.yearEnd");
  ctx.emit({ type: "scene", scene: "farm" });
  ctx.emit({ type: "narrate", text: T0.intro });
  ctx.emit({ type: "note", about: "start", ...T0.introNote });
}

function cleanName(v, fallback) {
  if (typeof v !== "string") return fallback;
  const t = v.replace(/[^\p{L}\p{M}' .-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 24);
  return t || fallback;
}

function startGame(ctx, bgId, params) {
  const { state: s } = ctx;
  const bg = ctx.route.data.backgrounds.find((b) => b.id === bgId);
  const names = params.names ?? {};
  s.vars.background = bg.id;
  s.vars.surname = cleanName(params.surname, bg.surname);
  s.vars.kin = bg.kin;
  s.vars.skills = [...bg.skills];
  s.party = bg.party.map((m) => ({
    id: m.id, name: cleanName(names[m.id], m.name), age: m.age, role: m.role, sex: m.sex,
    health: ctx.num("health.max"), status: "well", illness: null, fatigue: 0,
  }));
  s.purse.coin = P.cents(resolve(bg.purse.coin, ctx));
  for (const r of P.REGIONS) s.purse.notes[r] = P.cents(resolve(bg.purse.notes[r] ?? 0, ctx));
  s.res.food = resolve(bg.food, ctx);
  s.gear = { team: bg.team, wagon: true, wagonCond: ctx.num("wagon.max"), goods: resolve(bg.goods, ctx), teamster: false, fatigue: 0 };
  // What they leave behind: two or three ties at home, the letters home will write, and the tie events.
  M.drawTies(ctx, bg);
  Pa.drawWest(ctx, bg);
  M.makeMail(ctx);
  M.scheduleTies(ctx);
  ctx.emit({ type: "narrate", text: ctx.text(bg.departure) });
  T.startLeg(ctx, "vermont");
}

// ---- costs --------------------------------------------------------------------

function fareUnits(ctx) {
  return H.living(ctx.state).reduce((a, p) => a + (H.isChild(p, ctx.num) ? ctx.num("fare.childShare") : 1), 0);
}

function teamFreight(ctx, where) {
  const s = ctx.state;
  if (!s.gear.team) return 0;
  return P.cents(ctx.num(`freight.${where}.team`) + ctx.num("wagon.cwt") * ctx.num(`freight.${where}.cwt`));
}

const CANAL = { packet: "fare.packet.perMile", "line-meals": "fare.lineMeals.perMile", line: "fare.line.perMile" };

function canalCost(ctx, ticket) {
  const { num, state: s } = ctx;
  const bargain = ticket !== "packet" && s.flags.lineBargain ? num("ev.lineBargain.mult") : 1;
  const people = Math.round(fareUnits(ctx) * num(CANAL[ticket]) * num("mi.canal") * bargain * 100);
  return people + P.cents(s.gear.goods * num("freight.canal.cwt")) + teamFreight(ctx, "canal");
}

function lakeCost(ctx, cls) {
  const { num, state: s } = ctx;
  const people = Math.round(fareUnits(ctx) * num(`fare.${cls}`) * 100);
  return people + P.cents(s.gear.goods * num("freight.lake.cwt")) + teamFreight(ctx, "lake");
}

function needPerDay(ctx) {
  return H.living(ctx.state).reduce((a, p) => a + (H.isChild(p, ctx.num) ? ctx.num("food.childShare") : 1), 0);
}

function lodgingCost(ctx) {
  const id = ctx.state.place === "detroit" ? "price.lodging.detroit" : "price.lodging.east";
  return Math.round(H.living(ctx.state).length * ctx.num(id) * 100);
}

function flourPrice(ctx) {
  // A winter town (Detroit or Chicago on a path) after the lakes close: the scarcity price.
  if (["winter", "lots"].includes(ctx.state.phase) && compare(ctx.state.date, ctx.num("date.lakeLate")) >= 0) return usd(ctx, "price.flour.winter");
  return usd(ctx, `price.flour.${ctx.state.place === "bronson" ? "bronson" : ctx.state.place === "detroit" ? "detroit" : "east"}`);
}

// Farms that will sell food are some days apart.
function provisionsOpen(ctx) {
  const last = ctx.state.vars.provDay;
  return last == null || ctx.state.day - last >= ctx.num("food.provisionsGap");
}

// In Michigan the bundle is priced from PC18's pork and potatoes; in the east the price is invented.
function provisionsCost(ctx) {
  const { state: s, num } = ctx;
  const west = s.phase === "claim" || ["road", "claim"].includes(s.leg);
  if (!west) return usd(ctx, "price.provisions.east");
  return P.cents(num("food.provisions.porkLb") * num("price.pork.lb") + num("food.provisions.potatoBu") * num("price.potatoes.bu"));
}

function wageFor(ctx) {
  const { num, state: s } = ctx;
  const adults = H.ableAdults(s, num);
  if (!adults) return 0;
  const skilled = s.vars.skills.includes("repair") ? 1 : 0;
  return P.cents((adults - skilled) * num("wage.day") + skilled * num("wage.skilled"));
}

const has = (ctx, k) => Boolean(ctx.state.vars.visit.used[k]);
const use = (ctx, k) => { ctx.state.vars.visit.used[k] = (ctx.state.vars.visit.used[k] ?? 0) + 1; };

function priced(ctx, id, type, label, cost, extra = {}) {
  const ok = P.canPay(ctx.state, ctx.num, cost);
  return { id, type, label, cost, enabled: ok, reason: ok ? undefined : `You cannot raise ${P.money(cost)} here.`, ...extra };
}

// ---- actions ------------------------------------------------------------------

function startActions(ctx) {
  return ctx.route.data.backgrounds.map((b) => ({
    id: `start:${b.id}`, type: "start", background: b.id, label: b.label, detail: b.blurb,
    surname: b.surname,
    party: b.party.map(({ id, name, age, role, sex }) => ({ id, name, age, role, sex })),
    purse: { coin: P.cents(resolve(b.purse.coin, ctx)), notes: Object.fromEntries(P.REGIONS.map((r) => [r, P.cents(resolve(b.purse.notes[r] ?? 0, ctx))])) },
    team: b.team, skills: b.skills, editable: ["surname", "names"],
  }));
}

function anyAgue(s) {
  return H.living(s).some((p) => p.illness?.kind === "ague");
}

const isSunday = (s) => dayOfWeek(s.date) === 0;

// The paces on offer with the family's own wagon. The pace is a parameter of
// the travel action ({id: "go", pace}), not an action of its own: the player
// sets it next to the travel buttons, and it holds until changed.
function paceOptions(ctx) {
  const s = ctx.state;
  if (!T.ownPace(s)) return null;
  const good = T.GOOD_ROAD.has(s.vars.terrain);
  const base = ctx.num(s.gear.team === "horse" ? "speed.horse" : "speed.oxen");
  const LABEL = { steady: "Steady", hard: "Hard", grueling: "Grueling" };
  return T.PACES.map((p) => ({
    pace: p, label: LABEL[p],
    detail: good
      ? `About ${Math.round(base * ctx.num(`speed.pace.${p}`))} miles a day on good road.${p === "steady" ? " The pace a family can keep." : " The family and the team tire faster."}`
      : `The ${T.TERRAIN_LABEL[s.vars.terrain]} will not go faster for pushing.${p === "steady" ? "" : " The family and the team still tire faster."}`,
  }));
}

function travelActions(ctx) {
  const s = ctx.state;
  const leg = T.LEGS[s.leg];
  const out = [];
  if (leg.mode === "wagon" && !s.gear.teamster && s.gear.wagonCond <= 0) {
    if (s.vars.skills.includes("repair")) out.push({ id: "repair:self", type: "repair", label: "Mend the wagon yourself (1 day)", days: 1, forward: true });
    else out.push({ id: "repair:slow", type: "repair", label: `Mend the wagon as best you can (${ctx.num("wagon.repairDays")} days)`, days: ctx.num("wagon.repairDays"), forward: true });
  } else {
    const paced = T.ownPace(s) && s.vars.pace !== "steady" ? ` (${PACE_LABEL[s.vars.pace]} pace)` : "";
    const label = { wagon: `Drive on for the day${paced}`, canal: "Another day on the canal", steamer: "Another day on the lake", stage: "Another day on the stage" }[leg.mode];
    const paces = paceOptions(ctx);
    out.push({ id: "go", type: "travel", label, days: 1, forward: true, ...(paces ? { pace: s.vars.pace, paces } : {}) });
  }
  if (leg.mode === "wagon") {
    out.push({ id: "rest", type: "rest", label: "Rest a day in camp", days: 1 });
    if (isSunday(s)) out.push({ id: "sabbath", type: "rest", label: "Keep the Sabbath: rest the day", days: 1, detail: "A day of rest by custom. The family recovers more than on a common rest day." });
    if (provisionsOpen(ctx)) {
      const cost = provisionsCost(ctx);
      out.push(priced(ctx, "buy:provisions", "buy", `Buy provisions from a farm by the road (${P.money(cost)})`, cost));
    }
  }
  if (anyAgue(s) && s.res.quinine > 0) out.push({ id: "dose", type: "dose", label: "Give quinine to the sick" });
  return out;
}

function commonTownActions(ctx, out) {
  const s = ctx.state;
  const place = s.place;
  if (!has(ctx, "broker") && P.paperValue(s, ctx.num) > 0) {
    out.push({ id: "broker:coin", type: "broker", label: "Sell paper to a broker for coin", detail: "Brokers pay the going discount here and keep a fee.", remedy: true });
  }
  if ((place === "detroit" || place === "bronson") && !has(ctx, "brokerMi") && (s.purse.notes.ne + s.purse.notes.ny) > 0) {
    out.push({ id: "broker:mi", type: "broker", label: "Swap eastern notes for Michigan notes", remedy: true });
  }
  if ((s.vars.visit.used.flour ?? 0) < ctx.num("shop.maxBarrels")) {
    out.push(priced(ctx, "buy:flour", "buy", `Buy a barrel of flour (${P.money(flourPrice(ctx))})`, flourPrice(ctx)));
  }
  if (place !== "bronson" && !has(ctx, "quinine")) {
    out.push(priced(ctx, "buy:quinine", "buy", `Buy a dose of quinine (${P.money(usd(ctx, "price.quinine"))})`, usd(ctx, "price.quinine"), { remedy: anyAgue(s) }));
  }
  if (place !== "bronson") {
    out.push(priced(ctx, "stay", "rest", `Take lodging for a day (${P.money(lodgingCost(ctx))})`, lodgingCost(ctx), { days: 1 }));
  }
  if (H.ableAdults(s, ctx.num) > 0) out.push({ id: "work", type: "work", label: `Hire out for a day (up to ${P.money(wageFor(ctx))})`, days: 1 });
  if (POST_TOWNS.has(place)) postActions(ctx, out);
  if (anyAgue(s) && s.res.quinine > 0) out.push({ id: "dose", type: "dose", label: "Give quinine to the sick", remedy: true });
}

// The post office is one action; its event offers what can be done there now
// (ask for letters once a visit, write home, send a tie's money home).
// One call a visit (a week at Bronson). The menu comes back after each errand
// while something is left to do (the "postLeft" binder on post-office).
function postLeft(ctx) {
  const { state: s, num } = ctx;
  return !has(ctx, "post") || !has(ctx, "letter") || s.ties.some((t) => M.canSendFor(s, num, t));
}

function postActions(ctx, out) {
  if (!has(ctx, "postCall") && postLeft(ctx)) out.push({ id: "post", type: "post", label: "Go to the post office", detail: "Ask for letters, write home, or send money home." });
}

function postVars(ctx) {
  const { state: s, num } = ctx;
  const letter = M.letterCost(num, s.place);
  const vars = { letter: P.money(letter), letterUsd: letter / 100 };
  for (const t of M.summary(ctx.route, s)) {
    vars[`send_${t.id}`] = `Send ${P.money(t.amount)} home for ${t.purpose}`;
    vars[`why_${t.id}`] = M.sendWhy(ctx.route, s, num, M.tieOf(s, t.id)) ?? "";
  }
  return vars;
}

function townActions(ctx) {
  const s = ctx.state;
  const out = [];
  if (s.place === "albany") {
    if (s.gear.team && !s.vars.teamSold) {
      out.push({ id: "sell-team", type: "sell", label: `Sell the wagon and team here (${P.money(teamSaleValue(ctx))} in New York notes)`, remedy: true });
    }
    const keep = s.gear.team ? " Your wagon and team go as freight." : "";
    out.push(priced(ctx, "board:packet", "board", `Packet boat, 4 miles an hour, meals and berth (${P.money(canalCost(ctx, "packet"))})`, canalCost(ctx, "packet"), { forward: true, detail: `Faster and less crowded.${keep}` }));
    out.push(priced(ctx, "board:line-meals", "board", `Line boat with meals, 3 miles an hour (${P.money(canalCost(ctx, "line-meals"))})`, canalCost(ctx, "line-meals"), { forward: true, detail: `Slower, crowded with emigrants.${keep}` }));
    out.push(priced(ctx, "board:line", "board", `Line boat, find your own food (${P.money(canalCost(ctx, "line"))})`, canalCost(ctx, "line"), { forward: true, detail: `Cheapest. You eat from your own stores.${keep}` }));
  } else if (s.place === "buffalo") {
    out.push(priced(ctx, "book:cabin", "board", `Steamboat to Detroit, cabin passage (${P.money(lakeCost(ctx, "cabin"))})`, lakeCost(ctx, "cabin"), { forward: true, detail: "About three days. Meals and a berth." }));
    out.push(priced(ctx, "book:deck", "board", `Steamboat to Detroit, deck passage (${P.money(lakeCost(ctx, "deck"))})`, lakeCost(ctx, "deck"), { forward: true, detail: "About three days on deck. Bring your own food." }));
    if (s.gear.team) {
      out.push({ id: "overland", type: "board", label: "Go overland through Ohio and the Black Swamp", detail: "374 miles by your own wagon. No fare, but the swamp road is passable mainly July to September.", forward: true });
    } else {
      out.push(priced(ctx, "buy-team", "buy", `Buy a yoke of oxen and a wagon for the overland road (${P.money(teamPrice(ctx))})`, teamPrice(ctx), { forward: true }));
      // Late in the year, the winter stage (Blois: $25 a passenger in the winter season).
      if (compare(s.date, ctx.num("date.lakeLate")) >= 0) {
        const fare = stageCost(ctx);
        out.push(priced(ctx, "stage:winter", "board", `Take the winter stage to Detroit (${P.money(fare)})`, fare, { forward: true, detail: `About ${ctx.num("stage.days")} days by road, with the late boats taking their chances on the lake.` }));
      }
    }
  } else if (s.place === "detroit" && s.vars.path === "home") {
    // Turning back: the passage east from here (the lake or the winter stage, the canal, the hill road).
    const way = Pa.passage(s, ctx.num, "detroit", fareUnits(ctx));
    out.push(priced(ctx, "passage", "board", `Take passage home (${P.money(way.cost)}, about ${way.days} days)`, way.cost, { forward: true, detail: way.lateLake ? "The lakes are closing: the winter stage to Buffalo, then the canal and the road." : "Deck passage to Buffalo, the line boat to Albany, then the road." }));
  } else if (s.place === "detroit") {
    if (!s.gear.team && !s.gear.teamster) {
      out.push(priced(ctx, "buy-team", "buy", `Buy a yoke of oxen and a wagon (${P.money(teamPrice(ctx))})`, teamPrice(ctx), { forward: true }));
      out.push(priced(ctx, "hire-teamster", "buy", `Hire a teamster to carry you and your goods west (${P.money(usd(ctx, "price.teamster"))})`, usd(ctx, "price.teamster"), { forward: true }));
    }
    const ready = Boolean(s.gear.team || s.gear.teamster);
    out.push({ id: "set-out", type: "travel", label: setOutLabel(s), forward: true, enabled: ready, reason: ready ? undefined : "You need a team or a teamster first." });
  }
  yokeAction(ctx, out);
  pivotActions(ctx, out);
  commonTownActions(ctx, out);
  return out;
}

// Where "set out" from Detroit goes: the Territorial Road, or a path's own road.
function setOutLeg(s) {
  if (s.vars.path === "chicago") return "chicagoRoad";
  if (s.vars.path === "kin") return Pa.KIN_LEG[s.vars.west.where];
  return "road";
}

function setOutLabel(s) {
  const leg = setOutLeg(s);
  if (leg === "road") return "Set out on the Territorial Road";
  if (leg === "chicagoRoad") return "Set out on the Chicago road";
  return `Set out for ${T.PLACES[Pa.kinPlace(s)]}`;
}

// ---- the paths (P2 Phase B) ---------------------------------------------------

// The pivots on offer here. Each opens its own confirm (an event, decline
// first); a pivot is one-way, so none is offered once the family is on a path.
function pivotActions(ctx, out) {
  const { state: s, num } = ctx;
  if (s.vars.path) return;
  const town = s.phase === "town";
  if (town && s.place === "detroit" && (compare(s.date, num("path.detroit.offerFrom")) >= 0 || Pa.bronsonUnlikely(s, num))) {
    out.push({ id: "pivot:detroit", type: "pivot", label: "Stay the winter in Detroit and work for wages", detail: "Land in the spring, in coin. There is no going back from it." });
  }
  if (town && (s.place === "detroit" || (s.place === "buffalo" && compare(s.date, num("date.lakeLate")) < 0))) {
    out.push({ id: "pivot:chicago", type: "pivot", label: "Go on to Chicago, where town lots are selling", detail: s.place === "buffalo" ? "Round the lakes by steamboat." : "By the Chicago road, or the stage." });
  }
  if ((town && (s.place === "buffalo" || s.place === "detroit")) || (s.phase === "office" && s.place === "bronson" && !s.land.paid)) {
    out.push({ id: "pivot:home", type: "pivot", label: "Turn back for home", detail: "Back the way you came, at a cost." });
  }
}

// What a pivot's confirm needs to say: the fares and the way.
function pivotVars(ctx, which) {
  const { state: s, num } = ctx;
  const units = fareUnits(ctx);
  if (which === "chicago") {
    const stage = Math.round(units * num("fare.stage.chicago") * 100);
    const lakes = chicagoLakesCost(ctx);
    return { stage: P.money(stage), stageUsd: stage / 100, lakes: P.money(lakes), lakesUsd: lakes / 100, miles: num("mi.detroitChicago") };
  }
  if (which === "home") {
    if (s.place === "bronson") {
      const cost = s.gear.team || s.gear.teamster ? 0 : usd(ctx, "price.teamster");
      const fare = cost ? `A teamster back to Detroit costs ${P.money(cost)}.` : s.gear.team ? "Your own wagon takes you back to Detroit." : "Your teamster will take you back to Detroit.";
      return { cost: P.money(cost), costUsd: cost / 100, fare, way: ctx.route.data.text.paths.home.fromBronson };
    }
    const way = Pa.passage(s, num, s.place, units);
    return { cost: P.money(way.cost), costUsd: way.cost / 100, fare: `The fares come to ${P.money(way.cost)}.`, way: ctx.text(ctx.route.data.text.paths.home[way.lateLake ? "late" : "early"], { days: way.days }) };
  }
  return {};
}

function chicagoLakesCost(ctx) {
  const { state: s, num } = ctx;
  return Math.round(fareUnits(ctx) * num("fare.cabin.chicago") * 100) + P.cents(s.gear.goods * num("freight.chicago.cwt"))
    + (s.gear.team ? P.cents(num("freight.lake.team") + num("wagon.cwt") * num("freight.chicago.cwt")) : 0);
}

function maumeeCost(ctx) {
  const { state: s, num } = ctx;
  return Math.round(fareUnits(ctx) * num("fare.maumee") * 100) + P.cents(s.gear.goods * num("freight.lake.cwt")) + teamFreight(ctx, "lake");
}

// The pivot itself (the confirm's "yes"): set the path, then its first leg or phase.
function startPath(ctx, spec) {
  const { state: s, num } = ctx;
  const [id, via] = String(spec).split(":");
  const W = ctx.route.data.text.paths;
  s.vars.path = id;
  switch (id) {
    case "detroit":
      s.phase = "winter";
      s.vars.visit = { place: s.place, used: {}, since: s.day };
      ctx.emit({ type: "scene", scene: "winter-detroit" });
      ctx.emit({ type: "narrate", text: ctx.text(W.detroit.start) });
      // The news of the New York suspension comes by the morning boat the day before Detroit's banks stop.
      ctx.schedule({ event: "win-suspension-news", in: Math.max(1, diffDays(s.date, addDays(num("bank.suspend.detroit"), -1))) });
      return;
    case "chicago":
      if (via === "stage") {
        P.pay(s, num, Math.round(fareUnits(ctx) * num("fare.stage.chicago") * 100));
        s.vars.ticket = null;
        T.startLeg(ctx, "chicagoStage");
      } else if (via === "lakes") {
        P.pay(s, num, chicagoLakesCost(ctx));
        s.vars.ticket = "cabin";
        T.startLeg(ctx, "chicagoLakes");
      }
      ctx.emit({ type: "narrate", text: ctx.text(W.chicago.start[via]) });
      return;
    case "ohio":
      s.vars.ticket = null;
      T.startLeg(ctx, "toLima");
      ctx.emit({ type: "narrate", text: ctx.text(W.ohio.start) });
      return;
    case "home":
      if (s.place === "bronson") {
        if (!s.gear.team && !s.gear.teamster) {
          P.pay(s, num, usd(ctx, "price.teamster"));
          s.gear.teamster = true;
        }
        L.withdraw(ctx);
        T.startLeg(ctx, "backRoad");
        ctx.emit({ type: "narrate", text: ctx.text(W.home.startBronson) });
      } else startPassage(ctx);
      return;
    case "kin":
      if (s.vars.west.where === "ohio") {
        P.pay(s, num, maumeeCost(ctx));
        s.vars.ticket = "deck";
        T.startLeg(ctx, "toMaumee");
      }
      ctx.emit({ type: "narrate", text: ctx.text(W.kin.start[s.vars.west.where], { name: s.vars.west.name }) });
      return;
    default:
      throw new Error(`unknown path ${spec}`);
  }
}

// Turning back from Buffalo or Detroit: one passage home, paid here.
function startPassage(ctx) {
  const { state: s, num } = ctx;
  const way = Pa.passage(s, num, s.place, fareUnits(ctx));
  P.pay(s, num, way.cost);
  s.vars.passageDays = way.days;
  s.vars.ticket = "deck";
  s.gear.teamster = false;
  T.startLeg(ctx, "homePassage");
  ctx.emit({ type: "narrate", text: ctx.text(ctx.route.data.text.paths.home.passage, { days: way.days }) });
}

// A week in a winter town (Detroit, or Chicago through the lull): a room by
// the night if it can be paid for, the food, and work by the day if wanted
// and found. Sundays are rest days.
function winterWeek(ctx, working) {
  const { state: s, num } = ctx;
  const kind = s.place === "chicago" ? "mi" : NOTE_KIND[s.place] ?? "mi";
  let earned = 0;
  let cold = 0;
  for (let d = 0; d < num("winter.weekDays") && !s.over; d++) {
    const sunday = dayOfWeek(addDays(s.date, 1)) === 0;
    const lodged = P.pay(s, num, P.cents(num("winter.room")));
    if (!lodged) cold += 1;
    const labour = working && !sunday && H.ableAdults(s, num) > 0;
    const found = labour && ctx.rng.chance(num("winter.findP"));
    const wage = found ? wageFor(ctx) : 0;
    // One room for the whole family in a crowded boom town: crowded, for sickness (the
    // bar-room floors Kirkland describes), whether or not the rent was paid.
    passDay(ctx, labour ? { kind: "work", lodged, crowded: true } : { kind: "rest", resting: true, lodged, crowded: true });
    if (s.over) return;
    if (wage > 0) { P.receive(s, kind, wage); earned += wage; }
  }
  const W = ctx.route.data.text.paths.winter;
  if (working) ctx.emit({ type: "narrate", text: earned > 0 ? ctx.text(W.earned, { amount: P.money(earned), paper: s.place === "chicago" ? W.westernPaper : P.REGION_LABEL[kind] }) : ctx.text(W.noWork) });
  if (cold) ctx.emit({ type: "narrate", text: ctx.text(W.noRoom, { n: cold === 1 ? "one night" : `${cold} nights` }) });
  // A new week: the store, the broker and the post office open again.
  s.vars.visit = { place: s.place, used: {}, since: s.day };
  if (Pa.lotHeld(s)) s.vars.lot.offer = Pa.rollOffer(ctx);
  maybeEvent(ctx, "winter", "ev.p.winter");
}

// The actions of a winter town, a week at a time.
function winterActions(ctx) {
  const { state: s, num } = ctx;
  const out = [];
  const est = P.cents(num("wage.day")) * H.ableAdults(s, num);
  if (H.ableAdults(s, num) > 0) out.push({ id: "week:work", type: "work", label: `Work the week by the day (up to ${P.money(wageFor(ctx))} a day)`, days: num("winter.weekDays"), forward: true, detail: `Work is scarcer in winter. The room is ${P.money(P.cents(num("winter.room")))} a night.` });
  out.push({ id: "week:rest", type: "rest", label: "Keep to the room for the week", days: num("winter.weekDays"), forward: est === 0 });
  if (s.phase === "winter") {
    const thawed = compare(s.date, num("date.thaw")) >= 0;
    const ready = Boolean(s.gear.team || s.gear.teamster);
    if (!ready && thawed) {
      out.push(priced(ctx, "buy-team", "buy", `Buy a yoke of oxen and a wagon (${P.money(teamPrice(ctx))})`, teamPrice(ctx), { forward: true }));
      out.push(priced(ctx, "hire-teamster", "buy", `Hire a teamster to carry you and your goods west (${P.money(usd(ctx, "price.teamster"))})`, usd(ctx, "price.teamster"), { forward: true }));
    }
    out.push({ id: "spring", type: "travel", label: "Go west to the land office on the Territorial Road", forward: true, enabled: thawed && ready,
      reason: !thawed ? "Not before the thaw: the roads open about the first of April." : ready ? undefined : "You need a team or a teamster first." });
  } else lotActions(ctx, out);
  winterTownActions(ctx, out);
  return out;
}

// Chicago: the lot, its buyers, and government land nine miles out.
function lotActions(ctx, out) {
  const { state: s, num } = ctx;
  const lot = s.vars.lot;
  if (!lot) {
    const price = Pa.lotMarket(s, num);
    const down = Math.round(price * num("lot.down"));
    out.push(priced(ctx, "lot:cash", "lot", `Buy a town lot for ${P.money(price)}, cash`, price, { detail: "Sell it again before the spring, if a buyer comes." }));
    out.push(priced(ctx, "lot:credit", "lot", `Buy a town lot on credit: ${P.money(down)} down, a note for the rest at ten per cent`, down, { detail: `The note falls due on 1 May 1837.` }));
  } else if (Pa.lotHeld(s) && lot.offer) {
    const owed = Pa.lotOwed(s, num);
    const short = Math.max(0, owed - lot.offer);
    const ok = P.canPay(s, num, short);
    out.push({ id: "lot:sell", type: "lot", label: `Sell the lot to this week's buyer for ${P.money(lot.offer)}`, forward: false, enabled: ok,
      reason: ok ? undefined : `The note stands at ${P.money(owed)}: you cannot make up the difference.`, detail: owed ? `The note, ${P.money(owed)}, is paid out of the price.` : undefined });
  }
  if (!s.land.paid) {
    for (const sizeId of ["land.acres.small", "land.acres.mid"]) {
      const acres = num(sizeId);
      const cost = L.landCost(num, acres);
      const tender = P.landTender(s, num, acres, false, L.beforeDeadline(s, num));
      const ok = P.tenderTotal(tender) >= cost;
      out.push({ id: `farm:${acres}`, type: "apply", label: `Enter ${acres} acres of prairie ${num("farm.chicago.miles")} miles out (${P.money(cost)})`, cost, forward: !Pa.lotHeld(s),
        enabled: ok, reason: ok ? undefined : L.beforeDeadline(s, num) ? "The Receiver would not take enough of what is in your purse." : "Since 15 December the land office takes only coin." });
    }
  }
}

// The town errands of a winter week: flour, the broker, quinine, the post office.
function winterTownActions(ctx, out) {
  const s = ctx.state;
  if (!has(ctx, "broker") && P.paperValue(s, ctx.num) > 0) {
    out.push({ id: "broker:coin", type: "broker", label: "Sell paper to a broker for coin", detail: "Brokers pay the going discount here and keep a fee." });
  }
  if ((s.vars.visit.used.flour ?? 0) < ctx.num("shop.maxBarrels")) {
    out.push(priced(ctx, "buy:flour", "buy", `Buy a barrel of flour (${P.money(flourPrice(ctx))})`, flourPrice(ctx)));
  }
  if (!has(ctx, "quinine")) out.push(priced(ctx, "buy:quinine", "buy", `Buy a dose of quinine (${P.money(usd(ctx, "price.quinine"))})`, usd(ctx, "price.quinine")));
  if (POST_TOWNS.has(s.place)) postActions(ctx, out);
  if (anyAgue(s) && s.res.quinine > 0) out.push({ id: "dose", type: "dose", label: "Give quinine to the sick" });
}


// A team gone short (an ox given out): a fresh yoke makes it up again. Offered
// wherever a leg the family drives ends and another can start (Albany, Buffalo,
// Detroit, Bronson), so a team that goes short can be made whole before it pulls
// again. Not at the claim (L1): no leg starts there.
function yokeAction(ctx, out, from = "") {
  const s = ctx.state;
  if (!s.gear.team || !s.flags.teamShort) return;
  const yoke = usd(ctx, "price.oxen");
  out.push(priced(ctx, "buy-yoke", "buy", `Buy a fresh yoke${from} to make up the team (${P.money(yoke)})`, yoke));
}

function officeActions(ctx) {
  const { state: s, num } = ctx;
  const land = s.land;
  const out = [];
  if (land.paid) {
    out.push({ id: "go-claim", type: "travel", label: `Go out to the claim (${land.claimMiles} miles)`, forward: true });
    yokeAction(ctx, out);
    return out;
  }
  yokeAction(ctx, out);
  if (!land.looker && !land.applied) {
    out.push(priced(ctx, "hire-looker", "buy", `Hire a land looker (${P.money(usd(ctx, "price.looker"))})`, usd(ctx, "price.looker"), { detail: "He knows which sections are still open and which are swamp." }));
  }
  if (!land.applied) {
    if (land.candidates.length < num("land.maxCandidates")) {
      out.push({ id: "explore", type: "explore", label: land.looker ? "Ride the section lines with your land looker" : "Walk the section lines yourself", days: 1, forward: true });
      if (!land.platUsed) out.push({ id: "plat", type: "explore", label: "Pick a tract off the plat, sight unseen", forward: true });
    }
    for (const c of land.candidates) {
      for (const sizeId of L.SIZES) {
        const acres = num(sizeId);
        const cost = L.landCost(num, acres);
        const tender = L.tenderFor(s, num, acres);
        const ok = P.tenderTotal(tender) >= cost;
        out.push({ id: `apply:${c.id}:${acres}`, type: "apply", tract: c.id, tractId: c.id, tractLabel: L.candidateLabel(c), acres, cost, forward: true,
          label: `Enter ${acres} acres: ${L.candidateLabel(c)} (${P.money(cost)})`,
          enabled: ok, reason: ok ? undefined : "The Receiver would not take enough of what is in your purse." });
      }
    }
  } else if (!land.ready) {
    out.push({ id: "wait", type: "wait", label: `Wait on the land office window (about ${land.queue} more days)`, days: 1, forward: true });
    out.push({ id: "withdraw", type: "apply", label: "Withdraw your application" });
  } else {
    const { acres } = land.applied;
    const cost = L.landCost(num, acres);
    const tender = L.tenderFor(s, num, acres);
    if (tender.mi + tender.ny > 0) {
      const ok = P.tenderTotal(tender) >= cost;
      out.push({ id: "pay:notes", type: "pay", label: `Pay ${P.money(cost)} in notes the Receiver will take, the rest in coin`, cost, forward: true, enabled: ok, reason: ok ? undefined : "Not enough money he will take." });
    }
    const okCoin = tender.coin >= cost;
    out.push({ id: "pay:coin", type: "pay", label: `Pay ${P.money(cost)} in coin`, cost, forward: true, enabled: okCoin, reason: okCoin ? undefined : "Not enough coin." });
    out.push({ id: "withdraw", type: "apply", label: "Withdraw your application" });
  }
  out.push({ id: "rest", type: "rest", label: "Rest a day in the tents", days: 1 });
  pivotActions(ctx, out);
  commonTownActions(ctx, out);
  return out;
}

function claimActions(ctx) {
  const s = ctx.state;
  const days = ctx.num("build.days");
  const out = [{ id: "build", type: "build", label: `Cut logs and raise the cabin (${days} days)`, days, forward: true }];
  const hands = P.cents(ctx.num("wage.day") * ctx.num("hands.count") * days);
  out.push(priced(ctx, "hire-hands", "build", `Hire ${ctx.num("hands.count")} hands to work alongside you (${days} days, ${P.money(hands)})`, hands, { days, forward: true }));
  out.push({ id: "rest", type: "rest", label: "Rest a day", days: 1 });
  if (isSunday(s)) out.push({ id: "sabbath", type: "rest", label: "Keep the Sabbath: rest the day", days: 1 });
  if (provisionsOpen(ctx)) {
    const cost = provisionsCost(ctx);
    out.push(priced(ctx, "buy:provisions", "buy", `Buy provisions from a neighbour (${P.money(cost)})`, cost));
  }
  // No fresh yoke here (L1): no leg starts at the claim, so a yoke would pull nothing.
  if (anyAgue(s) && s.res.quinine > 0) out.push({ id: "dose", type: "dose", label: "Give quinine to the sick" });
  return out;
}

function actions(ctx) {
  switch (ctx.state.phase) {
    case "start": return startActions(ctx);
    case "travel": return travelActions(ctx);
    case "town": return townActions(ctx);
    case "office": return officeActions(ctx);
    case "claim": return claimActions(ctx);
    case "winter":
    case "lots": return winterActions(ctx);
    default: return [];
  }
}

// ---- acting -------------------------------------------------------------------

function teamSaleValue(ctx) {
  const s = ctx.state;
  return P.cents(ctx.num(s.gear.team === "horse" ? "sell.horse" : "sell.oxen") + ctx.num("sell.wagon"));
}

function teamPrice(ctx) {
  return P.cents(ctx.num("price.oxen") + ctx.num("price.wagon"));
}

function stageCost(ctx) {
  return Math.round(fareUnits(ctx) * ctx.num("fare.winterStage") * 100);
}

// What a day aboard is like on the current ticket: meals and a berth on the
// packet, the line boat with meals and the cabin; crowding on the line boats and the deck.
function boatDay(s) {
  const mode = s.phase === "travel" ? T.LEGS[s.leg]?.mode : null;
  // The winter stage: crowded, but each night at an inn on the road.
  if (mode === "stage") return { meals: false, crowded: true, lodged: true };
  const meals = (mode === "canal" && ["packet", "line-meals"].includes(s.vars.ticket)) || (mode === "steamer" && s.vars.ticket === "cabin");
  const crowded = (mode === "canal" && s.vars.ticket !== "packet") || (mode === "steamer" && s.vars.ticket === "deck");
  return { meals, crowded, lodged: meals && mode !== "wagon" };
}

// The days an event choice spends (a "days" effect with "as"): each day's
// conditions come from where the family is now, never from the action before.
const EVENT_DAYS = {
  rest: (s) => ({ kind: "rest", resting: true, lodged: false, crowded: s.phase === "office" }),   // a day in camp
  halt: (s) => ({ kind: "halt", lodged: false, crowded: s.phase === "office" }),                  // stopped, not resting: waiting, labouring, ashore
  apart: () => ({ kind: "apart", lodged: false, crowded: false }),                                // away from the crowded camp
  aboard: (s) => ({ kind: "aboard", ...boatDay(s) }),                                           // lying to on the boat
  inn: () => ({ kind: "inn", resting: true, lodged: true }),                                     // under a roof, paid for
};

export const EVENT_DAY_KINDS = Object.freeze(Object.keys(EVENT_DAYS));

function eventDay(ctx, as) {
  const f = EVENT_DAYS[as];
  if (!f) throw new Error(`an event's days need a known "as": ${as}`);
  ctx.state.vars.today = f(ctx.state);
}

function passDay(ctx, today) {
  ctx.state.vars.today = today;
  ctx.advanceDays(1);
}

// Queued consequences (V5, round 6). At most one fires in a step: the day's
// draw (a travel day, a day in town or at the office, the arrival) fires the
// first one due, and a step that fired none fires the next one waiting for this
// place. Items counted in days come due only on the day's draw, so at most one a
// day; the random draw stays at most one a day. A place's items all fire while
// the family is there: each later step in the town fires the next, and leaving
// meets the next one first (see LEAVING), so none is left behind. A town with
// several waiting can see several in a day, one a step: that is the rule chosen
// over "one a day", which could only be kept by holding the family in town.
function fireQueued(ctx, opts) {
  if (ctx.queueFired) return false;
  const fired = ctx.fireDue(opts);
  if (fired) ctx.queueFired = true;
  return fired;
}

// Actions that leave a town or the land office.
const LEAVING = new Set(["board", "book", "overland", "stage", "set-out", "go-claim", "spring", "passage", "farm"]);

function maybeEvent(ctx, deck, pId) {
  // No other event on a day someone died: the family stops to grieve first.
  if (ctx.state.over || ctx.state.pending || ctx.state.vars.griefDays > 0) return;
  // A scheduled consequence that has come due fires ahead of the random draw,
  // which still happens unless it opened a choice. The draw does not fire the
  // queue a second time.
  fireQueued(ctx);
  if (ctx.state.over || ctx.state.pending) return;
  if (ctx.rng.chance(ctx.num(pId))) ctx.drawEvent(deck, { due: false });
}

// Queued troubles that belong to the family's own outfit ("outfit": "team" or
// "wagon" on the event) go with it when it is sold or replaced.
function dropOutfit(ctx, kinds) {
  const s = ctx.state;
  s.queue = (s.queue ?? []).filter((q) => !kinds.includes(ctx.route.eventIndex.get(q.event)?.outfit));
}

function arriveTown(ctx, place) {
  const s = ctx.state;
  s.place = place;
  s.leg = null;
  s.vars.visit = { place, used: {}, since: s.day };
  s.vars.terrain = null;
  const T0 = ctx.route.data.text;
  const kin = Object.values(Pa.KIN_PLACES).includes(place);
  let phase = "town";
  let scene = `town-${place}`;
  if (place === "bronson") { phase = "office"; scene = "land-office"; s.flags.reachedBronson = true; }
  else if (place === "claim") { phase = "claim"; scene = "claim"; }
  else if (place === "lima") { phase = "office"; scene = "lima-office"; s.flags.reachedLima = true; }
  else if (place === "chicago") { phase = "lots"; scene = "town-chicago"; s.flags.reachedChicago = true; }
  else if (kin) { phase = "kin"; scene = "kin-farm"; s.vars.arrivedOn = s.date; }
  else if (place === "home") { phase = "home"; scene = "home"; s.vars.homeOn = s.date; }
  s.phase = phase;
  ctx.emit({ type: "scene", scene });
  ctx.emit({ type: "arrive", place, label: T.PLACES[place], date: s.date, text: T0.arrivals[place] });
  s.vars.ticket = null;
  s.gear.teamster = ["bronson", "claim", "lima"].includes(place) ? s.gear.teamster : false;
  // The end of a path's road: the kin's welcome, home again, the Chicago land sales.
  if (kin) { ctx.startEvent("kin-welcome", kinVars(ctx)); return; }
  if (place === "home") { ctx.startEvent("home-again", homeVars(ctx)); return; }
  fireQueued(ctx);
  if (place === "chicago") { ctx.queueEvent("chi-arrive"); return; }
  if (place === "lima") return;
  ctx.drawEvent("town", { due: false });
}

function kinVars(ctx) {
  const s = ctx.state;
  return { name: s.vars.west.name, kinPlace: T.PLACES[s.place], land: P.money(Pa.kinLandCost(ctx.num)), landUsd: Pa.kinLandCost(ctx.num) / 100 };
}

function homeVars(ctx) {
  const owed = Pa.owedAtHome(ctx.state);
  return { owed: P.money(owed), owedUsd: owed / 100 };
}

function travelDay(ctx) {
  const s = ctx.state;
  const leg = T.LEGS[s.leg];
  const weather = T.rollWeather(ctx);
  ctx.emit({ type: "weather", weather, terrain: s.vars.terrain });
  // The day's miles, split where it crosses into a new segment (L2): the rest
  // of the day runs at the new terrain's own pace, and tolls fall on its swamp miles.
  const run = T.dayRun(ctx, weather);
  const miles = run.reduce((a, r) => a + r.miles, 0);
  passDay(ctx, { kind: "travel", ...boatDay(s) });
  if (s.over) return;
  const swampMiles = run.filter((r) => r.terrain === "swamp").reduce((a, r) => a + r.miles, 0);
  if (swampMiles > 0) tolls(ctx, swampMiles);
  const { passed, done } = T.advance(ctx, miles);
  for (const place of passed.slice(0, done ? -1 : undefined)) {
    ctx.emit({ type: "arrive", place, label: T.PLACES[place], date: s.date, passing: true, text: ctx.route.data.text.arrivals[place] });
    if (place === "perrysburg" || place === "sandusky") ctx.emit({ type: "scene", scene: place === "sandusky" ? "black-swamp" : "toledo-strip" });
    // Perrysburg's post office, passed on the Ohio road: nothing waits there.
    if (place === "perrysburg" && !s.events.seen["post-perrysburg"]) {
      ctx.queueEvent("post-perrysburg");
    }
    // The Ohio path: turn south here for the Lima land office (Phase B).
    if (place === "perrysburg" && !s.vars.path && s.leg === "overland" && !s.events.seen["ohio-offer"]) ctx.queueEvent("ohio-offer");
  }
  if (done) {
    const dest = leg.segments[leg.segments.length - 1].to;
    arriveTown(ctx, dest);
  } else {
    if (miles === 0) ctx.emit({ type: "narrate", text: "The wagon does not move today." });
    maybeEvent(ctx, "travel", "ev.p.travel");
  }
}

function tolls(ctx, miles) {
  const s = ctx.state;
  s.vars.tollMi += miles;
  while (s.vars.tollMi >= ctx.num("toll.gapMiles")) {
    s.vars.tollMi -= ctx.num("toll.gapMiles");
    if (P.pay(s, ctx.num, usd(ctx, "price.toll"))) ctx.emit({ type: "narrate", text: `A toll gate on the swamp road: ${P.money(usd(ctx, "price.toll"))}.` });
  }
}

function boardBoat(ctx, leg, ticket, cost) {
  const s = ctx.state;
  P.pay(s, ctx.num, cost);
  s.vars.ticket = ticket;
  T.startLeg(ctx, leg);
  ctx.emit({ type: "narrate", text: ctx.route.data.text.boarding[ticket] });
}

function dose(ctx) {
  const s = ctx.state;
  for (const p of H.living(s)) {
    if (p.illness?.kind === "ague" && s.res.quinine > 0) {
      s.res.quinine -= 1;
      H.cure(ctx, p.id);
    }
  }
}

function work(ctx) {
  const s = ctx.state;
  const kind = NOTE_KIND[s.place] ?? "ny";
  const wage = wageFor(ctx);
  const found = ctx.rng.chance(ctx.num("work.findP"));
  passDay(ctx, { kind: "work", lodged: false });
  if (s.over) return;
  if (found && wage > 0) {
    P.receive(s, kind, wage);
    ctx.emit({ type: "narrate", text: `A day's hire brings in ${P.money(wage)} in ${P.REGION_LABEL[kind]}.` });
  } else {
    ctx.emit({ type: "narrate", text: "There is no hire to be had today." });
  }
}

function act(ctx, a, params) {
  const s = ctx.state;
  const { num } = ctx;
  const [verb, arg, arg2] = a.id.split(":");
  // Something still waiting for the family here meets them as they make ready
  // to leave; they leave on the next try, once it is dealt with.
  if (LEAVING.has(verb) && fireQueued(ctx, { atOnly: true })) return;
  switch (verb) {
    case "start": startGame(ctx, a.background, params); return;
    case "go":
      // The pace rides on the travel action ({id: "go", pace}); it holds until changed.
      if (T.PACES.includes(params.pace) && T.ownPace(s)) s.vars.pace = params.pace;
      travelDay(ctx);
      return;
    case "sabbath": {
      passDay(ctx, { kind: "sabbath", resting: true, lodged: false });
      if (!s.over) addRes(ctx, "morale", num("morale.sabbath"));
      if (s.phase === "claim" && !s.over) maybeEvent(ctx, "claim", "ev.p.claim");
      return;
    }
    case "post": use(ctx, "postCall"); ctx.startEvent("post-office", postVars(ctx)); return;
    case "stage": {
      P.pay(s, num, a.cost);
      s.vars.ticket = null;
      T.startLeg(ctx, "stage");
      ctx.emit({ type: "narrate", text: ctx.route.data.text.stage });
      return;
    }
    case "rest": {
      passDay(ctx, { kind: "rest", resting: true, lodged: false, crowded: s.phase === "office" });
      if (s.phase === "office") maybeEvent(ctx, "office", "ev.p.office");
      if (s.phase === "claim") maybeEvent(ctx, "claim", "ev.p.claim");
      return;
    }
    case "repair": {
      passDay(ctx, { kind: "repair" });
      if (a.days > 1) ctx.advanceDays(a.days - 1);
      if (s.over) return;
      s.gear.wagonCond = num(arg === "self" ? "wagon.max" : "wagon.patched");
      s.flags.wheelMended = true; // a wedged wheel's breakdown (chain-axle) no longer waits down the road
      ctx.emit({ type: "narrate", text: "The wagon is fit to roll again." });
      return;
    }
    case "dose": dose(ctx); return;
    case "sell-team": {
      P.receive(s, "ny", teamSaleValue(ctx));
      s.gear.team = null;
      s.gear.wagon = false;
      s.gear.wagonCond = 0;
      s.vars.teamSold = true;
      delete s.flags.teamShort;
      dropOutfit(ctx, ["team", "wagon"]);
      ctx.emit({ type: "narrate", text: "A drover buys the wagon and team, paying in New York paper." });
      return;
    }
    case "board": boardBoat(ctx, "canal", arg, a.cost); return;
    case "book": boardBoat(ctx, "lake", arg, a.cost); return;
    case "overland": {
      s.vars.ticket = null;
      T.startLeg(ctx, "overland");
      ctx.emit({ type: "narrate", text: ctx.route.data.text.overland });
      return;
    }
    case "buy-team": {
      P.pay(s, num, a.cost);
      s.gear = { ...s.gear, team: "oxen", wagon: true, wagonCond: num("wagon.max"), teamster: false, fatigue: 0 };
      delete s.flags.teamShort;
      dropOutfit(ctx, ["team", "wagon"]);
      ctx.emit({ type: "narrate", text: "You buy a yoke of oxen and a wagon." });
      return;
    }
    case "buy-yoke": {
      P.pay(s, num, a.cost);
      freshTeam(ctx);
      ctx.emit({ type: "narrate", text: "You buy a fresh yoke and leave the spent animal in part payment. The team is whole again." });
      return;
    }
    case "hire-teamster": {
      P.pay(s, num, a.cost);
      s.gear.teamster = true;
      ctx.emit({ type: "narrate", text: "A teamster agrees to carry the family and the goods west." });
      return;
    }
    case "set-out": {
      const leg = setOutLeg(s);
      T.startLeg(ctx, leg);
      ctx.emit({ type: "narrate", text: leg === "road" ? ctx.route.data.text.setOut : ctx.text(ctx.route.data.text.paths.setOut[leg], { name: s.vars.west?.name ?? "" }) });
      return;
    }
    // ---- the paths ----
    case "pivot": ctx.startEvent(`pivot-${arg}`, pivotVars(ctx, arg)); return;
    case "week": winterWeek(ctx, arg === "work"); return;
    case "spring": T.startLeg(ctx, "road"); ctx.emit({ type: "narrate", text: ctx.text(ctx.route.data.text.paths.detroit.spring) }); return;
    case "passage": startPassage(ctx); return;
    case "lot": {
      if (arg === "sell") {
        const lot = s.vars.lot;
        const owed = Pa.lotOwed(s, num);
        if (owed > lot.offer) P.pay(s, num, owed - lot.offer);
        else P.receive(s, "mi", lot.offer - owed);
        lot.sold = s.date;
        lot.soldFor = lot.offer;
        lot.note = 0;
        lot.offer = null;
        ctx.emit({ type: "narrate", text: ctx.text(ctx.route.data.text.paths.chicago.sold, { amount: P.money(lot.soldFor) }) });
        return;
      }
      const price = Pa.lotMarket(s, num);
      const paid = arg === "cash" ? price : a.cost;
      P.pay(s, num, paid);
      s.vars.lot = { price, paid, note: price - paid, bought: s.date, sold: null, forfeit: null, offer: null, soldFor: null };
      if (arg === "credit") ctx.schedule({ event: "lot-note-due", in: Math.max(1, diffDays(s.date, num("lot.noteDue"))), unless: { not: { lot: "owing" } } });
      ctx.emit({ type: "narrate", text: ctx.text(ctx.route.data.text.paths.chicago[arg === "cash" ? "boughtCash" : "boughtCredit"], { price: P.money(price) }) });
      return;
    }
    case "farm": {
      const acres = Number(arg);
      const cost = L.landCost(num, acres);
      if (!P.payLand(s, num, cost, { useNotes: true, tender: P.landTender(s, num, acres, false, L.beforeDeadline(s, num)) })) return;
      L.settle(ctx, { id: "chi", kind: "prairie", poor: false, known: true, miles: num("farm.chicago.miles"), via: "chicago" }, acres);
      ctx.emit({ type: "narrate", text: `The Receiver counts out ${P.money(cost)} and writes your receipt for ${acres} acres of prairie.`, cue: "receipt" });
      T.startLeg(ctx, "claim");
      if (!s.gear.team && !s.gear.teamster) s.gear.teamster = true;
      return;
    }
    case "broker": {
      if (arg === "coin") {
        use(ctx, "broker");
        const cap = usd(ctx, s.place === "bronson" ? "broker.capBronson" : "broker.cap");
        const got = P.brokerToCoin(s, num, cap);
        ctx.emit({ type: "narrate", text: got > 0 ? `The broker counts out ${P.money(got)} in silver for your paper.` : "The broker has no coin to spare today." });
      } else {
        use(ctx, "brokerMi");
        const got = P.brokerToMichigan(s, num);
        ctx.emit({ type: "narrate", text: `You come away with ${P.money(got)} in Michigan notes.` });
      }
      return;
    }
    case "buy": {
      P.pay(s, num, a.cost);
      if (arg === "flour") { use(ctx, "flour"); addRes(ctx, "food", num("food.perBarrel")); ctx.emit({ type: "narrate", text: "A barrel of flour goes into the wagon." }); }
      if (arg === "provisions") { s.vars.provDay = s.day; addRes(ctx, "food", num("food.provisions")); ctx.emit({ type: "narrate", text: "A farm wife sells you bread, potatoes and a side of salt pork." }); }
      if (arg === "quinine") { use(ctx, "quinine"); addRes(ctx, "quinine", 1); ctx.emit({ type: "narrate", text: "The druggist wraps a dose of quinine." }); }
      return;
    }
    case "stay": P.pay(s, num, a.cost); passDay(ctx, { kind: "rest", resting: true, lodged: true }); if (!s.over) maybeEvent(ctx, "town", "ev.p.town"); return;
    case "work": work(ctx); if (s.phase === "office" && !s.over) maybeEvent(ctx, "office", "ev.p.office"); return;
    case "hire-looker": P.pay(s, num, a.cost); s.land.looker = true; ctx.emit({ type: "narrate", text: ctx.route.data.text.looker }); return;
    case "explore":
      passDay(ctx, { kind: "explore", crowded: false });
      if (!s.over) { L.exploreDay(ctx); maybeEvent(ctx, "office", "ev.p.office"); }
      return;
    case "plat": s.land.platUsed = true; L.addCandidate(ctx, "plat"); return;
    case "apply": L.apply(ctx, arg, Number(arg2)); return;
    case "wait":
      passDay(ctx, { kind: "wait", crowded: true });
      if (!s.over) maybeEvent(ctx, "office", "ev.p.office");
      return;
    case "withdraw": L.withdraw(ctx); ctx.emit({ type: "narrate", text: "You take back your description." }); return;
    case "pay": L.pay(ctx, arg === "notes"); return;
    case "go-claim":
      T.startLeg(ctx, "claim");
      if (!s.gear.team && !s.gear.teamster) s.gear.teamster = true;
      return;
    case "build":
    case "hire-hands": {
      if (verb === "hire-hands") P.pay(s, num, a.cost);
      for (let d = 0; d < a.days && !s.over && s.land.shelter < num("shelter.done"); d++) {
        const rate = L.buildRate(ctx) + (verb === "hire-hands" ? ctx.num("shelter.perUnit") * ctx.num("hands.count") : 0);
        passDay(ctx, { kind: "build", lodged: false });
        if (!s.over) L.addShelter(ctx, rate);
      }
      if (s.over) return;
      if (s.land.shelter < num("shelter.done")) maybeEvent(ctx, "claim", "ev.p.claim");
      return;
    }
    default: throw new Error(`unhandled action ${a.id}`);
  }
}

// ---- the day, the end ---------------------------------------------------------

// The day's fatigue, from what the family did: the pace and the road on a wagon
// day, the berth or the crowd on a boat, rest, a roof, the Sabbath, work, waiting.
function fatigueToday(ctx, t) {
  const { state: s, num } = ctx;
  const mode = s.phase === "travel" ? T.LEGS[s.leg]?.mode : null;
  const idleTeam = -num("fat.team.idle");
  if (t.kind === "travel") {
    if (mode === "wagon") {
      const bad = T.BAD_ROAD.has(s.vars.terrain);
      const own = T.ownPace(s);
      const pace = own ? s.vars.pace ?? "steady" : "steady";
      return {
        person: num(`fat.day.${pace}`) + (bad ? num("fat.badRoad") : 0),
        team: own ? num(`fat.teamDay.${pace}`) + (bad ? num("fat.team.badRoad") : 0) : idleTeam,
      };
    }
    if (mode === "stage") return { person: num("fat.day.steady"), team: idleTeam };
    return { person: -num(t.crowded ? "fat.boat.crowded" : "fat.boat.berth"), team: idleTeam };
  }
  if (t.kind === "sabbath") return { person: -num("fat.sabbath"), team: -num("fat.team.rest") };
  if (t.resting) return { person: -num(t.lodged ? "fat.inn" : "fat.rest"), team: -num("fat.team.rest") };
  if (["work", "build", "repair", "explore"].includes(t.kind)) return { person: num("fat.labour"), team: idleTeam };
  return { person: -num("fat.idle"), team: idleTeam };
}

function onDay(ctx) {
  const { state: s, num } = ctx;
  const t = s.vars.today ?? {};
  H.dailyFatigue(ctx, fatigueToday(ctx, t));
  // Worn-out people quarrel: morale frays each day someone is past fat.morale.from.
  if (H.maxFatigue(s) >= num("fat.morale.from")) addRes(ctx, "morale", -num("fat.morale.loss"));
  M.resolveTies(ctx);
  // Letters that reached Bronson after the family left: a neighbour brings them out to the claim.
  if (s.phase === "claim" && !s.vars.path && M.waitingMail(s, "bronson").length) ctx.schedule({ event: "claim-mail", in: "#chain.in.mid" });
  let hungry = false;
  if (!t.meals) {
    const need = needPerDay(ctx);
    if (s.res.food >= need) s.res.food -= need;
    else { s.res.food = 0; hungry = true; }
  }
  const snowy = T.isSnowy(s, num);
  if (snowy && !s.flags.snowSeen) {
    s.flags.snowSeen = true;
    ctx.emit({ type: "weather", weather: "snow", first: true });
    ctx.emit({ type: "narrate", text: ctx.route.data.text.firstSnow });
  }
  // Exposure after the snow: none under a roof, less as the cabin goes up.
  const roof = t.lodged ? 1 : s.phase === "claim" ? s.land.shelter / num("shelter.done") : 0;
  H.dailyHealth(ctx, { resting: Boolean(t.resting), crowded: Boolean(t.crowded), hungry, cold: snowy ? 1 - roof : 0 });
  if (hungry) addRes(ctx, "morale", -num("hunger.morale"));
  if (t.resting) addRes(ctx, "morale", num("morale.rest"));
  if (s.phase === "office") {
    L.queueDay(ctx);
    // A long stay at Bronson: the store restocks and the broker has coin again each week.
    if (s.day - (s.vars.visit.since ?? 0) >= num("shop.restockDays")) s.vars.visit = { place: s.place, used: {}, since: s.day };
  }
}

function afterAction(ctx) {
  const s = ctx.state;
  if (s.vars.griefDays > 0 && !(s.phase === "travel" && s.leg === "lake") && !s.pending) {
    const d = s.vars.griefDays;
    s.vars.griefDays = 0;
    s.vars.today = { kind: "grief", resting: true, lodged: s.phase === "town" };
    ctx.emit({ type: "narrate", text: `The family stops for ${d} days.`, cue: "grief" });
    ctx.advanceDays(d);
  }
  // A consequence waiting for this place fires on a step that fired none yet:
  // one a step, so the rest come on the family's next steps here (fireQueued).
  if (!s.over && !s.pending) fireQueued(ctx, { atOnly: true });
}

// A fresh yoke: the team is whole and rested, and the spent animal's troubles go with it.
function freshTeam(ctx) {
  const s = ctx.state;
  delete s.flags.teamShort;
  H.addFatigue(ctx, "team", ctx.num("ev.team.fresh"));
  dropOutfit(ctx, ["team"]);
}

function landCostSmall(ctx) {
  return L.landCost(ctx.num, ctx.num("land.acres.small"));
}

// Stranded: no way forward from here and nothing in hand that could make one
// (an action marked "remedy": selling the team, a broker, quinine for the
// shaking), and either only children are left or every adult is sick with no
// way to wait it out (no money for lodging). Remedies are once a visit or use
// something up, so a family that tries them all and still cannot move ends here.
function stranded(ctx) {
  const s = ctx.state;
  if (s.pending || !["town", "office"].includes(s.phase)) return false;
  const open = actions(ctx).filter((a) => a.enabled !== false);
  if (open.some((a) => a.remedy)) return false;
  if (open.some((a) => a.forward && (s.phase !== "office" || a.type !== "explore" || P.valueHere(s, ctx.num) >= landCostSmall(ctx)))) return false;
  if (!H.living(s).some((p) => p.age >= ctx.num("age.adult"))) return true;
  if (H.ableAdults(s, ctx.num) > 0) return false;
  return !open.some((a) => a.type === "rest");
}

function checkEnd(ctx) {
  const end = endOf(ctx);
  if (!end) return null;
  const tier = Pa.tierOf(ctx.state, ctx.num, end.outcome);
  // On a path the full win is tier 2; the main route keeps its own "won" (land and a roof).
  return { ...end, won: ctx.state.vars.path ? tier === 2 : end.won, tier };
}

function endOf(ctx) {
  const { state: s, num } = ctx;
  if (!H.living(s).length) return { outcome: "lost", won: false };
  const path = s.vars.path;
  if (path && path !== "ohio") return pathEnd(ctx, path);
  if (s.land.paid && s.land.shelter >= num("shelter.done")) return { outcome: "settled", won: true };
  if (compare(s.date, s.vars.winterDate) >= 0) return { outcome: s.land.paid ? "roofless" : "winter", won: false };
  if (!s.land.paid && compare(s.date, num("date.deadline")) > 0) {
    const coinAfterBroker = s.purse.coin + Math.floor(P.paperValue(s, num) * (1 - num("broker.fee")));
    if (coinAfterBroker < landCostSmall(ctx)) return { outcome: "deadline", won: false };
  }
  if (stranded(ctx)) return { outcome: "stranded", won: false };
  return null;
}

// Among kin: land beside them, else work with them, else a place on their floor.
const KIN_OUTCOME = [["kinLand", "kin-land"], ["kinWork", "kin-work"], [null, "kin-floor"]];

// The ends of the paths that leave the main route's rules (Ohio keeps them).
function pathEnd(ctx, path) {
  const { state: s, num } = ctx;
  const late = compare(s.date, num("path.end")) >= 0;
  const roofed = s.land.paid && s.land.shelter >= num("shelter.done");
  switch (path) {
    case "detroit":
      if (s.land.paid) return { outcome: "spring-land", won: true };
      if (late) return { outcome: "spring-noland", won: false };
      break;
    case "chicago":
      if (roofed) return { outcome: "prairie-farm", won: true };
      if (late && s.land.paid) return { outcome: "prairie-roofless", won: false };
      if (late && Pa.lotHeld(s)) return { outcome: "lot-held", won: false };
      if (late) return { outcome: "no-farm", won: false };
      break;
    case "home":
      if (s.flags.homeDone) return { outcome: "home", won: true };
      if (late) return { outcome: "stranded", won: false };
      break;
    case "kin":
      if (s.flags.kinDone) return { outcome: KIN_OUTCOME.find(([flag]) => !flag || s.flags[flag])[1], won: true };
      if (late) return { outcome: "stranded", won: false };
      break;
    default:
      break;
  }
  if (stranded(ctx)) return { outcome: "stranded", won: false };
  return null;
}

function ending(ctx, end) {
  const { state: s, num } = ctx;
  const T0 = ctx.route.data.text;
  const path = s.vars.path;
  const W = path ? T0.paths[path] : null;
  const E = W?.endings?.[end.outcome] ?? T0.endings[end.outcome];
  const alive = H.living(s);
  // A path with no cabin to raise (the winter in Detroit, turning back, the kin) has no roof line.
  const builds = !path || ["ohio", "chicago"].includes(path);
  return {
    title: E.title,
    text: ctx.text(E.text, path === "kin" ? { name: s.vars.west.name, kinPlace: T.PLACES[s.place] ?? "" } : {}),
    tier: end.tier,
    tierText: T0.tiers[path ?? "main"][String(end.tier)],
    path,
    score: {
      acres: s.land.paid ? s.land.acres : 0,
      shelter: builds ? s.land.shelter >= num("shelter.done") : null,
      alive: alive.length,
      family: s.party.length,
      money: P.valueHere(s, num),
      coin: s.purse.coin,
      days: s.day,
    },
    deaths: s.party.filter((p) => p.status === "dead").map((p) => ({ name: `${p.name} ${s.vars.surname}`, age: p.age, date: p.died.date, cause: p.died.cause })),
    epilogue: [...(E.epilogue ?? []), ...(W?.epilogue ?? []), ...T0.epilogue, ...M.epilogue(ctx)],
  };
}

// ---- deck vocabulary --------------------------------------------------------

function cmpMoney(ctx, have, op, dollars, vars) {
  const want = P.cents(resolve(dollars, ctx, vars));
  return { "<": have < want, "<=": have <= want, ">": have > want, ">=": have >= want, "==": have === want, "!=": have !== want }[op];
}

const cmpN = (have, op, want) => ({ "<": have < want, "<=": have <= want, ">": have > want, ">=": have >= want, "==": have === want, "!=": have !== want }[op]);

const conditions = {
  ticket: (arg, ctx) => list(arg).includes(ctx.state.vars.ticket),
  background: (arg, ctx) => list(arg).includes(ctx.state.vars.background),
  skill: (arg, ctx) => ctx.state.vars.skills.includes(arg),
  terrain: (arg, ctx) => list(arg).includes(ctx.state.vars.terrain),
  afford: (arg, ctx, vars) => P.canPay(ctx.state, ctx.num, P.cents(resolve(arg, ctx, vars))),
  coin: ([op, d], ctx, vars) => cmpMoney(ctx, ctx.state.purse.coin, op, d, vars),
  notes: ([region, op, d], ctx, vars) => cmpMoney(ctx, ctx.state.purse.notes[region], op, d, vars),
  paper: ([op, d], ctx, vars) => cmpMoney(ctx, P.paperValue(ctx.state, ctx.num), op, d, vars),
  alive: ([op, n], ctx, vars) => cmpN(H.living(ctx.state).length, op, resolve(n, ctx, vars)),
  children: ([op, n], ctx, vars) => cmpN(H.living(ctx.state).filter((p) => H.isChild(p, ctx.num)).length, op, resolve(n, ctx, vars)),
  sick: ([op, n], ctx, vars) => cmpN(H.living(ctx.state).filter((p) => p.status === "sick").length, op, resolve(n, ctx, vars)),
  able: ([op, n], ctx, vars) => cmpN(H.ableAdults(ctx.state, ctx.num), op, resolve(n, ctx, vars)),
  team: (arg, ctx) => Boolean(ctx.state.gear.team) === arg,
  wagon: ([op, n], ctx, vars) => cmpN(ctx.state.gear.wagonCond, op, resolve(n, ctx, vars)),
  land: (arg, ctx) => {
    const l = ctx.state.land;
    const stage = l.paid ? "paid" : l.ready ? "ready" : l.applied ? "applied" : "looking";
    return list(arg).includes(stage);
  },
  looker: (arg, ctx) => ctx.state.land.looker === arg,
  candidates: ([op, n], ctx, vars) => cmpN(ctx.state.land.candidates.length, op, resolve(n, ctx, vars)),
  shelter: ([op, n], ctx, vars) => cmpN(ctx.state.land.shelter, op, resolve(n, ctx, vars)),
  snow: (arg, ctx) => T.isSnowy(ctx.state, ctx.num) === arg,
  // Fatigue: the most tired living person, and the team.
  tired: ([op, n], ctx, vars) => cmpN(H.maxFatigue(ctx.state), op, resolve(n, ctx, vars)),
  teamTired: ([op, n], ctx, vars) => Boolean(ctx.state.gear.team) && cmpN(ctx.state.gear.fatigue ?? 0, op, resolve(n, ctx, vars)),
  pace: (arg, ctx) => list(arg).includes(ctx.state.vars.pace),
  // A home tie: ["mortgage", "open" | "sent" | "settled" | "lost" | "has" | "unsettled" | "decided" | "payable"].
  // "unsettled": money could go for it (owed, or known lost; not while a sending is on its way).
  // "decided": its date has come and it turned out one way or the other at home.
  // "payable": it can still be paid in person, before its date.
  tie: ([id, st], ctx) => {
    const t = M.tieOf(ctx.state, id);
    if (st === "has") return Boolean(t);
    if (st === "unsettled") return M.sendOpen(t);
    if (st === "decided") return t?.outcome != null;
    if (st === "payable") return M.canPayHere(ctx.state, ctx.num, t);
    return t?.status === st;
  },
  mailWaiting: (office, ctx) => M.waitingMail(ctx.state, office).length > 0,
  // Letters waiting there, and the purse can pay all their postage.
  canPayMail: (office, ctx) => M.waitingMail(ctx.state, office).length > 0 && P.canPay(ctx.state, ctx.num, M.mailCost(ctx.state, ctx.num, office)),
  // Pushing the family's own team: the pace is one of these (hard, grueling) on a wagon leg.
  pushing: (arg, ctx) => T.ownPace(ctx.state) && list(arg).includes(ctx.state.vars.pace),
  // Done already on this visit to the town ("post", "letter").
  used: (key, ctx) => has(ctx, key),
  canSendTie: (id, ctx) => M.canSendFor(ctx.state, ctx.num, M.tieOf(ctx.state, id)),
  // Can the tie picked for sending go "halves" or "whole" with the postage paid?
  sendable: (how, ctx) => M.canSendHow(ctx.state, ctx.num, ctx.state.vars.sendTie, how, ctx.state.place),
  deadlinePassed: (arg, ctx) => (compare(ctx.state.date, ctx.num("date.deadline")) > 0) === arg,
  // The paths: which one the family is on ("main" for none).
  path: (arg, ctx) => list(arg).includes(ctx.state.vars.path ?? "main"),
  // The Chicago lot: "none" (never bought), "held", "owing" (held, with a note).
  lot: (arg, ctx) => {
    const s = ctx.state;
    const st = !s.vars.lot ? "none" : Pa.lotHeld(s) ? (s.vars.lot.note > 0 ? "owing" : "held") : "gone";
    return list(arg).includes(st) || (st === "owing" && list(arg).includes("held"));
  },
  // The kin out west: where they are, and whether their letter offered work.
  west: (arg, ctx) => list(arg).includes(ctx.state.vars.west?.where),
  westWork: (arg, ctx) => Boolean(ctx.state.vars.west?.work) === arg,
  // Home again: something is still owed in the county.
  owedHome: (arg, ctx) => (Pa.owedAtHome(ctx.state) > 0) === arg,
};

function target(ctx, who, vars) {
  if (typeof who === "string" && who.startsWith("$")) return vars[who.slice(1)];
  if (who === "all") return "all";
  return binders.member(who, ctx);
}

const effects = {
  sicken: ({ who, illness }, ctx, vars) => { const id = target(ctx, who, vars); if (id) H.sicken(ctx, id, illness); },
  injure: ({ who, amount }, ctx, vars) => { const id = target(ctx, who, vars); if (id) H.injure(ctx, id, resolve(amount, ctx, vars)); },
  heal: ({ who, amount }, ctx, vars) => { const id = target(ctx, who, vars); if (id) H.heal(ctx, id, resolve(amount, ctx, vars)); },
  cure: ({ who }, ctx, vars) => { const id = target(ctx, who, vars); if (id) H.cure(ctx, id); },
  pay: (amount, ctx, vars) => {
    const c = P.cents(resolve(amount, ctx, vars));
    if (!P.pay(ctx.state, ctx.num, c)) {
      const all = P.valueHere(ctx.state, ctx.num);
      P.pay(ctx.state, ctx.num, all);
    }
  },
  earn: ({ amount, kind }, ctx, vars) => P.receive(ctx.state, kind, P.cents(resolve(amount, ctx, vars))),
  loseNotes: ({ region, share }, ctx, vars) => {
    const lost = P.loseNotes(ctx.state, ctx.num, region, resolve(share, ctx, vars));
    if (lost > 0) ctx.emit({ type: "narrate", text: `That costs you ${P.money(lost)} in paper.` });
  },
  wagon: (amount, ctx, vars) => {
    const g = ctx.state.gear;
    if (!g.team || g.teamster) return;
    g.wagonCond = Math.max(0, Math.min(ctx.num("wagon.max"), g.wagonCond + resolve(amount, ctx, vars)));
    if (g.wagonCond <= 0) ctx.emit({ type: "narrate", text: "The wagon is broken down and will not roll.", cue: "broken" });
  },
  progress: (miles, ctx, vars) => {
    const v = ctx.state.vars;
    v.segMi = Math.max(0, v.segMi + resolve(miles, ctx, vars));
    v.legMi = Math.max(0, v.legMi + resolve(miles, ctx, vars));
  },
  candidate: (via, ctx) => { L.addCandidate(ctx, via); },
  queue: (days, ctx, vars) => { const l = ctx.state.land; if (l.applied && !l.ready) l.queue = Math.max(1, l.queue + resolve(days, ctx, vars)); },
  shelter: (amount, ctx, vars) => { if (ctx.state.land.paid) L.addShelter(ctx, resolve(amount, ctx, vars)); },
  receiverNY: (v, ctx) => { ctx.state.land.receiverNY = v; },
  buyTract: ({ kind, price, acres }, ctx, vars) => {
    const a = resolve(acres, ctx, vars);
    const cost = P.cents(resolve(price, ctx, vars) * a);
    if (!P.pay(ctx.state, ctx.num, cost)) return;
    L.withdraw(ctx);
    L.settle(ctx, { id: "spec", kind, poor: false, known: true, miles: ctx.num("mi.claimMin"), via: "speculator" }, a);
    ctx.emit({ type: "narrate", text: `You pay ${P.money(cost)} and take the speculator's deed for ${a} acres.` });
  },
  morale: (amount, ctx, vars) => addRes(ctx, "morale", resolve(amount, ctx, vars)),
  fatigue: ({ who, amount }, ctx, vars) => {
    const id = who === "team" || who === "all" ? who : target(ctx, who, vars);
    if (id) H.addFatigue(ctx, id, resolve(amount, ctx, vars));
  },
  // The post office and home ties.
  collectMail: (office, ctx) => {
    const where = office === "here" ? ctx.state.place : office;
    if (!M.collectMail(ctx, where)) ctx.emit({ type: "narrate", text: ctx.text(ctx.route.data.text.post.cannotPay) });
  },
  leaveMail: (office, ctx) => M.leaveMail(ctx, office === "here" ? ctx.state.place : office),
  writeHome: (office, ctx) => {
    const here = office === "here";
    const where = here ? ctx.state.place : office;
    if (!P.pay(ctx.state, ctx.num, M.letterCost(ctx.num, where))) return;
    if (here) use(ctx, "letter");
    addRes(ctx, "morale", ctx.num("morale.letter"));
    M.writeHome(ctx, here ? null : office);
    ctx.emit({ type: "narrate", text: ctx.text(ctx.route.data.text.letterSent) });
  },
  // "Ask for letters": once a visit; letters waiting open the pay-or-leave choice.
  askMail: (_, ctx) => {
    const s = ctx.state;
    use(ctx, "post");
    const waiting = M.waitingMail(s, s.place);
    if (!waiting.length) {
      ctx.emit({ type: "narrate", text: ctx.text(ctx.route.data.text.post.nothing) });
      if (postLeft(ctx)) ctx.startEvent("post-office", postVars(ctx));
      return;
    }
    const cost = M.mailCost(s, ctx.num, s.place);
    ctx.startEvent("post-letters", { n: waiting.length === 1 ? "a letter" : `${waiting.length} letters`, cost: P.money(cost), costUsd: cost / 100 });
  },
  // Pick a tie to send money for: the halves-or-whole choice follows.
  sendTie: (id, ctx) => {
    const s = ctx.state;
    const t = M.tieOf(s, id);
    s.vars.sendTie = id;
    const why = (how) => (M.canSendFor(s, ctx.num, t, how) ? ctx.route.data.text.post.noPostage : M.sendWhy(ctx.route, s, ctx.num, t, how));
    ctx.startEvent("post-send-how", {
      amount: P.money(t.amount), what: M.summary(ctx.route, { ...s, ties: [t] })[0].purpose,
      halves: P.money(M.sendPostage(ctx.num, s.place, "halves")), whole: P.money(M.sendPostage(ctx.num, s.place, "whole")),
      whyHalves: why("halves"), whyWhole: why("whole"),
    });
  },
  sendMoney: (how, ctx) => { M.sendMoney(ctx, ctx.state.vars.sendTie, how, ctx.state.place); ctx.state.vars.sendTie = null; },
  // Coin taken (a clipped piece refused): never more than the coin in hand.
  loseCoin: (amount, ctx, vars) => {
    const s = ctx.state;
    const c = Math.min(s.purse.coin, P.cents(resolve(amount, ctx, vars)));
    s.purse.coin -= c;
    if (c > 0) ctx.emit({ type: "narrate", text: `That costs you ${P.money(c)} in coin.` });
  },
  // A fresh yoke bought on the road (team-ox-down).
  freshTeam: (_, ctx) => freshTeam(ctx),
  // ---- the paths ----
  // The confirm's "yes": one-way onto a path ("detroit", "chicago:road", "home", ...).
  pivot: (spec, ctx, vars) => startPath(ctx, resolve(spec, ctx, vars)),
  // Among kin: land bought beside them, work with them, or a place on their floor. The path ends.
  kinSettle: (how, ctx) => {
    const s = ctx.state;
    if (how === "land") {
      if (!P.pay(s, ctx.num, Pa.kinLandCost(ctx.num))) return;
      s.land.paid = true;
      s.land.acres = ctx.num("land.acres.small");
      s.flags.kinLand = true;
    }
    if (how === "work") s.flags.kinWork = true;
    s.flags.kinDone = true;
  },
  // Home again: pay what is owed in the county, or keep the money. The path ends.
  homeSettle: (how, ctx) => {
    const s = ctx.state;
    if (how === "pay" && P.pay(s, ctx.num, Pa.owedAtHome(s))) {
      for (const t of s.ties) if (t.status !== "settled") { t.sent = t.amount; t.status = "settled"; t.learned = true; delete t.mailed; delete t.astray; }
    }
    s.flags.homeDone = true;
  },
  // The note on a Chicago lot falls due: pay it, or let the lot go and the money down with it.
  lotNote: (how, ctx) => {
    const s = ctx.state;
    const lot = s.vars.lot;
    if (!Pa.lotHeld(s)) return;
    if (how === "pay" && P.pay(s, ctx.num, Pa.lotOwed(s, ctx.num))) { lot.paid += Pa.lotOwed(s, ctx.num); lot.note = 0; return; }
    lot.forfeit = s.date;
    lot.offer = null;
  },
  payTie: (id, ctx) => {
    if (M.payTieHere(ctx, id)) ctx.emit({ type: "narrate", text: `You pay ${P.money(M.tieOf(ctx.state, id).amount)} and take a receipt.` });
  },
  // Sell notes for coin at a flat rate of face value: from "ne", "ny", "mi" or "eastern" (ne + ny).
  exchange: ({ from, rate, cap }, ctx, vars) => {
    const s = ctx.state;
    const r = resolve(rate, ctx, vars);
    let room = P.cents(resolve(cap, ctx, vars));
    let coin = 0;
    for (const region of from === "eastern" ? ["ne", "ny"] : [from]) {
      const get = Math.min(room, Math.floor(s.purse.notes[region] * r));
      const face = Math.min(s.purse.notes[region], Math.ceil(get / r));
      s.purse.notes[region] -= face;
      coin += get;
      room -= get;
    }
    s.purse.coin += coin;
    ctx.emit({ type: "narrate", text: `You get ${P.money(coin)} in coin.` });
  },
};

const binders = {
  // A number for an event's text: {"miles": {"value": "#mi.detroitChicago"}}.
  value: (spec, ctx) => resolve(spec, ctx),
  // A sum of money for an event's text, in the game's format: {"amount": {"money": "#tie.mortgage.amount"}} -> "$50.00".
  money: (spec, ctx) => P.money(P.cents(resolve(spec, ctx))),
  // Why a tie cannot be paid in person now: too late, or not enough money.
  tieWhy: (id, ctx) => M.payWhy(ctx.route, ctx.state, ctx.num, M.tieOf(ctx.state, id)),
  // The post office menu's own words, computed fresh each time it opens (it reopens after
  // the letters and after sending money). "postLeft" finds nothing once nothing is left to do.
  postLeft: (spec, ctx) => (postLeft(ctx) ? true : null),
  post: (spec, ctx) => postVars(ctx)[spec] ?? "",
  // The family member a home tie is about (the sweetheart's betrothed child), if alive.
  tieWho(spec, ctx) {
    const id = M.tieOf(ctx.state, spec)?.who;
    return H.living(ctx.state).some((p) => p.id === id) ? id : null;
  },
  // The kin out west, for their offer: "name", "place" (their settlement), "offer" (work or land).
  west(spec, ctx) {
    const w = ctx.state.vars.west;
    if (!w) return null;
    if (spec === "name") return w.name;
    if (spec === "place") return T.PLACES[Pa.KIN_PLACES[w.where]];
    return ctx.text(ctx.route.data.text.westOffer[w.work ? "work" : "land"], { land: P.money(Pa.kinLandCost(ctx.num)) });
  },
  // The passage to the kin out west, if it is by water (the Maumee); nothing by road.
  kinFare: (spec, ctx) => {
    if (!ctx.state.vars.west) return null;
    const c = ctx.state.vars.west.where === "ohio" ? maumeeCost(ctx) : 0;
    if (spec === "usd") return c / 100;
    return c ? `Deck passage to the Maumee comes to ${P.money(c)}.` : "The road there is the family's own.";
  },
  // What the family's lot note stands at today, for the event that calls it in.
  lotOwed: (spec, ctx) => (Pa.lotHeld(ctx.state) ? (spec === "usd" ? Pa.lotOwed(ctx.state, ctx.num) / 100 : P.money(Pa.lotOwed(ctx.state, ctx.num))) : null),
  member(spec, ctx) {
    const { state: s, num, rng } = ctx;
    const alive = H.living(s);
    const filters = {
      random: () => true,
      well: (p) => p.status === "well",
      child: (p) => H.isChild(p, num),
      wellChild: (p) => H.isChild(p, num) && p.status === "well",
      adult: (p) => !H.isChild(p, num),
      wellAdult: (p) => !H.isChild(p, num) && p.status === "well",
      sick: (p) => p.status === "sick",
      ague: (p) => p.illness?.kind === "ague",
      head: (p) => ["father", "mother"].includes(p.role) && p.age >= num("age.adult"),
    };
    const f = filters[spec];
    if (!f) throw new Error(`unknown member filter: ${spec}`);
    const pool = alive.filter(f);
    if (!pool.length) return null;
    return spec === "head" ? pool[0].id : rng.pick(pool).id;
  },
};

function textVar(name, value, prop, ctx) {
  const p = ctx.state.party?.find((x) => x.id === value);
  if (!p) return undefined;
  const pr = p.sex === "m" ? { he: "he", him: "him", his: "his", He: "He", His: "His" } : { he: "she", him: "her", his: "her", He: "She", His: "Her" };
  if (!prop) return p.name;
  return pr[prop] ?? p.name;
}

function textVars(ctx) {
  const s = ctx.state;
  const head = s.party?.find((p) => ["father", "mother"].includes(p.role) && p.status !== "dead");
  return {
    family: s.vars.surname ? `the ${s.vars.surname} family` : "the family",
    Family: s.vars.surname ? `The ${s.vars.surname} family` : "The family", // to open a sentence
    surname: s.vars.surname ?? "",
    place: T.PLACES[s.place] ?? "",
    date: format(s.date, { weekday: false }),
    head: head?.name ?? "",
    kin: s.vars.kin?.name ?? "",
  };
}

// ---- HUD -------------------------------------------------------------------

function view(route, s) {
  const num = route.num;
  const ctx = { state: s, num };
  const need = s.party.length ? needPerDay(ctx) : 0;
  return {
    date: s.date,
    dateLabel: format(s.date),
    phase: s.phase,
    place: s.place,
    placeLabel: T.PLACES[s.place] ?? "",
    travel: T.progressView(s, num),
    ticket: s.vars.ticket,
    purse: P.summary(s, num),
    food: { rations: Math.floor(s.res.food), days: need ? Math.floor(s.res.food / need) : 0, meals: boatDay(s).meals },
    morale: Math.round(s.res.morale),
    quinine: s.res.quinine,
    party: H.summary(s, num),
    surname: s.vars.surname,
    background: s.vars.background,
    gear: { team: s.gear.team, wagon: s.gear.wagon, wagonCond: s.gear.wagonCond, teamster: s.gear.teamster, fatigue: Math.round(s.gear.fatigue ?? 0), tired: s.gear.team ? H.tiredness(s.gear.fatigue, num) : null, short: Boolean(s.flags.teamShort) },
    pace: s.vars.pace ?? "steady",
    paceApplies: T.ownPace(s),
    // The path (Phase B): null on the main route.
    path: s.vars.path ? { id: s.vars.path, label: route.data.text.paths[s.vars.path].label } : null,
    lot: s.vars.lot ? { price: s.vars.lot.price, paid: s.vars.lot.paid, owed: Pa.lotOwed(s, num), market: Pa.lotMarket(s, num), offer: s.vars.lot.offer ?? null,
      held: Pa.lotHeld(s), sold: s.vars.lot.sold, soldFor: s.vars.lot.soldFor ?? null, forfeit: s.vars.lot.forfeit } : null,
    fatigue: { tired: num("fat.tired"), high: num("fat.high") },
    ties: M.summary(route, s),
    postOffice: ["town", "office"].includes(s.phase) && POST_TOWNS.has(s.place),
    deadline: { date: num("date.deadline"), daysLeft: diffDays(s.date, num("date.deadline")), passed: compare(s.date, num("date.deadline")) > 0 },
    snow: T.isSnowy(s, num),
    // The days left before deep winter ends the season: on the main route and the Ohio path only.
    winterWarning: T.isSnowy(s, num) && (!s.vars.path || s.vars.path === "ohio") && compare(s.date, s.vars.winterDate) < 0 ? diffDays(s.date, s.vars.winterDate) : null,
    land: L.summary(s, num),
    decisions: s.decisions,
    over: s.over,
  };
}

// ---- assembly -----------------------------------------------------------------

export function createRoute({ numbers, events, backgrounds, text }) {
  const table = new Map(numbers.map((n) => [n.id, n]));
  const num = (id) => {
    const n = table.get(id);
    if (!n) throw new Error(`unknown number: ${id}`);
    return n.value;
  };
  const route = {
    id: ROUTE_ID,
    version: ROUTE_VERSION,
    title: "Michigan Fever",
    num,
    numbers: table,
    events,
    eventIndex: new Map(events.map((e) => [e.id, e])),
    data: { backgrounds, text },
    limits: { morale: [0, 100], food: [0, Number.MAX_SAFE_INTEGER], quinine: [0, Number.MAX_SAFE_INTEGER] },
    startDate: () => num("date.start"),
    init, actions, act, onDay, eventDay, eventDayKinds: EVENT_DAY_KINDS, afterAction, checkEnd, ending,
    // Where a scheduled {"at": place} event may wait: places the family stops at, not passes.
    places: ["albany", "buffalo", "detroit", "bronson", "claim", "chicago", "lima", "allens", "maumee", "brushhill", "home"],
    atPlace: (st) => (st.phase === "travel" ? null : st.place),
    // The tie schedules live in text.json; validateDeck checks them like the deck's own.
    schedules: text.ties.flatMap((t) => (t.schedule ?? []).map((spec) => ({ where: `tie ${t.id}`, spec }))),
    // Curves event weights scale by: the most tired person, and the team (health.js fatigueMult).
    scales: {
      worn: (ctx) => H.fatigueMult({ fatigue: H.maxFatigue(ctx.state) }, num),
      teamWorn: (ctx) => (ctx.state.gear.team ? H.fatigueMult({ fatigue: ctx.state.gear.fatigue }, num) : 1),
    },
    readable: (state) => readable(route, state),
    conditions, effects, binders, textVar, textVars,
    view: (state) => view(route, state),
  };
  return route;
}

// ---- loading a save -------------------------------------------------------------
// The route's own fields that its view and actions do not touch at once, but
// later steps do: the party's fatigue, the team's, the ties and the mail.

const isObj = (x) => x != null && typeof x === "object" && !Array.isArray(x);
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const isDate = (d) => {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  try { return fromDayNumber(toDayNumber(d)) === d; } catch { return false; }
};
const MAIL_STATUS = ["waiting", "taken", "left"];
// Letters from home: kin's own (no tie), and a tie's news, outcome, or word that money never came.
const MAIL_KEYS = ["kin", "news", "outcome", "lost", "call"];

function readable(route, s) {
  if (!Array.isArray(s.party) || !Array.isArray(s.ties) || !Array.isArray(s.mail) || !isObj(s.gear)) return false;
  if (!s.party.every((p) => isObj(p) && isNum(p.fatigue ?? 0))) return false;
  if (!isNum(s.gear.fatigue ?? 0)) return false;
  if (!T.PACES.includes(s.vars.pace ?? "steady")) return false;
  const tieOk = (t) => isObj(t) && M.TIE_IDS.includes(t.id) && Number.isInteger(t.amount) && Number.isInteger(t.sent)
    && M.TIE_STATUSES.includes(t.status) && (t.outcome === null || typeof t.outcome === "string");
  if (!s.ties.every(tieOk)) return false;
  const mailOk = (m) => isObj(m) && typeof m.id === "string" && typeof m.key === "string" && M.POST_OFFICES.includes(m.office)
    && isDate(m.from) && (m.written === undefined || isDate(m.written)) && Number.isInteger(m.sheets) && m.sheets >= 1
    && MAIL_STATUS.includes(m.status) && MAIL_KEYS.includes(m.key)
    && (m.key === "kin" || m.key === "call" ? m.tie === null : s.ties.some((t) => t.id === m.tie));
  if (!s.mail.every(mailOk)) return false;
  return pathReadable(s);
}

// The Phase B fields: the path, the kin out west, the Chicago lot, the dates home and among kin.
function pathReadable(s) {
  const v = s.vars;
  if (!(v.path == null || Pa.PATHS.includes(v.path))) return false;
  if (!(v.homeOn == null || isDate(v.homeOn)) || !(v.arrivedOn == null || isDate(v.arrivedOn))) return false;
  if (!(v.passageDays == null || (Number.isInteger(v.passageDays) && v.passageDays >= 0))) return false;
  const w = v.west;
  if (w != null && !(isObj(w) && Pa.KIN_WHERE.includes(w.where) && typeof w.name === "string" && typeof w.work === "boolean")) return false;
  if (v.path === "kin" && !w) return false;
  const lot = v.lot;
  const dateOrNull = (d) => d === null || isDate(d);
  if (lot != null && !(isObj(lot) && [lot.price, lot.paid, lot.note].every(Number.isInteger) && isDate(lot.bought)
    && dateOrNull(lot.sold) && dateOrNull(lot.forfeit) && (lot.offer === null || Number.isInteger(lot.offer)))) return false;
  return true;
}

export const DATA_FILES = { numbers: "numbers.json", events: "events.json", backgrounds: "backgrounds.json", text: "text.json" };

// Browser loader: fetches the data files next to this module.
export async function loadRoute(fetchImpl = globalThis.fetch) {
  const base = new URL("./data/", import.meta.url);
  const entries = await Promise.all(Object.entries(DATA_FILES).map(async ([k, f]) => {
    const r = await fetchImpl(new URL(f, base));
    if (!r.ok) throw new Error(`could not load ${f}: ${r.status}`);
    return [k, await r.json()];
  }));
  return createRoute(Object.fromEntries(entries));
}
