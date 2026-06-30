# Betting Layer — Match Yield

Read this when working on odds, Match Yield scoring, the Odds tab, or name mappings.

## Scoring Formula

`stakeByRound = [10, 10, 20, 20, 30, 40, 50]` (ri 0–6)

- **Win:** `round(stake × (oddsDecimal − 1))`
- **Loss:** `−stake`

`oddsDecimal` = consensus decimal odds of the picked player, **frozen at pick-lock** (original_picks lock for R0; backup_picks lock for R1+).

Match Yield scores against `matchPickResult` (same as Match Accuracy), not `originalPickResult`. Covers all resolved matches where `odds_p1_locked` / `odds_p2_locked` is set.

## Odds Lifecycle

1. **Live odds:** `fetch_all_active_odds()` PL/pgSQL runs every 3 hours via pg_cron (`fetch-odds` job). Fetches h2h from The Odds API, computes consensus = avg decimal across bookmakers, upserts into `odds_raw`, then pushes matched consensus to `matches.odds_p1_live` / `odds_p2_live` where `name_mappings` exist.
2. **Locked odds:** `fire_scheduled_locks()` snapshots `odds_p*_live → odds_p*_locked` in two cases:
   - **`original_picks` lock fires:** snapshots odds for all `round_index = 0` matches in the draw. R0 never gets a backup_picks lock, so this is the only opportunity to freeze those odds.
   - **`backup_picks` lock fires:** snapshots odds for the covered `(round_index, match_index_start, match_index_end)` range.
   - Both cases: condition `odds_p1_live IS NOT NULL AND odds_p1_locked IS NULL` (no overwrites).
3. **Display:** Cards show American odds (live until locked, locked after). Post-result shows earned/lost yield.

## API Details

- **Key:** stored in Supabase Vault as `ODDS_API_KEY`. Never client-side.
- **Endpoint:** `/v4/sports/{sport_key}/odds?regions=uk,eu&markets=h2h&oddsFormat=decimal`
- **Budget:** ~2 credits/run × 8 runs/day × 14 days = 224 credits/slam (500/month free tier).

## Sport Keys

| Slam | MS | WS |
|---|---|---|
| AO | `tennis_atp_aus_open_singles` | `tennis_wta_aus_open_singles` |
| RG | `tennis_atp_french_open` | `tennis_wta_french_open` |
| WIM | `tennis_atp_wimbledon` | `tennis_wta_wimbledon` |
| USO | `tennis_atp_us_open` | `tennis_wta_us_open` |

AO uses `_singles` suffix; others do not.

## Name Matching

Odds API delivers full names: `"Carlos Alcaraz"`. Draw players also stored as full names from TNNS PDFs.

Auto-match: `normaliseName()` strips diacritics (NFD + Unicode combining chars), lowercases, collapses spaces. Mirrors `normalise_player_name()` SQL function. If normalised strings match, the SQL poller writes consensus odds to the match row automatically.

