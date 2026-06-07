---
name: supabase-mcp
description: Supabase MCP connector access — project ID, table list, and how to use the MCP for migrations and SQL instead of manual dashboard work
metadata:
  type: reference
---

# Supabase MCP Access

A Supabase MCP connector is connected. Use it for schema changes, data inspection, and migrations **instead of asking Ben to run SQL manually**.

## Project

- **Name:** Slam Bracket
- **Project ID:** `iocmwiazsbpxjppulwpm`
- **Region:** us-west-1
- **Status:** ACTIVE_HEALTHY

## Tables (public schema, all RLS-enabled)

| Table | Rows (approx) | Key columns |
|---|---|---|
| `profiles` | ~2 | `id` (uuid, FK→auth.users), `display_name`, `is_commissioner` (bool, default false), `created_at` |
| `draws` | ~2 | `id`, `slam` (AO/RG/WIM/USO), `draw_type` (MS/WS), `year`, `created_by`, `original_picks_locked` (bool), `is_active` (bool) |
| `matches` | ~254 | `id`, `draw_id`, `round_index` (0–6), `match_index`, `p1_name`, `p1_seed`, `p2_name`, `p2_seed`, `winner`, `score`, `roster_changed_at` |
| `picks` | ~254 | `id`, `user_id`, `draw_id`, `match_id`, `match_pick`, `original_pick`, `original_pick_result` (correct/wrong), `match_pick_result` (correct/wrong), `high_confidence`, `edited_after_lock`, `notes` |
| `lock_schedules` | ~13 | `id`, `draw_id`, `round_index`, `match_index_start`, `match_index_end`, `lock_type` (original_picks/backup_picks), `label`, `scheduled_at`, `locked_at` |

## MCP Tool Usage

Load tools via ToolSearch before use:
```
ToolSearch: "select:mcp__899b7744-54a6-47e1-a735-2678d4cff41e__list_tables,mcp__899b7744-54a6-47e1-a735-2678d4cff41e__execute_sql,mcp__899b7744-54a6-47e1-a735-2678d4cff41e__apply_migration"
```

Key tools:
- `list_tables` — inspect schema (pass `verbose: true` for columns + FKs)
- `execute_sql` — read queries, data inspection, debugging
- `apply_migration` — DDL changes (ALTER TABLE, CREATE INDEX, etc.) — prefer this over `execute_sql` for schema changes
- `list_migrations` — see what's been applied
- `get_logs` — check Postgres/edge function logs for errors

Always pass `project_id: "iocmwiazsbpxjppulwpm"` to every call.

## When to Use

- **Schema change needed** (add column, new table, new index): use `apply_migration` directly — no need to ask Ben to run SQL in the dashboard.
- **Debugging data issues**: use `execute_sql` to inspect live rows.
- **Verifying RLS**: use `execute_sql` to check `pg_policies`.
- **Checking pg_cron jobs** (fire_scheduled_locks): `execute_sql` → `SELECT * FROM cron.job`.

## RLS Status (confirmed 2026-06-07)

All five tables have RLS enabled. See CLAUDE.md §0 for remaining action (disable legacy anon key).
