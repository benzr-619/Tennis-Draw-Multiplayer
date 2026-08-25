# Leaderboard Records/Slams Redesign — Shrinkage-Adjusted Slam Index

Read this before touching the Records tab or the Slams tab's per-slam cards. Design
finalized in a separate planning chat (Cowork, not this session), 2026-07-18. **Not
implemented yet** (see CLAUDE.md §13 "Not yet built"). This file is the brief for the
implementation session — read the whole thing, especially "Implementation Notes,"
before writing code.

## Why the old Records tab standings were rejected

The old Records tab (`buildAllTimeAgg`/`buildStandingsTable`/`buildPodium` in
`leaderboard-records.js`) ranked players by plain averages: `avgScore`,
`avgMatchYield`, `avgSlamIndex` across every draw they'd played, no adjustment for
sample size. A player with 1-2 great draws could sit above someone with 8+ solid
draws purely because a small sample doesn't regress toward the pool mean — hot
streaks and genuine long-term consistency were indistinguishable in the ranking.

Three fixes were considered and rejected before landing on shrinkage:

- **Minimum-draws gate** (e.g. must have played ≥3 draws to rank) — excludes new
  players entirely rather than fairly weighting their smaller sample. Punishes
  exactly the players most likely to be checking the leaderboard for the first time.
- **Cumulative totals instead of averages** — solves the small-sample-hot-streak
  problem but replaces it with a pure attendance metric: a mediocre player who's
  played every draw would outrank a genuinely better player who joined the pool
  late. Totals measure participation, not skill.
- **Olympic-style medal counts** (count golds/silvers/bronzes per slam) — introduces
  an entirely separate ranking mechanic and mental model just for the Records tab,
  duplicating effort for a "trophy room" feature that's meant to complement the
  Slams tab's live rankings, not compete with them. Rejected as complexity with no
  real payoff over a properly-adjusted average.

**Shrinkage estimator wins**: pulls a player's average toward the pool mean by an
amount inversely proportional to their sample size, so a 1-draw hot streak doesn't
outrank consistent players, but the correction fades out naturally as more draws
accumulate — no hard cutoff, no separate mechanic, still just an average under the
hood.

## Why Slam Index is the headline, not Draw Yield / Match Yield co-equally

Post scoring-redesign (`.claude/rules/scoring-redesign.md`), Draw Yield and Match
Yield are no longer two overlapping approximations of "skill" — they measure
genuinely different things:

- **Draw Yield** — pure round-doubling coverage, no upset bonus. Zero forgiveness:
  once an original pick busts, that bracket segment is dead for good.
- **Match Yield** — flat $10 stake every match, full forgiveness via backup picks
  every round regardless of how the original bracket held up.

Because they're deliberately measuring different skills, the existing 50/50 blend
into Slam Index (`calcSlamIndex` in `scoring.js`) is a principled combination, not an
arbitrary tuning knob — and Slam Index is already the hero stat everywhere else in
the app (stats bar hero, Slams tab default sort, podium stat). Records making it the
headline standings metric (instead of a three-way tie with Draw Yield/Match Yield
averages) keeps the app consistent about which number is "the" score. Draw Yield and
Match Yield still appear on Records, but as **personal-best** tables (see below), not
as a second/third averaged standings ranking.

## Records Tab Structure (new)

**1. Slam Index podium + standings table (top of tab, replaces the old averaged
podium/standings entirely).**

Ranked by a shrinkage-adjusted average, not the raw `avgSlamIndex`:

```
shown_index = (n / (n + K)) × player_avg + (K / (n + K)) × 100
```

- `player_avg` = the player's existing `avgSlamIndex` (unchanged aggregation, still
  built from `buildAllTimeAgg`)
- `n` = `drawsPlayed`, already computed in `buildAllTimeAgg` — no new query
- `K` = shrinkage constant, **starting value 5** (tunable — see "Sanity-check K=5" in
  Implementation Notes before locking it in)
- `100` = pool baseline (Slam Index's own defined baseline — see
  `.claude/rules/scoring-redesign.md` / CLAUDE.md §9, `calcSlamIndex` guards)

Every name in the standings table and podium shows **n** alongside the adjusted
index (e.g. "118 · 6 draws") so the adjustment is legible, not hidden. **No
participation gate** — every player with ≥1 pool-eligible draw is ranked; small-n
players are naturally pulled toward 100 rather than excluded.

**Separately, a "Best Slam Index Ever" record** — the single best unadjusted
per-draw Slam Index across the whole pool (not shrinkage-adjusted; it's a record for
a single moment, not a standings ranking). Analogous to the existing `bestUpset` /
`buildPoolBestUpset` single-best-instance pattern already used for the Biggest Upset
Call chip.

