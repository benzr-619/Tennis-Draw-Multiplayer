# Slam Index v2/v3 — Absolute Cross-Slam Rating

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

## v3 — Monte Carlo σ (2026-08-28, SUPERSEDED by v4 — see below, 2026-08-30)

**Kept for record only.** `chalkBaselinesV3`, the frozen `chalk_dy`/`chalk_my`/
`sigma_my` columns, and `simulateChalkSigma`'s combined DY+MY simulation described
in this section no longer exist in the codebase — see "v4" below for what replaced
each piece and why v3's central idea (freeze chalk's realized score alongside the
simulated σs) turned out to be wrong. The σ_DY *methodology* this section
describes (Monte Carlo instead of the v2 closed form) is still exactly right and
carries forward into v4 unchanged — only the persistence shape changed (a full
outcome matrix instead of a frozen scalar).

Read this before touching `chalkBaselinesV4`/`chalkBaselinesForVersion`/`buildEloChalkBracket` in `scoring.js` or `src/slam-index-sim.js`.

### Why the closed-form σ_DY was wrong, and by how much

v2's `sigmaDYsq = Σ base_i² · p_i(1−p_i)` (in `calcChalkBaselines`) treats each match
as an **independent** Bernoulli trial. A real bracket isn't independent — a busted
round-1 pick kills every later round it fed, so a real player's actual score has
positive covariance across rounds that the closed form drops entirely (it's the
variance of a sum of independents, not the variance of a sum of *dependent* wins
along one bracket path). Dropped covariance is always positive here, so the closed
form always **understates** σ_DY — confirmed on Wimbledon 2026 by direct Monte
Carlo comparison: closed-form σ_DY was 41.1 (MS) / 43.8 (WS) vs. the simulated
61.9 (MS) / 56.9 (WS) — a 30-50% understatement. Understating a denominator
inflates every z-score, and it inflates by a **different amount per draw** (the
understatement's size depends on how top-heavy/predictable that specific bracket
was), which directly defeats v2's whole purpose: an index that's supposed to mean
the same thing at every slam was actually still carrying a per-draw distortion, just
a smaller one than v1's pool-relative scaling.

σ_MY didn't have this problem structurally — each flat-stake bet against fair odds
has conditional expectation zero, so by the law of total variance the cross-terms
genuinely vanish and `10·√(Σ(odds−1))` is a structurally correct closed form. Its
only flaw: it evaluates that sum using real market odds for exactly the 127 matches
that actually happened, rather than path-averaging over the different matchups a
hypothetical replay could produce. Since round-2+ matchups diverge fast from the one
real historical path across random replays, most of a simulated tournament's
non-round-1 matches fall back to ELO-implied *fair* odds (no house margin) rather
than the real, margin-shaved market odds the closed form always used — which is why
σ_MY moved by ~8-9% under simulation (a bit more than the ~3% back-of-envelope
guess, but the same mechanism and same direction: fair odds run slightly hot vs.
real odds, so the path-averaged variance runs slightly hot too).

### What changed, and what didn't

`chalkDY`/`chalkMY` (the realized scores, still from the unchanged closed-form walk
in `calcChalkBaselines`) are **untouched** — only the two denominators moved. The
formula shape in `calcSlamIndex` is untouched too (`(version === 2 || version ===
3) && chalk?.valid` — same `100 + 15×avg(...)`  shape, same 15 multiplier, never
retuned per this file's standing "no tuning constant" stance). `src/slam-index-sim.js`
(`simulateChalkSigma`) runs 40,000 full-bracket forward simulations from real R0
players, using the exact same ELO win-probability formula the chalk baseline itself
uses (`p = 1/(1+10^(-ΔELO/400))`, divisor 400, missing ELO → 1500). At every
simulated match: **DY** — does the simulated winner equal the FIXED chalk bracket's
predicted winner for that slot (`buildEloChalkBracket`, unchanged, exported from
`scoring.js` now instead of module-private)? If so, award that round's base points;
σ_DY = the stddev of a run's total score across all 40,000 runs. **MY** — accumulate
`(favOdds − 1)` for every match reached in that run's walk (real locked odds when the
simulated matchup is the one that actually happened, ELO fair odds `1/p` otherwise);
σ_MY = `10 · √(mean of that accumulator across runs)`.

A deterministic seeded PRNG (mulberry32, not `Math.random()`) makes the estimate
reproducible — `sim_seed`/`sim_runs` are persisted alongside the result specifically
so a stored σ can be reproduced or audited later.

