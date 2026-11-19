// One journey on screen at a time. Every awaited step of the playback chain
// (a scene change, a pause, the player's Continue) goes through the journey
// that started it. begin() cancels the journey before it: that journey's
// pending waits reject with Cancelled at once, and any wait it starts later
// rejects too, so an old play() stops at its next await and writes nothing.
// The player's Continue resolves only the current journey's waiter.
// DOM-free and timer-free, so it is tested in node (test/journey.test.mjs).

export class Cancelled extends Error {
  constructor() {
    super("this journey was replaced by a new one");
    this.name = "Cancelled";
  }
}

function createJourney(id) {
  let cancelled = false;
  let waiter = null; // { resolve, reject } for the one Continue this journey waits on
  const onCancel = new Set();
  const j = {
    id,
    get live() {
      return !cancelled;
    },
    // Throws Cancelled once the journey has been replaced.
    check() {
      if (cancelled) throw new Cancelled();
    },
    // Waits for p; rejects with Cancelled as soon as the journey is replaced,
    // whether p has settled or not. A live journey gets p's value or error.
    settle(p) {
      if (cancelled) return Promise.reject(new Cancelled());
      return new Promise((resolve, reject) => {
        const stop = () => reject(new Cancelled());
        onCancel.add(stop);
        Promise.resolve(p).then(
          (v) => {
            onCancel.delete(stop);
            if (cancelled) reject(new Cancelled());
            else resolve(v);
          },
          (e) => {
            onCancel.delete(stop);
            reject(cancelled ? new Cancelled() : e);
          },
        );
      });
    },
    // Waits for the player's Continue. A new wait replaces this journey's own
    // earlier one (that one is left pending, as before); it never touches another journey's.
    wait() {
      if (cancelled) return Promise.reject(new Cancelled());
      return new Promise((resolve, reject) => {
        waiter = { resolve, reject };
      });
    },
    get waiting() {
      return Boolean(waiter) && !cancelled;
    },
    // Resolves this journey's waiter, if it is live and waiting.
    advance() {
      if (cancelled || !waiter) return false;
      const w = waiter;
      waiter = null;
      w.resolve();
      return true;
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      const w = waiter;
      waiter = null;
      w?.reject(new Cancelled());
      for (const stop of onCancel) stop();
      onCancel.clear();
    },
  };
  return j;
}

export function createJourneys() {
  let n = 0;
  let current = null;
  return {
    // Cancels the current journey and starts the next.
    begin() {
      current?.cancel();
      n += 1;
      current = createJourney(n);
      return current;
    },
    get current() {
      return current;
    },
    waiting: () => Boolean(current?.waiting),
    advance: () => Boolean(current?.advance()),
  };
}

// For promises nobody awaits (a light change on a timer): a cancelled journey is
// not an error; anything else is reported.
export function quiet(p, report = console.error) {
  return Promise.resolve(p).catch((e) => {
    if (!(e instanceof Cancelled)) report(e);
  });
}
