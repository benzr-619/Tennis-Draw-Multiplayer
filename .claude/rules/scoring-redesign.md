# Scoring System Redesign — Post-Wimbledon 2026 Review

Read this before touching Draw Yield, Match Yield, Slam Index, or Draw Health. This
review happened in a planning-only Cowork chat (2026-07-16) after Wimbledon 2026 —
the pool's first real live tournament (previous slam, French Open 2026, only ever had
1 player's picks in it and isn't usable as a reference point). **No code has been
changed yet.** This file is the brief for the implementation chat — read the whole
thing before starting, especially "Outstanding Questions" and "Implementation Scope."

## Why this review happened

Ben wanted to evaluate whether Draw Yield / Match Yield / Slam Index / Draw Health
are actually a good scoring design — not just tune numbers to fit one tournament's
results. Multiple rounds of "just adjust the weight" got explicitly rejected in
favor of finding a design that's honestly explainable in plain language first, then
deriving numbers from that, rather than reverse-engineering a story from whatever
weight happens to produce a comfortable leaderboard.

## Agreed criteria (established before any data was pulled)

Skill separation (Draw Yield should reflect real bracket skill, not luck), round
balance (no single pick, especially the champion, should dominate), anti-chalk
(playing it safe shouldn't beat genuine risk-taking), intuitiveness/"feel right"
(the pool should broadly agree a better draw scored better), Slam Index weighting,
and auto-assign fairness (missed-pick fallback shouldn't reward non-participation).

## Data available

Wimbledon 2026, both draws, fully decided (127/127 matches each): 12 pool-eligible
players in MS (n_orig >= 64 filter — Zach K excluded, only 18 picks), 9 in WS. Small
sample — every finding below is from a single tournament and should be treated as a
starting hypothesis, not proof.

## THE FINAL PLAN (decided 2026-07-16)

### 1. Draw Yield — strict doubling points, no upset bonus

Base points become **1-2-4-8-16-32-64** by round (replacing the current
round(1.78^ri) scale of 1-2-3-6-10-18-32), and the seed-based upset bonus is
**removed entirely**. Draw Yield becomes pure bracket-coverage scoring: did your
original pick correctly occupy this slot, yes/no, worth a fixed amount by round.

Rationale: the doubling scale makes every round contribute an *exactly equal*
aggregate 64 points to the pool (64 matches x 1 = 32 x 2 = ... = 1 x 64, total 448)
— "every round of the bracket counts equally," a clean, one-sentence-explainable
property the old front-loaded scale didn't have. Removing the upset bonus makes
Draw Yield nearly mathematically identical to Draw Health (verified correlation
jumps from ~0.80 to ~0.97-0.99 once the bonus is stripped) — the Health/Yield
divergence problem some brackets showed (see Findings below) is resolved by
construction, not by tuning. All "reward for a bold correct call" moves to Match
Yield instead, which uses live betting odds — a better-calibrated difficulty signal
than static pre-tournament seeding (verified: TNNS seed-upsets were only 22/127 MS,
17/127 WS this tournament; ELO/market data predicted the draw better than seed did).

**Missed-pick fallback stays, scoped narrowly.** If a player is missing a small
number of original picks — e.g. a last-minute Lucky Loser swap they didn't get to
re-pick before lock — those specific matches should still auto-score on the **ELO**
favourite (mirrors the existing `isAutoAssign`/`eloFavourite` mechanism in
`src/scoring.js`, unchanged). This is explicitly NOT meant to let someone who never
really filled out a bracket get scored as if they had — the existing pool
eligibility gate (`POOL_ELIGIBILITY_THRESHOLD`, 50% of matches must have a real
`original_pick`, see `.claude/rules/leaderboard-detail.md`) is the mechanism that
draws that line and should continue to apply unchanged. Nothing new to build here
— just confirm the existing auto-assign + eligibility-gate combination still does
the right thing under the new point scale (it should, since it's scale-agnostic).

### 2. Match Yield — flat $10 stake on every match, no round escalation

Replaces the current round-escalating stake schedule (10-10-20-20-30-40-50) with a
flat $10 stake on every one of the 127 matches. Rationale: unlike Draw Yield's
rounds (which compound — reaching the Final requires having correctly called six
rounds in a row), every Match Yield pick is independent and made when both players
are already known, so there's no structural reason a Final pick should be worth
more than a Round 1 pick. The old escalating schedule was defended as a "later
moments should feel bigger" drama choice rather than a skill claim, but a flat
stake is more honestly explainable ("every match, same amount on the line, the odds
decide the payout") and doesn't risk being misread as a second, redundant
difficulty signal now that the upset bonus has moved here from Draw Yield.

**Decided 2026-07-17:** a stale pick (original pick eliminated, never renewed with
a backup) now auto-scores on the odds favourite — identical treatment to a
genuinely blank pick. This corrects an earlier misreading of current behavior in
this doc (see Methodology Notes below): the actual v1 bug is not "guaranteed
loss," it's a **silent no-op** — the stale stored pick name never literally
matches either real occupant, so the odds lookup fails and the match is excluded
from Match Yield entirely (no win, no loss, not counted in the resolved-bets
denominator). v2 fixes this by falling through to the auto-favourite branch
whenever the stored pick name doesn't match either occupant, exactly as if no
pick had been made at all. v1 is unchanged (keeps the no-op quirk, byte-identical
to what's live today).

### 3. Slam Index — stays 50/50 Draw Yield / Match Yield

Confirmed final. Rationale, refined over this session: Draw Yield and Match Yield
now reward genuinely different things — Draw Yield is a pure draw-prediction
(coverage) score, Match Yield is an odds-based skill test — not two overlapping
approximations of the same skill, so an even split is the honest read rather than a
compromise. (This reverses earlier in-session leanings toward 60/40 or 75/25, which
were reasoning from an older framing where both stats measured overlapping
"skill.")

## Implementation Scope — REVERSED 2026-07-18: v2 applies retroactively too

**Superseded.** This section originally said the new formula would apply only to
future slams, with Wimbledon 2026 frozen on v1 forever — see "Implementation
History (superseded)" below for that original reasoning, kept for record. Ben
reversed this decision 2026-07-18 after asking for Wimbledon 2026's numbers to
actually be computed under v2 (not just estimated): **the #1 spot didn't change
in either draw** — Carson Bodnarek stays #1 MS (263.0 Draw Yield / +34 Match
Yield / 117 Slam Index under v2), Vibes Architect stays #1 WS (209.0 / +142 /
126) — so the specific risk that motivated freezing v1 (rewriting who "won" a
finished tournament) never actually materialized. With that risk off the table,
cross-slam comparability (every draw, past and future, scored the same way) won
out over preserving a frozen snapshot.

**What changed:** every existing draw — both Wimbledon 2026 draws (MS/WS) and
French Open 2026 (MS/WS) — had `draws.scoring_version` updated from `1` to `2`
via a direct `UPDATE` (data change only, no schema change; verified via Supabase
MCP `execute_sql`). Wimbledon 2026's displayed leaderboard numbers **did**
change as a result of this — that's intended, not a regression. Full verification
in "Verification (2026-07-18)" below.

**What did NOT change:** `draws.scoring_version` and the version-keyed config
(`SCORING_CONFIGS`/`getScoringConfig()` in `src/scoring.js`, and its twin in
`supabase/functions/recompute-health-bands/health-scoring.js`) stay fully intact
— both formulas' code paths still work, v1 included. This is now a pure rollback
lever: if there's ever pushback from the pool, un-doing this is a one-row
`scoring_version` update per draw, not a rebuild. v1's numeric output is
confirmed still byte-identical to what was live before any of this scoring work
started (`test-harness/` golden diff clean after the retroactive `UPDATE`, since
it's a data change with zero code-path change for v1).

**Health bands simplified.** With every draw now on the same formula, the
v1-frozen/v2-resimulated carve-out this doc previously described for Wimbledon's
`health_band_samples` no longer applies — there's no more split to reconcile.
`health_bands` and `health_band_samples` were wiped entirely and rebuilt from
scratch, uniformly, by walking every draw's real `scoring_version` (now `2` for
all four existing draws) through the same recompute path used for live
auto-confirm (`supabase/functions/recompute-health-bands`, called once per
`n` per draw via a Postgres loop through `extensions.http`, mirroring
`fetch_espn_scores()`'s existing call pattern) — equivalent in effect to
`initializeAllBands()` in `src/health-bands.js`, just run via the serverless
edge function instead of a browser session. Result: 24 total samples per `n`
across all 4 draws (1 French Open MS + 1 French Open WS + 13 Wimbledon MS + 9
Wimbledon WS pool-touching users), `is_synthetic=false` throughout (every draw
is complete with real `winner_confirmed_at` ordering), 127/127 `health_bands`
rows populated.

The `recompute-health-bands` edge function's optional `force_version` body
param (added during the original v1-frozen implementation specifically to
resimulate Wimbledon under v2 while its own `scoring_version` stayed `1`) is
no longer exercised by anything now that every draw's real version already
reads `2` — left in place as a harmless override lever (normal auto-confirm
calls never pass it) rather than removed, consistent with the "keep both code
paths as a cheap rollback lever" principle above.

## Implementation History (superseded) — original NO-retroactive-changes rationale

Kept for record only — reversed 2026-07-18, see above.

The new formula was originally meant to apply only to future slams. Wimbledon
2026's actual leaderboard, standings, and any player-facing stats were NOT to be
recalculated under the new rules — the tournament was complete and its outcome
(Carson Bodnarek #1 MS, Vibes Architect #1 WS, under the v1 formula) was meant to
stay as-is, permanently. This was an explicit, deliberate call by Ben after
seeing that a formula change would flip who's sitting at #1 in men's under a
rough estimate during the planning session — he didn't want to rewrite the
outcome of a finished, already-played-out tournament without first confirming
that risk was real. It wasn't (see reversal above).

As an interim step before the reversal, `health_bands`/`health_band_samples`
were re-simulated under v2 for Wimbledon 2026 specifically (via a one-off
`force_version` override on the edge function, since Wimbledon's own
`scoring_version` was still `1` at the time) while its live leaderboard stayed
on v1 — this was the original justification for adding `force_version` in the
first place. That carve-out is now moot (see "Health bands simplified" above)
but the `force_version` mechanism itself was kept.

**Decided 2026-07-17: `draws.scoring_version` column.** An integer column,
default `1` for every existing draw at the time (Wimbledon 2026 and French Open
2026, backfilled explicitly), `2` for all new draws going forward (set at
draw-upload time in `src/commissioner.js`, no commissioner-facing version picker
UI) — later updated to `2` for all existing draws too per the reversal above.
Every scoring function that depends on round base points, the upset bonus, or
the Match Yield stake reads the draw's `scoring_version` and branches via a
version-keyed config object (`SCORING_CONFIGS` in `src/scoring.js`) rather than
duplicating whole functions. v1's numeric output is unchanged for any draw still
tagged v1 — verified against a live Wimbledon 2026 spot check under v1 (Tacoma
Elk 276.5 Draw Yield MS) and the `test-harness/` golden diff. The verbatim copy
in `supabase/functions/recompute-health-bands/health-scoring.js` (see
`.claude/rules/health-bands.md` "Serverless Auto-Confirm Path") carries the same
version-keyed config, kept in sync per that file's existing "copied, not
imported" discipline — Draw Health's own formula isn't changing, but it still
depends on Draw Yield's base-points table to weight rounds.

## Verification (2026-07-18)

After the retroactive `UPDATE draws SET scoring_version = 2` (all 4 draws) and
the health-bands wipe/rebuild:

- **v1 code path unaffected:** `test-harness/` golden diff clean (this was a
  data-only change — no code in `SCORING_CONFIGS[1]` was touched).
- **Live Wimbledon 2026 leaderboard, recomputed under v2** (via the real
  `calcStats`/`isPoolEligible`/`calcSlamIndex` functions run directly against
  live match/pick data, not an estimate):
  - MS: #1 Carson Bodnarek — 263.0 Draw Yield / +34 Match Yield / 117 Slam Index
    (12 pool-eligible players; Zach K still excluded, below the participation
    threshold)
  - WS: #1 Vibes Architect — 209.0 Draw Yield / +142 Match Yield / 126 Slam
    Index (9 pool-eligible players)
  - Both #1 spots confirmed unchanged from the v1-era standings — the finding
    that justified this whole reversal.
- **Health bands:** `health_band_samples` wiped and rebuilt — 1651 rows
  (Wimbledon MS, 13 users), 1143 rows (Wimbledon WS, 9 users), 127 rows each
  (French Open MS/WS, 1 user each), all `is_synthetic=false`. `health_bands`
  has all 127 `n` rows populated, `sample_size=24` uniformly (the pool-touching
  user count is constant across every `n` since every draw is fully decided).

## Outstanding Questions — RESOLVED 2026-07-17

Both prior open questions are now decided (see "THE FINAL PLAN" §2 and
"Implementation Scope" above for the resolutions). Kept here for record:

1. ~~Stale-pick-with-no-backup handling in Match Yield~~ — **decided:** auto-score
   on the odds favourite, same as a truly blank pick (v2 only; v1 keeps its
   current no-op behavior). See §2 above for the corrected description of what
   v1 actually does today.
2. ~~Formula-versioning mechanism~~ — **decided:** `draws.scoring_version` column.
   See "Implementation Scope" above.
3. **Still worth doing when implementing:** verify Carson Bodnarek's exact numbers
   via the real scoring engine, not the
   raw-SQL approximation used during this review, before running the Wimbledon
   health-band resimulation. His real Health (69.9% MS) sits ~9.7 points above what
   his literal picks alone would compute, which is the signature of the ELO
   auto-assign credit (tied to a mid-tournament roster swap he was affected by,
   see `.claude/rules/roster-changes.md`) not being replicated in this review's
   SQL. This doesn't affect the (frozen, untouched) live Wimbledon leaderboard, but
   it DOES affect the accuracy of the health-band resimulation data, so get it
   right there.

## Findings from this review (context, not action items)

**Round balance was already fine** under the old formula — champion pick was only
~5-9% of total achievable points; no single pick decided outcomes.

**Draw Yield vs. Draw Health mostly agreed under the old formula, but diverged hard
for high-variance brackets.** Pool-wide correlation 0.80-0.83. The clearest outlier:
Deez Nuts Got Heem (WS) had the 2nd-best Draw Yield (correctly called several huge
upsets, including a #14 seed over #1 Sabalenka) but 2nd-worst Health (31%, most of
the rest of the bracket busted) — both numbers were honestly true, just measuring
different things. This divergence is what motivated decision #1 above.

**Seed-based chalk was not competitive** under the old (correctly-signed) upset
bonus formula (9th of 12 MS, 8th of 9 WS). **ELO-based chalk was much stronger**
(3rd of 12 MS, 2nd of 9 WS) — and gets stronger still under the new no-bonus Draw
Yield (tied for #1 MS on Draw Yield alone, #2 WS). This is expected under the new
design, not a flaw: Draw Yield no longer claims to reward boldness, only coverage.
**Verified the combined 50/50 Index still discourages chalk even so** — a strategy
of always betting the market favourite on every one of 127 Match Yield picks nets
-128 in MS (~10th of 13) and -31 in WS (~5th of 9), because bookmaker odds carry a
house margin. Strong Draw Yield + weak Match Yield nets out to an unremarkable
Index position, which is the load-bearing justification for why removing the upset
bonus from Draw Yield is safe.

**Match Yield already partially captures what Health captures.** Match Yield
correlated with Health at 0.37 (MS) / 0.84 (WS) under the old formula — because
Match Yield scores every match all tournament, including the backup picks a busted
bracket forces you into.

**The auto-favourite ("no pick") fallback was NOT a factor in Wimbledon 2026's real
standings.** Verified pool-wide: it fired exactly once, for the one player
(Zach K) already excluded from the pool-eligible ranking. Every other player's
Match Yield was driven by real picks, or — for a "stale" pick referencing an
already-eliminated player — **silently excluded from Match Yield entirely** (no
win, no loss, not counted in the resolved-bets denominator), NOT an auto-favourite
credit and NOT a guaranteed loss either (see Methodology Notes for the exact
mechanism — corrected 2026-07-17 from an earlier "guaranteed zero/loss"
description in this doc, which was wrong). This is the finding that surfaced
what's now Outstanding Question #1 (resolved above): the current "stale pick
silently doesn't count" behavior is a bug, not a harsher penalty — it's arguably
*more* lenient than betting the favourite would be, since it excludes the match
instead of resolving it either way. Fixed in v2 by routing stale picks through
the same auto-favourite branch as a genuinely blank pick.

## Verified formulas and gotchas (for anyone re-deriving these numbers)

Several real things were found and fixed while reproducing the app's stats in raw
SQL against production Supabase data — worth knowing before trusting any
from-scratch reproduction, or before writing the new formula:

1. **Upset bonus direction (old formula).** `calcUpsetBonus` in `src/scoring.js` is
   `Math.max(0, numericSeed(winner) - numericSeed(loser))` — bonus only when the
   winner was worse-seeded than who they beat.
2. **Backup-pick exclusion (Draw Yield).** `calcStatsAsOf` only adds a match to
   Draw Yield when `isBackupPick(m, locked)` is false. `isBackupPick` is true only
   when `matchPick` is **explicitly set and different from** `originalPick` — a
   `null` `matchPick` does NOT count as a backup pick.
3. **Match Yield pick resolution.** Uses `pickName = m.matchPick || m.originalPick`
   (falls back to the original pick when no backup pick was made), matched against
   the match's real occupants for odds lookup.
4. **Stale-pick scoring mechanism (the crux of the now-resolved Outstanding
   Question #1 — corrected 2026-07-17, this item previously stopped one step too
   early and drew the wrong conclusion).** `applyWinner` in `src/picks.js`
   computes `matchPickResult` as a literal string comparison:
   `pk.match_pick ? (pk.match_pick === winnerName ? 'correct' : 'wrong') : null`
   — read directly from the raw stored DB value, with NO check for whether that
   pick still makes sense (i.e., whether the picked player is even still alive to
   be in that match). A stale pick (something was picked, it's since been
   eliminated, never renewed) therefore resolves `matchPickResult` to `'wrong'`,
   not `null` — so it does NOT reach the auto-favourite branch in
   `calcStatsAsOf`'s Match Yield block (`else if (!pickName && ...)`), which only
   fires when the stored pick value is truly empty.
   **But `'wrong'` here does not actually mean a scored loss.** Follow it one
   more step: `calcStatsAsOf`'s Match Yield block takes the `if (pickName &&
   m.matchPickResult)` branch (pickName = the stale stored name, truthy;
   matchPickResult = `'wrong'`, truthy) and looks up `lockedOdds` by comparing
   `pickName` against `m.p1?.name`/`m.p2?.name` — the match's REAL occupants,
   which by definition are no longer the withdrawn/eliminated player the stale
   pick names. That comparison always fails, so `lockedOdds` is `null`, the
   `if (lockedOdds)` guard fails, and **nothing is added to `matchYield` and
   `matchYieldResolved` is never incremented** — a silent no-op, not a scored
   loss. `buildDrawView`'s step-3 nulling of dead `matchPick` values
   (`draw-view.js` line 91) only runs for matches that are still undecided
   (`if (m.winner) return` skips it for decided matches) and only mutates the
   in-memory derived object, never writes back to the database — irrelevant to
   this picture for a completed tournament either way.
   **v2 fix:** treat a `pickName` that matches neither occupant the same as no
   pick at all — fall through to the auto-favourite branch.

Verified the Draw Yield fix by reproducing all 4 top-of-leaderboard MS values
exactly against a live screenshot: Tacoma Elk 276.5, Vibes Architect 271, Carson
Bodnarek 270, Yaniv Horenstein 252.5.

`health_band_samples` (n=127 rows, `is_synthetic=false` for a live-tracked draw)
holds the real, already-computed final Draw Health % per user per draw under the
OLD formula — use this as a reference point, but it will need regenerating under
the new formula per the Implementation Scope section above.
