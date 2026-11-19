// Michigan Fever: the player-facing shell. The engine (route.js, engine.js)
// owns every rule, number and line of story; this file only renders beats,
// paces them as subtitles over the scene, and sends back the player's choice.

import { loadRoute, SCENES } from "../route.js";
import * as ENGINE from "../../engine/engine.js";
import { newGame, step, availableActions, view } from "../../engine/engine.js";
import { saveGame, loadGame } from "../../engine/save.js";
import { money } from "../mechanics/purse.js";
import { createScene, artFor } from "./scene.js";
import { createAtmos } from "./atmos.js";
import { createAmbience, mixFor } from "./audio.js";
import { createHud, shortDate } from "./hud.js";
import { arrange, render as renderActions } from "./actions.js";
import { el, icon, wait } from "./dom.js";
import * as store from "./store.js";
import { canDriveOn, driveOn } from "./driveon.js";
import { resumeText } from "./resume.js";
import { Cancelled, createJourneys, quiet } from "./journey.js";

const root = document.getElementById("game");
const reducedMq = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
const reduced = () => Boolean(reducedMq?.matches);
const params = new URLSearchParams(location.search);

const LEG_SCENE = { vermont: "road-vermont", canal: "canal", lake: "lake", overland: "ohio-road", road: "territorial-road", claim: "claim-track" };
const TERRAIN_SCENE = { swamp: "black-swamp", strip: "toledo-strip" };
const CONFIDENCE = { solid: "Well sourced", likely: "Likely", uncertain: "Uncertain", invented: "Invented for the game" };
const NOTE_LABEL = "What really happened"; // rendered from JS: lint-copy reads only the HTML

// ---------------------------------------------------------------- the stage

root.replaceChildren();
root.classList.add("mf-ready");
root.setAttribute("tabindex", "-1");

const sceneEl = el("div", { class: "mf-scene" });
const ui = el("div", { class: "mf-ui" });
const aiLabel = el("p", { class: "mf-ai-label" }, "AI-generated illustration");
const card = el("div", { class: "mf-card", "aria-live": "polite" });
const bottom = el("div", { class: "mf-bottom" });
const line = el("div", { class: "mf-line", "aria-live": "polite" });
const actionsBox = el("div", { class: "mf-actions", role: "group", "aria-label": "What will you do?" });
const foot = el("div", { class: "mf-foot" });
const noteBtn = el("button", { class: "mf-note-btn", type: "button", hidden: true }, NOTE_LABEL);
const contBtn = el("button", { class: "mf-continue", type: "button", hidden: true, "aria-label": "Continue (Space)" }, el("span", {}, "Continue"), el("span", { class: "mf-key", "aria-hidden": "true" }, "Space"));
foot.append(noteBtn, contBtn);
bottom.append(line, actionsBox, foot);
const veil = el("div", { class: "mf-veil", hidden: true, role: "dialog", "aria-modal": "true", "aria-label": "A death in the family" });
const drawer = el("aside", { class: "mf-drawer", hidden: true, "aria-label": NOTE_LABEL });
const menu = el("div", { class: "mf-menu", hidden: true, role: "dialog", "aria-modal": "true", "aria-label": "Menu" });
const toastEl = el("p", { class: "mf-toast", role: "status", hidden: true });
ui.append(card, bottom, aiLabel, veil, drawer, menu, toastEl);
root.append(sceneEl, ui);

const scene = createScene(sceneEl, { reduced, describe: (k) => SCENES[k] ?? "" });
const atmos = createAtmos(sceneEl, { reduced });
const audio = createAmbience();
const hud = createHud(ui, {
  onSound: () => setMuted(!audio.muted()),
  onFullscreen: () => toggleFullscreen(),
  onMenu: () => openMenu(),
});
hud.setSound(audio.muted());
// The view toggle: leave the full-window view for the site page, or go back in.
const viewBtn = el("button", { class: "mf-icon", type: "button" }, icon("exit"));
hud.right.querySelector(".mf-tools").prepend(viewBtn);
viewBtn.addEventListener("click", () => setImmersive(!document.documentElement.classList.contains("mf-immersive")));

// ---------------------------------------------------------------- game state

let route = null;
let state = null;
let sceneKey = "farm";
let tod = "dawn";
let weather = { weather: "fair", terrain: null };
let lastLine = "";
let pendingEvent = null;
let notes = [];
let latestNote = null;
let noteAge = 0;
let busy = false;
let said = false;
let buttons = [];
let groupStack = [];
let topItems = [];
let lightTimer = 0;
let shownAt = 0; // when the current buttons appeared: a Space meant for the narration must not pick one
// Which journey is on screen (ui/journey.js). Every awaited step of the
// playback chain (scene changes, pauses, the player's Continue, the veil) goes
// through the journey that started it. begin() cancels the one before, so a
// play(), a drive-on lapse or a light change still running from it stops at
// its next await, writing nothing: no state, no notes, no autosave.
const journeys = createJourneys();

// ---------------------------------------------------------------- scene + sound

function storm() {
  return sceneKey === "lake-storm";
}

async function applyScene(j) {
  j.check();
  const art = artFor(sceneKey, tod) ?? scene.current() ?? "02-road-to-albany";
  await j.settle(scene.show(art, sceneKey));
  atmos.setLight(tod, scene.mood());
  atmos.setWeather(weather.weather, { terrain: weather.terrain, storm: storm() });
  const v = state && state.phase !== "start" ? view(route, state) : null;
  audio.mix(mixFor(sceneKey, { tod, weather: weather.weather, storm: storm(), snow: v?.snow, artId: scene.current() }));
}

