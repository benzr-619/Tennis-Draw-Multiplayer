# Multiplayer Design Context

Decisions and constraints captured from the initial design conversation. Read this alongside CLAUDE.md.

---

## Scope & Audience

- One pool, ~20 players, friends and family. Not a commercial product.
- No multiple pools. No public signup. Ben (commissioner) shares the link directly.
- Ben manages forgotten passwords and account issues directly in Supabase dashboard.
- No email or push notifications — Ben texts players when action is needed.
- Designed for desktop/tablet. Mobile layout is not a priority.

---

## Screens

### Auth screen
Standard email/password login + signup. Signup captures a display name (shown on leaderboard). No forgot-password UI — handled in Supabase.

### Bracket screen (main draw view)
Largely the same as the single-player app with these additions:
- Picks save to Supabase instead of localStorage
- Lock countdown on the right end of the stats bar (see Lock Countdown section)
- Backup pick highlights when a lock is upcoming
- All players confirm their own match results using ✓/✗ buttons, identical to the single-player app. Since original picks lock before the tournament starts there is no meaningful way to cheat. Backup pick results are honor system.
- On login, lands on the most recent active (or upcoming) slam. Slam dropdown + M/W segmented control unchanged.

### Commissioner screen
Accessible to commissioner only. Sections:
1. Draw upload + parse (PDF → review R1 → confirm)
2. Player name/seed editing
3. Lock managing (see Lock Managing section below)

The draw upload flow absorbs what was the "upload screen" in the single-player app.

### Leaderboard screen
See Leaderboard Stats section below. Clicking a player's name opens their bracket in read-only viewer mode.

### Viewer (read-only bracket)
Renders the selected player's bracket using their picks. No interactivity. Banner shows whose bracket you're viewing + back button to return to leaderboard.

---

## Stats Bar

Four pills, unchanged from reference app:

| Pill | What it shows |
|---|---|
| Score | baseScore + upset bonus. Shows "vs chalk" diff inline. |
| Draw Accuracy | Correct original picks / total confirmed matches (original picks only) |
| Match Accuracy | Correct picks / total confirmed matches (including backup picks) |
| Draw Health | reachableHealthPts / maxHealthPts — scoring potential still alive |

Draw Health is useful for both active slams (how busted is my bracket?) and completed slams (what % of max did I capture?).

No chalk comparison on the leaderboard.

---

## Leaderboard Stats

**Per-slam view:**
- Rows: one per player
- Columns: Score, Draw Accuracy %, Match Accuracy %, Draw Health %
- MS and WS shown separately (e.g. two sections or a toggle)
- Sortable by any column

**Year-to-date / all-time view:**
- Average score per draw, overall Draw Accuracy %, overall Match Accuracy %
- Count of draws in each player's sample
- Not split by MS/WS

Switching between views: tab or toggle on the leaderboard screen. Previous slams accessible via the existing slam dropdown — leaderboard respects the active slam context.

---

## Lock Countdown & Backup Pick Highlighting

- Countdown clock lives on the right end of the stats bar
- Example display: "picks lock in 14h" or "backup picks lock in 6h"
- Match cards without an active pick that fall within the upcoming lock's range glow purple (same purple as backup pick card styling)
- Countdown text is highlighted (accent color or subtle pulse) until all affected picks are filled
- Applies to both original pick locks (pre-tournament) and backup pick locks (mid-tournament)
- Not a pushy banner — integrated into the existing stats bar pattern

---

## Lock Managing

The commissioner screen has a visual bracket-style view of the draw for managing locks. Two levels:

**Original picks lock** — a single toggle for the whole draw. Locks/unlocks all original pick-making for all players. Can be scheduled with a datetime or triggered immediately. When triggered, snapshots `original_pick` for every user.

**Backup pick locks** — commissioner clicks individual match cards (or drags to select groups) in the bracket view to mark them locked for backup picks. Selected matches can be given a datetime or locked immediately. Locks can be undone per match or per group.

Why visual/manual rather than scheduled-only: tournament draws don't play in neat round-by-round blocks. Each day covers a specific slice of the draw. Rain delays and order-of-play changes make pure scheduling unreliable. The commissioner triggers locks manually, with optional scheduling as a reminder aid. Late-tournament (semis/finals) men's and women's days diverge completely, making per-match-card control essential.

---

## PDF Handling

PDFs are processed entirely client-side (pdf.js, same as reference app). Once parsed into structured data the PDF is discarded — not stored anywhere. No server-side PDF processing.

---

## API Sync (future / Chat 4)

A toggle or button on the bracket screen available to all players. When enabled, pulls match results from an external tennis API and applies them to the player's bracket automatically — an alternative to clicking ✓/✗ manually. Players who prefer to track results manually can ignore the toggle. Exact API TBD — placeholder in the design for now.

---

## What Stays the Same as Reference App

- All scoring logic (ROUND_CONFIG, upset bonus formula, chalk score)
- Bracket render geometry and SVG connectors
- Pick cascade behavior (pre-lock vs. post-lock vs. withdrawal)
- CSS design tokens and slam color themes
- Typography (Playfair Display / DM Mono / DM Sans)
- Print output (A3 portrait, buildPrintHTML)
- Player search with keyboard nav
- High-confidence star flag
- Slam dropdown + M/W segmented control navigation

---

## Tech Stack Decision

Vite + vanilla JS (no framework). The Supabase JS client is an npm package that works cleanly with Vite's ES module build. Code is split into logical modules (see CLAUDE.md Module Map) rather than one large file, making future edits easier. No React, no Vue.

---

## Supabase Setup

See `migrations.sql` for all table definitions. Run in Supabase SQL editor before starting the Chat 1 build. After running migrations, manually set `is_commissioner = true` on Ben's profile row.
