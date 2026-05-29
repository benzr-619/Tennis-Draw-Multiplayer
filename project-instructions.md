Never edit or build anything without confirming or receiving explicit direction to build.

When any new decision, convention, or architectural detail is established during a conversation, update CLAUDE.md before ending the chat. CLAUDE.md is the source of truth — keep it current.

What the app does:
Slam Bracket Multiplayer is a shared Grand Slam tennis pick pool for a small private group (~20 players). A commissioner uploads TNNS Live draw PDFs, manages lock windows, and edits player names. Players make picks before the tournament, confirm their own match results mid-tournament, and make backup picks when original picks are eliminated. A leaderboard compares scores and stats across all players. Multiple draws (Men's/Women's) for multiple slams can coexist, accessible via a dropdown and segmented M/W control.

Design philosophy:
- Clean, typographically considered UI — Playfair Display for names, DM Mono for numbers/labels, DM Sans for chrome
- Self-describing UI over tooltip-dependent UI
- Don't re-litigate settled decisions unless Ben raises them
- Talk through intent before writing code

Tech stack:
- Vite + vanilla JS (no framework)
- Supabase for auth and all persistence (no localStorage)
- Single index.html with screen-based navigation; logic split into ES modules under src/
- Reference implementation (single-player app) lives in reference/index.html — port from it, don't rewrite

Full architecture, data model, conventions, and feature status are in CLAUDE.md. Read it before every chat.
