// Scripted players for the balance simulation. Each is (route, state, actions, rng) -> action.
// They see only what the UI sees: the state's HUD view and availableActions.

import { view } from "../../engine/engine.js";
import { compare } from "../../engine/clock.js";

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

// ---- P2 Phase B: the tier sim's players ------------------------------------------
// careful: the cautious player on the main route (it declines every pivot: the decline
// is the first choice, and pivot actions are never "forward").
export const careful = cautious;

// Careless: grueling everywhere, the cheapest of everything: the line boat on its own
// food, the free road through the Black Swamp, no land looker, 40 acres, no hired hands,
// no quinine, no lodging; food only when it runs out; the event choice that costs nothing.
function costsNothing(route, ev, choiceId) {
  const c = ev.choices.find((x) => x.id === choiceId);
  const s = JSON.stringify(c.effects ?? []);
  return !/"pay"|"days"|"payTie"|"sendTie"|"writeHome"|"collectMail"/.test(s);
}
export function careless(route, state, acts, ctx) {
  if (state.phase === "start") return startPick(acts, ctx.seedIndex);
  const v = view(route, state);
  const ok = acts.filter((a) => a.enabled);
  if (state.pending) {
    const ev = route.eventIndex.get(state.pending.id);
    return ok.find((a) => costsNothing(route, ev, a.choice)) ?? ok[0];
  }
  const pick = (...ids) => ids.map((id) => find(acts, id)).find(Boolean);
  if (state.phase === "travel") {
    if (foodDays(v) < 1 && find(acts, "buy:provisions")) return find(acts, "buy:provisions");
    const go = find(acts, "go");
    if (go) return go.paces ? { ...go, pace: "grueling" } : go;
    return acts.find((a) => a.enabled && a.forward) ?? ok[0];
  }
  if (state.phase === "town") {
    if (foodDays(v) < 2 && find(acts, "buy:flour")) return find(acts, "buy:flour");
    if (state.place === "albany") return pick("board:line", "board:line-meals") ?? find(acts, "work");
    if (state.place === "buffalo") return pick("overland", "book:deck") ?? find(acts, "work");
    if (state.place === "detroit") {
      if (!v.gear.team && !v.gear.teamster) return pick("hire-teamster", "buy-team") ?? find(acts, "work");
      return find(acts, "set-out");
    }
  }
  if (state.phase === "office") {
    if (find(acts, "go-claim")) return find(acts, "go-claim");
    if (foodDays(v) < 2 && find(acts, "buy:flour")) return find(acts, "buy:flour");
    const pay = pick("pay:notes", "pay:coin");
    if (pay) return pay;
    if (v.land.applied?.ready) return find(acts, "work") ?? find(acts, "withdraw");
    if (find(acts, "wait")) return find(acts, "wait");
    const small = acts.filter((a) => a.enabled && a.type === "apply" && a.acres === 40);
    if (small.length) return small[0];
    return pick("plat", "explore") ?? find(acts, "work") ?? find(acts, "rest");
  }
  if (state.phase === "claim") {
    if (foodDays(v) < 1 && find(acts, "buy:provisions")) return find(acts, "buy:provisions");
    return find(acts, "build");
  }
  return ok[0];
}

// ---- careful players for the paths -------------------------------------------------
// Each plays like the cautious player until its pivot, takes it (offer, then confirm),
// and then plays the path with care. A game that never reaches its pivot stays on the
// main route; the sim counts a path's band over the games that took the path.

const choose = (acts, id) => acts.find((a) => a.enabled && a.choice === id);
const pending = (state, id) => state.pending?.id === id;

// The winter weeks (Detroit, Chicago): food first, a roof, work, coin for land.
function winterWeekPick(route, state, acts, v, { coinWant }) {
  const used = state.vars.visit.used;
  if (foodDays(v) < 12 && find(acts, "buy:flour")) return find(acts, "buy:flour");
  if (find(acts, "dose")) return find(acts, "dose");
  if (!used.quinine && find(acts, "buy:quinine") && v.party.some((p) => p.illness === "ague") && dollars(v.purse.valueHere) > 60) return find(acts, "buy:quinine");
  if (v.purse.coin < coinWant && !used.broker && find(acts, "broker:coin")) return find(acts, "broker:coin");
  if (v.party.some((p) => p.status === "sick" && p.health < 40)) return find(acts, "week:rest");
  return find(acts, "week:work") ?? find(acts, "week:rest");
}

