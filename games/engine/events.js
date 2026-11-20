// Data-driven event deck and the declarative condition/effect interpreter.
// No JS in data, no eval: every condition and effect is a one-key object whose
// key names an operation. Core operations live here; a route adds its own
// through route.conditions, route.effects and route.binders.
//
// Values inside conditions and effects may be:
//   "#id"   a number from the route's numbers table (route.num)
//   "$name" a variable bound for this event (see "bind")
//   a literal

import { compare, dayOfWeek, month, season } from "./clock.js";
import { getPath } from "./state.js";

const OPS = {
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
};

export function compareOp(a, op, b) {
  const f = OPS[op];
  if (!f) throw new Error(`unknown comparison: ${op}`);
  return f(a, b);
}

export function resolve(v, ctx, vars = {}) {
  if (typeof v === "string") {
    if (v.startsWith("#")) return ctx.num(v.slice(1));
    if (v.startsWith("$")) return vars[v.slice(1)];
  }
  return v;
}

const list = (x) => (Array.isArray(x) ? x : [x]);

export const CORE_CONDITIONS = new Set(["all", "any", "not", "flag", "leg", "place", "phase", "month",
  "before", "onOrAfter", "season", "dow", "res", "cmp", "seen", "chance", "bound"]);

export function evalCond(cond, ctx, vars = {}) {
  if (cond == null || cond === true) return true;
  if (cond === false) return false;
  if (Array.isArray(cond)) return cond.every((c) => evalCond(c, ctx, vars));
  const keys = Object.keys(cond);
  if (keys.length !== 1) throw new Error(`a condition has exactly one key: ${JSON.stringify(cond)}`);
  const [k] = keys;
  const arg = cond[k];
  const s = ctx.state;
  switch (k) {
    case "all": return arg.every((c) => evalCond(c, ctx, vars));
    case "any": return arg.some((c) => evalCond(c, ctx, vars));
    case "not": return !evalCond(arg, ctx, vars);
    case "flag": {
      const neg = arg.startsWith("!");
      return Boolean(s.flags[neg ? arg.slice(1) : arg]) !== neg;
    }
    case "leg": return list(arg).includes(s.leg);
    case "place": return list(arg).includes(s.place);
    case "phase": return list(arg).includes(s.phase);
    case "month": return list(arg).includes(month(s.date));
    case "before": return compare(s.date, resolve(arg, ctx, vars)) < 0;
    case "onOrAfter": return compare(s.date, resolve(arg, ctx, vars)) >= 0;
    case "season": return list(arg).includes(season(s.date));
    case "dow": return list(arg).includes(dayOfWeek(s.date));
    case "res": {
      const [name, op, val] = arg;
      return compareOp(s.res[name] ?? 0, op, resolve(val, ctx, vars));
    }
    case "cmp": {
      const [path, op, val] = arg;
      return compareOp(getPath(s, path), op, resolve(val, ctx, vars));
    }
    case "seen": return (s.events.seen[arg] ?? 0) > 0;
    case "chance": return ctx.rng.chance(resolve(arg, ctx, vars));
    case "bound": return vars[arg] != null;
    default: {
      const f = ctx.route.conditions?.[k];
      if (!f) throw new Error(`unknown condition: ${k}`);
      return Boolean(f(arg, ctx, vars));
    }
  }
}

export const CORE_EFFECTS = new Set(["add", "set", "flag", "days", "narrate", "chance", "if", "event", "scene", "schedule"]);
// Keys beside an effect's operation: the branches, and "as" (the kind of day a
// "days" effect spends, passed to route.eventDay).
const BRANCH_KEYS = new Set(["then", "else", "as"]);

export function effectOp(e) {
  const k = Object.keys(e).filter((x) => !BRANCH_KEYS.has(x));
  if (k.length !== 1) throw new Error(`an effect has exactly one operation key: ${JSON.stringify(e)}`);
  return k[0];
}

export function addRes(ctx, name, amount) {
  const s = ctx.state;
  const [lo, hi] = ctx.route.limits?.[name] ?? [0, Infinity];
  s.res[name] = Math.min(hi, Math.max(lo, (s.res[name] ?? 0) + amount));
}

export function applyEffects(effects, ctx, vars = {}) {
  for (const e of effects ?? []) {
    if (ctx.state.over) return;
    applyEffect(e, ctx, vars);
  }
}

