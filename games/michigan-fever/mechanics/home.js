// What the family left behind (P2 A3): home ties drawn at the start, letters
// from home waiting at post offices, postage by distance band, and money sent
// home in notes cut in halves. No DOM.
//
// A tie is owed at home in face value. It settles when money sent home arrives
// by its date (tie.<id>.due); on that date it turns out well or badly at home,
// unseen. The family learns of it from a letter, if they call for it and pay the postage.
//
// Status: "open" (owed), "sent" (money in the mail; as far as the family knows
// it is on its way), "settled" (it arrived, or was paid in person), "lost"
// (the letter saying it never came has been read). Money that goes astray stays
// "sent", with t.astray, until that letter is collected. The view shows every
// sending by mail as "sent", arrived or astray, until word comes (shownStatus).

import { compare, addDays, format } from "../../engine/clock.js";
import { addRes, resolve } from "../../engine/events.js";
import * as P from "./purse.js";
import { living } from "./health.js";
import { KIN_OFFICE } from "./paths.js";

const PLACE_LABEL = { perrysburg: "Perrysburg" };
// "5 November"
const formatDay = (iso) => format(iso, { weekday: false }).replace(/ \d{4}$/, "");
export const TIE_IDS = ["parent", "note", "mortgage", "sweetheart", "store", "subscription"];
export const POST_OFFICES = ["albany", "buffalo", "perrysburg", "detroit", "bronson"];
export const TIE_STATUSES = ["open", "sent", "settled", "lost"];
// Outcomes that are bad news when they reach the family (a parent who died cared
// for, "passed", is still hard news). Morale only: the home path's tier 2 rests on
// what the family did, not on how it fell out at home (PB2; paths.js tierOf).
export const BAD = new Set(["died", "passed", "managing", "pressed", "sued", "married", "posted", "named"]);

// Miles from home to each office as the mail ran, from the route's own distances.
const PATH = {
  albany: ["mi.vermont"],
  buffalo: ["mi.vermont", "mi.canal"],
  perrysburg: ["mi.vermont", "mi.canal", "mi.buffaloSandusky", "mi.sanduskyPerrysburg"],
  detroit: ["mi.vermont", "mi.canal", "mi.buffaloSandusky", "mi.sanduskyPerrysburg", "mi.perrysburgDetroit"],
  bronson: ["mi.vermont", "mi.canal", "mi.buffaloSandusky", "mi.sanduskyPerrysburg", "mi.perrysburgDetroit", "mi.detroitMarshall", "mi.marshallBronson"],
};

export function officeMiles(num, office) {
  return PATH[office].reduce((a, id) => a + num(id), 0);
}

// Dollars for one sheet over `miles` (Act of 1825 sec. 13: 6, 10, 12.5, 18.75, 25 cents).
export function bandRate(num, miles) {
  for (let i = 1; i <= 4; i++) if (miles <= num(`post.band.${i}.miles`)) return num(`post.band.${i}.rate`);
  return num("post.band.5.rate");
}

// Cents for a letter of `sheets` pieces of paper, exact: double for two, triple
// for three, quadruple for a packet of four or more. 12.5 and 18.75 stay exact
// here (the rates are multiples of a quarter cent, exact in binary too).
export function postage(num, miles, sheets = 1) {
  return bandRate(num, miles) * Math.min(sheets, num("post.sheetsMax")) * 100;
}

// What the counter takes for postage of `exact` cents (one call: every letter
// paid for together). The purse holds whole cents, so an odd half or quarter
// cent is dropped in the family's favour: two sheets at 12.5 are exactly 25,
// one sheet is 12. See the note on post.band.3.rate.
export const charge = (exact) => Math.floor(exact + 1e-9);

export const tieDef = (route, id) => route.data.text.ties.find((t) => t.id === id);
export const tieOf = (state, id) => state.ties?.find((t) => t.id === id) ?? null;

// ---- the start --------------------------------------------------------------

function sweetheartChild(state, num) {
  return living(state).filter((p) => ["son", "daughter"].includes(p.role) && p.age >= num("age.sweetheart")).sort((a, b) => b.age - a.age)[0] ?? null;
}

