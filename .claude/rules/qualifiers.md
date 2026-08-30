# Qualifier Placement & Draw Re-upload

Read this when touching the PDF parser, draw upload/re-upload flow, or roster-change
detection. Built 2026-08-27 in response to two real parser bugs found against the
2026 US Open men's draw PDF, plus a new re-upload feature to place qualifiers once
qualifying finishes.

## Why qualifier slots need a name at all

TNNS Live draw PDFs mark an unresolved slot (qualifying not yet complete, or a slot
vacated by a late withdrawal before a lucky loser is drawn) with the literal text
`QUALIFIER` instead of a player name. The number of these slots varies by
tournament (16 real qualifying spots plus 0-a few withdrawal vacancies) — **never
hard-code a qualifier count anywhere** (16, 18, or any other number); always derive
it from what the PDF actually parses to.

Two slots in the same match can both read `QUALIFIER` (confirmed live: 2026 US Open
men's draw, match 31 / positions 61 and 62, both unresolved simultaneously). Since
picks are stored as **name strings** (`picks.match_pick`/`picks.original_pick`), two
identically-named empty slots in the same match would be genuinely ambiguous — a
pick of "Qualifier" wouldn't say which side. The fix: identity is **position-keyed**.

## Naming convention — identity vs. display

`src/player-names.js` (new shared module):
- `isPlaceholderName(name)` — `/^Qualifier \d+$/`
- `displayName(name)` — `'Qualifier 61'` → `'Qualifier'`; anything else unchanged

**Identity** (what's stored everywhere — `matches.p1_name`/`p2_name`,
`picks.match_pick`/`original_pick`) is always the position-keyed form
`Qualifier <position>`, where `<position>` is the 1-128 draw position (not the
0-based match index). This is stable across re-parses of the same PDF (a given
position always yields the same placeholder string) and makes any bug traceable to
an exact slot.

**Display** is separate and deliberately loses the position number — no player
should ever see "Qualifier 61," only "Qualifier." `displayName()` is wired into
every **player-facing** render site:

| File | Site |
|---|---|
| `src/bracket.js` | Champion box (3 branches), elim-slot name, normal-slot name, displaced-pick floating label |
| `src/viewer-bracket.js` | Champion box (original + match mode), actual-winner label, match-mode name, original-mode name, actual-player floating label |
| `src/print.js` | `nameLineHTML()` (single choke point for every printed name), Finals-bar champion name |
| `src/picks.js` | Pick-confirmation modal (`pcm-name`) |
| `src/leaderboard-slams.js` | "Biggest Upset" chip text + its modal `sub` line (the actual render site for `bestUpset.pickedName`/`.opponent`, which `leaderboard.js` only computes) |

**Left unwrapped, deliberately:** `src/draw-view.js` (pure derivation — needs real
identity for matching feeders/eliminations, never renders anything) and
`src/tutorial-sandbox.js` (no rendering of its own — painted through the already-
wired `bracket.js`). **Commissioner screens keep showing the raw stored name on
purpose** (`renderR1Table` in `commissioner.js`, the Results-tab occupant cards,
the re-upload diff table below) — the commissioner needs to see exactly what's
stored, position number included, to debug a bad parse.

## Parser fixes (`src/parser.js`)

Two real bugs, found together against a live PDF, not two independent guesses:

**Bug A — QUALIFIER/BYE entries were silently dropped.** The name regex
(`/^([A-Z][A-Z\s\-\']+),\s*([A-Za-z][a-zA-Z\-]*)/`) requires "LAST, First" — a
`QUALIFIER` token never matches, so `if (!nm) continue` skipped the position
entirely, leaving `byPos[pos]` unset. Fixed by checking for `QUALIFIER`/`BYE`
**before** the name regex and recording a placeholder instead.

**Matched as a PREFIX, not an exact string** (`/^(QUALIFIER|BYE)\b/`, not
`rest.trim() === 'QUALIFIER'`). The first version (exact match) missed a real case:
the 2026 US Open men's draw has a stray `"CHAMPION"` label token (almost certainly
a trophy/champion graphic's text run, positioned near the bracket's visual center)
glued onto position 61's entry in the linear text stream, so that entry parsed as
`"QUALIFIER CHAMPION"` — not `"QUALIFIER"`. The outer capture regex
(`(?=\s+\d+\s+(?:[A-Z]|\d)|$)`) has no digit to stop at inside an all-caps stray
word, so it swallows it onto the current entry. A real player name can never
literally start with the word QUALIFIER or BYE, so prefix-matching is safe and
tolerant of this kind of PDF layout noise. **If a future PDF loses even more
qualifier positions than expected, check for this pattern first** — dump the raw
extracted text around the missing position and look for a stray all-caps word
glued onto the QUALIFIER token, same way this one was found (`extractPdfText`'s
output can be reproduced in Node via `pdfplumber`, joining each page's words with a
single space, since `extractPdfText` itself needs a real browser DOM for pdf.js).

