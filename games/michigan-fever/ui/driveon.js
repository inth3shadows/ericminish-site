// "Drive on": repeat routine travel days until something needs the player.
// A loop over the engine's own step() with the plain "go" action, so it adds
// no rules: the result is exactly what pressing "go" that many times gives.
// DOM-free, so node tests can check it never runs past a beat that needs input
// (test/driveon.test.mjs).

export const MAX_DAYS = 30;
export const LOW_FOOD_DAYS = 3;
export const LOW_MONEY = 500; // cents, valued where the family is
export const WEAK = 35; // health below this is "very weak"
export const DEADLINE_MARKS = [30, 14, 7]; // stop once when the days left cross one

// Beats that always hand control back to the player.
const STOP_BEATS = new Set(["event", "choice", "arrive", "death", "letter", "note", "end", "error", "scene"]);
// Narration cues that do.
const STOP_CUES = new Set(["illness", "broken", "grief", "conflict", "ready"]);

function goAction(engine, route, state) {
  if (state.over || state.pending || state.phase !== "travel") return null;
  return engine.availableActions(route, state).find((a) => a.id === "go" && a.type === "travel") ?? null;
}

// Conditions that need the player right now, whatever happened before.
// Low food does not count while the passage itself feeds the family (packet, cabin).
// "tired": anyone, or the team, at the route's high-fatigue mark (view.fatigue.high).
// Not aboard a canal boat or a steamer: a day on the boat brings fatigue down.
const RESTING_MODES = new Set(["canal", "steamer"]);
function hazard(v) {
  if (v.food.days <= LOW_FOOD_DAYS && !v.food.meals) return "food";
  if (v.purse.valueHere < LOW_MONEY) return "money";
  if (v.party.some((p) => p.status === "sick" && p.health < WEAK)) return "weak";
  if (worn(v) && !RESTING_MODES.has(v.travel?.mode)) return "tired";
  return null;
}

function worn(v) {
  const high = v.fatigue?.high;
  if (high == null) return false;
  return v.party.some((p) => p.status !== "dead" && (p.fatigue ?? 0) >= high) || (v.gear?.team && (v.gear.fatigue ?? 0) >= high);
}

// Can the player drive on from here? -> { ok, reason? }
export function canDriveOn(engine, route, state) {
  const go = goAction(engine, route, state);
  if (!go || go.enabled === false) return { ok: false, reason: "Nothing to drive on to." };
  const h = hazard(engine.view(route, state));
  if (h === "food") return { ok: false, reason: "Not with food this low." };
  if (h === "money") return { ok: false, reason: "Not with money this low." };
  if (h === "weak") return { ok: false, reason: "Not while someone is this ill." };
  if (h === "tired") return { ok: false, reason: "Not while the family is this worn out." };
  return { ok: true };
}

// Why did a day end the drive? null means keep going.
export function stopReason(beats, before, after, state) {
  if (state.over) return "end";
  if (state.pending) return "choice";
  if (state.phase !== "travel") return "arrived";
  for (const b of beats) {
    if (STOP_BEATS.has(b.type)) return b.type;
    if (b.type === "narrate" && STOP_CUES.has(b.cue)) return b.cue;
    if (b.type === "weather" && b.first) return "first-snow";
  }
  const h = hazard(after);
  if (h) return h;
  for (const mark of DEADLINE_MARKS) {
    if (before.deadline.daysLeft > mark && after.deadline.daysLeft <= mark) return "deadline";
  }
  return null;
}

// -> { state, days: [{ beats, state, view }], reason }
// The last day carries the beats that need the player; the UI plays those in full.
// `pace` (optional) rides on every day's "go", as the UI's pace control sends it;
// without it the family keeps the pace it has.
export function driveOn(engine, route, state, { maxDays = MAX_DAYS, pace = null } = {}) {
  const days = [];
  let s = state;
  let reason = "limit";
  if (!canDriveOn(engine, route, s).ok) return { state: s, days, reason: "not-allowed" };
  for (let i = 0; i < maxDays; i++) {
    const go = goAction(engine, route, s);
    if (!go || go.enabled === false) {
      reason = "no-go";
      break;
    }
    const before = engine.view(route, s);
    const r = engine.step(route, s, pace ? { ...go, pace } : go);
    s = r.state;
    const after = engine.view(route, s);
    days.push({ beats: r.beats, state: s, view: after });
    const why = stopReason(r.beats, before, after, s);
    if (why) {
      reason = why;
      break;
    }
  }
  return { state: s, days, reason };
}
