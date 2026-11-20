// The land office at Bronson: looking for land (alone, with a hired land
// looker, or from the plat sight unseen), handing in descriptions at the
// window, the queue and conflicting claims, paying the Receiver, and raising a
// shelter on the claim before winter. No DOM.

import { compare } from "../../engine/clock.js";
import * as P from "./purse.js";
import { workUnits } from "./health.js";
import { isSnowy } from "./travel.js";

export const KIND_LABEL = { openings: "oak openings", prairie: "prairie", timber: "heavy timber" };

export function newLand() {
  return {
    looker: false, candidates: [], nextId: 1, applied: null, queue: 0, ready: false,
    paid: false, acres: 0, tract: null, claimMiles: 0, shelter: 0, receiverNY: null, platUsed: false, conflicts: 0,
  };
}

export const SIZES = ["land.acres.small", "land.acres.mid", "land.acres.large"];

export function candidateLabel(c) {
  const quality = !c.known ? "sight unseen" : c.poor ? "low and wet" : "dry, good soil";
  return `${KIND_LABEL[c.kind]}, ${c.miles} miles out, ${quality}`;
}

export function genCandidate(ctx, via) {
  const { state, num, rng } = ctx;
  const kind = rng.weighted([
    [num("land.w.openings"), "openings"], [num("land.w.prairie"), "prairie"], [num("land.w.timber"), "timber"],
  ]);
  const poorP = num(`land.poorP.${via}`);
  const poor = rng.chance(poorP);
  const miles = rng.int(num("mi.claimMin"), num("mi.claimMax"));
  const c = { id: `t${state.land.nextId++}`, kind, poor, known: via !== "plat", miles, via };
  return c;
}

export function addCandidate(ctx, via) {
  const land = ctx.state.land;
  if (land.candidates.length >= ctx.num("land.maxCandidates")) return null;
  const c = genCandidate(ctx, via);
  land.candidates.push(c);
  ctx.emit({ type: "narrate", text: `A tract to consider: ${candidateLabel(c)}.`, cue: "tract", tract: c.id });
  return c;
}

export function exploreDay(ctx) {
  const { state, num, rng } = ctx;
  const found = rng.chance(num(state.land.looker ? "land.find.looker" : "land.find.alone"));
  if (found) addCandidate(ctx, state.land.looker ? "looker" : "alone");
  else ctx.emit({ type: "narrate", text: "A day walking section lines turns up nothing worth entering." });
}

export const landCost = (num, acres) => P.cents(num("price.land") * acres);

export function beforeDeadline(state, num) {
  return compare(state.date, num("date.deadline")) <= 0;
}

// The Receiver at Lima (the Ohio path) takes no Michigan paper: distant notes,
// like New England's at Bronson (invented; r3 §7 has no Lima office rules).
export function tenderFor(state, num, acres) {
  return P.landTender(state, num, acres, state.land.receiverNY === true, beforeDeadline(state, num), state.place !== "lima");
}

export function apply(ctx, candId, acres) {
  const { state, num, rng } = ctx;
  const land = state.land;
  land.applied = { cand: candId, acres };
  // Lima (the Ohio path) is a small office in the woods with its own, shorter wait.
  const lima = state.place === "lima";
  land.queue = rng.int(num(lima ? "land.queue.lima.min" : "land.queue.min"), num(lima ? "land.queue.lima.max" : "land.queue.max"));
  if (land.receiverNY == null) land.receiverNY = rng.chance(num("receiver.nyP"));
  ctx.emit({ type: "narrate", text: `You hand in the description of ${acres} acres at the window. The clerk says to come back.` });
  if (state.purse.notes.ny > 0) {
    ctx.emit({ type: "narrate", text: land.receiverNY
      ? "Word at the window is that this Receiver will take New York paper from an actual settler."
      : "Word at the window is that this Receiver will not take New York paper." });
  }
}

