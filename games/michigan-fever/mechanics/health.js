// Health of the family: each person has health 0-100, a status
// (well / sick / dead) and fatigue 0-100. Illness onset is weighted by leg,
// month, crowding and fatigue. No DOM. Deaths hand off to the death register
// (letters.js).

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

// ---- fatigue ------------------------------------------------------------------
// Each person and the team carry fatigue 0-100. Pace and bad road raise it;
// rest, the Sabbath and a roof bring it down (the day's numbers come from the
// route). It costs from the first point: illness (and, through the route's
// "worn" and "teamWorn" scales, accidents and lameness) grows likelier a little
// up to the knee at fat.ill.from (1 + fat.ill.low times there), then steeply,
// to 1 + fat.ill.mult times at full fatigue. One continuous curve, no cliff.

const clamp = (x, num) => Math.min(num("fat.max"), Math.max(0, x));

export function fatigueMult(p, num) {
  const knee = num("fat.ill.from");
  const low = num("fat.ill.low");
  const f = Math.max(0, p?.fatigue ?? 0);
  if (f <= knee) return 1 + low * (f / knee);
  return 1 + low + (num("fat.ill.mult") - low) * ((f - knee) / (num("fat.max") - knee));
}

// "worn" at fat.high, "tired" at fat.tired, else null.
export function tiredness(f, num) {
  if ((f ?? 0) >= num("fat.high")) return "worn";
  if ((f ?? 0) >= num("fat.tired")) return "tired";
  return null;
}

export const maxFatigue = (state) => living(state).reduce((m, p) => Math.max(m, p.fatigue ?? 0), 0);

// One day's fatigue: `person` and `team` are the day's change in points
// (positive tires). Children gain at fat.childMult; recovery is the same for all.
export function dailyFatigue(ctx, { person = 0, team = 0 }) {
  const { state, num } = ctx;
  for (const p of living(state)) {
    const d = person > 0 && isChild(p, num) ? person * num("fat.childMult") : person;
    p.fatigue = clamp((p.fatigue ?? 0) + d, num);
  }
  if (state.gear.team) state.gear.fatigue = clamp((state.gear.fatigue ?? 0) + team, num);
}

// An event's fatigue for one person, everyone ("all") or the team ("team").
export function addFatigue(ctx, who, amount) {
  const { state, num } = ctx;
  if (who === "team") {
    if (state.gear.team) state.gear.fatigue = clamp((state.gear.fatigue ?? 0) + amount, num);
    return;
  }
  const targets = who === "all" ? living(state) : [person(state, who)].filter((p) => p && p.status !== "dead");
  for (const p of targets) p.fatigue = clamp((p.fatigue ?? 0) + amount, num);
}

export function onsetRate(ctx, kind, crowded, p = null) {
  const { state, num } = ctx;
  const where = state.phase === "travel" ? (state.vars.terrain === "swamp" ? "swamp" : state.leg) : state.phase === "town" ? "town" : state.phase;
  const crowd = crowded ? num("crowd.mult") : 1;
  const worn = fatigueMult(p, num);
  if (kind === "ague") {
    const m = Math.min(12, Math.max(9, month(state.date)));
    return num(`ague.base.${where}`) * num(`ague.month.${m}`) * crowd * worn;
  }
  if (kind === "dysentery") return num("dys.base") * crowd * worn;
  if (kind === "cholera") return ["canal", "lake"].includes(state.leg) && state.phase === "travel" ? num("cholera.base") * worn : 0;
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
        const hit = rng.chance(onsetRate(ctx, kind, day.crowded, p));
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
    child: isChild(p, num), fatigue: Math.round(p.fatigue ?? 0), tired: p.status === "dead" ? null : tiredness(p.fatigue, num),
  }));
}
