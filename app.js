'use strict';

/* ================= data ================= */
const DATA = window.PAL_DATA;
const WORKS = DATA.meta.work_types;
const PALS = DATA.pals; // sorted by paldex, collab pals last
const byName = new Map(PALS.map(p => [p.name, p]));
const dexOrder = new Map(PALS.map((p, i) => [p.name, i]));
const ELEMENTS = ['Neutral', 'Fire', 'Water', 'Grass', 'Electric', 'Ground', 'Rock', 'Ice', 'Dragon', 'Dark'];
const CREW_SOFT_CAP = 15;

/* ================= state ================= */
const LS_ROSTER = 'palplanner.roster.v1';
const LS_BASES = 'palplanner.bases.v1';
const LS_UI = 'palplanner.ui.v1';

function lsLoad(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v === null || v === undefined ? fallback : v;
  } catch { return fallback; }
}

let roster = new Set(lsLoad(LS_ROSTER, []).filter(n => byName.has(n)));
let bases = lsLoad(LS_BASES, []).filter(b => b && Array.isArray(b.crew));
let ui = Object.assign(
  { view: 'roster', baseId: null, search: '', element: '', work: '', ownedOnly: false, sort: 'dex' },
  lsLoad(LS_UI, {})
);

function persist() {
  localStorage.setItem(LS_ROSTER, JSON.stringify([...roster]));
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

function workChip(work, lv) {
  return el('span', { class: `wchip lv${lv}` }, `${work} `, el('b', {}, String(lv)));
}

function elementChips(p) {
  return el('span', { class: 'chips' },
    p.elements.map(e => el('span', { class: `el-chip el-${e}` }, e)),
    isNight(p) ? el('span', { class: 'night', title: 'Dark-type: works through the night' }, '🌙') : null
  );
}

function coverage(crewNames) {
  const cov = {};
  for (const w of WORKS) {
    let level = 0, by = null;
    for (const name of crewNames) {
      const p = byName.get(name);
      if (p && (p.works[w] || 0) > level) { level = p.works[w]; by = p.name; }
    }
    cov[w] = { level, by };
  }
  return cov;
}

function renderHeaderStats() {
  $('#header-stats').textContent =
    `v1.0 data · ${roster.size} / ${PALS.length} pals owned · ${bases.length} base${bases.length === 1 ? '' : 's'} saved`;
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
  if (ui.work && !(ui.work in p.works)) return false;
  if (ui.ownedOnly && !roster.has(p.name)) return false;
  return true;
}

function sortPals(list) {
  const s = ui.sort;
  const copy = [...list];
  if (s === 'name') copy.sort((a, b) => a.name.localeCompare(b.name));
  else if (s === 'total') copy.sort((a, b) => totalLevels(b) - totalLevels(a));
  else if (s === 'best') copy.sort((a, b) => bestLevel(b) - bestLevel(a) || totalLevels(b) - totalLevels(a));
  else copy.sort((a, b) => dexOrder.get(a.name) - dexOrder.get(b.name));
  // when filtering by a work type, sort that work to the top regardless
  if (ui.work) copy.sort((a, b) => (b.works[ui.work] || 0) - (a.works[ui.work] || 0));
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
  const workSel = el('select',
    { onchange: e => { ui.work = e.target.value; persist(); renderList(); } },
    el('option', { value: '' }, 'Any work'),
    WORKS.map(x => el('option', { value: x, selected: ui.work === x ? '' : null }, x))
  );
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
    countPill.append('Own ', el('b', {}, String(roster.size)), ` / ${PALS.length}`,
      pals.length !== PALS.length ? ` · showing ${pals.length}` : '');
    listWrap.innerHTML = '';
    if (!pals.length) {
      listWrap.append(el('div', { class: 'empty-note' }, 'No pals match these filters.'));
      return;
    }
    for (const p of pals) {
      const owned = roster.has(p.name);
      listWrap.append(el('div', { class: 'pal-row' + (owned ? ' owned' : '') },
        el('input', {
          type: 'checkbox', class: 'own-toggle', title: owned ? 'Owned — click to remove' : 'Click when you catch one',
          ...(owned ? { checked: '' } : {}),
          onchange: e => {
            e.target.checked ? roster.add(p.name) : roster.delete(p.name);
            persist(); renderHeaderStats(); renderList();
          }
        }),
        palIcon(p),
        el('span', { class: 'pal-id' }, dexLabel(p)),
        el('span', { class: 'pal-name' },
          el('a', { href: 'https://paldb.cc/en/' + p.slug, target: '_blank', rel: 'noopener' }, p.name)),
        elementChips(p),
        el('span', { class: 'work-chips' }, sortedWorks(p).map(([w, l]) => workChip(w, l)))
      ));
    }
  }
  renderList();
}