**2. Draw Yield and Match Yield Top 10 tables**, below the Slam Index section.
**Superseded 2026-07-18** (Ben's follow-up, same day) — see "Follow-Up Simplification
(2026-07-18)" below for what actually shipped. Originally spec'd as one row per
player (their personal-best draw) with a raw/vs.-chalk toggle; shipped instead as
pool-wide Top 10 tables with no toggle at all.

**3. Badge row (Sharpest Bettor ROI, Biggest Upset Call).** **Superseded
2026-07-18** — see "Follow-Up Simplification" below. Dropped from Records entirely;
Sharpest Bettor (renamed "Best Match Pick Value") moved to the Slams tab as an
all-time career stat, Biggest Upset Call dropped outright.

## Slams Tab — Combined M/W Card (click-to-reveal, not always-on)

Add a **Combined** card next to the existing MS/WS summary cards on the Slams tab,
but gated behind a click-to-reveal toggle — not rendered by default alongside MS/WS.
Rationale: MS/WS are separate draws with separate pick pools; a combined view is
useful context but shouldn't visually compete with the per-draw cards a player checks
most often.

- **Eligibility:** only players `poolEligible` (`.claude/rules/leaderboard-detail.md`
  minimum-participation gate) in **both** MS and WS for that slam. A player who
  entered only one draw doesn't get a combined row — there's nothing coherent to
  combine.
- **Computation:** sum Draw Yield and Match Yield across both draws, then recompute
  Slam Index via the existing `calcSlamIndex(entries)` fed the **combined** per-player
  totals (not a re-average of the two per-draw indices — combined index is
  z-scored fresh against the combined-totals population, same function, different
  input population).
- **Scope:** Slams-tab-only. This explicitly does **not** become a 4th Records
  category — Records' headline stays the single shrinkage-adjusted Slam Index
  standings described above, not split further by MS/WS/Combined.

## Follow-Up Simplification (2026-07-18, same day as initial implementation)

Ben reviewed the shipped v1 of this redesign and asked for three changes:

**1. Drop the raw/vs.-chalk toggle entirely — it's not an interesting stat.**
Rationale (Ben's words): it was "just revealing how well chalk does at filling out
a draw, since everyone is negative on it." A pure-favourite bracket/bettor losing to
the market's own margin isn't surprising and isn't something a player benefits from
comparing themselves against every time they check the page. The chalk-baseline
machinery (`calcEloChalkDrawYield`, `calcOddsChalkMatchYield`,
`buildChalkBaselines`, the per-player "personal-best" selection re-run per mode) was
removed from `scoring.js` and `leaderboard-records-data.js` — this was same-day dead
code, not a deprecation.

**2. Drop the 3-badge honors row from the middle of the page.** Confirmed via a
follow-up question that "Best Slam Index Ever" (a record, not a badge) stays — only
Highest Single Draw Yield, Best Match Pick Value, and Biggest Upset go. Highest
Single Draw Yield was redundant anyway (its #1 entry is exactly the new Top 10 Draw
Yield table's #1 row). Biggest Upset Call was dropped outright — not moved
anywhere. Best Match Pick Value (renamed "Best Match Pick Value" / ROI) moved to the
Slams tab (see #3).

**3. Personal-best tables became pool-wide Top 10 tables.** Instead of one row per
player (their single best draw — `buildPersonalBests`, since replaced by
`topByKey`), both the Draw Yield and Match Yield tables now show the top 10
*single-draw performances across the whole pool*, deliberately not deduped per
player — the same player can occupy multiple rows if they've had several standout
draws. `topByKey(brackets, key, n=10)` in `leaderboard-records-data.js` slices
`buildAllBrackets`'s existing flat player×draw list — no new aggregation needed.

**"Best Slam Index Ever" made clickable.** Instead of a single static record line,
it now shows the #1 entry inline and opens a top-10 list modal on click
(`openListModal`), mirroring the honor-chip click pattern used elsewhere. Built from
the same `topByKey(brackets, 'slamIndex', 10)` call as the other two Top 10 tables
— all three "top 10" datasets come from one shared helper.

**Best Match Pick Value → Slams tab, as an all-time career stat.** New module
`src/leaderboard-roi-chip.js` — `buildAllTimeRoiChip(profs, lockedDraws, allMaps)`,
same flat-stake-ROI logic as before (unchanged: each resolved matchPick with locked
odds = a $1 bet, normalising out round stakes), but now scoped to *every locked draw
the player has ever played*, not one Records page. Rendered once at the top of the
Slams tab (`renderSlamsTab` in `leaderboard-slams.js`), above the active slam
section — it's a career stat, not tied to any single slam. Reuses
`buildAllTimeAgg` from `leaderboard-records-data.js` (unchanged) for the flatROI
aggregation; reuses `openListModal` from `leaderboard-slams.js` (circular import,
fine — function calls only, same pattern used elsewhere in this codebase).

**Corrected same day: moved again, from the Slams tab to the Your Draws tab, and
changed from a pool-wide chip to a personal one.** Ben clarified the Slams-tab
placement above was never what he'd asked for — he wanted a *personal* ROI stat,
not a pool-leaderboard chip (best player + click-to-see-everyone) sitting at the
top of a tab about live slam standings. Fix: `leaderboard-roi-chip.js` was rewritten
from `buildAllTimeRoiChip(profs, ...)` (pool-wide, ranks every player, opens
`openListModal`) to `buildPersonalRoiBadge(user, draws, statsMaps)` — takes a single
user, no ranking, no modal, just that player's own `flatROI`/`totalFlatBets` from
`buildAllTimeAgg([user], ...)`. Wired into `leaderboard-yourdraws.js` instead:
`_renderTable()` (the tab's existing sort/rebuild function, called both on initial
load and on every column-sort click) recomputes the badge each time from the
already-loaded `_meta`/`_stats` module state — cheap, no extra network calls — and
prepends it to the container before the sortable table. All Slams-tab wiring
(`buildAllTimeRoiChip` import, the `lockedDraws` computation, the
`container.appendChild(...)` call in `renderSlamsTab`) was removed; `leaderboard-
slams.js` no longer references this feature at all.

## Implementation Notes

**Copy review required before wiring anything live** (same discipline as the
tutorial feature, `.claude/rules/tutorial.md` "Copy Review Requirement") — done,
approved 2026-07-18. **Correction from the original brief:** this hint text does
**not** live in the shared `#stats-drawer` (`.claude/rules/ui-detail.md`) — that
drawer is scoped to the *current slam's* Slam Index and other per-draw stats. The
Records tab's shrinkage explainer is a separate, Records-tab-local hint (its own
small ⓘ/expandable affordance near the Index column/podium, not a shared component)
since it explains an all-time aggregate concept the per-slam drawer has no reason to
know about. Approved copy:

- **Label:** "Index (Adjusted)"
- **Definition:** "Your average Slam Index, pulled toward the pool baseline (100)
  when you've only played a few draws — so one hot streak doesn't outrank a longer
  track record. The pull fades out as you play more."
- **Math row:** "shown = (n / (n+5)) × your avg + (5 / (n+5)) × 100, where n = draws
  played."

**K=5 sanity-checked against real data — approved 2026-07-18. CORRECTION
(2026-08-25): the evidence base described below was never real — see
`.claude/rules/slam-index.md` for the corrected picture.** This passage
originally claimed the check ran "across all 12 pool-eligible players in the
pool's 4 completed draws (French Open 2026 + Wimbledon 2026, MS+WS)." That is
false. Verified directly against the database: French Open 2026 MS and WS have
picks from exactly one player (Vibes Architect) and zero locked-odds rows in
either draw, so neither draw can produce a Slam Index at all under the current
(or any) formula — there was no fourth-and-fifth-draw evidence to check against.
The real evidence base at the time was two draws and nine players
(Wimbledon 2026 MS+WS only). The specific numbers below (Sam Rosenberg n=1 avg
112, Vibes Architect n=4 avg 106.3, a 4-draw average) describe a dataset that
never existed and should not be trusted as a record of what was actually
checked — kept here only so the original (wrong) approval note isn't silently
deleted. Whatever comparison actually ran to approve K=5 either used only the
two real Wimbledon draws or was not run against real data at all; no reliable
record of which survives. K=5 is **not validated** by this passage — see
`.claude/rules/slam-index.md` for the current standing method
(`computeShrinkageK`) and its own single-slam estimate (~4.9, also not yet
enough data to trust).

**File-size ceiling.** Both `src/leaderboard-records.js` (440 lines) and
`src/leaderboard-slams.js` (444 lines) were already over the project's informal
~400-line ceiling before this redesign. Current module layout after both the
initial implementation and the same-day follow-up simplification:
- `src/leaderboard-records-data.js` — pure data/aggregation helpers:
  `buildAllTimeAgg` (all-time aggregates, still feeds the shrinkage standings and
  the Slams-tab ROI chip), `buildAllBrackets` (flat pool-wide player×draw list),
  `topByKey` (slices `buildAllBrackets`'s list to the top N by any stat — backs
  all three Top 10 datasets), `buildShrinkageStandings`. No DOM. 88 lines.
- `src/leaderboard-records.js` — render-only orchestrator: podium, standings
  table, Slam Index hint, the clickable Best Slam Index Ever card, the two Top
  10 tables. 370 lines. (The honors-row split module,
  `leaderboard-records-honors.js`, was deleted same-day — the honors row it held
  was dropped/relocated per the follow-up above, leaving nothing to split out.)
- `src/leaderboard-slams-combined.js` — the Combined M/W card's computation +
  DOM (`buildCombinedSection`/`buildCombinedCard`), called from
  `leaderboard-slams.js`'s `_renderFull`. `_combinedExpanded` (the
  click-to-reveal open/closed state) stays owned by `leaderboard-slams.js`
  (alongside its sibling `_expandedKeys`/`slamSort` module state) and is passed
  in — the combined module holds no state of its own. 87 lines.
- `src/leaderboard-roi-chip.js` — the all-time Best Match Pick Value chip
  (`buildAllTimeRoiChip`), added same-day per the follow-up above. 47 lines.

**Known residual:** `leaderboard-slams.js` is 469 lines (up slightly from 463 after
adding the ROI-chip wiring). The remaining bulk is the pre-existing per-draw
card/podium/chips/past-slam-compact logic, which this redesign didn't touch and
splitting further is a separate refactor outside this feature's scope.

`scoring.js` is 399 lines (net roughly flat vs. before this redesign — the
same-day chalk-baseline removal took back out what the initial implementation
had added).

**No new DB schema needed anywhere in this redesign** — `drawsPlayed`, `avgSlamIndex`,
per-draw Draw Yield/Match Yield, `poolEligible`, `eloFavourite`, and odds-favourite
comparisons are all already computed by existing code
(`loadDrawStatsForAllUsers`/`buildAllTimeAgg`/`scoring.js`). This is a pure
presentation-and-aggregation-logic change.

## Podium-plus-top-10 simplification (2026-08-25)

Once Slam Index became cross-slam comparable (v2, `.claude/rules/slam-index.md`),
Ben questioned whether the full shrinkage-adjusted standings table was
overcomplicating the page — it exists to answer "who's the best player over
their whole career," which needs the shrinkage/K/anchor machinery; but most of
the rest of the Records tab (the Draw Yield/Match Yield Top 10s) just answers
the much simpler "what was the best single performance ever," no statistics
required.

**Resolution: keep both questions, stop answering the first one twice.** The
podium (top 3 by shrinkage-adjusted career average — still fully backed by
`buildShrinkageStandings`/`computeShrinkageK`, none of that work was wasted)
stays exactly as it was. What's gone:

- **The full standings table** (`buildStandingsTable`, every pool-eligible
  player ranked by shrinkage-adjusted average) — replaced by a **Top 10 Slam
  Index table**, built with the exact same `buildTopTenTable` helper the Draw
  Yield/Match Yield tables already use (`topByKey(brackets, 'slamIndex', 10)`
  — raw single-draw performances, not shrinkage-adjusted, same as the other
  two Top 10 tables). Sits directly under the podium, full width (not inside
  the `.rec-pb-grid` two-column layout the Draw Yield/Match Yield tables use).
- **The "Best Slam Index Ever" click-to-expand card** (`buildBestEverCard`) —
  now fully redundant with the Top 10 Slam Index table above, which shows the
  same top-10 data permanently visible instead of behind a click. Deleted
  outright, along with its now-unused `openListModal` import.

Page now reads: podium (who's genuinely best over time) → three parallel,
un-adjusted Top 10 tables (best single moments, one per stat) — matching the
"pinball high score machine" framing Ben proposed. The podium and the Slam
Index Top 10 table will often disagree on who's #1 (career consistency vs.
peak performance are different questions) — that's intended, not a bug, but
worth knowing if the two panels look like they contradict each other.

**Dead CSS removed alongside the JS**: `.rec-standings-wrap`, `.lb-row-standings`
(both the desktop rule and its two now-orphaned mobile overrides),
`.lb-cell-srank`, `.lb-cell-draws`, `.rec-best-ever-card`. `.lb-cell-slamIndex`
and `.rec-you-badge` were kept — still used elsewhere (the Slams-tab Combined
M/W card, the detail table). `src/leaderboard-records.js`: 370 → 302 lines.
`src/leaderboard-records-data.js` (K-estimation machinery from the prior
session) unchanged by this pass, still 209 lines.
