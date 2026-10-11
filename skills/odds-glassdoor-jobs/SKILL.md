---
name: odds-glassdoor-jobs
description: Add new internship and entry-level jobs in the Netherlands from Glassdoor to the odds jobs table, newest first, by the app's intake rules (English, no Dutch, in NL, no duplicates). Use when asked for more jobs from Glassdoor or to widen the internship/entry table beyond LinkedIn.
---

# New Glassdoor jobs → odds

## Table and order (always)

Table: the view **`active_internship_entry_english`** in the odds database: internship and entry-level jobs that are still open and do not
need Dutch. Scope: jobs posted in the last 30 days (`--days`), **filled from the newest job to the oldest**, so whatever runs out first
(credit, time) leaves the oldest jobs unfilled. Do not fill other jobs (senior, Dutch, closed, older). Check with `bun coverage.ts`.

Fills: `postings` (`ats = 'glassdoor'`). Same intake rules as LinkedIn jobs (`lib/intake.ts`). Shared setup: `README.md`.

## 0. Before running

1. Work from the repo root; the odds repo next to it (`../odds-beebalst`) or in `ODDS_REPO`.
2. **Ask the user for their Apify API token** and pass it as `APIFY_TOKEN=...` on the command line only.

## 1. Run (Apify: `valig/glassdoor-jobs-scraper`, ~$0.001 per 10 jobs)

```bash
APIFY_TOKEN=... bun skills/odds-glassdoor-jobs/scripts/run.ts --days 7 --dry
APIFY_TOKEN=... bun skills/odds-glassdoor-jobs/scripts/run.ts --days 7
```
`--queries` and `--per-query` as in the LinkedIn skill. Glassdoor gives a city without a country: the search is limited to the
Netherlands, so ", Netherlands" is added for the place check. Jobs whose title has no internship/entry word are skipped.
Afterwards run `sh scripts/after-new-jobs.sh` in the odds repo, then `odds-typesafe-cluster --dedupe-jobs` (the same opening is often on
LinkedIn under another employer name, e.g. "Park Plaza Hotels Europe" vs "PPHE Hotel Group").

If the script prints `APIFY UNAVAILABLE` (exit 3), use the browser route.

## Browser route

Open `https://www.glassdoor.nl/Job/netherlands-<word>-jobs-SRCH_IL.0,11_IN178_KO12,<12+len(word)>.htm?sortBy=date_desc&fromAge=7`
(or search Glassdoor jobs for the word with location "Netherlands", sorted by most recent) for each word: intern, internship, graduate,
junior, trainee, working student. For each job open the listing and copy exactly:
`id` (the `jl=` number), `url` (the listing address), `title`, `company`, `place` (city), `description` (full text, unchanged),
`postedOn` (YYYY-MM-DD; "2d" means two days before today).
Save a JSON array and run `bun skills/odds-glassdoor-jobs/scripts/run.ts --from-file jobs.json --dry`, then without `--dry`.
Copy text exactly; never rewrite it. If Glassdoor asks to sign in, ask the user to sign in in that browser.
