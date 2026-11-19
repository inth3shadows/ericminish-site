// Michigan Fever, 1836: Vermont or Connecticut to a claim near the Bronson
// (Kalamazoo) land office before the settler exemption ends on 15 December.
// This file wires the route-owned mechanics into the engine's route
// interface (see games/engine/engine.js). No DOM.

import { compare, diffDays, addDays, format } from "../engine/clock.js";
import { addRes, resolve } from "../engine/events.js";
import * as P from "./mechanics/purse.js";
import * as H from "./mechanics/health.js";
import * as T from "./mechanics/travel.js";
import * as L from "./mechanics/landoffice.js";

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
};

export const ROUTE_ID = "michigan-fever";
export const ROUTE_VERSION = 1;
const list = (x) => (Array.isArray(x) ? x : [x]);
const usd = (ctx, id) => P.cents(ctx.num(id));
const TOWNS = new Set(["albany", "buffalo", "detroit"]);
const NOTE_KIND = { albany: "ny", buffalo: "ny", detroit: "mi", bronson: "mi" };

// ---- setup --------------------------------------------------------------------

function init(ctx) {
  const { state: s, num, rng } = ctx;
  const T0 = ctx.route.data.text;
  s.phase = "start";
  s.place = "home";
  s.party = [];
  s.purse = P.emptyPurse();
  s.gear = { team: null, wagon: false, wagonCond: 0, goods: 0, teamster: false };
  s.land = L.newLand();
  s.res = { food: 0, morale: num("morale.start"), quinine: 0 };
  const spread = diffDays(num("date.snowEarliest"), num("date.snowLatest"));
  Object.assign(s.vars, {
    background: null, surname: "", kin: null, skills: [], ticket: null, teamSold: false,
    seg: 0, segMi: 0, legMi: 0, terrain: null, tollMi: 0,
    visit: { place: "home", used: {} }, griefDays: 0, today: null,
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
    health: ctx.num("health.max"), status: "well", illness: null,
  }));
  s.purse.coin = P.cents(resolve(bg.purse.coin, ctx));
  for (const r of P.REGIONS) s.purse.notes[r] = P.cents(resolve(bg.purse.notes[r] ?? 0, ctx));
  s.res.food = resolve(bg.food, ctx);
  s.gear = { team: bg.team, wagon: true, wagonCond: ctx.num("wagon.max"), goods: resolve(bg.goods, ctx), teamster: false };
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
  return usd(ctx, `price.flour.${ctx.state.place === "bronson" ? "bronson" : ctx.state.place === "detroit" ? "detroit" : "east"}`);
}

// Farms that will sell food are some days apart.
function provisionsOpen(ctx) {
  const last = ctx.state.vars.provDay;
  return last == null || ctx.state.day - last >= ctx.num("food.provisionsGap");
}

