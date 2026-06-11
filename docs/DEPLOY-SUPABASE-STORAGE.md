# Supabase Storage — shared local / dev / production

All environments use **one** Supabase project Storage bucket (same as Postgres `DATABASE_URL`).

| Setting | Value (all environments) |
|---------|--------------------------|
| `OBJECT_STORAGE_DRIVER` | `supabase` |
| `SUPABASE_STORAGE_BUCKET` | `gapmc-uploads` |
| `SUPABASE_STORAGE_PREFIX` | `storage` |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` (same project as DB) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key from Supabase Dashboard → API |

Object paths look like: `storage/employees/...`, `storage/dak/inward/...`, etc.

## Local

Set in `.env` (see `.env.example`). Bootstrap:

```bash
npm run storage:ensure-bucket
npm run storage:smoke
```

## Production (AWS ECS)

Add the **same** variables to the ECS task definition or secrets (alongside `DATABASE_URL`):

- `OBJECT_STORAGE_DRIVER=supabase`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET=gapmc-uploads`
- `SUPABASE_STORAGE_PREFIX=storage`

The app **fails startup** if bucket/prefix differ from the standard, or if `SUPABASE_URL` project ref does not match `DATABASE_URL`.

After deploy, check container logs for:

```text
[storage] driver=supabase host=<project-ref>.supabase.co bucket=gapmc-uploads prefix=storage/
```

## Do not

- Use `OBJECT_STORAGE_DRIVER=local` or `s3` in production (legacy only).
- Set `SUPABASE_STORAGE_PREFIX=dev/` or `prod/` — uploads must share one tree.
- Use a different bucket name in ECS than in local `.env`.

## Migrate old disk uploads (one-time)

```bash
npm run storage:migrate-local-to-supabase:dry
npm run storage:migrate-local-to-supabase
```
