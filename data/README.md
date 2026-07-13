# Palworld 1.0 — Work Suitability Dataset

Work suitability for every pal in **Palworld v1.0** (released 2026-07-10).

## Files

- `pals_work_suitability.json` — full structured data: paldex number, name, internal codename, elements, work suitabilities with levels.
- `pals_work_suitability.csv` — same data as a matrix (one column per work type), Excel-friendly.

## Coverage

299 entries total:

- 288 numbered paldex entries (#1–#204 including 84 regional/elemental variants like `121B Jormuntide Ignis`)
- 11 unnumbered Terraria-collab pals (Eye of Cthulhu, slimes, bats — all low work levels)

News coverage cites "287 obtainable pals" for 1.0; paldb's data-mined list has 288 numbered entries. The one-off is likely a counting difference around a variant/boss pal, and doesn't affect base planning.

## Important 1.0 changes (from official patch notes)

- **Work suitability was expanded to 10 levels and ALL pals were rebalanced.** Pre-1.0 guides showing the old Lv. 1–4 scale are obsolete (e.g. Anubis went Handiwork 4 → 6, Jormuntide Ignis Kindling 4 → 7).
- Highest **base** value in the 1.0 data is **Lv. 8** (10 pals have one).
- **Each pal rank-up (Pal Essence Condenser) now raises one work suitability level by +1**, which is how you push past base values toward 10.
- The 12 work types are unchanged: Kindling, Watering, Planting, Generating Electricity, Handiwork, Gathering, Lumbering, Mining, Medicine Production, Cooling, Transporting, Farming.

## Sources

- Primary: [paldb.cc/en/Pals](https://paldb.cc/en/Pals) (data-mined from game files, retrieved 2026-07-13) — parsed from each card's `data-filters` attribute.
- Cross-checked against: [1.0 patch notes](https://insider-gaming.com/palworld-1-0-adds-72-new-pals-world-improvements-story-overhaul-more-full-1-0-patch-notes/) (10-level rescale, rank-up mechanic) and [Phrasemaker's 1.0 pal list](https://thephrasemaker.com/2026/07/10/palworld-1-0-complete-pal-list-every-new-pal-elemental-type-and-work-suitability/) (new-pal values matched paldb on all 5 spot-checked pals).
- Not used: Game8's aggregate work suitability table and the Fandom/wiki.gg pages — still showing stale pre-1.0 values as of 2026-07-13.

## Not in this dataset

Work *speed* stats, food consumption, partner-skill work bonuses, and day/night behavior (Dark-type pals work through the night) — all of which also affect real base throughput.