function applyEffect(e, ctx, vars) {
  const k = effectOp(e);
  const arg = e[k];
  const s = ctx.state;
  switch (k) {
    case "add": addRes(ctx, arg[0], resolve(arg[1], ctx, vars)); return;
    case "set": s.res[arg[0]] = resolve(arg[1], ctx, vars); return;
    case "flag": {
      const neg = arg.startsWith("!");
      const name = neg ? arg.slice(1) : arg;
      if (neg) delete s.flags[name]; else s.flags[name] = true;
      return;
    }
    case "days": {
      // A route that keeps per-day conditions sets each day's own before it passes,
      // so the day does not inherit the conditions of the action that came before.
      const n = resolve(arg, ctx, vars);
      if (!ctx.route.eventDay) { ctx.advanceDays(n); return; }
      for (let i = 0; i < n && !s.over; i++) {
        ctx.route.eventDay(ctx, e.as, vars);
        ctx.advanceDays(1);
      }
      return;
    }
    case "narrate": ctx.emit({ type: "narrate", text: ctx.text(arg, vars) }); return;
    case "chance":
      applyEffects(ctx.rng.chance(resolve(arg, ctx, vars)) ? e.then : e.else, ctx, vars);
      return;
    case "if":
      applyEffects(evalCond(arg, ctx, vars) ? e.then : e.else, ctx, vars);
      return;
    case "event": ctx.queueEvent(arg, vars); return;
    case "scene": ctx.emit({ type: "scene", scene: arg }); return;
    case "schedule": schedule(ctx, arg, vars); return;
    default: {
      const f = ctx.route.effects?.[k];
      if (!f) throw new Error(`unknown effect: ${k}`);
      f(arg, ctx, vars);
    }
  }
}

// ---- scheduled events ---------------------------------------------------------
// {"schedule": {"event": id, "in": days | {"at": place}, "unless"?: cond}}
// queues an event in state.queue. It comes due after that many days, or once
// the family is at the place; the next time the route asks for an event (or
// calls ctx.fireDue) it fires ahead of the random draw. If "unless" holds by
// then, it is dropped. An event whose "when" fails, or whose binders find
// nobody, waits in the queue. The same event is never queued twice at once.

export function schedule(ctx, spec, vars = {}) {
  const s = ctx.state;
  s.queue ??= [];
  if (s.queue.some((q) => q.event === spec.event)) return;
  const item = { event: spec.event };
  if (spec.in && typeof spec.in === "object") item.at = spec.in.at;
  else item.due = s.day + resolve(spec.in, ctx, vars);
  if (spec.unless != null) item.unless = spec.unless;
  s.queue.push(item);
}

function atPlace(ctx) {
  return ctx.route.atPlace ? ctx.route.atPlace(ctx.state) : ctx.state.place;
}

// Fire the first due scheduled event. Returns true when one started.
// {atOnly: true} considers only the items waiting for a place (an arrival),
// so a route can fire every one of them at a town in turn.
export function fireDue(ctx, { atOnly = false } = {}) {
  const s = ctx.state;
  if (!s.queue?.length || s.pending || s.over) return false;
  const here = atPlace(ctx);
  for (let i = 0; i < s.queue.length; i++) {
    const q = s.queue[i];
    if (q.unless != null && evalCond(q.unless, ctx)) {
      s.queue.splice(i--, 1);
      continue;
    }
    if (atOnly && q.at == null) continue;
    const due = q.at != null ? here === q.at : s.day >= q.due;
    if (!due) continue;
    const ev = eventById(ctx.route, q.event);
    if (!evalCond(ev.when, ctx)) continue;
    const v = bindVars(ev, ctx);
    if (!v) continue;
    s.queue.splice(i, 1);
    startEvent(ctx, ev, v);
    return true;
  }
  return false;
}

// ---- the deck ---------------------------------------------------------------

export function eventById(route, id) {
  const ev = route.eventIndex?.get(id) ?? route.events.find((x) => x.id === id);
  if (!ev) throw new Error(`unknown event: ${id}`);
  return ev;
}

export function eligible(ev, ctx) {
  const s = ctx.state;
  const seen = s.events.seen[ev.id] ?? 0;
  if (ev.once && seen > 0) return false;
  if (ev.cooldown != null && s.events.last[ev.id] != null
    && s.day - s.events.last[ev.id] < resolve(ev.cooldown, ctx)) return false;
  return evalCond(ev.when, ctx);
}

// weight: a number, or {base, mul?: [[cond, mult], ...], scale?: name}. A scale
// is a route curve (route.scales[name](ctx)) for odds that rise smoothly.
export function weightOf(ev, ctx) {
  const w = ev.weight ?? 1;
  if (typeof w !== "object" || w === null) return resolve(w, ctx);
  let x = resolve(w.base, ctx);
  for (const [cond, mult] of w.mul ?? []) if (evalCond(cond, ctx)) x *= resolve(mult, ctx);
  if (w.scale != null) {
    const f = ctx.route.scales?.[w.scale];
    if (!f) throw new Error(`unknown weight scale: ${w.scale}`);
    x *= f(ctx);
  }
  return x;
}

