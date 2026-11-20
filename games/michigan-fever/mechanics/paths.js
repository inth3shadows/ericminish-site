// The alternative paths (P2 Phase B): a pivot halfway, one-way, onto 1-3
// compact legs on the shared mechanics, with its own ending and two tiers.
//   detroit  winter in Detroit for wages; land in coin in the spring of 1837
//   chicago  the Chicago town-lot boom, by the Chicago road, the stage or the lakes
//   ohio     settle in Ohio: the Lima land office, south from Perrysburg
//   home     turn back for the farm
//   kin      a letter from kin settled west (Allen's Prairie, the Maumee, Brush Hill)
// Pure helpers only; route.js wires them into actions and the end check. No DOM.

import { compare, diffDays } from "../../engine/clock.js";
import * as P from "./purse.js";
import { living } from "./health.js";
import { legMiles } from "./travel.js";
import { BAD } from "./home.js";

export const PATHS = ["detroit", "chicago", "ohio", "home", "kin"];
export const KIN_PLACES = { allens: "allens", ohio: "maumee", illinois: "brushhill" };
export const KIN_WHERE = Object.keys(KIN_PLACES);
// Where each kin's letter waits, and the leg that takes the family to them.
export const KIN_OFFICE = { allens: "detroit", ohio: "buffalo", illinois: "detroit" };
export const KIN_LEG = { allens: "toAllens", ohio: "toMaumee", illinois: "toBrushHill" };

const noDeaths = (s) => s.party.every((p) => p.status !== "dead");
// "Alive as a household" (spec assumption): at least one adult, and not all lost.
export const household = (s, num) => living(s).some((p) => p.age >= num("age.adult"));

// ---- the tiers ------------------------------------------------------------------
// 0 = failed, 1 = arrived, 2 = full win. Each path names its own (spec B1).

export function tierOf(s, num, outcome) {
  if (!household(s, num)) return 0;
  const whole = noDeaths(s);
  const roofed = s.land.paid && s.land.shelter >= num("shelter.done");
  switch (s.vars.path ?? null) {
    case null:
      // Reach the Kalamazoo land office with the household; land, a roof before winter, no deaths.
      if (!s.flags.reachedBronson) return 0;
      return outcome === "settled" && whole ? 2 : 1;
    case "ohio":
      if (!s.flags.reachedLima) return 0;
      return outcome === "settled" && whole ? 2 : 1;
    case "detroit": {
      // Through the winter alive; 40 acres or more bought in coin by June 1837, the family whole.
      const through = compare(s.date, num("date.thaw")) >= 0;
      if (!through) return 0;
      return s.land.paid && s.land.acres >= num("land.acres.small") && whole ? 2 : 1;
    }
    case "chicago": {
      // Reach Chicago; sell out of the boom before spring (a lot bought, and sold before the
      // thaw), farmland with a roof, the family whole.
      if (!s.flags.reachedChicago) return 0;
      return soldOut(s, num) && roofed && whole ? 2 : 1;
    }
    case "home": {
      // Home alive; home before winter, the family whole, and every tie settled in time:
      // paid (by mail that arrived, in person, or on coming home) before it went wrong at
      // home. A parent who died unkept, or a co-signer sued, is not put right by paying late.
      if (!s.vars.homeOn) return 0;
      const beforeWinter = compare(s.vars.homeOn, s.vars.winterDate) < 0;
      const ties = s.ties.every((t) => t.status === "settled" && !BAD.has(t.outcome));
      return beforeWinter && whole && ties ? 2 : 1;
    }
    case "kin": {
      // Arrive with the household; before the snow, the family whole, land beside them or work with them.
      if (!s.vars.arrivedOn) return 0;
      const beforeSnow = compare(s.vars.arrivedOn, s.vars.snowDate) < 0;
      return beforeSnow && whole && (s.flags.kinLand || s.flags.kinWork) ? 2 : 1;
    }
    default:
      return 0;
  }
}

// ---- Detroit: the winter ---------------------------------------------------------

// Reaching Bronson before 15 December looks unlikely: the Territorial Road at a
// steady ox pace and the shortest wait at the window would run past it.
export function bronsonUnlikely(s, num) {
  const perDay = num("speed.oxen") * num("terrain.corduroy");
  const need = Math.ceil(legMiles(s, num, "road") / perDay) + num("land.queue.min");
  return diffDays(s.date, num("date.deadline")) < need;
}

// ---- Chicago: the lot -------------------------------------------------------------

