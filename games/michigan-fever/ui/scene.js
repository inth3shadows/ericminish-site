// The backdrop: full-bleed scene art with a slow drift toward the manifest's
// focal point and a cross-fade when the scene changes.
//
// The engine names scenes by key (route.js SCENES); the art set has 13
// paintings. ART maps each key to a painting, NIGHT swaps in a night painting
// where one fits (a lock at night on the canal, a tavern when the family takes
// lodging in town), and anything unknown keeps the current painting.

import { SCENE_FALLBACK } from "../route.js";

const BASE = "/games/michigan-fever/art/";

export const ART = {
  farm: "01-vermont-departure",
  "road-vermont": "02-road-to-albany",
  "town-albany": "03-albany-basin",
  canal: "04-canal-deck",
  "town-buffalo": "06-buffalo-harbor",
  lake: "06-buffalo-harbor",
  "lake-storm": "07-lake-storm",
  "ohio-road": "02-road-to-albany", // no Ohio painting yet: the nearest is the New York hill road
  "black-swamp": "08-black-swamp",
  "toledo-strip": "08-black-swamp", // the Maumee country is the swamp's edge
  "town-detroit": "09-detroit-waterfront",
  "territorial-road": "10-oak-openings",
  "land-office": "12-land-office-crowd",
  "claim-track": "10-oak-openings",
  claim: "13-claim-clearing",
  cabin: "13-claim-clearing", // no cabin painting yet: the clearing at dusk
};

const NIGHT = {
  canal: "05-canal-lock-night",
  "town-albany": "11-tavern-interior",
  "town-buffalo": "11-tavern-interior",
  "town-detroit": "11-tavern-interior",
  "land-office": "11-tavern-interior",
};

// Phone framing. In a tall window a 16:9 painting shows about a third of its
// width, so one focal point cannot hold every figure (the canal has passengers
// at the left and the tow horses at the right). Each painting gets two portrait
// points, x as a percentage of the width, and the drift pans slowly between
// them and back. Chosen by looking at each painting with a 10% grid.
export const PORTRAIT = {
  "01-vermont-departure": [84, 42], // the family at the tailboard, then the ox team and the farmhouse
  "02-road-to-albany": [18, 62], // the ox team and the wagon cover, then the road to the steeple
  "03-albany-basin": [24, 72], // emigrants and the boat runners, then the moored boats
  "04-canal-deck": [12, 92], // the passengers on the roof, then the tow horses and the boy
  "05-canal-lock-night": [30, 76], // the lockkeepers on the beam, then the boat and the far gate
  "06-buffalo-harbor": [30, 76], // the families on deck, then the stack, the cattle and the crowd
  "07-lake-storm": [26, 86], // the huddled pair, then the families clinging to the baggage
  "08-black-swamp": [48, 76], // the oxen in the water, then the man at the wheel
  "09-detroit-waterfront": [74, 34], // the landing crowd, then the steamboats
  "10-oak-openings": [62, 40], // the oxen and the family ahead, then the big oaks
  "11-tavern-interior": [24, 80], // the table and the sleepers, then the fire and the talkers
  "12-land-office-crowd": [82, 30], // the clerk at the window, then the press of men
  "13-claim-clearing": [60, 72], // the family at the fire, then the wagon
};

// Fallback focal points and moods if the manifest cannot be read.
const DEFAULT_META = { focal_point: { x: 50, y: 50 }, mood: "day" };

// A path's new places reuse the paintings (no new art): SCENE_FALLBACK in
// route.js names the scene each new key stands for, night variant included.
export function artFor(sceneKey, tod) {
  const key = ART[sceneKey] || NIGHT[sceneKey] ? sceneKey : SCENE_FALLBACK[sceneKey] ?? sceneKey;
  if (tod === "night" && NIGHT[key]) return NIGHT[key];
  return ART[key] ?? null;
}

