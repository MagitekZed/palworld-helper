'use strict';

/* ================= data ================= */
const DATA = window.PAL_DATA;
const WORKS = DATA.meta.work_types;
const PALS = DATA.pals; // sorted by paldex, collab pals last
const byName = new Map(PALS.map(p => [p.name, p]));
const dexOrder = new Map(PALS.map((p, i) => [p.name, i]));
const ELEMENTS = ['Neutral', 'Fire', 'Water', 'Grass', 'Electric', 'Ground', 'Ice', 'Dragon', 'Dark'];
// attacker element -> defender elements it deals bonus damage to
// (v1.0 in-game Elements help guide, retrieved via paldb CDN 2026-07-26)
const ELEM_STRONG = {
  Neutral: [], Fire: ['Grass', 'Ice'], Water: ['Fire'], Grass: ['Ground'],
  Electric: ['Water'], Ground: ['Electric'], Ice: ['Dragon'], Dragon: ['Dark'], Dark: ['Neutral'],
};
const PARTY_SIZE = 5;
const CAP_DEFAULT = 15; // default per-base worker cap; editable per base
const CAP_MAX = 50;

/* auto-fill purposes: each preset is a slot-share recipe over the open slots.
   Shares are targets, filled proportionally; if a job runs out of owned pals
   its share spills to the rest. */
const PRESETS = {
  balanced: {
    label: 'Balanced',
    recipe: {
      Handiwork: 0.15, Transporting: 0.15,
      Kindling: 0.085, Watering: 0.085, Planting: 0.085, Gathering: 0.085,
      Mining: 0.085, Lumbering: 0.085, Farming: 0.085, 'Generating Electricity': 0.085,
      Cooling: 0.02,
    },
  },
  mining: { label: 'Mining', recipe: { Mining: 0.6, Transporting: 0.25, Kindling: 0.15 } },
  logging: { label: 'Logging', recipe: { Lumbering: 0.6, Transporting: 0.25, Handiwork: 0.15 } },
  ranch: { label: 'Ranch', recipe: { Farming: 0.7, Transporting: 0.3 } },
  crops: { label: 'Crops', recipe: { Planting: 0.3, Watering: 0.3, Gathering: 0.2, Transporting: 0.15, Cooling: 0.05 } },
  crafting: { label: 'Crafting & power', recipe: { Handiwork: 0.55, Transporting: 0.25, 'Generating Electricity': 0.2 } },
};

/* self-sufficiency ("cover the basics") targets, raw-food playstyle (no cook).
   Food trio is measured in total work LEVELS — one plantation crew feeds ~8
   pals on cooked food (paldb workload data + community measurements), raw-only
   needs ~1.5x, and work speed ~doubles per level, so better pals need fewer
   bodies. The rest are worker counts. */
const BASICS_FOOD_LEVELS = cap => Math.max(1, Math.round(cap * 0.75)); // Planting, Watering, Gathering each
const BASICS_COUNTS = cap => ({
  Transporting: Math.max(1, Math.round(cap / 8)),
  Handiwork: Math.round(cap / 10),
  'Medicine Production': Math.round(cap / 15),
});
const BASICS_COUNT_WEIGHT = 2.5; // one count-slot ≈ this many food levels when scoring multi-job picks

/* Aura pals: partner skills that raise one work suitability level by +1 for
   every OTHER pal at the base (one per work type in v1.0). They don't stack, so
   at most one of each. Derived from the partner data so a re-scrape updates it. */
const AURA_BY_WORK = (() => {
  const m = {};
  for (const p of PALS) {
    const desc = p.partner && p.partner.desc;
    if (!desc) continue;
    for (const hit of desc.matchAll(/increases the (.+?) Work Suitability Level/g)) {
      const w = hit[1].trim();
      if (WORKS.includes(w) && !m[w]) m[w] = p.name;
    }
  }
  return m;
})();
// the purpose's most important jobs that have an aura pal, best share first
const AURA_MAX = 3;
const auraJobsFor = recipe => Object.entries(recipe)
  .sort((a, b) => b[1] - a[1])
  .map(([w]) => w)
  .filter(w => AURA_BY_WORK[w])
  .slice(0, AURA_MAX);
// don't spend half a tiny outpost on auras
const auraBudget = cap => Math.max(1, Math.min(AURA_MAX, Math.floor(cap / 5)));

/* ================= state ================= */
const LS_ROSTER_V1 = 'palplanner.roster.v1'; // legacy: array of owned names
const LS_ROSTER = 'palplanner.roster.v2';    // { name: copies }
const LS_BASES = 'palplanner.bases.v1';      // crew: [{name, qty, seq}] (legacy: array of names / {name, qty})
const LS_UI = 'palplanner.ui.v1';
const LS_BONUS = 'palplanner.bonus5.v1';     // { name: 1 } — 5-catch paldex bonus earned
const LS_PARTY = 'palplanner.party.v1';      // legacy single party — migrated to parties.v1, kept for downgrade safety
const LS_PARTIES = 'palplanner.parties.v1';  // [{id, name, reserve, members: [{name, nickname, level, stars, passives[4]}]}]
const LS_PARTY_MEMO = 'palplanner.partymemo.v1'; // { name: last details } — restored on re-add
const LS_WELCOME = 'palplanner.welcome.v1';   // '1' once the first-run banner is dismissed
const LS_NUDGE = 'palplanner.backupnudge.v1'; // '1' once the backup nudge is dismissed
const BONUS_AT = 5; // catching this many of a species earns its paldex bonus (v1.0)

function lsLoad(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v === null || v === undefined ? fallback : v;
  } catch { return fallback; }
}

/* State loaders. Each is callable again after external localStorage changes
   (another tab via the 'storage' event, or an undo restore) — never mutate the
   returned globals from anywhere but the owning handlers. */

// roster: { name: copies owned }
function loadRoster() {
  const v2 = lsLoad(LS_ROSTER, null);
  const src = v2 !== null ? v2
    : Object.fromEntries(lsLoad(LS_ROSTER_V1, []).map(n => [n, 1]));
  const clean = {};
  for (const [n, q] of Object.entries(src)) {
    const qty = Math.floor(Number(q));
    if (byName.has(n) && qty > 0) clean[n] = qty;
  }
  return clean;
}
let roster = loadRoster();

// 5-catch bonus: sticky — auto-earned when copies reach BONUS_AT, kept when
// copies later drop (condensing/selling doesn't undo the in-game bonus).
function loadBonus() {
  const clean = {};
  for (const n of Object.keys(lsLoad(LS_BONUS, {}))) if (byName.has(n)) clean[n] = 1;
  for (const [n, q] of Object.entries(roster)) if (q >= BONUS_AT) clean[n] = 1;
  return clean;
}
let bonus = loadBonus();

// parties: each holds up to 5 individual pals with hand-tracked details.
// `reserve: true` (the default, and the old single-party behavior) means the
// party's pals are claimed before bases — not counted as free base labor.
function normalizeMember(m) {
  if (!m || !byName.has(m.name)) return null;
  const lvl = Math.floor(Number(m.level));
  const stars = Math.floor(Number(m.stars));
  const passives = Array.isArray(m.passives) ? m.passives.slice(0, 4).map(s => String(s).slice(0, 40)) : [];
  while (passives.length < 4) passives.push('');
  return {
    name: m.name,
    nickname: String(m.nickname || '').slice(0, 30),
    level: Number.isFinite(lvl) && lvl >= 1 ? Math.min(lvl, 100) : 0,
    stars: Number.isFinite(stars) ? Math.max(0, Math.min(stars, 4)) : 0,
    passives,
  };
}
const normalizeParty = (pt, i) => ({
  id: String(pt.id || 'p' + Date.now().toString(36) + i),
  name: String(pt.name || `Party ${i + 1}`).slice(0, 40),
  reserve: pt.reserve !== false,
  members: (Array.isArray(pt.members) ? pt.members : []).map(normalizeMember).filter(Boolean).slice(0, PARTY_SIZE),
});
function loadParties() {
  const v1 = lsLoad(LS_PARTIES, null);
  // non-array valid JSON (hand-edited storage) must not throw — fall through
  if (Array.isArray(v1)) return v1.filter(pt => pt && typeof pt === 'object').map(normalizeParty);
  // migrate the legacy single party (kept in storage untouched for downgrade safety)
  const legacy = lsLoad(LS_PARTY, []).map(normalizeMember).filter(Boolean).slice(0, PARTY_SIZE);
  return legacy.length ? [normalizeParty({ name: 'Party 1', reserve: true, members: legacy }, 0)] : [];
}
let parties = loadParties();
function loadPartyMemo() {
  const clean = {};
  for (const [n, m] of Object.entries(lsLoad(LS_PARTY_MEMO, {}))) {
    const v = normalizeMember({ ...m, name: n });
    if (v) clean[n] = v;
  }
  return clean;
}
let partyMemo = loadPartyMemo();

// accepts legacy ["A","B"] and current [{name, qty, seq}]; merges duplicates.
// seq is the assignment-order stamp that decides who claims copies first —
// merged duplicates keep the EARLIEST seq (first claim wins).
function normalizeCrew(crew) {
  const m = new Map();
  for (const item of crew) {
    const name = typeof item === 'string' ? item : item && item.name;
    const qty = typeof item === 'string' ? 1 : Math.max(1, Math.floor(Number(item && item.qty) || 1));
    const seq = typeof item === 'object' && item && Number.isFinite(Number(item.seq)) ? Number(item.seq) : null;
    if (!byName.has(name)) continue;
    const prev = m.get(name);
    if (prev) {
      prev.qty += qty;
      if (seq !== null && (prev.seq === null || seq < prev.seq)) prev.seq = seq;
    } else m.set(name, { qty, seq });
  }
  return [...m].map(([name, v]) => ({ name, qty: v.qty, ...(v.seq !== null ? { seq: v.seq } : {}) }));
}

function clampCap(n) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v >= 1 ? Math.min(v, CAP_MAX) : CAP_DEFAULT;
}

const normalizeBase = b => ({
  id: String(b.id), name: String(b.name || 'Base'), crew: normalizeCrew(b.crew), cap: clampCap(b.cap),
  purpose: PRESETS[b.purpose] ? b.purpose : 'balanced',
  coverBasics: b.coverBasics !== false,
});

// next assignment-order stamp; entries without one (pre-seq saves and imports)
// get stamped in base-list order, which reproduces the old base-order allocation
let nextSeq = 1;
function stampSeqs(list) {
  let max = 0;
  for (const b of list) for (const e of b.crew) if (e.seq) max = Math.max(max, e.seq);
  nextSeq = max + 1;
  for (const b of list) for (const e of b.crew) if (!e.seq) e.seq = nextSeq++;
  return list;
}
function loadBases() {
  const raw = lsLoad(LS_BASES, []);
  return stampSeqs((Array.isArray(raw) ? raw : [])
    .filter(b => b && b.id && Array.isArray(b.crew))
    .map(normalizeBase));
}
let bases = loadBases();