// Bronson in spring 1837 (Detroit path): coin only, 40 acres, then the path ends.
function springOffice(route, state, acts, ctx) {
  const v = view(route, state);
  if (foodDays(v) < 8 && find(acts, "buy:flour")) return find(acts, "buy:flour");
  if (find(acts, "pay:coin")) return find(acts, "pay:coin");
  if (v.land.applied?.ready) return find(acts, "broker:coin") ?? find(acts, "work") ?? find(acts, "withdraw");
  if (find(acts, "wait")) return find(acts, "wait");
  const forty = acts.filter((a) => a.enabled && a.type === "apply" && a.acres === 40);
  const good = forty.filter((a) => !v.land.candidates.find((c) => c.id === a.tract)?.poor);
  if (good.length || (forty.length && !find(acts, "explore"))) return (good[0] ?? forty[0]);
  if (v.purse.coin < 5000 && find(acts, "broker:coin")) return find(acts, "broker:coin");
  return find(acts, "explore") ?? find(acts, "work") ?? find(acts, "rest");
}

export function carefulDetroit(route, state, acts, ctx) {
  const v = state.phase === "start" ? null : view(route, state);
  if (pending(state, "pivot-detroit")) return choose(acts, "yes");
  if (state.vars.path === "detroit") {
    if (state.pending) return acts.find((a) => a.enabled && a.choice === "change") ?? acts.find((a) => a.enabled);
    if (state.phase === "winter") {
      // West once there is coin for forty acres and the road; without it, stay and work.
      const coinReady = v.purse.coin >= 6500;
      if (find(acts, "spring") && coinReady) return find(acts, "spring");
      if (compare(state.date, route.num("date.thaw")) >= 0 && !v.gear.team && !v.gear.teamster) return find(acts, "hire-teamster") ?? find(acts, "buy-team") ?? find(acts, "week:work");
      return winterWeekPick(route, state, acts, v, { coinWant: 8000 });
    }
    if (state.phase === "office") return springOffice(route, state, acts, ctx);
    return cautious(route, state, acts, ctx);
  }
  // On the way: the long Ohio road with the team (as the Ohio player, declining Lima), so the
  // family reaches Detroit late; there it hires out by the day until the winter is offered.
  if (pending(state, "ohio-offer")) return choose(acts, "on");
  if (!state.vars.path && state.phase !== "start" && ["albany", "buffalo"].includes(state.place) && state.phase === "town") return carefulOhio(route, state, acts, ctx);
  if (state.phase === "town" && state.place === "detroit" && !state.pending) {
    if (find(acts, "pivot:detroit")) return find(acts, "pivot:detroit");
    if (foodDays(v) < 10 && find(acts, "buy:flour")) return find(acts, "buy:flour");
    return find(acts, "work") ?? find(acts, "stay");
  }
  return cautious(route, state, acts, ctx);
}

