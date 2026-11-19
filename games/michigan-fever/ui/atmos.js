// Light and weather over the painting: time-of-day tints (CSS layers that
// cross-fade), drifting mist (CSS), and rain or snow on one canvas.
// Everything stays faint; the paintings carry the scene.
// With reduced motion there are no particles and no mist drift; the tints
// still change, without a fade.

const TINTS = ["dawn", "dusk", "night", "grey", "cold"];

export function createAtmos(root, { reduced }) {
  const tints = Object.fromEntries(
    TINTS.map((t) => {
      const el = document.createElement("div");
      el.className = `mf-tint mf-tint-${t}`;
      root.append(el);
      return [t, el];
    }),
  );
  const mist = document.createElement("div");
  mist.className = "mf-mist";
  root.append(mist);
  const canvas = document.createElement("canvas");
  canvas.className = "mf-fx";
  canvas.setAttribute("aria-hidden", "true");
  root.append(canvas);
  const g = canvas.getContext("2d");

  let kind = "fair"; // fair | rain | snow | storm
  let wind = 0.2; // 0..1
  let parts = [];
  let raf = 0;
  let last = 0;
  let w = 0;
  let h = 0;

  function resize() {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 1.5);
    w = root.clientWidth;
    h = root.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function count() {
    const area = w * h;
    if (kind === "rain") return Math.min(170, Math.round(area / 9000));
    if (kind === "storm") return Math.min(260, Math.round(area / 6000));
    if (kind === "snow") return Math.min(150, Math.round(area / 12000));
    return 0;
  }

  function spawn(anywhere) {
    const snow = kind === "snow";
    return {
      x: Math.random() * (w + 200) - 100,
      y: anywhere ? Math.random() * h : -20 - Math.random() * 60,
      z: 0.4 + Math.random() * 0.6, // depth: nearer is faster, longer, brighter
      r: snow ? 0.7 + Math.random() * 1.6 : 0,
      ph: Math.random() * Math.PI * 2,
    };
  }

  function seed() {
    const n = count();
    parts = Array.from({ length: n }, () => spawn(true));
  }

  function frame(t) {
    raf = 0;
    if (!parts.length) {
      g.clearRect(0, 0, w, h);
      return;
    }
    const dt = Math.min(0.05, (t - (last || t)) / 1000);
    last = t;
    g.clearRect(0, 0, w, h);
    if (kind === "snow") {
      g.fillStyle = "rgba(236, 240, 246, 0.55)";
      for (const p of parts) {
        p.ph += dt * (0.6 + p.z);
        p.y += dt * (18 + 34 * p.z);
        p.x += dt * (wind * 40 * p.z + Math.sin(p.ph) * 10);
        if (p.y > h + 10 || p.x > w + 60) Object.assign(p, spawn(false));
        g.globalAlpha = 0.35 + 0.5 * p.z;
        g.beginPath();
        g.arc(p.x, p.y, p.r * p.z + 0.3, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    } else {
      const slant = 0.12 + wind * 0.45;
      g.lineWidth = 1;
      g.lineCap = "round";
      for (const p of parts) {
        const speed = 620 + 560 * p.z;
        p.y += dt * speed;
        p.x += dt * speed * slant;
        if (p.y > h + 20) Object.assign(p, spawn(false));
        const len = 9 + 15 * p.z;
        g.strokeStyle = `rgba(205, 214, 226, ${(0.06 + 0.16 * p.z).toFixed(3)})`;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - len * slant, p.y - len);
        g.stroke();
      }
    }
    if (!document.hidden) raf = requestAnimationFrame(frame);
  }

  function run() {
    if (raf || reduced() || !parts.length) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    g.clearRect(0, 0, w, h);
  }

  globalThis.addEventListener("resize", () => {
    resize();
    run();
  });
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : run()));
  resize();

  return {
    // tod: dawn | day | dusk | night; mood: the painting's own light.
    setLight(tod, mood) {
      let on = tod;
      if (mood === "night" || mood === "storm") on = null; // the painting is already dark
      else if (mood === "dusk" && tod !== "night") on = null;
      else if (mood === "dawn" && tod === "day") on = null;
      for (const t of ["dawn", "dusk", "night"]) tints[t].classList.toggle("is-on", t === on);
      root.dataset.tod = tod;
    },
    // weather: fair | rain | cold | snow | mist (UI only), plus storm (lake gale). terrain tunes mist.
    setWeather(weather, { terrain = null, storm = false } = {}) {
      const next = storm ? "storm" : weather === "rain" ? "rain" : weather === "snow" ? "snow" : "fair";
      wind = storm ? 0.9 : terrain === "lake" ? 0.55 : weather === "snow" ? 0.35 : 0.2;
      tints.grey.classList.toggle("is-on", next === "rain" || next === "storm" || weather === "cold");
      tints.cold.classList.toggle("is-on", weather === "cold" || weather === "snow");
      const misty = weather === "mist" || weather === "cold" || terrain === "swamp" || terrain === "corduroy" || (weather === "rain" && terrain !== "lake");
      mist.classList.toggle("is-on", misty && !reduced());
      root.dataset.weather = next;
      if (next !== kind) {
        kind = next;
        seed();
      }
      if (parts.length && !reduced()) run();
      else stop();
    },
    weather: () => kind,
    refresh() {
      if (reduced()) {
        stop();
        mist.classList.remove("is-on");
      } else run();
    },
  };
}
