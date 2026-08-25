# Slam Index v2 — Absolute Cross-Slam Rating

Read this before touching `calcSlamIndex`, `calcChalkBaselines`, or anything that
compares a Slam Index across more than one draw (Records shrinkage standings, the
Slams-tab Combined M/W card, movement-arrow baselines).

## Why v1 wasn't cross-slam comparable

`calcSlamIndex` (v1, unchanged — still the code path below) z-scores a player's Draw
Yield and Match Yield against whoever else entered THAT draw:
`index = 100 + 15 × avg(z_drawYield, z_matchYield)`. Because the population is
"everyone who played this draw," the pool mean is *pinned* to exactly 100 every
single time, for every draw, regardless of how strong or weak the field was. A 115
at one slam and a 115 at another aren't the same achievement — they just both mean
"typical distance above whatever this particular pool did," which makes cross-slam
aggregates (the Records shrinkage standings, `avgSlamIndex`) an apples-to-oranges
average.

## What v2 changes — and what it doesn't

**The formula shape is identical.** Still `100 + 15 × avg(edgeDY, edgeMY)`, still one
number per player, still no tuning constant to fit. The only change is the *reference
point* each edge is measured against:

| | v1 | v2 |
|---|---|---|
| Draw Yield reference | pool mean/stddev of `score` this draw | a fixed **chalk** baseline for this draw (below) |
| Match Yield reference | pool mean/stddev of `matchYield` this draw | a fixed **chalk** baseline for this draw (below) |
| Needs other players' picks? | yes | **no** — draw-level only |

Draw Yield's own scoring is untouched — no `scoring_version` bump, no change to
round base points or how a pick resolves. This is purely a change to what Slam
Index measures itself against.

## The two chalk baselines

Both are computed once per draw by `calcChalkBaselines(d, filterRi = Infinity)` in
`scoring.js`, scoped to **currently-decided matches only** (`m.winner` set) — this
keeps the baseline comparable to a player's own live `baseScore`/`matchYield`, which
`calcStatsAsOf` likewise only sums over decided matches. `filterRi` mirrors
`calcHealthPts`'s clone-and-null-forward pattern, for the "as of round R-1" baseline
the Slams-tab movement arrows need (see "Call sites" below).

**`chalkDY` / `sigmaDY` — the ELO-favourite bracket.** `_buildEloChalkBracket(d)`
walks the draw round-by-round starting from the real R0 players, and at every slot
picks whichever of the two occupants has the higher ELO (missing ELO → 1500) as the
"chalk" winner, propagating that pick forward exactly the way a real player's
original pick propagates. `chalkDY` = the base points that bracket would have scored
against the REAL results. `sigmaDY` is that bracket's own theoretical standard
deviation: `sqrt(Σ basePoints(round)² × p×(1-p))`, where `p` is the chalk favourite's
win probability for that specific chalk matchup (standard Elo logistic:
`1/(1+10^(-Δelo/400))`). `p×(1-p)` is a coin-flippiness weight — a 95/5 mismatch
contributes almost nothing to the variance, a genuine toss-up contributes the most.

