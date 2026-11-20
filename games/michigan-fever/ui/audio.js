// Ambient sound, synthesised with Web Audio: no sound files.
// Layers: water, wind, rain, crowd murmur, fire crackle, insects, frogs.
// The mix follows the scene and the weather. Nothing plays until the first
// click or key press (browsers require it), the default level is low, and the
// mute choice is remembered. There are no stingers or effects for events.

import * as store from "./store.js";

const MASTER = 0.32;
const LAYERS = ["water", "wind", "rain", "crowd", "fire", "insects", "frogs"];

function noiseBuffer(ac, seconds, color) {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (color === "brown") {
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    } else if (color === "pink") {
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      d[i] = (b0 + b1 + b2 + white * 0.1848) * 0.18;
    } else d[i] = white * 0.5;
  }
  return buf;
}

export function createAmbience() {
  let ac = null;
  let master = null;
  let duckGain = null;
  let muted = store.get(store.KEYS.muted) === "1";
  const target = Object.fromEntries(LAYERS.map((l) => [l, 0]));
  const layers = {};
  let buffers = null;

  function loop(buf) {
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = 0;
    src.start(0, Math.random() * buf.duration);
    return src;
  }

  function lfo(freq, depth, param) {
    const o = ac.createOscillator();
    o.frequency.value = freq;
    const g = ac.createGain();
    g.gain.value = depth;
    o.connect(g).connect(param);
    o.start();
  }

  function out() {
    const g = ac.createGain();
    g.gain.value = 0;
    g.connect(duckGain);
    return g;
  }

  // Each builder returns the layer's output gain.
  const build = {
    water() {
      const g = out();
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 520;
      const swell = ac.createGain();
      swell.gain.value = 0.7;
      lfo(0.11, 0.3, swell.gain);
      loop(buffers.brown).connect(lp).connect(swell).connect(g);
      const lap = ac.createBiquadFilter();
      lap.type = "bandpass";
      lap.frequency.value = 900;
      lap.Q.value = 1.4;
      const lapG = ac.createGain();
      lapG.gain.value = 0.08;
      lfo(0.37, 0.06, lapG.gain);
      loop(buffers.pink).connect(lap).connect(lapG).connect(g);
      return g;
    },
    wind() {
      const g = out();
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 420;
      bp.Q.value = 0.8;
      lfo(0.06, 220, bp.frequency);
      const gust = ac.createGain();
      gust.gain.value = 0.55;
      lfo(0.045, 0.35, gust.gain);
      loop(buffers.pink).connect(bp).connect(gust).connect(g);
      return g;
    },
    rain() {
      const g = out();
      const hp = ac.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 900;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 6500;
      const lvl = ac.createGain();
      lvl.gain.value = 0.32;
      loop(buffers.white).connect(hp).connect(lp).connect(lvl).connect(g);
      const body = ac.createBiquadFilter();
      body.type = "lowpass";
      body.frequency.value = 1400;
      const bodyG = ac.createGain();
      bodyG.gain.value = 0.5;
      loop(buffers.pink).connect(body).connect(bodyG).connect(g);
      return g;
    },
    crowd() {
      // Several voice-band filters whose levels wander at speech rate.
      const g = out();
      const bands = [310, 520, 760, 1150, 1700].map((f) => {
        const bp = ac.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = f;
        bp.Q.value = 5;
        const vg = ac.createGain();
        vg.gain.value = 0.1;
        loop(buffers.brown).connect(bp).connect(vg).connect(g);
        return vg;
      });
      setInterval(() => {
        if (!ac || target.crowd <= 0) return;
        const t = ac.currentTime;
        for (const vg of bands) vg.gain.linearRampToValueAtTime(0.25 + Math.random() * 0.9, t + 0.12 + Math.random() * 0.2);
      }, 170);
      return g;
    },
    fire() {
      const g = out();
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 180;
      const rumble = ac.createGain();
      rumble.gain.value = 0.45;
      loop(buffers.brown).connect(lp).connect(rumble).connect(g);
      const pops = ac.createBiquadFilter();
      pops.type = "highpass";
      pops.frequency.value = 1300;
      pops.connect(g);
      const crackle = () => {
        if (!ac) return;
        if (target.fire > 0 && ac.state === "running") {
          const t = ac.currentTime;
          const src = ac.createBufferSource();
          src.buffer = buffers.click;
          const cg = ac.createGain();
          cg.gain.setValueAtTime(0.15 + Math.random() * 0.55, t);
          cg.gain.exponentialRampToValueAtTime(0.001, t + 0.02 + Math.random() * 0.05);
          src.playbackRate.value = 0.6 + Math.random() * 1.2;
          src.connect(cg).connect(pops);
          src.start(t);
        }
        setTimeout(crackle, 40 + Math.random() * (Math.random() < 0.15 ? 600 : 220));
      };
      crackle();
      return g;
    },
    insects() {
      // Autumn crickets: short pulse trains on a high tone, a few at different rates.
      const g = out();
      [[4300, 0.9], [4700, 1.3], [3900, 1.7]].forEach(([freq, every], i) => {
        const o = ac.createOscillator();
        o.frequency.value = freq;
        const env = ac.createGain();
        env.gain.value = 0;
        o.connect(env).connect(g);
        o.start();
        const chirp = () => {
          if (!ac) return;
          if (target.insects > 0 && ac.state === "running") {
            const t = ac.currentTime + 0.02;
            for (let k = 0; k < 3; k++) {
              const s = t + k * 0.045;
              env.gain.setValueAtTime(0, s);
              env.gain.linearRampToValueAtTime(0.06, s + 0.008);
              env.gain.linearRampToValueAtTime(0, s + 0.03);
            }
          }
          setTimeout(chirp, (every + Math.random() * 0.3 + i * 0.05) * 1000);
        };
        chirp();
      });
      return g;
    },
    frogs() {
      // An occasional low croak from the standing water.
      const g = out();
      const o = ac.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = 110;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 480;
      const env = ac.createGain();
      env.gain.value = 0;
      o.connect(lp).connect(env).connect(g);
      o.start();
      const croak = () => {
        if (!ac) return;
        if (target.frogs > 0 && ac.state === "running") {
          const t = ac.currentTime + 0.02;
          o.frequency.setValueAtTime(95 + Math.random() * 40, t);
          const pulses = 5 + Math.floor(Math.random() * 6);
          for (let k = 0; k < pulses; k++) {
            const s = t + k * 0.04;
            env.gain.setValueAtTime(0, s);
            env.gain.linearRampToValueAtTime(0.16, s + 0.01);
            env.gain.linearRampToValueAtTime(0, s + 0.032);
          }
        }
        setTimeout(croak, 1800 + Math.random() * 4200);
      };
      croak();
      return g;
    },
  };

  function apply(fade = 2.5) {
    if (!ac) return;
    const t = ac.currentTime;
    for (const name of LAYERS) {
      const want = target[name];
      if (want > 0 && !layers[name]) layers[name] = build[name]();
      if (layers[name]) layers[name].gain.setTargetAtTime(want, t, fade / 3);
    }
  }

  function setMaster(fade = 0.4) {
    if (!master) return;
    master.gain.setTargetAtTime(muted ? 0 : MASTER, ac.currentTime, fade / 3);
  }

  return {
    // Call from a user gesture. Safe to call often.
    unlock() {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return;
      if (!ac) {
        try {
          ac = new AC();
        } catch {
          ac = null;
          return;
        }
        buffers = {
          white: noiseBuffer(ac, 3, "white"),
          pink: noiseBuffer(ac, 4, "pink"),
          brown: noiseBuffer(ac, 5, "brown"),
          click: noiseBuffer(ac, 0.08, "white"),
        };
        master = ac.createGain();
        master.gain.value = 0;
        duckGain = ac.createGain();
        duckGain.gain.value = 1;
        duckGain.connect(master).connect(ac.destination);
        setMaster(3);
        apply(3);
      }
      if (ac.state === "suspended") ac.resume().catch(() => {});
    },
    mix(levels) {
      for (const name of LAYERS) target[name] = Math.max(0, Math.min(1, levels[name] ?? 0));
      apply();
    },
    // Lower the whole bed (for a letter), never a sting.
    duck(amount) {
      if (!duckGain) return;
      duckGain.gain.setTargetAtTime(amount, ac.currentTime, 1.2);
    },
    muted: () => muted,
    setMuted(m) {
      muted = Boolean(m);
      store.set(store.KEYS.muted, muted ? "1" : "0");
      setMaster();
    },
    suspend(hidden) {
      if (!ac) return;
      if (hidden) ac.suspend().catch(() => {});
      else ac.resume().catch(() => {});
    },
  };
}

