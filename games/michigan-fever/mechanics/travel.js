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
  // ---- the alternative paths (P2 Phase B) ----
  // `ague` names the onset rate a leg borrows (ague.base.<key>); by default its own id.
  chicagoRoad: { label: "The Chicago road", mode: "wagon", scene: "chicago-road", ague: "road",
    segments: [
      { to: "whitepigeon", miles: "mi.detroitWhitePigeon", terrain: "corduroy" },
      { to: "chicago", miles: "mi.whitePigeonChicago", terrain: "corduroy" },
    ] },
  chicagoStage: { label: "The stage to Chicago", mode: "stage", scene: "chicago-road", unit: "days", ague: "stage",
    segments: [{ to: "chicago", miles: "stage.chicago.days", terrain: "road" }] },
  chicagoLakes: { label: "Round the lakes to Chicago", mode: "steamer", scene: "lake", unit: "days", ague: "lake",
    segments: [{ to: "chicago", miles: "lake.chicago.days", terrain: "lake" }] },
  toLima: { label: "South to the Lima land office", mode: "wagon", scene: "lima-road", ague: "overland",
    segments: [{ to: "lima", miles: "mi.perrysburgLima", terrain: "track" }] },
  backRoad: { label: "Back down the Territorial Road", mode: "wagon", scene: "territorial-road", ague: "road",
    segments: [
      { to: "marshall", miles: "mi.marshallBronson", terrain: "corduroy" },
      { to: "detroit", miles: "mi.detroitMarshall", terrain: "corduroy" },
    ] },
  // The long way home in one passage: the lake (or the winter stage), the canal and the hill road.
  homePassage: { label: "The long way home", mode: "passage", scene: "road-home", unit: "days", ague: "lake",
    segments: [{ to: "home", miles: null, days: "passageDays", terrain: "lake" }] },
  toAllens: { label: "The Chicago turnpike to Allen's Prairie", mode: "wagon", scene: "chicago-road", ague: "road",
    segments: [{ to: "allens", miles: "mi.detroitAllens", terrain: "corduroy" }] },
  toMaumee: { label: "By steamboat to the Maumee", mode: "steamer", scene: "lake", unit: "days", ague: "lake",
    segments: [{ to: "maumee", miles: "lake.maumee.days", terrain: "lake" }] },
  // The Maumee once the lakes close (PC3): the Ohio road and the Black Swamp with the family's
  // own wagon. Maumee lies across the river from Perrysburg, at the swamp road's end, so the
  // road's own miles (Blois) serve.
  toMaumeeRoad: { label: "The Ohio road to the Maumee", mode: "wagon", scene: "ohio-road", ague: "overland",
    segments: [
      { to: "sandusky", miles: "mi.buffaloSandusky", terrain: "road" },
      { to: "maumee", miles: "mi.sanduskyPerrysburg", terrain: "swamp" },
    ] },
  toBrushHill: { label: "The Chicago road to Brush Hill", mode: "wagon", scene: "chicago-road", ague: "road",
    segments: [
      { to: "whitepigeon", miles: "mi.detroitWhitePigeon", terrain: "corduroy" },
      { to: "chicago", miles: "mi.whitePigeonChicago", terrain: "corduroy" },
      { to: "brushhill", miles: "mi.chicagoBrushHill", terrain: "track" },
    ] },
};

// Which onset rate a leg borrows (ague.base.<key>).
export const agueKey = (leg) => LEGS[leg]?.ague ?? leg;

export const PACES = ["steady", "hard", "grueling"];
// Roads where pushing the team gains miles. The Black Swamp road and the forest
// track cap the speed whatever the pace (r3 §1a-1b).
export const GOOD_ROAD = new Set(["hill", "road", "corduroy", "strip"]);
export const BAD_ROAD = new Set(["swamp", "track"]);

// The snow lies from the seeded first snow until the thaw in spring 1837
// (date.thaw), for the paths that winter over.
export const isSnowy = (state, num) => compare(state.date, state.vars.snowDate) >= 0 && compare(state.date, num("date.thaw")) < 0;

// The month whose weather and ague rates a date uses. The tables run September
// to December (the 1836 season); a path that winters over reads January to
// March as December, April to June as November (wet, cool), and July and
// August as September.
export function seasonMonth(iso) {
  const m = month(iso);
  if (m >= 9) return m;
  if (m <= 3) return 12;
  return m <= 6 ? 11 : 9;
}

// The pace applies to the family's own wagon and team; a boat, the stage or a
// hired teamster sets its own.
export function ownPace(state) {
  return state.phase === "travel" && LEGS[state.leg]?.mode === "wagon" && Boolean(state.gear.team) && !state.gear.teamster;
}