let ui = Object.assign(
  { view: 'roster', baseId: null, search: '', element: '', works: [], tier: '', bonus5: '', pskill: '', owned: '', sort: 'dex' },
  lsLoad(LS_UI, {})
);
// migrate the old single-work filter (ui.work: string) to ui.works: []
if (typeof ui.work === 'string' && ui.work) ui.works = [ui.work];
delete ui.work;
if (!Array.isArray(ui.works)) ui.works = [];
ui.works = ui.works.filter(w => WORKS.includes(w));
if (ui.element && !ELEMENTS.includes(ui.element)) ui.element = ''; // e.g. removed "Rock"
// migrate the old owned-only checkbox (ui.ownedOnly: bool) to ui.owned: ''|'yes'|'no'
if (ui.ownedOnly === true && !ui.owned) ui.owned = 'yes';
delete ui.ownedOnly;
if (!['', 'yes', 'no'].includes(ui.owned)) ui.owned = '';

/* ---- persistence + undo history ----
   persist(label) saves the DATA keys; a label also records an undo snapshot of
   the pre-change state (read from localStorage, which every mutation path keeps
   current). persistUI() saves only the view/filter state — no snapshot, and the
   storage-sync listener ignores it so tabs keep independent views. */
const DATA_KEYS = [LS_ROSTER, LS_BASES, LS_BONUS, LS_PARTIES, LS_PARTY_MEMO];
const HISTORY_MAX = 5;
const HISTORY_COALESCE_MS = 3000; // rapid same-label actions (stepper clicks) undo as one
let history = []; // in-memory, per tab: [{label, at, extAt, data: {key: rawJSONString|null}}]
let externalWrites = 0; // bumped whenever another tab's write is applied here

function pushHistory(label) {
  const at = Date.now();
  const last = history[history.length - 1];
  if (last && last.label === label && last.extAt === externalWrites && at - last.at < HISTORY_COALESCE_MS) { last.at = at; return; }
  const data = {};
  for (const k of DATA_KEYS) data[k] = localStorage.getItem(k);
  history.push({ label, at, extAt: externalWrites, data });
  if (history.length > HISTORY_MAX) history.shift();
  paintUndo();
}

// restore to before history[i]; discards it and everything after it
function undoTo(i) {
  const entry = history[i];
  if (!entry) return;
  // snapshots are whole-state: if another tab wrote since this one was taken,
  // restoring would silently discard that tab's work — ask first
  if (externalWrites > entry.extAt &&
    !confirm('Another tab saved changes after this point — undoing here will discard them too. Undo anyway?')) return;
  history = history.slice(0, i);
  closeModal();
  try {
    for (const [k, v] of Object.entries(entry.data)) {
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    }
  } catch { warnSaveFailure(); }
  reloadData();
  if (ui.baseId && !bases.find(b => b.id === ui.baseId)) ui.baseId = null;
  persistUI();
  paintUndo();
  render();
}

let saveWarned = false;
function warnSaveFailure() {
  if (saveWarned) return;
  saveWarned = true;
  document.body.append(el('div', { class: 'save-warn' },
    '⚠ Changes are NOT being saved — browser storage is blocked or full. Use Export to back up your data.'));
}

let persistenceAsked = false;
function persist(label) {
  if (label) pushHistory(label);
  // first real data write this session: ask the browser to protect the origin's
  // storage from eviction (covers brand-new users, not just returning ones)
  if (!persistenceAsked && navigator.storage && navigator.storage.persist) {
    persistenceAsked = true;
    navigator.storage.persist().catch(() => { /* advisory only */ });
  }
  // serialize first, then write; on a mid-sequence failure (quota), roll back
  // the keys already written so storage is never left half old / half new —
  // other tabs adopt whatever lands here via the storage event
  const values = [
    [LS_ROSTER, JSON.stringify(roster)],
    [LS_BASES, JSON.stringify(bases)],
    [LS_BONUS, JSON.stringify(bonus)],
    [LS_PARTIES, JSON.stringify(parties)],
    [LS_PARTY_MEMO, JSON.stringify(partyMemo)],
  ];
  const prev = values.map(([k]) => [k, localStorage.getItem(k)]);
  const written = [];
  try {
    for (const [k, v] of values) { localStorage.setItem(k, v); written.push(k); }
  } catch {
    try {
      for (const [k, v] of prev) {
        if (!written.includes(k)) continue;
        if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
      }
    } catch { /* rollback is best-effort */ }
    warnSaveFailure();
  }
}
function persistUI() {
  try { localStorage.setItem(LS_UI, JSON.stringify(ui)); } catch { /* view state only */ }
}

// re-read every data global from localStorage (undo restore / another tab wrote)
function reloadData() {
  roster = loadRoster();
  bonus = loadBonus();
  parties = loadParties();
  partyMemo = loadPartyMemo();
  bases = loadBases();
}

/* ================= helpers ================= */
const $ = sel => document.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

const copiesOf = name => roster[name] || 0;
const isOwned = name => copiesOf(name) > 0;
function setCopies(name, n, label) {
  if (n > 0) roster[name] = n; else delete roster[name];
  if (n >= BONUS_AT) bonus[name] = 1; // sticky: earned for good
  persist(label || `Roster: ${name}`);
}
const uniqueOwned = () => Object.keys(roster).length;
const totalCopies = () => Object.values(roster).reduce((a, b) => a + b, 0);
const bonusDone = name => !!bonus[name];
const bonusCount = () => Object.keys(bonus).length;

const crewEntry = (base, name) => base.crew.find(e => e.name === name);
const crewTotal = base => base.crew.reduce((s, e) => s + e.qty, 0);
const crewQty = (base, name) => (crewEntry(base, name) || { qty: 0 }).qty;
function addToCrew(base, name, n = 1) {
  const e = crewEntry(base, name);
  // an increment keeps the entry's original claim stamp (its first-add order)
  if (e) e.qty += n; else base.crew.push({ name, qty: n, seq: nextSeq++ });
}
function setCrewQty(base, name, qty) {
  if (qty <= 0) base.crew = base.crew.filter(e => e.name !== name);
  else crewEntry(base, name).qty = qty;
}
// copies claimed by reserve parties (reserve = not available as base labor)
const partyCount = name => parties.reduce((s, pt) =>
  s + (pt.reserve ? pt.members.reduce((c, m) => c + (m.name === name ? 1 : 0), 0) : 0), 0);
// total members of `name` across all parties (for chips/warnings)
const inAnyParty = name => parties.reduce((s, pt) =>
  s + pt.members.reduce((c, m) => c + (m.name === name ? 1 : 0), 0), 0);

/* Owned copies are allocated to RESERVE PARTIES first, then to base crew
   entries in the order the assignments were made (each entry's seq stamp) —
   NOT base-list order. A copy assigned to one place is never counted as
   available to another. */
function allocatedTo(base, name) {
  let remaining = Math.max(0, copiesOf(name) - partyCount(name));
  const claims = [];
  for (const b of bases) {
    const e = crewEntry(b, name);
    if (e) claims.push({ id: b.id, qty: e.qty, seq: e.seq || 0 });
  }
  claims.sort((a, b) => a.seq - b.seq);
  for (const c of claims) {
    const take = Math.min(c.qty, remaining);
    if (c.id === base.id) return take;
    remaining -= take;
  }
  return 0;
}
// copies of `name` other bases actually hold (after allocation)
const heldElsewhere = (base, name) =>
  bases.reduce((s, b) => s + (b.id === base.id ? 0 : allocatedTo(b, name)), 0);
// total demand for `name` from bases other than `base`
const demandElsewhere = (base, name) =>
  bases.reduce((s, b) => s + (b.id === base.id ? 0 : crewQty(b, name)), 0);
// owned copies not in the party and not assigned to any base
const globalFree = name =>
  Math.max(0, copiesOf(name) - partyCount(name) - bases.reduce((s, b) => s + crewQty(b, name), 0));
// copies this base wants but cannot get (not owned, or claimed by an earlier base)
const shortfallOf = (base, name) => Math.max(0, crewQty(base, name) - allocatedTo(base, name));
const baseShortfall = base => base.crew.reduce((s, e) => s + shortfallOf(base, e.name), 0);
// combined Food stat of a crew (copies counted) — how much the base eats
const crewFood = base => base.crew.reduce((s, e) => s + ((byName.get(e.name) || {}).food || 0) * e.qty, 0);
const FOOD_TIP = 'Combined Food stat of this crew (higher = hunger drains faster, so the base needs more berry plots / feed)';

const isNight = p => p.elements.includes('Dark');
const dexLabel = p => p.paldex ? '#' + p.paldex : '★';
const totalLevels = p => Object.values(p.works).reduce((a, b) => a + b, 0);
const bestLevel = p => Math.max(0, ...Object.values(p.works));
const sortedWorks = p => Object.entries(p.works).sort((a, b) => b[1] - a[1]);

function palIcon(p, cls = 'pal-icon') {
  const img = el('img', { class: cls, src: p.icon, alt: '', loading: 'lazy' });
  img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
  return img;
}

function workChip(work, lv, pal) {
  const attrs = { class: `wchip lv${lv}` };
  if (work === 'Farming' && pal && pal.ranch) {
    attrs.title = 'Ranch produce: ' + pal.ranch.map(i => i.name).join(', ');
  }
  return el('span', attrs, `${work} `, el('b', {}, String(lv)));
}

// 5-catch bonus badge: ★5 when earned, progress n/5 while owned copies build up.
// Click toggles manually (for pals caught before using this tool, since the
// roster only tracks copies you still have).
function bonusBadge(p, onAfter) {
  const done = bonusDone(p.name);
  const copies = copiesOf(p.name);
  // owning 5+ copies proves the bonus is earned — nothing to toggle
  if (done && copies >= BONUS_AT) {
    return el('span', { class: 'bonus done', title: '5-catch paldex bonus earned' }, '★5');
  }
  const title = done
    ? '5-catch paldex bonus earned (marked manually) · click to unmark'
    : `${copies} cop${copies === 1 ? 'y' : 'ies'} toward the 5-catch paldex bonus · click to mark it earned (e.g. caught before tracking here)`;
  return el('button', {
    class: 'bonus' + (done ? ' done' : ''), title,
    onclick: e => {
      e.stopPropagation();
      if (done) delete bonus[p.name]; else bonus[p.name] = 1;
      persist(`★5 toggle: ${p.name}`); onAfter();
    }
  }, done ? '★5' : `${Math.min(copies, BONUS_AT)}/${BONUS_AT}`);
}

function foodChip(p) {
  if (!p.food) return null;
  return el('span', { class: 'wchip food', title: `Food ${p.food} — how fast its hunger drains; higher = eats more` },
    '🍖 ', el('b', {}, String(p.food)));
}

function elementChips(p) {
  return el('span', { class: 'chips' },
    p.elements.map(e => el('span', { class: `el-chip el-${e}` }, e)),
    isNight(p) ? el('span', { class: 'night', title: 'Dark-type: works through the night' }, '🌙') : null
  );
}

