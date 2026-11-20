// The step loop. Route-agnostic and DOM-free: the engine owns the clock, the
// RNG, the state envelope, the event deck and the end check; everything a
// player sees (actions, mechanics, words) comes from the route.
//
// A route is a plain object:
//   id, version, num(id)                   identity and the numbers table
//   events                                 the event deck (array)
//   startDate(options) -> ISO date
//   init(ctx, options)                     fill a new state
//   actions(ctx) -> [{id, type, label, enabled?, reason?, ...}]
//   act(ctx, action, params)               apply one route action
//   onDay?(ctx)                            daily tick, called by ctx.advanceDays
//   eventDay?(ctx, as, vars)               before each day an event's "days" effect spends:
//                                          set that day's conditions ("as" names the kind of day)
//   eventDayKinds?: string[]               the "as" values eventDay knows (validateDeck checks the deck against it)
//   afterAction?(ctx)                      after every action, before the end check
//   checkEnd(ctx) -> null | {outcome, ...}
//   ending(ctx, end) -> fields for the "end" beat
//   conditions?, effects?, binders?        route vocabulary for the deck
//   limits?: {res: [min, max]}
//   textVar?(name, value, prop, ctx)       format "{who}" / "{who.his}" in text
//   textVars?(ctx) -> {name: string}       global text variables
//   view?(state) -> HUD data
//   places?: string[]                      places a scheduled event may wait for ({"at": place}); validateDeck checks them
//   atPlace?(state) -> place | null        where the family is for an {"at"} schedule (default: state.place)

import { addDays } from "./clock.js";
import { cursor } from "./rng.js";
import { clone, createState } from "./state.js";
import * as deck from "./events.js";

export function makeCtx(route, state) {
  const beats = [];
  const ctx = {
    route,
    state,
    beats,
    rng: cursor(state.rng),
    num: (id) => route.num(id),
    emit(beat) { beats.push(beat); },
    text(tpl, vars = {}) { return renderText(tpl, ctx, vars); },
    evalCond: (cond, vars) => deck.evalCond(cond, ctx, vars),
    applyEffects: (effects, vars) => deck.applyEffects(effects, ctx, vars),
    // A due scheduled event fires ahead of the random draw; the draw still
    // happens unless the scheduled event opened a choice.
    drawEvent(name) {
      if (state.pending || state.over) return false;
      const due = deck.fireDue(ctx);
      if (state.pending || state.over) return due;
      return deck.drawEvent(ctx, name) || due;
    },
    fireDue: () => (state.pending || state.over ? false : deck.fireDue(ctx)),
    schedule: (spec, vars = {}) => deck.schedule(ctx, spec, vars),
    startEvent: (id, vars) => deck.startEvent(ctx, id, vars),
    queueEvent(id, vars = {}) {
      if (state.pending || state.over) return;
      const ev = deck.eventById(route, id);
      const v = deck.bindVars(ev, ctx, vars);
      if (v) deck.startEvent(ctx, ev, v);
    },
    // Advance the clock n days, running the route's daily tick and the end
    // check after each one. Stops early if the game ends.
    advanceDays(n) {
      for (let i = 0; i < n && !state.over; i++) {
        state.date = addDays(state.date, 1);
        state.day += 1;
        route.onDay?.(ctx);
        checkEnd(ctx);
      }
    },
    end(record) { finish(ctx, record); },
  };
  return ctx;
}

function renderText(tpl, ctx, vars) {
  if (tpl == null) return "";
  const globals = ctx.route.textVars?.(ctx) ?? {};
  return String(tpl).replace(/\{(\w+)(?:\.(\w+))?\}/g, (m, name, prop) => {
    if (name in vars) {
      const v = vars[name];
      const out = ctx.route.textVar ? ctx.route.textVar(name, v, prop, ctx) : undefined;
      return out ?? String(v);
    }
    if (name in globals && !prop) return globals[name];
    return m;
  });
}

function finish(ctx, record) {
  if (ctx.state.over) return;
  ctx.state.over = record;
  ctx.state.pending = null;
  ctx.state.phase = "over";
  ctx.emit({ type: "end", ...record, ...(ctx.route.ending?.(ctx, record) ?? {}) });
}

function checkEnd(ctx) {
  if (ctx.state.over) return;
  const end = ctx.route.checkEnd(ctx);
  if (end) finish(ctx, end);
}

export function newGame(route, { seed = "1836", ...options } = {}) {
  const state = createState({ routeId: route.id, routeVersion: route.version, seed, date: route.startDate(options) });
  const ctx = makeCtx(route, state);
  route.init(ctx, options);
  return { state, beats: ctx.beats };
}

// What the player can do now. Pure: never changes the state passed in.
export function availableActions(route, state) {
  if (state.over) return [];
  const ctx = makeCtx(route, clone(state));
  if (state.pending?.kind === "event") {
    const ev = deck.eventById(route, state.pending.id);
    return deck.choiceList(ev, ctx, state.pending.vars).map((c) => ({
      id: `choose:${c.id}`, type: "choose", event: ev.id, choice: c.id, label: c.label, enabled: c.enabled, reason: c.reason,
    }));
  }
  return route.actions(ctx).map((a) => ({ enabled: true, ...a }));
}

// One player action. `action` is an action object from availableActions (or
// just its id). Extra fields on it are passed to the route as parameters
// (for example player-chosen names on the start action).
export function step(route, state, action) {
  const id = typeof action === "string" ? action : action?.id;
  const offered = availableActions(route, state).find((a) => a.id === id);
  if (!offered) return { state, beats: [{ type: "error", message: `That cannot be done now (${id}).` }] };
  if (offered.enabled === false) return { state, beats: [{ type: "error", message: offered.reason ?? "That cannot be done now." }] };
  const s = clone(state);
  const ctx = makeCtx(route, s);
  s.decisions += 1;
  if (offered.type === "choose") deck.resolveChoice(ctx, offered.choice);
  else route.act(ctx, offered, typeof action === "object" ? action : {});
  if (!s.over) route.afterAction?.(ctx);
  checkEnd(ctx);
  return { state: s, beats: ctx.beats };
}

export function view(route, state) {
  return route.view ? route.view(state) : {};
}
