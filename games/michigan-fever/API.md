# Michigan Fever: engine and route API for the UI

The game logic is finished and tested (`node --test games/*/test/*.test.mjs`). The UI renders what it is given
and sends back the player's choice. It does not compute rules, money, dates or outcomes itself.

Everything below is plain ES modules with no DOM and no build step. All paths are site-absolute.

## Modules

```js
import { loadRoute, SCENES } from "/games/michigan-fever/route.js";
import { newGame, step, availableActions, view } from "/games/engine/engine.js";
import { saveGame, loadGame, hasSave, clearSave, serialize, deserialize } from "/games/engine/save.js";
import { money } from "/games/michigan-fever/mechanics/purse.js"; // cents -> "$14.52"
```

| Call | Returns | Notes |
|---|---|---|
| `await loadRoute()` | `route` | Fetches `data/numbers.json`, `events.json`, `backgrounds.json`, `text.json` next to `route.js`. Throws if a file fails to load. Load once. |
| `newGame(route, { seed })` | `{ state, beats }` | `seed` is any string. The same seed and the same choices give the same game. |
| `availableActions(route, state)` | `Action[]` | What the player can do now. Pure: it never changes `state`. Empty once the game is over. |
| `step(route, state, action)` | `{ state, beats }` | `action` is an object from `availableActions` (or just its `id`). Returns a **new** state; the old one is untouched. |
| `view(route, state)` | `View` | HUD data (date, place, purse, family, land, deadline). Plain JSON. |
| `saveGame(state, { slot })` | `boolean` | `slot` is `"auto"` (default) or `"main"`. `false` if storage is missing, full or blocked (private mode). Never throws. |
| `loadGame(route, { slot })` | `{ ok: true, state }` or `{ ok: false, reason }` | Reasons: `"no storage"`, `"empty"`, `"unreadable"`, `"unknown format"`, `"different route"`, `"old engine version"`, `"old route version"`, `"damaged"` (the state is not shaped like a game state, or the route's view or actions throw on it). |
| `hasSave(route.id, { slot })`, `clearSave(route.id, { slot })` | `boolean` | Storage keys are `trail:michigan-fever:auto` and `trail:michigan-fever:main`. |
| `serialize(state)` / `deserialize(route, text)` | string / like `loadGame` | For a copy-paste or file export, if wanted. |

The state is one JSON object. Keep it opaque: read it through `view()`. The UI must never edit it.

## The loop

```js
const route = await loadRoute();
let { state, beats } = newGame(route, { seed });
render(beats);                       // intro narration, the farm scene, the Specie Circular note
for (;;) {
  const actions = availableActions(route, state);   // [] when state.over
  const chosen = await playerPicks(actions);          // only offer enabled ones as buttons
  ({ state, beats } = step(route, state, chosen));
  render(beats);
  saveGame(state);                                    // autosave every step is cheap and safe
  if (state.over) break;
}
```

`step` with an action that is not on offer returns the **same** state and one `error` beat. Treat that as a UI bug.

## Actions

```ts
type Action = {
  id: string;          // send this back, e.g. "go", "board:packet", "choose:duck"
  type: string;        // see table; use it to group or style buttons
  label: string;       // button text, already written (may include a price)
  enabled: boolean;    // false: show greyed out with `reason`, or hide
  reason?: string;     // why it is disabled
  detail?: string;     // one more line of explanation, optional
  cost?: number;       // cents, when the action costs money
  days?: number;       // days it will take, when it takes time
  forward?: boolean;   // true for actions that move the journey on (good default focus)
  remedy?: boolean;    // could get a stuck family moving (sell the team, a broker, quinine); the end check
                       // does not call a family stranded while one is enabled
  // type-specific extras below
};
```

| `type` | When | Extras |
|---|---|---|
| `start` | first screen | `background`, `surname`, `party[{id,name,age,role,sex}]`, `purse{coin, notes{ne,ny,mi}}` (cents), `team`, `skills`, `editable: ["surname","names"]` |
| `choose` | an event is waiting for a choice | `event` (event id), `choice` (choice id) |
| `travel` | on the road or the water; "Set out"; "Go out to the claim" | |
| `rest` | camp, lodging, tents | |
| `board` | Albany (canal), Buffalo (steamer or overland) | |
| `buy`, `sell`, `broker`, `letter`, `work`, `dose`, `repair` | towns, the road, the claim | |
| `explore`, `apply`, `wait`, `pay` | the land office | `apply` has `tractId` (stable for the visit, e.g. `"t2"`), `tractLabel` (e.g. "prairie, 7 miles out, dry, good soil"), `acres`, and `tract` (same as `tractId`, kept for older callers). The UI groups by `tractId`. "Withdraw" is also `type: "apply"` but has no `tractId`. |
| `build` | the claim | |

**Start with player-edited names.** Send the start action with extra fields:

```js
step(route, state, { id: "start:vermont", surname: "Hale", names: { p1: "Asa", p2: "Lydia" } });
```

Names are cleaned by the engine (letters, spaces, `' . -`, at most 24 characters). A blank or missing name
keeps the default. There are three backgrounds: `vermont`, `connecticut`, `widow`.

When `state.pending` is set, `availableActions` returns only that event's choices (`type: "choose"`).

## Beats

`beats` is an ordered list. Render them in order; the UI decides pacing (subtitles, a drawer for notes).

| `type` | Fields | Meaning |
|---|---|---|
| `scene` | `scene` | Change the backdrop. Keys are in `SCENES` (id to one-line description). |
| `weather` | `weather` (`fair`, `rain`, `cold`, `snow`), `terrain?`, `first?` | Today's weather. `first: true` marks the first snow. |
| `narrate` | `text`, `chosen?`, `cue?`, plus cue fields | A line of narration. `chosen: true` echoes the choice the player just made. `cue` tags a line the UI may style: `illness` (`who`, `illness`), `recovered` (`who`), `grief`, `broken`, `tract` (`tract`), `conflict`, `ready`, `receipt`, `shelter` (`pct`). |
| `event` | `id`, `text`, `title?` | An event happens. A `choice` beat usually follows. |
| `choice` | `event`, `choices[{id,label,enabled,reason}]` | The same choices `availableActions` will return, for rendering with the event text. |
| `note` | `text`, `source`, `url` (may be `null`), `confidence` (`solid`, `likely`, `uncertain`, `invented`), and `event` or `about` (`"start"`, `"death"`) | The history note. Show the source and the link. When `confidence` is `uncertain` or `invented` the text already says so. |
| `arrive` | `place`, `label`, `date`, `text`, `passing?` | Reached a place. `passing: true` means passing through (Sandusky, Perrysburg, Marshall). |
| `death` | `who`, `name`, `age`, `cause`, `date`, `place`, `text` | Always followed by `letter`, then `note`. `text` is the factual line. |
| `letter` | `fiction: true`, `label`, `from`, `to`, `date`, `text` | The fictional letter home. **Always show `label`** (it says the letter is fiction). `text` has `\n\n` paragraph breaks. |
| `end` | `outcome`, `won`, `title`, `text`, `score`, `deaths[]`, `epilogue[{text,source,url}]` | The ending. See below. |
| `error` | `message` | The action was not on offer. |

### The death register (user decision; keep this exact form)

A death always arrives as three beats in this order: `death` (a plain factual line: who, when, where, what the
family did), `letter` (labelled fiction), `note` (the history and its source). Render them plainly: no
tombstone art, no score, no player-written epitaph, nothing for the player to type, and no humour. The
family then loses days (a `narrate` beat with `cue: "grief"`).

### The ending

`outcome` is one of `settled` (the win: land paid for and the cabin finished), `roofless` (land, but no
finished cabin when winter closed), `winter` (no land by winter), `deadline` (past 15 December without enough
coin), `stranded`, `lost` (no one survived). `score` is a ledger, not a points total:
`{ acres, shelter: bool, alive, family, money (cents, value here), coin (cents), days }`. Show it as lines.
Do not add the deaths into any score. `epilogue` is sourced history (the Panic of 1837, statehood, the
Potawatomi); show each line with its source.

## View (HUD)

```ts
{
  date: "1836-09-15", dateLabel: "Thursday, 15 September 1836",
  phase: "start" | "travel" | "town" | "office" | "claim" | "over",
  place, placeLabel,
  travel: null | { leg, label, mode: "wagon"|"canal"|"steamer", unit: "miles"|"days", done, of, next, nextLabel, terrain, terrainLabel },
  ticket: null | "packet" | "line-meals" | "line" | "cabin" | "deck",
  purse: { coin, valueHere, notes: [{ region: "ne"|"ny"|"mi", label, face, value, discount }] },  // cents; discount is a fraction
  food: { rations, days, meals },   // days = how long the food lasts at today's family size; meals = the boat ticket feeds the family (packet, line boat with meals, cabin)
  morale, quinine,
  party: [{ id, name, age, role, sex, status: "well"|"sick"|"dead", illness, health, child }],
  surname, background,
  gear: { team: null|"oxen"|"horse", wagon, wagonCond, teamster },
  deadline: { date: "1836-12-15", daysLeft, passed },
  snow: bool, winterWarning: null | daysLeft,   // set once the first snow has fallen
  land: { looker, candidates[{id,kind,label,miles,known,poor}], applied, paid, acres, tract, shelter (0-100), receiverTakesNY, conflicts },
  decisions, over
}
```

The purse is the game's distinctive mechanic: show coin and each region's notes, with the face value and what
the notes are worth here (`value`), so the player sees paper lose value going west.

## Drive on (UI side, no engine change)

`ui/driveon.js` is DOM-free and offers "drive on until something happens" next to the one-day `go` action:

```js
import * as engine from "/games/engine/engine.js";
import { canDriveOn, driveOn } from "/games/michigan-fever/ui/driveon.js";
canDriveOn(engine, route, state);   // { ok, reason? }: refused with food at 3 days or less (unless the passage includes meals), money under $5, or someone sick below 35 health
driveOn(engine, route, state);      // { state, days: [{ beats, state, view }], reason }
```

It calls `step(route, state, "go")` day by day and stops after the first day whose beats include `event`,
`choice`, `arrive`, `death`, `letter`, `note`, `end`, `error` or `scene`, a `narrate` with cue `illness`,
`broken`, `grief`, `conflict` or `ready`, the first snow, low food, money or health, or the deadline crossing
30, 14 or 7 days left; at most 30 days. The last day's beats are the ones that need the player; the UI plays
them in full. `test/driveon.test.mjs` checks that no earlier day needed input and that the result equals
pressing `go` the same number of times.

## Copy rules that apply to the UI

- `tools/lint-copy.py` lints visible text in `.html` files. It flags "really" and "actually" as intensifiers,
  so a static heading reading "What really happened" would fail it. Render that label from JS, or use "What
  happened" / "The history".
- Label each AI-generated scene image ("AI-generated illustration") and the letters as fiction (the `label`
  field does this).
- CSP: no inline `<script>`, no `on*=` attributes, no `eval`; same-origin files only. `index.html` here is a
  stub with the site nav already in place (`tools/check-pages.py` checks it); `ui/main.js` is a placeholder.

## Scenes

`SCENES` (exported from `route.js`) lists every key a `scene` beat can carry, each with a one-line
description for matching to art: `farm`, `road-vermont`, `town-albany`, `canal`, `town-buffalo`, `lake`,
`lake-storm`, `ohio-road`, `black-swamp`, `toledo-strip`, `town-detroit`, `territorial-road`, `land-office`,
`claim-track`, `claim`, `cabin`.

The UI maps scene keys to the 13 paintings in `ui/scene.js` (`ART`, plus `NIGHT` for night variants). In a
tall window (aspect 4:5 or narrower) the painting takes the upper three quarters and pans between two
portrait points per painting (`PORTRAIT`), so figures at both sides come into frame; the manifest's
`focal_point` is used everywhere else.

## Data files (read-only for the UI)

- `data/numbers.json`: every game number, tagged `src` (with `source`, `url`, `confidence`) or `invented`
  (with a reason). A Sources or Credits screen can list the invented ones from here.
- `data/events.json`: the event deck (63 events), each with its note.
- `data/text.json`, `data/backgrounds.json`: narration, letters, endings, family defaults.