const TIER_NAMES = { S: 'S (top tier)', A: 'A (strong)', B: 'B (average)', C: 'C (weak)', F: 'F (bottom)' };
function ordinal(n) {
  const v = n % 100, s = ['th', 'st', 'nd', 'rd'];
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
// tier badge + HP/Atk/Def mini-bars (percentile fill), exact values in the tooltip
function combatCluster(p) {
  if (!p.stats || !p.tier) return null;
  const st = p.stats, pc = p.pctl;
  const bar = k => el('span', { class: 'cbar ' + k }, el('i', { style: `width:${pc[k]}%` }));
  const title =
    `Combat tier ${p.tier} — ${ordinal(p.combat)} percentile overall\n` +
    `HP ${st.hp} (${ordinal(pc.hp)}) · ATK ${st.atk} (${ordinal(pc.atk)}) · DEF ${st.def} (${ordinal(pc.def)})`;
  return el('span', { class: 'combat', title },
    el('span', { class: 'tier tier-' + p.tier, 'aria-label': 'Tier ' + p.tier }, p.tier),
    el('span', { class: 'cbars' }, bar('hp'), bar('atk'), bar('def'))
  );
}

// − n + stepper; get()/set() own the value, onAfter re-renders
function qtyStepper(get, set, onAfter) {
  const qty = el('span', { class: 'qty' + (get() ? '' : ' zero') }, String(get()));
  const refresh = () => { qty.textContent = String(get()); qty.classList.toggle('zero', !get()); };
  return el('span', { class: 'qty-step' },
    el('button', { title: 'One less', onclick: e => { e.stopPropagation(); set(Math.max(0, get() - 1)); refresh(); onAfter(); } }, '−'),
    qty,
    el('button', { title: 'One more', onclick: e => { e.stopPropagation(); set(get() + 1); refresh(); onAfter(); } }, '+')
  );
}

/* per work type: who in this crew contributes, the raw stack of levels (copies
   expanded), and the same stack after this base's aura pals. An aura buffs every
   OTHER pal here (+1, no stacking), never the aura pal itself. */
const WORK_LEVEL_MAX = 10;
function coverageDetail(base) {
  const det = {};
  for (const w of WORKS) {
    const auraPal = AURA_BY_WORK[w];
    const aura = auraPal && crewQty(base, auraPal) > 0 ? auraPal : null;
    const contributors = [];
    for (const e of base.crew) {
      const p = byName.get(e.name);
      if (!p) continue;
      const lv = p.works[w] || 0;
      if (!lv) continue;
      const boost = aura && e.name !== aura ? 1 : 0;
      contributors.push({
        name: e.name, level: lv, qty: e.qty, short: shortfallOf(base, e.name),
        blevel: Math.min(lv + boost, WORK_LEVEL_MAX), boosted: boost > 0,
      });
    }
    contributors.sort((a, b) => b.blevel - a.blevel || b.level - a.level || b.qty - a.qty);
    const levels = contributors.flatMap(c => Array(c.qty).fill(c.level)).sort((a, b) => b - a);
    const blevels = contributors
      .flatMap(c => Array(c.qty).fill({ lv: c.blevel, boosted: c.boosted }))
      .sort((a, b) => b.lv - a.lv);
    det[w] = { contributors, levels, blevels, aura };
  }
  return det;
}

function renderHeaderStats() {
  $('#header-stats').textContent =
    `v1.0 data · ${uniqueOwned()} / ${PALS.length} pals owned · ${bases.length} base${bases.length === 1 ? '' : 's'} saved`;
}

/* ================= roster view ================= */
function matchesFilters(p) {
  if (ui.search) {
    const q = ui.search.toLowerCase();
    const hitName = p.name.toLowerCase().includes(q);
    const hitDex = p.paldex && ('#' + p.paldex.toLowerCase()).includes(q);
    if (!hitName && !hitDex) return false;
  }
  if (ui.element && !p.elements.includes(ui.element)) return false;
  if (ui.works.length && !ui.works.every(w => w in p.works)) return false;
  if (ui.tier && p.tier !== ui.tier) return false;
  if (ui.bonus5 === 'done' && !bonusDone(p.name)) return false;
  if (ui.bonus5 === 'not' && bonusDone(p.name)) return false;
  if (ui.pskill && !(p.partner && p.partner.tags.includes(ui.pskill))) return false;
  if (ui.owned === 'yes' && !isOwned(p.name)) return false;
  if (ui.owned === 'no' && isOwned(p.name)) return false;
  return true;
}

// combined level across the selected work filters (for sorting)
const selectedWorksTotal = p => ui.works.reduce((s, w) => s + (p.works[w] || 0), 0);

function sortPals(list) {
  const s = ui.sort;
  const copy = [...list];
  if (s === 'name') copy.sort((a, b) => a.name.localeCompare(b.name));
  else if (s === 'total') copy.sort((a, b) => totalLevels(b) - totalLevels(a));
  else if (s === 'best') copy.sort((a, b) => bestLevel(b) - bestLevel(a) || totalLevels(b) - totalLevels(a));
  else if (s === 'tier') copy.sort((a, b) => (b.combat || 0) - (a.combat || 0) || a.name.localeCompare(b.name));
  else if (s === 'bonus') {
    // closest to the 5-catch bonus first: earned, then 4/5, 3/5…; paldex order to break ties
    const prog = p => bonusDone(p.name) ? BONUS_AT : Math.min(copiesOf(p.name), BONUS_AT - 1);
    copy.sort((a, b) => prog(b) - prog(a) || dexOrder.get(a.name) - dexOrder.get(b.name));
  }
  else copy.sort((a, b) => dexOrder.get(a.name) - dexOrder.get(b.name));
  // when filtering by work types, sort the strongest at those works to the top
  if (ui.works.length) copy.sort((a, b) => selectedWorksTotal(b) - selectedWorksTotal(a));
  return copy;
}

// one-time dismissible banners (raw localStorage flags, not part of app state)
const flagSet = k => { try { localStorage.setItem(k, '1'); } catch { /* cosmetic */ } };
const flagGet = k => { try { return !!localStorage.getItem(k); } catch { return true; } };

function renderRoster() {
  const view = $('#view');
  view.innerHTML = '';

  if (!flagGet(LS_WELCOME) && uniqueOwned() === 0 && !bases.length) {
    const banner = el('div', { class: 'panel banner' },
      el('button', { class: 'rm banner-x', title: 'Dismiss', onclick: e => { flagSet(LS_WELCOME); e.target.closest('.banner').remove(); } }, '✕'),
      el('h3', {}, 'Plan your bases from the pals you actually own'),
      el('div', { class: 'tips' },
        'The loop: mark your catches below (the +/− counter tracks copies) → create a base on the Bases tab ' +
        'and pick its purpose → Auto-fill staffs it from your roster → the Catch list shows exactly what you still need. ' +
        'Everything saves to this browser only — nothing leaves your device. Export makes a backup file.'));
    view.append(banner);
  } else if (!flagGet(LS_NUDGE) && totalCopies() >= 20) {
    const banner = el('div', { class: 'panel banner banner-slim' },
      el('button', { class: 'rm banner-x', title: 'Dismiss', onclick: e => { flagSet(LS_NUDGE); e.target.closest('.banner').remove(); } }, '✕'),
      el('div', { class: 'tips' },
        'Your roster lives only in this browser — clearing site data (or Safari after a week of no visits) erases it. ',
        el('button', {
          class: 'add-btn', onclick: e => { flagSet(LS_NUDGE); $('#btn-export').click(); e.target.closest('.banner').remove(); }
        }, 'Download a backup')));
    view.append(banner);
  }

  const listWrap = el('div', { class: 'pal-list' });

  const searchInput = el('input', {
    type: 'search', placeholder: 'Search name or #paldex…', value: ui.search,
    oninput: e => { ui.search = e.target.value.trim(); persistUI(); renderList(); }
  });
  const elementSel = el('select',
    { onchange: e => { ui.element = e.target.value; persistUI(); renderList(); } },
    el('option', { value: '' }, 'Any element'),
    ELEMENTS.map(x => el('option', { value: x, selected: ui.element === x ? '' : null }, x))
  );
  // multiselect: show only pals that have ALL checked work suitabilities
  const workSel = (() => {
    const wrap = el('div', { class: 'multi-wrap' });
    const btnLabel = () =>
      ui.works.length === 0 ? 'Any work'
        : ui.works.length <= 2 ? ui.works.join(' + ')
          : `${ui.works.length} works`;
    const btn = el('button', { class: 'multi-btn', type: 'button' }, btnLabel(), el('span', { class: 'caret' }, '▾'));
    const panel = el('div', { class: 'multi-panel', hidden: '' });
    btn.addEventListener('click', () => { panel.hidden = !panel.hidden; });
    for (const w of WORKS) {
      const cb = el('input', { type: 'checkbox', ...(ui.works.includes(w) ? { checked: '' } : {}) });
      cb.addEventListener('change', () => {
        ui.works = cb.checked ? [...ui.works, w] : ui.works.filter(x => x !== w);
        btn.firstChild.textContent = btnLabel();
        persistUI(); renderList();
      });
      panel.append(el('label', { class: 'multi-row' }, cb, ' ', w));
    }
    panel.append(el('button', {
      class: 'ghost multi-clear', type: 'button',
      onclick: () => {
        ui.works = [];
        panel.querySelectorAll('input').forEach(c => { c.checked = false; });
        btn.firstChild.textContent = btnLabel();
        persistUI(); renderList();
      }
    }, 'Clear'));
    wrap.append(btn, panel);
    document.addEventListener('mousedown', function outside(e) {
      if (!wrap.isConnected) { document.removeEventListener('mousedown', outside); return; }
      if (!wrap.contains(e.target)) panel.hidden = true;
    });
    return wrap;
  })();
  const sortSel = el('select',
    { onchange: e => { ui.sort = e.target.value; persistUI(); renderList(); } },
    [['dex', 'Sort: Paldex'], ['name', 'Sort: Name'], ['total', 'Sort: Total levels'], ['best', 'Sort: Best level'], ['tier', 'Sort: Combat tier'], ['bonus', 'Sort: 5-catch progress']]
      .map(([v, t]) => el('option', { value: v, selected: ui.sort === v ? '' : null }, t))
  );
  const bonusSel = el('select',
    { onchange: e => { ui.bonus5 = e.target.value; persistUI(); renderList(); } },
    [['', '5-catch: any'], ['done', '5-catch: done ★'], ['not', '5-catch: not yet']]
      .map(([v, t]) => el('option', { value: v, selected: ui.bonus5 === v ? '' : null }, t))
  );
  const pskillSel = el('select',
    { onchange: e => { ui.pskill = e.target.value; persistUI(); renderList(); } },
    [['', 'Partner skill: any'], ['base', 'While at base'], ['ranch', 'Ranch drops'], ['party', 'In party'],
     ['active', 'When activated'], ['mount', 'Mount / ride'], ['passive', 'Always-on']]
      .map(([v, t]) => el('option', { value: v, selected: ui.pskill === v ? '' : null }, t))
  );
  const tierSel = el('select',
    { onchange: e => { ui.tier = e.target.value; persistUI(); renderList(); } },
    el('option', { value: '' }, 'Any tier'),
    ['S', 'A', 'B', 'C', 'F'].map(t => el('option', { value: t, selected: ui.tier === t ? '' : null }, 'Tier ' + TIER_NAMES[t]))
  );
  const ownedSel = el('select',
    { onchange: e => { ui.owned = e.target.value; persistUI(); renderList(); } },
    [['', 'Owned: any'], ['yes', 'Owned only'], ['no', 'Not owned yet']]
      .map(([v, t]) => el('option', { value: v, selected: ui.owned === v ? '' : null }, t))
  );
  const hasActiveFilters = () =>
    !!(ui.search || ui.element || ui.works.length || ui.tier || ui.bonus5 || ui.pskill || ui.owned);
  const activeFilterCount = () =>
    [ui.search, ui.element, ui.tier, ui.bonus5, ui.pskill, ui.owned].filter(Boolean).length + (ui.works.length ? 1 : 0);
  const resetBtn = el('button', {
    class: 'ghost reset-filters', type: 'button',
    title: 'Clear the search and every filter (sort is kept)',
    onclick: () => {
      Object.assign(ui, { search: '', element: '', works: [], tier: '', bonus5: '', pskill: '', owned: '' });
      persistUI();
      renderRoster(); // rebuild the toolbar so every control shows its cleared state
    }
  }, 'Reset filters');
  const countPill = el('span', { class: 'count-pill' });

  // on phones the six filter selects collapse behind this toggle (CSS-only on
  // desktop: the toggle is hidden and .filter-set lays out as display:contents)
  const filtersToggle = el('button', { class: 'ghost filters-toggle', type: 'button' });
  const toolbar = el('div', { class: 'toolbar' }, searchInput, filtersToggle,
    el('div', { class: 'filter-set' }, elementSel, workSel, tierSel, bonusSel, pskillSel, ownedSel, resetBtn),
    sortSel, el('span', { class: 'spacer' }), countPill);
  const paintToggle = () => {
    const n = activeFilterCount();
    filtersToggle.textContent = `Filters${n ? ` (${n})` : ''} ▾`;
    filtersToggle.classList.toggle('has-active', n > 0);
  };
  filtersToggle.addEventListener('click', () => toolbar.classList.toggle('filters-open'));
  if (hasActiveFilters()) toolbar.classList.add('filters-open'); // don't hide active filters

  view.append(toolbar, listWrap);
  resetBtn.hidden = !hasActiveFilters();
  paintToggle();

  function renderList() {
    resetBtn.hidden = !hasActiveFilters();
    paintToggle();
    const pals = sortPals(PALS.filter(matchesFilters));
    countPill.innerHTML = '';
    countPill.append('Own ', el('b', {}, String(uniqueOwned())), ` / ${PALS.length}`,
      totalCopies() > uniqueOwned() ? ` · ${totalCopies()} copies` : '',
      bonusCount() ? ` · ${bonusCount()} ★5` : '',
      pals.length !== PALS.length ? ` · showing ${pals.length}` : '');
    countPill.title = bonusCount() ? `${bonusCount()} pals have the 5-catch paldex bonus` : '';
    listWrap.innerHTML = '';
    if (!pals.length) {
      listWrap.append(el('div', { class: 'empty-note' }, 'No pals match these filters.'));
      return;
    }
    for (const p of pals) {
      const owned = isOwned(p.name);
      const row = el('div', { class: 'pal-row' + (owned ? ' owned' : '') });
      // partner skill: ✦ is a tap-toggle for the full text (tooltips don't
      // exist on touch); the line auto-shows while the partner-skill filter is on
      let pskillBtn = '', pskillLine = '';
      if (p.partner) {
        pskillLine = el('span', { class: 'pskill-line', ...(ui.pskill ? {} : { hidden: '' }) },
          el('b', {}, p.partner.skill), ' — ' + p.partner.desc);
        pskillBtn = el('button', {
          class: 'pskill', title: `${p.partner.skill} — ${p.partner.desc} (click for details)`,
          onclick: e => { e.stopPropagation(); pskillLine.hidden = !pskillLine.hidden; }
        }, '✦');
      }
      row.append(
        el('input', {
          type: 'checkbox', class: 'own-toggle',
          title: owned ? 'Owned — uncheck to set copies to 0' : 'Check when you catch one',
          ...(owned ? { checked: '' } : {}),
          onchange: e => {
            setCopies(p.name, e.target.checked ? Math.max(1, copiesOf(p.name)) : 0);
            renderHeaderStats(); renderList();
          }
        }),
        qtyStepper(() => copiesOf(p.name), n => setCopies(p.name, n),
          () => { renderHeaderStats(); renderList(); }),
        palIcon(p),
        el('span', { class: 'pal-id' }, dexLabel(p)),
        el('span', { class: 'pal-name' },
          el('a', { href: 'https://paldb.cc/en/' + p.slug, target: '_blank', rel: 'noopener' }, p.name)),
        elementChips(p),
        combatCluster(p),
        bonusBadge(p, () => renderList()),
        partyCount(p.name) ? el('span', { class: 'party-chip', title: 'In a reserve party — not counted as free base labor' },
          '⚔' + (partyCount(p.name) > 1 ? '×' + partyCount(p.name) : '')) : '',
        el('span', { class: 'work-chips' }, sortedWorks(p).map(([w, l]) => {
          const chip = workChip(w, l, p);
          if (ui.works.includes(w)) chip.classList.add('hl');
          return chip;
        })),
        pskillBtn,
        el('button', {
          class: 'add-btn qadd-btn', title: 'Quick-add to a base',
          onclick: e => quickAddToBase(p, e.target)
        }, '+ base'),
        pskillLine
      );
      listWrap.append(row);
    }
  }
  renderList();
}

/* ================= party view ================= */
function newParty() {
  parties.push(normalizeParty({ name: `Party ${parties.length + 1}`, reserve: true, members: [] }, parties.length));
  persist('New party'); render();
}
function addToParty(pt, name) {
  if (pt.members.length >= PARTY_SIZE || !byName.has(name)) return;
  pt.members.push(partyMemo[name] ? { ...partyMemo[name], name } : normalizeMember({ name }));
  persist(`Party: add ${name}`); render(); renderHeaderStats();
}
function removeFromParty(pt, i) {
  const m = pt.members[i];
  if (!m) return;
  partyMemo[m.name] = { ...m }; // remember details for re-add
  pt.members.splice(i, 1);
  persist(`Party: remove ${m.name}`); render(); renderHeaderStats();
}

function renderParty() {
  const view = $('#view');
  view.innerHTML = '';
  if (!parties.length) {
    view.append(el('div', { class: 'panel party-summary' },
      el('h3', {}, 'Parties'),
      el('div', { class: 'tips' },
        'Track your travel teams as individuals — nickname, level, condense stars, passives. ' +
        'A party marked "reserve" claims your copies before any base can use them, so a pal in it never counts as free base labor.'),
      el('button', { class: 'btn', onclick: newParty }, '+ New party')));
    return;
  }
  parties.forEach((pt, pi) => view.append(partyBlock(pt, pi)));
  view.append(el('div', { class: 'party-add-row' },
    el('button', { class: 'ghost', onclick: newParty }, '+ New party')));
}

function partyBlock(pt, pi) {
  const block = el('div', { class: 'party-block' });
  const party = pt.members; // keeps the member-card code below unchanged

  block.append(el('div', { class: 'party-block-head' },
    el('input', {
      class: 'base-name party-name', value: pt.name, maxlength: '40',
      onchange: e => { pt.name = e.target.value.trim() || `Party ${pi + 1}`; e.target.value = pt.name; persist('Rename party'); }
    }),
    el('span', { class: 'hint' }, `${party.length} / ${PARTY_SIZE}`),
    el('label', {
      class: 'check reserve-check',
      title: 'Reserve: copies in this party are claimed before bases — they never count as free base labor. Untick for a wishlist/theory team that should not affect base planning.'
    },
      el('input', {
        type: 'checkbox', ...(pt.reserve ? { checked: '' } : {}),
        onchange: e => { pt.reserve = e.target.checked; persist(`Party reserve ${e.target.checked ? 'on' : 'off'}: ${pt.name}`); render(); }
      }),
      '⚔ reserve copies'),
    el('button', {
      class: 'rm', title: 'Delete this party',
      onclick: () => {
        if (party.length && !confirm(`Delete "${pt.name}" (${party.length} member${party.length === 1 ? '' : 's'})? Member details are remembered for re-adding.`)) return;
        // re-read storage after the blocking dialog (see Delete base), then
        // re-resolve this party by id — indices may have shifted
        reloadData();
        const idx = parties.findIndex(x => x.id === pt.id);
        if (idx !== -1) {
          for (const m of parties[idx].members) partyMemo[m.name] = { ...m };
          parties.splice(idx, 1);
          persist(`Delete ${pt.name}`);
        }
        render(); renderHeaderStats();
      }
    }, '✕')
  ));

  const summary = el('div', { class: 'panel party-summary' });
  const grid = el('div', { class: 'party-grid' });
  block.append(summary, grid);

  function paintSummary() {
    summary.innerHTML = '';
    if (!party.length) {
      summary.append(el('div', { class: 'tips' }, pt.reserve
        ? 'Party pals are claimed before any base can use them — a copy in a reserve party never counts as free base labor.'
        : 'Not a reserve party — these picks stay available to bases.'));
      return;
    }
    const members = party.map(m => byName.get(m.name)).filter(Boolean);
    const leveled = party.filter(m => m.level > 0);
    const avgLevel = leveled.length ? Math.round(leveled.reduce((s, m) => s + m.level, 0) / leveled.length) : null;
    const food = members.reduce((s, p) => s + (p.food || 0), 0);
    const covered = new Set(members.flatMap(p => p.elements.flatMap(e => ELEM_STRONG[e] || [])));
    const gaps = ELEMENTS.filter(e => !covered.has(e));
    const chips = list => list.length
      ? list.map(e => el('span', { class: `el-chip el-${e}` }, e))
      : [el('span', { class: 'hint' }, '—')];
    summary.append(el('div', { class: 'party-stats' },
      el('span', {}, 'Tiers: ', party.map(m => {
        const p = byName.get(m.name);
        return p && p.tier ? el('span', { class: 'tier tier-' + p.tier, title: m.name }, p.tier) : null;
      })),
      avgLevel ? el('span', {}, `avg Lv. ${avgLevel}`) : null,
      el('span', { title: FOOD_TIP }, `🍖 ${food.toLocaleString()}`)
    ));
    summary.append(
      el('div', { class: 'party-cover' }, el('span', { class: 'cover-label', title: 'Enemy elements your party hits for bonus damage (by pal element)' }, 'Hits hard:'), chips([...covered])),
      el('div', { class: 'party-cover' }, el('span', { class: 'cover-label', title: 'Enemy elements no party member has an edge against' }, 'No edge vs:'), chips(gaps))
    );
  }

  function memberCard(m, i) {
    const p = byName.get(m.name);
    const card = el('div', { class: 'party-card' });
    const short = pt.reserve && partyCount(m.name) > copiesOf(m.name);

    const nick = el('input', {
      class: 'nick', type: 'text', maxlength: '30', placeholder: 'Nickname…', value: m.nickname,
      onchange: e => { m.nickname = e.target.value.trim(); persist(`Edit ${m.nickname || m.name}`); }
    });
    card.append(el('div', { class: 'party-head' },
      palIcon(p, 'pal-icon party-icon'),
      el('div', { class: 'party-title' }, nick,
        el('div', {},
          el('span', { class: 'pal-id' }, dexLabel(p)), ' ',
          el('a', { href: 'https://paldb.cc/en/' + p.slug, target: '_blank', rel: 'noopener' }, p.name))),
      el('button', { class: 'rm', title: 'Remove from party (details are remembered)', onclick: () => removeFromParty(pt, i) }, '✕')
    ));

    card.append(el('div', { class: 'party-row' }, elementChips(p), combatCluster(p), foodChip(p)));

    const stars = el('span', { class: 'stars' });
    const paintStars = () => {
      stars.innerHTML = '';
      for (let s = 1; s <= 4; s++) {
        stars.append(el('button', {
          class: 'star' + (m.stars >= s ? ' on' : ''),
          title: `Condenser rank ${s}★` + (m.stars === s ? ' (click to clear)' : ''),
          onclick: () => { m.stars = m.stars === s ? s - 1 : s; persist(`Edit ${m.nickname || m.name}`); paintStars(); }
        }, m.stars >= s ? '★' : '☆'));
      }
    };
    paintStars();
    card.append(el('div', { class: 'party-row' },
      el('label', { class: 'lvl' }, 'Lv. ', el('input', {
        type: 'number', min: '1', max: '100', value: m.level || '',
        placeholder: '—',
        onchange: e => {
          const v = Math.floor(Number(e.target.value));
          m.level = Number.isFinite(v) && v >= 1 ? Math.min(v, 100) : 0;
          e.target.value = m.level || '';
          persist(`Edit ${m.nickname || m.name}`); paintSummary();
        }
      })),
      stars
    ));

    const passWrap = el('div', { class: 'passives' });
    m.passives.forEach((val, pi) => {
      passWrap.append(el('input', {
        type: 'text', maxlength: '40', placeholder: 'passive ' + (pi + 1), value: val,
        onchange: e => { m.passives[pi] = e.target.value.trim(); persist(`Edit ${m.nickname || m.name}`); }
      }));
    });
    card.append(passWrap);

    card.append(el('div', { class: 'party-row party-works' }, sortedWorks(p).map(([w, l]) => workChip(w, l, p))));
    if (short) {
      card.append(el('div', { class: 'party-warn' },
        `⚠ You own ${copiesOf(m.name)} but ${partyCount(m.name)} are in the party — catch another or remove one.`));
    }
    return card;
  }

  function emptyCard() {
    const card = el('div', { class: 'party-card empty' });
    const input = el('input', { type: 'search', placeholder: 'Add to party — name or #paldex…', autocomplete: 'off' });
    const drop = el('div', { class: 'picker-drop', hidden: '' });
    function updateDrop() {
      const q = input.value.trim().toLowerCase();
      drop.innerHTML = '';
      if (!q) { drop.hidden = true; return; }
      const matches = PALS.filter(p =>
        p.name.toLowerCase().includes(q) || (p.paldex && ('#' + p.paldex.toLowerCase()).includes(q))
      ).slice(0, 9);
      if (!matches.length) { drop.hidden = true; return; }
      for (const p of matches) {
        drop.append(el('div', {
          class: 'pick-row',
          onmousedown: e => { e.preventDefault(); addToParty(pt, p.name); }
        },
          palIcon(p, 'pal-icon'),
          el('span', { class: 'pal-id' }, dexLabel(p)),
          el('b', {}, p.name),
          p.tier ? el('span', { class: 'tier tier-' + p.tier }, p.tier) : null,
          isOwned(p.name)
            ? el('span', { class: 'status have' }, `owned ×${copiesOf(p.name)}` + (globalFree(p.name) < copiesOf(p.name) ? ` · ${globalFree(p.name)} free` : ''))
            : el('span', { class: 'status need' }, 'not owned')
        ));
      }
      drop.hidden = false;
    }
    input.addEventListener('input', updateDrop);
    input.addEventListener('focus', updateDrop);
    input.addEventListener('blur', () => setTimeout(() => { drop.hidden = true; }, 120));
    card.append(el('div', { class: 'empty-slot-label' }, '＋ Empty slot'), el('div', { class: 'picker-wrap' }, input, drop));
    return card;
  }

  paintSummary();
  party.forEach((m, i) => grid.append(memberCard(m, i)));
  for (let i = party.length; i < PARTY_SIZE; i++) grid.append(emptyCard());
  return block;
}

/* ================= quick add to base ================= */
function tryQuickAdd(base, p, btn) {
  const total = crewTotal(base);
  if (total >= base.cap) {
    alert(`"${base.name}" is full (${total} / ${base.cap} workers).\nRaise its Max workers or remove someone first.`);
    return false;
  }
  addToCrew(base, p.name, 1);
  persist(`Add ${p.name} to ${base.name}`);
  if (btn) {
    const original = btn.textContent;
    btn.textContent = `✓ ${base.name}`;
    btn.disabled = true;
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1400);
  }
  return true;
}