### Never simulated on a render — persisted, commissioner-triggered

40,000 full-bracket walks is cheap in absolute terms (well under a second) but the
whole point of the persisted-snapshot design (mirroring the health-bands pattern —
`.claude/rules/health-bands.md`) is that no render path may ever call
`simulateChalkSigma` inline. New nullable columns on `draws`: `sigma_dy`,
`sigma_my`, `chalk_dy`, `chalk_my`, `sim_seed`, `sim_runs`, `sim_computed_at` —
threaded through `data.js` like any other draws column (including
`reloadActiveDraw()`'s hand-built synthetic `drawRow`, which was already silently
dropping `slam_index_version` on every reload before this fix — see the code
comment there). `chalkBaselinesV3(d)` (`scoring.js`) reads these four numbers
straight off the draw object; `valid` requires all four non-null and both sigmas
`> 0`.

`chalkBaselinesForVersion(d, version, filterRi = Infinity)` is the single dispatch
point every v2/v3 call site now uses instead of calling `calcChalkBaselines`/
`chalkBaselinesV3` directly:
- `version === 3` and `filterRi === Infinity` (the live/current baseline) → reads
  the persisted snapshot if valid.
- Everything else — `version === 3` with no persisted snapshot yet, or **any**
  `filterRi` truncation (the Slams-tab movement-arrow "as of round R-1" baseline,
  which has no per-round persisted snapshot to read) — falls back to the v2 closed
  form, computed inline. This is fine: the closed form is cheap (no simulation), so
  falling back to it never violates "don't simulate on every render." It does mean
  the movement-arrow baseline and a not-yet-simulated v3 draw's live index both use
  v2-quality σ until a commissioner runs the recompute for that specific need — an
  accepted, disclosed simplification, not an oversight.

Commissioner UI: `renderSlamIndexSimSection()` / `handleRecomputeSlamIndexSim()` in
`commissioner-results.js`, mounted at `#comm-sim-wrap` on the Results tab (same
three call sites as the health-bands/shrinkage-K status cards — init, tab switch,
M/W switch). The button computes `calcChalkBaselines(d)` (closed form, for the
unchanged realized chalkDY/chalkMY) and `simulateChalkSigma` in the same click,
writes all seven columns plus bumps `slam_index_version` to 3, patches the in-memory
draw object **before** calling `reloadActiveDraw()` (same qualifiers.js-established
discipline — `reloadActiveDraw()` rebuilds its `drawRow` from local flags, not a
fresh fetch), then reloads and re-renders.

### Verified (2026-08-28, Wimbledon 2026 MS+WS, real production data)

| | MS | WS |
|---|---|---|
| chalkDY (unchanged) | 330 | 171 |
| chalkMY (unchanged) | −68 | 16 |
| σ_DY closed-form (v2) | 41.1 | 43.8 |
| σ_DY Monte Carlo (v3) | 61.85 | 56.85 |
| σ_MY closed-form (v2) | 70.3 | 72.0 |
| σ_MY Monte Carlo (v3) | 76.83 | 78.07 |

Computed via a standalone Node script that re-implements `buildEloChalkBracket`/
`calcChalkBaselines`/`simulateChalkSigma` verbatim against real match/ELO/odds rows
pulled directly from Supabase (bypassing the browser build, since `odds.js`/
`supabase.js` need `import.meta.env` — same reason `recompute-health-bands` copies
functions rather than importing them, see `.claude/rules/health-bands.md`). 40,000
runs, seed 42. σ_DY landed within ~0.5% of an independently-computed reference
value at the same seed count and divisor (61.6/57.2 expected vs. 61.85/56.85
actual) — strong evidence the simulation logic is correct, not just plausible.

Persisted to both Wimbledon draws; `slam_index_version` bumped to 3 for **all** six
existing draws (French Open 2026 MS/WS, US Open 2026 MS/WS, Wimbledon 2026 MS/WS) —
same unconditional-backfill precedent v2 set, relying on `chalk.valid` to gate the
fallback at read time rather than gating the version bump itself. French Open still
has no locked odds and US Open 2026 hadn't started at bump time (0 decided matches)
— both correctly fall through `chalkBaselinesForVersion` → v2 closed form → still
invalid → v1 pool-relative, exactly as French Open already did under v2.

### Effective DY/MY blend — did it drift, and the K re-estimate

