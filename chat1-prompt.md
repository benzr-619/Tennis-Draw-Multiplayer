# Chat 1 — Foundation Build

## Context

You are building the multiplayer version of Slam Bracket, a Grand Slam tennis pick pool app. This is a Vite + vanilla JS project (no framework) backed by Supabase for auth and database. The single-player reference implementation is in `reference/index.html` — port logic, CSS, and rendering from there rather than rewriting from scratch.

Read `CLAUDE.md` and `context.md` in full before writing any code. They are the source of truth for architecture, conventions, and design decisions.

The Supabase database tables already exist (run from `migrations.sql`). You have:
- `profiles` (id, display_name, is_commissioner)
- `draws` (slam, draw_type, year, original_picks_locked)
- `matches` (draw_id, round_index, match_index, p1_name, p1_seed, p2_name, p2_seed, winner, score)
- `picks` (user_id, draw_id, match_id, pick, original_pick, result, high_confidence, edited_after_lock)
- `lock_schedules` (draw_id, round_index, match_index_start, match_index_end, lock_type, scheduled_at, locked_at)

Supabase credentials are in `.env.local` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

---

## What to Build in This Chat

### 1. Project scaffold

Set up Vite with the module structure defined in `CLAUDE.md` section 3 (Module Map). Create all source files as stubs first, then fill them in.

`index.html` should have all screen divs (`screen-auth`, `screen-bracket`, `screen-commissioner`, `screen-leaderboard`, `screen-viewer`) present but only `screen-auth` and `screen-bracket` need to be functional after this chat.

### 2. Auth screen (`screen-auth`)

- Email/password login form
- Email/password + display name signup form (toggle between the two)
- On successful login/signup: fetch the user's `profiles` row, store in `state.currentUser`, navigate to `screen-bracket`
- On load: check for existing Supabase session; if found, restore it and navigate directly to bracket

### 3. Bracket screen (`screen-bracket`) — core

Port the following from `reference/index.html` verbatim or near-verbatim:
- Full CSS design system (all `:root` tokens, slam themes, card styles, stats bar styles)
- `renderBracket()` and `placeCard()` with SVG connectors
- `renderStats()` and all four stat pills (Score, Draw Accuracy, Match Accuracy, Draw Health)
- Slam dropdown + M/W segmented control (`renderHeader()`, `renderSlamDropdown()`, `switchTab()`)
- Player search (`runSearch()`, keyboard nav, ⌘F shortcut)
- Print (`buildPrintHTML()`)
- High-confidence star flag

### 4. Data loading

On bracket screen load:
1. Fetch all `draws` from Supabase
2. For the active draw, fetch all `matches`
3. Fetch all `picks` for the current user + active draw
4. Assemble into the local `state.draws` structure (same shape as reference app's state)
5. Call `renderBracket()` and `renderStats()`

Assembly function must apply defensive defaults for all nullable fields (`pick ?? null`, `edited_after_lock ?? false`, etc.) — see CLAUDE.md section 13 ("migrateState() equivalent").

### 5. Pick-making

Port pick cascade logic from reference app:
- `handlePickClick()`, `placePickAllRounds()`, `clearPickForward()` — pre-lock behavior unchanged
- After any pick change: upsert to Supabase `picks` table, then `renderStats()`, then `renderBracket()`
- Pre-lock vs. post-lock semantics unchanged (see CLAUDE.md section 7)

### 6. Lock awareness (read-only for this chat)

Read `lock_schedules` for the active draw on load. Expose a helper `isMatchLocked(ri, mi)` that returns true if a match falls within a triggered lock schedule. Use this in `placeCard()` to disable pick interaction on locked matches. (Commissioner lock triggering is built in Chat 2.)

### 7. Winner display (read-only for this chat)

If `matches.winner` is set, display it on the card and propagate `elim` state forward via `markLoserForward()`. Commissioner result confirmation is built in Chat 2 — for now, just render what's already in the database.

---

## What NOT to Build in This Chat

- Commissioner screen (Chat 2)
- Leaderboard screen (Chat 3)
- Lock countdown on stats bar (Chat 4)
- Backup pick glow highlighting (Chat 4)
- API sync (Chat 4)

Stub out `screen-commissioner` and `screen-leaderboard` with placeholder "Coming soon" text so navigation links can exist without errors.

---

## Output

A working Vite project in the current folder. Running `npm run dev` should:
1. Show the auth screen
2. Let you log in / sign up
3. Show the bracket screen with draws loaded from Supabase
4. Let you make picks that save to Supabase
5. Look visually identical to the reference app (same fonts, colors, card layout, stats bar)

At the end of this chat, draft updated prompts for Chat 2, Chat 3, and Chat 4 based on what was actually built — the module names, function signatures, and any schema discoveries. Replace the skeleton prompts in `chat2-prompt.md`, `chat3-prompt.md`, and `chat4-prompt.md`.