function quickAddToBase(p, btn) {
  if (!bases.length) {
    alert('No bases yet — create one on the Bases tab first.');
    return;
  }
  if (bases.length === 1) { tryQuickAdd(bases[0], p, btn); return; }
  openBasePickerModal(p, btn);
}

function openBasePickerModal(p, btn) {
  $('#modal-title').textContent = `Add ${p.name} to…`;
  const body = $('#modal-body');
  body.innerHTML = '';
  const list = el('div', { class: 'pal-list' });
  for (const b of bases) {
    const total = crewTotal(b);
    const full = total >= b.cap;
    const inCrew = crewQty(b, p.name);
    list.append(el('div', { class: 'pal-row' },
      el('b', {}, b.name),
      el('span', { class: 'count-pill' }, `${total} / ${b.cap}`),
      inCrew ? el('span', { class: 'status increw' }, `has ×${inCrew}`) : null,
      full ? el('span', { class: 'status need' }, 'full') : null,
      el('span', { class: 'spacer', style: 'flex:1' }),
      el('button', {
        class: 'add-btn',
        onclick: () => { if (tryQuickAdd(b, p, btn)) closeModal(); }
      }, '+ Add')
    ));
  }
  body.append(list);
  $('#modal-root').hidden = false;
}

/* ================= bases view ================= */
function newBase() {
  const base = { id: 'b' + Date.now().toString(36), name: `Base ${bases.length + 1}`, crew: [], cap: CAP_DEFAULT, purpose: 'balanced', coverBasics: true };
  bases.push(base);
  ui.baseId = base.id;
  persist('New base'); persistUI(); renderHeaderStats(); render();
}

