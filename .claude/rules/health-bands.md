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

## Client-Side Auto-Confirm Bridge (added 2026-07-03, superseded same day — see below)

First pass at closing the auto-confirm gap piggybacked on the realtime subscriptions
(`.claude/rules/realtime.md`): `main.js` `_realtimeRebuild()` (stage 1) and
`commissioner.js` `_onResultsRealtimeChange()` (stage 3) each snapshot confirmed
winners before `reloadActiveDraw()`, diff after, and call
`refreshHealthBands(updateBandAtN, d, renderStats, 'auto-confirm')` when a new one
appears (gated on `state.currentUser?.is_commissioner`, since band writes are
commissioner-only per RLS). **Still wired and still fires** — kept as a fast client-side
path when a commissioner tab happens to be open. But it has a real coverage gap: it
only fires while a commissioner-authenticated browser tab is connected. Ben's actual
commissioner workflow is heavily front-loaded (draw upload, odds/ELO/ESPN name
mapping) with locks possibly automated later — during a live tournament a commissioner
tab may rarely or never be open, which would leave bands stale for the whole event.
Superseded by the serverless path below for the actual gap-closing; the client bridge
remains as a redundant (idempotent, harmless) fast path.

`picks.js`'s `_refreshBands` was renamed to **`refreshHealthBands`** and exported
(previously module-private) so both realtime handlers could reuse it.

## Serverless Auto-Confirm Path (added 2026-07-03 — closes the coverage gap above)

**Problem with the client-side bridge:** it requires a commissioner browser tab open
and connected. **Fix:** run the same computation in a Supabase Edge Function, invoked
directly from `fetch_espn_scores()` right after a successful auto-confirm — zero
browser dependency.

### Why an Edge Function, not plpgsql

`fetch_espn_scores()` already runs SECURITY DEFINER with full DB access — no RLS
issue — so the *simplest* option would be porting the band math into plpgsql
directly. Rejected: `buildDrawView`/`calcHealthAtMatchSet`/`isAutoAssign`/
`eloFavourite` are exactly the derived-state logic CLAUDE.md §5 designates as having
ONE authoritative implementation (`buildDrawView`) — hand-porting that recursive
slot/elimination derivation to SQL would create a second implementation that can
silently drift from the JS one. An Edge Function runs real JS/TS, so the actual logic
can be reused (or, where transitive imports block direct reuse, copied verbatim with
clear provenance comments — see below) instead of re-derived.

### `supabase/functions/recompute-health-bands/` (deployed via Supabase MCP, not in
this git repo — Supabase Edge Functions are deployed directly, no local source tree)

Three files:
- **`draw-view.js`** — byte-for-byte copy of `src/draw-view.js`. Safe to copy
  unmodified because the original has **zero imports** — no drift-prone dependency
  surface. If `src/draw-view.js` ever changes, copy the new version over this file too.
- **`health-scoring.js`** — verbatim copies of `normaliseName` (odds.js), `eloMap`
  (elo.js), `withdrawnNames`/`isAutoAssign`/`eloFavourite`/`ROUND_CONFIG`/
  `calcHealthAtMatchSet` (scoring.js), `assembleDrawForUser` (leaderboard.js), plus a
  `percentile` helper mirroring health-bands.js's private one. **Copied, not
  imported**, because the real files transitively import `src/supabase.js`, which
  reads Vite's `import.meta.env` and throws immediately outside a Vite build — Deno
  has no `import.meta.env`. Each function has a comment citing its real source file —
  **any change to these functions in scoring.js/elo.js/odds.js/leaderboard.js must be
  mirrored here too**, or the serverless path silently drifts from the live app.
  `LOW_PCTL`/`HIGH_PCTL` (10/90) are hardcoded at the `index.ts` call site — keep in
  sync with health-bands.js's constants of the same name.
- **`index.ts`** — `Deno.serve` handler. POST body `{draw_id, n, source}`. Rebuilds a
  minimal base draw from `matches` (just the fields `assembleDrawForUser`/
  `calcHealthAtMatchSet` need — not the full `data.js loadDraw` shape), paginates
  `picks` for every user in the draw (1,000-row PostgREST cap, same as
  `fetchAllRows`), computes one `health_pct` sample per user with a real original pick
  (mirrors `hasRealOriginalPicks`), upserts `health_band_samples` + recomputes
  `health_bands` for that `n`, and writes `health_bands_status`.

