'use strict';

/* ================= data ================= */
const DATA = window.PAL_DATA;
const WORKS = DATA.meta.work_types;
const PALS = DATA.pals; // sorted by paldex, collab pals last
const byName = new Map(PALS.map(p => [p.name, p]));
const dexOrder = new Map(PALS.map((p, i) => [p.name, i]));
const ELEMENTS = ['Neutral', 'Fire', 'Water', 'Grass', 'Electric', 'Ground', 'Rock', 'Ice', 'Dragon', 'Dark'];
const CAP_DEFAULT = 15; // default per-base worker cap; editable per base
const CAP_MAX = 50;
// auto-fill: a 2nd worker on the same job counts half as much as the 1st, a 3rd a quarter, …
const AUTOFILL_DIMINISH = 0.5;
const AUTOFILL_MIN_GAIN = 0.9;

/* ================= state ================= */
const LS_ROSTER_V1 = 'palplanner.roster.v1'; // legacy: array of owned names
const LS_ROSTER = 'palplanner.roster.v2';    // { name: copies }
const LS_BASES = 'palplanner.bases.v1';      // crew: [{name, qty}] (legacy: array of names)
const LS_UI = 'palplanner.ui.v1';

function lsLoad(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v === null || v === undefined ? fallback : v;
  } catch { return fallback; }
}

// roster: { name: copies owned }
let roster = (() => {
  const v2 = lsLoad(LS_ROSTER, null);
  const src = v2 !== null ? v2
    : Object.fromEntries(lsLoad(LS_ROSTER_V1, []).map(n => [n, 1]));
  const clean = {};
  for (const [n, q] of Object.entries(src)) {
    const qty = Math.floor(Number(q));
    if (byName.has(n) && qty > 0) clean[n] = qty;
  }
  return clean;
})();

// accepts legacy ["A","B"] and current [{name, qty}]; merges duplicates
function normalizeCrew(crew) {
  const m = new Map();
  for (const item of crew) {
    const name = typeof item === 'string' ? item : item && item.name;
    const qty = typeof item === 'string' ? 1 : Math.max(1, Math.floor(Number(item && item.qty) || 1));
    if (byName.has(name)) m.set(name, (m.get(name) || 0) + qty);
  }
  return [...m].map(([name, qty]) => ({ name, qty }));
}

function clampCap(n) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v >= 1 ? Math.min(v, CAP_MAX) : CAP_DEFAULT;
}

let bases = lsLoad(LS_BASES, [])
  .filter(b => b && b.id && Array.isArray(b.crew))
  .map(b => ({ id: String(b.id), name: String(b.name || 'Base'), crew: normalizeCrew(b.crew), cap: clampCap(b.cap) }));

let ui = Object.assign(
  { view: 'roster', baseId: null, search: '', element: '', works: [], ownedOnly: false, sort: 'dex' },
  lsLoad(LS_UI, {})
);
// migrate the old single-work filter (ui.work: string) to ui.works: []
if (typeof ui.work === 'string' && ui.work) ui.works = [ui.work];
delete ui.work;
if (!Array.isArray(ui.works)) ui.works = [];
ui.works = ui.works.filter(w => WORKS.includes(w));

