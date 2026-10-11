---
name: odds-outreach-contacts
description: Find people to reach out to for each odds internship/entry job (newest first) - the hiring managers in the job's department first, then everyone in that department who is not senior, then the adjacent departments, plus recruiters - and link them to each job ranked. Use when asked for outreach contacts, hiring managers, referral contacts, recruiters or "who to message" per job.
---

# Outreach contacts per job

Fills:
- `job_people` (per employer): name, LinkedIn URL, current title, place, photo; `jev.role` = `hiring_manager` | `peer` |
  `adjacent_manager` | `adjacent_peer` | `recruiter`, `jev.department` = the standard department searched.
- `job_outreach_contacts` (per job): every contact of the job's employer with a `rank` - 1 hiring manager in the job's department,
  2 peer (same department, not senior), 3 adjacent-department manager, 4 adjacent-department peer, 5 recruiter (+2 when the stored
  department is not the job's).

Order of the search for each employer and department (newest jobs first):
1. **Hiring managers**: the department's titles (lib/rules.ts `DEPARTMENT_TITLES`) at LinkedIn seniority Manager / Experienced manager /
   Director (200, 210, 220).
2. **Same department, not senior**: the same titles at In training / Entry (100, 110); anyone whose title says senior, lead, manager… is left out.
3. **Adjacent departments**: when 1 or 2 found nobody, the same searches in the two nearest departments (`adjacentDepartments`).
4. **Recruiters**: once per employer (recruiter, talent acquisition, HR business partner, early careers, campus, people partner).

Kept only by fixed rules: current position at this employer (name or LinkedIn page), in the Netherlands, title fits the role.
Then `odds-typesafe-cluster --people` checks each person again (NL, works there, department, seniority).

## 0. Before running

1. Repo root, odds repo next to it. Employers need a LinkedIn company page: run `odds-company-info` step 2 first for new employers.
2. **Ask the user for their Apify API token**; pass `APIFY_TOKEN=...` on the command line only.

## 1. Run (Apify `harvestapi/linkedin-profile-search`, Short mode, ~$0.05 per search of 25 people, 2–5 searches per pair)

```bash
bun skills/odds-outreach-contacts/scripts/run.ts --dry                    # the employer-and-department pairs, newest first
APIFY_TOKEN=... bun skills/odds-outreach-contacts/scripts/run.ts --limit 50
bun skills/odds-outreach-contacts/scripts/run.ts --link-only              # re-link contacts to jobs (free)
```
Pairs already searched are skipped, so re-running continues where the last run stopped (e.g. when credit ran out).
`APIFY UNAVAILABLE` (exit 3) → browser route.

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