// Draw 2-3 ties, weighted by the background (backgrounds.json "ties").
export function drawTies(ctx, bg) {
  const { state, num, rng } = ctx;
  const child = sweetheartChild(state, num);
  const pool = TIE_IDS.map((id) => [id === "sweetheart" && !child ? 0 : resolve(bg.ties?.[id] ?? 0, ctx), id]).filter(([w]) => w > 0);
  const n = rng.int(num("tie.count.min"), num("tie.count.max"));
  const ties = [];
  for (let i = 0; i < n && pool.length; i++) {
    const id = rng.weighted(pool);
    pool.splice(pool.findIndex(([, x]) => x === id), 1);
    const t = { id, amount: P.cents(num(`tie.${id}.amount`)), sent: 0, status: "open", outcome: null, learned: false };
    if (id === "parent") t.who = rng.pick(["Father", "Mother"]);
    if (id === "sweetheart") t.who = child.id;
    ties.push(t);
  }
  state.ties = ties;
  return ties;
}

const nextMail = (state) => `m${(state.vars.mailId = (state.vars.mailId ?? 0) + 1)}`;

function addMail(ctx, item) {
  const { state, num, rng } = ctx;
  state.mail.push({ id: nextMail(state), sheets: rng.chance(num("post.longP")) ? 2 : 1, status: "waiting", ...item });
}

// Letters home will write: kin's first letter waits at Albany; each tie's news
// waits at its office; each tie's outcome reaches Bronson some days after its date.
export function makeMail(ctx) {
  const { state, num, route } = ctx;
  state.mail = [];
  const start = num("date.start");
  addMail(ctx, { key: "kin", tie: null, office: "albany", from: start, written: start });
  for (const t of state.ties) {
    const def = tieDef(route, t.id);
    addMail(ctx, { key: "news", tie: t.id, office: def.newsAt, from: start, written: start });
    addMail(ctx, { key: "outcome", tie: t.id, office: "bronson", from: addDays(num(`tie.${t.id}.due`), num("post.transitDays")), written: num(`tie.${t.id}.due`) });
  }
  // Kin already settled west (paths.js drawWest): their letter, written when word
  // came from home that the family was starting, waits on the way (P2 Phase B).
  const west = state.vars.west;
  if (west) addMail(ctx, { key: "call", tie: null, office: KIN_OFFICE[west.where], from: start, written: addDays(start, -num("post.transitDays")) });
}

// Tie events (a mortgage agent at Detroit, ...) go in the schedule queue.
export function scheduleTies(ctx) {
  for (const t of ctx.state.ties) for (const spec of tieDef(ctx.route, t.id).schedule ?? []) ctx.schedule(spec);
}

// ---- reading ---------------------------------------------------------------

export function waitingMail(state, office) {
  return (state.mail ?? []).filter((m) => m.office === office && m.status === "waiting" && compare(m.from, state.date) <= 0);
}

export function mailCost(state, num, office) {
  return charge(waitingMail(state, office).reduce((a, m) => a + postage(num, officeMiles(num, office), m.sheets), 0));
}

// A letter home from this office, one sheet.
export function letterCost(num, office) {
  return charge(postage(num, officeMiles(num, office), 1));
}

function tieVars(ctx, t) {
  const vars = { amount: P.money(t?.amount ?? 0) };
  if (t?.id === "parent") vars.parent = t.who;
  if (t?.id === "sweetheart") vars.child = t.who;
  if (t) vars.what = ctx.text(tieDef(ctx.route, t.id).purpose, vars);
  return vars;
}

function headOf(state) {
  return state.party.find((p) => ["father", "mother"].includes(p.role) && p.status !== "dead") ?? living(state)[0];
}

function letterText(ctx, m) {
  const T = ctx.route.data.text;
  const t = m.tie ? tieOf(ctx.state, m.tie) : null;
  const def = t ? tieDef(ctx.route, t.id) : null;
  const head = headOf(ctx.state);
  const vars = { ...tieVars(ctx, t), to: head?.sex === "f" ? "Dear Sister" : "Dear Brother", sender: ctx.state.vars.kin?.name ?? "" };
  let tpl;
  if (m.key === "call") return ctx.text(T.westLetters[ctx.state.vars.west.where], westVars(ctx));
  if (m.key === "kin") tpl = T.homeLetters.kin;
  else if (m.key === "news") tpl = def.news;
  else if (m.key === "lost") tpl = T.homeLetters.lost;
  else tpl = def.outcome[t.outcome] ?? def.news;
  return ctx.text(tpl, vars);
}