function persist() {
  localStorage.setItem(LS_ROSTER, JSON.stringify(roster));
  localStorage.setItem(LS_BASES, JSON.stringify(bases));
  localStorage.setItem(LS_UI, JSON.stringify(ui));
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
function setCopies(name, n) {
  if (n > 0) roster[name] = n; else delete roster[name];
  persist();
}
const uniqueOwned = () => Object.keys(roster).length;
const totalCopies = () => Object.values(roster).reduce((a, b) => a + b, 0);

const crewEntry = (base, name) => base.crew.find(e => e.name === name);
const crewTotal = base => base.crew.reduce((s, e) => s + e.qty, 0);
const crewQty = (base, name) => (crewEntry(base, name) || { qty: 0 }).qty;
function addToCrew(base, name, n = 1) {
  const e = crewEntry(base, name);
  if (e) e.qty += n; else base.crew.push({ name, qty: n });
}
function setCrewQty(base, name, qty) {
  if (qty <= 0) base.crew = base.crew.filter(e => e.name !== name);
  else crewEntry(base, name).qty = qty;
}
/* Owned copies are allocated to bases in list order (the first base on the
   Bases screen gets first claim). A copy assigned to one base is never
   counted as available to another. */
function allocatedTo(base, name) {
  let remaining = copiesOf(name);
  for (const b of bases) {
    const take = Math.min(crewQty(b, name), remaining);
    if (b.id === base.id) return take;
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
// owned copies not assigned to any base
const globalFree = name =>
  Math.max(0, copiesOf(name) - bases.reduce((s, b) => s + crewQty(b, name), 0));
// copies this base wants but cannot get (not owned, or claimed by an earlier base)
const shortfallOf = (base, name) => Math.max(0, crewQty(base, name) - allocatedTo(base, name));
const baseShortfall = base => base.crew.reduce((s, e) => s + shortfallOf(base, e.name), 0);

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

function elementChips(p) {
  return el('span', { class: 'chips' },
    p.elements.map(e => el('span', { class: `el-chip el-${e}` }, e)),
    isNight(p) ? el('span', { class: 'night', title: 'Dark-type: works through the night' }, '🌙') : null
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

/* per work type: who in this crew contributes, and the full stack of levels (copies expanded) */
function coverageDetail(base) {
  const det = {};
  for (const w of WORKS) {
    const contributors = [];
    for (const e of base.crew) {
      const p = byName.get(e.name);
      if (!p) continue;
      const lv = p.works[w] || 0;
      if (!lv) continue;
      contributors.push({ name: e.name, level: lv, qty: e.qty, short: shortfallOf(base, e.name) });
    }
    contributors.sort((a, b) => b.level - a.level || b.qty - a.qty);
    const levels = contributors.flatMap(c => Array(c.qty).fill(c.level)).sort((a, b) => b - a);
    det[w] = { contributors, levels };
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
  if (ui.ownedOnly && !isOwned(p.name)) return false;
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
  else copy.sort((a, b) => dexOrder.get(a.name) - dexOrder.get(b.name));
  // when filtering by work types, sort the strongest at those works to the top
  if (ui.works.length) copy.sort((a, b) => selectedWorksTotal(b) - selectedWorksTotal(a));
  return copy;
}

function renderRoster() {
  const view = $('#view');
  view.innerHTML = '';

  const listWrap = el('div', { class: 'pal-list' });

  const searchInput = el('input', {
    type: 'search', placeholder: 'Search name or #paldex…', value: ui.search,
    oninput: e => { ui.search = e.target.value.trim(); persist(); renderList(); }
  });
  const elementSel = el('select',
    { onchange: e => { ui.element = e.target.value; persist(); renderList(); } },
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
        persist(); renderList();
      });
      panel.append(el('label', { class: 'multi-row' }, cb, ' ', w));
    }
    panel.append(el('button', {
      class: 'ghost multi-clear', type: 'button',
      onclick: () => {
        ui.works = [];
        panel.querySelectorAll('input').forEach(c => { c.checked = false; });
        btn.firstChild.textContent = btnLabel();
        persist(); renderList();
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
    { onchange: e => { ui.sort = e.target.value; persist(); renderList(); } },
    [['dex', 'Sort: Paldex'], ['name', 'Sort: Name'], ['total', 'Sort: Total levels'], ['best', 'Sort: Best level']]
      .map(([v, t]) => el('option', { value: v, selected: ui.sort === v ? '' : null }, t))
  );
  const ownedChk = el('label', { class: 'check' },
    el('input', {
      type: 'checkbox', ...(ui.ownedOnly ? { checked: '' } : {}),
      onchange: e => { ui.ownedOnly = e.target.checked; persist(); renderList(); }
    }),
    'Owned only'
  );
  const countPill = el('span', { class: 'count-pill' });

  view.append(
    el('div', { class: 'toolbar' }, searchInput, elementSel, workSel, sortSel, ownedChk,
      el('span', { class: 'spacer' }), countPill),
    listWrap
  );

  function renderList() {
    const pals = sortPals(PALS.filter(matchesFilters));
    countPill.innerHTML = '';
    countPill.append('Own ', el('b', {}, String(uniqueOwned())), ` / ${PALS.length}`,
      totalCopies() > uniqueOwned() ? ` · ${totalCopies()} copies` : '',
      pals.length !== PALS.length ? ` · showing ${pals.length}` : '');
    listWrap.innerHTML = '';
    if (!pals.length) {
      listWrap.append(el('div', { class: 'empty-note' }, 'No pals match these filters.'));
      return;
    }
    for (const p of pals) {
      const owned = isOwned(p.name);
      const row = el('div', { class: 'pal-row' + (owned ? ' owned' : '') });
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
        el('span', { class: 'work-chips' }, sortedWorks(p).map(([w, l]) => {
          const chip = workChip(w, l, p);
          if (ui.works.includes(w)) chip.classList.add('hl');
          return chip;
        }))
      );
      listWrap.append(row);
    }
  }
  renderList();
}

/* ================= bases view ================= */
function newBase() {
  const base = { id: 'b' + Date.now().toString(36), name: `Base ${bases.length + 1}`, crew: [], cap: CAP_DEFAULT };
  bases.push(base);
  ui.baseId = base.id;
  persist(); renderHeaderStats(); render();
}

function renderBases() {
  const view = $('#view');
  view.innerHTML = '';
  const base = bases.find(b => b.id === ui.baseId);
  if (base) return renderEditor(view, base);

  const grid = el('div', { class: 'grid-cards' });
  for (const b of bases) {
    const total = crewTotal(b);
    const missing = baseShortfall(b);
    const det = coverageDetail(b);
    const covered = WORKS.filter(w => det[w].levels.length > 0).length;
    grid.append(el('div', { class: 'base-card', onclick: () => { ui.baseId = b.id; persist(); render(); } },
      el('h3', {}, b.name),
      el('div', { class: 'meta' }, `${total} / ${b.cap} pals · covers ${covered}/12 work types`),
      missing
        ? el('div', { class: 'missing' }, `⚠ ${missing} cop${missing === 1 ? 'y' : 'ies'} still to catch`)
        : el('div', { class: 'meta', style: 'color: var(--ok)' }, total ? '✓ full crew owned' : 'empty')
    ));
  }
  grid.append(el('div', { class: 'base-card new', onclick: newBase }, '+ New base'));
  view.append(grid);
  if (!bases.length) {
    view.append(el('p', { class: 'empty-note' },
      'Plan a base crew, see its combined work coverage, and get a catch-list for the pals you are missing. Everything saves to this browser automatically.'));
  }
}

/* ================= base editor ================= */
function renderEditor(view, base) {
  const head = el('div', { class: 'editor-head' },
    el('button', { class: 'ghost', onclick: () => { ui.baseId = null; persist(); render(); } }, '← All bases'),
    el('input', {
      class: 'base-name', value: base.name, maxlength: '40',
      onchange: e => { base.name = e.target.value.trim() || 'Unnamed base'; e.target.value = base.name; persist(); renderHeaderStats(); }
    }),
    el('label', { class: 'cap-field', title: 'Maximum workers at this base — raise it as you upgrade the base in-game' },
      'Max workers',
      el('input', {
        type: 'number', min: '1', max: String(CAP_MAX), value: String(base.cap),
        onchange: e => { base.cap = clampCap(e.target.value); e.target.value = String(base.cap); persist(); refresh(); }
      })
    ),
    el('button', {
      class: 'btn warn-btn', onclick: () => {
        if (confirm(`Delete "${base.name}"? This cannot be undone.`)) {
          bases = bases.filter(b => b.id !== base.id);
          ui.baseId = null; persist(); renderHeaderStats(); render();
        }
      }
    }, 'Delete base')
  );

  const left = el('div', {});
  const right = el('div', {});
  view.append(head, el('div', { class: 'editor-cols' }, left, right));

  function refresh() { left.innerHTML = ''; right.innerHTML = ''; buildLeft(); buildRight(); }

  function addPal(name) { addToCrew(base, name, 1); persist(); refresh(); }

  /* ---- crew panel (left) ---- */
  function buildLeft() {
    const total = crewTotal(base);
    const crewPanel = el('div', { class: 'panel' });
    crewPanel.append(el('h3', {}, `Crew (${total} / ${base.cap})`));

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
        qtyStepper(() => crewQty(base, entry.name), n => { setCrewQty(base, entry.name, n); persist(); }, refresh),
        el('span', { class: 'work-chips' }, sortedWorks(p).map(([w, l]) => workChip(w, l, p))),
        el('button', { class: 'rm', title: 'Remove from crew', onclick: () => { setCrewQty(base, entry.name, 0); persist(); refresh(); } }, '✕')
      ));
    }
    crewPanel.append(list);

    if (total > base.cap) {
      crewPanel.append(el('div', { class: 'crew-cap' },
        `⚠ ${total} workers planned, but this base's max is ${base.cap}.`));
    }

    crewPanel.append(el('div', { style: 'margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;' },
      el('button', { class: 'btn', onclick: () => { autofill(base); refresh(); } }, 'Auto-fill from my roster'),
      el('button', { class: 'ghost', onclick: () => { base.crew = []; persist(); refresh(); } }, 'Clear crew')
    ));
    crewPanel.append(el('div', { class: 'tips' },
      `Auto-fill adds your best free copies (owned and not assigned to any base) up to this base's max of ${base.cap}. Extra workers on the same job count for less (2nd counts half, 3rd a quarter…), so it covers empty jobs first, then stacks your strongest pals.`));

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
      const { contributors, levels } = det[w];
      const tile = el('div', { class: 'cov-tile' + (levels.length ? '' : ' zero'), onclick: () => openWorkModal(w, base, refresh) });
      tile.append(el('div', { class: 'w-name' }, w + (levels.length > 1 ? ` · ${levels.length} workers` : '')));

      const badges = el('div', { class: 'lv-badges' });
      if (!levels.length) badges.append(el('span', { class: 'w-dash' }, '—'));
      for (const lv of levels.slice(0, MAX_BADGES)) {
        badges.append(el('span', { class: `lv-badge lv${lv}` }, el('b', {}, String(lv))));
      }
      if (levels.length > MAX_BADGES) badges.append(el('span', { class: 'w-dash' }, `+${levels.length - MAX_BADGES}`));
      tile.append(badges);

      if (!contributors.length) {
        tile.append(el('div', { class: 'w-by' }, 'uncovered'));
      } else {
        for (const c of contributors.slice(0, MAX_PROVIDERS)) {
          tile.append(el('div', { class: 'w-by' + (c.short ? ' need' : '') },
            `${c.name}${c.qty > 1 ? ` ×${c.qty}` : ''}${c.short ? ' (to catch)' : ''}`));
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
        'Pal names link to paldb.cc for spawn locations and breeding combos. Owned copies are assigned to bases in the order they appear on the Bases screen — "elsewhere" means an earlier base has claimed them.'));
    }

    right.append(covPanel, needPanel);
  }

  refresh();
}

/* ================= auto-fill =================
   Greedy: repeatedly add the spare owned copy that raises the crew's weighted
   score the most. A job's workers are sorted by level; the i-th worker counts
   level * DIMINISH^i, so empty jobs get covered first and strong duplicates
   still help. Stops at the soft cap or when the best gain is negligible. */
function weightedWorkScore(levelsDesc) {
  let s = 0;
  for (let i = 0; i < levelsDesc.length; i++) s += levelsDesc[i] * Math.pow(AUTOFILL_DIMINISH, i);
  return s;
}
function baseScore(base) {
  const det = coverageDetail(base);
  return WORKS.reduce((s, w) => s + weightedWorkScore(det[w].levels), 0);
}
function autofill(base) {
  while (crewTotal(base) < base.cap) {
    const current = baseScore(base);
    let best = null, bestGain = AUTOFILL_MIN_GAIN;
    for (const p of PALS) {
      // only copies no base has claimed: owned − in this crew − demanded by other bases
      const spare = copiesOf(p.name) - crewQty(base, p.name) - demandElsewhere(base, p.name);
      if (spare <= 0) continue;
      addToCrew(base, p.name, 1);
      const gain = baseScore(base) - current;
      setCrewQty(base, p.name, crewQty(base, p.name) - 1);
      if (gain > bestGain) { best = p; bestGain = gain; }
    }
    if (!best) break;
    addToCrew(base, best.name, 1);
  }
  persist();
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
    const candidates = PALS
      .filter(p => (p.works[work] || 0) > 0 && (!ownedOnly || isOwned(p.name)))
      .sort((a, b) => (b.works[work] - a.works[work]) || (totalLevels(b) - totalLevels(a)))
      .slice(0, 25);
    if (!candidates.length) {
      listWrap.append(el('div', { class: 'empty-note' }, `You don't own any pal with ${work} yet.`));
      return;
    }
    for (const p of candidates) {
      const crewChip = el('span', { class: 'status increw', ...(crewQty(base, p.name) ? {} : { hidden: '' }) },
        `in crew ×${crewQty(base, p.name)}`);
      listWrap.append(el('div', { class: 'pal-row' + (isOwned(p.name) ? ' owned' : '') },
        palIcon(p),
        el('span', { class: 'pal-id' }, dexLabel(p)),
        el('span', { class: 'pal-name' }, p.name),
        isNight(p) ? el('span', { class: 'night', title: 'Works through the night' }, '🌙') : null,
        el('span', { class: `wchip lv${p.works[work]}` }, `${work} `, el('b', {}, String(p.works[work]))),
        work === 'Farming' && p.ranch
          ? el('span', { class: 'ranch-mini', title: p.ranch.map(i => i.name).join(', ') },
            '→ ' + p.ranch.map(i => i.name).join(', '))
          : null,
        isOwned(p.name)
          ? el('span', { class: 'status have' },
            `owned ×${copiesOf(p.name)}` + (globalFree(p.name) < copiesOf(p.name) ? ` · ${globalFree(p.name)} free` : ''))
          : el('span', { class: 'status need' }, 'not owned'),
        crewChip,
        el('span', { class: 'spacer', style: 'flex:1' }),
        el('button', {
          class: 'add-btn',
          onclick: () => {
            addToCrew(base, p.name, 1); persist(); onChange();
            crewChip.hidden = false;
            crewChip.textContent = `in crew ×${crewQty(base, p.name)}`;
          }
        }, '+ Add')
      ));
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
  else renderBases();
}

$('#tabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  ui.view = btn.dataset.view;
  persist(); render();
});

$('#modal-close').addEventListener('click', closeModal);
$('#modal-root').addEventListener('click', e => { if (e.target.classList.contains('modal-backdrop')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* export / import — accepts both current and pre-count backup formats */
$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), roster, bases }, null, 2)],
    { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'palworld-base-planner-backup.json' });
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
    const newBases = data.bases.filter(b => b && b.id && Array.isArray(b.crew))
      .map(b => ({ id: String(b.id), name: String(b.name || 'Base'), crew: normalizeCrew(b.crew), cap: clampCap(b.cap) }));
    const copies = Object.values(newRoster).reduce((a, b) => a + b, 0);
    if (!confirm(`Import ${Object.keys(newRoster).length} owned pals (${copies} copies) and ${newBases.length} bases? This replaces your current data.`)) return;
    roster = newRoster;
    bases = newBases;
    ui.baseId = null;
    persist(); render();
  } catch {
    alert('Could not read that file — expected a backup exported from this planner.');
  }
});

render();
