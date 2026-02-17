# Scheduler / Cron Setup

Scheduling is done via **Supabase cron** (or external cron) calling Edge Functions. There are no app API routes for running scheduled jobs.

Two Edge Functions are intended to be called by **separate cron schedules**:

1. **typesense-sync** – Postgres → Typesense search index
2. **filter-config-refresh** – Refresh filter config options into JSONB (so GET /api/filters is fast)

---

## 1. Typesense sync

- **Function:** `supabase/functions/typesense-sync`
- **URL:** `https://<project-ref>.supabase.co/functions/v1/typesense-sync`
- **Schedule:** Run every few minutes (e.g. every 5–10 min). Each run syncs up to 500 docs and updates the cursor; repeated runs will eventually sync all records.
- **Env (Supabase Edge Function secrets):**  
  `SUPABASE_DB_URL`, `TYPESENSE_HOST`, `TYPESENSE_PROTOCOL`, `TYPESENSE_PORT` (optional), `TYPESENSE_API_KEY`  
  Optional: `TYPESENSE_SYNC_SECRET` – when set, requests must send `Authorization: Bearer <TYPESENSE_SYNC_SECRET>`.
- **Auth:** If `TYPESENSE_SYNC_SECRET` is set, call with `Authorization: Bearer <TYPESENSE_SYNC_SECRET>`. If not set, the function allows unauthenticated calls (set the secret in production).

### How to set the schedule for typesense-sync (cursor runs)

Use one of the options below so the sync runs on a schedule. Each run processes up to 500 docs and updates the cursor; the next run continues from there.

**Option A: External cron (Linux/macOS or server)**

```bash
# Run every 5 minutes (adjust YOUR_PROJECT_REF and auth as below)
*/5 * * * * curl -s -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/typesense-sync" -H "Authorization: Bearer YOUR_TYPESENSE_SYNC_SECRET_OR_SERVICE_ROLE_KEY" -H "Content-Type: application/json"
```

- **YOUR_PROJECT_REF** = from Supabase Project URL (e.g. `abcdefgh` from `https://abcdefgh.supabase.co`).
- Use `TYPESENSE_SYNC_SECRET` as the Bearer token if you set that secret on the function; otherwise you can use the Supabase **service_role** key.

**Option B: Supabase pg_cron + pg_net (inside Postgres)**

1. Enable **pg_cron** and **pg_net** (Database → Extensions).
2. In SQL Editor run (replace URL and auth token):

```sql
SELECT cron.schedule(
  'typesense-sync',
  '*/5 * * * *',   -- every 5 min
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/typesense-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_TYPESENSE_SYNC_SECRET_OR_SERVICE_ROLE_KEY'
    ),
    body := '{}'
  ) AS request_id;
  $$
);
```

**Option C: GitHub Actions**

Add a workflow that runs on a schedule and calls the function (store the auth token as a repo secret, e.g. `TYPESENSE_SYNC_SECRET` or `SUPABASE_SERVICE_ROLE_KEY`):

```yaml
name: Typesense sync
on:
  schedule:
    - cron: '*/5 * * * *'   # every 5 min
  workflow_dispatch:
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Call typesense-sync
        run: |
          curl -s -X POST "${{ secrets.SUPABASE_FUNCTIONS_URL }}/functions/v1/typesense-sync" \
            -H "Authorization: Bearer ${{ secrets.TYPESENSE_SYNC_SECRET }}" \
            -H "Content-Type: application/json"
```

Set repo secrets: `SUPABASE_FUNCTIONS_URL` = `https://YOUR_PROJECT_REF.supabase.co`, and `TYPESENSE_SYNC_SECRET` (same value as the Edge Function secret).

---

## 2. Filter config refresh (separate schedule)

- **Function:** `supabase/functions/filter-config-refresh`
- **URL:** `https://<project-ref>.supabase.co/functions/v1/filter-config-refresh`
- **Schedule:** Use a **separate cron schedule** that only calls this function (e.g. every 15 min, or when properties/property_details change).
- **Env (Supabase Edge Function secrets):**  
  `SUPABASE_DB_URL` (direct Postgres connection string)
- **Auth:** Call with `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.

**What it does:** Loads all active `master.SEARCH_FILTER_CONFIGS` rows, for each runs the same option queries as `mergeFilterOptions` (property count, completion, property types, price/area ranges, features, agents, keywords), merges into `config_json`, and updates the row. GET /api/filters then returns stored JSONB without merging at request time.

---

## How to set the scheduler to call filter-config-refresh

You need a **separate** cron (or timer) that only calls the filter-config-refresh Edge Function. Options:

### Option A: External cron (Linux/macOS or server)

1. Get your **project URL** and **service role key**:
   - Supabase Dashboard → **Project Settings** → **API**: use **Project URL** and **service_role** (secret).
2. Replace placeholders and add a cron job:

```bash
# Run every 15 minutes
*/15 * * * * curl -s -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/filter-config-refresh" -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" -H "Content-Type: application/json"
```

- **YOUR_PROJECT_REF** = from Project URL, e.g. `https://abcdefgh.supabase.co` → use `abcdefgh`.
- **YOUR_SERVICE_ROLE_KEY** = the `service_role` secret (not the anon key).

To test once from the terminal:

```bash
curl -s -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/filter-config-refresh" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"
```

Expected response: `{"ok":true,"updated":2}` (or similar).

### Option B: Supabase pg_cron (inside Postgres)

If your project has **pg_cron** enabled (Database → Extensions):

1. In SQL Editor, run (replace the URL and key):

```sql
SELECT cron.schedule(
  'filter-config-refresh',   -- job name
  '*/15 * * * *',            -- every 15 min
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/filter-config-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
    ),
    body := '{}'
  ) AS request_id;
  $$
);
```

You need the **pg_net** extension for `net.http_post`. If pg_net is not available, use Option A or C.

### Option C: GitHub Actions (or other CI)

Add a workflow that runs on a schedule and calls the function (store the service role key as a repo secret, e.g. `SUPABASE_SERVICE_ROLE_KEY`):

```yaml
name: Refresh filter config
on:
  schedule:
    - cron: '*/15 * * * *'   # every 15 min
  workflow_dispatch:
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - name: Call filter-config-refresh
        run: |
          curl -s -X POST "${{ secrets.SUPABASE_FUNCTIONS_URL }}/functions/v1/filter-config-refresh" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" \
            -H "Content-Type: application/json"
```

Set secrets: `SUPABASE_FUNCTIONS_URL` = `https://YOUR_PROJECT_REF.supabase.co`, and `SUPABASE_SERVICE_ROLE_KEY`.

---

**typesense-sync** and **filter-config-refresh** use separate schedules; set each as above. The typesense-sync cursor will advance on every run until all records are synced.