export function carefulChicago(route, state, acts, ctx) {
  if (state.phase === "start") return startPick(acts, ctx.seedIndex);
  const v = view(route, state);
  if (pending(state, "pivot-chicago")) return choose(acts, "lakes") ?? choose(acts, "road") ?? choose(acts, "stage") ?? choose(acts, "no");
  if (state.vars.path === "chicago") {
    if (state.pending) return acts.find((a) => a.enabled && a.choice === "pay") ?? acts.find((a) => a.enabled);
    if (state.phase === "lots") {
      const money = v.purse.valueHere;
      const lot = v.lot;
      const reserve = 9000;
      // Into the boom: a lot in cash if the money allows a reserve, else on credit.
      if (!lot) {
        const cash = find(acts, "lot:cash");
        if (cash && money - cash.cost >= reserve) return cash;
        const credit = find(acts, "lot:credit");
        if (credit && money - credit.cost >= 4000) return credit;
      }
      if (lot?.held && find(acts, "lot:sell")) {
        const sell = find(acts, "lot:sell");
        // Take a buyer who makes the money back, or any buyer once the winter is half gone.
        if (lot.offer >= lot.price || compare(state.date, "1837-02-01") >= 0) return sell;
      }
      if (!lot?.held) {
        // Out to the prairie with money left for food and hands, early enough to roof
        // the cabin before the snow, or else after the thaw.
        const season = compare(state.date, "1836-11-01") < 0 || compare(state.date, route.num("date.thaw")) >= 0;
        const farm = [find(acts, "farm:80"), find(acts, "farm:40")].find((f) => f && money - f.cost >= 4000);
        if (farm && season) return farm;
      }
      return winterWeekPick(route, state, acts, v, { coinWant: lot?.held ? 0 : 6000 });
    }
    return cautious(route, state, acts, ctx);
  }
  // The pivot at Detroit: the cautious player sold the team at Albany, so the stage.
  if (state.phase === "town" && state.place === "detroit" && !state.pending && find(acts, "pivot:chicago")) return find(acts, "pivot:chicago");
  return cautious(route, state, acts, ctx);
}

export function carefulOhio(route, state, acts, ctx) {
  if (state.phase === "start") return startPick(acts, ctx.seedIndex);
  if (pending(state, "ohio-offer")) return choose(acts, "south");
  if (pending(state, "pivot-ohio")) return choose(acts, "yes");
  // Keep the team for the Ohio road: the packet, the team as freight; overland from Buffalo.
  if (!state.vars.path && state.phase === "town" && !state.pending) {
    const v = view(route, state);
    if (state.place === "albany") {
      if (foodDays(v) < 14 && find(acts, "buy:flour")) return find(acts, "buy:flour");
      return find(acts, "board:packet") ?? find(acts, "board:line-meals") ?? find(acts, "board:line") ?? find(acts, "work");
    }
    if (state.place === "buffalo") {
      if (foodDays(v) < 24 && find(acts, "buy:flour")) return find(acts, "buy:flour");
      return find(acts, "overland") ?? find(acts, "buy-team") ?? find(acts, "work");
    }
  }
  if (state.pending) {
    const ev = route.eventIndex.get(state.pending.id);
    const buy = acts.find((a) => a.enabled && a.choice === "hire" && ev.id === "ohio-swamp-guide");
    if (buy) return buy;
  }
  return cautious(route, state, acts, ctx);
}

export function carefulHome(route, state, acts, ctx) {
  if (pending(state, "pivot-home")) return choose(acts, "yes") ?? choose(acts, "no");
  if (pending(state, "home-again")) return choose(acts, "pay") ?? choose(acts, "keep");
  if (state.vars.path === "home") {
    if (state.phase === "town" && !state.pending) {
      const v = view(route, state);
      if (foodDays(v) < 24 && find(acts, "buy:flour")) return find(acts, "buy:flour");
      return find(acts, "passage") ?? find(acts, "broker:coin") ?? find(acts, "work") ?? acts.find((a) => a.enabled);
    }
    return cautious(route, state, acts, ctx);
  }
  // Send what the ties need by the mail on the way; at Bronson, faced with the land
  // office crowd, turn back.
  const send = sendHomePick(route, state, acts, ctx, 15000);
  if (send) return send;
  if (state.phase === "office" && state.place === "bronson" && !state.pending && find(acts, "pivot:home")) return find(acts, "pivot:home");
  return cautious(route, state, acts, ctx);
}

