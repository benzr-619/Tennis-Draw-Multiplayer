// Tutorial orchestrator — drives the coach-mark walkthrough against the throwaway
// sandbox draw, reusing the real renderBracket/renderStats pipeline.
// See .claude/rules/tutorial.md for the design brief and copy-review discipline.
//
// Two clean phases (2026-07 redesign), not mashed together:
//   1. Mechanics — make original picks, watch the real lock fire, then a couple of
//      cards that show STATIC EXAMPLES of what card states look like (not tied to
//      the live sandbox draw at all — no forcing a specific pick to bust on cue).
//   2. Gameplay — watch the small real draw actually play out round by round
//      (Round 1 resolves for real, make match picks for real, the rest plays out),
//      completely un-forced. This is the practice; the teaching already happened.

import { state, applyTheme } from './state.js'
import { renderBracket } from './bracket.js'
import { renderStats, resetStatsFilter, fetchPoolSlamIndex } from './stats.js'
import { renderTutorialStep, removeTutorialOverlay, setPrimaryReady } from './tutorial-overlay.js'
import { buildTutorialDraw, revealR1Result, autoCompleteDraw } from './tutorial-sandbox.js'

const STEP_COUNT = 7
let _active = false

function _showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  document.getElementById(id)?.classList.add('active')
}

// Static illustrative mockups — real CSS classes, fake names, never touch the live
// sandbox draw. Position overrides are needed because the real classes assume
// absolute positioning inside a live `.mc` card; here they're just stacked in flow.
function _elimMockupHTML() {
  return `
    <div class="tut-mockup-label">Before we know who won the other half:</div>
    <div class="mc" style="position:static;width:210px;margin:4px auto 12px">
      <div class="pr s-orig-wrong" style="position:relative"><span class="pr-name">Your Pick</span></div>
      <div class="pr" style="position:relative"><span class="pr-name">—</span></div>
    </div>
    <div class="tut-mockup-label">Once that's confirmed:</div>
    <div class="mc" style="position:static;width:210px;margin:4px auto 0">
      <div class="mc-orig-elim mc-orig-elim-top" style="position:static;margin-bottom:2px">Your Pick</div>
      <div class="pr s-orig" style="position:relative"><span class="pr-name">Real Winner</span></div>
      <div class="pr" style="position:relative"><span class="pr-name">—</span></div>
    </div>`
}

function _noPickMockupHTML() {
  return `
    <div class="mc needs-backup-pick" style="position:static;width:210px;margin:10px auto 0">
      <div class="mc-no-pick-tag" style="position:static;display:table;margin:0 auto 6px">No Pick</div>
      <div class="pr" style="position:relative"><span class="pr-name">Player A</span></div>
      <div class="pr" style="position:relative"><span class="pr-name">Player B</span></div>
    </div>`
}

function _snapshotOriginalPicks(draw) {
  draw.rounds.forEach(r => r.matches.forEach(m => { m.originalPick = m.matchPick }))
}

// Synthetic lock_schedules-shaped rows so the real card glow / countdown-fraction /
// "No Pick" tag logic (all keyed on state.lockSchedules) lights up naturally against
// the sandbox — never fired (locked_at stays null), just used for range/next-lock
// lookups exactly like real scheduled-but-not-yet-triggered rows.
function _pushSyntheticBackupLocks(draw) {
  const now = Date.now()
  for (let ri = 1; ri < draw.rounds.length; ri++) {
    state.lockSchedules.push({
      draw_id: draw.db_id, lock_type: 'backup_picks', round_index: ri,
      match_index_start: 0, match_index_end: 999,
      scheduled_at: new Date(now + ri * 86400000).toISOString(), locked_at: null,
    })
  }
}

/**
 * Starts the tutorial: swaps state.draws/lockSchedules for the sandbox, walks the
 * coach-mark script, then restores real state and calls onExit(). Safe to call from
 * either the bracket or leaderboard account menu.
 */