function moveBase(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= bases.length) return;
  [bases[i], bases[j]] = [bases[j], bases[i]];
  persist('Reorder bases'); render();
}

function renderBases() {
  const view = $('#view');
  view.innerHTML = '';
  const base = bases.find(b => b.id === ui.baseId);
  if (base) return renderEditor(view, base);

  const grid = el('div', { class: 'grid-cards' });
  bases.forEach((b, i) => {
    const total = crewTotal(b);
    const missing = baseShortfall(b);
    const det = coverageDetail(b);
    const covered = WORKS.filter(w => det[w].levels.length > 0).length;
    grid.append(el('div', { class: 'base-card', onclick: () => { ui.baseId = b.id; persistUI(); render(); } },
      el('div', { class: 'base-order', title: 'Change display order (does not change who gets your copies — those go in the order you assigned them)' },
        el('button', { class: 'ghost ord', disabled: i === 0 ? '' : null, onclick: e => { e.stopPropagation(); moveBase(i, -1); } }, '↑'),
        el('button', { class: 'ghost ord', disabled: i === bases.length - 1 ? '' : null, onclick: e => { e.stopPropagation(); moveBase(i, 1); } }, '↓')),
      el('h3', {}, b.name),
      el('div', { class: 'meta', title: crewFood(b) ? FOOD_TIP : null },
        (b.purpose !== 'balanced' ? `${PRESETS[b.purpose].label} · ` : '') +
        `${total} / ${b.cap} pals · covers ${covered}/12 work types` + (crewFood(b) ? ` · 🍖 ${crewFood(b).toLocaleString()}` : '')),
      missing
        ? el('div', { class: 'missing' }, `⚠ ${missing} cop${missing === 1 ? 'y' : 'ies'} still to catch`)
        : el('div', { class: 'meta', style: 'color: var(--ok)' }, total ? '✓ full crew owned' : 'empty')
    ));
  });
  grid.append(el('div', { class: 'base-card new', onclick: newBase }, '+ New base'));
  view.append(grid);
  if (!bases.length) {
    view.append(el('p', { class: 'empty-note' },
      'Plan a base crew, see its combined work coverage, and get a catch-list for the pals you are missing. Everything saves to this browser automatically.'));
  }
}