function provisionsCost(ctx) {
  const s = ctx.state;
  const west = s.phase === "claim" || ["road", "claim"].includes(s.leg) ? "michigan" : "east";
  return usd(ctx, `price.provisions.${west}`);
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

function travelActions(ctx) {
  const s = ctx.state;
  const leg = T.LEGS[s.leg];
  const out = [];
  if (leg.mode === "wagon" && !s.gear.teamster && s.gear.wagonCond <= 0) {
    if (s.vars.skills.includes("repair")) out.push({ id: "repair:self", type: "repair", label: "Mend the wagon yourself (1 day)", days: 1, forward: true });
    else out.push({ id: "repair:slow", type: "repair", label: `Mend the wagon as best you can (${ctx.num("wagon.repairDays")} days)`, days: ctx.num("wagon.repairDays"), forward: true });
  } else {
    const label = { wagon: "Drive on for the day", canal: "Another day on the canal", steamer: "Another day on the lake" }[leg.mode];
    out.push({ id: "go", type: "travel", label, days: 1, forward: true });
  }
  if (leg.mode === "wagon") {
    out.push({ id: "rest", type: "rest", label: "Rest a day in camp", days: 1 });
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
  if (!has(ctx, "letter")) out.push(priced(ctx, "letter", "letter", `Send a letter home (${P.money(usd(ctx, "price.postage"))})`, usd(ctx, "price.postage")));
  if (anyAgue(s) && s.res.quinine > 0) out.push({ id: "dose", type: "dose", label: "Give quinine to the sick", remedy: true });
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
    }
  } else if (s.place === "detroit") {
    if (!s.gear.team && !s.gear.teamster) {
      out.push(priced(ctx, "buy-team", "buy", `Buy a yoke of oxen and a wagon (${P.money(teamPrice(ctx))})`, teamPrice(ctx), { forward: true }));
      out.push(priced(ctx, "hire-teamster", "buy", `Hire a teamster to carry you and your goods west (${P.money(usd(ctx, "price.teamster"))})`, usd(ctx, "price.teamster"), { forward: true }));
    }
    const ready = Boolean(s.gear.team || s.gear.teamster);
    out.push({ id: "set-out", type: "travel", label: "Set out on the Territorial Road", forward: true, enabled: ready, reason: ready ? undefined : "You need a team or a teamster first." });
  }
  commonTownActions(ctx, out);
  return out;
}

