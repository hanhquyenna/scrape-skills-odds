---
name: odds-outreach-contacts
description: Find people to reach out to for each odds internship/entry job (newest first) - the hiring managers in the job's department first, then everyone in that department who is not senior, then the adjacent departments, plus recruiters - and link them to each job ranked. Use when asked for outreach contacts, hiring managers, referral contacts, recruiters or "who to message" per job.
---

# Outreach contacts per job

## Table and order (always)

Table: the view **`active_internship_entry_english`** in the odds database: internship and entry-level jobs that are still open and do not
need Dutch. Scope: jobs posted in the last 30 days (`--days`), **filled from the newest job to the oldest**, so whatever runs out first
(credit, time) leaves the oldest jobs unfilled. Do not fill other jobs (senior, Dutch, closed, older). Check with `bun coverage.ts`.

Fills:
- `job_people` (per employer): name, LinkedIn URL, current title, place, photo; `jev.role` = `hiring_manager` | `peer` |
  `adjacent_manager` | `adjacent_peer` | `recruiter`, `jev.department` = the standard department searched.
- `job_outreach_contacts` (per job): every contact of the job's employer with a `rank` - 1 hiring manager in the job's department,
  2 peer (same department, not senior), 3 adjacent-department manager, 4 adjacent-department peer, 5 recruiter (+2 when the stored
  department is not the job's).

Order of the search for each employer and department (newest jobs first):
1. **Hiring managers**: Google `site:linkedin.com/in "<company>" ("<dept word> manager" OR "head of <dept word>" OR "<dept word> lead" OR "<dept word> director") Netherlands`.
2. **Same department, not senior**: the department words (plus junior / associate / specialist); anyone whose current title says senior, lead, manager… is left out.
3. **Adjacent departments**: when 1 or 2 found nobody, the same search in the nearest department (`adjacentDepartments`).
4. **Recruiters**: once per employer (recruiter, talent acquisition, HR business partner, early careers, campus, people partner).

The top results of each query (`--read 6`) are read in full and kept only by fixed rules: a current position (no end date) at this employer
(name or LinkedIn page), in the Netherlands, and that position's title fits the role. Queries and profiles go in batches (`--batch 8`).
Do not use `harvestapi/linkedin-profile-search`: free accounts get 10 runs, then it returns nothing.
Then `odds-typesafe-cluster --people` checks each person again (NL, works there, department, seniority).

## 0. Before running

1. Repo root, odds repo next to it. Employers need a LinkedIn company page: run `odds-company-info` step 2 first for new employers.
2. **Ask the user for their Apify API token**; pass `APIFY_TOKEN=...` on the command line only.

## 1. Run (Apify: Google `apify/google-search-scraper` finds people, `supreme_coder/linkedin-profile-scraper` reads their profiles; ~$0.055 per pair)

```bash
bun skills/odds-outreach-contacts/scripts/run.ts --dry                    # the employer-and-department pairs, newest first
APIFY_TOKEN=... bun skills/odds-outreach-contacts/scripts/run.ts --limit 50
bun skills/odds-outreach-contacts/scripts/run.ts --link-only              # re-link contacts to jobs (free)
```
Pairs already searched are skipped, so re-running continues where the last run stopped (e.g. when credit ran out).
`APIFY UNAVAILABLE` (exit 3) → browser route.

## 1b. Fastest and cheapest (measured 12-13 Oct 2026): find with web search, read with Apify

Apify's Google step and its wide profile reads are the slow, costly part (about $0.50 per percentage point, many searches find nobody).
Finding people with the agent's own free web search (`site:linkedin.com/in <Company> "<title word>" <city>`) and sending only the
shortlist to Apify gave 61% kept people (~$0.008 per kept person) and moved 7-day coverage from 33% to 60% of jobs with contacts.
1. Split the work into lists and give each to a helper agent (see `skills/odds-fill-table/SKILL.md`, "Parallel route"): they only write link files.
2. `bun skills/odds-fill-table/scripts/merge-links.ts <dir>` -> `merged_people.json`.
3. `APIFY_TOKEN=... bun skills/odds-outreach-contacts/scripts/read-urls.ts <dir>/merged_people.json <dir>/people.json` (reads each profile, ~$0.005).
4. `bun skills/odds-outreach-contacts/scripts/run.ts --from-file <dir>/people.json`, then `... --link-only`. The fixed rules decide who is kept.

## Browser route (LinkedIn people search, signed in as the user)

For each pair the `--dry` run lists (employer, department):
1. Open `https://www.linkedin.com/company/<slug>/people/?keywords=<department title words>` (or People search with filters: Current
   company = the employer, Locations = Netherlands, Title = the department words) - the user must be signed in to LinkedIn in that browser.
2. Collect, in this order: managers/heads/leads/directors of the department; then the non-senior people of the department; if either is
   empty, the same in the nearest departments; then recruiters/talent acquisition/HR.
3. For each person copy exactly: `url` (profile address), `name`, `title` (current position title), `headline`, `company` (current
   employer as shown), `companyUrl` (its LinkedIn page if shown), `place`, `photo` (image URL, optional).
4. Write `[{ "employer": "<app_jobs.employer>", "display": "<name shown>", "role": "hiring_manager"|"peer"|"adjacent_manager"|"adjacent_peer"|"recruiter",
   "department": "<standard department>", "people": [ ... ] }]` and run
   `bun skills/odds-outreach-contacts/scripts/run.ts --from-file people.json --dry`, then without `--dry` (it also links them to jobs).

## Check

`bun coverage.ts` (`hiring_manager_in_dept`, `peers_not_senior`, `recruiter`), and
`select role, count(*) from job_outreach_contacts group by 1`.