### Auth: `verify_jwt=true` with a Vault-stored secret key (not a custom token scheme)

First attempt used `verify_jwt=false` + a self-invented `x-internal-token` header
scheme — flagged by the harness's safety classifier as weakening platform auth
unnecessarily. Corrected to the platform-native approach: the function is deployed
with **`verify_jwt=true`** (Supabase's edge runtime verifies the JWT before the
function body ever runs — no custom auth code in `index.ts` at all), and
`fetch_espn_scores()` authenticates as `Authorization: Bearer <secret key>`, where the
key is read from **Supabase Vault** (`HEALTH_BANDS_SERVICE_ROLE_KEY` — Ben stored it
himself via the Dashboard's SQL Editor, keeping the raw key out of any chat/session
transcript) — same vault-secret pattern as `ODDS_API_KEY`/`RESEND_API_KEY`. Note this
project uses Supabase's newer key system (`sb_secret_...` "Secret keys", not the
legacy `service_role` label) — functionally the same thing (server-only, bypasses
RLS), just renamed.

### Wiring in `fetch_espn_scores()`

Inside the existing `if autoconfirm_on and completed and status_name in (...) then`
block, right after `auto_confirm_match` returns true: counts confirmed matches in the
draw (`band_n`), reads the Vault secret, and calls
`extensions.http('POST', '.../functions/v1/recompute-health-bands', ...)` — same
`extensions.http` pattern already used for the Resend alert email
(`check_and_alert_score_feed()`) and the ESPN fetch itself. Wrapped in its own
`exception when others` block that only `RAISE WARNING`s — a failure here **never**
fails the poller run or flips `score_feed_status`'s failure counter; this is a
best-effort secondary action, not core to the score feed's job.

**Verified end-to-end (2026-07-03):** a direct SQL smoke test (same `extensions.http`
call `fetch_espn_scores()` makes) against the live Wimbledon 2026 draw returned
`status=200`, computed 13 samples in 531ms, and both `health_bands` and
`health_bands_status` reflected the write immediately — confirming the whole chain
(Vault secret → Bearer auth → edge function → DB writes) works without any browser
session involved.

## Persisted Status Card — "how long did the last update take" (added 2026-07-03)

New singleton table `health_bands_status` (`id=1`): `last_ok`, `last_attempt`,
`last_duration_ms`, `last_n`, `last_source`, `sample_count`, `last_error`. RLS mirrors
`health_bands`/`health_band_samples` — `auth_read` (SELECT true) + commissioner-only
`ALL`. Written by a new `_recordBandStatus(source, patch)` helper in `health-bands.js`,
called at the end of **every** recompute path (success or failure) —
`updateBandAtN`/`revertBandAtN` (each now take an optional `source` param, defaulting
to `'commissioner-confirm'`/`'commissioner-undo'`), `initializeAllBands` (`'initialize'`),
`addSlamToBands` (`'between-slams'`), plus `'auto-confirm'` from the realtime bridge
above. `loadHealthBandsStatus()` reads it back.

Rendered by `renderHealthBandsStatusSection()` (commissioner-results.js) into
`#comm-bands-history-wrap` (index.html, Results tab, above `#comm-espn-wrap`) — e.g.
`"Health bands · last update 2m ago · took 0.8s · n=43 · via auto-confirm"`. This is
**separate from** the existing transient `#comm-bands-status` 5s toast
(`onBandsUpdating`/`onBandsUpdated`) — that one is a quick in-the-moment confirmation
that something just happened; this one persists across reloads/sessions so the
commissioner can check it at any time, which is the actual signal for deciding when
`HEALTH_BANDS_LIVE_MODE` is no longer worth the per-match cost and can be flipped off
in favour of relying on historical between-slams calibration alone. Re-rendered from
`onBandsUpdated()` (so it refreshes immediately after any live recompute) and from the
same three call sites `renderEspnScoreFeedSection()` already has in commissioner.js
(`initCommissioner`, tab switch, M/W switch) so it's populated on load too.

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