export function queueDay(ctx) {
  const { state, num, rng } = ctx;
  const land = state.land;
  if (!land.applied || land.ready) return;
  land.queue -= 1;
  if (land.queue > 0) return;
  const cand = land.candidates.find((c) => c.id === land.applied.cand);
  const p = num(cand.kind === "prairie" ? "land.conflict.prairie" : "land.conflict.p");
  if (rng.chance(p)) {
    land.conflicts += 1;
    land.candidates = land.candidates.filter((c) => c.id !== cand.id);
    land.applied = null;
    ctx.emit({ type: "narrate", text: "The clerk calls you back: another man entered that tract before you. You will have to choose again.", cue: "conflict" });
  } else {
    land.ready = true;
    ctx.emit({ type: "narrate", text: "Your description has cleared. The Receiver will take your money.", cue: "ready" });
  }
}

export function withdraw(ctx) {
  const land = ctx.state.land;
  land.applied = null;
  land.ready = false;
  land.queue = 0;
}

export function pay(ctx, useNotes) {
  const { state, num } = ctx;
  const land = state.land;
  const { acres, cand } = land.applied;
  const cost = landCost(num, acres);
  const ok = P.payLand(state, num, cost, { useNotes, tender: tenderFor(state, num, acres) });
  if (!ok) return false;
  settle(ctx, land.candidates.find((c) => c.id === cand), acres);
  ctx.emit({ type: "narrate", text: `The Receiver counts out ${P.money(cost)} and writes your receipt for ${acres} acres.`, cue: "receipt" });
  return true;
}

export function settle(ctx, tract, acres) {
  const land = ctx.state.land;
  land.paid = true;
  land.acres = acres;
  land.tract = tract;
  land.claimMiles = tract.miles;
  land.candidates = [];
  land.applied = null;
  land.ready = false;
  if (!tract.known) {
    tract.known = true;
    ctx.emit({ type: "narrate", text: tract.poor
      ? "When you reach it, the tract you bought from the plat turns out low and wet."
      : "The tract you bought from the plat turns out dry and sound." });
  }
}

export function buildRate(ctx) {
  const { state, num } = ctx;
  const tract = state.land.tract;
  let rate = num("shelter.perUnit") * workUnits(state, num) * num(`shelter.kind.${tract.kind}`);
  if (tract.poor) rate *= num("land.poor.shelterMult");
  if (state.vars.skills.includes("clearing")) rate *= num("skill.clearing");
  if (state.vars.skills.includes("tools")) rate *= num("skill.tools");
  if (isSnowy(state, num)) rate *= num("shelter.snowMult");
  const floor = num("morale.floorMult");
  rate *= floor + (1 - floor) * ((state.res.morale ?? 0) / 100);
  return rate;
}

export function addShelter(ctx, amount) {
  const land = ctx.state.land;
  const before = land.shelter;
  land.shelter = Math.min(ctx.num("shelter.done"), land.shelter + amount);
  for (const mark of [25, 50, 75]) {
    if (before < mark && land.shelter >= mark) {
      ctx.emit({ type: "narrate", text: ctx.route.data.text.shelterMarks[String(mark)], cue: "shelter", pct: mark });
    }
  }
}

export function summary(state, num) {
  const land = state.land;
  const applied = land.applied && land.candidates.find((c) => c.id === land.applied.cand);
  return {
    looker: land.looker,
    candidates: land.candidates.map((c) => ({ id: c.id, kind: c.kind, label: candidateLabel(c), miles: c.miles, known: c.known, poor: c.known ? c.poor : null })),
    applied: applied ? { tract: applied.id, acres: land.applied.acres, label: candidateLabel(applied), queueDays: land.ready ? 0 : land.queue, ready: land.ready } : null,
    paid: land.paid,
    acres: land.acres,
    tract: land.tract ? { kind: land.tract.kind, label: candidateLabel(land.tract) } : null,
    shelter: Math.round(land.shelter),
    receiverTakesNY: land.receiverNY,
    conflicts: land.conflicts,
  };
}
