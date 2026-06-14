---
name: autopick-match-yield
description: Auto-pick the odds favourite for Match Yield scoring when a player has no match pick set — spec agreed 2026-06-09, not yet built
metadata:
  type: project
---

# Auto-Pick Favourite for Match Yield

**Rule:** If a player has no `matchPick` for a match AND that match has `odds_p1_locked` / `odds_p2_locked` set, they are scored for Match Yield **as if they had picked the odds favourite** (the player with the lower decimal = higher implied probability).

**Why:** Incentivises picking every match. Players who skip matches to avoid losses still get penalised — they're auto-assigned the "obvious" pick instead of taking zero.

## Behaviour

- **Scoring only** — no phantom pick row created in the DB. Computed at `calcStatsAsOf` time.
- **Match Yield only** — Draw Yield, Draw Accuracy, Match Accuracy are all unaffected (no pick = zero contribution to those stats, same as now).
- **Only applies when locked odds exist** — if no locked odds, no auto-pick, no score.
- **Overridden by any real pick** — if `matchPick` is set, real pick wins, no auto-pick logic runs.
- **Favourite determination:** `odds_p1_locked < odds_p2_locked` → p1 is favourite; otherwise p2.

## UI on Bracket Cards (NOT YET BUILT)

When `matchPick` is null AND locked odds exist AND match has no result yet:
- Show the favourite's name in the card with a muted "auto" indicator (styling TBD — perhaps grey-purple tint, small "auto" badge)
- Makes it clear the player will be auto-scored if they don't pick

Post-result with auto-pick:
- Show earned/lost yield with an "auto" label to distinguish from a real pick

## What Needs Building (next session)

1. **`scoring.js` `calcStatsAsOf`**: in the `matchYield` block, if `pickName` is null but locked odds exist, determine favourite and score as if that player was picked. Add `matchYieldAuto` counter to track auto-assigned matches separately if needed.
2. **`bracket.js` `placeCard`**: render "auto" state on card when no pick + locked odds. Needs a new CSS class (e.g. `mc-odds-auto`).
3. **`stats.js`**: no change needed — matchYield total already includes auto-picked matches after scoring.js fix.
4. **`leaderboard.js`**: no change needed — matchYield flows through naturally.

**How to apply:** In next session, read this file + `.claude/rules/betting.md` before touching scoring.js or bracket.js.