function officeActions(ctx) {
  const { state: s, num } = ctx;
  const land = s.land;
  const out = [];
  if (land.paid) {
    out.push({ id: "go-claim", type: "travel", label: `Go out to the claim (${land.claimMiles} miles)`, forward: true });
    return out;
  }
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
  if (provisionsOpen(ctx)) {
    const cost = provisionsCost(ctx);
    out.push(priced(ctx, "buy:provisions", "buy", `Buy provisions from a neighbour (${P.money(cost)})`, cost));
  }
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

// What a day aboard is like on the current ticket: meals and a berth on the
// packet, the line boat with meals and the cabin; crowding on the line boats and the deck.
function boatDay(s) {
  const mode = s.phase === "travel" ? T.LEGS[s.leg]?.mode : null;
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

function maybeEvent(ctx, deck, pId) {
  // No other event on a day someone died: the family stops to grieve first.
  if (ctx.state.over || ctx.state.pending || ctx.state.vars.griefDays > 0) return;
  if (ctx.rng.chance(ctx.num(pId))) ctx.drawEvent(deck);
}

function arriveTown(ctx, place) {
  const s = ctx.state;
  s.place = place;
  s.leg = null;
  s.vars.visit = { place, used: {}, since: s.day };
  s.vars.terrain = null;
  const T0 = ctx.route.data.text;
  if (place === "bronson") {
    s.phase = "office";
    ctx.emit({ type: "scene", scene: "land-office" });
  } else if (place === "claim") {
    s.phase = "claim";
    ctx.emit({ type: "scene", scene: "claim" });
  } else {
    s.phase = "town";
    ctx.emit({ type: "scene", scene: `town-${place}` });
  }
  ctx.emit({ type: "arrive", place, label: T.PLACES[place], date: s.date, text: T0.arrivals[place] });
  s.vars.ticket = null;
  s.gear.teamster = place === "bronson" || place === "claim" ? s.gear.teamster : false;
  ctx.drawEvent("town");
}

function travelDay(ctx) {
  const s = ctx.state;
  const leg = T.LEGS[s.leg];
  const weather = T.rollWeather(ctx);
  ctx.emit({ type: "weather", weather, terrain: s.vars.terrain });
  const miles = T.dayMiles(ctx, weather);
  passDay(ctx, { kind: "travel", ...boatDay(s) });
  if (s.over) return;
  if (s.vars.terrain === "swamp") tolls(ctx, miles);
  const { passed, done } = T.advance(ctx, miles);
  for (const place of passed.slice(0, done ? -1 : undefined)) {
    ctx.emit({ type: "arrive", place, label: T.PLACES[place], date: s.date, passing: true, text: ctx.route.data.text.arrivals[place] });
    if (place === "perrysburg" || place === "sandusky") ctx.emit({ type: "scene", scene: place === "sandusky" ? "black-swamp" : "toledo-strip" });
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
  switch (verb) {
    case "start": startGame(ctx, a.background, params); return;
    case "go": travelDay(ctx); return;
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
      s.gear = { ...s.gear, team: "oxen", wagon: true, wagonCond: num("wagon.max"), teamster: false };
      ctx.emit({ type: "narrate", text: "You buy a yoke of oxen and a wagon." });
      return;
    }
    case "hire-teamster": {
      P.pay(s, num, a.cost);
      s.gear.teamster = true;
      ctx.emit({ type: "narrate", text: "A teamster agrees to carry the family and the goods west." });
      return;
    }
    case "set-out": T.startLeg(ctx, "road"); ctx.emit({ type: "narrate", text: ctx.route.data.text.setOut }); return;
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
    case "letter": {
      use(ctx, "letter");
      P.pay(s, num, a.cost);
      addRes(ctx, "morale", num("morale.letter"));
      ctx.emit({ type: "narrate", text: ctx.text(ctx.route.data.text.letterSent) });
      return;
    }
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

function onDay(ctx) {
  const { state: s, num } = ctx;
  const t = s.vars.today ?? {};
  let hungry = false;
  if (!t.meals) {
    const need = needPerDay(ctx);
    if (s.res.food >= need) s.res.food -= need;
    else { s.res.food = 0; hungry = true; }
  }
  const snowy = compare(s.date, s.vars.snowDate) >= 0;
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
  const { state: s, num } = ctx;
  if (!H.living(s).length) return { outcome: "lost", won: false };
  if (s.land.paid && s.land.shelter >= num("shelter.done")) return { outcome: "settled", won: true };
  if (compare(s.date, s.vars.winterDate) >= 0) return { outcome: s.land.paid ? "roofless" : "winter", won: false };
  if (!s.land.paid && compare(s.date, num("date.deadline")) > 0) {
    const coinAfterBroker = s.purse.coin + Math.floor(P.paperValue(s, num) * (1 - num("broker.fee")));
    if (coinAfterBroker < landCostSmall(ctx)) return { outcome: "deadline", won: false };
  }
  if (stranded(ctx)) return { outcome: "stranded", won: false };
  return null;
}

function ending(ctx, end) {
  const { state: s, num } = ctx;
  const T0 = ctx.route.data.text;
  const E = T0.endings[end.outcome];
  const alive = H.living(s);
  return {
    title: E.title,
    text: ctx.text(E.text),
    score: {
      acres: s.land.paid ? s.land.acres : 0,
      shelter: s.land.shelter >= num("shelter.done"),
      alive: alive.length,
      family: s.party.length,
      money: P.valueHere(s, num),
      coin: s.purse.coin,
      days: s.day,
    },
    deaths: s.party.filter((p) => p.status === "dead").map((p) => ({ name: `${p.name} ${s.vars.surname}`, age: p.age, date: p.died.date, cause: p.died.cause })),
    epilogue: [...(E.epilogue ?? []), ...T0.epilogue],
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
  snow: (arg, ctx) => (compare(ctx.state.date, ctx.state.vars.snowDate) >= 0) === arg,
  deadlinePassed: (arg, ctx) => (compare(ctx.state.date, ctx.num("date.deadline")) > 0) === arg,
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
    gear: { team: s.gear.team, wagon: s.gear.wagon, wagonCond: s.gear.wagonCond, teamster: s.gear.teamster },
    deadline: { date: num("date.deadline"), daysLeft: diffDays(s.date, num("date.deadline")), passed: compare(s.date, num("date.deadline")) > 0 },
    snow: compare(s.date, s.vars.snowDate) >= 0,
    winterWarning: compare(s.date, s.vars.snowDate) >= 0 ? diffDays(s.date, s.vars.winterDate) : null,
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
    conditions, effects, binders, textVar, textVars,
    view: (state) => view(route, state),
  };
  return route;
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
