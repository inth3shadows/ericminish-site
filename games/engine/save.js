// Versioned save/load. One named slot plus an autosave slot per route.
// localStorage can be missing or throw (private mode, blocked storage), so
// every access is wrapped and failure is reported, never thrown.

import { availableActions } from "./engine.js";
import { isPlainJSON, SCHEMA_VERSION } from "./state.js";

export const SAVE_FORMAT = 1;
export const SLOTS = ["main", "auto"];

const key = (routeId, slot) => `trail:${routeId}:${slot}`;

export function defaultStorage() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = "trail:probe";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function serialize(state) {
  return JSON.stringify({ format: SAVE_FORMAT, schemaVersion: state.schemaVersion, routeId: state.routeId, routeVersion: state.routeVersion, state });
}

// -> {ok: true, state} | {ok: false, reason}
export function deserialize(route, text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  if (!doc || doc.format !== SAVE_FORMAT || !doc.state) return { ok: false, reason: "unknown format" };
  if (doc.routeId !== route.id) return { ok: false, reason: "different route" };
  if (doc.schemaVersion !== SCHEMA_VERSION) return { ok: false, reason: "old engine version" };
  let state = doc.state;
  if (doc.routeVersion !== route.version) {
    if (!route.migrate) return { ok: false, reason: "old route version" };
    try {
      state = route.migrate(state, doc.routeVersion);
    } catch {
      return { ok: false, reason: "migration failed" };
    }
    if (!state) return { ok: false, reason: "old route version" };
  }
  if (!readable(route, state)) return { ok: false, reason: "damaged" };
  return { ok: true, state };
}

const isObj = (x) => x != null && typeof x === "object" && !Array.isArray(x);

// The engine's own fields have the right shapes, and the route can read the
// rest: its view and its actions run without throwing. A state that fails here
// would break the UI the moment it was shown.
function readable(route, s) {
  if (!isObj(s) || !isPlainJSON(s)) return false;
  const shaped = s.schemaVersion === SCHEMA_VERSION && s.routeId === route.id
    && typeof s.seed === "string" && typeof s.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date)
    && Number.isInteger(s.day) && Number.isInteger(s.decisions)
    && isObj(s.rng) && Number.isInteger(s.rng.s) && Number.isInteger(s.rng.n)
    && isObj(s.flags) && isObj(s.res) && isObj(s.vars)
    && isObj(s.events) && isObj(s.events.seen) && isObj(s.events.last)
    && (s.pending === null || (isObj(s.pending) && typeof s.pending.id === "string"))
    && (s.queue === undefined || (Array.isArray(s.queue) && s.queue.every((q) => queueItemOk(route, q))))
    && (s.over === null || isObj(s.over));
  if (!shaped) return false;
  try {
    if (route.readable && !route.readable(s)) return false;
    availableActions(route, s);
    route.view?.(s);
    return true;
  } catch {
    return false;
  }
}

// A queued event the route knows, waiting either for a day (due) or for a place (at).
function queueItemOk(route, q) {
  if (!isObj(q) || typeof q.event !== "string") return false;
  if (!(route.eventIndex?.has(q.event) ?? route.events?.some((e) => e.id === q.event))) return false;
  const byDay = Number.isInteger(q.due);
  const byPlace = typeof q.at === "string" && (!route.places || route.places.includes(q.at));
  return byDay !== byPlace && (byDay ? q.at === undefined : q.due === undefined);
}

function checkSlot(slot) {
  if (!SLOTS.includes(slot)) throw new Error(`unknown save slot: ${slot}`);
}

export function saveGame(state, { slot = "auto", storage = defaultStorage() } = {}) {
  checkSlot(slot);
  if (!storage) return false;
  try {
    storage.setItem(key(state.routeId, slot), serialize(state));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(route, { slot = "auto", storage = defaultStorage() } = {}) {
  checkSlot(slot);
  if (!storage) return { ok: false, reason: "no storage" };
  let text;
  try {
    text = storage.getItem(key(route.id, slot));
  } catch {
    return { ok: false, reason: "no storage" };
  }
  if (text == null) return { ok: false, reason: "empty" };
  return deserialize(route, text);
}

export function hasSave(routeId, { slot = "auto", storage = defaultStorage() } = {}) {
  if (!storage) return false;
  try {
    return storage.getItem(key(routeId, slot)) != null;
  } catch {
    return false;
  }
}

export function clearSave(routeId, { slot = "auto", storage = defaultStorage() } = {}) {
  if (!storage) return false;
  try {
    storage.removeItem(key(routeId, slot));
    return true;
  } catch {
    return false;
  }
}
