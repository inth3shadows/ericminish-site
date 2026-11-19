// Scripted players for the balance simulation. Each is (route, state, actions, rng) -> action.
// They see only what the UI sees: the state's HUD view and availableActions.

import { view } from "../../engine/engine.js";

const BACKGROUNDS = ["vermont", "connecticut", "widow"];
const find = (acts, id) => acts.find((a) => a.id === id && a.enabled);
const dollars = (c) => c / 100;

function startPick(acts, seedIndex) {
  return find(acts, `start:${BACKGROUNDS[seedIndex % BACKGROUNDS.length]}`);
}

function foodDays(v) {
  return v.food.days;
}

function anyoneLow(v, below) {
  return v.party.some((p) => p.status === "sick" && p.health < below);
}

function bestTractAction(acts, v, prefer) {
  const applies = acts.filter((a) => a.type === "apply" && a.enabled && a.id.startsWith("apply:"));
  if (!applies.length) return null;
  const tract = (a) => v.land.candidates.find((c) => c.id === a.tract);
  const score = (a) => {
    const t = tract(a);
    let s = 0;
    if (t.known && !t.poor) s += 10;
    if (t.kind === "timber") s += 3;
    if (t.kind === "openings") s += 2;
    s -= t.miles / 10;
    return s;
  };
  const sizes = prefer === "big" ? [160, 80, 40] : [80, 40];
  for (const acres of sizes) {
    const ok = applies.filter((a) => a.acres === acres && (prefer === "big" || dollars(v.purse.valueHere - a.cost) >= 25));
    if (ok.length) return ok.sort((a, b) => score(b) - score(a))[0];
  }
  return applies.filter((a) => a.acres === 40).sort((a, b) => score(b) - score(a))[0] ?? null;
}

// Packet boat, cabin passage when it can afford it, a land looker, rests the sick.
export function cautious(route, state, acts, { seedIndex }) {
  if (state.phase === "start") return startPick(acts, seedIndex);
  const v = view(route, state);
  if (state.pending) return acts.find((a) => a.enabled);
  const money = dollars(v.purse.valueHere);
  const pick = (...ids) => ids.map((id) => find(acts, id)).find(Boolean);
  if (find(acts, "dose")) return find(acts, "dose");
  switch (state.phase) {
    case "travel":
      if (foodDays(v) < 5 && find(acts, "buy:provisions")) return find(acts, "buy:provisions");
      if (v.travel.mode === "wagon" && anyoneLow(v, 45)) return find(acts, "rest") ?? acts.find((a) => a.enabled);
      return acts.find((a) => a.enabled && a.forward) ?? acts.find((a) => a.enabled);
    case "town": {
      const used = state.vars.visit.used;
      if (foodDays(v) < 14 && find(acts, "buy:flour")) return find(acts, "buy:flour");
      if (!used.quinine && find(acts, "buy:quinine") && money > 150) return find(acts, "buy:quinine");
      if (state.place === "albany") {
        if (find(acts, "sell-team")) return find(acts, "sell-team");
        return pick("board:packet", "board:line-meals", "board:line") ?? find(acts, "work");
      }
      if (state.place === "buffalo") {
        const cabin = find(acts, "book:cabin");
        const reserve = 50 + 120 + 30;
        if (cabin && money - dollars(cabin.cost) >= reserve) return cabin;
        return pick("book:deck", "book:cabin") ?? find(acts, "work");
      }
      if (state.place === "detroit") {
        if (!used.brokerMi && find(acts, "broker:mi")) return find(acts, "broker:mi");
        if (!v.gear.team && !v.gear.teamster) {
          const team = find(acts, "buy-team");
          if (team && money - dollars(team.cost) >= 70) return team;
          if (find(acts, "hire-teamster")) return find(acts, "hire-teamster");
          return find(acts, "work");
        }
        return find(acts, "set-out");
      }
      return acts.find((a) => a.enabled && a.forward) ?? find(acts, "work");
    }
    case "office": {
      if (find(acts, "go-claim")) return find(acts, "go-claim");
      if (foodDays(v) < 8 && find(acts, "buy:flour")) return find(acts, "buy:flour");
      if (find(acts, "pay:notes")) return find(acts, "pay:notes");
      if (find(acts, "pay:coin")) return find(acts, "pay:coin");
      if (v.land.applied?.ready) return find(acts, "work") ?? find(acts, "withdraw");
      if (find(acts, "wait")) return find(acts, "wait");
      if (find(acts, "hire-looker") && money > 90) return find(acts, "hire-looker");
      const enough = v.land.candidates.filter((c) => !c.poor).length >= 2 || (v.land.candidates.length && v.deadline.daysLeft < 30);
      if (enough || !find(acts, "explore")) {
        const a = bestTractAction(acts, v, "safe");
        if (a) return a;
        if (find(acts, "broker:coin")) return find(acts, "broker:coin");
        return find(acts, "work") ?? find(acts, "explore") ?? find(acts, "rest");
      }
      return find(acts, "explore");
    }
    case "claim":
      if (foodDays(v) < 5 && find(acts, "buy:provisions")) return find(acts, "buy:provisions");
      if (anyoneLow(v, 35)) return find(acts, "rest");
      if (v.snow || v.land.shelter < 60) {
        const hands = find(acts, "hire-hands");
        if (hands && money - dollars(hands.cost) > 15) return hands;
      }
      return find(acts, "build");
    default:
      return acts.find((a) => a.enabled);
  }
}

