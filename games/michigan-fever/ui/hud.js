// The heads-up display: two quiet corners. Top left: date, place, the leg, and
// the family. Top right: the purse (coin against paper), the deadline, and the
// sound / full-screen / menu buttons. The purse button opens a detail sheet
// with supplies, gear, each region's notes, the land, what the family left
// behind at home, and today's prices.

import { money } from "../mechanics/purse.js";
import { el, icon } from "./dom.js";

const ILLNESS = { ague: "fever and ague", dysentery: "dysentery", injury: "injured", cholera: "cholera" };
const ROLE = { father: "father", mother: "mother", son: "son", daughter: "daughter", widow: "mother" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// The deadline line: how long the land office still takes paper. Pure, for tests.
// On 15 December itself paper is still taken: that is the last day, not "0 days".
export function deadlineText(d, { snow = false, small = false } = {}) {
  if (d.passed) return "The land office takes only coin now";
  const n = d.daysLeft;
  if (snow) return `Snow has come · paper taken ${n === 0 ? "today, the last day" : n === 1 ? "1 more day" : `${n} more days`}`;
  const left = n === 0 ? "last day" : n === 1 ? "1 day" : `${n} days`;
  if (small) return `Paper taken for land until 15 Dec · ${left}`;
  return `Land office takes paper until 15 Dec · ${left}`;
}

function mood(m) {
  if (m >= 70) return "in good heart";
  if (m >= 45) return "tired but steady";
  if (m >= 25) return "low";
  return "worn down";
}

const TIRED = { tired: "tired", worn: "worn out" };
const TIE_STATUS = { open: "not yet paid", settled: "money sent", lost: "money lost in the mail" };

// Fatigue in words (the route's own thresholds, view.party[].tired), with the number.
function fatigueWords(f, tired) {
  return tired ? `${TIRED[tired]} (${f})` : f > 0 ? `rested (${f})` : "rested";
}

function personLine(p) {
  if (p.status === "dead") return "died";
  const tired = p.tired ? `, ${TIRED[p.tired]}` : "";
  if (p.status === "sick") return `${ILLNESS[p.illness] ?? "sick"}${p.health < 35 ? ", very weak" : ""}${tired}`;
  return `well${tired}`;
}

export function createHud(root, handlers) {
  const left = el("div", { class: "mf-hud mf-hud-left" });
  const date = el("p", { class: "mf-date" });
  const place = el("p", { class: "mf-place" });
  const trip = el("p", { class: "mf-trip" });
  const family = el("ul", { class: "mf-family", "aria-label": "Family" });
  // The always-visible toggle: the HUD folds to the date and place, and this brings the rest back.
  const fold = el("button", { class: "mf-hud-toggle", type: "button", "aria-expanded": "true", "aria-label": "Hide the purse, family and deadline" }, el("span", { class: "mf-hud-toggle-text" }, "Less"), icon("chev"));
  const when = el("div", { class: "mf-where" }, date, fold);
  left.append(when, place, trip, family);

  const right = el("div", { class: "mf-hud mf-hud-right" });
  const purse = el("button", { class: "mf-purse", type: "button", "aria-expanded": "false", "aria-controls": "mf-sheet" });
  const deadline = el("p", { class: "mf-deadline" });
  const tools = el("div", { class: "mf-tools" });
  const sound = el("button", { class: "mf-icon", type: "button" });
  const full = el("button", { class: "mf-icon", type: "button", "aria-label": "Full screen" }, icon("full"));
  const menu = el("button", { class: "mf-icon", type: "button", "aria-label": "Menu (Esc)" }, icon("menu"));
  tools.append(sound, full, menu);
  right.append(tools, purse, deadline);

  const sheet = el("aside", { class: "mf-sheet", id: "mf-sheet", "aria-label": "Supplies and purse", hidden: "" });
  const band = el("div", { class: "mf-band", "aria-hidden": "true" }); // the extra shade the full HUD needs
  root.prepend(band);
  root.append(left, right, sheet);

  purse.addEventListener("click", () => toggleSheet());
  sound.addEventListener("click", () => handlers.onSound());
  full.addEventListener("click", () => handlers.onFullscreen());
  menu.addEventListener("click", () => handlers.onMenu());
  if (!document.fullscreenEnabled) full.hidden = true;

  // On a phone the purse and the deadline move under the date and place, so
  // everything reads in one column beside the buttons.
  const phone = globalThis.matchMedia?.("(max-width: 640px)");
  const place_ = () => {
    if (phone?.matches) {
      left.insertBefore(purse, family);
      left.insertBefore(deadline, family);
    } else right.append(purse, deadline);
    if (lastView) render(lastView, lastActions);
  };
  phone?.addEventListener?.("change", place_);

  let lastView = null;
  let lastActions = [];

  // Folding. Open while the pointer (a mouse) is over the HUD or focus is in
  // it; otherwise it folds a few seconds after the last reason to be open.
  // Phones start folded. The fade itself is CSS, and reduced motion drops it.
  let open = true;
  let hovering = false;
  let byHover = false; // open only because a mouse is over it: a click then keeps it open
  let foldTimer = 0;
  let lastKey = "";
  const focusIn = () => left.contains(document.activeElement) || right.contains(document.activeElement) || !sheet.hidden;
  function setOpen(v) {
    if (!v) byHover = false;
    open = v;
    root.classList.toggle("hud-min", !v);
    fold.setAttribute("aria-expanded", String(v));
    fold.setAttribute("aria-label", v ? "Hide the purse, family and deadline" : "Show the purse, family and deadline");
    fold.firstChild.textContent = v ? "Less" : "More";
  }
  function later(ms) {
    clearTimeout(foldTimer);
    foldTimer = setTimeout(() => {
      if (!hovering && !focusIn()) setOpen(false);
      else later(2500);
    }, ms);
  }
  function showFor(ms = 6000) {
    setOpen(true);
    later(ms);
  }
  for (const zone of [left, right]) {
    zone.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "mouse") return;
      hovering = true;
      if (!open) byHover = true;
      setOpen(true);
    });
    zone.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse") return;
      hovering = false;
      later(2500);
    });
    zone.addEventListener("focusin", () => setOpen(true));
    zone.addEventListener("focusout", () => later(2500));
  }
  fold.addEventListener("click", () => {
    if (open && !byHover) {
      clearTimeout(foldTimer);
      setOpen(false);
    } else showFor(8000);
    byHover = false;
  });

  function toggleSheet(force) {
    const open = force ?? sheet.hidden;
    sheet.hidden = !open;
    if (open) setOpen(true);
    else later(4000);
    purse.setAttribute("aria-expanded", String(open));
    if (open && lastView) fillSheet(lastView, lastActions);
    return open;
  }

  function fillSheet(v, actions) {
    const rows = [];
    const sec = (title, lines, cls = null) => {
      rows.push(el("h3", {}, title));
      const dl = el("dl", { class: cls });
      for (const [k, val] of lines) dl.append(el("dt", {}, k), el("dd", {}, val));
      rows.push(dl);
    };
    const notes = v.purse.notes.filter((n) => n.face > 0);
    sec("Purse", [
      ["Coin", money(v.purse.coin)],
      ...notes.map((n) => [n.label, n.value !== n.face ? `${money(n.face)} face, worth ${money(n.value)} here (${Math.round((1 - n.value / n.face) * 100)}% off)` : `${money(n.face)}, taken at face value here`]),
      ["All of it, here", money(v.purse.valueHere)],
    ]);
    const team = v.gear.team
      ? `${v.gear.team === "horse" ? "a horse" : "a yoke of oxen"}${v.gear.short ? " short an animal" : ""}${v.gear.wagon ? `, wagon ${v.gear.wagonCond}%` : ""}; ${fatigueWords(v.gear.fatigue, v.gear.tired)}`
      : v.gear.teamster ? "a hired teamster" : "none";
    const supplies = [
      ["Food", v.food.days > 0 ? `about ${v.food.days} day${v.food.days === 1 ? "" : "s"}` : "none left"],
      ["Quinine", v.quinine ? `${v.quinine} dose${v.quinine === 1 ? "" : "s"}` : "none"],
      ["Spirits", mood(v.morale)],
      ["Team", team],
    ];
    if (v.paceApplies) supplies.push(["Pace", `${pacing(v)} (worn out at ${v.fatigue.high})`]);
    sec("Supplies", supplies);
    const land = v.land;
    const landLines = [["Deadline", `${shortDate(v.deadline.date)}${v.deadline.passed ? ", passed" : `, ${v.deadline.daysLeft} days`}`]];
    if (land.paid) landLines.push(["Entered", `${land.acres} acres, ${land.tract?.label ?? ""}`], ["Cabin", `${land.shelter}% built`]);
    else if (land.applied) landLines.push(["Applied", `${land.applied.acres} acres, ${land.applied.label}`]);
    else if (land.candidates.length) landLines.push(["Tracts seen", String(land.candidates.length)]);
    if (land.looker) landLines.push(["Land looker", "hired"]);
    sec("Land", landLines);
    sec("Family", v.party.map((p) => [`${p.name}, ${p.age}`, `${ROLE[p.role] ?? p.role}, ${personLine(p)}${p.status === "dead" ? "" : `; fatigue ${p.fatigue}`}`]));
    // What the family left behind at home: the ties, what is owed, and any news that has reached them.
    if (v.ties?.length) {
      sec("Left behind", v.ties.map((t) => [t.label, `${money(t.amount)}, ${TIE_STATUS[t.status] ?? t.status}${t.news ? `. News from home: ${t.news}` : ""}`]), "is-stacked");
    }
    const priced = actions.filter((a) => a.cost > 0);
    if (priced.length) sec("Prices here", priced.map((a) => [a.label.replace(/\s*\(\$[\d,.]+\)\s*$/, ""), money(a.cost)]));
    const close = el("button", { class: "mf-link", type: "button" }, "Close");
    close.addEventListener("click", () => toggleSheet(false));
    sheet.replaceChildren(...rows, close);
  }

  // The pace shown: the one the player has just set in the pace group, else the family's.
  let paceShown = null;
  const pacing = (v) => paceShown ?? v.pace;

  function render(v, actions = [], { pace = null } = {}) {
    lastView = v;
    lastActions = actions;
    paceShown = pace;
    // Come forward when the family's situation changes: a new place, or someone falls ill or dies.
    const key = `${v.place}|${v.travel?.leg ?? ""}|${v.party.map((p) => p.status).join("")}`;
    if (lastKey && key !== lastKey && !phone?.matches) showFor(6000);
    lastKey = key;
    const small = Boolean(phone?.matches);
    date.textContent = small ? shortDate(v.date) : v.dateLabel;
    place.textContent = v.travel ? `Toward ${v.travel.nextLabel}` : v.placeLabel ? v.placeLabel[0].toUpperCase() + v.placeLabel.slice(1) : "";
    if (v.travel) {
      const unit = v.travel.unit === "days" ? "days" : small ? "mi" : "miles";
      trip.textContent = `${v.travel.label} · ${v.travel.done} of ${v.travel.of} ${unit}${v.paceApplies ? ` · ${pacing(v)} pace` : ""}`;
    } else trip.textContent = "";
    trip.hidden = !v.travel;
    family.replaceChildren(
      ...v.party.map((p) => {
        const li = el("li", { class: `is-${p.status}` });
        li.append(el("span", { class: "mf-name" }, p.name));
        if (p.status !== "well") li.append(el("span", { class: "mf-status" }, p.status === "dead" ? "died" : ILLNESS[p.illness] ?? "sick"));
        if (p.status !== "dead" && p.tired) li.append(el("span", { class: `mf-tired is-${p.tired}` }, TIRED[p.tired]));
        return li;
      }),
    );
    const paperFace = v.purse.notes.reduce((a, n) => a + n.face, 0);
    const paperValue = v.purse.notes.reduce((a, n) => a + n.value, 0);
    purse.replaceChildren(
      el("span", { class: "mf-coin" }, el("span", { class: "mf-k" }, "Coin "), money(v.purse.coin)),
      el(
        "span",
        { class: "mf-paper" },
        el("span", { class: "mf-k" }, "Paper "),
        money(paperFace),
        paperFace && paperValue !== paperFace ? el("span", { class: "mf-worth" }, ` worth ${money(paperValue)}`) : "",
      ),
    );
    purse.setAttribute("aria-label", `Purse: ${money(v.purse.coin)} coin, ${money(paperFace)} in paper worth ${money(paperValue)} here. Show supplies and prices.`);
    deadline.textContent = deadlineText(v.deadline, { snow: v.winterWarning != null, small });
    if (!sheet.hidden) fillSheet(v, actions);
  }
  place_();
  if (phone?.matches) setOpen(false);
  else later(7000);

  return {
    left,
    right,
    sheet,
    toggleSheet,
    fold: (v) => (v ? showFor(8000) : setOpen(false)),
    setSound(muted) {
      sound.replaceChildren(icon(muted ? "mute" : "sound"));
      sound.setAttribute("aria-label", muted ? "Sound is off. Turn sound on" : "Sound is on. Turn sound off");
      sound.setAttribute("aria-pressed", String(!muted));
    },
    hide(hidden) {
      left.hidden = hidden;
      purse.hidden = hidden;
      deadline.hidden = hidden;
    },
    render,
  };
}
