# Data Fetching — PostgREST Row Cap

## The problem

PostgREST's default response cap is **1,000 rows**. Rows past that limit are silently
dropped — no error, no warning. At ~20 players × 127 matches per draw the pick table
returns ~2,540 rows per draw, so any single unranged query misses ~1,540 rows.

## Rule

**Any query that fetches picks across multiple users for a whole draw must either
paginate or aggregate server-side.**

## Current call sites (as of 2026-06-28)

| File | Function | Fix |
|---|---|---|
| `src/leaderboard.js` | `loadAllPicksForDraw` | `fetchAllRows()` paginator |
| `src/leaderboard-slams.js` | `_loadBaseline` | `fetchAllRows()` paginator |
| `src/commissioner-locks-orig.js` | `_doLockOriginalPicks` (snapshot step) | `snapshot_original_picks` RPC (server-side UPDATE) |
| `src/commissioner.js` | `renderPickCompletion` | `pick_completion` RPC (server-side COUNT GROUP BY) |

## `fetchAllRows` helper (`src/leaderboard.js`)

```js
export async function fetchAllRows(baseQuery) {
  const PAGE = 1000
  let from = 0
  const all = []
  while (true) {
    const { data, error } = await baseQuery.range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...(data || []))
    if ((data || []).length < PAGE) break
    from += PAGE
  }
  return all
}
```

Use it wherever a cross-user query is needed:
```js
const picks = await fetchAllRows(
  supabase.from('picks').select('...').eq('draw_id', drawDbId)
)
```

Import it from `leaderboard.js`. Do NOT import `supabase` just to run a raw paginated
query — if you're outside leaderboard modules, either add it as an export of `data.js`
or pass the assembled rows down from the caller.

## Supabase RPCs (deployed 2026-06-28)

**`snapshot_original_picks(p_draw_id UUID)`** — atomically does
`UPDATE picks SET original_pick = match_pick WHERE draw_id = p_draw_id`. No row cap;
replaces the old fetch-then-N-update loop in `_doLockOriginalPicks`. Call via
`supabase.rpc('snapshot_original_picks', { p_draw_id })`.

**`pick_completion(p_draw_id UUID)`** — returns `TABLE(user_id UUID, filled BIGINT)`,
aggregated on the server. Call via `supabase.rpc('pick_completion', { p_draw_id })`.

## Deferred: Records-tab summary table

`leaderboard-records.js` loops `loadDrawStatsForAllUsers` over every historical draw.
Each call uses paginated `loadAllPicksForDraw`, so it's correct. At ~20 players and
a few draws per year it's fast enough for several years.

When the Records tab eventually feels slow (estimated 5–10 years out), the fix is to
precompute a ~20-row per-draw stats summary once when each draw is completed and store
it in a `draw_stats_summary` table. History then loads summaries instead of re-scoring
raw picks. **Do not build this now.**
