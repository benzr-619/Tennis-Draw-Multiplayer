# Draw Health Bands — Stage-Calibrated Hue

Read this when working on the health-hue colour scale, band computation, or the
commissioner Health Bands / Getting Ready flows.

## Why

The health underline / leaderboard health bars used a fixed 25%→90% red-to-green
ramp. Early in a slam almost everyone is near 100%, so meaningful gaps washed out
to all-green. Bands recalibrate the ramp against the **historical health distribution
at the same tournament stage**, where stage = `n / 127` and `n` = number of confirmed
matches in the draw.

**Gradient bounds are LOW_PCTL/HIGH_PCTL percentiles, not P25/P75** (changed
2026-06-30). P25/P75 only gradients the middle 50% of the historical distribution —
everyone outside it (by definition ~half the cohort) renders at full-saturation
red/green regardless of how close they actually are to the edge. With this app's
small real sample (~11-24 real-pick samples per stage as of 2026-06-30), the P25-P75
gap can be a sliver of the true range (4.7 of 35 points at n=59 in practice),
producing a harsh cliff instead of a gradient — confirmed by querying
`health_band_samples` directly and computing percentiles by hand before touching
the formula. `LOW_PCTL`/`HIGH_PCTL` (in `health-bands.js`, currently **10/90**) widen
that window so most of the cohort sees a real gradient; only genuine outliers clip to
pure red/green. 10/90 was chosen over something more extreme (P1/P99) because with
this few samples, P1/P99 essentially tracks min/max and lets one outlier sample
dominate the whole scale. Revisit the constant once more slam history accumulates.

## DB Schema (migration `health_bands_setup` + `health_bands_write_policies` +
`health_bands_rename_to_generic_gradient_bounds`)

- `matches.winner_confirmed_at TIMESTAMPTZ` — real confirmation order going forward.
  Stamped by `applyWinner` (`new Date().toISOString()`), cleared by `undoWinner`.
  Backfilled synthetically for pre-existing data: `TO_TIMESTAMP(round_index*86400 + match_index*60)`.
  **Internal only — not loaded into the client draw object.**
- `health_bands` — 128 rows (n 1..127): `lo, hi, sample_size, computed_at`. Current
  band values (the LOW_PCTL/HIGH_PCTL percentiles, generically named since the
  percentile choice is a tunable constant, not literally P25/P75), overwritten on
  recompute. Consumed by `healthHue`.
- `health_band_samples` — raw samples, PK `(n, draw_id, user_id)`: `health_pct,
  is_synthetic`. Grows permanently; old draws never re-simulated. Percentile-choice
  changes only require re-running `recomputeAllBands`/`recomputeBandForN` against
  these — no re-simulation needed (samples are independent of the gradient bounds).
- **RLS:** all five (well, both) new tables — authenticated SELECT; **commissioner-only
  writes** (mirrors `lock_schedules`, NOT the picks "own rows" pattern). Band computation
  only ever runs from commissioner actions, so the anon key + commissioner session passes.

## `calcHealthAtMatchSet(d, confirmedIds)` (scoring.js)

Twin of `calcHealthPts`. Same clone-and-replay shape; only difference is the null-out
condition — nulls `winner`/`score` for matches whose `db_id` is **not** in
`confirmedIds` (a Set), then `buildDrawView`. Reuses `withdrawnNames`/`eloFavourite`
unchanged. Callers must pass a **coherent** set (matches in bracket order, e.g. ordered
by `winner_confirmed_at`) so `buildDrawView` never sees a later-round result without its
feeder. Returns `{ maxHealthPts, reachableHealthPts }`. Body is intentionally duplicated
from `calcHealthPts` (do not restructure scoring.js).

## `healthHue(pct, n, healthBands)` (scoring.js)

```js
const band = healthBands?.get(Math.round(n * 127))
const floor = band?.lo ?? 25,  ceil = band?.hi ?? 90
return 4 + clamp((pct - floor) * 100 / max(1, ceil - floor), 0, 100) * 1.4
```

`n` is the stage fraction `confirmedCount / 127`; `Math.round(n*127)` recovers the
integer band index. Falls back to the old static 25/90 ramp when `healthBands` is empty
or the band is missing — so calling `healthHue(pct)` (no extra args) still works.

**Call sites** (both derive `confirmedCount` by counting `m.winner` across `d.rounds`):
- `stats.js` `_updateHealthUnderline(strip, s, hasResult, d)` — d threaded in for n.
- `leaderboard-slams.js` health bar — `draw` already in scope.

Both pass `state.healthBands`.

## `src/health-bands.js`

Owns all band computation. **Never blocks the main thread** — trajectory loops yield
via `await new Promise(r => setTimeout(r, 0))` every 20 steps.

- `HEALTH_BANDS_LIVE_MODE = true` — flip to false once past-slam history is rich enough
  that including the live slam in real-time adds no calibration.
- `computeDrawTrajectory(assembledUserDraw, orderedMatchIds)` → `[{n, health_pct}]` for
  n=1..length; at step k uses `new Set(orderedMatchIds.slice(0, k))`.
- `initializeAllBands(onProgress)` — one-time/manual: simulates every draw × user,
  marks all samples `is_synthetic=true`, recomputes all bands. Commissioner "Initialize
  health bands" button.
