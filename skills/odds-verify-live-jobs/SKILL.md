---
name: odds-verify-live-jobs
description: Check that the open jobs in odds' table active_internship_entry_english are still live and mark closed ones (postings.closed_at), for LinkedIn jobs that the hourly in-database checker does not cover. Use when jobs look stale, "make sure the database only has live jobs", before filling data, or when last_checked is old.
---

# Verify live jobs

Table: the view **`active_internship_entry_english`**; scope: open LinkedIn jobs posted in the last `--days`, **newest first**, not checked for `--stale-days`.
Why: the hourly in-database checker covers company sites and ATS boards; jobs from LinkedIn, Glassdoor and Indeed were never re-checked (15 Oct 2026: 981 of 1,486 open jobs
unchecked for 2+ days, 108 never). Do not fill data for dead jobs.

```bash
bun skills/odds-verify-live-jobs/scripts/run.ts --dry                    # how many would be checked
APIFY_TOKEN=... bun skills/odds-verify-live-jobs/scripts/run.ts --days 30       # Apify scrapingmonkey/linkedin-job-details-scraper, ~$0.003 per job, batches of 40
bun skills/odds-verify-live-jobs/scripts/run.ts --free --days 30 --limit 1000    # no Apify: LinkedIn's public job page, ~3 s per job, backs off on HTTP 429
```
Result per job: open -> `last_checked = now`, `miss_count = 0`; closed -> `closed_at = now`; no answer -> `miss_count + 1`, closed after 3 misses in a row (LinkedIn sometimes
returns nothing for a live job). The free mode closes a job only when the page says "No longer accepting applications" or is gone (404/410).
Glassdoor and Indeed jobs are not checked here (no public status): report how many are stale. Tokens: the Supabase `sbp_` token (`SUPABASE_ACCESS_TOKEN`) must be valid, ask the owner if you get 401.
After a run: `bun skills/odds-metrics-report/scripts/report.ts` (the job count and percentages move because closed jobs leave the table).
