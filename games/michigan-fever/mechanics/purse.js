// The purse: hard money (coin, specie) and paper notes tracked by issuing
// region. Paper loses value the farther west it travels from its bank.
// All amounts are integer cents. No DOM.

export const REGIONS = ["ne", "ny", "mi"];
export const REGION_LABEL = { ne: "New England notes", ny: "New York notes", mi: "Michigan notes" };

export const cents = (dollars) => Math.round(dollars * 100);
export const dollars = (c) => c / 100;
export const money = (c) => `$${(c / 100).toFixed(2)}`;

export function emptyPurse() {
  return { coin: 0, notes: { ne: 0, ny: 0, mi: 0 } };
}

export function zoneOf(state, num) {
  const key = state.phase === "travel" ? state.leg : state.place;
  return num(`zone.${key}`);
}

// Fraction lost on a note of `region` at zone `zone`.
export function discount(region, zone, num) {
  const issuer = num(`zone.issuer.${region}`);
  if (region === "mi") return zone < issuer ? num("disc.miEast") : 0;
  return Math.min(num("disc.max"), Math.max(0, zone - issuer) * num("disc.perZone"));
}

export function noteValue(state, num, region, zone = zoneOf(state, num)) {
  return Math.floor(state.purse.notes[region] * (1 - discount(region, zone, num)));
}

export function paperValue(state, num) {
  return REGIONS.reduce((a, r) => a + noteValue(state, num, r), 0);
}

// What everything in the purse would buy here.
export function valueHere(state, num) {
  return state.purse.coin + paperValue(state, num);
}

// Regions ordered worst-first (largest discount here), so merchants are paid
// in the paper the family least wants to keep.
function worstFirst(state, num) {
  const zone = zoneOf(state, num);
  return REGIONS.filter((r) => state.purse.notes[r] > 0)
    .sort((a, b) => discount(b, zone, num) - discount(a, zone, num));
}

// Pay a merchant `amount` cents: paper first at its local value, then coin.
// Returns false (and changes nothing) if the purse cannot cover it.
export function pay(state, num, amount, { coinOnly = false } = {}) {
  if (amount <= 0) return true;
  if ((coinOnly ? state.purse.coin : valueHere(state, num)) < amount) return false;
  let left = amount;
  if (!coinOnly) {
    const zone = zoneOf(state, num);
    for (const r of worstFirst(state, num)) {
      if (left <= 0) break;
      const d = discount(r, zone, num);
      const cover = Math.min(left, Math.floor(state.purse.notes[r] * (1 - d)));
      if (cover <= 0) continue;
      const face = Math.min(state.purse.notes[r], Math.ceil(cover / (1 - d)));
      state.purse.notes[r] -= face;
      left -= cover;
    }
  }
  state.purse.coin -= left;
  return true;
}

export function canPay(state, num, amount, opts = {}) {
  return (opts.coinOnly ? state.purse.coin : valueHere(state, num)) >= amount;
}

export function receive(state, kind, amount) {
  if (kind === "coin") state.purse.coin += amount;
  else state.purse.notes[kind] += amount;
}

// Lose a share of the face value of one region's notes (or the worst-held).
export function loseNotes(state, num, region, share) {
  const r = region === "worst" ? worstFirst(state, num)[0] : region;
  if (!r) return 0;
  const lost = Math.floor(state.purse.notes[r] * share);
  state.purse.notes[r] -= lost;
  return lost;
}

// A broker buys paper for coin at the local discount plus a fee, up to the
// coin he has on hand. Returns the coin paid.
export function brokerToCoin(state, num, capCents) {
  const zone = zoneOf(state, num);
  let coinPaid = 0;
  for (const r of worstFirst(state, num)) {
    const rate = 1 - discount(r, zone, num) - num("broker.fee");
    if (rate <= 0) continue;
    const room = capCents - coinPaid;
    if (room <= 0) break;
    const coinForAll = Math.floor(state.purse.notes[r] * rate);
    const coin = Math.min(room, coinForAll);
    const face = coin === coinForAll ? state.purse.notes[r] : Math.ceil(coin / rate);
    state.purse.notes[r] -= Math.min(face, state.purse.notes[r]);
    coinPaid += coin;
  }
  state.purse.coin += coinPaid;
  return coinPaid;
}

// Swap eastern notes for Michigan notes (at Detroit or Bronson). Returns the
// Michigan face value received.
export function brokerToMichigan(state, num) {
  const zone = zoneOf(state, num);
  let got = 0;
  for (const r of ["ne", "ny"]) {
    const face = state.purse.notes[r];
    if (!face) continue;
    got += Math.floor(face * (1 - discount(r, zone, num) - num("broker.fee")));
    state.purse.notes[r] = 0;
  }
  state.purse.notes.mi += got;
  return got;
}

// ---- the land office --------------------------------------------------------
// Before the deadline an actual settler buying no more than the settler limit
// may pay in "the kind of money heretofore received": here coin, Michigan
// notes at par, and New York notes only if this receiver takes them. Distant
// New England notes are refused. After the deadline: coin only.

export function landTender(state, num, acres, receiverTakesNY, beforeDeadline) {
  const paperOk = beforeDeadline && acres <= num("land.settlerMax");
  return {
    coin: state.purse.coin,
    mi: paperOk ? state.purse.notes.mi : 0,
    ny: paperOk && receiverTakesNY ? state.purse.notes.ny : 0,
  };
}

export function tenderTotal(t) {
  return t.coin + t.mi + t.ny;
}

// Pay the Receiver. With useNotes, acceptable notes go first (at par), coin
// makes up the rest. Returns false if it cannot be covered.
export function payLand(state, num, amount, { useNotes, tender }) {
  const avail = useNotes ? tenderTotal(tender) : tender.coin;
  if (avail < amount) return false;
  let left = amount;
  if (useNotes) {
    for (const r of ["mi", "ny"]) {
      const use = Math.min(left, tender[r]);
      state.purse.notes[r] -= use;
      left -= use;
    }
  }
  state.purse.coin -= left;
  return true;
}

export function summary(state, num) {
  const zone = zoneOf(state, num);
  return {
    coin: state.purse.coin,
    notes: REGIONS.map((r) => ({
      region: r,
      label: REGION_LABEL[r],
      face: state.purse.notes[r],
      value: noteValue(state, num, r, zone),
      discount: discount(r, zone, num),
    })),
    valueHere: valueHere(state, num),
  };
}