export function carefulKin(route, state, acts, ctx) {
  if (pending(state, "kin-call")) return choose(acts, "go");
  if (pending(state, "pivot-kin")) return choose(acts, "yes") ?? choose(acts, "no");
  if (pending(state, "kin-welcome")) return choose(acts, "land") ?? choose(acts, "work") ?? choose(acts, "floor");
  if (pending(state, "post-office")) return choose(acts, "ask") ?? choose(acts, "leave");
  if (pending(state, "post-letters")) return choose(acts, "take") ?? choose(acts, "leave");
  // Call at the post offices at Buffalo and Detroit, where a western letter would wait.
  if (!state.vars.path && state.phase === "town" && !state.pending && ["buffalo", "detroit"].includes(state.place) && state.vars.west) {
    if (!state.vars.visit.used.postCall && find(acts, "post")) return find(acts, "post");
  }
  return cautious(route, state, acts, ctx);
}

// The cautious player who also sends home what each tie needs, whole, by the mail at
// Albany, Buffalo and Detroit, while it keeps `reserve` cents for the road and the land.
function sendHomePick(route, state, acts, ctx, reserve) {
  const v = state.phase === "start" ? null : view(route, state);
  if (pending(state, "post-office")) {
    const send = acts.find((a) => a.enabled && a.choice.startsWith("send-") && v.purse.valueHere - (v.ties.find((t) => `send-${t.id}` === a.choice)?.amount ?? 0) >= reserve);
    return send ?? choose(acts, "ask") ?? choose(acts, "leave");
  }
  if (pending(state, "post-send-how")) return choose(acts, "whole") ?? choose(acts, "halves") ?? acts.find((a) => a.enabled);
  if (pending(state, "post-letters")) return choose(acts, "take") ?? choose(acts, "leave");
  if (!state.vars.path && state.phase === "town" && !state.pending && ["albany", "buffalo", "detroit"].includes(state.place)) {
    const owed = v.ties.some((t) => t.status === "open" || t.status === "lost");
    if (owed && !state.vars.visit.used.postCall && find(acts, "post")) return find(acts, "post");
  }
  return null;
}

// The Chicago trap, played on purpose: buy a lot, never sell it.
export function holdLot(route, state, acts, ctx) {
  if (state.vars.path === "chicago" && state.phase === "lots" && !state.pending && find(acts, "lot:sell")) {
    return find(acts, "week:work") ?? find(acts, "week:rest");
  }
  return carefulChicago(route, state, acts, ctx);
}

// Random on the main route (the tier table's random): uniform over what is enabled, but it
// never takes a pivot (the spec's random is a main-route strategy).
const PIVOT_CHOICES = new Set(["pivot-detroit:yes", "pivot-chicago:road", "pivot-chicago:stage", "pivot-chicago:lakes", "pivot-home:yes",
  "ohio-offer:south", "pivot-ohio:yes", "kin-call:go", "pivot-kin:yes"]);
export function randomMain(route, state, acts, { seedIndex, rng }) {
  if (state.phase === "start") return startPick(acts, seedIndex);
  const ok = acts.filter((a) => a.enabled && a.type !== "pivot" && !(a.type === "choose" && PIVOT_CHOICES.has(`${a.event}:${a.choice}`)));
  return rng.pick(ok);
}

export function sendsHome(route, state, acts, ctx) {
  return sendHomePick(route, state, acts, ctx, 15000) ?? cautious(route, state, acts, ctx);
}

// Careless variants, printed (not asserted) beside the careless row, to show how fragile its
// tier-1 band is (round 8 note): careless's failures come from the swamp crawl, so taking the
// deck passage at Buffalo instead, or keeping a steady pace, arrives most of the time.
export function carelessDeck(route, state, acts, ctx) {
  if (state.phase === "town" && state.place === "buffalo" && !state.pending && find(acts, "book:deck")) return find(acts, "book:deck");
  return careless(route, state, acts, ctx);
}
export function carelessSteady(route, state, acts, ctx) {
  const a = careless(route, state, acts, ctx);
  return a?.id === "go" && a.paces ? { ...a, pace: "steady" } : a;
}

Object.assign(STRATEGIES, { careful, careless, carelessDeck, carelessSteady, randomMain, holdLot, carefulDetroit, carefulChicago, carefulOhio, carefulHome, carefulKin, sendsHome });