σ_DY moved far more (+30 to +50%) than σ_MY (+8 to +9%) — **not** a uniform rescale.
This is expected and is "the correction working," not a red flag: v2's σ_DY was
understated, which means v2's `z_DY` was systematically *overstated* relative to
`z_MY` — Draw Yield was quietly carrying more than its documented 50% share of the
index. Correcting σ_DY upward pulls its typical z-magnitude back down toward parity
with `z_MY`, which is the intended direction, not drift away from the documented
50/50 split (`.claude/rules/leaderboard-records-redesign.md` "Why Slam Index is the
headline"). A precise before/after player-level blend measurement (as opposed to
this directional argument) needs `loadDrawStatsForAllUsers` run through the app's
own live pipeline — not reproduced by this session directly (no authenticated
browser session available here) — but `chalkBaselinesForVersion` already routes
every real call site to the new v3 numbers now that both draws' `slam_index_version`
is 3, so the commissioner's existing "Recompute K" button
(`.claude/rules/leaderboard-records-redesign.md`'s "K recomputation procedure")
picks up v3-based indices automatically on its next click — no code change needed
there. The **old** guarded K estimate (pre-v3, still the last real number on record
as of this write-up): `sigma_within ≈ 13.18`, `sigma_between ≈ 5.67`, `n_draws = 2`
(guard tripped, never applied). Since K is a ratio of two variances both already in
index units, it's invariant to a *pure* common rescale of everything — but this
rescale isn't pure (DY moved much more than MY), so K is expected to shift
somewhat on the next recompute, just not through any mechanism this file's existing
"do not retune K by hand" guidance was written to guard against.

## Known weakness — v2's closed-form sigmaDY (SUPERSEDED by v3, see above — 2026-08-28)

**This section originally got the error's direction backwards, and is kept only for
record.** It claimed `sigmaDY` was "a slight overestimate" because bracket rounds
are chained (can't reach round 3 without winning rounds 1-2 first), reasoning that
chaining makes the true variance *lower* than the independent-sum closed form. That
reasoning was wrong: chaining means round-survival indicators are **positively**
correlated (winning round 2 requires having already won round 1), and positive
covariance between summed terms always *increases* total variance relative to
treating them as independent — the opposite conclusion from what this section
originally drew. Confirmed directly by Monte Carlo simulation (`src/slam-index-sim.js`
— see the "v3" section above): the closed form **understated** σ_DY by 30-50% on
real Wimbledon 2026 data (41.1 vs. simulated 61.85 for MS), not overstated it. v3
is the actual fix this section speculated about and declined to build — a full
Monte Carlo simulation of the whole bracket, now implemented, persisted (never run
inline on a render), and commissioner-triggered rather than automatic. v2's closed
form is kept fully intact as v3's cheap interim/no-simulation-yet fallback (see
`chalkBaselinesForVersion` above), not because it was correct, but because it's
cheap enough to compute inline where a persisted snapshot doesn't exist yet
(the movement-arrow "as of round R-1" baseline, or a v3 draw before its first
recompute).

## v4 — live chalk/σ_MY, persisted σ_DY matrix (2026-08-30, current)

Read this before touching `chalkBaselinesV4`/`calcSigmaMYLive`/`isDrawComplete` in
`scoring.js`, `updateSlamIndexSigmaDY` in `commissioner-results.js`, or
`runChalkSimulationMatrix`/`sigmaDYFromMatrix` in `src/slam-index-sim.js`.

### What was wrong with v3

v3 ran one 40,000-run simulation pre-tournament-ish (really: at whatever moment
the commissioner clicked the button) and froze **four** numbers onto the `draws`
row: `chalk_dy`, `chalk_my`, `sigma_dy`, `sigma_my`. Three separate errors, not one:

1. **Chalk's realized score is deterministic from real results, not a quantity to
   freeze.** `chalkDY`/`chalkMY` are just "what would chalk's fixed bracket/bettor
   have scored against reality so far" — a pure function of decided matches. Once
   more matches decide after the button click, the frozen `chalk_dy`/`chalk_my`
   silently go stale, understating (never overstating) chalk's realized score
   relative to what it should be with the fuller decided set.
2. **σ_MY never needed simulation at all.** A flat-stake bet's payout on one match
   is completely independent of every other match's payout — bets settle on their
   own, with none of Draw Yield's cascade/path dependency. The variance of an
   independent sum has an *exact* closed form; running it through Monte Carlo only
   ever approximates a number that doesn't need approximating.
3. **σ_DY has to move as results come in, and freezing it doesn't let it.** σ_DY is
   "how much would chalk's score vary, over hypothetical replays, given exactly
   the bracket positions decided so far." That decided set only grows over a
   tournament — a σ_DY computed against 20 decided matches describes a
   fundamentally different (much narrower) uncertainty than one computed against
   120. A single frozen scalar can only ever be right for the one decided-count it
   was computed at.

### The v4 fix, piece by piece

**Chalk realized (`chalkDY`/`chalkMY`) — always live, never persisted.** Nothing
about the underlying math changed — it's the exact same closed-form walk
`calcChalkBaselines` already did (chalk's ELO-favourite bracket for DY, chalk's
odds-favourite bettor for MY, both scoped to currently-decided matches). The only
change is deletion: the `chalk_dy`/`chalk_my` columns are gone, so every call site
computes them fresh, every time, off whatever's decided right now.

**σ_MY — exact closed form, live, no simulation, no persistence.**
`calcSigmaMYLive(d, filterRi)` in `scoring.js`. A single flat-stake bet's payout is
a two-outcome random variable: win pays `stake×(favOdds−1)`, lose pays `−stake`.
The variance of that is exactly `p(1−p) × (stake×favOdds)²`, where `p` is the
**de-vigged** implied win probability of the odds favourite (the raw `1/favOdds`
still carries the bookmaker's margin and would overstate `p`, understating the
variance). De-vig: `q1 = 1/odds1, q2 = 1/odds2, p_fav = q_fav/(q1+q2)`. Summed over
every decided match with both sides' locked odds — independent bets, so summed
variances are exact, not an approximation awaiting a future Monte Carlo upgrade
the way v2's σ_MY closed form was. The old `simulateChalkSigma`'s `myAccum`
tracking is deleted entirely from `slam-index-sim.js` — there is nothing left for
simulation to do on the MY side.

**σ_DY — still needs Monte Carlo, but persists the outcome matrix, not a scalar.**
A real bracket genuinely has cross-round covariance (busting round 1 kills every
later round it fed), so unlike MY there's no shortcut closed form — this is the
one piece v3 got structurally right. What v4 changes is *what* gets persisted:

- `runChalkSimulationMatrix(d, chalk, {runs, seed})` (`slam-index-sim.js`) runs
  40,000 full-bracket walks forward from **original pre-tournament ELO** —
  exactly like v3's simulation, same win-probability formula, same never-condition-
  on-real-results discipline — but instead of collapsing straight to a σ, it
  records one **bit per (run, bracket position)**: did this run's simulated winner
  match chalk's fixed prediction at that slot? Packed bit-major-by-position into a
  `Uint8Array` (`bitIndex = posIndex*runs + run`), base64-encoded, persisted once
  to `draws.dy_sim_matrix` (a ~635KB blob for 40,000×127 bits — deliberately never
  included in the normal draw-load `select()`, see `data.js`, since no render path
  needs it; only the confirm/undo trigger below ever fetches it).
- `sigmaDYFromMatrix(matrix, positions, runs, decidedKeys, roundBase)` masks that
  persisted matrix down to whatever's **actually decided in reality right now**
  (`decidedKeys` — a `Set` of `"ri-mi"` strings) and returns the standard
  deviation of chalk's simulated score across all 40,000 runs, for exactly that
  decided set. Because the decided set only ever grows one match at a time and is
  always ancestor-closed (you can't decide round 2 without round 1 already
  decided), no padding or special-casing is ever needed — it's a straight mask.
- **`draws.sigma_dy`** is the one scalar still persisted — kept in sync by
  `updateSlamIndexSigmaDY(d, source)` (`commissioner-results.js`), called
  fire-and-forget (never awaited — "commissioner must not wait") from both
  `applyWinner` and `undoWinner` in `picks.js`, exactly mirroring the
  `refreshHealthBands` pattern those two functions already use for health bands.
  - **First-ever confirmation for a draw** (`d.sim_computed_at == null`): runs the
    one-time 40,000-run simulation, persists the matrix + `sim_seed`/`sim_runs`/
    `sim_computed_at`, and computes/persists the first `sigma_dy` from whatever's
    decided at that moment.
  - **Every confirmation/undo after that**: fetches only `dy_sim_matrix` (a
    separate, targeted `select` — never the normal draw-load path), masks it to
    the now-changed decided set via `sigmaDYFromMatrix`, and writes back just the
    updated `sigma_dy` scalar. **Never re-simulates** — re-running a fresh 40k-run
    simulation on every one of up to 127 confirmations would be dramatically more
    expensive than the one-time cost, and would also make the index jitter between
    renders for no reason (two simulations of the same decided set would land on
    slightly different σ_DY purely from Monte Carlo noise, even with nothing about
    the real draw having changed) — masking a fixed matrix is deterministic and
    reproduces byte-identically given the same decided set.

**`chalkBaselinesV4(d, filterRi)`** (`scoring.js`) is the new per-draw entry point:
returns live `chalkDY`/`chalkMY` (via the unchanged `calcChalkBaselines` walk),
live `sigmaMY` (via `calcSigmaMYLive`), and `sigmaDY` = the persisted `d.sigma_dy`
when `filterRi === Infinity` and positive, else falls back to `calcChalkBaselines`'s
v2 closed-form σ_DY — same posture v3 had for the movement-arrow "as of round R-1"
baseline (no per-round persisted matrix exists) and for a draw that hasn't had its
first confirmation yet. `chalkBaselinesForVersion(d, version, filterRi)` now
dispatches `version === 4` to `chalkBaselinesV4` and `version === 2` to the fully
intact `calcChalkBaselines` (unchanged rollback lever); `version === 3` has no code
path left at all (the frozen columns it read are dropped) and falls through to the
v1 pool-relative index — safe, just less precise, and moot in practice since every
draw was bumped to `slam_index_version = 4` in the same migration that dropped the
v3 columns.

### Records-tab career aggregates: completed draws only

Separately from the σ redesign above, this pass also fixed a real gap: the
Records tab (`leaderboard-records.js`) and the commissioner's shrinkage-K
recompute (`commissioner-results.js`) both filtered candidate draws on
`d.locked` (`original_picks_locked`) — which flips at **tournament start**, not
finish. A live, still-in-progress draw was therefore already being averaged into
every player's all-time Slam Index the whole time, contaminating career numbers
with a score that was still moving. Fixed by `isDrawComplete(d)` (`scoring.js` —
`true` once the Final has a `winner`), now the filter both call sites use instead
of `d.locked`. A live draw still computes and shows a live index on the Slams tab
(`fetchPoolSlamIndex` in `stats.js`, unaffected by this change) — it just no
longer leaks into Records/K until it's actually finished. `buildAllBrackets`'s
`slamIndexVersion === 2` filters (used by `computePoolMeanIndex` and
`computeShrinkageK`'s v2-only restriction, `leaderboard-records-data.js`) were
also widened to `=== 2 || === 4` — a real, if minor, latent bug predating this
pass (v3 entries were being silently excluded from the shrinkage anchor/K
estimate too; nobody had noticed because Wimbledon 2026 MS/WS, the only draws
ever on v3, were both complete and had already been through their v2 window
before v3 shipped, so the exclusion never visibly changed anything).

### Migration (2026-08-30)

`chalk_dy`, `chalk_my`, `sigma_my` columns dropped from `draws`. `dy_sim_matrix`
(text, base64) added. `slam_index_version` column default bumped to `4`;
backfilled to `4` unconditionally on all six existing draws — same
unconditional-backfill precedent v2/v3 both set, relying on `chalk.valid` (now via
`chalkBaselinesV4`) to gate the safe v1 fallback at read time rather than gating
the version bump itself. The two Wimbledon 2026 draws keep their already-correct
`sigma_dy` (61.85 MS / 56.85 WS, unchanged numeric values — a completed draw's
decided set can never grow further, so there's nothing for a mask-only recompute
to change) despite having no `dy_sim_matrix` of their own (the column didn't exist
when their v3 simulation ran) — if either ever needed an undo, `sigmaDYFromMatrix`
would no-op on the missing matrix (a defensive `if (!data?.dy_sim_matrix) return`)
rather than crash; the commissioner's "Force resimulate σ_DY" button
(`renderSlamIndexSimSection`) exists specifically to regenerate a matrix from
scratch in that situation. French Open 2026 and US Open 2026 draws have no
`sigma_dy`/`sim_computed_at` yet (no winners confirmed as of this migration, or —
French Open — no odds/ELO data at all) and correctly fall through
`chalkBaselinesV4` → v1 pool-relative, same as always.