// Cheap, played sensibly: keep the team, line boat with your own food, overland
// through Ohio and the Black Swamp. Buys the swamp guide and a second yoke when
// it can keep a reserve for land, rests the sick, avoids delays otherwise, and
// plays the land office and the claim like the cautious player.
const RESERVE = 50 + 20;
function hasDays(effects = []) {
  return effects.some((e) => "days" in e || hasDays(e.then) || hasDays(e.else));
}
export function cheap(route, state, acts, ctx) {
  if (state.phase === "start") return startPick(acts, ctx.seedIndex);
  const v = view(route, state);
  const money = dollars(v.purse.valueHere);
  if (state.pending) {
    const ev = route.eventIndex.get(state.pending.id);
    const ok = acts.filter((a) => a.enabled);
    const buy = ok.find((a) => ["hire", "buy"].includes(a.choice) && ["ohio-swamp-guide", "ohio-second-yoke"].includes(ev.id));
    if (buy) {
      const cost = ev.id === "ohio-swamp-guide" ? route.num("price.swampGuide") : route.num("price.oxen");
      if (money - cost >= RESERVE) return buy;
      return ok.find((a) => a.choice === "no");
    }
    if (anyoneLow(v, 45)) return ok[0];
    const quick = ok.find((a) => !hasDays(ev.choices.find((c) => c.id === a.choice).effects));
    return quick ?? ok[0];
  }
  if (find(acts, "dose")) return find(acts, "dose");
  if (state.phase === "travel") {
    if (foodDays(v) < 4 && find(acts, "buy:provisions")) return find(acts, "buy:provisions");
    if (v.travel.mode === "wagon" && anyoneLow(v, 45)) return find(acts, "rest") ?? acts.find((a) => a.enabled);
    return acts.find((a) => a.enabled && a.forward) ?? acts.find((a) => a.enabled);
  }
  if (state.phase === "town") {
    if (state.place === "albany") {
      if (foodDays(v) < 12 && find(acts, "buy:flour")) return find(acts, "buy:flour");
      return find(acts, "board:line") ?? find(acts, "board:line-meals") ?? find(acts, "work");
    }
    if (state.place === "buffalo") {
      if (foodDays(v) < 20 && find(acts, "buy:flour")) return find(acts, "buy:flour");
      return find(acts, "overland") ?? find(acts, "buy-team") ?? find(acts, "book:deck") ?? find(acts, "work");
    }
  }
  // Late and short of time: enter the smallest tract and put the money into hired hands.
  const a = cautious(route, state, acts, ctx);
  if (a?.type === "apply" && a.acres > route.num("land.acres.small")) {
    return acts.find((x) => x.enabled && x.type === "apply" && x.tract === a.tract && x.acres === route.num("land.acres.small")) ?? a;
  }
  return a;
}

// The cautious player's habits on the cheap boats: line boat with meals, deck passage.
export function thrifty(route, state, acts, ctx) {
  if (state.phase === "town" && state.place === "albany" && !state.pending) {
    const a = find(acts, "sell-team") ?? find(acts, "board:line-meals") ?? find(acts, "board:line");
    if (a) return a;
  }
  if (state.phase === "town" && state.place === "buffalo" && !state.pending && find(acts, "book:deck")) return find(acts, "book:deck");
  return cautious(route, state, acts, ctx);
}

// Uniform over whatever is enabled.
export function random(route, state, acts, { seedIndex, rng }) {
  if (state.phase === "start") return startPick(acts, seedIndex);
  return rng.pick(acts.filter((a) => a.enabled));
}

export const STRATEGIES = { cautious, thrifty, cheap, random };
