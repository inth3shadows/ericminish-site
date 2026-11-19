// Health of the family: each person has health 0-100 and a status
// (well / sick / dead). Illness onset is weighted by leg, month and crowding.
// No DOM. Deaths hand off to the death register (letters.js).

import { month } from "../../engine/clock.js";
import { deathBeats } from "./letters.js";

export const ILLNESS_LABEL = {
  ague: "fever and ague",
  dysentery: "dysentery",
  cholera: "cholera",
  injury: "an injury",
  hunger: "want of food",
  cold: "the cold",
};

export const living = (state) => state.party.filter((p) => p.status !== "dead");
export const person = (state, id) => state.party.find((p) => p.id === id);
export const isChild = (p, num) => p.age < num("age.adult");

export function workUnits(state, num) {
  let units = 0;
  for (const p of living(state)) {
    let u = p.age >= num("age.adult") ? 1 : p.age >= num("age.helper") ? num("work.helperFactor") : 0;
    if (p.status === "sick") u *= num("work.sickFactor");
    units += u;
  }
  return units;
}

export const ableAdults = (state, num) =>
  living(state).filter((p) => p.age >= num("age.adult") && p.status === "well").length;

export function sicken(ctx, id, kind) {
  const p = person(ctx.state, id);
  if (!p || p.status !== "well") return false;
  p.status = "sick";
  p.illness = { kind, days: 0 };
  ctx.emit({ type: "narrate", text: `${p.name} is down with ${ILLNESS_LABEL[kind]}.`, cue: "illness", who: p.id, illness: kind });
  return true;
}

export function injure(ctx, id, amount) {
  const p = person(ctx.state, id);
  if (!p || p.status === "dead") return;
  p.health -= amount;
  if (p.status === "well") {
    p.status = "sick";
    p.illness = { kind: "injury", days: 0 };
  }
  if (p.health <= 0) die(ctx, p, p.illness?.kind ?? "injury");
}

export function heal(ctx, who, amount) {
  const num = ctx.num;
  const targets = who === "all" ? living(ctx.state) : [person(ctx.state, who)].filter(Boolean);
  for (const p of targets) if (p.status !== "dead") p.health = Math.min(num("health.max"), p.health + amount);
}

export function cure(ctx, id) {
  const p = person(ctx.state, id);
  if (!p || p.status !== "sick") return false;
  p.status = "well";
  p.illness = null;
  ctx.emit({ type: "narrate", text: `${p.name} is on the mend.`, cue: "recovered", who: p.id });
  return true;
}

function onsetRate(ctx, kind, crowded) {
  const { state, num } = ctx;
  const where = state.phase === "travel" ? (state.vars.terrain === "swamp" ? "swamp" : state.leg) : state.phase === "town" ? "town" : state.phase;
  const crowd = crowded ? num("crowd.mult") : 1;
  if (kind === "ague") {
    const m = Math.min(12, Math.max(9, month(state.date)));
    return num(`ague.base.${where}`) * num(`ague.month.${m}`) * crowd;
  }
  if (kind === "dysentery") return num("dys.base") * crowd;
  if (kind === "cholera") return ["canal", "lake"].includes(state.leg) && state.phase === "travel" ? num("cholera.base") : 0;
  return 0;
}

// One day of health for everyone. `day` describes the day:
// {resting, crowded, hungry, cold}; cold is exposure from 0 (roofed) to 1 (none).
export function dailyHealth(ctx, day) {
  const { state, num, rng } = ctx;
  for (const p of living(state)) {
    const child = isChild(p, num);
    if (p.status === "sick") {
      const ill = p.illness;
      ill.days += 1;
      p.health -= num(`ill.${ill.kind}.loss`) * (child ? num("ill.childMult") : 1);
      const rec = num(`ill.${ill.kind}.recover`) + (day.resting ? num("ill.restBonus") : 0);
      const recovered = rng.chance(rec);
      if (p.health > 0 && ill.days >= num(`ill.${ill.kind}.minDays`) && recovered) cure(ctx, p.id);
    } else {
      p.health = Math.min(num("health.max"), p.health + num(day.resting ? "health.restRegen" : "health.regen"));
      for (const kind of ["ague", "dysentery", "cholera"]) {
        const hit = rng.chance(onsetRate(ctx, kind, day.crowded));
        if (hit && p.status === "well") sicken(ctx, p.id, kind);
      }
    }
    if (day.hungry) p.health -= num("hunger.loss") * (child ? num("ill.childMult") : 1);
    if (day.cold > 0) p.health -= num("cold.loss") * day.cold * (child ? num("ill.childMult") : 1);
    if (p.health <= 0) {
      const cause = p.status === "sick" ? p.illness.kind : day.hungry ? "hunger" : day.cold > 0 ? "cold" : "injury";
      die(ctx, p, cause);
    }
  }
}

export function die(ctx, p, cause) {
  const { state, num } = ctx;
  if (p.status === "dead") return;
  p.status = "dead";
  p.health = 0;
  p.illness = null;
  const leg = state.phase === "travel" ? (state.leg === "claim" ? "claimTrack" : state.leg) : state.phase;
  p.died = { date: state.date, leg, place: state.place, cause };
  for (const b of deathBeats(ctx, p, cause)) ctx.emit(b);
  if (living(state).length) {
    ctx.state.res.morale = Math.max(0, (state.res.morale ?? 0) - num("grief.morale"));
    state.vars.griefDays = (state.vars.griefDays ?? 0) + num("grief.days");
  }
}

export function summary(state, num) {
  return state.party.map((p) => ({
    id: p.id, name: p.name, age: p.age, role: p.role, sex: p.sex,
    status: p.status, illness: p.illness?.kind ?? null, health: Math.max(0, Math.round(p.health)),
    child: isChild(p, num),
  }));
}