/* ================= base editor ================= */
let autofillNote = null; // {baseId, text} — transient "auto-fill placed nothing" explainer
function renderEditor(view, base) {
  const head = el('div', { class: 'editor-head' },
    el('button', { class: 'ghost', onclick: () => { ui.baseId = null; persistUI(); render(); } }, '← All bases'),
    el('input', {
      class: 'base-name', value: base.name, maxlength: '40',
      onchange: e => { base.name = e.target.value.trim() || 'Unnamed base'; e.target.value = base.name; persist('Rename base'); renderHeaderStats(); }
    }),
    el('label', { class: 'cap-field', title: 'Maximum workers at this base — raise it as you upgrade the base in-game' },
      'Max workers',
      el('input', {
        type: 'number', min: '1', max: String(CAP_MAX), value: String(base.cap),
        onchange: e => { base.cap = clampCap(e.target.value); e.target.value = String(base.cap); persist('Change max workers'); refresh(); }
      })
    ),
    el('button', {
      class: 'btn warn-btn', onclick: () => {
        if (confirm(`Delete "${base.name}"? (Undo in the top bar can bring it back.)`)) {
          // the dialog blocks the event loop — another tab may have written while
          // it was open, so re-read storage before mutating (its storage event
          // is still queued and would otherwise be clobbered)
          reloadData();
          bases = bases.filter(b => b.id !== base.id);
          ui.baseId = null; persist(`Delete ${base.name}`); persistUI(); renderHeaderStats(); render();
        }
      }
    }, 'Delete base')
  );

  const left = el('div', {});
  const right = el('div', {});
  view.append(head, el('div', { class: 'editor-cols' }, left, right));

  function refresh() { left.innerHTML = ''; right.innerHTML = ''; buildLeft(); buildRight(); }

  function addPal(name) { addToCrew(base, name, 1); persist(`Add ${name}`); refresh(); }

  /* ---- crew panel (left) ---- */
  function buildLeft() {
    const total = crewTotal(base);
    const food = crewFood(base);
    const crewPanel = el('div', { class: 'panel' });
    crewPanel.append(el('h3', {}, `Crew (${total} / ${base.cap})`,
      food ? el('span', { class: 'hint food-total', title: FOOD_TIP }, ` · 🍖 ${food.toLocaleString()} food`) : null));

    // pal picker
    const input = el('input', { type: 'search', placeholder: 'Add a pal — type name or #paldex…', autocomplete: 'off' });
    const drop = el('div', { class: 'picker-drop', hidden: '' });
    const wrap = el('div', { class: 'picker-wrap' }, input, drop);
    function updateDrop() {
      const q = input.value.trim().toLowerCase();
      drop.innerHTML = '';
      if (!q) { drop.hidden = true; return; }
      const matches = PALS.filter(p =>
        p.name.toLowerCase().includes(q) || (p.paldex && ('#' + p.paldex.toLowerCase()).includes(q))
      ).slice(0, 9);
      if (!matches.length) { drop.hidden = true; return; }
      for (const p of matches) {
        const inCrew = crewQty(base, p.name);
        drop.append(el('div', {
          class: 'pick-row',
          onmousedown: e => { e.preventDefault(); input.value = ''; drop.hidden = true; addPal(p.name); }
        },
          palIcon(p, 'pal-icon'),
          el('span', { class: 'pal-id' }, dexLabel(p)),
          el('b', {}, p.name),
          isOwned(p.name)
            ? el('span', { class: 'status have' },
              `owned ×${copiesOf(p.name)}` + (globalFree(p.name) < copiesOf(p.name) ? ` · ${globalFree(p.name)} free` : ''))
            : el('span', { class: 'status need' }, 'not owned'),
          inCrew ? el('span', { class: 'status increw' }, `in crew ×${inCrew}`) : null,
          el('span', { class: 'works-mini' }, sortedWorks(p).slice(0, 3).map(([w, l]) => `${w} ${l}`).join(' · '))
        ));
      }
      drop.hidden = false;
    }
    input.addEventListener('input', updateDrop);
    input.addEventListener('blur', () => setTimeout(() => { drop.hidden = true; }, 120));
    input.addEventListener('focus', updateDrop);
    crewPanel.append(wrap);

    // crew rows
    const list = el('div', { class: 'crew-list' });
    if (!base.crew.length) {
      list.append(el('div', { class: 'empty-note' }, 'No pals yet — search above, or click a work tile to see the best pals for that job.'));
    }
    for (const entry of base.crew) {
      const p = byName.get(entry.name);
      if (!p) continue;
      const alloc = allocatedTo(base, entry.name);
      const short = shortfallOf(base, entry.name);
      const elsewhere = heldElsewhere(base, entry.name);
      let status;
      if (short === 0) {
        status = el('span', { class: 'status have' }, 'owned');
      } else if (alloc > 0 || elsewhere > 0) {
        status = el('span', {
          class: 'status need',
          title: `You own ${copiesOf(entry.name)}; ${elsewhere} assigned to other bases`
        }, `have ${alloc} / ${entry.qty}` + (elsewhere ? ` · ${elsewhere} elsewhere` : ''));
      } else {
        status = el('span', { class: 'status need' }, 'to catch' + (entry.qty > 1 ? ` ×${entry.qty}` : ''));
      }
      list.append(el('div', { class: 'crew-row ' + (short === 0 ? 'have' : 'need') },
        palIcon(p),
        el('b', {}, p.name),
        isNight(p) ? el('span', { class: 'night', title: 'Works through the night' }, '🌙') : null,
        status,
        qtyStepper(() => crewQty(base, entry.name), n => { setCrewQty(base, entry.name, n); persist(`Crew: ${entry.name} (${base.name})`); }, refresh),
        (() => {
          const aw = Object.keys(AURA_BY_WORK).filter(w => AURA_BY_WORK[w] === p.name);
          return aw.length
            ? el('span', { class: 'pskill', title: `${p.partner.skill} — +1 ${aw.join(' / ')} for every other pal at this base` }, '✦')
            : '';
        })(),
        el('span', { class: 'work-chips' }, sortedWorks(p).map(([w, l]) => workChip(w, l, p)), foodChip(p)),
        el('button', { class: 'rm', title: 'Remove from crew', onclick: () => { setCrewQty(base, entry.name, 0); persist(`Remove ${entry.name}`); refresh(); } }, '✕')
      ));
    }
    crewPanel.append(list);

    if (total > base.cap) {
      crewPanel.append(el('div', { class: 'crew-cap' },
        `⚠ ${total} workers planned, but this base's max is ${base.cap}.`));
    }

    const basicsChk = el('label', { class: 'check', title: 'Adds a food-farm crew (planting/watering/gathering, raw-food scale), haulers, handiwork and a medic before filling the specialty — so the base needs no supply runs' },
      el('input', {
        type: 'checkbox', ...(base.coverBasics ? { checked: '' } : {}),
        onchange: e => { base.coverBasics = e.target.checked; persist('Toggle self-sufficient'); }
      }),
      'self-sufficient (grows its own food)'
    );
    basicsChk.hidden = base.purpose === 'balanced';
    const purposeSel = el('select',
      { onchange: e => { base.purpose = e.target.value; basicsChk.hidden = base.purpose === 'balanced'; persist('Change purpose'); refresh(); } },
      Object.entries(PRESETS).map(([v, pr]) =>
        el('option', { value: v, selected: base.purpose === v ? '' : null }, 'Purpose: ' + pr.label))
    );
    crewPanel.append(el('div', { class: 'autofill-row' },
      purposeSel,
      basicsChk,
      el('button', {
        class: 'btn', onclick: () => {
          const before = crewTotal(base);
          autofill(base);
          if (crewTotal(base) === before) {
            // name the actual cause: full base / empty roster / no relevant
            // work among owned pals / everything relevant already claimed
            const jobs = Object.keys((PRESETS[base.purpose] || PRESETS.balanced).recipe);
            const anyRelevantOwned = PALS.some(p => isOwned(p.name) && jobs.some(w => (p.works[w] || 0) > 0));
            autofillNote = {
              baseId: base.id,
              text: before >= base.cap
                ? `This base is already at its max of ${base.cap} workers.`
                : uniqueOwned() === 0
                  ? 'Auto-fill only places pals you’ve marked as owned in My Roster — and your roster is empty. Mark your catches first, or add pals by hand (search above, or click a work tile) to build a catch list instead.'
                  : !anyRelevantOwned
                    ? `None of your owned pals have the work types this purpose needs (${jobs.slice(0, 3).join(', ')}…). Catch some, or add dream pals by hand to build a catch list.`
                    : 'Auto-fill added nothing: every owned pal with relevant work is already claimed by a reserve party or another base. Free up copies, catch more, or add pals by hand to build a catch list.'
            };
          }
          refresh();
        }
      }, 'Auto-fill from my roster'),
      el('button', { class: 'ghost', onclick: () => { base.crew = []; persist(`Clear crew — ${base.name}`); refresh(); } }, 'Clear crew')
    ));
    if (autofillNote && autofillNote.baseId === base.id) {
      crewPanel.append(el('div', { class: 'autofill-note' }, autofillNote.text));
      autofillNote = null; // shows once; the next rebuild clears it
    }
    if (base.purpose !== 'balanced') {
      const auras = auraStatus(base, PRESETS[base.purpose].recipe);
      if (auras.length) {
        const line = el('div', { class: 'aura-line' },
          el('span', { class: 'aura-label', title: 'Their partner skills give every OTHER pal at this base +1 in that job. They do not stack, so one of each is enough.' }, '✦ Aura pals:'));
        auras.forEach((a, i) => {
          if (i) line.append(' · ');
          line.append(el('span', { class: 'aura-pal state-' + a.state.replace(/ /g, '-') },
            el('b', {}, a.name), ` +1 ${a.work}`,
            a.state === 'in crew' ? ' ✓' : a.state === 'not owned' ? ' (catch one)' : a.state === 'free' ? ' (available)' : ' (elsewhere)'));
        });
        crewPanel.append(line);
      }
    }
    const recipeText = Object.entries((PRESETS[base.purpose] || PRESETS.balanced).recipe)
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w, s]) => `${Math.round(s * 100)}% ${w}`).join(' · ');
    crewPanel.append(el('div', { class: 'tips' },
      `Auto-fill adds your best free copies (owned and unassigned) up to the max of ${base.cap}, following the ${(PRESETS[base.purpose] || PRESETS.balanced).label} recipe (${recipeText}…). ` +
      (base.purpose === 'balanced'
        ? 'Balanced spreads across every job with extra handiwork and hauling.'
        : 'It takes the aura pals above first (best value per slot), then ' + (base.coverBasics
          ? 'staffs food farming (scaled for raw feeding — better pals need fewer bodies), hauling, handiwork and a medic, then fills the specialty.'
          : 'gives every remaining slot to the specialty — ship food in from another base.')) +
      ' It never removes pals you placed, and never adds pals with no relevant work.'));

    left.append(crewPanel);
  }

  /* ---- coverage + catch list (right) ---- */
  function buildRight() {
    const det = coverageDetail(base);

    const covPanel = el('div', { class: 'panel' });
    covPanel.append(el('h3', {}, 'Work coverage ', el('span', { class: 'hint' }, '— click a tile for the best pals for that job')));
    const grid = el('div', { class: 'cov-grid' });
    const MAX_BADGES = 8, MAX_PROVIDERS = 3;
    for (const w of WORKS) {
      const { contributors, levels, blevels, aura } = det[w];
      const focus = base.purpose !== 'balanced' && (PRESETS[base.purpose].recipe[w] || 0) > 0;
      const auraTip = aura
        ? `${aura}'s partner skill: +1 ${w} for every other pal at this base (does not stack)`
        : null;
      const tile = el('div', {
        class: 'cov-tile' + (levels.length ? '' : ' zero') + (focus ? ' focus' : '') + (aura ? ' auraed' : ''),
        ...(focus ? { title: `Part of this base's ${PRESETS[base.purpose].label} recipe` } : {}),
        onclick: () => openWorkModal(w, base, refresh)
      });
      tile.append(el('div', { class: 'w-name' },
        w + (levels.length > 1 ? ` · ${levels.length} workers` : ''),
        aura ? el('span', { class: 'aura-flag', title: auraTip }, ' ✦+1') : ''));

      const badges = el('div', { class: 'lv-badges' });
      if (!blevels.length) badges.append(el('span', { class: 'w-dash' }, '—'));
      for (const b of blevels.slice(0, MAX_BADGES)) {
        badges.append(el('span', {
          class: `lv-badge lv${b.lv}` + (b.boosted ? ' boosted' : ''),
          ...(b.boosted ? { title: auraTip } : {})
        }, el('b', {}, String(b.lv))));
      }
      if (blevels.length > MAX_BADGES) badges.append(el('span', { class: 'w-dash' }, `+${blevels.length - MAX_BADGES}`));
      tile.append(badges);

      if (!contributors.length) {
        tile.append(el('div', { class: 'w-by' }, 'uncovered'));
      } else {
        for (const c of contributors.slice(0, MAX_PROVIDERS)) {
          tile.append(el('div', { class: 'w-by' + (c.short ? ' need' : '') },
            `${c.name}${c.qty > 1 ? ` ×${c.qty}` : ''}`,
            c.boosted ? el('span', { class: 'w-boost', title: auraTip }, ` ${c.level}→${c.blevel}` ) : '',
            c.short ? ' (to catch)' : ''));
        }
        if (contributors.length > MAX_PROVIDERS) {
          tile.append(el('div', { class: 'w-by' }, `+${contributors.length - MAX_PROVIDERS} more`));
        }
      }
      // the Farming tile also shows what this crew's ranch will produce
      if (w === 'Farming' && contributors.length) {
        const seen = new Set(), items = [];
        for (const c of contributors) {
          for (const it of (byName.get(c.name).ranch || [])) {
            if (!seen.has(it.name)) { seen.add(it.name); items.push(it); }
          }
        }
        if (items.length) {
          const strip = el('div', { class: 'ranch-items' });
          for (const it of items) {
            const img = it.icon ? el('img', { src: it.icon, alt: '', loading: 'lazy' }) : null;
            if (img) img.addEventListener('error', () => { img.style.display = 'none'; });
            strip.append(el('span', { class: 'ranch-item', title: it.name }, img, it.name));
          }
          tile.append(strip);
        }
      }
      grid.append(tile);
    }
    covPanel.append(grid);

    // catch list: per pal, how many copies you're short
    const needed = base.crew
      .map(e => ({ ...e, short: shortfallOf(base, e.name) }))
      .filter(e => e.short > 0);
    const totalShort = needed.reduce((s, e) => s + e.short, 0);
    const needPanel = el('div', { class: 'panel', style: 'margin-top:14px;' });
    needPanel.append(el('h3', {}, `Catch list (${totalShort})`));
    if (!needed.length) {
      needPanel.append(el('div', { class: 'tips' }, base.crew.length
        ? '✓ You own every copy this crew needs — this base is ready to build.'
        : 'Add pals to the crew to see what you still need to catch.'));
    } else {
      const list = el('div', { class: 'needed-list' });
      for (const e of needed) {
        const p = byName.get(e.name);
        const elsewhere = heldElsewhere(base, e.name);
        list.append(el('div', { class: 'crew-row need' },
          palIcon(p),
          el('b', {},
            el('a', { href: 'https://paldb.cc/en/' + p.slug, target: '_blank', rel: 'noopener', title: 'Open on paldb.cc (habitat, breeding combos)' }, p.name)),
          el('span', {
            class: 'status need',
            title: elsewhere ? `You own ${copiesOf(e.name)}, but ${elsewhere} are assigned to other bases` : null
          }, `need ${e.qty} · have ${allocatedTo(base, e.name)}` + (elsewhere ? ` · ${elsewhere} elsewhere` : '')),
          el('span', { class: 'work-chips' }, sortedWorks(p).slice(0, 3).map(([w, l]) => workChip(w, l, p))),
          el('button', {
            class: 'add-btn', title: 'Caught one — adds a copy to your roster',
            onclick: () => { setCopies(e.name, copiesOf(e.name) + 1); renderHeaderStats(); refresh(); }
          }, 'Caught one!')
        ));
      }
      needPanel.append(list);
      needPanel.append(el('div', { class: 'tips' },
        'Pal names link to paldb.cc for spawn locations and breeding combos. Owned copies go to reserve parties first, then to crews in the order you assigned them — "elsewhere" means an earlier assignment claimed them.'));
    }

    right.append(covPanel, needPanel);
  }

  refresh();
}

