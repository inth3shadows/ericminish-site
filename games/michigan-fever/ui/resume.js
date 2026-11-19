// What the subtitle shows when a saved journey is resumed. The UI's scene
// memory (store.KEYS.meta) belongs to one game, named by its seed; a different
// game's memory must not leak into this one. DOM-free, for tests.

// -> { text, title, kind, pendingEvent }
export function resumeText(state, meta, v) {
  const sameGame = meta?.seed === state.seed;
  const text = state.pending && sameGame && meta.pending ? meta.pending.text : (sameGame && meta.line) || `${v.dateLabel}. ${v.placeLabel}.`;
  return {
    text,
    title: state.pending && sameGame ? meta.pending?.title ?? null : null,
    kind: state.pending ? "event" : "narrate",
    pendingEvent: sameGame ? meta.pending ?? null : null,
  };
}
