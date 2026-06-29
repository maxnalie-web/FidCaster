---
name: drizzle-kit push TTY requirement
description: drizzle-kit push requires interactive TTY for destructive schema changes; fails in CI/post-merge scripts
---

## Problem
`pnpm --filter db push` (drizzle-kit push) prompts interactively when a migration would:
- Add a UNIQUE constraint to a non-empty table (asks whether to truncate)
- Drop a column with data
- Any other potentially destructive change

In non-TTY environments (CI, post-merge scripts, piped shells), this throws:
```
Error: Interactive prompts require a TTY terminal (process.stdin.isTTY or process.stdout.isTTY is false).
```

## Fix
Use `--force` flag to skip interactive prompts:
```bash
pnpm --filter db push --force
```

**Why:** `--force` tells drizzle-kit to apply all schema changes without confirmation. This is safe in development environments where data loss is acceptable; be careful in production.

## PostgreSQL SQL equivalent
To add a constraint without drizzle in a non-interactive context:
```sql
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'constraint_name'
  ) THEN
    ALTER TABLE tablename ADD CONSTRAINT constraint_name UNIQUE (column);
  END IF;
END $$;
```
Note: `ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS` is **NOT valid PostgreSQL syntax**. Only the DO block approach works.
