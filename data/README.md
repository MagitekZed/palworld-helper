# Palworld 1.0 — Work Suitability Dataset

Work suitability for every pal in **Palworld v1.0** (released 2026-07-10).

## Files

- `pals_work_suitability.json` — full structured data: paldex number, name, internal codename, elements, work suitabilities with levels.
- `pals_work_suitability.csv` — same data as a matrix (one column per work type), Excel-friendly.
- `pals_combat_stats.json` / `.csv` — raw HP / Attack / Defense / Food for all 298 pals plus our derived combat tier (see below).

## Coverage

298 entries total:

- 287 numbered paldex entries (#1–#204 including 84 regional/elemental variants like `121B Jormuntide Ignis`)
- 11 unnumbered Terraria-collab pals (Eye of Cthulhu, slimes, bats — all low work levels)

**Excluded: Astralym (#204).** paldb's data-mined list has 288 numbered entries, but
Astralym is the final story boss at the Sealed Sanctum — you fight it, you can't catch
or breed it. Its paldb entry is a placeholder (no elements, no work suitabilities,
partner skill "-", stats a flat 200/200/200), and those placeholder stats sat at the
100th percentile of every stat, skewing the derived tier list. Dropping it also
resolves the count discrepancy noted here previously: 287 numbered entries now matches
the "287 obtainable pals" figure in 1.0 news coverage exactly.

## Important 1.0 changes (from official patch notes)

- **Work suitability was expanded to 10 levels and ALL pals were rebalanced.** Pre-1.0 guides showing the old Lv. 1–4 scale are obsolete (e.g. Anubis went Handiwork 4 → 6, Jormuntide Ignis Kindling 4 → 7).
- Highest **base** value in the 1.0 data is **Lv. 8** (10 pals have one).
- **Each pal rank-up (Pal Essence Condenser) now raises one work suitability level by +1**, which is how you push past base values toward 10.
- The 12 work types are unchanged: Kindling, Watering, Planting, Generating Electricity, Handiwork, Gathering, Lumbering, Mining, Medicine Production, Cooling, Transporting, Farming.

## Ranch produce

Pals with the Farming suitability carry a `ranch` field in the JSON listing the
items they produce when assigned to a Ranch (name, icon URL, paldb slug), e.g.
Lamball → Wool, Mau → Gold Coin, Vixy → spheres/arrows/bones. Scraped from each
pal's paldb.cc page (the per-partner-skill-level produce table, deduplicated
across levels; Mau's comes from its partner-skill text). Retrieved 2026-07-13.

## Combat stats & tiers

`pals_combat_stats.*` carry each pal's **Health, Attack, and Defense** (base values,
before IVs / condenser / passives), scraped from each pal's paldb.cc page
(retrieved 2026-07-16). "Attack" is paldb's ranged/shot attack value (equals melee
for most pals). Astralym's page omits its Health bar; its raw values (200/200/200)
were read directly.

The **combat tier** (S / A / B / C / F) is *our own* objective grade, not a
community list. For each stat we compute a rank-percentile across all 298 pals,
average the three (equal weight), then bucket the composite into a pyramid:
**S = top 10%, A = next 20%, B = middle 40%, C = next 20%, F = bottom 10%**
(31 / 58 / 120 / 60 / 29 pals — bucket sizes land near those shares rather than
exactly on them, because pals tied on the composite score can't be split). It reflects raw stats only — element typing,
partner skills, and mount abilities are deliberately excluded, so a great
utility/work pal (e.g. Anubis) can grade below a raw stat monster.

## Partner skills

`pals_partner_skills.json` carries every pal's partner skill name and full
description (paldb.cc/en/Partner_Skill, retrieved 2026-07-26), plus `tags`
derived from the description's trigger phrases: `base` ("While at a/the/your base"),
`ranch` ("when assigned to Ranch"), `party` (any "in (your) party" / "fighting
together"), `active` ("When activated"), `mount` ("Can be ridden" / "While
mounted/flying"), and `passive` (no trigger clause). A skill can carry several
tags — most mounts also have a party effect. Counts: party 180, mount 121,
active 57, ranch 29, base 21, passive 1 (Astralym, whose skill paldb lists as
still unknown). Phrasing varies more than you'd expect — Sekhmet says "While at
base" without the article, and several pals express party conditions as "for
each X in party" — so the patterns are deliberately loose. Descriptions keep paldb's level-scaling ranges like
"(15~30)%".

## Sources

- Primary: [paldb.cc/en/Pals](https://paldb.cc/en/Pals) (data-mined from game files, retrieved 2026-07-13) — parsed from each card's `data-filters` attribute.
- Cross-checked against: [1.0 patch notes](https://insider-gaming.com/palworld-1-0-adds-72-new-pals-world-improvements-story-overhaul-more-full-1-0-patch-notes/) (10-level rescale, rank-up mechanic) and [Phrasemaker's 1.0 pal list](https://thephrasemaker.com/2026/07/10/palworld-1-0-complete-pal-list-every-new-pal-elemental-type-and-work-suitability/) (new-pal values matched paldb on all 5 spot-checked pals).
- Not used: Game8's aggregate work suitability table and the Fandom/wiki.gg pages — still showing stale pre-1.0 values as of 2026-07-13.

## Food (appetite)

Each pal also carries its **Food** stat (paldb.cc, retrieved 2026-07-16): a relative
measure of how fast its hunger drains — higher = eats more. Range across all pals is
100–730. The planner sums a crew's Food (× copies) on base cards and the base editor
so you can compare how expensive crews are to feed.

## Not in this dataset

Work *speed* stats, partner-skill work bonuses, and day/night behavior (Dark-type
pals work through the night) — all of which also affect real base throughput.
