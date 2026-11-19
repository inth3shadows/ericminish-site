// The Sources page: built from the game's own data files, so it always lists
// what the game uses now. Every source cited (by numbers, event notes and the
// start, death and ending notes), every event invented for the game, and every
// invented number with its reason.

import { el } from "./dom.js";

const DATA = "/games/michigan-fever/data/";
const GROUPS = {
  date: "Dates", mi: "Distances", speed: "Speeds", fare: "Fares", freight: "Freight", price: "Prices",
  shop: "Shops", sell: "Selling the team", wage: "Wages", work: "Hiring out", broker: "Brokers",
  disc: "Discounts on paper money", zone: "Discount zones", spec: "The Specie Circular", receiver: "The Receiver",
  land: "The land office", shelter: "The cabin", build: "The cabin", hands: "Hired hands", bg: "Family backgrounds",
  food: "Food", hunger: "Hunger", health: "Health", ill: "Illness", ague: "Fever and ague", dys: "Dysentery",
  cholera: "Cholera", cold: "Cold", grief: "Grief", morale: "Spirits", wx: "Weather", winter: "Winter",
  terrain: "Roads and terrain", swamp: "The Black Swamp", canal: "The canal", lake: "The lake", toll: "Tolls",
  wagon: "The wagon", yoke: "The team", skill: "Skills", age: "Ages", ev: "Event odds and effects",
  w: "Event weights", cd: "Event cooldowns", m: "Months", crowd: "Crowding",
};
const CONF = { solid: "well sourced", likely: "likely", uncertain: "uncertain", invented: "invented" };

async function getJSON(name) {
  const res = await fetch(DATA + name);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.json();
}

function fmt(n) {
  if (typeof n.value === "number" && n.unit === "USD") return `$${n.value.toFixed(2)}`;
  return `${n.value}${n.unit && !["date", "zone", "month"].includes(n.unit) ? ` ${n.unit}` : ""}`;
}

function sourceLink(source, url) {
  return url ? el("a", { href: url, rel: "noopener noreferrer" }, source) : source;
}

async function main() {
  const root = document.getElementById("mf-sources");
  if (!root) return;
  let numbers, events, text;
  try {
    [numbers, events, text] = await Promise.all([getJSON("numbers.json"), getJSON("events.json"), getJSON("text.json")]);
  } catch (err) {
    console.error("Sources could not load:", err);
    root.replaceChildren(el("p", {}, "The source list could not load. Try reloading the page."));
    return;
  }

  // Every source, with what cites it.
  const sources = new Map();
  const cite = (source, url, what) => {
    if (!source || /^invented/i.test(source)) return;
    const key = source.trim();
    if (!sources.has(key)) sources.set(key, { url: url ?? null, what: [] });
    const s = sources.get(key);
    s.url ??= url ?? null;
    s.what.push(what);
  };
  for (const n of numbers) if (n.tag === "src") cite(n.source, n.url, `the number ${n.id}`);
  for (const e of events) if (e.note) cite(e.note.source, e.note.url, `the event “${e.text.slice(0, 60)}${e.text.length > 60 ? "…" : ""}”`);
  if (text.introNote) cite(text.introNote.source, text.introNote.url, "the opening note");
  for (const [cause, n] of Object.entries(text.causeNotes ?? {})) cite(n.source, n.url, `the note after a death from ${cause}`);
  for (const n of text.epilogue ?? []) cite(n.source, n.url, "the epilogue");

  const srcList = el("ol", { class: "mf-src-list" });
  for (const [name, s] of [...sources.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    srcList.append(el("li", {}, el("span", { class: "mf-src-name" }, sourceLink(name, s.url)), el("span", { class: "mf-src-what" }, ` Cited by ${s.what.length === 1 ? s.what[0] : `${s.what.length} items, including ${s.what[0]}`}.`)));
  }

  const inventedEvents = events.filter((e) => e.note?.confidence === "invented" || !e.note?.source || /^invented/i.test(e.note?.source ?? ""));
  const evList = el("ul", { class: "mf-src-list" }, ...inventedEvents.map((e) => el("li", {}, e.text)));

  const sourced = numbers.filter((n) => n.tag === "src");
  const invented = numbers.filter((n) => n.tag !== "src");
  const byGroup = new Map();
  for (const n of invented) {
    const g = GROUPS[n.id.split(".")[0]] ?? "Other";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(n);
  }
  const invBlocks = [...byGroup.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([g, list]) =>
    el("details", { class: "mf-src-group" },
      el("summary", {}, `${g} (${list.length})`),
      el("dl", {}, ...list.flatMap((n) => [el("dt", {}, el("code", {}, n.id), ` = ${fmt(n)}`), el("dd", {}, n.note || "No reason recorded.")])),
    ));
  const srcNums = el("dl", { class: "mf-src-nums" }, ...sourced.flatMap((n) => [
    el("dt", {}, el("code", {}, n.id), ` = ${fmt(n)}`, n.confidence ? ` (${CONF[n.confidence] ?? n.confidence})` : ""),
    el("dd", {}, sourceLink(n.source ?? "", n.url), n.note ? `. ${n.note}` : ""),
  ]));

  root.replaceChildren(
    el("h2", {}, `Sources (${sources.size})`),
    el("p", {}, "Every work the game cites, in its numbers, its event notes, and the notes at the start, after a death and at the end."),
    srcList,
    el("h2", {}, `Numbers taken from a source (${sourced.length})`),
    srcNums,
    el("h2", {}, `Invented numbers (${invented.length} of ${numbers.length})`),
    el("p", {}, "The record does not give these, so the game sets them. Each one carries the reason it has the value it has. Open a group to read them."),
    ...invBlocks,
    el("h2", {}, `Events with no source (${inventedEvents.length} of ${events.length})`),
    el("p", {}, "These happen in the game but the research found nothing on them. Their notes say so in the game."),
    evList,
  );
}

main();
