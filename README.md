# Palpedia Tracker and Base Planner

A free fan-made companion tool for [Palworld](https://www.pocketpair.jp/palworld) v1.0:
track your paldex progress across all 299 pals, then design self-sufficient base crews
with purpose-driven auto-fill and see exactly which pals you still need to catch.

**Live app:** https://magitekzed.github.io/palworld-helper/

No build step, no dependencies, no accounts — plain HTML/CSS/JS. Everything saves to
your browser's localStorage, with JSON Export/Import for backups.

## Palpedia tracker

- **Full v1.0 paldex** — 299 pals (288 numbered + Terraria-collab pals) with the
  rebalanced 1–10 work suitability scale
- **Copy counts** — a +/− stepper per pal tracks how many of each you own
- **5-catch paldex bonus** — v1.0 grants a bonus at 5 catches of a species. A ★5 badge
  auto-earns when a pal's copies reach 5 and *stays* earned when copies drop
  (condensing spends copies, not the bonus); n/5 progress shows on every other row,
  clickable to mark pals you completed before using the tool
- **Combat tiers** — our own S–F grade per pal derived from HP/Attack/Defense
  (see [How the derived numbers work](#how-the-derived-numbers-work)), shown as a
  badge with percentile mini-bars; exact stats in the tooltip
- **Food stat** — 🍖 chips show each pal's appetite (higher = eats more)
- **Search, filters, sorts** — name/#paldex search; filters for element, work
  suitability (multi-select, AND logic), combat tier, 5-catch status, owned-only;
  sorts by paldex, name, total/best work levels, combat tier, or 5-catch progress
- **Quick-add** — send any pal straight to a base from its roster row; pal names link
  to paldb.cc for spawn maps and breeding combos
- 🌙 marks Dark-type pals, which work through the night

## Base planner

- **Multiple bases** with per-base worker caps and duplicate crew members
- **Purpose presets** — each base has a purpose: Balanced, Mining, Logging, Ranch,
  Crops, or Crafting & power. Auto-fill staffs open slots proportionally to the
  purpose's recipe (a mining base gets ~60% miners, plus haulers and fire pals for
  on-site smelting), interleaved so a thin roster still yields a working miniature
- **Self-sufficient mode** — optionally staff a raw-food farm first (planting /
  watering / gathering scaled by work *levels*, so elite pals need fewer bodies),
  plus haulers, handiwork, and a medic — a satellite base that needs no supply runs.
  Untick it for focus-only outposts you feed from elsewhere
- **Stacked work coverage** — every worker's level per job (not just the best), with
  the purpose's jobs highlighted; click a tile for the best candidates for that job
- **Ranch produce** — the Farming tile lists what your ranch pals actually drop;
  auto-fill picks ranch pals for produce variety
- **Crew food total** — 🍖 sum on base cards and the crew panel, so you can compare
  how expensive bases are to feed
- **Cross-base allocation** — a copy assigned to one base is never double-counted as
  available to another (bases claim copies in list order)
- **Catch list** — per-base shortfalls with a "Caught one!" button that updates your
  roster in place

## How the derived numbers work

These numbers are computed by this project, not copied from a wiki — treat them as
good defaults, not gospel.

- **Combat tier (S/A/B/C/F):** for each pal we compute rank-percentiles of its base
  HP, Attack, and Defense across all 299 pals, average the three equally, and bucket
  the composite into a pyramid — S = top 10%, A = next 20%, B = middle 40%,
  C = next 20%, F = bottom 10%. Raw stats only: element typing, partner skills, and
  mount abilities are deliberately excluded, so a great utility pal can grade below a
  raw stat monster.
- **Self-sufficiency farm sizing:** targets ~0.75 × cap total work levels each of
  Planting/Watering/Gathering. Derived from paldb's plantation internals (4,500
  workload per phase, 10 berries per cycle) and community feeding measurements
  (~one plantation crew per 8 pals on cooked food), scaled ×1.5 for raw-only feeding
  (no manual cooking steps). Work speed roughly doubles per suitability level, which
  is why targets are in levels, not headcount. Mostly pre-1.0 measurements — tune
  the constants in `app.js` (`BASICS_*`, `PRESETS`) if your pals starve.
- **5-catch bonus** is a sticky flag: owning 5+ copies proves it; below that it's
  manually toggleable, because the roster tracks copies you *have*, not total caught.

## Data

All game data lives in [`data/`](data/) (JSON + CSV) and is embedded in the app as
`data.js`:

- Work suitability for all 299 pals (v1.0 rebalanced levels, paldb.cc, 2026-07-13)
- HP / Attack / Defense / Food stats + our derived tier (paldb.cc, 2026-07-16)
- Ranch produce for the 29 Farming pals

See [`data/README.md`](data/README.md) for scrape details, caveats, and cross-checks.
Pal and item icons are self-hosted in [`icons/`](icons/) (originally obtained via
paldb.cc's mirrors of the game assets) so the app puts no load on paldb.cc.

## Running locally

Serve the folder from any static server (or just open `index.html`):

```
python -m http.server 8123
```

## Legal

This is a **free, non-commercial fan tool**. It is not affiliated with, endorsed by,
or sponsored by Pocketpair, Inc. or paldb.cc. All Palworld game data, names, and art
are © Pocketpair, Inc. Game data was compiled via the fan-run
[paldb.cc](https://paldb.cc/en/) database. Shared in the spirit of Pocketpair's
[derivative works guidelines](https://www.pocketpair.jp/en/guidelines-derivativework-en/);
if you're a rights holder and want anything changed or removed, open an issue.
