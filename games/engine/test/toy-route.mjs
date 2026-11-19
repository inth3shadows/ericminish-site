// A small route built only on the engine interface, shaped like the planned
// Rus convoy (boats as units, a choice at each rapid, a market with treaty
// rules). It exists to prove a very different route plugs in with no engine
// changes. Not shipped.

import { addRes } from "../events.js";

const NUMBERS = { "boats.start": 3, "rapids.count": 3, "w.common": 5, "loss.p": 0.5, "silk.cap": 50, "cd.one": 1, "market.days": 2 };

export function toyRoute() {
  const route = {
    id: "toy-convoy",
    version: 1,
    num(id) {
      if (!(id in NUMBERS)) throw new Error(`unknown number: ${id}`);
      return NUMBERS[id];
    },
    limits: { silk: [0, 50] },
    startDate: () => "0950-06-01",
    events: [
      {
        id: "watch", deck: "rapid", weight: "#w.common", cooldown: "#cd.one",
        when: { phase: "river" },
        bind: { boat: { boat: "any" } },
        text: "Riders on the bank near {boat}.",
        choices: [
          { id: "post", label: "Post a watch", effects: [{ flag: "watched" }] },
          { id: "row", label: "Row on", effects: [{ chance: "#loss.p", then: [{ loseBoat: "$boat" }] }] },
        ],
        note: { text: "Toy note.", source: "test", url: null, confidence: "invented" },
      },
    ],
    init(ctx) {
      const s = ctx.state;
      s.phase = "river";
      s.leg = "rapids";
      s.convoy = Array.from({ length: ctx.num("boats.start") }, (_, i) => ({ id: `b${i}`, afloat: true }));
      s.res.silk = 0;
      s.vars.rapid = 0;
    },
    actions(ctx) {
      const s = ctx.state;
      if (s.phase === "river") {
        return [
          { id: "wade", type: "rapid", label: "Wade the boats through" },
          { id: "portage", type: "rapid", label: "Carry them round" },
        ];
      }
      return [{ id: "buy-silk", type: "market", label: "Buy silk", enabled: s.res.silk < ctx.num("silk.cap") }, { id: "sail", type: "travel", label: "Sail home" }];
    },
    act(ctx, a) {
      const s = ctx.state;
      if (a.type === "rapid") {
        ctx.advanceDays(a.id === "portage" ? 2 : 1);
        s.vars.rapid += 1;
        if (s.vars.rapid >= ctx.num("rapids.count")) {
          s.phase = "market";
          ctx.emit({ type: "arrive", place: "market" });
        } else ctx.drawEvent("rapid");
      } else if (a.id === "buy-silk") {
        addRes(ctx, "silk", 100); // clamped by limits
      } else if (a.id === "sail") {
        s.vars.home = true;
      }
    },
    onDay(ctx) { ctx.state.vars.days = (ctx.state.vars.days ?? 0) + 1; },
    checkEnd(ctx) {
      const s = ctx.state;
      if (!s.convoy.some((b) => b.afloat)) return { outcome: "lost", won: false };
      if (s.vars.home) return { outcome: "home", won: true };
      return null;
    },
    ending: (ctx) => ({ boats: ctx.state.convoy.filter((b) => b.afloat).length }),
    conditions: { boats: ([op, n], ctx) => (op === ">" ? ctx.state.convoy.filter((b) => b.afloat).length > n : false) },
    effects: { loseBoat: (id, ctx, vars) => { const b = ctx.state.convoy.find((x) => x.id === id); if (b) b.afloat = false; } },
    binders: { boat: (spec, ctx) => ctx.rng.pick(ctx.state.convoy.filter((b) => b.afloat))?.id ?? null },
    textVar: (name, value) => (name === "boat" ? `boat ${value}` : undefined),
  };
  return route;
}