// Bind event variables. Returns null when a binder finds nothing (the event
// cannot happen now).
export function bindVars(ev, ctx, inherited = {}) {
  const vars = { ...inherited };
  for (const [name, spec] of Object.entries(ev.bind ?? {})) {
    if (vars[name] != null) continue;
    const [k] = Object.keys(spec);
    const f = ctx.route.binders?.[k];
    if (!f) throw new Error(`unknown binder: ${k}`);
    const v = f(spec[k], ctx);
    if (v == null) return null;
    vars[name] = v;
  }
  return vars;
}

// Draw one event from a deck. Returns true when an event started.
export function drawEvent(ctx, deck) {
  const pool = [];
  for (const ev of ctx.route.events) {
    if (ev.deck !== deck || !eligible(ev, ctx)) continue;
    const w = weightOf(ev, ctx);
    if (w > 0) pool.push([w, ev]);
  }
  while (pool.length) {
    const ev = ctx.rng.weighted(pool);
    const vars = bindVars(ev, ctx);
    if (vars) {
      startEvent(ctx, ev, vars);
      return true;
    }
    pool.splice(pool.findIndex(([, e]) => e === ev), 1);
  }
  return false;
}

// A choice with "only" is offered only while that condition holds; one with
// "requires" is shown but disabled (with "why") while it fails.
export function choiceList(ev, ctx, vars) {
  return (ev.choices ?? []).filter((c) => c.only == null || evalCond(c.only, ctx, vars)).map((c) => {
    const ok = evalCond(c.requires, ctx, vars);
    return { id: c.id, label: ctx.text(c.label, vars), enabled: ok, reason: ok ? undefined : (c.why ? ctx.text(c.why, vars) : "Not possible now") };
  });
}

export function startEvent(ctx, evOrId, vars = {}) {
  const ev = typeof evOrId === "string" ? eventById(ctx.route, evOrId) : evOrId;
  const s = ctx.state;
  s.events.seen[ev.id] = (s.events.seen[ev.id] ?? 0) + 1;
  s.events.last[ev.id] = s.day;
  if (ev.scene) ctx.emit({ type: "scene", scene: ev.scene });
  ctx.emit({ type: "event", id: ev.id, title: ev.title ? ctx.text(ev.title, vars) : undefined, text: ctx.text(ev.text, vars) });
  if (ev.choices?.length) {
    s.pending = { kind: "event", id: ev.id, vars };
    ctx.emit({ type: "choice", event: ev.id, choices: choiceList(ev, ctx, vars) });
  } else {
    applyEffects(ev.effects, ctx, vars);
    emitNote(ctx, ev);
  }
}

export function emitNote(ctx, ev) {
  if (!ev.note) return;
  const { text, source, url, confidence } = ev.note;
  ctx.emit({ type: "note", event: ev.id, text, source, url, confidence });
}

export function resolveChoice(ctx, choiceId) {
  const s = ctx.state;
  const { id, vars } = s.pending;
  const ev = eventById(ctx.route, id);
  const c = ev.choices.find((x) => x.id === choiceId);
  s.pending = null;
  ctx.emit({ type: "narrate", text: ctx.text(c.label, vars), chosen: true });
  applyEffects(c.effects, ctx, vars);
  if (s.over) return;
  if (c.result) ctx.emit({ type: "narrate", text: ctx.text(c.result, vars) });
  emitNote(ctx, ev);
  if (c.next && !s.pending) {
    // The next event binds its own variables fresh (a menu that comes back
    // shows what is left now); it inherits only the others.
    const next = eventById(ctx.route, c.next);
    const own = new Set(Object.keys(next.bind ?? {}));
    const nextVars = bindVars(next, ctx, Object.fromEntries(Object.entries(vars).filter(([k]) => !own.has(k))));
    if (nextVars) startEvent(ctx, next, nextVars);
  }
}

// ---- validation (used by tests and by a route at load time) -----------------

function walkCond(cond, route, errs, where) {
  if (cond == null || typeof cond === "boolean") return;
  if (Array.isArray(cond)) { cond.forEach((c) => walkCond(c, route, errs, where)); return; }
  const keys = Object.keys(cond);
  if (keys.length !== 1) { errs.push(`${where}: condition with ${keys.length} keys`); return; }
  const [k] = keys;
  if (!CORE_CONDITIONS.has(k) && !route.conditions?.[k]) errs.push(`${where}: unknown condition ${k}`);
  if (k === "all" || k === "any") cond[k].forEach((c) => walkCond(c, route, errs, where));
  if (k === "not") walkCond(cond[k], route, errs, where);
}