function setLight(j, next) {
  j.check();
  clearTimeout(lightTimer);
  const prev = tod;
  tod = next;
  // Breaking camp after a night: a little dawn light first, then the day.
  if (prev === "night" && next === "day") {
    tod = "dawn";
    lightTimer = setTimeout(() => {
      if (!j.live) return;
      tod = "day";
      quiet(applyScene(j));
    }, reduced() ? 0 : 4200);
  }
  return applyScene(j);
}

// The engine has days, not hours, so the light is the UI's own reading of
// what the family did: resting means evening and night, setting out means
// morning. Every third day on the canal is shown at night, because the boats
// ran through the night and the lock painting belongs there.
function todFor(action, s) {
  if (action.type === "start") return "dawn";
  if (action.type === "rest") return "night";
  if (action.type === "travel" && s.phase === "travel" && s.leg === "canal" && s.day % 3 === 0) return "night";
  return "day";
}

function guessScene(v) {
  if (v.phase === "office") return "land-office";
  if (v.phase === "claim") return v.land.shelter > 0 ? "cabin" : "claim";
  if (v.phase === "town") return `town-${v.place}`;
  if (v.travel) return TERRAIN_SCENE[v.travel.terrain] ?? LEG_SCENE[v.travel.leg] ?? "road-vermont";
  return "farm";
}

// ---------------------------------------------------------------- subtitles

let revealTimer = 0;

function setLine(text, { title = null, kind = "narrate", cue = null, animate = true } = {}) {
  clearTimeout(revealTimer);
  const words = String(text).split(/(\s+)/);
  const p = el("p", { class: `mf-text${kind === "event" ? " is-event" : ""}${cue ? ` cue-${cue}` : ""}` });
  const total = Math.min(2600, Math.max(450, text.length * 17));
  const per = words.length > 1 ? total / words.length : 0;
  words.forEach((w, i) => {
    if (/^\s+$/.test(w)) p.append(document.createTextNode(w));
    else {
      const s = el("span", { class: "mf-w" }, w);
      s.style.animationDelay = `${Math.round(i * per)}ms`;
      p.append(s);
    }
  });
  const nodes = [];
  if (title) nodes.push(el("p", { class: "mf-title-line" }, title));
  nodes.push(p);
  line.replaceChildren(...nodes);
  line.classList.remove("is-done", "is-dim");
  if (!animate || reduced()) {
    line.classList.add("is-done");
    line.dataset.revealing = "";
    return;
  }
  line.dataset.revealing = "1";
  revealTimer = setTimeout(() => {
    line.dataset.revealing = "";
    line.classList.add("is-done");
  }, total + 500);
}

function finishReveal() {
  clearTimeout(revealTimer);
  line.dataset.revealing = "";
  line.classList.add("is-done");
}

// Waits for the player's Continue, for journey j only.
function advance(j) {
  j.check();
  contBtn.hidden = false;
  if (menu.hidden && drawer.hidden && !(document.activeElement instanceof HTMLInputElement)) contBtn.focus({ preventScroll: true });
  return j.wait();
}

function onAdvance() {
  if (lapseStop) {
    lapseStop();
    return true;
  }
  if (line.dataset.revealing) {
    finishReveal();
    return true;
  }
  if (veil.dataset.revealing) {
    clearTimeout(veilTimer);
    veil.dataset.revealing = "";
    veil.classList.add("is-done");
    return true;
  }
  if (!journeys.waiting()) return false; // only the current journey's Continue is ever resolved
  contBtn.hidden = true;
  journeys.advance();
  return true;
}

async function say(j, text, opts = {}) {
  j.check();
  said = true;
  lastLine = text;
  setLine(text, opts);
  await advance(j);
}

contBtn.addEventListener("click", () => onAdvance());

// A click on the open scene (not on a control) advances the narration.
ui.addEventListener("click", (e) => {
  audio.unlock();
  if (e.target.closest("button, a, input, label, .mf-drawer, .mf-sheet, .mf-menu, .mf-hud, .mf-actions")) return;
  onAdvance();
});

// ---------------------------------------------------------------- history notes

function addNote(j, n) {
  j.check(); // an old journey's notes never reach the new one
  const entry = { text: n.text, source: n.source, url: n.url ?? null, confidence: n.confidence ?? null, date: state?.date ?? null };
  if (notes.length && notes[notes.length - 1].text === entry.text) return;
  notes.push(entry);
  if (notes.length > 60) notes.shift();
  latestNote = entry;
  noteAge = 0;
  noteBtn.hidden = false;
}

function noteBlock(n, { heading = false } = {}) {
  const box = el("article", { class: "mf-note" });
  if (heading) box.append(el("h2", { class: "mf-note-h" }, NOTE_LABEL));
  box.append(el("p", { class: "mf-note-text" }, n.text));
  const src = el("p", { class: "mf-note-src" });
  if (n.confidence && CONFIDENCE[n.confidence]) src.append(el("span", { class: "mf-conf" }, CONFIDENCE[n.confidence]), " · ");
  if (n.url) src.append(el("a", { href: n.url, rel: "noopener noreferrer", target: "_blank" }, n.source || "Source"));
  else src.append(n.source || "");
  box.append(src);
  return box;
}