export async function startTutorial({ onExit }) {
  if (_active) return
  _active = true

  const built = await buildTutorialDraw()
  if (!built) {
    _active = false
    alert('No completed slam is available yet to build the tutorial from.')
    return
  }
  const { draw, r1Winners } = built

  const savedDraws = state.draws
  const savedActiveTab = state.activeTab
  const savedLockSchedules = state.lockSchedules

  state.draws = [draw]
  state.activeTab = 0
  state.lockSchedules = []
  applyTheme(draw.slam)
  resetStatsFilter()
  _showScreen('screen-bracket')
  const nameEl = document.getElementById('slam-name-label')
  if (nameEl) nameEl.textContent = 'Tutorial'
  // M/W toggle, refresh, and search all read/write the REAL state.draws — meaningless
  // for a single fake draw, and refresh in particular would silently clobber the
  // sandbox with real data mid-tutorial if left live. Dimmed + inert via CSS for the
  // whole session (see index.html "body.tutorial-active" rules).
  document.body.classList.add('tutorial-active')
  renderStats(); renderBracket()

  let idx = 0
  let countdownTimer = null
  let gateTimer = null
  let postLockSnapshot = null // Map<"ri-mi", matchPick> captured the instant the lock fires

  // Back needs to actually go back, not just re-show a card while every mutation a
  // step made (a lock firing, results revealing) stays in effect underneath — that
  // was confusing/dishonest (found by testing: revisiting a pre-lock step after
  // locking still showed the post-lock bar). Fix: snapshot the mutable state the
  // first time each step is entered, and restore it whenever that step is re-entered
  // (forward OR back) before re-running the step's own code — so a step's effects
  // always reproduce identically and Back truly undoes everything after it.
  const stepSnapshots = new Array(STEP_COUNT).fill(null)
  function _snapshot() {
    return {
      rounds: structuredClone(draw.rounds),
      locked: draw.locked,
      lockSchedules: structuredClone(state.lockSchedules),
      postLockSnapshot: postLockSnapshot ? new Map(postLockSnapshot) : null,
    }
  }
  function _restore(snap) {
    draw.rounds = snap.rounds
    draw.locked = snap.locked
    state.lockSchedules = snap.lockSchedules
    postLockSnapshot = snap.postLockSnapshot
  }

  function clearTimers() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
    if (gateTimer) { clearInterval(gateTimer); gateTimer = null }
  }

  function finish() {
    clearTimers()
    _active = false
    document.body.classList.remove('tutorial-active')
    removeTutorialOverlay()
    state.draws = savedDraws
    state.activeTab = savedActiveTab
    state.lockSchedules = savedLockSchedules
    onExit?.()
  }

  function goTo(i) {
    clearTimers()
    if (i < 0) i = 0
    if (i >= STEP_COUNT) { finish(); return }
    if (stepSnapshots[i]) _restore(stepSnapshots[i])
    else stepSnapshots[i] = _snapshot()
    idx = i
    renderStats(); renderBracket()
    STEPS[i]()
  }
  const next = () => goTo(idx + 1)
  const back = () => goTo(idx - 1)

  // opts.onPrimary, if given, runs immediately before advancing — e.g. step 3 uses
  // this to actually apply the lock only once the user clicks Next, not the instant
  // the cosmetic countdown animation happens to reach zero on its own.
  function step(opts) {
    const onPrimary = opts.onPrimary ? () => { opts.onPrimary(); next() } : next
    renderTutorialStep({ ...opts, onPrimary, index: idx, total: STEP_COUNT, onSkip: finish, onBack: idx > 0 ? back : undefined })
  }

  // Renders a practice step (real draw stays obviously live/clickable) whose Next
  // button renders greyed-out/inert until isReady() goes true — polled, not
  // event-driven, since picks flow through the real handlePickClick pipeline with no
  // hook to tap. Gates on a single real pick, not a fully filled-out draw — nobody
  // should have to finish the whole bracket just to prove they get the mechanic.
  function practiceStep(opts, isReady) {
    step({ ...opts, primaryDisabled: true })
    gateTimer = setInterval(() => {
      if (!isReady()) return
      clearTimers()
      setPrimaryReady()
    }, 300)
  }

  const STEPS = [
    // 1 — Welcome
    () => step({
      title: 'Welcome to Slam Bracket!',
      body: "8 real players from a past Slam, 3 rounds — enough to see how picks, locks, and card states work.",
    }),

    // 2 — Fill out your draw before the tournament (practice: gated on a real pick).
    // Pre-lock, a click only sets matchPick — originalPick doesn't exist until the
    // lock snapshot in step 3, so gating on originalPick here would never unlock. No
    // target/arrow: an earlier version pointed at the whole stats bar, but the arrow
    // landed on meaningless space between the pick counter and the countdown (on
    // opposite ends of the bar) — dropped rather than fixed onto a single spot that
    // wouldn't represent either. Pushes the real original_picks lock_schedules row now
    // (a generous 10-minute window, not yet the rapid countdown) so the countdown
    // pill referenced in step 3 actually exists to shrink and animate later.
    () => {
      state.lockSchedules.push({ draw_id: draw.db_id, lock_type: 'original_picks', scheduled_at: new Date(Date.now() + 600000).toISOString(), locked_at: null })
      renderStats()
      practiceStep({
        title: 'Fill out your draw before the tournament',
        body: "Once the draw comes out, tap players to win to set your Original Picks predictions.",
      }, () => draw.rounds[0].matches.some(m => m.matchPick))
    },

    // 3 — Original picks lock. The pill's real display is hours:minutes (built for
    // genuine multi-day production countdowns — see stats.js buildCountdownEl), which
    // would just sit frozen at "00:00" for a short demo window instead of visibly
    // ticking. So this step overwrites the pill's text directly with a seconds
    // countdown, purely cosmetic, every 200ms; the real lock (snapshot +
    // draw.locked=true) is deliberately NOT tied to the timer reaching zero — it only
    // happens when the user clicks Next, so the tooltip's copy and the app's actual
    // state never fall out of sync while someone lingers on this step reading it.
    () => {
      const COUNTDOWN_SECS = 15
      const origSched = state.lockSchedules.find(ls => ls.draw_id === draw.db_id && ls.lock_type === 'original_picks')
      const scheduledAt = Date.now() + COUNTDOWN_SECS * 1000
      if (origSched) origSched.scheduled_at = new Date(scheduledAt).toISOString()
      renderStats() // rebuilds #stats-strip — must happen before the countdown tick can query the pill
      step({
        title: 'Original picks lock',
        body: "When play starts on the first day of the tournament, your original picks freeze — that's the bracket your Draw Yield is judged against.",
        onPrimary: () => {
          clearTimers()
          _snapshotOriginalPicks(draw)
          draw.locked = true
          state.lockSchedules = state.lockSchedules.filter(ls => ls.lock_type !== 'original_picks')
          _pushSyntheticBackupLocks(draw)
          postLockSnapshot = new Map()
          draw.rounds.forEach((r, ri) => r.matches.forEach((m, mi) => postLockSnapshot.set(`${ri}-${mi}`, m.matchPick)))
          renderStats(); renderBracket()
        },
      })
      const tick = () => {
        const secsLeft = Math.max(0, Math.ceil((scheduledAt - Date.now()) / 1000))
        const val = document.querySelector('#stats-strip .countdown-pill .sval')
        if (val) val.textContent = `00:${String(secsLeft).padStart(2, '0')}`
        if (secsLeft <= 0 && countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
      }
      tick()
      countdownTimer = setInterval(tick, 200)
    },

    // 4 — When your pick loses. Pure static teaching example (2026-07 redesign) — no
    // longer tries to force this exact transition to happen live on cue by injecting
    // a fake pick into a fabricated SF match. Centered, no target: this is teaching a
    // concept before it's been seen, not pointing at something on screen yet.
    () => step({
      title: 'When your pick loses',
      bodyHTML: `If your original pick loses, it stays crossed out in red until we know who actually made that round. Eventually, the actual outcome takes the slot and your pick floats above it as a reminder of your call.<div class="tut-mockup">${_elimMockupHTML()}</div>`,
    }),

    // 5 — Match picks. Also a static teaching example, merged with the old standalone
    // "No Pick" step (splitting an abstract explanation from its concrete example one
    // step later was weaker teaching and cost an extra click for no gain). The Match
    // Yield name-drop moved to the closing step (7) — this one stays purely mechanical.
    () => step({
      title: 'Match picks',
      bodyHTML: `During the tournament, even though your original picks are locked, you can still make match picks. Match picks stay open until each match starts. A purple glow means you have no match pick set for that match — even if your original pick is still alive, you can change your mind.<div class="tut-mockup">${_noPickMockupHTML()}</div>`,
    }),

    // 6 — Round 1 is over (merged with the old standalone practice step — 2026-07
    // copy pass). Gameplay: reveals Round 1 for real (whatever actually happened, no
    // matter what the player picked), then gates Next on a real post-lock match pick
    // made ANY time since the lock fired — steps 4-5 are watch-only but still fully
    // clickable, so a curious player who picks ahead of schedule should still get
    // credit rather than being asked for a second, redundant pick right here.
    // Compares live matchPick values against postLockSnapshot (captured the instant
    // step 3's lock fires) rather than "does this match still need a pick" at THIS
    // step's entry — an earlier version of this gate missed picks made during
    // earlier watch steps.
    () => {
      draw.rounds[0].matches.forEach((m, mi) => revealR1Result(draw, mi, r1Winners))
      renderStats(); renderBracket()
      practiceStep({
        title: 'Round 1 is over',
        body: "Round 1 winners have been confirmed — go ahead and make match picks for Round 2.",
      }, () => {
        if (!postLockSnapshot) return true // safety net, should never happen post-step-3
        let changed = false
        draw.rounds.forEach((r, ri) => r.matches.forEach((m, mi) => {
          if (m.matchPick !== postLockSnapshot.get(`${ri}-${mi}`)) changed = true
        }))
        return changed
      })
    },

    // 7 — The rest of the draw plays out, merged with the old standalone "Done" step
    // (2026-07 copy pass) — the closing summary line doubles as the sign-off, so a
    // separate card just to say "you're ready" was redundant. Auto-completes SF and
    // the Final (Round 1 is already decided) — one more un-forced real reveal. Last
    // step in STEPS, so the primary button reads "Done" automatically (see step()).
    () => {
      autoCompleteDraw(draw)
      resetStatsFilter()
      renderStats(); renderBracket()
      fetchPoolSlamIndex(draw, state.currentUser?.id).then(() => renderStats())
      step({
        title: 'The rest of the draw plays out',
        body: "And that's the whole loop: Original Picks score the Draw Yield, Match Picks score the Match Yield. Replay this tutorial anytime from the account menu.",
      })
    },
  ]

  goTo(0)
}