/* ================= auto-fill =================
   Two phases, both append-only and limited to free owned copies:
   1. Self-sufficiency (optional): meet the basics targets — food trio in work
      LEVELS (better pals = fewer bodies), hauling/handiwork/medicine in worker
      counts — preferring multi-job pals, existing crew counted first.
   2. Recipe: fill remaining slots proportionally to the purpose's slot shares
      (interleaved, so a thin roster yields a working miniature); a job with no
      pals left spills its share to the rest. Irrelevant pals are never added. */
function spareCopies(base, name) {
  // owned − in the party − in this crew − demanded by other bases
  return copiesOf(name) - partyCount(name) - crewQty(base, name) - demandElsewhere(base, name);
}

// crew job totals: worker count and summed levels per work type
function crewJobTotals(base) {
  const count = {}, levels = {};
  for (const e of base.crew) {
    const p = byName.get(e.name);
    if (!p) continue;
    for (const [w, lv] of Object.entries(p.works)) {
      count[w] = (count[w] || 0) + e.qty;
      levels[w] = (levels[w] || 0) + lv * e.qty;
    }
  }
  return { count, levels };
}

const FOOD_TRIO = ['Planting', 'Watering', 'Gathering'];

function fillBasics(base) {
  const foodTarget = BASICS_FOOD_LEVELS(base.cap);
  const countTargets = BASICS_COUNTS(base.cap);
  while (crewTotal(base) < base.cap) {
    const { count, levels } = crewJobTotals(base);
    const levelDeficit = w => Math.max(0, foodTarget - (levels[w] || 0));
    const countDeficit = w => Math.max(0, (countTargets[w] || 0) - (count[w] || 0));
    if (!FOOD_TRIO.some(levelDeficit) && !Object.keys(countTargets).some(countDeficit)) break;
    let best = null, bestGain = 0, bestFood = Infinity;
    for (const p of PALS) {
      if (spareCopies(base, p.name) <= 0) continue;
      let gain = 0;
      for (const w of FOOD_TRIO) gain += Math.min(p.works[w] || 0, levelDeficit(w));
      for (const w of Object.keys(countTargets)) {
        if ((p.works[w] || 0) > 0 && countDeficit(w) > 0) gain += BASICS_COUNT_WEIGHT;
      }
      if (gain > bestGain || (gain === bestGain && gain > 0 && (p.food || 0) < bestFood)) {
        best = p; bestGain = gain; bestFood = p.food || 0;
      }
    }
    if (!best) break;
    addToCrew(base, best.name, 1);
  }
}

// best free pal for one job: highest level, then (Farming) produce this base
// doesn't have yet, then lowest food
function bestCandidate(base, work) {
  const crewProduce = new Set(base.crew.flatMap(e => (byName.get(e.name)?.ranch || []).map(i => i.name)));
  let best = null, bestKey = null;
  for (const p of PALS) {
    const lv = p.works[work] || 0;
    if (!lv || spareCopies(base, p.name) <= 0) continue;
    const newProduce = work === 'Farming' && (p.ranch || []).some(i => !crewProduce.has(i.name)) ? 1 : 0;
    const key = [lv, newProduce, -(p.food || 0)];
    if (!best || key[0] > bestKey[0] || (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))) {
      best = p; bestKey = key;
    }
  }
  return best;
}

/* One aura pal for each of the purpose's top jobs (they don't stack, so never
   two of the same). Runs first: a +1 aura lifts every other worker at the base,
   including the food crew, so it's the best value per slot. */
function fillAuras(base, recipe) {
  let budget = auraBudget(base.cap);
  for (const w of auraJobsFor(recipe)) {
    if (!budget || crewTotal(base) >= base.cap) break;
    const name = AURA_BY_WORK[w];
    if (crewQty(base, name) > 0) { budget--; continue; } // already here — aura covered
    if (spareCopies(base, name) <= 0) continue;          // don't own a free one
    addToCrew(base, name, 1);
    budget--;
  }
}

// aura pals this purpose wants, with why they're not in the crew (for the hint line)
function auraStatus(base, recipe) {
  return auraJobsFor(recipe).slice(0, auraBudget(base.cap)).map(w => {
    const name = AURA_BY_WORK[w];
    const state = crewQty(base, name) > 0 ? 'in crew'
      : !isOwned(name) ? 'not owned'
        : spareCopies(base, name) > 0 ? 'free' : 'assigned elsewhere';
    return { work: w, name, state };
  });
}

function fillRecipe(base, recipe) {
  const filled = {}; // slots added per job by this phase
  const active = new Set(Object.keys(recipe));
  while (crewTotal(base) < base.cap && active.size) {
    // proportional scheduler: next slot goes to the job furthest behind its share
    const job = [...active].sort((a, b) => ((filled[a] || 0) + 1) / recipe[a] - ((filled[b] || 0) + 1) / recipe[b])[0];
    const p = bestCandidate(base, job);
    if (!p) { active.delete(job); continue; } // supply dry — share spills to the rest
    addToCrew(base, p.name, 1);
    filled[job] = (filled[job] || 0) + 1;
  }
}

function autofill(base) {
  const preset = PRESETS[base.purpose] || PRESETS.balanced;
  if (base.purpose === 'balanced') {
    // balanced IS the basics — but still honor the medicine-per-15 rule
    const medTarget = Math.round(base.cap / 15);
    while (crewTotal(base) < base.cap && (crewJobTotals(base).count['Medicine Production'] || 0) < medTarget) {
      const p = bestCandidate(base, 'Medicine Production');
      if (!p) break;
      addToCrew(base, p.name, 1);
    }
  } else {
    fillAuras(base, preset.recipe); // specialty bases only
    if (base.coverBasics) fillBasics(base);
  }
  fillRecipe(base, preset.recipe);
  persist(`Auto-fill ${base.name}`);
}

