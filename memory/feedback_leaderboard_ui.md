---
name: feedback-leaderboard-ui
description: Leaderboard UI conventions — column labels, color rules, layout decisions confirmed by Ben
metadata:
  type: feedback
---

Use "Draw Yld" / "Match Yld" as column header labels throughout all leaderboard tables. Never use the full names ("Draw Yield", "Match Yield") as column headers — they don't fit in 72px columns. Full names are fine for card titles and the stats bar.

**Why:** Full names wrap to two lines in narrow grid columns, which misaligns headers with data and looks inconsistent across the leaderboard.

**How to apply:** Any time you add or update a leaderboard table column, use the abbreviated form. Full names stay in card-level headings (`.lb-rec-card-title`, stats bar pills, etc.).

---

Match Yield values in the Slams summary card should be plain text — **no green/red color coding**.

**Why:** Color-coded positive/negative values in a table make it feel like a live P&L dashboard. Ben prefers neutral presentation for the summary card; color is distracting here.

**How to apply:** Only suppress color in the summary card. Detail view and records cards can remain neutral too (no color was requested there either).

---

Records tab Match Yield card: show **both Avg and Total** columns simultaneously as a sortable table. No toggle buttons (Avg / Best or similar).

**Why:** Toggles hide information that can fit on screen. Ben prefers seeing both values at once, sortable like the other detail columns.

**How to apply:** `buildMatchYieldCard` uses a two-column sortable table. Sort state in `recMySort`. Both `avgMatchYield` and `totalMatchYield` are computed in `buildAllTimeAgg`.

---

Records tab "Top Brackets" card is now called **"Top Draws"**. It shows Draw Yld and Match Yld as sortable columns (not just a single score value).

**Why:** "Brackets" is an American football term. "Draws" matches the tennis terminology used throughout the app. The dual-column sortable format makes it more useful for comparison.