**Bug B (critical, silent bracket corruption) — the match-building loop dropped
whole matches, shifting every later match into the wrong slot.** The old code was
`if (p1.name || p2.name) matches.push(...)` — match 31 (both sides QUALIFIER, pre-
Bug-A-fix) had both sides empty, so it was never pushed. Since `matches` is a flat
array whose index maps directly to bracket position, every match from 31 onward
landed one slot early. **Always push all 64 matches regardless of emptiness** — the
array shape must exactly mirror the 64 draw positions-pairs, with no conditional
skipping, ever.

## Parse validation — `validateParsedDraw(matches)`

Shared helper in `parser.js`, used by both the original upload flow
(`handleParseClick` in `commissioner.js`) and the re-upload flow
(`handleReuploadParse` in `commissioner-qualifiers.js`) — one validation path, not
duplicated. Returns `{ ok: true, placeholderCount }` or `{ ok: false, error }`:

1. `matches.length === 64` — refuses anything else outright (a corrupt parse, or a
   PDF that isn't a full 128-player draw).
2. Every one of the 128 positions has *some* name (real or placeholder) —
   `filter(m => m.p1_name).length + filter(m => m.p2_name).length === 128`.
3. `placeholderCount` — informational, shown to the commissioner
   (`"64 matches, 128 positions, N placeholder slots"`) so a bad parse is visible
   before confirming, not discovered mid-tournament.

## Re-upload / qualifier placement flow

**Migration:** `draws.qualifiers_placed_at timestamptz` (nullable) — set the first
time a re-upload places at least one qualifier for that draw; stays null forever for
a draw with no qualifier slots (e.g. one uploaded after qualifying already finished).

**UI:** `src/commissioner-qualifiers.js` (new module — split out rather than grown
into `commissioner.js`, which was already well over the repo's informal ~400-line
ceiling before this feature). `renderReuploadSection()` mounts into
`#comm-reupload-wrap` (Draw Management tab, between Pick Completion and Getting
Ready Mode), re-rendered from the same 4 call sites `renderPickCompletion` already
has in `commissioner.js` (init, M/W toggle's `draw` branch, post-confirm-new-draw,
post-reactivate) — it's per-active-draw state, same as pick completion.

### Diff — `_diffAgainstStored(d, parsed)`

Position-by-position comparison of the **stored** active draw's round-0 slots
(`d.rounds[0].matches`) against a **freshly re-parsed** set of R1 matches. For each
of the 128 positions:

- New PDF still reads `QUALIFIER` at this position → **skip entirely**, left
  untouched regardless of what's stored (qualifying still pending there).
- Stored is a placeholder, new is real → **bucket A: QUALIFIER PLACED**.
- Stored is real, new is a *different* real name → **bucket B: ROSTER CHANGE**.
- Stored is real, new reads `QUALIFIER` → **regression** (see gate 3 below) — the
  draw can never go backwards from a real name to an unresolved slot.
- Stored equals new → no diff, nothing recorded.

### Three safety gates (checked in this order; ANY failure refuses the whole
### upload and applies nothing)

1. **Shape** — `validateParsedDraw` (64 matches, 128 positions) must pass first.
2. **No regressions** — zero positions where the new PDF reads `QUALIFIER` over a
   currently-real stored name. A real regression here almost certainly means the
   wrong PDF was uploaded (an older revision, or a different tournament).
3. **Bucket B ≤ 8** — no more than 8 positions with a real stored name changing to
   a *different* real name. Placeholder-derived positions (bucket A) are excluded
   from this count entirely. Rationale: late withdrawals are rare (0-4 per slam in
   practice); a genuinely wrong-draw upload would mismatch on the order of ~110
   positions and get caught by this gate immediately, long before a real slam ever
   produces that many withdrawals.

The confirmation screen shows both buckets as labelled sections (position, old
name, new name) — nothing is written to the database until the commissioner clicks
"Apply changes."

### Applying — two different write paths, not one shared one

**Bucket B (ROSTER CHANGE) reuses the existing swap path unchanged.**
`confirmEditPlayer` in `commissioner-results.js` was refactored (behavior-
preserving — same DB writes, same in-memory patch, same stale-pick handling) to
extract `applyPlayerSwap(d, ri, mi, side, newName, newSeed, newIoc)`, callable both
from the modal-driven single edit and from the batch re-upload loop. Its semantics
are unchanged: name/seed/country write, `roster_changed_at`/`replaced_name` stamp,
odds/ELO clearing, and (pre-lock) `clearMatchPickForward` to purge the departed
player's own pick cascade.

**Bucket A (QUALIFIER PLACED) is deliberately its own write path
(`_applyQualifierPlacement` in `commissioner-qualifiers.js`), NOT a call to
`applyPlayerSwap`.** The two look similar (both write name/seed/country, stamp
`roster_changed_at`/`replaced_name`, clear odds/ELO) but diverge on the one thing
that matters: `applyPlayerSwap`'s pre-lock branch calls `clearMatchPickForward` to
**null out** any pick pointing at the old name — correct for a withdrawal (the pick
is now meaningless), wrong for a qualifier placement (a player who picked
"Qualifier 61" should end up picking the real qualifier, not lose their pick).
Bucket A never touches picks directly at all — it only updates the `matches` row,
then hands every affected `{old, new}` name pair to the RPC below in one batched
call.

**`place_qualifiers(p_draw_id uuid, p_map jsonb)`** — new `SECURITY DEFINER` RPC,
secured exactly like the existing `snapshot_original_picks` (no explicit
`is_commissioner` check in SQL — that function has none either; gating is
client-side only, same precedent). Required because RLS on `picks` is "own rows
only" (CLAUDE.md §6/§12) — the client literally cannot write another user's pick
row, and a qualifier placement must rewrite **every** user's `match_pick`/
`original_pick` from the placeholder name to the real one. `p_map` is a JSON array
of `{"old": "Qualifier <position>", "new": "<real name>"}`; the function loops
`jsonb_array_elements` and does one `UPDATE picks SET match_pick = CASE ... ,
original_pick = CASE ... WHERE draw_id = ... AND (match_pick = old OR
original_pick = old)` per pair.

`draws.qualifiers_placed_at` is set to `now()` only when bucket A was non-empty
(a re-upload that's pure roster-change touches nothing here). The in-memory active
draw's `qualifiers_placed_at` is patched locally right after the write, mirroring
the existing convention (`d.locked = true` after a lock, in
`commissioner-locks-orig.js`) — `reloadActiveDraw()` reconstructs its `drawRow`
from local flags, not a fresh `draws` row fetch, so any draws-table column it needs
to reflect post-write must be patched on the in-memory object first or the reload
would pass the pre-write (stale) value straight through.

## Pre-lock-only assumption, and why the stale-pick clearing doesn't fire

Qualifier placement always happens before the original-picks lock (qualifying
finishes before the tournament's own matches start). Bucket A's alert is a single
draw-level "Got it" modal (`#qualifiers-placed-modal`, `showQualifiersPlacedModal`
in `main.js`) — **not** the existing per-match `rosterAlerts` reopen-for-repick flow
that bucket B (and every other roster swap) uses. Keyed by `d.db_id + '@' +
d.qualifiers_placed_at` (not just the draw id) so a *later* re-upload that places
more qualifiers shows the modal again instead of staying silently ack'd from the
first placement.

**Ack'd via `profiles.qualifiers_ack_key` (persisted), not an in-memory Set — fixed
2026-08-28, same day as ship.** The first version session-ack'd this exactly like
`_rosterAlertsAcked` (a module-level `Set()`), which is the right call for roster
alerts because a repick gives them a real, DB-backed completion signal
(`picks.updated_at` advancing past `roster_changed_at`) independent of the session
Set — the Set is only a same-session convenience on top of that. A qualifiers-
placed event has no equivalent per-user signal to fall back on: dismissing the
modal doesn't change any pick, so a purely in-memory ack re-showed the modal on
**every single login**, not just the first time. Fixed with a one-column persisted
ack: `profiles.qualifiers_ack_key text` (migration `add_qualifiers_ack_key_to_profiles`),
selected in `fetchProfile()` (`auth.js`) alongside `display_name`/`is_commissioner`.
`showQualifiersPlacedModal` checks `state.currentUser?.qualifiers_ack_key === key`
before showing; the dismiss handler writes the key back via
`supabase.from('profiles').update({ qualifiers_ack_key: key }).eq('id', ...)`
(already covered by the existing "Users can update their own profile" RLS policy —
no new policy needed) and patches `state.currentUser` locally so it doesn't
re-prompt again later in the same session before the next profile fetch. One
column is enough — a player only ever needs to remember the *last* key they acked.

This raised a real question, not an assumed one: bucket A also stamps
`roster_changed_at` on the match (same column bucket B/every roster swap uses), and
`data.js`'s pre-lock **and** post-lock branches (`loadDraw`) independently detect
**any** match with `roster_changed_at` set and push a per-match `rosterAlerts`
entry (pre-lock also clears a stale `matchPick`; post-lock reopens the match for a
one-time repick).

**First attempt (wrong, shipped and then broken live 2026-08-28).** The initial
reasoning was that `picks`' `BEFORE UPDATE` trigger (`picks_updated_at` →
`handle_updated_at()`, unconditionally sets `updated_at = now()` on any UPDATE)
would make `place_qualifiers`'s pick rewrite bump `updated_at` past
`roster_changed_at` for every touched row, so the existing `repickedSinceChange`
check (`pickUpdatedAt >= roster_changed_at`) would silently suppress the alert for
anyone the RPC actually rewrote. That part was true — but it only covers users who
had a **real pick row** naming the placeholder. A user who simply hadn't reached
that match yet (no pick row at all, so no `updated_at` to compare) has
`repickedSinceChange` evaluate falsy regardless, and both branches push the alert
unconditionally whenever that happens — not just when there's something to clear.
Confirmed live: the commissioner (also a player) got "Qualifier 5 has withdrawn —
go to match" immediately after their own qualifiers-placed modal, because they
hadn't picked that far into round 1 yet. Worse, the wording is simply **wrong**
regardless of the timing question — bucket A's `replaced_name` is the placeholder
itself (`"Qualifier 5"`), and the shared alert modal (`showRosterAlerts` in
`main.js`) always renders it as `"<replaced_name> has withdrawn"`. A placeholder
was never a real withdrawn player, so this text is nonsensical no matter whose pick
timing happens to trip the check.

**Real fix: don't let a qualifier placement enter this code path at all.** Both
branches in `data.js` now guard on `isPlaceholderName(m.replaced_name)` and skip
the match entirely (no alert push, no clearing) when true:
```js
if (m.winner || !m.roster_changed_at || isPlaceholderName(m.replaced_name)) return
```
This needs no new column — `replaced_name` already unambiguously distinguishes the
two cases: a real withdrawal always stamps a real player's name, a qualifier
placement always stamps the placeholder (`_applyQualifierPlacement` in
`commissioner-qualifiers.js` sets `replaced_name = oldName`, and `oldName` is by
definition `Qualifier <position>` for bucket A). No timing dependency, no "did the
RPC happen to touch this row" edge case — bucket A matches are unconditionally
exempt from the per-match `rosterAlerts` mechanism, full stop. The draw-level
`showQualifiersPlacedModal` (see above) remains the only alert a player sees for a
qualifier placement.

## Two-draws-at-once alert bugs — fixed 2026-08-30

Both notification checks (`showRosterAlerts`, `showQualifiersPlacedModal`) were
written when the app only ever had one draw open in a session's mental model, then
never revisited once MS/WS became two simultaneous active draws with independent
realtime channels. Two related bugs, found together:

**Bug 1 — single ack column couldn't remember two draws at once.**
`profiles.qualifiers_ack_key` stored exactly one `draw_id@timestamp` value across
ALL draws. With MS and WS each producing their own independent qualifier-placement
event, acking one draw's popup silently overwrote the ack for the other — confirmed
live in the `profiles` table, every player who'd dismissed the popup had only one of
the two draws' keys saved, never both. A player who checked both draws got stuck
re-seeing whichever popup's ack got clobbered, indefinitely.

Fix: `profiles.qualifiers_ack_key` (text, one value) replaced with
`profiles.qualifiers_ack_keys` (jsonb, default `'{}'`, shape
`{ "<draw_id>": "<draw_id>@<timestamp>" }` — the draw_id is redundant inside the
value but keeps the value format identical to before, minimizing the diff).
Migration `qualifiers_ack_keys_per_draw` backfilled the new column from the old one
(`split_part(qualifiers_ack_key, '@', 1)` → key) before dropping the old column —
no data loss for existing acks. `fetchProfile()` (`auth.js`) selects
`qualifiers_ack_keys`; `showQualifiersPlacedModal(d)` (`main.js`) checks
`state.currentUser?.qualifiers_ack_keys?.[d.db_id] === key` and, on dismiss, patches
`state.currentUser.qualifiers_ack_keys = { ...prev, [d.db_id]: key }` before
persisting the whole map back via `supabase.from('profiles').update({
qualifiers_ack_keys: ... })`. No lock-gating added — showing this once per draw
regardless of lock state was already fine and stays that way.

**Bug 2 — neither check ever re-ran on tab switch or live update.**
Both functions were only ever called from `showBracketScreen()`, against whatever
`activeDraw()` was at that exact moment — i.e. only at bracket-screen entry. Neither
re-ran when:
- the player flipped the M/W segmented control (`switchTab(i)`) — switching onto a
  draw with a pending alert showed nothing until leaving and re-entering the
  bracket screen entirely.
- a realtime rebuild happened while the player was already sitting on the bracket
  screen (`_realtimeRebuild()`, the debounced rebuild-tier callback from
  `.claude/rules/realtime.md`) — this reloads the draw and repaints the bracket (a
  swapped-in player's name does appear) but never re-ran either alert check. This is
  what most likely ate a live lucky-loser withdrawal notification: the swap landed
  while the draw was already open, the bracket silently updated, and no popup fired.

Fix: `switchTab(i)` and `_realtimeRebuild()` (both in `main.js`) now both call
`showRosterAlerts(d)` and `showQualifiersPlacedModal(d)` for whichever draw is now
active, at the end of their existing render sequence. No new ack mechanism needed —
`_rosterAlertsAcked` (in-memory Set) and `qualifiers_ack_keys` (Bug 1's persisted
per-draw map) already guard against re-showing something already acknowledged, so
calling these functions more often is safe by construction; nothing was added to
suppress duplicates because nothing new could occur.

**Deliberately NOT wired into the patch tier.** `patchMatchScore`
(`bracket.js`, the realtime patch-tier callback for a bare score/`espn_state` tick)
fires far more often than a rebuild — up to once a minute per live match — and never
calls either alert check, on purpose. Only `_realtimeRebuild()` (the debounced
rebuild-tier callback, which fires on an actual `winner`/lock/draw-state change, not
a score tick) triggers them. Wiring alert checks into the patch tier would run the
popup-suppression logic dozens of times a minute during live scoring for zero
benefit — a roster swap or qualifier placement is a rebuild-tier event, never a
patch-tier one.

**Known, accepted gap — not fixed here.** Realtime is scoped to only the currently
active draw's channel (`_startRealtimeForActiveDraw`), so a live change on the
*other* (non-selected) draw still won't push anything until the player actually
switches tabs. `switchTab`'s new call covers that moment — the player will see the
alert the instant they flip to the other draw — but there's no live push while
they're sitting on the wrong tab. Widening realtime to subscribe to both draws
simultaneously was explicitly out of scope for this fix.

## Files touched

- `src/player-names.js` — new. `isPlaceholderName`, `displayName`.
- `src/parser.js` — Bug A/B fixes, `validateParsedDraw`.
- `src/commissioner.js` — upload validation uses `validateParsedDraw`; 4 call sites
  wired to `renderReuploadSection`; `renderPickCompletion` exported.
- `src/commissioner-results.js` — `applyPlayerSwap` extracted from
  `confirmEditPlayer` (behavior-preserving refactor), exported.
- `src/commissioner-qualifiers.js` — new. Re-upload UI, diff, safety gates,
  bucket A/B apply paths.
- `src/data.js` — `qualifiers_placed_at` selected/assembled/threaded through
  `reloadActiveDraw`; both `rosterAlerts` branches skip matches where
  `replaced_name` is a placeholder (see "Pre-lock-only assumption" above).
- `src/main.js` — `showQualifiersPlacedModal`, wired into `showBracketScreen`'s
  active-draw branch alongside `showRosterAlerts`; ack persisted via
  `profiles.qualifiers_ack_keys` (per-draw map, not a single flat value — see
  "Two-draws-at-once alert bugs" above), not an in-memory Set. Both alert checks
  also now re-run from `switchTab()` and `_realtimeRebuild()`, not just
  bracket-screen entry.
- `src/auth.js` — `fetchProfile()` selects `qualifiers_ack_keys`.
- `index.html` — `#qualifiers-placed-modal`, `#comm-reupload-wrap`.
- `src/bracket.js`, `src/viewer-bracket.js`, `src/print.js`, `src/picks.js`,
  `src/leaderboard-slams.js` — `displayName()` wired into every player-facing name
  render site (see table above).
- DB migrations: `add_qualifiers_placed_at_to_draws`, `add_place_qualifiers_rpc`,
  `add_qualifiers_ack_key_to_profiles`.
