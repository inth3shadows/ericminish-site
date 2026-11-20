// Travel modes and their daily rules: ox or horse wagon, canal packet or line
// boat, lake steamer, the winter stage, the Black Swamp road. A leg is a chain
// of segments; each travel action is one day. The family's own wagon has a
// pace (steady, hard, grueling) that pays only on good road. No DOM.

import { compare, month } from "../../engine/clock.js";

export const LEGS = {
  vermont: { label: "The road to Albany", mode: "wagon", scene: "road-vermont",
    segments: [{ to: "albany", miles: "mi.vermont", terrain: "hill" }] },
  canal: { label: "The Erie Canal", mode: "canal", scene: "canal",
    segments: [{ to: "buffalo", miles: "mi.canal", terrain: "canal" }] },
  lake: { label: "Lake Erie by steamboat", mode: "steamer", scene: "lake", unit: "days",
    segments: [{ to: "detroit", miles: "lake.days", terrain: "lake" }] },
  overland: { label: "The Ohio road and the Black Swamp", mode: "wagon", scene: "ohio-road",
    segments: [
      { to: "sandusky", miles: "mi.buffaloSandusky", terrain: "road" },
      { to: "perrysburg", miles: "mi.sanduskyPerrysburg", terrain: "swamp" },
      { to: "detroit", miles: "mi.perrysburgDetroit", terrain: "strip" },
    ] },
  road: { label: "The Territorial Road", mode: "wagon", scene: "territorial-road",
    segments: [
      { to: "marshall", miles: "mi.detroitMarshall", terrain: "corduroy" },
      { to: "bronson", miles: "mi.marshallBronson", terrain: "corduroy" },
    ] },
  claim: { label: "Out to the claim", mode: "wagon", scene: "claim-track",
    segments: [{ to: "claim", miles: null, terrain: "track" }] },
  stage: { label: "The winter stage to Detroit", mode: "stage", scene: "ohio-road", unit: "days",
    segments: [{ to: "detroit", miles: "stage.days", terrain: "road" }] },
};

export const PACES = ["steady", "hard", "grueling"];
// Roads where pushing the team gains miles. The Black Swamp road and the forest
// track cap the speed whatever the pace (r3 §1a-1b).
export const GOOD_ROAD = new Set(["hill", "road", "corduroy", "strip"]);
export const BAD_ROAD = new Set(["swamp", "track"]);

// The pace applies to the family's own wagon and team; a boat, the stage or a
// hired teamster sets its own.
export function ownPace(state) {
  return state.phase === "travel" && LEGS[state.leg]?.mode === "wagon" && Boolean(state.gear.team) && !state.gear.teamster;
}

export const PLACES = {
  home: "the farm", albany: "Albany", buffalo: "Buffalo", sandusky: "Sandusky", perrysburg: "Perrysburg",
  detroit: "Detroit", marshall: "Marshall", bronson: "Bronson", claim: "the claim",
};

export const TERRAIN_LABEL = {
  hill: "hill road", canal: "canal", lake: "open lake", road: "turnpike", swamp: "Black Swamp road",
  strip: "the Toledo Strip", corduroy: "corduroy road", track: "wagon track",
};

export function segMiles(state, num, leg, i) {
  const seg = LEGS[leg].segments[i];
  return seg.miles ? num(seg.miles) : state.land.claimMiles;
}

export function legMiles(state, num, leg) {
  return LEGS[leg].segments.reduce((a, _, i) => a + segMiles(state, num, leg, i), 0);
}

export function startLeg(ctx, leg) {
  const s = ctx.state;
  s.phase = "travel";
  s.leg = leg;
  s.vars.seg = 0;
  s.vars.segMi = 0;
  s.vars.legMi = 0;
  s.vars.tollMi = 0;
  s.vars.terrain = LEGS[leg].segments[0].terrain;
  ctx.emit({ type: "scene", scene: LEGS[leg].scene });
}

// One draw for wet/dry; after the first snow date wet days are snow.
export function rollWeather(ctx) {
  const { state, num, rng } = ctx;
  const m = Math.min(12, Math.max(9, month(state.date)));
  const wet = rng.chance(num(`wx.rain.${m}`));
  const snowy = compare(state.date, state.vars.snowDate) >= 0;
  if (snowy) return wet ? "snow" : "cold";
  return wet ? "rain" : "fair";
}

