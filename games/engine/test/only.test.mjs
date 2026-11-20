// A choice with "only" is offered only while its condition holds (P2: the post
// office shows a "send money" choice only for the ties the family has). Unlike
// "requires", a choice that fails "only" is not shown greyed out: it is not there.

import test from "node:test";
import assert from "node:assert/strict";
import { availableActions, makeCtx, newGame, step } from "../engine.js";
import { choiceList, validateDeck } from "../events.js";
import { createState } from "../state.js";

const note = { text: "n", source: "s", url: null, confidence: "invented" };

function fixture() {
  const route = {
    id: "fixture", version: 1, num: () => 1, checkEnd: () => null, startDate: () => "1836-10-01",
    events: [{
      id: "office", deck: "post", text: "The post office.", note,
      choices: [
        { id: "ask", label: "Ask for letters", only: { flag: "!asked" }, effects: [{ flag: "asked" }] },
        { id: "send", label: "Send money", only: { flag: "owes" }, requires: { flag: "rich" }, why: "Too poor." },
        { id: "leave", label: "Leave" },
      ],
    }],
    init(ctx) { ctx.state.phase = "town"; },
    actions: () => [{ id: "post", type: "post", label: "Go to the post office" }],
    act(ctx) { ctx.startEvent("office"); },
  };
  return route;
}

test("only: a choice whose condition fails is left out, not greyed", () => {
  const route = fixture();
  const s = createState({ routeId: "fixture", routeVersion: 1, seed: "s", date: "1836-10-01" });
  const ctx = makeCtx(route, s);
  const ev = route.events[0];
  assert.deepEqual(choiceList(ev, ctx, {}).map((c) => c.id), ["ask", "leave"]);
  s.flags.owes = true;
  assert.deepEqual(choiceList(ev, ctx, {}).map((c) => [c.id, c.enabled]), [["ask", true], ["send", false], ["leave", true]]);
  s.flags.asked = true;
  assert.deepEqual(choiceList(ev, ctx, {}).map((c) => c.id), ["send", "leave"]);
});

test("only: availableActions and step agree with the choice beat", () => {
  const route = fixture();
  let { state } = newGame(route, { seed: "o" });
  const r = step(route, state, "post");
  assert.deepEqual(r.beats.find((b) => b.type === "choice").choices.map((c) => c.id), ["ask", "leave"]);
  assert.deepEqual(availableActions(route, r.state).map((a) => a.id), ["choose:ask", "choose:leave"]);
  const hidden = step(route, r.state, "choose:send");
  assert.equal(hidden.beats[0].type, "error", "a hidden choice cannot be taken");
  state = step(route, r.state, "choose:ask").state;
  assert.equal(state.flags.asked, true);
});

test("validateDeck: 'only' conditions are checked, and a deck needs one choice open to everyone", () => {
  const route = fixture();
  assert.deepEqual(validateDeck(route), []);
  route.events[0].choices[0].only = { nonsense: 1 };
  assert.match(validateDeck(route).join("\n"), /office\.ask: unknown condition nonsense/);
  route.events[0].choices[0].only = { flag: "x" };
  route.events[0].choices[2].only = { flag: "y" };
  assert.match(validateDeck(route).join("\n"), /every choice has a requirement/);
});