// The mix for a scene and the day's weather. Levels are 0..1 before the master.
export function mixFor(sceneKey, { tod = "day", weather = "fair", storm = false, snow = false, artId = "" } = {}) {
  const m = { water: 0, wind: 0.22, rain: 0, crowd: 0, fire: 0, insects: 0.12, frogs: 0 };
  const k = sceneKey ?? "";
  if (k.startsWith("town-")) Object.assign(m, { crowd: 0.42, water: 0.16, wind: 0.1, insects: 0 });
  if (k === "canal") Object.assign(m, { water: 0.4, wind: 0.18, insects: 0.1 });
  if (k === "lake") Object.assign(m, { water: 0.65, wind: 0.4, insects: 0 });
  if (k === "lake-storm") Object.assign(m, { water: 0.85, wind: 0.75, insects: 0 });
  if (k === "black-swamp" || k === "toledo-strip") Object.assign(m, { water: 0.12, wind: 0.1, insects: 0.4, frogs: 0.35 });
  if (k === "land-office") Object.assign(m, { crowd: 0.55, wind: 0.14, insects: 0 });
  if (k === "claim" || k === "cabin") Object.assign(m, { wind: 0.26, fire: 0.3, insects: 0.1 });
  if (tod === "night") {
    m.crowd *= 0.35;
    m.insects = m.insects ? m.insects + 0.12 : 0;
    m.fire = Math.max(m.fire, 0.35);
  }
  if (artId === "11-tavern-interior") Object.assign(m, { fire: 0.55, crowd: 0.2, water: 0, wind: 0.06, insects: 0, frogs: 0 });
  if (artId === "05-canal-lock-night") Object.assign(m, { water: 0.55, fire: 0, insects: 0.18 });
  if (weather === "rain" || storm) {
    m.rain = storm ? 0.75 : 0.5;
    m.insects = 0;
    m.frogs *= 0.5;
    m.fire *= 0.5;
  }
  if (weather === "cold" || weather === "snow" || snow) {
    m.insects = 0;
    m.frogs = 0;
    m.wind += 0.12;
  }
  return m;
}