// A lot's market value in cents on a date: slipping from the September level
// through the winter lull, and down to Ogden's tenth-to-twentieth once the banks suspend.
export function lotMarket(s, num, date = s.date) {
  const weeks = Math.max(0, diffDays(num("date.start"), date)) / 7;
  let x = Math.max(num("lot.crash"), num("lot.index.start") - num("lot.index.weekly") * weeks);
  if (compare(date, num("bank.suspend.illinois")) >= 0) x = num("lot.crash");
  return Math.round(num("lot.price") * x * 100);
}

// What the note on a lot bought on credit stands at today, with simple interest.
export function lotOwed(s, num) {
  const lot = s.vars.lot;
  if (!lot || lot.sold || lot.forfeit || !lot.note) return 0;
  const days = Math.max(0, diffDays(lot.bought, s.date));
  return Math.round(lot.note * (1 + num("lot.interest") * days / 365));
}

export const lotHeld = (s) => Boolean(s.vars.lot && !s.vars.lot.sold && !s.vars.lot.forfeit);

// Held into the spring of 1837: still the family's on the day of the thaw.
export function heldIntoSpring(s, num) {
  const lot = s.vars.lot;
  if (!lot) return false;
  if (lot.sold) return compare(lot.sold, num("date.thaw")) >= 0;
  if (lot.forfeit) return compare(lot.forfeit, num("date.thaw")) >= 0;
  return compare(s.date, num("date.thaw")) >= 0;
}

// Sold out of the boom: a lot bought, and sold (not let go for its note) before the thaw.
export const soldOut = (s, num) => Boolean(s.vars.lot?.sold) && compare(s.vars.lot.sold, num("date.thaw")) < 0;

// A week's buyer, if one comes: an offer in cents, or null.
export function rollOffer(ctx) {
  const { state: s, num, rng } = ctx;
  if (!lotHeld(s)) return null;
  const p = compare(s.date, num("date.thaw")) >= 0 ? num("lot.buyerP.spring") : num("lot.buyerP");
  if (!rng.chance(p)) return null;
  const lo = num("lot.offer.low");
  const hi = num("lot.offer.high");
  return Math.round(lotMarket(s, num) * (lo + (hi - lo) * rng.float()));
}

// ---- turning back -------------------------------------------------------------------

// The way home from `from` (buffalo or detroit) in one passage: the lake (or
// the winter stage once the lakes close), the canal by line boat, and the hill
// road from Albany. Days and the fare for the family, its goods and its team.
export function passage(s, num, from, units) {
  const lateLake = compare(s.date, num("date.lakeLate")) >= 0;
  const canalDays = Math.ceil(num("mi.canal") / (num("canal.lineMph") * num("canal.hoursPerDay")));
  const roadDays = Math.ceil(num("mi.vermont") / (num(s.gear.team === "horse" ? "speed.horse" : "speed.oxen") * num("terrain.hill")));
  const team = Boolean(s.gear.team);
  let days = canalDays + roadDays;
  let cost = units * num("fare.line.perMile") * num("mi.canal") + s.gear.goods * num("freight.canal.cwt");
  if (team) cost += num("freight.canal.team") + num("wagon.cwt") * num("freight.canal.cwt");
  else cost += units * num("fare.homeRoad");
  if (from === "detroit") {
    if (lateLake) {
      days += num("stage.days");
      cost += units * num("fare.winterStage");
    } else {
      days += num("lake.days");
      cost += units * num("fare.deck") + s.gear.goods * num("freight.lake.cwt");
      if (team) cost += num("freight.lake.team") + num("wagon.cwt") * num("freight.lake.cwt");
    }
  }
  return { days, cost: P.cents(cost), lateLake: from === "detroit" && lateLake };
}

// What is still owed at home, at home value: the ties not settled.
export function owedAtHome(s) {
  return s.ties.filter((t) => t.status !== "settled").reduce((a, t) => a + t.amount, 0);
}

// ---- kin in the West ------------------------------------------------------------------

// At the start: perhaps a relative already settled west, whose letter will wait
// at a post office on the way (one of the family's ties put them in touch).
export function drawWest(ctx, bg) {
  const { state: s, num, rng } = ctx;
  s.vars.west = null;
  if (!rng.chance(num("kin.callP"))) return null;
  const where = rng.weighted(KIN_WHERE.map((w) => [num(`kin.w.${w}`), w]));
  const tie = s.ties.length ? rng.pick(s.ties).id : null;
  const names = { allens: "Cousin Reuben", ohio: "Uncle Amos", illinois: "Cousin Hannah" };
  s.vars.west = { where, name: names[where], work: rng.chance(num("kin.workP")), tie, bg: bg.id };
  return s.vars.west;
}

export const kinPlace = (s) => KIN_PLACES[s.vars.west?.where] ?? null;

// The kin's own land, bought beside them from the man who holds it.
export const kinLandCost = (num) => P.cents(num("spec.price.openings") * num("land.acres.small"));