function openDrawer() {
  const close = el("button", { class: "mf-link mf-drawer-close", type: "button" }, "Close");
  close.addEventListener("click", closeDrawer);
  const list = [...notes].reverse();
  drawer.replaceChildren(
    el("div", { class: "mf-drawer-head" }, el("h2", {}, NOTE_LABEL), close),
    list.length ? el("div", { class: "mf-drawer-body" }, ...list.map((n, i) => {
      const b = noteBlock(n);
      if (i === 0) b.classList.add("is-latest");
      return b;
    })) : el("p", { class: "mf-note-text" }, "Nothing yet. A note appears after each event."),
    el("p", { class: "mf-drawer-foot" }, el("a", { href: "/games/michigan-fever/sources/" }, "Every source, and every number the game invents")),
  );
  drawer.hidden = false;
  requestAnimationFrame(() => drawer.classList.add("is-open"));
  close.focus({ preventScroll: true });
}

function closeDrawer() {
  drawer.classList.remove("is-open");
  drawer.hidden = true;
  focusDefault();
}

noteBtn.addEventListener("click", openDrawer);

// ---------------------------------------------------------------- overlays

function veilShow(label) {
  ui.classList.add("is-veiled");
  veil.setAttribute("aria-label", label);
  veil.hidden = false;
  requestAnimationFrame(() => veil.classList.add("is-open"));
  hud.toggleSheet(false);
}

let veilTimer = 0;

async function veilStep(j, nodes) {
  j.check();
  clearTimeout(veilTimer); // a skipped panel's timer must not end this panel's reveal early
  const panel = el("div", { class: "mf-veil-inner" }, ...nodes);
  const go = el("button", { class: "mf-continue", type: "button" }, el("span", {}, "Continue"), el("span", { class: "mf-key", "aria-hidden": "true" }, "Space"));
  go.addEventListener("click", () => onAdvance());
  veil.replaceChildren(panel, el("div", { class: "mf-veil-foot" }, go));
  veil.classList.remove("is-done");
  if (!reduced()) {
    veil.dataset.revealing = "1";
    veilTimer = setTimeout(() => {
      veil.dataset.revealing = "";
      veil.classList.add("is-done");
    }, 1400);
  } else veil.classList.add("is-done");
  veil.scrollTop = 0;
  go.focus({ preventScroll: true });
  await j.wait();
}

function veilHide() {
  clearTimeout(veilTimer);
  veil.dataset.revealing = "";
  ui.classList.remove("is-veiled");
  veil.classList.remove("is-open");
  veil.hidden = true;
  veil.replaceChildren();
}

// The death register (user decision): the plain factual line, then the letter
// home (labelled fiction, label from the data), then the history note.
// No sound sting, no score, nothing for the player to type.
async function deathRegister(j, d, letter, note) {
  j.check();
  audio.duck(0.4);
  veilShow("A death in the family");
  await veilStep(j, [el("p", { class: "mf-death-line" }, d.text)]);
  if (letter) {
    const paras = String(letter.text).split(/\n\s*\n/).map((t) => el("p", {}, t.trim()));
    await veilStep(j, [
      el("p", { class: "mf-fiction-label" }, letter.label),
      el(
        "div",
        { class: "mf-letter" },
        el("p", { class: "mf-letter-head" }, `${letter.from ? `From ${letter.from}` : ""}${letter.to ? ` to ${letter.to}` : ""}`),
        el("p", { class: "mf-letter-date" }, letter.date ? fullDate(letter.date) : ""),
        ...paras,
      ),
    ]);
  }
  if (note) {
    addNote(j, note);
    await veilStep(j, [noteBlock(note, { heading: true })]);
  }
  veilHide();
  audio.duck(1);
}