// The words a western kin's letter is filled with: who writes, where, what they offer.
export function westVars(ctx) {
  const s = ctx.state;
  const w = s.vars.west;
  const T = ctx.route.data.text;
  const head = headOf(s);
  const t = w?.tie ? tieOf(s, w.tie) : null;
  return {
    to: head?.sex === "f" ? "Dear Niece" : "Dear Nephew", name: w?.name ?? "", sender: w?.name ?? "",
    what: t ? ctx.text(tieDef(ctx.route, t.id).purpose, tieVars(ctx, t)) : "",
    offer: w?.work ? T.westOffer.work : T.westOffer.land, land: P.money(P.cents(ctx.num("spec.price.openings") * ctx.num("land.acres.small"))),
  };
}

// Take every letter waiting at `office`: pay the postage, show each as a
// from-home letter beat, and feel the news.
export function collectMail(ctx, office) {
  const { state, num } = ctx;
  const T = ctx.route.data.text;
  const list = waitingMail(state, office);
  const cost = mailCost(state, num, office);
  if (!list.length || !P.pay(state, num, cost)) return false;
  const head = headOf(state);
  for (const m of list) {
    m.status = "taken";
    m.taken = state.date;
    const west = m.key === "call";
    ctx.emit({
      type: "letter", fiction: true, label: west ? T.westLetterLabel : T.homeLetterLabel, from: west ? "west" : "home",
      sender: west ? state.vars.west.name : state.vars.kin?.name ?? "",
      to: head ? `${head.name} ${state.vars.surname}` : state.vars.surname, date: m.written ?? state.date, office, text: letterText(ctx, m),
    });
    // The kin's invitation: the offer comes once the family has left the counter.
    if (west && !state.vars.path) ctx.schedule({ event: "kin-call", in: { at: office } });
    let mood = num("morale.letterHome");
    const t = m.tie ? tieOf(state, m.tie) : null;
    if (t && m.key === "outcome") {
      t.learned = true;
      mood = BAD.has(t.outcome) ? -num("tie.morale.bad") : num("tie.morale.good");
      // The outcome letter tells of money that never came, if its own letter was left on a shelf.
      if (t.astray && t.status === "sent") t.status = "lost";
    } else if (m.key === "lost") {
      mood = -num("tie.morale.bad");
      // Only now does the family know the money never came.
      if (t?.status === "sent") t.status = "lost";
    }
    addRes(ctx, "morale", mood);
  }
  return true;
}

// Leave them on the shelf: advertised at the quarter, then the dead-letter office.
export function leaveMail(ctx, office) {
  for (const m of waitingMail(ctx.state, office)) m.status = "left";
  ctx.emit({ type: "narrate", text: ctx.text(ctx.route.data.text.post.left) });
}

// ---- writing and sending ---------------------------------------------------

function familyNews(ctx) {
  const s = ctx.state;
  const sick = living(s).filter((p) => p.status === "sick");
  const dead = s.party.filter((p) => p.status === "dead");
  const N = ctx.route.data.text.homeLetters.newsLines;
  if (dead.length) return ctx.text(N.loss, { who: dead[dead.length - 1].id });
  if (sick.length) return ctx.text(N.sick, { who: sick[0].id });
  if (s.land.paid) return ctx.text(N.land);
  return ctx.text(N.well);
}

function outgoing(ctx, tpl, vars = {}) {
  const s = ctx.state;
  const T = ctx.route.data.text;
  const head = headOf(s);
  const sign = head ? `${head.name} ${s.vars.surname}` : s.vars.surname;
  ctx.emit({
    type: "letter", fiction: true, label: T.letterLabel, from: sign, to: s.vars.kin?.name ?? "", date: s.date,
    text: ctx.text(tpl, { salutation: s.vars.kin?.salutation ?? "", news: familyNews(ctx), sign, ...vars }),
  });
}

// A letter home from `place` (a place id; defaults to where the family is).
export function writeHome(ctx, place = null) {
  const s = ctx.state;
  s.vars.lettersHome = (s.vars.lettersHome ?? 0) + 1;
  const out = ctx.route.data.text.homeLetters.out;
  outgoing(ctx, ctx.rng.pick(out), place ? { place: PLACE_LABEL[place] ?? place } : {});
}

// Paper at home value: New England and New York notes at par in Vermont,
// Michigan notes at their eastern discount. Coin does not go by mail.
export function homeValue(state, num) {
  return P.REGIONS.reduce((a, r) => a + P.noteValue(state, num, r, num("zone.home")), 0);
}

// Money can go for a tie that is owed, or whose money is known to be lost;
// not while a sending is (as far as the family knows) on its way.
export const sendOpen = (t) => Boolean(t) && (t.status === "open" || t.status === "lost");

