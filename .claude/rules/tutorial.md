# Onboarding Tutorial — Design Decisions

Read this before building the new-player tutorial. Design decided 2026-07-06; not
implemented yet (see CLAUDE.md §13 "Not yet built").

## Purpose & Scope

Teaches new players app *mechanics*, not scoring theory: making original picks
pre-lock, reading the different card visual states, making backup/match picks
post-lock, and where to find the Stats Guide drawer for later. Explicitly does
**not** teach scoring formulas, Slam Index, leaderboard tabs, or Match Yield — those
are left for self-discovery via the existing Stats Guide drawer (`.claude/rules/
ui-detail.md`). Reasoning: the drawer already documents that content, and re-teaching
it in a forced walkthrough just delays a new player's first real pick.

**Out of scope for v1:** commissioner-side teaching (draw upload, results
confirmation, lock managing) — there is exactly one commissioner account (Ben), no
onboarding need there.

## Entry Point

Auto-shows on first login for a new player account, plus a permanent **"Tutorial"**
entry in the account menu (`.acct-menu`) so anyone can replay it anytime — label is
"Tutorial", not "Take the tour" (decided 2026-07-06). Needs some persisted flag (e.g.
a `profiles` column) so it doesn't re-trigger automatically after the first time —
exact column/name TBD at build time.

## Sandbox Data Source

Pull a **real completed slam** from Supabase (most recent finished draw) rather than
synthetic players — real names/seeds feel authentic. Reset all `matchPick`/
`originalPick`/`winner` fields to blank in a throwaway in-memory `Draw` object built
just for the tutorial session. This object is never written back to Supabase and
never touches `state.draws`.

**Use a mini sub-bracket, not the full 127-match draw (decided 2026-07-06).** A full
128-player draw is too much to click through end-to-end in a tutorial — the goal is
letting a new player fill out an entire bracket, see a couple of results land, and
make backup picks, all in one sitting. Slice **16 real players** (8 real first-round
matches) out of the chosen slam — names/seeds stay real, but the matchups are just
whichever 8 R1 pairings get sliced out; they don't need to reflect the real
tournament path. This gives 4 rounds total (R1 → R2 → SF → F), enough to feel like a
real bracket without being tedious.

**Confirmed compatible with the real renderer (verified 2026-07-06 by reading
source):** `bracket-layout.js`'s `renderBracketLayout()` derives `total`/`half`/`q`/
`drawRounds` from `rounds[0].matches.length` and `rounds.length` — nothing is
hardcoded to a 64-match first round or 7 rounds. `draw-view.js`'s `buildDrawView()`
loops `for (let ri = 1; ri < rounds.length; ri++)` — fully round-count agnostic.
`picks.js`'s backup-pick cascade checks `nri >= d.rounds.length` the same way. A
16-player (4-round) fake draw runs through the exact same geometry, slot-derivation,
and cascade logic as a real 128-player draw with no special-casing required. Scoring
functions (`ROUND_CONFIG`, `calcStats`, etc.) are never called in the sandbox at all
— out of scope per this doc's Purpose & Scope section — so their 7-round assumption
never comes into play.

## Sandbox Mechanics — Reuse the Real Renderer, Don't Rebuild One

The sandbox must render through the actual `renderBracket`/`placeCard`/
`handlePickClick` pipeline against the fake draw object, with the Supabase-writing
functions no-op'd or redirected to only mutate the local fake object. Do **not** build
a second, simplified bracket UI for teaching purposes — that would violate "one
source of truth" / "no duplicated geometry" (CLAUDE.md §12) and drift from the real
UI over time. The existing `handlePickClick(ri, mi, p, {renderStats, renderBracket})`
/ `applyWinner(...)` callback-based signatures (CLAUDE.md §12 "Key signatures") make
this feasible without circular imports.

## Lock Teaching — Explain the Lifecycle, Don't Simulate Real Time

No fake countdown or "fast forward n days" simulation. Instead the tutorial flips the
sandbox draw directly between an "unlocked" and a "locked" state on a walkthrough
"next" click, to show the resulting visual states side by side:

- Undecided original pick still in play — accent-colored (theme-dependent, see
  "Color note" below), pre-lock
- Eliminated original pick — stays in-card, red + crossed-out, no click handler (see
  `.claude/rules/bracket-rendering.md`)
- Match needing a backup pick — purple glow border + "NO PICK" tag
  (`.needs-backup-pick` / `.mc-no-pick-tag`, see `.claude/rules/lock-conventions.md`)
- Backup pick made — purple styling (`.s-backup`), no slot change

Also teaches: clicking the lock countdown pill navigates to the next unmade pick
(existing `_countdownClickHandler` behavior, `.claude/rules/lock-conventions.md`).

Scheduled-lock mechanics (the commissioner's specific scheduling UI) are deliberately
de-emphasized in the copy — describe the lifecycle generically ("original picks lock
before the tournament; after that you make backup picks as your picks get eliminated,
and each match locks once it starts") rather than teaching today's scheduling screen
as a durable mechanic, since Ben may replace scheduled locks with ESPN
match-start auto-locking later (`.claude/rules/lock-conventions.md` "ESPN Match-Start
Auto-Lock").

## Build Process — Ask Before Assuming (decided 2026-07-06)

Before drafting the step sequence or any copy, the builder should ask Ben plenty of
questions to actually confirm understanding of gameplay — what a new player most
needs to see, which visual states are worth a dedicated step vs. a passing mention,
and what would confuse a first-timer. Don't infer "what's worth highlighting" purely
from reading the code; the code shows what's possible, not what's pedagogically
important for a first-time player. Prefer asking over guessing, even if it means a
long back-and-forth before any step copy gets drafted.

## Copy Review Requirement (decided 2026-07-06)

Every drafted tooltip/step string (welcome text, per-step coach-mark copy, lock-state
explanations, etc.) must be presented to Ben for confirmation or editing before being
wired live into the app — do not ship first-draft copy silently. Practically: draft
all step copy as a reviewable block (e.g. a plain list/table in the PR description or
a scratch file) and pause for explicit sign-off before or alongside wiring it into the
overlay component.

## Mobile

Not excluded, but no dedicated mobile-specific tutorial layout pass planned for v1
either. The coach-mark overlay/arrow must position itself from live
`getBoundingClientRect()` calls on real target elements (never hardcoded desktop
pixel coordinates) — done correctly, this degrades reasonably on narrow viewports as
a side effect, without extra mobile-specific work. Revisit with real phone testing
once built.

## Color / Copy Note

Card state colors (`--accent` for an undecided pick, purple for backup picks, red for
eliminated) are theme-dependent — `--accent` varies per slam (CLAUDE.md §12, SLAM
theme tokens). Whichever slam is pulled as sandbox data determines the actual hue
shown. Tutorial copy should describe states functionally ("your pick, still alive" /
"eliminated" / "needs a backup pick") rather than naming a specific color like "blue,"
since that will be wrong depending on which slam's theme is active.
