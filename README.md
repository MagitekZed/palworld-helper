# Palworld Base Planner

A little planning tool for [Palworld](https://www.pocketpair.jp/palworld) v1.0 bases: track which pals you own, design base crews, see combined work-suitability coverage, and get a catch list for the pals you're missing.

**Live app:** https://magitekzed.github.io/palworld-helper/

## Features

- Full v1.0 paldex (299 pals) with the rebalanced 1–10 work suitability scale
- Roster tracker — count how many copies of each pal you own
- Base builder — per-base worker cap, duplicate crew members, and stacked work
  coverage (every worker's level per job, not just the best)
- Cross-base allocation — a copy assigned to one base isn't available to others
  (copies are claimed in base list order)
- Catch list with per-pal shortfalls and paldb.cc links (spawns, breeding combos)
- "Auto-fill from my roster" — best base you can build from your free copies,
  with diminishing returns for stacking the same job
- Everything saves to localStorage; Export/Import for JSON backups

No build step, no dependencies — plain HTML/CSS/JS. Open `index.html` from any static server (or double-click it).

## Data

Work suitability for all pals lives in [`data/`](data/) (JSON + CSV) and is embedded in the app as `data.js`. Values are the v1.0 rebalanced base levels, sourced from [paldb.cc](https://paldb.cc/en/Pals) (2026-07-13). See [`data/README.md`](data/README.md) for details and caveats.

Fan-made tool; not affiliated with Pocketpair. Pal data and icons belong to their respective owners.