// Money settles a tie only if it is in hand at home by the tie's date, before
// the outcome there is decided. Letters take post.transitDays; paid to an
// agent in person, it counts the day it is paid.
export function inTime(num, t, arrives) {
  return t.outcome == null && compare(arrives, num(`tie.${t.id}.due`)) <= 0;
}

// When money sent today is all at home: whole notes by this mail; halves only
// when the second halves, which go by the next mail, arrive (V3).
export const lettersArrive = (state, num, how = "whole") =>
  addDays(state.date, num("post.transitDays") + (how === "halves" ? num("post.halves.gapDays") : 0));

export const canSendFor = (state, num, t, how = "whole") => sendOpen(t) && inTime(num, t, lettersArrive(state, num, how)) && homeValue(state, num) >= t.amount;

// Why a tie's money cannot go by this mail, sent `how` (null when it can).
export function sendWhy(route, state, num, t, how = "whole") {
  if (canSendFor(state, num, t, how)) return null;
  const P0 = route.data.text.post;
  if (sendOpen(t) && !inTime(num, t, lettersArrive(state, num, how))) {
    return P0[how === "halves" ? "tooLateHalves" : "tooLate"].replace("{due}", formatDay(num(`tie.${t.id}.due`)));
  }
  return P0.noPaper;
}

// Paid in person (an agent who found you): possible while it is owed and before its date.
export const canPayHere = (state, num, t) => Boolean(t) && t.status !== "settled" && inTime(num, t, state.date);

export function payWhy(route, state, num, t) {
  const P0 = route.data.text.post;
  if (t && t.status !== "settled" && !inTime(num, t, state.date)) return P0.fellDue.replace("{due}", formatDay(num(`tie.${t.id}.due`)));
  return P0.cannotPayTie;
}

// Postage for sending: each letter is the letter and the enclosed notes, two pieces of paper.
export function sendPostage(num, office, how) {
  return charge((how === "halves" ? 2 : 1) * postage(num, officeMiles(num, office), 2));
}

function takeNotesAtHome(state, num, amount) {
  let left = amount;
  for (const r of ["ne", "ny", "mi"]) {
    if (left <= 0) break;
    const d = P.discount(r, num("zone.home"), num, state);
    const cover = Math.min(left, Math.floor(state.purse.notes[r] * (1 - d)));
    if (cover <= 0) continue;
    state.purse.notes[r] -= Math.min(state.purse.notes[r], Math.ceil(cover / (1 - d)));
    left -= cover;
  }
}

// The notes for the tie, and the postage from what is left.
export function canSendHow(state, num, tieId, how, office) {
  const t = tieOf(state, tieId);
  if (!canSendFor(state, num, t, how)) return false;
  const copy = { ...state, purse: { coin: state.purse.coin, notes: { ...state.purse.notes } } };
  takeNotesAtHome(copy, num, t.amount);
  return P.canPay(copy, num, sendPostage(num, office, how));
}

// Send a tie's money home from `office`: notes cut in halves and sent in two
// letters (lost only if both go astray), or whole in one. Postage first.
export function sendMoney(ctx, tieId, how, office) {
  const { state, num, rng } = ctx;
  const t = tieOf(state, tieId);
  if (!canSendFor(state, num, t, how)) return false;
  const purse = { coin: state.purse.coin, notes: { ...state.purse.notes } };
  takeNotesAtHome(state, num, t.amount);
  if (!P.pay(state, num, sendPostage(num, office, how))) {
    state.purse = purse;
    return false;
  }
  const p = num("post.lossP");
  const first = rng.chance(p);
  const lost = how === "halves" ? first && rng.chance(p) : first;
  const H = ctx.route.data.text.homeLetters;
  outgoing(ctx, H.money[how], tieVars(ctx, t));
  state.vars.lettersHome = (state.vars.lettersHome ?? 0) + 1;
  // Arrived or astray, the money left the family and goes by mail: the view shows
  // it as sent until word comes (shownStatus), so neither leaks the loss.
  const arrives = lettersArrive(state, num, how);
  t.sent = t.amount;
  t.mailed = true;
  if (lost) {
    // Word that it never came is written when it should have arrived, and
    // reaches Bronson a transit later; until that letter is read it shows as sent.
    t.status = "sent";
    t.astray = true;
    state.mail.push({ id: nextMail(state), key: "lost", tie: t.id, office: "bronson", from: addDays(arrives, num("post.transitDays")), written: arrives, sheets: 1, status: "waiting" });
  } else {
    t.status = "settled";
    delete t.astray;
  }
  ctx.emit({ type: "narrate", text: ctx.text(ctx.route.data.text.post[how === "halves" ? "sentHalves" : "sentWhole"], tieVars(ctx, t)) });
  return true;
}

