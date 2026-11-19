// Game state is one plain JSON object. The engine owns the fields below; a
// route adds its own (party, purse, convoy, ...) beside them.

import { createRng } from "./rng.js";

export const SCHEMA_VERSION = 1;

export function createState({ routeId, routeVersion, seed, date }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    routeId,
    routeVersion,
    seed: String(seed),
    rng: createRng(seed),
    date,          // ISO calendar date
    day: 0,        // days elapsed since the start
    decisions: 0,  // player actions taken
    phase: null,   // route-defined phase name
    leg: null,     // route-defined journey leg
    place: null,   // route-defined place id
    flags: {},     // name -> true
    res: {},       // generic numeric resources (food, morale, ...)
    vars: {},      // route scratch values
    events: { seen: {}, last: {} },  // id -> times seen; id -> day last seen
    pending: null, // {kind: "event", id, vars} while a choice is open
    over: null,    // the end record once the game has ended
  };
}

export const clone = (s) => (typeof structuredClone === "function" ? structuredClone(s) : JSON.parse(JSON.stringify(s)));

export function getPath(obj, path) {
  return String(path).split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = String(path).split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== "object") o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}

// True when value survives JSON.stringify/parse unchanged (no undefined,
// functions, NaN, Infinity, Map, class instances).
export function isPlainJSON(value) {
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "boolean") return true;
  if (t === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isPlainJSON);
  if (t === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(value).every(isPlainJSON);
  }
  return false;
}
