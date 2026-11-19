// The death register. Fixed form, per the user's decision:
//   1. a plain factual line: who, when, where, what the family did
//   2. a short 1830s-style letter home, labelled as fiction
//   3. a "what happened" note with its source
// No symptoms, no humour, no score, no player-written epitaph.

import { format } from "../../engine/clock.js";
import { ILLNESS_LABEL } from "./health.js";

const pronouns = (p) => (p.sex === "m"
  ? { he: "he", him: "him", his: "his", He: "He", His: "His" }
  : { he: "she", him: "her", his: "her", He: "She", His: "Her" });

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function placeKey(p) {
  const d = p.died;
  if (d.leg === "town") return `town-${d.place}`;
  return d.leg;
}

// How the dead person stood to the letter writer, e.g. "our son Thomas".
export function relation(dead, writer, party = []) {
  const parent = (r) => ["father", "mother"].includes(r);
  const kid = (r) => ["son", "daughter"].includes(r);
  if (!writer) return dead.name;
  const bothParents = party.filter((p) => parent(p.role) && p.status !== "dead").length > 1;
  if (kid(dead.role) && parent(writer.role)) return `${bothParents ? "our" : "my"} ${dead.role === "son" ? "boy" : "girl"} ${dead.name}`;
  if (kid(dead.role) && kid(writer.role)) return `${dead.sex === "m" ? "my brother" : "my sister"} ${dead.name}`;
  if (dead.role === "father" && writer.role === "mother") return `my husband ${dead.name}`;
  if (dead.role === "mother" && writer.role === "father") return `my wife ${dead.name}`;
  if (parent(dead.role) && kid(writer.role)) return dead.role === "father" ? "Father" : "Mother";
  return dead.name;
}

export function deathBeats(ctx, p, cause) {
  const { state, route, rng } = ctx;
  const T = route.data.text;
  const key = placeKey(p);
  const where = T.where[key] ?? T.where.default;
  const pr = pronouns(p);
  const date = format(p.died.date, { weekday: false });
  const griefDays = ctx.num("grief.days");
  const surname = state.vars.surname;
  const fullName = `${p.name} ${surname}`;
  const burial = fill(T.burial[key] ?? T.burial.default, { ...pr, griefDays });

  const line = `${fullName}, aged ${p.age}, died of ${ILLNESS_LABEL[cause]} on ${date}, ${where}. ${burial}`;

  const writers = state.party
    .filter((x) => x.status !== "dead" && x.id !== p.id && x.age >= ctx.num("age.adult"))
    .sort((a, b) => b.age - a.age);
  const writer = writers[0] ?? null;
  const kin = state.vars.kin;
  const set = writer ? (p.age < ctx.num("age.adult") ? T.letters.child : T.letters.adult) : T.letters.stranger;
  const tpl = rng.pick(set);
  const signOff = writer ? `${writer.name} ${surname}` : T.letters.strangerSign;
  const letterText = fill(tpl, {
    ...pr,
    kin: kin.salutation,
    relation: relation(p, writer, state.party),
    name: p.name,
    fullName,
    date,
    where,
    sign: signOff,
    family: surname,
  });

  const note = T.causeNotes[cause];
  return [
    { type: "death", who: p.id, name: fullName, age: p.age, cause, date: p.died.date, place: key, text: line },
    { type: "letter", fiction: true, label: T.letterLabel, from: signOff, to: kin.name, date: p.died.date, text: letterText },
    { type: "note", about: "death", cause, text: note.text, source: note.source, url: note.url, confidence: note.confidence },
  ];
}
