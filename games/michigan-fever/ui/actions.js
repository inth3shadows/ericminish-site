// The action bar. The engine can offer up to ~14 actions in a town or at the
// land office; showing them all at once is a wall of buttons. arrange() keeps
// at most five things on screen: the actions that move the journey on, plus
// groups ("Buy and trade", "Lodging and work", "Enter land", "More") that open
// in place. With the family's own wagon the travel action carries the paces
// (go.paces): they become a "Pace" group, whose items set the pace for the
// travel buttons rather than taking a step. Pure function, so it is easy to
// reason about; render() draws it.

import { money } from "../mechanics/purse.js";
import { el } from "./dom.js";

const MAX_TOP = 5;
const PRIMARY_TYPES = new Set(["start", "choose", "travel", "board", "build", "explore", "wait", "pay", "dose"]);
const PRIMARY_IDS = new Set(["buy-team", "hire-teamster", "hire-looker", "sabbath"]);
const TRADE = new Set(["buy", "sell", "broker"]);
const STAY = new Set(["rest", "work", "letter"]);
const GROUP_LABEL = { land: "Enter land", trade: "Buy and trade", stay: "Lodging and work", post: "Post office", lot: "The town lot", pivot: "Change course", more: "More" };
const PACE_WORD = { steady: "steady", hard: "hard", grueling: "grueling" };

// The pace group: one item per pace, the chosen one marked. Picking one sets
// the pace for the next travel action (`pace` is the UI's choice, or the family's).
export function paceGroup(go, pace) {
  if (!go?.paces) return null;
  const now = pace ?? go.pace ?? "steady";
  return {
    group: "pace", label: `Pace: ${PACE_WORD[now] ?? now}`, enabled: true, reason: null,
    items: go.paces.map((p) => ({ id: `pace-set:${p.pace}`, setPace: p.pace, label: p.label, detail: p.detail, enabled: true, selected: p.pace === now })),
  };
}

const isLandApply = (a) => a.type === "apply" && a.tractId != null;

// Nest land applications by tract (the route gives tractId and tractLabel):
// "prairie, 7 miles out" -> 40 / 80 / 160 acres.
function landItems(applies) {
  if (applies.length <= 3) return applies;
  const byTract = new Map();
  for (const a of applies) {
    if (!byTract.has(a.tractId)) byTract.set(a.tractId, []);
    byTract.get(a.tractId).push(a);
  }
  return [...byTract.values()].map((list) => {
    const enabled = list.some((a) => a.enabled);
    return {
      group: `tract:${list[0].tractId}`,
      label: list[0].tractLabel.charAt(0).toUpperCase() + list[0].tractLabel.slice(1),
      enabled,
      reason: enabled ? null : list[0].reason,
      items: list.map((a) => ({ ...a, label: `${a.acres} acres${a.cost ? ` (${money(a.cost)})` : ""}` })),
    };
  });
}

export function arrange(actions, { pace = null } = {}) {
  const forwardFirst = (list) => [...list.filter((a) => a.forward), ...list.filter((a) => !a.forward)];
  const paces = paceGroup(actions.find((a) => a.id === "go"), pace);
  // The pace group sits right after the actions that move the journey on.
  const withPace = (list) => {
    if (!paces) return list;
    const i = list.filter((a) => a.forward).length;
    return [...list.slice(0, i), paces, ...list.slice(i)];
  };
  const room = MAX_TOP - (paces ? 1 : 0);
  if (actions.length <= room && !actions.some(isLandApply)) return withPace(forwardFirst(actions));
  const top = [];
  const groups = { land: [], trade: [], stay: [], post: [], lot: [], pivot: [], more: [] };
  for (const a of actions) {
    if (isLandApply(a)) groups.land.push(a);
    // The pivots (one-way, each with a confirm) sit together under "Change course".
    else if (a.type === "pivot") groups.pivot.push(a);
    else if (a.type === "lot") groups.lot.push(a);
    else if (a.forward || PRIMARY_TYPES.has(a.type) || PRIMARY_IDS.has(a.id)) top.push(a);
    else if (TRADE.has(a.type)) groups.trade.push(a);
    else if (STAY.has(a.type)) groups.stay.push(a);
    else if (a.type === "post") groups.post.push(a);
    else groups.more.push(a);
  }
  const ordered = forwardFirst(top);
  const used = () => Object.values(groups).filter((g) => g.length).length;
  // Too many on top: the last non-forward ones go into "More".
  while (ordered.length + used() > room) {
    const i = ordered.map((a) => !a.forward).lastIndexOf(true);
    if (i < 0) break;
    groups.more.unshift(...ordered.splice(i, 1));
  }
  // A group of one is just a button, if there is room for it.
  for (const k of ["pivot", "lot", "post", "trade", "stay", "more"]) {
    if (groups[k].length === 1 && ordered.length + used() <= room) {
      ordered.push(groups[k].pop());
    }
  }
  const out = withPace([...ordered]);
  for (const k of ["land", "lot", "pivot", "trade", "stay", "post", "more"]) {
    const list = groups[k];
    if (!list.length) continue;
    const items = k === "land" ? landItems(list) : list;
    const enabled = list.some((a) => a.enabled);
    out.push({ group: k, label: GROUP_LABEL[k], enabled, reason: enabled ? null : list[0].reason, items });
  }
  return out;
}

// A button's words: the action's label, or a plain fallback, never "undefined" (PB3).
export function choiceLabel(it) {
  const label = typeof it?.label === "string" && it.label.trim() ? it.label : it?.group ? "More" : "Go on";
  return label + (it?.group ? "\u00a0…" : "");
}

// Render a list (top level or an opened group) into `box`. Returns the
// buttons in key order (1..9), plus the Back button if this is a group.
export function render(box, items, { onPick, onOpen, onBack, title }) {
  const buttons = [];
  const nodes = [];
  if (title) nodes.push(el("p", { class: "mf-group-title" }, title));
  items.forEach((it, i) => {
    const n = i + 1;
    const b = el("button", {
      class: `mf-choice${it.group ? " is-group" : ""}${it.forward ? " is-forward" : ""}${it.selected ? " is-selected" : ""}`,
      type: "button",
      "data-id": it.id ?? null,
      "data-group": it.group ?? null,
      "data-ids": it.group ? flatIds(it.items).join(" ") : null,
      "aria-disabled": it.enabled === false ? "true" : null,
      "aria-pressed": it.setPace ? String(Boolean(it.selected)) : null,
    });
    const keyHint = n <= 9 ? el("span", { class: "mf-key", "aria-hidden": "true" }, String(n)) : null;
    const text = el("span", { class: "mf-choice-text" }, el("span", { class: "mf-choice-label" }, choiceLabel(it)));
    const sub = it.enabled === false ? it.reason : it.detail;
    if (sub) text.append(el("span", { class: "mf-choice-sub" }, sub));
    b.append(...[keyHint, text].filter(Boolean));
    b.addEventListener("click", () => {
      if (it.enabled === false) return;
      if (it.group) onOpen(it);
      else onPick(it);
    });
    buttons.push(b);
    nodes.push(b);
  });
  if (onBack) {
    const back = el("button", { class: "mf-choice is-back", type: "button" }, el("span", { class: "mf-key", "aria-hidden": "true" }, "Esc"), el("span", { class: "mf-choice-text" }, el("span", { class: "mf-choice-label" }, "Back")));
    back.addEventListener("click", onBack);
    nodes.push(back);
  }
  box.replaceChildren(...nodes);
  return buttons;
}

function flatIds(items) {
  return items.flatMap((x) => (x.items ? flatIds(x.items) : [x.id]));
}