export function dayMiles(ctx, weather) {
  const { state, num } = ctx;
  const leg = LEGS[state.leg];
  if (leg.mode === "canal") {
    return num(state.vars.ticket === "packet" ? "canal.packetMph" : "canal.lineMph") * num("canal.hoursPerDay");
  }
  if (leg.mode === "steamer" || leg.mode === "stage") return 1;
  if (!state.gear.teamster && state.gear.wagonCond <= 0) return 0;
  let base = num(state.gear.team === "horse" ? "speed.horse" : "speed.oxen");
  // A second yoke (bought on the Ohio road) spells the first and pulls through mud.
  if (state.flags.secondYoke && state.gear.team === "oxen" && !state.gear.teamster) base *= num("yoke.second.mult");
  // An ox that gave out: the wagon crawls until a new yoke is bought.
  if (state.flags.teamShort && !state.gear.teamster) base *= num("team.short.mult");
  const t = state.vars.terrain;
  return base * terrainMult(ctx, t) * weatherMult(ctx, weather) * moraleMult(ctx) * paceMult(ctx, t) * teamWearMult(ctx);
}

// A worn team pulls slower, from the first point of fatigue: a hard or grueling
// day buys miles today and costs some on every day after, until the team rests.
// The same on every road (V6): on the swamp road and the forest track a worn team
// is slower than the road's own pace, which pushing never raises (paceMult). A
// spent team crawls at fat.team.floor of its fresh pace, but never stops dead.
export function teamWearMult(ctx) {
  const { state, num } = ctx;
  if (!state.gear.team || state.gear.teamster) return 1;
  return Math.max(num("fat.team.floor"), 1 - num("fat.team.slow") * (state.gear.fatigue ?? 0));
}

// Hard and grueling multiply the miles only on good road.
export function paceMult(ctx, terrain) {
  const { state, num } = ctx;
  if (!ownPace(state) || !GOOD_ROAD.has(terrain)) return 1;
  return num(`speed.pace.${state.vars.pace ?? "steady"}`);
}

// The Black Swamp road is passable in July-September and worsens month by month after.
export function swampMult(ctx) {
  const { state, num } = ctx;
  const m = month(state.date);
  let x = m <= num("swamp.dryLastMonth") ? num("terrain.swamp.dry") : num(`terrain.swamp.${Math.min(12, m)}`);
  if (state.flags.swampGuide) x *= num("swamp.guide.mult");
  if (state.flags.swampDrained) {
    x *= num("swamp.drained.mult");
    delete state.flags.swampDrained; // one day's benefit after waiting out the rain
  }
  return x;
}

function terrainMult(ctx, t) {
  return t === "swamp" ? swampMult(ctx) : ctx.num(`terrain.${t}`);
}

function weatherMult(ctx, weather) {
  return weather === "rain" ? ctx.num("wx.rainMult") : weather === "snow" ? ctx.num("wx.snowMult") : 1;
}

function moraleMult(ctx) {
  const floor = ctx.num("morale.floorMult");
  return floor + (1 - floor) * ((ctx.state.res.morale ?? 0) / 100);
}

// Move along the leg. Returns {passed: [place...], done: bool}.
export function advance(ctx, miles) {
  const { state, num } = ctx;
  const leg = LEGS[state.leg];
  const passed = [];
  state.vars.segMi += miles;
  state.vars.legMi += miles;
  while (state.vars.seg < leg.segments.length && state.vars.segMi >= segMiles(state, num, state.leg, state.vars.seg)) {
    state.vars.segMi -= segMiles(state, num, state.leg, state.vars.seg);
    passed.push(leg.segments[state.vars.seg].to);
    state.vars.seg += 1;
    if (state.vars.seg < leg.segments.length) state.vars.terrain = leg.segments[state.vars.seg].terrain;
  }
  const done = state.vars.seg >= leg.segments.length;
  if (done) state.vars.legMi = legMiles(state, num, state.leg);
  return { passed, done };
}

export function progressView(state, num) {
  if (state.phase !== "travel" || !state.leg) return null;
  const leg = LEGS[state.leg];
  const seg = leg.segments[Math.min(state.vars.seg, leg.segments.length - 1)];
  return {
    leg: state.leg,
    label: leg.label,
    mode: leg.mode,
    unit: leg.unit ?? "miles",
    done: Math.round(state.vars.legMi),
    of: legMiles(state, num, state.leg),
    next: seg.to,
    nextLabel: PLACES[seg.to],
    terrain: state.vars.terrain,
    terrainLabel: TERRAIN_LABEL[state.vars.terrain],
  };
}
