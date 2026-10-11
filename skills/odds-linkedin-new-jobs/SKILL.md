---
name: odds-linkedin-new-jobs
description: Add new internship and entry-level jobs in the Netherlands from LinkedIn to the odds jobs table (app_jobs / postings), newest first, by the app's own intake rules (English, no Dutch, in NL, not closed, no duplicates). Use when asked for more or newer jobs, "pull LinkedIn jobs", or to keep the internship/entry table fresh.
---

# New LinkedIn jobs → odds

## Table and order (always)

Table: the view **`active_internship_entry_english`** in the odds database: internship and entry-level jobs that are still open and do not
need Dutch. Scope: jobs posted in the last 30 days (`--days`), **filled from the newest job to the oldest**, so whatever runs out first
(credit, time) leaves the oldest jobs unfilled. Do not fill other jobs (senior, Dutch, closed, older). Check with `bun coverage.ts`.

Fills: `postings` (the app reads them through `app_jobs`). Only jobs that fit the table are saved: internship or entry level, posting in
English, no Dutch needed, in the Netherlands, open, not held yet. Shared setup, scope and rules: `README.md` at the repo root.

## 0. Before running

1. Work from the repo root (`scrape-skills-odds/`). The odds repo must sit next to it (`../odds-beebalst`) or be named in `ODDS_REPO`:
   the intake rules are imported from it, and `SUPABASE_ACCESS_TOKEN` is read from its `.env.secrets`.
2. **Ask the user for their Apify API token** ("Paste your Apify API token, from apify.com > Settings > API & Integrations").
   Pass it only on the command line (`APIFY_TOKEN=... bun ...`); never write it to a file or repeat it back.

## 1. Run (Apify: `valig/linkedin-jobs-scraper`, ~$0.001 per 10 jobs)

```bash
APIFY_TOKEN=... bun skills/odds-linkedin-new-jobs/scripts/run.ts --since week --dry   # what would be added
APIFY_TOKEN=... bun skills/odds-linkedin-new-jobs/scripts/run.ts --since week         # save
```

- `--since day|week|month` (LinkedIn's "posted in the past …"), `--queries "intern,graduate,..."` (default: intern, internship, graduate,
  junior, trainee, working student, entry level, starter), `--per-query 100`.
- LinkedIn's own filters are applied in the search: location Netherlands, experience level Internship + Entry (`f_E=1,2`).
- The script prints the Apify account and credit first. If it prints `APIFY UNAVAILABLE` (exit code 3), go to the browser route.
- Then, in the odds repo: `sh scripts/after-new-jobs.sh` (field, industry, logo, display audit for the new jobs).

## 2. Check

```bash
bun coverage.ts
```
and look at a few saved rows: `select title, employer, region, posted_on, source from postings where source like 'linkedin_%' order by first_seen desc limit 20`.

## Browser route (Apify unavailable)

1. First try the odds repo's free reader (LinkedIn's public job pages, no login, no Apify):
   `bun scripts/pull-linkedin-public.ts --days 7 --max 200` in the odds repo. It applies the same intake rules and saves.
2. If that is refused too, use the browser (the user's Chrome or the built-in browser). Open, for each query word (intern, internship,
   graduate, junior, trainee, working student):
   `https://www.linkedin.com/jobs/search/?keywords=<word>&location=Netherlands&f_TPR=r604800&f_E=1%2C2&sortBy=DD`
   Go down the list (newest first). For each job card open the job and copy, exactly as shown:
   - `id` (the number in `/jobs/view/<id>` or `currentJobId=<id>`), `title`, `company`, `place`
   - `description`: the full "About the job" text, unchanged
   - `postedOn`: the posting date as YYYY-MM-DD (convert "3 days ago" from today), `applicantsText` (e.g. "Over 100 applicants"),
     `seniority` (the "Seniority level" line), `closed: true` if it says "No longer accepting applications"
3. Save them as a JSON array in a file and run:
   `bun skills/odds-linkedin-new-jobs/scripts/run.ts --from-file jobs.json --dry`, then without `--dry`.

Copy text exactly; do not summarise, translate or rewrite it. A model may only put what was read into the JSON fields.
If LinkedIn shows a login or a check page, ask the user to sign in in that browser, then continue.

## Notes

- Glassdoor and LinkedIn often list the same job under different employer names; `odds-typesafe-cluster --dedupe-jobs` hides the copy.
- `--from-dataset <id>` re-reads an earlier Apify run's items without paying again.
