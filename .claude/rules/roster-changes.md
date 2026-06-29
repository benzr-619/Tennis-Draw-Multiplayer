# Roster Changes — Lucky Loser / Withdrawal Swaps

Read this when working on commissioner player edits, the rosterAlerts system, or the swap alert modal.

## `replaced_name` Column (matches table)

Added 2026-06-28. Stores the name of the player who was removed (e.g. `'Mattia Bellucci'`).
Set alongside `roster_changed_at` whenever the commissioner swaps a round-0 player.
Used as the display name in the alert modal so players know who withdrew.

## Always-Stamp on Any R0 Swap (`confirmEditPlayer`)

`src/commissioner-results.js` — `confirmEditPlayer()`:

- Condition: `ri === 0 && oldName && oldName !== newName` (no `d.locked` requirement)
- Sets `roster_changed_at = now()` and `replaced_name = oldName` in both the Supabase update and in-memory `m`
- The one-time-repick reopen (`editedAfterLock`, clearing `originalPick`/`matchPick`) stays **post-lock only** — that block is unchanged
- Odds/ELO clearing (both sides' live+locked odds, swapped side's ELO) also fires on any real swap — see `.claude/rules/betting.md`

## Unified `rosterAlerts` Detection (`loadDraw` in `src/data.js`)

`assembled.rosterAlerts = [{ replaced_name, p1_name, p2_name, db_id, ri, mi }]`

Populated for every round-0 match with `roster_changed_at` set and no `winner`, where the user **hasn't repicked since the change** (`pick.updated_at < roster_changed_at`, or no pick row).

### Post-lock path (`assembled.locked === true`)
- Runs the existing `editedAfterLock` reopen logic (unchanged)
- Clears `originalPick`/`matchPick` if the pick no longer points at a current player
- Pushes the match to `rosterAlerts`

### Pre-lock path (`assembled.locked === false`)
- No `editedAfterLock` — that flag is post-lock only
- If `matchPick` points at neither `p1.name` nor `p2.name` (stale, departed player), clears it in-memory and clears any orphaned forward `matchPick` values in later rounds
- If `matchPick` is valid (picked the player who stayed), leaves it untouched
- Pushes the match to `rosterAlerts` either way (alert fires even for still-valid picks — heads-up)
- **No DB writes** — RLS prevents writing to other users' picks rows

### "Repicked since change" check (both paths)
```js
const pickUpdatedAt = pickMap[m.db_id]?.updated_at
const repickedSinceChange = pickUpdatedAt && new Date(pickUpdatedAt) >= new Date(m.roster_changed_at)
```
Once the user repicks, their pick's `updated_at` advances past `roster_changed_at`, silencing the alert on subsequent loads.

### Edge case: pre-lock swap later becoming post-lock
A pre-lock swap stamps `roster_changed_at` now. If the draw later locks (without the player repicking), the post-lock path will also fire for that player — reopening the match for a one-time repick and showing the alert again. This is acceptable (intended behaviour: the player gets re-prompted after lock).

## Alert Modal (`#roster-alert-modal`)

HTML in `index.html`, logic in `src/main.js` — `showRosterAlerts(d)`.

- Called from `showBracketScreen()` after `showScreen('screen-bracket')` (active-draw path only)
- Filters `d.rosterAlerts` against `_rosterAlertsAcked` (session-level `Set`) to avoid re-showing within a session
- Cycles through multiple alerts (1 of N) if multiple swaps in one draw
- **"Go to match"** — closes modal, acks all pending, scrolls to ``.mc[data-ri="${ri}"][data-mi="${mi}"]``, pulses `.mc-roster-swap` highlight (1.5 s)
- **"Skip" / "Dismiss"** — cycles to next alert or closes; acks all on last step
- `_rosterAlertsAcked` is module-level and not persisted — alerts re-appear on hard reload until the user actually repicks (which advances `updated_at`)