/* ================= work modal ================= */
function openWorkModal(work, base, onChange) {
  const root = $('#modal-root');
  $('#modal-title').textContent = `Best pals — ${work}`;
  const body = $('#modal-body');
  body.innerHTML = '';

  let ownedOnly = false;
  const listWrap = el('div', { class: 'pal-list' });

  const filter = el('div', { class: 'modal-filter' },
    el('label', { class: 'check' },
      el('input', { type: 'checkbox', onchange: e => { ownedOnly = e.target.checked; renderList(); } }),
      ' Only pals I own'),
    el('span', { class: 'spacer' })
  );
  body.append(filter, listWrap);

  function renderList() {
    listWrap.innerHTML = '';
    // the aura pal for this work (+1 to every OTHER pal at the base) is pinned
    // to the top — its own low level undersells what it adds to the whole crew
    const auraName = AURA_BY_WORK[work];
    const candidates = PALS
      .filter(p => (p.works[work] || 0) > 0 && p.name !== auraName && (!ownedOnly || isOwned(p.name)))
      .sort((a, b) => (b.works[work] - a.works[work]) || (totalLevels(b) - totalLevels(a)))
      .slice(0, 25);
    const auraPal = auraName && (!ownedOnly || isOwned(auraName)) ? byName.get(auraName) : null;
    if (auraPal) candidates.unshift(auraPal);
    if (!candidates.length) {
      listWrap.append(el('div', { class: 'empty-note' }, `You don't own any pal with ${work} yet.`));
      return;
    }
    // two normalized lines per row:
    //   line 1: identity + work level + food ················· + Add
    //   line 2: ownership pill · in-crew pill · aura pill · ranch produce
    for (const p of candidates) {
      const crewChip = el('span', { class: 'wm-pill increw', ...(crewQty(base, p.name) ? {} : { hidden: '' }) },
        `in crew ×${crewQty(base, p.name)}`);
      const statusText = () => `Owned ×${copiesOf(p.name)} · ${globalFree(p.name)} free`;
      const statusPill = isOwned(p.name)
        ? el('span', {
          class: 'wm-pill have',
          title: 'Copies you own · copies not already claimed by a reserve party or a base crew'
        }, statusText())
        : el('span', { class: 'wm-pill need' }, 'Not owned');
      const top = el('div', { class: 'wm-top' },
        palIcon(p),
        el('span', { class: 'pal-id' }, dexLabel(p)),
        el('span', { class: 'pal-name' }, p.name),
        // while-at-base partner skill, when it has one (desktop only — fills the
        // middle; the pinned aura row already carries its own flag)
        p.partner && p.partner.tags.includes('base') && p.name !== auraName
          ? el('span', { class: 'wm-skill', title: `${p.partner.skill} — ${p.partner.desc}` }, '✦ ' + p.partner.skill)
          : null,
        // compact level badge — the modal title already names the work; the
        // pinned aura pal may have no own level here (Cinnamoth/Farming)
        (p.works[work] || 0) > 0
          ? el('span', { class: `lv-badge lv${p.works[work]}`, title: `${work} ${p.works[work]}` }, el('b', {}, String(p.works[work])))
          : null,
        el('button', {
          class: 'add-btn',
          onclick: () => {
            addToCrew(base, p.name, 1); persist(`Add ${p.name}`); onChange();
            crewChip.hidden = false;
            crewChip.textContent = `in crew ×${crewQty(base, p.name)}`;
            if (isOwned(p.name)) statusPill.textContent = statusText();
          }
        }, '+ Add'));
      const sub = el('div', { class: 'wm-sub' },
        statusPill,
        crewChip,
        isNight(p) ? el('span', { class: 'night', title: 'Dark-type: works through the night' }, '🌙') : null,
        foodChip(p),
        p.name === auraName ? el('span', {
          class: 'aura-flag modal-aura',
          title: `${p.partner.skill} — +1 ${work} for every OTHER pal at this base (does not stack). Its own level undersells it: one of these lifts the whole crew.`
        }, '✦ +1 to all others') : null,
        work === 'Farming' && p.ranch
          ? el('span', { class: 'ranch-mini', title: p.ranch.map(i => i.name).join(', ') },
            '→ ' + p.ranch.map(i => i.name).join(', '))
          : null,
        // what else this pal can do (desktop only) — secondaries decide ties
        (() => {
          const others = sortedWorks(p).filter(([w]) => w !== work).slice(0, 3);
          return others.length
            ? el('span', { class: 'wm-others', title: 'Other work suitabilities' },
              'also: ' + others.map(([w, l]) => `${w} ${l}`).join(' · '))
            : null;
        })());
      listWrap.append(el('div', { class: 'pal-row wm-row' + (isOwned(p.name) ? ' owned' : '') }, top, sub));
    }
  }
  renderList();
  root.hidden = false;
}

function closeModal() { $('#modal-root').hidden = true; }

/* ================= shell ================= */
function render() {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === ui.view));
  renderHeaderStats();
  if (ui.view === 'roster') renderRoster();
  else if (ui.view === 'party') renderParty();
  else renderBases();
}

$('#tabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  ui.view = btn.dataset.view;
  persistUI(); render();
});

$('#modal-close').addEventListener('click', closeModal);
$('#modal-root').addEventListener('click', e => { if (e.target.classList.contains('modal-backdrop')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* export / import — accepts current (v2, parties) and both legacy formats */
$('#btn-export').addEventListener('click', () => {
  const payload = {
    version: 2, exportedAt: new Date().toISOString(),
    roster, bases, bonus, parties, partyMemo,
    // legacy field so pre-parties versions of the app can still import this file
    party: (parties.find(pt => pt.reserve) || parties[0] || { members: [] }).members,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `palpedia-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
});
$('#btn-import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    let newRoster;
    if (Array.isArray(data.roster)) {
      newRoster = Object.fromEntries(data.roster.filter(n => byName.has(n)).map(n => [n, 1]));
    } else if (data.roster && typeof data.roster === 'object') {
      newRoster = {};
      for (const [n, q] of Object.entries(data.roster)) {
        const qty = Math.floor(Number(q));
        if (byName.has(n) && qty > 0) newRoster[n] = qty;
      }
    } else throw new Error('bad shape');
    if (!Array.isArray(data.bases)) throw new Error('bad shape');
    // NOTE: not stamped yet — stampSeqs mutates the global nextSeq, which must
    // not change if the user cancels the confirm below
    const newBases = data.bases.filter(b => b && b.id && Array.isArray(b.crew))
      .map(normalizeBase);
    const newParties = Array.isArray(data.parties)
      ? data.parties.filter(pt => pt && typeof pt === 'object').map(normalizeParty)
      : Array.isArray(data.party) && data.party.length
        ? [normalizeParty({ name: 'Party 1', reserve: true, members: data.party }, 0)]
        : [];
    const copies = Object.values(newRoster).reduce((a, b) => a + b, 0);
    const partyN = newParties.reduce((s, pt) => s + pt.members.length, 0);
    if (!confirm(
      `Import ${Object.keys(newRoster).length} owned pals (${copies} copies), ${newBases.length} bases and ${partyN} party pals?\n\n` +
      `This REPLACES your current roster, bases, parties and ★5 marks ` +
      `(you have ${uniqueOwned()} pals, ${bases.length} bases, ${parties.reduce((s, pt) => s + pt.members.length, 0)} party pals). ` +
      `Undo in the top bar can restore them.`)) return;
    roster = newRoster;
    bases = stampSeqs(newBases);
    bonus = {};
    for (const n of Object.keys(data.bonus || {})) if (byName.has(n)) bonus[n] = 1;
    for (const [n, q] of Object.entries(roster)) if (q >= BONUS_AT) bonus[n] = 1;
    parties = newParties;
    partyMemo = {};
    for (const [n, m] of Object.entries(data.partyMemo || {})) {
      const v = normalizeMember({ ...m, name: n });
      if (v) partyMemo[n] = v;
    }
    ui.baseId = null;
    persist('Import backup'); persistUI(); render();
  } catch {
    alert('Could not read that file — expected a backup exported from this planner.');
  }
});

/* ================= undo (top bar) ================= */
const undoBtn = $('#btn-undo');
const undoHistBtn = $('#btn-undo-hist');
const undoPanel = $('#undo-panel');

function timeAgo(at) {
  const s = Math.round((Date.now() - at) / 1000);
  return s < 5 ? 'just now' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
}
function historyRows(panel) {
  if (!history.length) {
    panel.append(el('div', { class: 'undo-empty' }, 'No changes to undo yet.'));
    return;
  }
  [...history].reverse().forEach(h => {
    // resolve the entry's index at CLICK time — the list may have shifted
    // (HISTORY_MAX eviction) while this panel sat open
    panel.append(el('button', {
      class: 'undo-row', onclick: () => {
        panel.hidden = true;
        const i = history.indexOf(h);
        if (i !== -1) undoTo(i);
      }
    },
      el('span', { class: 'undo-label' }, h.label),
      el('span', { class: 'undo-when' }, timeAgo(h.at))));
  });
  panel.append(el('div', { class: 'undo-hint' }, 'Click an entry to undo it and everything after it.'));
}
function paintUndo() {
  const last = history[history.length - 1];
  undoBtn.disabled = !last;
  undoBtn.title = last ? `Undo: ${last.label}` : 'Nothing to undo yet (tracks your last 5 changes, this tab only)';
  undoHistBtn.disabled = !last;
  undoPanel.innerHTML = '';
  historyRows(undoPanel);
}
undoBtn.addEventListener('click', () => { undoPanel.hidden = true; undoTo(history.length - 1); });
undoHistBtn.addEventListener('click', () => { paintUndo(); undoPanel.hidden = !undoPanel.hidden; });

/* the phone topbar collapses history/export/import behind a ⋮ menu */
const menuBtn = $('#btn-menu');
const menuPanel = $('#mobile-menu');
menuBtn.addEventListener('click', () => {
  if (!menuPanel.hidden) { menuPanel.hidden = true; return; }
  menuPanel.innerHTML = '';
  historyRows(menuPanel);
  menuPanel.append(
    el('div', { class: 'menu-sep' }),
    el('button', { class: 'undo-row', onclick: () => { menuPanel.hidden = true; $('#btn-export').click(); } },
      el('span', { class: 'undo-label' }, 'Export backup')),
    el('button', { class: 'undo-row', onclick: () => { menuPanel.hidden = true; $('#btn-import').click(); } },
      el('span', { class: 'undo-label' }, 'Import backup')));
  menuPanel.hidden = false;
});
document.addEventListener('mousedown', e => {
  if (!undoPanel.hidden && !undoPanel.contains(e.target) && e.target !== undoHistBtn) undoPanel.hidden = true;
  if (!menuPanel.hidden && !menuPanel.contains(e.target) && e.target !== menuBtn) menuPanel.hidden = true;
});

/* ================= multi-tab sync =================
   Another tab wrote palplanner data: re-read it and re-render IMMEDIATELY, so
   this tab can never save stale state over it. (An earlier design deferred the
   reload while an input was focused — that left an unbounded window where this
   tab's next save clobbered the other tab; an interrupted keystroke is the
   lesser evil, and only happens when both tabs edit at the same moment.)
   View state (palplanner.ui.v1) is NOT synced — each tab keeps its own
   tab/filters/open base. Open modals are closed: their buttons hold references
   to pre-reload objects and would silently edit detached state. */
function applyExternalChange() {
  externalWrites++;
  closeModal();
  reloadData();
  if (ui.baseId && !bases.find(b => b.id === ui.baseId)) { ui.baseId = null; persistUI(); }
  paintUndo();
  render();
}
window.addEventListener('storage', e => {
  // only actual data keys — not ui state, not banner-dismiss flags
  if (e.key !== null && !DATA_KEYS.includes(e.key)) return;
  applyExternalChange();
});

paintUndo();
render();

// ask the browser not to evict this origin's storage (Safari clears unvisited
// sites after ~7 days otherwise); best-effort, needs no permission prompt
if ((uniqueOwned() || bases.length) && navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => { /* advisory only */ });
}