// Paid in person (to an agent who found you): settles the tie at the local value of the purse.
export function payTieHere(ctx, tieId) {
  const { state, num } = ctx;
  const t = tieOf(state, tieId);
  if (!canPayHere(state, num, t) || !P.pay(state, num, t.amount)) return false;
  t.sent = t.amount;
  t.status = "settled";
  delete t.mailed;
  delete t.astray;
  return true;
}

// ---- at home, unseen ---------------------------------------------------------

function roll(ctx, t) {
  const { state, num, rng } = ctx;
  const paid = t.status === "settled";
  switch (t.id) {
    // Paid: "passed" (died, cared for to the end) or "cared"; unpaid: "died" (the keep not paid) or "managing".
    case "parent": return rng.chance(num(paid ? "tie.parent.dieP.paid" : "tie.parent.dieP.unpaid")) ? (paid ? "passed" : "died") : paid ? "cared" : "managing";
    case "note": return paid ? "repaid" : rng.chance(num("tie.note.pressP")) ? "pressed" : "waiting";
    case "mortgage": return paid ? "cleared" : rng.chance(num("tie.mortgage.sueP")) ? "sued" : "extended";
    case "store": return paid ? "cleared" : rng.chance(num("tie.store.postP")) ? "posted" : "patient";
    case "subscription": return paid ? "thanked" : rng.chance(num("tie.subscription.nameP")) ? "named" : "excused";
    case "sweetheart": {
      const p = paid ? "tie.sweetheart.comeP.sent" : (state.vars.lettersHome ?? 0) > 0 ? "tie.sweetheart.comeP.letters" : "tie.sweetheart.comeP.none";
      return rng.chance(num(p)) ? "coming" : "married";
    }
    default: return null;
  }
}

// The daily tick: a tie whose date has come turns out one way or the other.
// t.inTime records whether the money was home by then (PB2): what the family did,
// which a payment made after the date (on coming home) does not change.
export function resolveTies(ctx) {
  for (const t of ctx.state.ties ?? []) {
    if (t.outcome == null && compare(ctx.state.date, ctx.num(`tie.${t.id}.due`)) >= 0) {
      t.inTime = t.status === "settled";
      t.outcome = roll(ctx, t);
    }
  }
}

// Seen to in time (PB2): settled, and settled before its date came (or its date
// has not come yet). The outcome's luck at home does not enter into it.
export const seenToInTime = (t) => t.status === "settled" && (t.outcome == null || t.inTime === true);

// ---- the HUD and the ending ----------------------------------------------

// What the family knows (V4): money sent by mail shows as "sent", whether it
// arrived or went astray, until a letter says which: the tie's outcome letter
// ("settled") or the letter saying it never came ("lost"). Paid in person, it is
// settled at once.
export function shownStatus(t) {
  if (t.status === "settled" && t.mailed && !t.learned) return "sent";
  return t.status;
}

export function summary(route, state) {
  return (state.ties ?? []).map((t) => {
    const def = tieDef(route, t.id);
    const party = state.party.find((p) => p.id === t.who);
    const fill = (s) => String(s).replaceAll("{parent}", t.who ?? "").replaceAll("{child}", party?.name ?? "")
      .replaceAll("{amount}", P.money(t.amount)).replaceAll("{kin}", state.vars.kin?.name ?? "");
    return {
      id: t.id, label: fill(def.label), purpose: fill(def.purpose), detail: fill(def.detail), amount: t.amount, sent: t.sent, status: shownStatus(t),
      news: t.learned && t.outcome ? fill(def.short[t.outcome]) : null,
    };
  });
}

export function epilogue(ctx) {
  const s = ctx.state;
  const T = ctx.route.data.text;
  const lines = [];
  for (const t of s.ties ?? []) {
    const def = tieDef(ctx.route, t.id);
    const tpl = def.epilogue[t.outcome ?? "open"];
    if (tpl) lines.push({ text: ctx.text(tpl, tieVars(ctx, t)), source: T.tieSource, url: null, fiction: true });
  }
  const unread = (s.mail ?? []).filter((m) => m.status !== "taken" && compare(m.from, s.date) <= 0).length;
  if (unread) lines.push({ text: ctx.text(T.post.deadLetters, { n: unread === 1 ? "One letter" : `${unread} letters` }), source: T.tieSource, url: null, fiction: true });
  return lines;
}