**`chalkMY` / `sigmaMY` — the odds-favourite bettor.** Every resolved match with
both `odds_p1_locked`/`odds_p2_locked` set is bet on the favourite at a flat 10-point
stake — reuses `_autoFavouriteYield(m, 10)` (the same function that scores a real
player's blank/stale pick) rather than reimplementing the win/loss math. `sigmaMY`
uses the closed-form variance of a flat-stake bet against **fair** bookmaker odds:
a stake-`s` bet at decimal odds `o` has variance `s²×(o-1)` when the implied
probability is `1/o`, so `sigmaMY = 10 × sqrt(Σ (favOdds - 1))` over every resolved
match. This is why `chalkMY`/`sigmaMY` hardcode a flat 10-stake regardless of the
draw's own `stakeByRound` table — the derivation only holds for a fixed stake, and
every real draw is already on the v2 flat-10 stake table in practice (see
`.claude/rules/scoring-redesign.md`).

`calcChalkBaselines` returns `{chalkDY, chalkMY, sigmaDY, sigmaMY, valid}`.
`valid` is false when the draw doesn't have enough ELO or odds data to trust the
baseline (`sigmaDYsq`/`sigmaMYsq` would be 0, or no ELO/odds at all) — see Fallback
below.

## No tuning constant — and what was rejected on the way here

The brief for this feature was explicit: don't introduce anything to fit. Three
alternatives were considered and rejected before landing on the theoretical-variance
approach above:

- **A fitted scaling constant** (pick some `c` so the blend "feels" 50/50 on
  historical data) — rejected outright: it's exactly the kind of "adjust weights
  until the leaderboard looks comfortable" approach the original scoring-redesign
  review (`.claude/rules/scoring-redesign.md`) was built to avoid.
- **Pot-share weighting** (weight each edge by its share of the draw's total
  theoretical points — 448 Draw Yield points vs. 1270 Match Yield points at 10/match
  × 127) — gave a 64/36 Match-Yield-heavy blend, silently overturning the documented
  50/50 decision (`.claude/rules/leaderboard-records-redesign.md` "Why Slam Index is
  the headline") without anyone actually deciding to change it.
- **A fitted equal-influence constant** (find whatever scalar makes the two edges'
  standard deviations equal across historical data) — still a fitted number, just
  fitted to a different target; same objection as the first option.

The theoretical-variance derivation above needs no fitting at all — `sigmaDY` and
`sigmaMY` are each derived from first principles for their own mechanism (a
binomial/Elo bracket; a fair-odds bet), so the resulting blend is whatever it
naturally comes out to. Measured on the two Wimbledon 2026 draws (2026-08-24
verification): effective DY/MY influence came out close to 50/50, matching the
already-documented decision — evidence the derivation is measuring the right thing,
not something tuned to match it.

## Versioning: `draws.slam_index_version`

Separate column from `draws.scoring_version` (Draw Yield/Match Yield's own formula
version) — Slam Index can change independently of how the two inputs it consumes are
scored. `int not null default 2`; backfilled to `2` on every existing draw
(2026-08-24, same retroactive-by-default posture as `scoring_version`'s 2026-07-18
reversal — see `.claude/rules/scoring-redesign.md` "Implementation Scope"). New
draws get `2` from the column default; no commissioner-facing picker, matching
`scoring_version`'s precedent.

`getScoringConfig`-style branching lives in `calcSlamIndex(entries, opts)`:
`opts = { version, chalk }`. `version === 2` with `chalk.valid` true → each entry
scored **independently** against `chalk` (no pool stats computed at all — this is
what makes the result comparable across draws). Anything else (`version !== 2`, or
`chalk` missing/invalid) → the original v1 pool-relative z-score, byte-identical to
before this feature. v1's code path is kept fully intact as a one-row rollback lever,
same discipline as `scoring_version`'s v1.

## Fallback

A draw whose matches lack ELO or locked odds (`calcChalkBaselines(...).valid ===
false`) — currently French Open 2026 MS/WS, which predate the betting layer having
any odds data — silently falls back to the v1 field-relative index for that draw
only. This is intentional per the brief ("never silently emit a wrong number" means
never emit a chalk-based number computed from insufficient data — falling back to a
well-understood v1 number is the safe choice, not a bug). Every call site that
branches on `slam_index_version === 2` checks `chalk.valid` before trusting it:
`loadDrawStatsForAllUsers` (leaderboard.js), `_loadBaseline` (leaderboard-slams.js,
movement-arrow baseline), `buildCombinedCard` (leaderboard-slams-combined.js, via
`combineChalkBaselines`), `fetchPoolSlamIndex` (stats.js).

## Call sites

- **`leaderboard.js` `loadDrawStatsForAllUsers`** — the canonical per-draw stats
  computation every other consumer reads from (`statsCache`). Computes the chalk
  baseline once via `calcChalkBaselines(buildDrawView(structuredClone(baseDraw)))`
  — a picks-free view works because decided-match occupants are winner-derived
  regardless of whose picks built the view (`buildDrawView` step 1 always prefers
  `winner` over `originalPick`/`matchPick`); undecided matches are skipped by
  `calcChalkBaselines` itself, so it doesn't matter that a picks-free view leaves
  them blank.
- **`leaderboard-slams.js` `_loadBaseline`** — the Slams-tab movement-arrow baseline
  needs the chalk reference "as of round R-1" to match the entries it's ranking
  (also computed `calcStatsAsOf(ud, R-1)`), so it calls
  `calcChalkBaselines(assembleDrawForUser(d, []), R - 1)`.
- **`leaderboard-slams-combined.js` `buildCombinedCard`** — sums two draws' raw
  totals (unchanged) and combines their chalk baselines via `combineChalkBaselines`
  (sums the chalk totals, adds variances since the two draws are independent —
  `sigma_combined = sqrt(sigma1² + sigma2²)`). Requires **both** draws on
  `slam_index_version === 2`; a mixed v1/v2 pairing falls back to v1 for the combined
  card rather than mixing reference frames.
- **`stats.js` `fetchPoolSlamIndex`** — the stats-bar hero stat. v2 needs no other
  players' data at all (see "What v2 changes" above), so this computes the index
  **synchronously**, locally, off the draw already loaded for the current user —
  no `loadDrawStatsForAllUsers` fetch, no cross-user picks query. Falls through to
  the original cross-user v1 fetch only when `chalk.valid` is false.
- **`leaderboard-records-data.js` `buildShrinkageStandings`** — the
  `avgSlamIndex` it's shrinking now comes from cross-comparable v2 numbers
  wherever the source draw supports it — this is *why* the redesign was worth
  doing. It DID need a code change, though (2026-08-25) — see "The anchor bug"
  below; `shrinkSlamIndex` now takes an explicit `anchor` (the pool's actual
  mean index), not a hardcoded 100.

## The anchor bug (found and fixed 2026-08-25)

`buildShrinkageStandings` pulls a player's raw average toward an anchor:
`shown = (n/(n+K)) × avg + (K/(n+K)) × anchor`. When this shipped (2026-07-18,
`.claude/rules/leaderboard-records-redesign.md`), the anchor was hardcoded to
`100` — correct at the time, because v1 (field-relative) Slam Index z-scores
against the pool, which by construction pins the pool mean to exactly 100 for
every draw. Shrinking toward 100 was shrinking toward the pool's actual
average, just via a shortcut that didn't need computing it.

**This shortcut broke silently when v2 shipped** (this file, 2026-08-24). Under
the absolute chalk-referenced formula, 100 means "matched chalk" — almost
nobody does, on either side. The pool's actual mean index across real
player×draw entries is around 88, not 100. Anchoring to 100 anyway pulled every
low-sample player's shrunk score *up* toward a number well above the pool's real
center of mass. Confirmed on live data: a newcomer whose only draw scored 70
(bottom of the pool) shrank to 95.0 and outranked two veterans; a newcomer
scoring 85 shrank to 97.5 and outranked six of nine. The adjustment was
rewarding not playing — the exact failure mode the min-draws-gate and
cumulative-totals alternatives were rejected to avoid (see the redesign doc's
"Why the old Records tab standings were rejected").

**Fix:** `shrinkSlamIndex(avg, n, anchor, K = 5)` in `scoring.js` now takes the
anchor as a real parameter. `computePoolMeanIndex(brackets)` in
`leaderboard-records-data.js` computes it fresh from whatever v2 entries are in
scope (mean Slam Index across every player×draw entry) — no new query, no
storage, reuses `buildAllBrackets`'s existing flat list. v1-fallback entries are
excluded from this mean (they sit on a different, pool-relative scale and would
corrupt it).

**The deliberate split: a per-draw index is permanent, the anchor is not.** Once
a draw is complete, its chalk baseline and sigmas are fixed forever — that
specific draw's Slam Index for a given player never changes retroactively. The
*anchor* used to shrink a player's cross-draw average, by contrast, is
recomputed on every render and is expected to drift as more draws land and the
pool's true mean index becomes better known. Do not "fix" this drift by
freezing `poolMeanIndex` — freezing it just reintroduces a hardcoded-anchor bug
with different numbers baked in, and the whole point of computing it fresh is
that it tracks reality as the sample grows.

## The K recomputation procedure

K was picked once (`.claude/rules/leaderboard-records-redesign.md`, K=5) and
never revisited with real evidence — see the correction at the top of that
file. `computeShrinkageK(brackets)` in `leaderboard-records-data.js` is the
standing method for estimating it from actual cross-draw variance instead of a
guess. Written so it can be re-run without rediscovering the derivation:

1. **Restrict to v2-only entries, then to players with ≥2 v2 draws.** A
   v1-fallback entry sits on a different scale (see the anchor bug above) and
   would corrupt the variance estimate the same way it'd corrupt the mean. A
   single-draw player has no within-player signal at all — they can't tell you
   anything about whether one player is more *consistent* than another, which
   is specifically what K needs to measure.
2. **Draw-centre.** Subtract each draw's own mean (computed over this same
   restricted population, not the whole pool) from every entry. This isolates
   player consistency from draw-level effects — a tough field, a chalky
   bracket, an unusually top-heavy tournament. Skipping this step is not a
   smaller error, it's a different and worse one: without it, "this draw was
   hard for everyone" and "this player is inconsistent" are indistinguishable,
   and on the current two-draw dataset, skipping it collapses `sigma_between`
   to ~0 and sends K to infinity (confirmed while building this — see "Verified
   against real data" below).
3. **`sigma_within²`** — pooled within-player variance of the draw-centred
   residuals around each player's own mean, using proper degrees of freedom
   (`Σ(n_i − 1)` across players, not `n_i`) so no player's sample size
   double-counts.
4. **`sigma_between²`** — variance of player means, minus the sampling noise a
   finite `mean_n` draws already contributes: `Var(playerMeans) −
   sigma_within²/mean_n`. This is the standard method-of-moments random-effects
   estimator — `Var(playerMeans)` alone conflates real between-player spread
   with the noise you'd see even from identical players sampled only `mean_n`
   times each; subtracting `sigma_within²/mean_n` removes that noise floor.
5. **`K = sigma_within² / sigma_between²`.** The ratio directly answers "how
   many extra draws' worth of pull toward the anchor does it take to cancel out
   one draw's worth of pure noise" — a bigger `sigma_within` (draws are
   unpredictable) or a smaller `sigma_between` (players are all roughly equally
   good) both push K up, i.e. shrink harder.

**Guards** — `k`/`reason` only; the diagnostic numbers (`n_players`, `n_draws`,
`draw_gap_max`, `sigma_within`, `sigma_between`) are returned whenever
mathematically defined, independent of whether these guards trip. That's
deliberate: a commissioner watching those numbers evolve across slams is
exactly how a currently-guarded K becomes trustworthy later, and hiding them
entirely until the guards clear would remove the only signal for *when* that
happens. The commissioner status card chooses to hide them when a guard trips
(see commissioner-results.js) — the function itself does not.
- `n_draws < 3` — draw-centering needs at least 3 draws to be credible; with
  only 2, the two draw means are themselves noisy estimates and "centering"
  risks fitting to that noise rather than removing it.
- `n_players < 5` — too few multi-draw players to trust a variance estimate at
  all (each player contributes only 1 degree of freedom to `sigma_within`).
- `sigma_between² ≤ 0` — no detectable skill spread above single-draw noise;
  K would be negative or infinite, neither of which means anything.

**K=5 is currently retained on a single-slam estimate of ~4.9 and is NOT
validated.** The only real computation to date (Wimbledon 2026 MS+WS, 9
players, 2 draws) trips the `n_draws < 3` guard by design — 2 draws isn't
enough to trust draw-centering, so this estimate is diagnostic only, not
adopted. Every direction of error in the current estimate argues for shrinking
*harder* (raising K), not softer: `sigma_within` (~13) already runs slightly
hot on too little data, and every known bias in the pipeline (`sigmaDY` runs
hot per the section below, `n_draws` is at the guard floor) points the same
way. There is no evidence anywhere that K should be lower than 5.

**Verified against real data (2026-08-25, Wimbledon 2026 MS+WS, 9 players who
played both):** `computeShrinkageK` on the real chalk-referenced Slam Index for
these 9 players produced `sigma_within ≈ 13.1`, `sigma_between ≈ 5.8`,
`K ≈ 5.15`, `n_players = 9`, `n_draws = 2`, `draw_gap_max ≈ 12.7`,
`poolMeanIndex ≈ 88.5` — matching independent hand-derivation to within normal
rounding error. `n_draws = 2` correctly trips the guard (`reason` set,
`k_suggested` stays null, Apply disabled) — confirmed as the correct outcome,
not loosened.

## Single-draw noise is the headline finding

`sigma_within ≈ 13` is **more than twice** `sigma_between ≈ 5.9` — one draw's
result tells you far less about a player's true skill than it tells you about
that draw's particular randomness. This is why the Records standings display
**whole numbers only** (no decimal places — a tenth-of-a-point difference would
advertise a precision the measurement doesn't have), **allow ties** (two
players landing on the same rounded shrunk score is a correct, expected
outcome given the noise floor, not a bug to break arbitrarily), and **break
ties by `n` descending as a sort key only** — more draws played ranks higher
when two shrunk scores are equal, but this is never surfaced as a number or
described to players as a rule; it only decides row order.

## `draw_gap_max` — the normalisation instrument

The whole point of the v2 formula is that a Slam Index means the same thing at
every draw — a properly working chalk baseline should leave no systematic gap
between two draws' mean index beyond what real skill differences and sampling
noise explain. `draw_gap_max` (computed by `computeShrinkageK`, over the same
restricted v2/multi-draw-player population as everything else in that function)
is the largest such gap between any two draws on record, surfaced on the
commissioner status card and flagged when it exceeds 10.

On the current data, Wimbledon MS and WS differ by ~12.7-12.9 points — above the
flag threshold, most likely because `sigmaDY` understates chain correlation (see
"Known weakness" below), and that bias bites hardest in a chalky draw (WS was
more predictable than MS this slam). **This is an instrument, not a lever** — a
large `draw_gap_max` is a signal to go look at whether the normalisation is
doing its job, not something to correct by hand-adjusting anything. Do not
"fix" a large gap by nudging chalk baselines, sigmas, or K to make it smaller;
if it's real, the fix (if any) belongs in the chalk-baseline math itself
(`calcChalkBaselines`), and only once there's enough draws to tell a persistent
bias apart from one chalky slam.

## Known weakness — sigmaDY runs slightly hot

`sigmaDY` treats each of the draw's matches as an independent Bernoulli trial. Real
bracket outcomes are chained — you can't reach round 3 without having already won
rounds 1 and 2 — so the true variance of "total chalk-bracket points scored" is
somewhat lower than the sum of each match's marginal variance computed in isolation.
Practically: `sigmaDY` is a slight overestimate, which understates a real player's
Draw Yield z-score a bit (their edge divides by a denominator that's too generous).
Correcting this properly needs a Monte Carlo simulation of the whole bracket (or an
exact recursive convolution) — considered and explicitly rejected as too much
machinery for a ~20-person pool. Revisit only if this bias is ever shown to matter in
practice (e.g. it starts visibly compressing Draw Yield's contribution relative to
Match Yield across several slams).