- `addSlamToBands(completedDrawIds, onProgress)` — between-slams: finds draw_ids with any
  `is_synthetic=true` samples (plus any `completedDrawIds`), deletes + re-simulates each
  with **real** `winner_confirmed_at` ordering (`is_synthetic=false`), recomputes all
  bands. Old all-real draws untouched. Called (no args) by the Getting Ready button.
- `updateBandAtN(n, activeDraw, userIds)` — live per-match: recomputes only the active
  draw's contribution to band n, recomputes that one band. Returns `{durationMs}`.
- `revertBandAtN(n, activeDraw, userIds)` — undoWinner twin: re-simulates active draw at
  position n with **synthetic** ordering (`syntheticOrderedConfirmedIds`), re-stamps
  synthetic, recomputes band n.
- `loadHealthBands()` → `Map<n, {lo,hi}>` (empty Map on error/empty).

Reuses `assembleDrawForUser`, `loadAllPicksForDraw`, `loadAllProfiles`, `fetchAllRows`
from leaderboard.js and `loadDraw` from data.js. Percentiles via linear interpolation.
Sample upserts chunked at 500 (`onConflict: 'n,draw_id,user_id'`).

### Gotcha: no-pick profiles poison the calibration (found 2026-06-30)

`simulateDraw` (used by both `initializeAllBands` and `addSlamToBands`) and the live
`updateBandAtN`/`revertBandAtN` all skip any profile with **zero rows where
`original_pick IS NOT NULL`** for that draw (`hasRealOriginalPicks()`). A profile that
never made an original pick gets every match auto-assigned to the ELO favourite
(`isAutoAssign` in scoring.js), producing the *same* narrow, high (85–90%) trajectory
for every such profile — they're not real bracket variance, just the auto-assign
baseline repeated.

Found via direct Supabase query while debugging "everyone looks red": two historical
draws had `sample_size: 60` (4 draws × 15 profiles) but only **1 of 15 profiles per
draw** had any pick rows at all. The other 14 contributed 14 near-identical
auto-assign samples each, skewing P25/P75 to a tight 85–90% band that real human
brackets (which legitimately drift into the 70s–80s) fell below en masse — a
calibration/data problem, not a rendering bug. Confirmed by comparing band values
against `health_band_samples` and `picks` directly via `execute_sql` before touching
any color code.

If band output ever looks suspiciously narrow or uniformly high again, check
`sample_size` vs. actual `picks` row counts per draw/user first — don't assume the
hue math is wrong.

## Wiring

- `state.healthBands` (state.js) — `Map`, refreshed fire-and-forget in `data.js loadDraw`
  via dynamic `import('./health-bands.js')` (avoids a static data↔health-bands cycle).
- `picks.js` `_refreshBands(fn, d, renderStats)` — fired from the **commissioner-only** DB
  block of `applyWinner` (updateBandAtN) and `undoWinner` (revertBandAtN). Never awaited.
  `n` = count of `m.winner` in `d`. Shows status via `onBandsUpdating`/`onBandsUpdated`
  (commissioner-results.js), then reloads `state.healthBands` + calls `renderStats`.
  `userIds` come from `loadAllProfiles()` (the bracket draw only holds the commissioner's
  own picks, so all profile IDs are needed).
- `commissioner-results.js` — `onBandsUpdating()` / `onBandsUpdated(ms)` drive
  `#comm-bands-status` ("Updating bands…" → "Bands updated in X.Xs", clears after 5s).
- `commissioner.js` — `_refreshHealthBandsCache()` reloads `state.healthBands` and
  re-renders the leaderboard + stats bar (dynamic imports of `leaderboard.js`/`stats.js`
  to dodge a static cycle). Called after both `handleInitBands`'s `done` callback and the
  `addSlamToBands` `done` callback in `handleSwitchToGettingReady`. **Without this, a
  freshly recomputed `health_bands` table sits unused** — `state.healthBands` is *only*
  otherwise refreshed by `loadDraw` (page load) and the live confirm/undo path
  (`picks.js _refreshBands`), so running Initialize or Getting Ready left the leaderboard
  rendering with the stale/empty Map, silently falling back to the static 25/90 ramp.
  Symptom looked identical to the *original* bug (everyone green) but for the opposite
  reason — found 2026-06-30, immediately after fixing the no-pick-profile skew, by
  re-querying `health_bands` post-recompute (correctly wide 80–85% bands) and comparing
  against the still-green UI: the math was right, the client just never picked it up.
- `commissioner.js` — `renderHealthBandsSection()` (collapsible, Draw Management tab) with
  the Initialize button (`handleInitBands`, dynamic import, progress callbacks).
  `handleSwitchToGettingReady` fires `addSlamToBands()` after deactivation.

## Gotchas / Notes

- All long computation is fire-and-forget; UI feedback comes from `onProgress`/status
  callbacks. The `await import(...)` is fine — the heavy work yields internally, so the
  tab never freezes even though buttons re-enable on the `done` callback.
- `revertBandAtN` is an approximation (re-stamps band n with synthetic ordering); a stale
  sample may linger at the old higher position after an undo. Self-heals on the next
  `addSlamToBands`. Acceptable for a ~20-player commissioner tool.
- A draw fully tracked live (live mode on for its whole run) has complete real samples and
  is skipped by `addSlamToBands` (no synthetic samples). Draws confirmed with live mode off
  carry synthetic samples and get re-simulated with real ordering between slams.
