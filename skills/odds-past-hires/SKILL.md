---
name: odds-past-hires
description: Find successful historical candidates for each odds internship/entry job (newest first) - people who held this exact role at this employer before, or an adjacent role (stating which role and department) - with their full work history and education. Use when asked for past hires, successful candidates, "who got this job before", or role-holder examples per job.
---

# Successful historical candidates per job

## Table and order (always)

Table: the view **`active_internship_entry_english`** in the odds database: internship and entry-level jobs that are still open and do not
need Dutch. Scope: jobs posted in the last 30 days (`--days`), **filled from the newest job to the oldest**, so whatever runs out first
(credit, time) leaves the oldest jobs unfilled. Do not fill other jobs (senior, Dutch, closed, older). Check with `bun coverage.ts`.

Fills `candidate_profiles`, `candidate_experience` (whole work history), `candidate_education`, and `job_candidate_evidence` (one row per
job and person; the app shows validated `exact` and `adjacent` rows):
- `status = 'exact'`: same employer, same level (internship words for an internship, junior/graduate/associate words for an entry job),
  and ≥ 60% of the job's meaningful title words.
- `status = 'adjacent'`: same employer, same level, and some title words **or** a role in the same or a neighbouring department.
  The held role is always stated: `explanation` ("Was "Applications Engineering Intern" at NXP (2009-11 to 2009-12): an adjacent role in
  Hardware & engineering, next to this job's Software engineering."), `previous_experience` (title, employer, start, end) and
  `relevant_history` (relation, held_title, held_department, job_department, title_overlap).

## 0. Before running

1. Repo root, odds repo next to it. Employers need a LinkedIn company page (`odds-company-info` step 2).
2. **Ask the user for their Apify API token**; pass `APIFY_TOKEN=...` on the command line only.

## 1. Run (Apify: Google `apify/google-search-scraper` + `supreme_coder/linkedin-profile-scraper`, ~$0.035 per search)

```bash
bun skills/odds-past-hires/scripts/run.ts --dry                     # the searches, newest jobs first
APIFY_TOKEN=... bun skills/odds-past-hires/scripts/run.ts --limit 30
```
One search per employer, title words and level: Google `site:linkedin.com/in "<company>" ("<title words> intern" OR "… internship" OR "… stagiair" OR
"… trainee")` (entry jobs: junior / graduate / associate / trainee), no location (people move); the top results (`--read 6`) are read in full
(every position with dates) and the rules decide. Searches go in batches (`--batch 10`). Jobs that already have validated evidence are skipped, so re-running continues.
Then run `odds-typesafe-cluster --past-hires`: Jev reads each held role against the posting and corrects exact/adjacent or hides unrelated ones.
`APIFY UNAVAILABLE` (exit 3) → browser route.


## Best route for past hires (measured 13 Oct 2026): LinkedIn people search in the signed-in built-in browser, then Apify verifies

Web search (Google) finds current staff, not the interns who held a role: 5 matches from 125 profiles. LinkedIn's own people search, signed in as the user,
shows exactly them ("Finance Intern at Philips", "AI Intern @ ASML"). Measured: 50% of the profiles read were kept (27 of 50, 10 of 20) and 7-day
past hires (exact or adjacent) went 28.7% -> 36.1% for about $0.4.
1. For a job without past hires: open `https://www.linkedin.com/search/results/people/?keywords=<employer> <role words> intern` (one job at a time).
2. Read the cards with JavaScript (cards are `main [role="listitem"]`; take the first `a[href*="/in/"]` per card; keep cards whose text names the employer).
3. Write `[{ "jobId": "<postings id>", "urls": ["https://www.linkedin.com/in/<slug>/", ...] }]` (up to ~8 per job; skip URLs with `%` in them).
4. `APIFY_TOKEN=... bun skills/odds-past-hires/scripts/read-urls.ts links.json profiles.json` then `bun skills/odds-past-hires/scripts/run.ts --from-file profiles.json`.
   The fixed rules decide exact / adjacent. If the shared-account reader says "no available accounts found", `lib/people.ts` falls back to
   harvestapi/linkedin-profile-scraper in chunks of 10 (free accounts: at most 10 items per run).
5. Free extra: `bun skills/odds-past-hires/scripts/reuse-read.ts <dir>` pools every profile already read and matches it against the other jobs of the same
   employer; then `run.ts --from-file <dir>/reuse.json`. (37.0% -> 43.5% at no Apify cost.) Returns shrink once the big employers are covered: small
   companies and hotels give 0-3 matches per 30 profiles.

## Browser route (LinkedIn, signed in as the user)

For each job the `--dry` run lists:
1. LinkedIn People search: Past company = the employer, Title (past) = the job's title words with intern/junior, any location.
2. Open each profile and copy its Experience and Education exactly, as the actor would return them:
   `{ "linkedinUrl", "firstName", "lastName", "headline", "location": { "linkedinText" }, "photo",
      "experience": [ { "position", "companyName", "companyLinkedinUrl", "startDate": { "month", "year" }, "endDate": { "month", "year", "text" }, "employmentType", "description" } ],
      "education": [ { "schoolName", "degree", "fieldOfStudy", "startDate": { "year" }, "endDate": { "year" } } ] }`
3. Write `[{ "jobId": "<app_jobs.id>", "profiles": [ ... ] }]` and run
   `bun skills/odds-past-hires/scripts/run.ts --from-file profiles.json --dry`, then without `--dry`. The same fixed rules decide.

## Check

`bun coverage.ts` (`past_hires_exact`, `past_hires_exact_or_adjacent`).