function fullDate(iso) {
  const M = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${M[m - 1]} ${y}`;
}

async function arrival(j, b) {
  j.check();
  card.replaceChildren(
    el("p", { class: `mf-place-card${b.passing ? " is-passing" : ""}` }, b.label),
    el("p", { class: "mf-card-date" }, b.date ? fullDate(b.date) : ""),
  );
  card.classList.add("is-on");
  if (b.text) await say(j, b.text);
  card.classList.remove("is-on");
}

function ledger(s, deaths) {
  const lines = [];
  lines.push(s.acres ? `${s.acres} acres entered and paid for` : "No land entered");
  lines.push(s.shelter ? "A roof over the family before winter" : "No finished cabin before winter");
  lines.push(`${s.alive} of ${s.family} in the family alive`);
  lines.push(`${money(s.money)} left, ${s.coin >= s.money ? "all of it coin" : `${money(s.coin)} of it coin`}`);
  lines.push(`${s.days} days since leaving home`);
  return lines;
}

function ending(j, b) {
  j.check();
  quiet(setLight(j, "dusk"));
  audio.duck(0.7);
  hud.toggleSheet(false);
  const box = el("div", { class: "mf-end-inner" });
  box.append(el("p", { class: "mf-end-kicker" }, b.won ? "The journey's end" : "The end of the journey"), el("h2", { class: "mf-end-title" }, b.title), el("p", { class: "mf-end-text" }, b.text));
  if (b.score) box.append(el("ul", { class: "mf-ledger" }, ...ledger(b.score, b.deaths).map((t) => el("li", {}, t))));
  if (b.deaths?.length) {
    box.append(el("h3", {}, "Buried on the way"));
    box.append(el("ul", { class: "mf-dead" }, ...b.deaths.map((d) => el("li", {}, `${d.name}${d.age != null ? `, aged ${d.age}` : ""}${d.date ? `, ${fullDate(d.date)}` : ""}`))));
  }
  if (b.epilogue?.length) {
    box.append(el("h3", {}, "After 1836"));
    for (const e of b.epilogue) {
      const li = el("div", { class: "mf-epi" }, el("p", {}, e.text));
      const src = el("p", { class: "mf-note-src" });
      if (e.url) src.append(el("a", { href: e.url, rel: "noopener noreferrer", target: "_blank" }, e.source));
      else src.append(e.source ?? "");
      li.append(src);
      box.append(li);
    }
  }
  box.append(el("p", { class: "mf-seed" }, `Journey seed: ${state.seed ?? ""}`));
  const again = el("button", { class: "mf-choice is-forward", type: "button" }, el("span", { class: "mf-choice-text" }, el("span", { class: "mf-choice-label" }, "Begin a new journey")));
  again.addEventListener("click", () => {
    veilHide();
    audio.duck(1);
    begin();
  });
  const sources = el("a", { class: "mf-link", href: "/games/michigan-fever/sources/" }, "Sources");
  const credits = el("a", { class: "mf-link", href: "/games/michigan-fever/credits/" }, "Credits");
  const leave = el("button", { class: "mf-link", type: "button" }, "Leave the full view");
  leave.addEventListener("click", () => setImmersive(false));
  box.append(el("div", { class: "mf-end-actions" }, again, sources, credits, leave));
  veil.setAttribute("aria-label", b.title);
  ui.classList.add("is-veiled");
  veil.classList.add("is-end");
  veil.replaceChildren(box);
  veil.hidden = false;
  requestAnimationFrame(() => veil.classList.add("is-open"));
  veil.scrollTop = 0;
  again.focus({ preventScroll: true });
  bottom.hidden = true;
  noteBtn.hidden = true;
}

// ---------------------------------------------------------------- beats

// Plays one step's beats for journey j. Every await goes through j, so once a
// new journey begins this throws Cancelled at its next await and plays nothing more.
async function play(j, beats) {
  for (let i = 0; i < beats.length; i++) {
    j.check();
    const b = beats[i];
    switch (b.type) {
      case "scene":
        sceneKey = b.scene;
        await applyScene(j);
        break;
      case "weather":
        weather = { weather: b.weather, terrain: b.terrain ?? null };
        await applyScene(j);
        break;
      case "narrate":
        if (b.chosen) break; // the player just picked it
        await say(j, b.text, { cue: b.cue });
        break;
      case "event": {
        pendingEvent = { text: b.text, title: b.title ?? null };
        latestNote = null;
        noteBtn.hidden = true;
        if (beats[i + 1]?.type === "choice") {
          said = true;
          lastLine = b.text;
          setLine(b.text, { title: b.title, kind: "event" });
        } else await say(j, b.text, { title: b.title, kind: "event" });
        break;
      }
      case "choice":
        break; // the same choices come from availableActions
      case "note":
        addNote(j, b);
        break;
      case "arrive":
        await arrival(j, b);
        break;
      case "death": {
        const letter = beats[i + 1]?.type === "letter" ? beats[++i] : null;
        const note = beats[i + 1]?.type === "note" ? beats[++i] : null;
        await deathRegister(j, b, letter, note);
        break;
      }
      case "letter":
        await deathRegister(j, { text: "" }, b, null);
        break;
      case "end":
        ending(j, b);
        break;
      case "error":
        console.error("Michigan Fever: the UI offered an action the engine refused:", b.message);
        break;
      default:
        break;
    }
  }
}

function statusLine(action) {
  const v = view(route, state);
  if (v.travel) {
    const where = { canal: "on the canal", steamer: "on the lake", wagon: "on the road" }[v.travel.mode] ?? "";
    if (tod === "night" && v.travel.mode === "canal") return `The boat goes on through the night, lock by lock. ${v.travel.of - v.travel.done} miles to ${v.travel.nextLabel}.`;
    const w = { fair: `A fair day ${where}.`, rain: `Rain all day ${where}.`, cold: `A raw, cold day ${where}.`, snow: `Snow ${where}.` }[weather.weather] ?? "";
    const left = v.travel.of - v.travel.done;
    const rest = v.travel.unit === "days" ? `${left} day${left === 1 ? "" : "s"} to ${v.travel.nextLabel}.` : `${left} miles to ${v.travel.nextLabel}.`;
    if (action.type === "rest") return `The family rests in camp. ${rest}`;
    return `${w} ${rest}`.trim();
  }
  if (action.type === "rest") return "A night's rest.";
  return lastLine || v.dateLabel;
}

// ---------------------------------------------------------------- actions

function focusDefault() {
  if (!menu.hidden || !drawer.hidden) return;
  if (!veil.hidden) {
    veil.querySelector("button")?.focus({ preventScroll: true });
    return;
  }
  if (journeys.waiting()) {
    contBtn.focus({ preventScroll: true });
    return;
  }
  // An event's choices get no default: the player picks one on purpose.
  if (state?.pending) {
    actionsBox.setAttribute("tabindex", "-1");
    actionsBox.focus({ preventScroll: true });
    return;
  }
  const b = buttons.find((x) => x.classList.contains("is-forward") && x.getAttribute("aria-disabled") !== "true") ?? buttons.find((x) => x.getAttribute("aria-disabled") !== "true");
  b?.focus({ preventScroll: true });
}

function drawActions() {
  const level = groupStack[groupStack.length - 1];
  const items = level ? level.items : topItems;
  buttons = renderActions(actionsBox, items, {
    title: level?.label ?? null,
    onPick: (a) => act(a),
    onOpen: (g) => {
      groupStack.push(g);
      drawActions();
    },
    onBack: level ? () => closeGroup() : null,
  });
  actionsBox.hidden = false;
  shownAt = performance.now();
  focusDefault();
}

function closeGroup() {
  groupStack.pop();
  drawActions();
}

function showActions() {
  if (!state || state.over) return;
  const acts = availableActions(route, state);
  const v = view(route, state);
  // "Drive on": a UI loop over step() (ui/driveon.js), offered next to the one-day action.
  const goAt = acts.findIndex((a) => a.id === "go" && a.type === "travel");
  if (goAt >= 0 && !state.pending) {
    const c = canDriveOn(ENGINE, route, state);
    const label = { canal: "Let the days go by until something happens", steamer: "Keep on until something happens" }[v.travel?.mode] ?? "Drive on until something happens";
    acts.splice(goAt + 1, 0, { id: "drive-on", type: "travel", label, forward: true, enabled: c.ok, reason: c.reason });
  }
  hud.render(v, acts);
  topItems = arrange(acts);
  groupStack = [];
  line.classList.add("is-dim");
  drawActions();
}

function saveMeta() {
  store.setJSON(store.KEYS.meta, {
    seed: state.seed,
    sceneKey,
    tod,
    weather,
    line: lastLine,
    pending: state.pending ? pendingEvent : null,
    notes: notes.slice(-40),
  });
}

// The safety net (review N1/N3): when step() or a render throws, this journey
// stops where it is. The broken state is not autosaved, so the last good day
// stays on disk, and the player is offered a new journey.
const BROKEN_LINE = "The trail gives out here. Something went wrong in the game, and this journey cannot go on. The last step was not saved. You can begin a new journey.";

function stumble(j, err) {
  if (err instanceof Cancelled || !j.live) return; // a new journey began: it owns the screen now
  console.error("Michigan Fever: the journey stopped on an error:", err);
  j.cancel(); // nothing more of this journey plays or saves
  busy = false;
  lapseStop = null;
  clearTimeout(lightTimer);
  veilHide();
  veil.classList.remove("is-end");
  sceneEl.classList.remove("is-lapse");
  ui.classList.remove("is-lapse");
  card.classList.remove("is-on");
  contBtn.hidden = true;
  bottom.hidden = false;
  hud.toggleSheet(false);
  setLine(BROKEN_LINE, { animate: false });
  topItems = [{ id: "new", label: "Begin a new journey", forward: true, enabled: true }];
  groupStack = [];
  buttons = renderActions(actionsBox, topItems, { onPick: () => { audio.unlock(); begin(); }, onOpen: () => {} });
  actionsBox.hidden = false;
  shownAt = performance.now();
  buttons[0]?.focus({ preventScroll: true });
}

// After a step has played in full on a live journey: autosave it and offer what comes next.
function settleStep(j) {
  j.check();
  saveGame(state);
  saveMeta();
  busy = false;
  if (!state.over) showActions();
}

async function act(action) {
  if (action.id === "drive-on") return driveLapse();
  if (busy || !state) return;
  const j = journeys.current;
  busy = true;
  try {
    audio.unlock();
    actionsBox.hidden = true;
    actionsBox.replaceChildren();
    buttons = [];
    hud.toggleSheet(false);
    said = false;
    noteAge += 1;
    if (noteAge > 3) {
      noteBtn.hidden = true;
      latestNote = null;
    }
    const r = step(route, state, action);
    state = r.state;
    const nextTod = todFor(action, state);
    if (nextTod !== tod) await setLight(j, nextTod);
    hud.render(view(route, state), []);
    await play(j, r.beats);
    if (!said && !state.over) {
      lastLine = statusLine(action);
      setLine(lastLine, { animate: true });
    }
    settleStep(j);
  } catch (err) {
    stumble(j, err);
  }
}

// ---------------------------------------------------------------- drive on

let lapseStop = null;

// One day of the time-lapse: the light runs through evening, night and dawn.
async function lapseDay(j, mood) {
  if (reduced()) return j.settle(wait(450));
  const seq = [["dusk", 320], ["night", 260], ["dawn", 260], ["day", 300]];
  for (const [t, ms] of seq) {
    j.check();
    atmos.setLight(t, mood);
    await j.settle(wait(ms));
  }
}

async function driveLapse() {
  if (busy || !state) return;
  const j = journeys.current;
  busy = true;
  try {
    audio.unlock();
    hud.toggleSheet(false);
    said = false;
    const r = driveOn(ENGINE, route, state);
    if (!r.days.length) {
      busy = false;
      return showActions();
    }
    let stop = false;
    clearTimeout(lightTimer);
    tod = "day";
    const myStop = () => (stop = true);
    lapseStop = myStop;
    const stopBtn = el("button", { class: "mf-choice is-forward", type: "button", "data-id": "lapse-stop" }, el("span", { class: "mf-key", "aria-hidden": "true" }, "1"), el("span", { class: "mf-choice-text" }, el("span", { class: "mf-choice-label" }, "Stop here")));
    stopBtn.addEventListener("click", () => (stop = true));
    actionsBox.replaceChildren(stopBtn);
    actionsBox.hidden = false;
    buttons = [stopBtn];
    shownAt = performance.now();
    stopBtn.focus({ preventScroll: true });
    sceneEl.classList.add("is-lapse");
    ui.classList.add("is-lapse");
    const last = r.days.length - 1;
    try {
      for (let k = 0; k < last && !stop; k++) {
        j.check();
        const d = r.days[k];
        state = d.state;
        const extra = [];
        for (const b of d.beats) {
          if (b.type === "weather") weather = { weather: b.weather, terrain: b.terrain ?? null };
          if (b.type === "narrate" && !b.chosen) extra.push(b.text);
        }
        atmos.setWeather(weather.weather, { terrain: weather.terrain, storm: storm() });
        audio.mix(mixFor(sceneKey, { tod: "day", weather: weather.weather, storm: storm(), snow: d.view.snow, artId: scene.current() }));
        hud.render(d.view, []);
        lastLine = [statusLine({ type: "travel" }), ...extra].join(" ");
        setLine(`${d.view.dateLabel}. ${lastLine}`, { animate: false });
        await lapseDay(j, scene.mood());
      }
    } finally {
      if (lapseStop === myStop) lapseStop = null;
      if (j.live) {
        sceneEl.classList.remove("is-lapse");
        ui.classList.remove("is-lapse");
      }
    }
    actionsBox.hidden = true;
    actionsBox.replaceChildren();
    buttons = [];
    tod = "day";
    await applyScene(j);
    if (!stop) {
      // The day that needs the player: play it in full, like any other step.
      const d = r.days[last];
      state = d.state;
      hud.render(d.view, []);
      await play(j, d.beats);
      if (!said && !state.over) {
        lastLine = statusLine({ type: "travel" });
        setLine(lastLine, { animate: true });
      }
    } else {
      setLine(`${view(route, state).dateLabel}. You stop here.`, { animate: false });
    }
    settleStep(j);
  } catch (err) {
    stumble(j, err);
  }
}

// ---------------------------------------------------------------- title, family

function titleScreen() {
  hud.hide(true);
  ui.classList.add("is-bare");
  bottom.hidden = false;
  noteBtn.hidden = true;
  card.replaceChildren(
    el("p", { class: "mf-title" }, "Michigan Fever"),
    el("p", { class: "mf-title-year" }, "1836"),
  );
  card.classList.add("is-on", "is-title");
  setLine("Autumn 1836. A family sells a worn-out farm in New England to buy government land in Michigan, and must have it paid for and a roof raised before the snow, and before the land office stops taking paper money.", { animate: true });
  const items = [];
  const saved = loadGame(route);
  let unreadable = saved.reason === "damaged";
  if (saved.ok && !saved.state.over && saved.state.phase !== "start") {
    // load already refuses a damaged save; this catch keeps the title's buttons if one gets through.
    try {
      const v = view(route, saved.state);
      items.push({ id: "continue", label: "Continue the journey", detail: `${v.surname ? `The ${v.surname} family, ` : ""}${shortDate(v.date)}, ${v.placeLabel}`, forward: true, enabled: true, run: () => resume(saved.state) });
    } catch (err) {
      console.error("Michigan Fever: the saved journey could not be read:", err);
      unreadable = true;
    }
  }
  if (unreadable) line.append(el("p", { class: "mf-sub-line" }, "The saved journey could not be read. You can begin a new one."));
  items.push({ id: "new", label: "Begin a new journey", forward: !items.length, enabled: true, run: () => begin() });
  topItems = items;
  buttons = renderActions(actionsBox, items, { onPick: (it) => { audio.unlock(); it.run(); }, onOpen: () => {} });
  actionsBox.append(el("p", { class: "mf-title-links" },
    el("a", { class: "mf-link", href: "/games/michigan-fever/sources/" }, "Sources and history"),
    el("a", { class: "mf-link", href: "/games/michigan-fever/credits/" }, "Credits")));
  actionsBox.hidden = false;
}

function leaveTitle() {
  ui.classList.remove("is-bare");
  card.classList.remove("is-on", "is-title");
  card.replaceChildren();
}

async function begin() {
  // Cancel the last journey first (a drive-on lapse, an action still playing,
  // a light change on a timer): its waits reject at once, so it writes nothing
  // more, and the new journey's Continue cannot be taken by it.
  const j = journeys.begin();
  clearTimeout(lightTimer);
  lapseStop = null;
  sceneEl.classList.remove("is-lapse");
  ui.classList.remove("is-lapse");
  contBtn.hidden = true;
  busy = true;
  try {
    setImmersive(true);
    leaveTitle();
    veilHide();
    veil.classList.remove("is-end");
    bottom.hidden = false;
    actionsBox.hidden = true;
    noteBtn.hidden = true;
    notes = [];
    latestNote = null;
    noteAge = 0;
    lastLine = "";
    pendingEvent = null;
    const seed = params.get("seed") || randomSeed();
    const g = newGame(route, { seed });
    state = g.state;
    tod = "dawn";
    weather = { weather: "mist", terrain: null };
    await play(j, g.beats);
    j.check();
    busy = false;
    chooseBackground();
  } catch (err) {
    stumble(j, err);
  }
}

function randomSeed() {
  const a = new Uint32Array(1);
  globalThis.crypto?.getRandomValues?.(a);
  return (a[0] || Math.floor(Math.random() * 2 ** 32)).toString(36);
}

function chooseBackground() {
  hud.hide(true);
  setLine("Who is going west?", { animate: false });
  const acts = availableActions(route, state).filter((a) => a.type === "start");
  topItems = acts.map((a) => ({ ...a, run: () => familyForm(a) }));
  groupStack = [];
  buttons = renderActions(actionsBox, topItems, { onPick: (it) => familyForm(it), onOpen: () => {} });
  actionsBox.hidden = false;
  focusDefault();
}

function familyForm(a) {
  const form = el("form", { class: "mf-family-form", autocomplete: "off" });
  const sid = "mf-surname";
  form.append(
    el("div", { class: "mf-field mf-field-surname" }, el("label", { for: sid }, "Family name"), el("input", { id: sid, name: "surname", value: a.surname, maxlength: 24, spellcheck: "false" })),
  );
  const grid = el("div", { class: "mf-names" });
  for (const p of a.party) {
    const id = `mf-name-${p.id}`;
    grid.append(el("div", { class: "mf-field" }, el("label", { for: id }, `${p.role[0].toUpperCase() + p.role.slice(1)}, ${p.age}`), el("input", { id, name: p.id, value: p.name, maxlength: 24, spellcheck: "false" })));
  }
  form.append(grid);
  const goBtn = el("button", { class: "mf-choice is-forward", type: "submit" }, el("span", { class: "mf-key", "aria-hidden": "true" }, "Enter"), el("span", { class: "mf-choice-text" }, el("span", { class: "mf-choice-label" }, "Set out")));
  const backBtn = el("button", { class: "mf-choice is-back", type: "button" }, el("span", { class: "mf-key", "aria-hidden": "true" }, "Esc"), el("span", { class: "mf-choice-text" }, el("span", { class: "mf-choice-label" }, "Back")));
  form.append(el("div", { class: "mf-form-actions" }, goBtn, backBtn));
  backBtn.addEventListener("click", () => chooseBackground());
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const names = {};
    for (const p of a.party) {
      const v = String(data.get(p.id) ?? "").trim();
      if (v && v !== p.name) names[p.id] = v;
    }
    const surname = String(data.get("surname") ?? "").trim() || a.surname;
    hud.hide(false);
    await act({ id: a.id, surname, names });
  });
  setLine(a.label, { animate: false });
  line.append(el("p", { class: "mf-sub-line" }, "The names are yours to change."));
  buttons = [];
  actionsBox.replaceChildren(form);
  actionsBox.hidden = false;
  form.querySelector("input")?.focus({ preventScroll: true });
}

async function resume(saved) {
  const j = journeys.begin();
  try {
    setImmersive(true);
    leaveTitle();
    state = saved;
    const meta = store.getJSON(store.KEYS.meta, {}) ?? {};
    const v = view(route, state);
    const sameGame = meta.seed === state.seed;
    sceneKey = (sameGame && meta.sceneKey) || guessScene(v);
    tod = (sameGame && meta.tod) || "day";
    weather = (sameGame && meta.weather) || { weather: "fair", terrain: v.travel?.terrain ?? null };
    notes = sameGame && Array.isArray(meta.notes) ? meta.notes : [];
    hud.hide(false);
    await applyScene(j);
    const resumed = resumeText(state, meta, v);
    lastLine = resumed.text;
    pendingEvent = resumed.pendingEvent;
    setLine(resumed.text, { kind: resumed.kind, title: resumed.title });
    if (state.phase === "start") chooseBackground();
    else showActions();
  } catch (err) {
    stumble(j, err);
  }
}

// ---------------------------------------------------------------- menu

function openMenu(reopen = false) {
  if (!menu.hidden && !reopen) return closeMenu();
  hud.toggleSheet(false);
  const item = (label, fn, attrs = {}) => {
    const b = el("button", { class: "mf-menu-item", type: "button", ...attrs }, label);
    b.addEventListener("click", fn);
    return b;
  };
  const link = (label, href) => el("a", { class: "mf-menu-item", href }, label);
  const immersive = document.documentElement.classList.contains("mf-immersive");
  const kids = [
    el("p", { class: "mf-menu-title" }, "Michigan Fever, 1836"),
    item(state && !state.over ? "Back to the journey" : "Close the menu", closeMenu),
    item(NOTE_LABEL, () => { closeMenu(); openDrawer(); }),
    item(audio.muted() ? "Turn sound on" : "Turn sound off", () => { setMuted(!audio.muted()); closeMenu(); }),
  ];
  if (document.fullscreenEnabled) kids.push(item(document.fullscreenElement ? "Leave full screen" : "Full screen", () => { closeMenu(); toggleFullscreen(); }));
  kids.push(item(immersive ? "Leave the full view" : "Full view", () => { closeMenu(); setImmersive(!immersive); }));
  if (state && !state.over && state.phase !== "start") kids.push(item("Begin a new journey", () => confirmNew()));
  kids.push(link("Sources and history", "/games/michigan-fever/sources/"), link("Credits", "/games/michigan-fever/credits/"));
  if (state?.seed) kids.push(el("p", { class: "mf-seed" }, `Journey seed: ${state.seed}. Add ?seed=${state.seed} to the address to replay it.`));
  kids.push(el("p", { class: "mf-menu-keys" }, "Keys: number keys choose, Space or Enter continues, Esc opens and closes this menu."));
  menu.replaceChildren(el("div", { class: "mf-menu-inner" }, ...kids));
  menu.hidden = false;
  menu.querySelector("button")?.focus({ preventScroll: true });
}

function confirmNew() {
  const yes = el("button", { class: "mf-menu-item", type: "button" }, "Yes, leave this journey and begin again");
  const no = el("button", { class: "mf-menu-item", type: "button" }, "No, go back");
  yes.addEventListener("click", () => {
    closeMenu();
    begin();
  });
  no.addEventListener("click", () => openMenu(true));
  menu.replaceChildren(el("div", { class: "mf-menu-inner" }, el("p", { class: "mf-menu-title" }, "Begin again?"), el("p", { class: "mf-menu-keys" }, "The journey you are on will be lost; the game keeps one saved journey."), yes, no));
  no.focus({ preventScroll: true });
}

function closeMenu() {
  menu.hidden = true;
  focusDefault();
}

menu.addEventListener("click", (e) => {
  if (e.target === menu) closeMenu();
});

// ---------------------------------------------------------------- view modes

function setImmersive(on) {
  const was = document.documentElement.classList.contains("mf-immersive");
  document.documentElement.classList.toggle("mf-immersive", on);
  viewBtn.replaceChildren(icon(on ? "exit" : "enter"));
  viewBtn.setAttribute("aria-label", on ? "Leave the full view" : "Full view");
  viewBtn.title = on ? "Leave the full view" : "Full view";
  if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (!on && was) globalThis.scrollTo({ top: 0 }); // the stage sits right under the site header
  globalThis.dispatchEvent(new Event("resize"));
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else {
      setImmersive(true);
      await root.requestFullscreen();
    }
  } catch {
    toast("Full screen is not available here.");
  }
}

function setMuted(m) {
  audio.unlock();
  audio.setMuted(m);
  hud.setSound(m);
}

let toastTimer = 0;
function toast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 3200);
}

// ---------------------------------------------------------------- keyboard

document.addEventListener("keydown", (e) => {
  if (!route) return;
  const immersive = document.documentElement.classList.contains("mf-immersive");
  if (!immersive && !root.contains(document.activeElement)) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  audio.unlock();
  const t = e.target;
  const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
  if (e.key === "Escape") {
    e.preventDefault();
    if (!menu.hidden) return closeMenu();
    if (!drawer.hidden) return closeDrawer();
    if (!hud.sheet.hidden) {
      hud.toggleSheet(false);
      return focusDefault();
    }
    if (typing || actionsBox.querySelector("form")) return chooseBackground();
    if (groupStack.length) return closeGroup();
    if (!veil.hidden && !veil.classList.contains("is-end")) return; // the register is not skipped
    return openMenu();
  }
  if (typing || !menu.hidden || !drawer.hidden) return;
  if (e.key === " " || e.key === "Enter") {
    const onControl = t instanceof HTMLButtonElement || t instanceof HTMLAnchorElement;
    // Held keys, or a press that lands just as the buttons appear, do not choose.
    if (onControl && actionsBox.contains(t) && (e.repeat || performance.now() - shownAt < 450)) {
      e.preventDefault();
      return;
    }
    // Focus left on a HUD or menu button (after a click there) must not trap Space:
    // while the story waits, Space continues it.
    if (onControl && e.key === " " && (journeys.waiting() || lapseStop) && !actionsBox.contains(t) && !veil.contains(t)) {
      e.preventDefault();
      onAdvance();
      return;
    }
    if (onControl) {
      // Let the focused button do its own job; but a reveal in progress finishes first.
      if (line.dataset.revealing || veil.dataset.revealing) {
        e.preventDefault();
        onAdvance();
      }
      return;
    }
    if (onAdvance()) e.preventDefault();
    return;
  }
  if (/^[1-9]$/.test(e.key) && veil.hidden && !journeys.waiting()) {
    const b = buttons[Number(e.key) - 1];
    if (b) {
      e.preventDefault();
      b.focus({ preventScroll: true });
      b.click();
    }
  }
});

document.addEventListener("visibilitychange", () => {
  audio.suspend(document.hidden);
  scene.pause(document.hidden);
});
reducedMq?.addEventListener?.("change", () => atmos.refresh());
document.addEventListener("fullscreenchange", () => globalThis.dispatchEvent(new Event("resize")));

// ---------------------------------------------------------------- boot

function measureHeader() {
  const h = document.querySelector(".site-header")?.offsetHeight;
  if (h) document.documentElement.style.setProperty("--mf-header", `${h}px`);
}
globalThis.addEventListener("resize", measureHeader);

async function boot() {
  measureHeader();
  try {
    [route] = await Promise.all([loadRoute(), scene.ready]);
  } catch (err) {
    console.error("Michigan Fever could not load:", err);
    root.replaceChildren(el("p", { class: "mf-fail" }, "The game could not load. Try reloading the page."));
    return;
  }
  setImmersive(false);
  sceneKey = "farm";
  tod = "dawn";
  weather = { weather: "mist", terrain: null };
  await applyScene(journeys.begin()); // the title screen's own journey; begin() and resume() replace it
  titleScreen();
}

boot();
