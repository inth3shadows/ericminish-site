// Small localStorage wrapper for UI-only preferences and the scene memory that
// goes with a save. Storage can be missing or throw (private mode, blocked site
// data), so every access is wrapped and the game works without it.

export function get(key, fallback = null) {
  try {
    const v = globalThis.localStorage?.getItem(key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

export function set(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function remove(key) {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* storage unavailable: nothing to remove */
  }
}

export function getJSON(key, fallback = null) {
  const raw = get(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function setJSON(key, value) {
  return set(key, JSON.stringify(value));
}

export const KEYS = {
  muted: "mf:ui:muted",
  meta: "trail:michigan-fever:ui", // scene, time of day, last line, pending event, history notes
};
