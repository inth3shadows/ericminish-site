// Tiny DOM helpers. Text always goes in as text nodes (never innerHTML), so
// engine strings and player-typed names cannot inject markup.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false || c === "") continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const SVG = "http://www.w3.org/2000/svg";
const PATHS = {
  sound: ["M4 9h4l5-4v14l-5-4H4z", "M16 8.5a5 5 0 0 1 0 7", "M18.5 6a8.5 8.5 0 0 1 0 12"],
  mute: ["M4 9h4l5-4v14l-5-4H4z", "M16.5 9.5l5 5", "M21.5 9.5l-5 5"],
  full: ["M4 9V4h5", "M15 4h5v5", "M20 15v5h-5", "M9 20H4v-5"],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  exit: ["M10 5H5v14h5", "M14 8l4 4-4 4", "M18 12H9"],
  chev: ["M7 10l5 5 5-5"],
  enter: ["M14 5h5v14h-5", "M9 8l4 4-4 4", "M13 12H4"],
};

export function icon(name) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of PATHS[name] ?? []) {
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