/* ================= bases view ================= */
function newBase() {
  const base = { id: 'b' + Date.now().toString(36), name: `Base ${bases.length + 1}`, crew: [] };
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
    const missing = b.crew.filter(n => !roster.has(n));
    const cov = coverage(b.crew);
    const covered = WORKS.filter(w => cov[w].level > 0).length;
    grid.append(el('div', { class: 'base-card', onclick: () => { ui.baseId = b.id; persist(); render(); } },
      el('h3', {}, b.name),
      el('div', { class: 'meta' }, `${b.crew.length} pal${b.crew.length === 1 ? '' : 's'} · covers ${covered}/12 work types`),
      missing.length
        ? el('div', { class: 'missing' }, `⚠ ${missing.length} still to catch`)
        : el('div', { class: 'meta', style: 'color: var(--ok)' }, b.crew.length ? '✓ full crew owned' : 'empty')
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

  /* ---- crew panel (left) ---- */
  function refresh() { left.innerHTML = ''; right.innerHTML = ''; buildLeft(); buildRight(); }

  function addPal(name) {
    if (!base.crew.includes(name)) { base.crew.push(name); persist(); refresh(); }
  }

  function buildLeft() {
    const crewPanel = el('div', { class: 'panel' });
    crewPanel.append(el('h3', {}, `Crew (${base.crew.length})`));

    // pal picker
    const input = el('input', { type: 'search', placeholder: 'Add a pal — type name or #paldex…', autocomplete: 'off' });
    const drop = el('div', { class: 'picker-drop', hidden: '' });
    const wrap = el('div', { class: 'picker-wrap' }, input, drop);
    function updateDrop() {
      const q = input.value.trim().toLowerCase();
      drop.innerHTML = '';
      if (!q) { drop.hidden = true; return; }
      const matches = PALS.filter(p =>
        !base.crew.includes(p.name) &&
        (p.name.toLowerCase().includes(q) || (p.paldex && ('#' + p.paldex.toLowerCase()).includes(q)))
      ).slice(0, 9);
      if (!matches.length) { drop.hidden = true; return; }
      for (const p of matches) {
        drop.append(el('div', {
          class: 'pick-row',
          onmousedown: e => { e.preventDefault(); input.value = ''; drop.hidden = true; addPal(p.name); }
        },
          palIcon(p, 'pal-icon'),
          el('span', { class: 'pal-id' }, dexLabel(p)),
          el('b', {}, p.name),
          roster.has(p.name)
            ? el('span', { class: 'status have' }, 'owned')
            : el('span', { class: 'status need' }, 'not owned'),
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
    for (const name of base.crew) {
      const p = byName.get(name);
      if (!p) continue;
      const owned = roster.has(name);
      list.append(el('div', { class: 'crew-row ' + (owned ? 'have' : 'need') },
        palIcon(p),
        el('b', {}, p.name),
        isNight(p) ? el('span', { class: 'night', title: 'Works through the night' }, '🌙') : null,
        el('span', { class: 'status ' + (owned ? 'have' : 'need') }, owned ? 'owned' : 'to catch'),
        el('span', { class: 'work-chips' }, sortedWorks(p).map(([w, l]) => workChip(w, l))),
        el('button', { class: 'rm', title: 'Remove from crew', onclick: () => { base.crew = base.crew.filter(n => n !== name); persist(); refresh(); } }, '✕')
      ));
    }
    crewPanel.append(list);

    if (base.crew.length > CREW_SOFT_CAP) {
      crewPanel.append(el('div', { class: 'crew-cap' },
        `⚠ ${base.crew.length} pals — check your in-game base worker cap before planning this many.`));
    }

    // autofill from roster
    crewPanel.append(el('div', { style: 'margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;' },
      el('button', { class: 'btn', onclick: () => { autofill(base); refresh(); } }, 'Auto-fill gaps from my roster'),
      el('button', { class: 'ghost', onclick: () => { base.crew = []; persist(); refresh(); } }, 'Clear crew')
    ));
    crewPanel.append(el('div', { class: 'tips' },
      'Auto-fill greedily adds your best owned pals until every work type this crew can improve is covered.'));

    left.append(crewPanel);
  }

  /* ---- coverage + needed (right) ---- */
  function buildRight() {
    const cov = coverage(base.crew);

    const covPanel = el('div', { class: 'panel' });
    covPanel.append(el('h3', {}, 'Work coverage ', el('span', { class: 'hint' }, '— click a tile for the best pals for that job')));
    const grid = el('div', { class: 'cov-grid' });
    for (const w of WORKS) {
      const { level, by } = cov[w];
      const provider = by ? byName.get(by) : null;
      const providerOwned = by ? roster.has(by) : true;
      grid.append(el('div', { class: 'cov-tile' + (level ? '' : ' zero'), onclick: () => openWorkModal(w, base, refresh) },
        el('div', { class: 'w-name' }, w),
        el('div', { class: `w-lv lv${level}` }, level ? el('b', {}, String(level)) : '—'),
        el('div', { class: 'w-by' + (providerOwned ? '' : ' need') },
          by ? (providerOwned ? by : `${by} (to catch)`) : 'uncovered')
      ));
    }
    covPanel.append(grid);

    const needed = base.crew.filter(n => !roster.has(n));
    const needPanel = el('div', { class: 'panel', style: 'margin-top:14px;' });
    needPanel.append(el('h3', {}, `Catch list (${needed.length})`));
    if (!needed.length) {
      needPanel.append(el('div', { class: 'tips' }, base.crew.length
        ? '✓ You own everyone in this crew — this base is ready to build.'
        : 'Add pals to the crew to see what you still need to catch.'));
    } else {
      const list = el('div', { class: 'needed-list' });
      for (const name of needed) {
        const p = byName.get(name);
        list.append(el('div', { class: 'crew-row need' },
          palIcon(p),
          el('b', {},
            el('a', { href: 'https://paldb.cc/en/' + p.slug, target: '_blank', rel: 'noopener', title: 'Open on paldb.cc (habitat, breeding combos)' }, p.name)),
          el('span', { class: 'work-chips' }, sortedWorks(p).slice(0, 3).map(([w, l]) => workChip(w, l))),
          el('button', {
            class: 'add-btn', title: 'Mark as caught — adds to your roster',
            onclick: () => { roster.add(name); persist(); renderHeaderStats(); refresh(); }
          }, 'Caught it!')
        ));
      }
      needPanel.append(list);
      needPanel.append(el('div', { class: 'tips' }, 'Pal names link to paldb.cc for spawn locations and breeding combos.'));
    }

    right.append(covPanel, needPanel);
  }

  refresh();
}

/* greedy: add owned pals that raise this crew's coverage the most */
function autofill(base) {
  while (base.crew.length < CREW_SOFT_CAP) {
    const cov = coverage(base.crew);
    let best = null, bestGain = 0;
    for (const p of PALS) {
      if (!roster.has(p.name) || base.crew.includes(p.name)) continue;
      let gain = 0;
      for (const w of WORKS) gain += Math.max(0, (p.works[w] || 0) - cov[w].level);
      if (gain > bestGain) { best = p; bestGain = gain; }
    }
    if (!best) break;
    base.crew.push(best.name);
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
      .filter(p => (p.works[work] || 0) > 0 && (!ownedOnly || roster.has(p.name)))
      .sort((a, b) => (b.works[work] - a.works[work]) || (totalLevels(b) - totalLevels(a)))
      .slice(0, 25);
    if (!candidates.length) {
      listWrap.append(el('div', { class: 'empty-note' }, `You don't own any pal with ${work} yet.`));
      return;
    }
    for (const p of candidates) {
      const inCrew = base.crew.includes(p.name);
      listWrap.append(el('div', { class: 'pal-row' + (roster.has(p.name) ? ' owned' : '') },
        palIcon(p),
        el('span', { class: 'pal-id' }, dexLabel(p)),
        el('span', { class: 'pal-name' }, p.name),
        isNight(p) ? el('span', { class: 'night', title: 'Works through the night' }, '🌙') : null,
        el('span', { class: `wchip lv${p.works[work]}` }, `${work} `, el('b', {}, String(p.works[work]))),
        roster.has(p.name)
          ? el('span', { class: 'status have' }, 'owned')
          : el('span', { class: 'status need' }, 'not owned'),
        el('span', { class: 'spacer', style: 'flex:1' }),
        el('button', {
          class: 'add-btn', ...(inCrew ? { disabled: '' } : {}),
          onclick: e => { base.crew.push(p.name); persist(); onChange(); e.target.disabled = true; e.target.textContent = 'In crew'; }
        }, inCrew ? 'In crew' : '+ Add')
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

/* export / import */
$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), roster: [...roster], bases }, null, 2)],
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
    if (!Array.isArray(data.roster) || !Array.isArray(data.bases)) throw new Error('bad shape');
    if (!confirm(`Import ${data.roster.length} owned pals and ${data.bases.length} bases? This replaces your current data.`)) return;
    roster = new Set(data.roster.filter(n => byName.has(n)));
    bases = data.bases.filter(b => b && b.id && Array.isArray(b.crew))
      .map(b => ({ id: String(b.id), name: String(b.name || 'Base'), crew: b.crew.filter(n => byName.has(n)) }));
    ui.baseId = null;
    persist(); render();
  } catch {
    alert('Could not read that file — expected a backup exported from this planner.');
  }
});

render();