Unmatched names (normalised strings don't match) appear in Commissioner → Odds tab for manual triage. Mappings saved to `name_mappings` table (api_name PK, draw_player_name). Persist across slams for returning players.

## DB Objects

| Object | Purpose |
|---|---|
| `odds_raw` | Raw API event rows (home/away names, consensus decimals, fetched_at) |
| `name_mappings` | api_name → draw_player_name, persists across slams |
| `matches.odds_p1_live/p2_live` | Live consensus decimal, updated each fetch |
| `matches.odds_p1_locked/p2_locked` | Frozen at lock time (original_picks lock for R0; backup_picks lock for R1+) |
| `fetch_all_active_odds()` | SQL poller, SECURITY DEFINER, reads vault key |
| `refresh_odds_now()` | Commissioner RPC, calls fetch_all_active_odds(), enforces is_commissioner |
| `normalise_player_name(text)` | SQL helper, mirrors JS normaliseName() |
| pg_cron `fetch-odds` | `0 */3 * * *` — every 3 hours |

## Round-2+ Occupant Resolution in `fetch_all_active_odds()` (fixed 2026-06-30)

`matches.p1_name`/`p2_name` are only ever populated for `round_index = 0` (the
derived-state model never writes the round-2+ occupant back to the match row — see
CLAUDE.md §5). The odds poller's name-matching UPDATE originally joined directly on
`m.p1_name`/`m.p2_name`, so it silently never matched (and never wrote
`odds_p1_live`/`odds_p2_live`) for any match past round 0 — match cards for round 2+
showed no odds even though the Odds tab correctly showed odds arriving from the API
into `odds_raw`. Found by directly querying `matches` for `round_index=1` and seeing
empty `p1_name`/`p2_name` + null odds columns alongside populated `odds_raw` rows.

Fix: the UPDATE now joins to a subquery (`em`, aliased per match `id`) that computes
an effective `eff_p1`/`eff_p2` — for `round_index = 0` these are just `p1_name`/
`p2_name` as before; for `round_index > 0` they're the `winner` of the two feeder
matches one round back (self-join on `draw_id`, `round_index - 1`,
`match_index * 2` / `match_index * 2 + 1`). This must be a plain subquery joined via
`em.id = m.id` in the WHERE clause, **not** a `LATERAL` join — Postgres rejects a
`LATERAL` item that references the UPDATE target table (`m`) from within its own
FROM-clause list (`42P10: invalid reference to FROM-clause entry for table "m"`).

Run `select fetch_all_active_odds();` directly via Supabase MCP `execute_sql` to
backfill immediately after a round advances, rather than waiting for the next
3-hour pg_cron tick.

## JS Modules

- `src/odds.js` — `STAKE_BY_ROUND`, `normaliseName`, `decimalToAmerican`, `formatAmerican`, `formatYield`, `pickedLockedOdds`, `liveOdds`, data access functions
- `src/scoring.js` — `STAKE_BY_ROUND` export, `matchYield` / `matchYieldResolved` added to `calcStatsAsOf` return
- `src/stats.js` — Match Yield pill (post Draw Yield, before Draw Accuracy)
- `src/leaderboard.js` — slam card has Match Yield column; detail view columns match stats bar order; records tab Match Yield card replaces Match Accuracy
- `src/bracket.js` — odds/yield footer on match cards
- `src/commissioner-odds.js` — Odds tab: status/refresh, unmatched triage, saved mappings

## Leaderboard Column Order

**Stats bar (post-lock):** Draw Yield → Match Yield → Draw Accuracy → Match Accuracy → Draw Health

**Slam summary card:** Player / Draw Yield / Match Yield / Health

**Detail view:** Player / Draw Yield / Base Pts / Upset Pts / Match Yield / Draw % / Match % / Health

**Records tab:** Avg Score card | Match Yield card (Avg/Best toggle) | Top Brackets card

## Auto-Pick Favourite — Match Yield (Odds) (BUILT — scoring.js)

When a player has no `matchPick` AND `odds_p1_locked` / `odds_p2_locked` exist AND the match has a result → scored for Match Yield as if they picked the **odds favourite** (lower decimal = favourite).

- **Scoring only** — no DB row created, purely computed in `calcStatsAsOf`
- **Match Yield only** — Draw Yield / Draw Accuracy / Match Accuracy unaffected
- **Overridden by any real pick** — if `matchPick` is set, real pick wins
- **Favourite determination:** `odds_p1_locked < odds_p2_locked` → p1 is favourite; otherwise p2
- Tracked in the same `matchYield` accumulator and increments `matchYieldResolved`

## Auto-Pick Favourite — Draw Yield / Health (ELO) (BUILT — scoring.js)

Twin of the odds auto-pick. When a player's **original pick is missing OR names a withdrawn player**, Draw Yield and Draw Health are auto-scored on the **ELO favourite** of the actual matchup (higher ELO = favourite).

**`isAutoAssign(m, withdrawnNm)` (exported from `scoring.js`):**
- `!m.originalPick` → true (never picked)
- `originalPick === m.p1.name || m.p2.name` → false (valid live pick, score normally)
- `originalPick ∈ withdrawnNames` → true (forward-cascaded stale pick after a withdrawal)
- Otherwise (normal wrong prediction) → false

**`eloFavourite(m, eloLookup)`** — uses the R0-only ELO map from `src/elo.js`; returns `null` when either occupant lacks ELO (no auto-scoring in that case).

**`withdrawnNames(d)`** — builds the withdrawn-player Set from `d.rounds[0].matches.map(m => m.replaced_name)`.

**Scoring (calcStatsAsOf):** in the `!backup` branch after `wOrig++`; adds `sc.base + sc.skill` (full upset bonus) when the ELO favourite won. Excluded from cDrawOrig/wDrawOrig (Draw Accuracy untouched).

**Health (calcHealthPts):** when `isAutoAssign`, treats ELO favourite as the pick for `maxHealthPts` and `reachableHealthPts`. ELO missing → skipped (same as "no pick" was before).

**Display (bracket.js, viewer-bracket.js original mode):** the favourite's row gets `.s-elo-auto` + a `.pr-elo-auto` "auto" badge (muted grey, uppercase mono). The badge fires when `isAutoAssign` is true and ELO resolves to a name; cleared by any valid real pick.

**Alert copy:** the roster-change alert modal (`showRosterAlerts` in `main.js`) notes that unrepicked matches will be auto-scored to the ELO favourite.

## First-Slam Troubleshooting

- Commissioner → Odds tab shows fetch status and last fetch time.
- "Force refresh now" calls `refresh_odds_now()` RPC immediately.
- If sport key is wrong (data returns empty), check The Odds API `/v4/sports` list and update the CASE statement in `fetch_all_active_odds()`.
- If names don't auto-match, they appear in the "Unmatched API Names" section for manual assignment.
- `odds_raw` table can be inspected directly via Supabase MCP `execute_sql` to debug what the API returned.

## Commissioner Player Swap — Odds & ELO Clearing

When `confirmEditPlayer()` swaps a player (`oldName !== newName`), it clears **both sides' live and locked odds** (h2h prices are relative, so either side alone is meaningless) and **only the swapped side's ELO** (the opponent's rating stays valid). The regular odds poller and ELO sync repopulate the cleared values once data for the new player exists.

## Display: American Odds

- Underdog (decimal ≥ 2.0): `+round((decimal − 1) × 100)` → e.g. `+150`
- Favourite (decimal < 2.0): `round(−100 / (decimal − 1))` → e.g. `−200`

Chalk code (`calcChalkScore`) is retained in `scoring.js` / `stats.js` but not rendered. Uncommenting the `chalkHTML` lines in `stats.js` re-enables it.
