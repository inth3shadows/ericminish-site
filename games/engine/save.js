// Versioned save/load. One named slot plus an autosave slot per route.
// localStorage can be missing or throw (private mode, blocked storage), so
// every access is wrapped and failure is reported, never thrown.

import { SCHEMA_VERSION } from "./state.js";

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
  return { ok: true, state };
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