export function createScene(root, { reduced, describe }) {
  const meta = new Map();
  const tall = globalThis.matchMedia?.("(max-aspect-ratio: 4/5)");
  const layers = [0, 1].map(() => {
    const wrap = document.createElement("div");
    wrap.className = "mf-layer";
    const img = document.createElement("img");
    img.decoding = "async";
    img.alt = "";
    img.sizes = "100vw";
    wrap.append(img);
    root.append(wrap);
    return { wrap, img, anim: null };
  });
  let front = 0;
  let current = null;
  let token = 0;

  async function loadManifest() {
    try {
      const res = await fetch(BASE + "manifest.json");
      if (!res.ok) return;
      const doc = await res.json();
      for (const s of doc.scenes ?? []) meta.set(s.id, s);
    } catch {
      /* the defaults are fine */
    }
  }

  function info(id) {
    return meta.get(id) ?? DEFAULT_META;
  }

  function drift(layer, id) {
    layer.anim?.cancel();
    const { x, y } = info(id).focal_point ?? DEFAULT_META.focal_point;
    const pts = PORTRAIT[id];
    if (tall?.matches && pts) {
      // Tall window: pan between the two portrait points (the height is not cropped).
      const [a, b] = pts;
      layer.img.style.transformOrigin = "50% 50%";
      layer.img.style.objectPosition = `${a}% 50%`;
      if (reduced()) {
        layer.img.style.transform = "scale(1.02)";
        return;
      }
      layer.anim = layer.img.animate(
        [
          { objectPosition: `${a}% 50%`, transform: "scale(1.02)" },
          { objectPosition: `${b}% 50%`, transform: "scale(1.06)" },
        ],
        { duration: Math.max(20000, Math.abs(b - a) * 600), easing: "ease-in-out", iterations: Infinity, direction: "alternate", delay: 2500 },
      );
      return;
    }
    layer.img.style.objectPosition = `${x}% ${y}%`;
    layer.img.style.transformOrigin = `${x}% ${y}%`;
    if (reduced()) {
      layer.img.style.transform = "scale(1.02)";
      return;
    }
    // Zoom in about the focal point while panning it a little toward the centre.
    const dx = ((50 - x) * 0.05).toFixed(2);
    const dy = ((50 - y) * 0.05).toFixed(2);
    layer.anim = layer.img.animate(
      [
        { transform: "scale(1.03) translate(0, 0)" },
        { transform: `scale(1.11) translate(${dx}%, ${dy}%)` },
      ],
      { duration: 70000, easing: "cubic-bezier(.25,.1,.25,1)", fill: "forwards" },
    );
  }

  async function show(id, sceneKey) {
    if (!id || id === current) return false;
    const my = ++token;
    current = id;
    const next = layers[1 - front];
    const prev = layers[front];
    const m = meta.get(id);
    const big = m?.files?.["1920"] ?? `${id}.webp`;
    const small = m?.files?.["960"] ?? `${id}-960.webp`;
    next.img.srcset = `${BASE}${small} 960w, ${BASE}${big} 1920w`;
    next.img.src = BASE + big;
    next.img.alt = describe(sceneKey) ?? "";
    try {
      await next.img.decode();
    } catch {
      /* show it anyway; the browser will paint when it can */
    }
    if (my !== token) return false;
    drift(next, id);
    next.wrap.classList.add("is-front");
    prev.wrap.classList.remove("is-front");
    front = 1 - front;
    root.dataset.mood = info(id).mood ?? "day";
    return true;
  }

  // Turning a phone re-frames the painting on screen.
  tall?.addEventListener?.("change", () => current && drift(layers[front], current));

  return {
    ready: loadManifest(),
    show,
    mood: () => (current ? info(current).mood ?? "day" : "day"),
    current: () => current,
    pause(paused) {
      for (const l of layers) {
        if (!l.anim) continue;
        if (paused) l.anim.pause();
        else if (!reduced()) l.anim.play();
      }
    },
  };
}
