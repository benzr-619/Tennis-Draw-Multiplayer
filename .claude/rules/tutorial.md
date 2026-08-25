# Onboarding Tutorial — Design Decisions

Read this before touching the new-player tutorial. Design decided 2026-07-06,
**implemented 2026-07-18** — manual entry point only (see "Implementation" at the
bottom for what shipped and what's still deferred).

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

## Implementation (shipped 2026-07-18; redesigned into two clean phases same week
## after several rounds of testing — see CHANGELOG.md for the full blow-by-blow)

**Two phases, not mashed together.** Earlier versions tried to teach a mechanic and
demonstrate it live in the same breath — e.g. forcing the sandbox to reproduce the
elim → displaced-label transition on cue by injecting a fake pick into a fabricated
SF match. That kept breaking in subtle ways (wrong round targeted, arrows pointing at
stale state, Back not truly reversing) because it was fighting the sandbox's real
mechanics instead of working with them. The shipped version cleanly separates:

1. **Mechanics** (steps 1-5) — make original picks (real, interactive), watch the
   real lock fire (real, interactive), then two cards that show **static examples**
   of what card states look like (elim/displaced, "No Pick") using placeholder names,
   not tied to the live sandbox draw at all.
2. **Gameplay** (steps 6-7) — watch the small real draw actually play out round by
   round: Round 1 resolves for real (genuine history, whatever the player picked)
   and doubles as the practice step (gated on a real match pick), then the rest of
   the draw completes. Nothing here is forced or injected — it just plays out.

**7 steps** (down from 9 after a 2026-07-18 copy pass merged the reveal with its
practice step, and the closing wrap-up with the former standalone "Done" card):
Welcome → Fill out your draw before the tournament (practice, gated on one real
pick) → Original picks lock (animated countdown, real lock fires only on Next) → When
your pick loses (static mockup) → Match picks (static mockup, purely mechanical — no
scoring name-drop here anymore) → Round 1 is over (real reveal, then gates Next on a
real post-lock match pick — merged step) → The rest of the draw plays out (real
reveal; closing line ties Original Picks→Draw Yield and Match Picks→Match Yield
together as the sign-off, "Done" button since it's the last step — merged step).
The single "Match Yield" mention lives in this closing line now, not mid-lesson.

**Sandbox: 8 players / 4 R1 matches / 3 rounds (R1 → SF → F)**, sliced from the most
recently created real draw whose Final has a confirmed winner. `ROUND_LABELS = ['R1',
'SF', 'F']` in tutorial-sandbox.js. Round 1 results are real history
(`r1Winners: Map<match_index, name>`); SF/Final are fabricated pairings with no real
answer, resolved by seed (`autoCompleteDraw()`, better-seed-wins, falls back to `p1`
if neither side has a parseable seed).

**Fake odds — Round 1 only.** `blankMatch()` seeds plausible decimal odds (1.4–3.6) as
both live and locked, but only for matches built with real occupants (Round 1) — blank
SF/Final slots stay oddsless, matching how a real draw never shows odds for a matchup
that doesn't exist yet. Needed because Match Yield (`calcStatsAsOf` in scoring.js)
only scores a resolved match when `odds_p1_locked`/`odds_p2_locked` are non-null;
without this it sat at "—" the whole tutorial regardless of what happened.

**Files:**
- `src/tutorial-sandbox.js` — `buildTutorialDraw()` (slice + seed odds),
  `revealR1Result()` (one real R1 result), `autoCompleteDraw()` (seed-resolve
  everything still undecided, round by round — used for the final "plays out" step).
  Both call the real `buildDrawView()` — no second derivation engine.
- `src/tutorial-overlay.js` — coach-mark UI only: **one fixed tooltip position for
  every step** (`top:50%; right:48px`, vertically centered via `translateY(-50%)`),
  no arrow, no dimming/spotlight, no per-step target tracking at all. This is the
  end state of two earlier, more elaborate approaches that both got walked back:
  1. **Dimming/spotlight** (a dark cutout around a target, or a thin ring for
     practice steps) — dropped because any fixed highlight rect can't bound content
     that overflows its own element's box (e.g. a displaced-pick label floating
     above a card via a negative offset — see `.claude/rules/bracket-rendering.md`).
  2. **Arrow-follows-target positioning** (no dimming, but the tooltip moved next to
     and pointed at whatever each step was discussing, with fallback logic to dodge
     overlapping match cards when there was no target) — this fixed real overlap
     bugs, but Ben's own testing found the *result* — the tooltip jumping to a
     different screen region every step (near the top for targeted steps, near the
     bottom for untargeted ones) — was itself confusing, independent of whether any
     individual position was technically correct. Replaced with the current fixed
     spot: always the same place, so the player learns once where to look next,
     and there's no target-tracking/overlap-avoidance code left to get wrong at all.
- `src/tutorial.js` — orchestrator, the step script, and all sandbox-only side
  effects (countdown animation, synthetic `lock_schedules` rows,
  `document.body.classList.add('tutorial-active')`).

**Reuse-the-real-renderer mechanics:**
- The sandbox draw is temporarily installed at `state.draws = [draw]` /
  `state.activeTab = 0` (saved and restored around the tutorial) so
  `handlePickClick`/`applyWinner` — which read `activeDraw()` internally — operate on
  it unchanged. `bracket.js`'s exported `renderBracket()` already dispatches through
  whatever `main.js` registered via `setRenderBracketFn` at boot, so `tutorial.js`
  never needs to import anything from `main.js`.
- Every sandbox match has `db_id: null`, so `savePickToSupabase`/`applyWinner`'s DB
  block both no-op via their existing `if (!m.db_id) return` / `if (...&& m.db_id)`
  guards — real Supabase writes never happen, with zero monkey-patching needed.
- The "No Pick" purple glow, the post-lock "match picks set for X/Y" countdown, and
  the countdown-click-to-navigate tip are **not reimplemented** — they're the real
  `bracket.js`/`stats.js`/`lock.js` logic, driven entirely by pushing synthetic
  `lock_schedules`-shaped rows into `state.lockSchedules` (never fired — `locked_at`
  stays null forever; only used for the real code's range/next-lock lookups).

**Header lockout.** The M/W toggle, refresh button, and search bar all read/write the
REAL `state.draws` — meaningless for a single fake draw, and refresh in particular
would silently overwrite the sandbox with real data if clicked mid-tutorial. Dimmed to
0.35 opacity and made inert via a `body.tutorial-active` CSS rule for the whole
session, restored on exit (both normal completion and the × close button).

**Back genuinely reverses state.** Every step mutates shared draw state (revealing
results, firing the lock). `stepSnapshots[i]` captures `{rounds, locked,
lockSchedules, postLockSnapshot}` (via `structuredClone`, plus a fresh `Map` copy for
`postLockSnapshot`) the first time step `i` is entered; re-entering that step (forward
or via Back) restores the snapshot before re-running the step's code, so effects
reproduce identically no matter how many times a step is revisited. Backing out of a
practice step (2 or 6) also reverts anything picked while on it — the snapshot
predates those actions too. This is intentional: an honest "back really means back"
rather than a special-cased exception carved out just for practice steps, which would
itself read as a different kind of inconsistency.

**Entry point — manual only.** A "Tutorial" item in the account menu on both the
bracket screen (`#tutorial-btn`) and leaderboard (`#tutorial-btn-lb`), both wired to
`doStartTutorial()` in `main.js` (dynamic `import('./tutorial.js')`, stops
realtime/polling first, restores via `showBracketScreen()` on exit). **Auto-show on
first login for new accounts is explicitly deferred** — needs a persisted "seen" flag
(likely a `profiles` column) and login-flow wiring in `main.js`, both call-outs Ben
asked to be stopped-and-checked-in-on before deciding. Not yet built.

**Verified (2026-07-18)** via repeated Playwright runs against real throwaway
Supabase signups (created and deleted after every run, zero orphaned rows — same
discipline as the realtime.js testing in `.claude/rules/realtime.md`): odds badges
render on Round 1 only, Match Yield displays a real signed number once a resolved
match pick exists, the elim/No-Pick mockups render correctly with zero live-draw
dependency, Round 1 resolves for real with no forcing, the practice gate correctly
credits a match pick made during an earlier step, and Back genuinely restores
pre-lock state (pills, not the post-lock bar) when backing past the lock step. Zero
exceptions from tutorial code across every run — the only errors observed are the
pre-existing, unrelated `realtime.js` bug below.

**Known issue (pre-existing, unrelated to this feature):** `stopBracketRealtime()` in
`src/realtime.js` throws `RangeError: Maximum call stack size exceeded` on a
completely vanilla nav-away/nav-back flow with zero tutorial code involved (confirmed
by reproducing on a fresh signup with no tutorial interaction at all) — looks like the
`.subscribe(status => ...)` kill-switch callback documented in `.claude/rules/
realtime.md` is re-entrant (`removeChannel()` synchronously re-triggers the same
status callback). Flagged as a separate follow-up task, not touched here.
