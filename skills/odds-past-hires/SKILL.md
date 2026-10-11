---
name: odds-past-hires
description: Find successful historical candidates for each odds internship/entry job (newest first) - people who held this exact role at this employer before, or an adjacent role (stating which role and department) - with their full work history and education. Use when asked for past hires, successful candidates, "who got this job before", or role-holder examples per job.
---

# Successful historical candidates per job

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

## 1. Run (Apify `harvestapi/linkedin-profile-search`, Full mode, ~$0.10 per search of 15 profiles)

```bash
bun skills/odds-past-hires/scripts/run.ts --dry                     # the searches, newest jobs first
APIFY_TOKEN=... bun skills/odds-past-hires/scripts/run.ts --limit 30
APIFY_TOKEN=... bun skills/odds-past-hires/scripts/run.ts --reuse-last   # write the last paid search again (after a failed write)
```
One search per employer, title words and level: people whose past company is this employer and whose past title is the job's words + level
(and the department's main title + level). Jobs that already have validated evidence are skipped, so re-running continues.
Then run `odds-typesafe-cluster --past-hires`: Jev reads each held role against the posting and corrects exact/adjacent or hides unrelated ones.
`APIFY UNAVAILABLE` (exit 3) → browser route.

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