function walkEffects(effects, route, errs, where) {
  for (const e of effects ?? []) {
    let k;
    try { k = effectOp(e); } catch (err) { errs.push(`${where}: ${err.message}`); continue; }
    if (!CORE_EFFECTS.has(k) && !route.effects?.[k]) errs.push(`${where}: unknown effect ${k}`);
    // "as" is the kind of day a "days" effect spends. With an eventDay hook the
    // route needs one it knows (route.eventDayKinds), or step() throws mid-game.
    if (k !== "days" && "as" in e) errs.push(`${where}: "as" belongs on a days effect, not on ${k}`);
    if (k === "days" && route.eventDay) {
      const kinds = route.eventDayKinds ?? [];
      if (e.as == null) errs.push(`${where}: days needs an "as" (one of ${kinds.join(", ")})`);
      else if (!kinds.includes(e.as)) errs.push(`${where}: days with unknown "as" ${JSON.stringify(e.as)} (one of ${kinds.join(", ")})`);
    }
    if (k === "if") walkCond(e.if, route, errs, where);
    if (k === "event" && !route.events.some((x) => x.id === e.event)) errs.push(`${where}: unknown event ${e.event}`);
    if (k === "schedule") walkSchedule(e.schedule, route, errs, where);
    walkEffects(e.then, route, errs, where);
    walkEffects(e.else, route, errs, where);
  }
}

function walkSchedule(spec, route, errs, where) {
  if (!spec || typeof spec !== "object") { errs.push(`${where}: schedule needs {event, in}`); return; }
  if (!route.events.some((x) => x.id === spec.event)) errs.push(`${where}: schedule: unknown event ${spec.event}`);
  const n = spec.in;
  const days = typeof n === "number" || (typeof n === "string" && n.startsWith("#"));
  const at = n && typeof n === "object" && !Array.isArray(n) && typeof n.at === "string" && Object.keys(n).length === 1;
  if (!days && !at) errs.push(`${where}: schedule: "in" must be days or {at: place}`);
  if (at && route.places && !route.places.includes(n.at)) errs.push(`${where}: schedule: unknown place ${n.at}`);
  walkCond(spec.unless, route, errs, where);
}

function walkRefs(node, route, errs, where) {
  if (typeof node === "string" && node.startsWith("#")) {
    try { route.num(node.slice(1)); } catch { errs.push(`${where}: unknown number ${node}`); }
  } else if (Array.isArray(node)) node.forEach((n) => walkRefs(n, route, errs, where));
  else if (node && typeof node === "object") Object.values(node).forEach((n) => walkRefs(n, route, errs, where));
}

export function validateDeck(route) {
  const errs = [];
  const ids = new Set();
  for (const ev of route.events) {
    const where = `event ${ev.id}`;
    if (!ev.id) errs.push("event without id");
    if (ids.has(ev.id)) errs.push(`${where}: duplicate id`);
    ids.add(ev.id);
    if (!ev.deck) errs.push(`${where}: no deck`);
    if (!ev.text) errs.push(`${where}: no text`);
    walkCond(ev.when, route, errs, where);
    if (ev.weight && typeof ev.weight === "object") {
      for (const [cond] of ev.weight.mul ?? []) walkCond(cond, route, errs, where);
      if (ev.weight.scale != null && !route.scales?.[ev.weight.scale]) errs.push(`${where}: unknown weight scale ${ev.weight.scale}`);
    }
    walkEffects(ev.effects, route, errs, where);
    for (const [name, spec] of Object.entries(ev.bind ?? {})) {
      const [k] = Object.keys(spec);
      if (!route.binders?.[k]) errs.push(`${where}: unknown binder ${k} for ${name}`);
    }
    const choices = ev.choices ?? [];
    if (choices.length && !choices.some((c) => c.requires == null && c.only == null)) errs.push(`${where}: every choice has a requirement (possible dead end)`);
    const cids = new Set();
    for (const c of choices) {
      if (cids.has(c.id)) errs.push(`${where}: duplicate choice ${c.id}`);
      cids.add(c.id);
      if (!c.label) errs.push(`${where}.${c.id}: no label`);
      walkCond(c.requires, route, errs, `${where}.${c.id}`);
      walkCond(c.only, route, errs, `${where}.${c.id}`);
      walkEffects(c.effects, route, errs, `${where}.${c.id}`);
      if (c.next && !route.events.some((x) => x.id === c.next)) errs.push(`${where}.${c.id}: unknown next ${c.next}`);
    }
    walkRefs(ev, route, errs, where);
  }
  // Schedules a route keeps outside the deck (route.schedules: [{where, spec}]) get the same checks.
  for (const { where, spec } of route.schedules ?? []) {
    walkSchedule(spec, route, errs, where);
    walkRefs(spec, route, errs, where);
  }
  return errs;
}