export const PLACES = {
  home: "the farm", albany: "Albany", buffalo: "Buffalo", sandusky: "Sandusky", perrysburg: "Perrysburg",
  detroit: "Detroit", marshall: "Marshall", bronson: "Bronson", claim: "the claim",
  whitepigeon: "White Pigeon", chicago: "Chicago", lima: "Lima", allens: "Allen's Prairie", maumee: "the Maumee",
  brushhill: "Brush Hill",
};

export const TERRAIN_LABEL = {
  hill: "hill road", canal: "canal", lake: "open lake", road: "turnpike", swamp: "Black Swamp road",
  strip: "the Toledo Strip", corduroy: "corduroy road", track: "wagon track",
};

export function segMiles(state, num, leg, i) {
  const seg = LEGS[leg].segments[i];
  if (seg.miles) return num(seg.miles);
  if (seg.days) return state.vars[seg.days];
  return state.land.claimMiles;
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
  const m = seasonMonth(state.date);
  const wet = rng.chance(num(`wx.rain.${m}`));
  if (isSnowy(state, num)) return wet ? "snow" : "cold";
  return wet ? "rain" : "fair";
}

export function dayMiles(ctx, weather, terrain = ctx.state.vars.terrain) {
  const { state, num } = ctx;
  const leg = LEGS[state.leg];
  if (leg.mode === "canal") {
    return num(state.vars.ticket === "packet" ? "canal.packetMph" : "canal.lineMph") * num("canal.hoursPerDay");
  }
  if (leg.mode === "steamer" || leg.mode === "stage" || leg.mode === "passage") return 1;
  if (!state.gear.teamster && state.gear.wagonCond <= 0) return 0;
  let base = num(state.gear.team === "horse" ? "speed.horse" : "speed.oxen");
  // A second yoke (bought on the Ohio road) spells the first and pulls through mud.
  if (state.flags.secondYoke && state.gear.team === "oxen" && !state.gear.teamster) base *= num("yoke.second.mult");
  // An ox that gave out: the wagon crawls until a new yoke is bought.
  if (state.flags.teamShort && !state.gear.teamster) base *= num("team.short.mult");
  const t = terrain;
  return base * terrainMult(ctx, t) * weatherMult(ctx, weather) * moraleMult(ctx) * paceMult(ctx, t) * teamWearMult(ctx);
}

// One day on the leg, split at segment boundaries (L2): the part of the day
// left after crossing into a new segment runs at that segment's own pace (its
// terrain, and the pace only where the road is good). Returns the pieces,
// [{terrain, miles}], in order; their sum is the day's miles. Only the wagon
// changes terrain within a day; a boat or the stage is one piece.
// Robust to a position at or past a segment's end (PB5): miles beyond it count
// as already into the next segment, so no piece is negative and the pieces'
// shares of the day never add up to more than one day.
export function dayRun(ctx, weather) {
  const { state, num } = ctx;
  const leg = LEGS[state.leg];
  if (leg.mode !== "wagon") return [{ terrain: state.vars.terrain, miles: dayMiles(ctx, weather) }];
  const out = [];
  let frac = 1;
  let seg = state.vars.seg;
  let into = Math.max(0, state.vars.segMi);
  const last = leg.segments.length - 1;
  while (seg < last && into >= segMiles(state, num, state.leg, seg)) {
    into -= segMiles(state, num, state.leg, seg);
    seg += 1;
  }
  while (frac > 1e-12 && seg < leg.segments.length) {
    const terrain = leg.segments[seg].terrain;
    const full = dayMiles(ctx, weather, terrain);
    const left = Math.max(0, segMiles(state, num, state.leg, seg) - into);
    if (full <= 0 || full * frac <= left || seg === leg.segments.length - 1) {
      out.push({ terrain, miles: full * frac });
      break;
    }
    out.push({ terrain, miles: left });
    frac -= left / full;
    seg += 1;
    into = 0;
  }
  return out;
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

// Miles gained or lost on the leg by an event (the `progress` effect). segMi and
// legMi move together (PB5, PB7): a gain stops at the next place (an event does
// not carry the family past a town; the next day's travel arrives there), and a
// loss goes back no further than the last place passed. Returns the miles moved.
export function shift(state, num, miles) {
  if (state.phase !== "travel" || !LEGS[state.leg]) return 0;
  const len = segMiles(state, num, state.leg, Math.min(state.vars.seg, LEGS[state.leg].segments.length - 1));
  const d = miles >= 0 ? Math.min(miles, Math.max(0, len - state.vars.segMi)) : Math.max(miles, -state.vars.segMi);
  state.vars.segMi += d;
  state.vars.legMi += d;
  return d;
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
