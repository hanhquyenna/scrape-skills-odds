---
name: odds-playbook
description: The optimized end-to-end process for filling odds' job table (active_internship_entry_english) from newest to oldest - what to run in which order, which tool does what (Apify, web search helper agents, the signed-in browser), what each costs, and the limits that waste credit. Use at the start of any fill/enrich job for odds, or when asked "continue filling", "enrich everything", "make it 100%".
---

# Playbook: fill the table in the right order

Read `LEARNINGS.md` (limits, costs, results) and `AGENTS.md` (where things are) first. Then:

0a. **Are the jobs live?** `bun skills/odds-verify-live-jobs/scripts/run.ts --days 30 --dry`; if many are stale, run it (`--free` without Apify). Fill data for live jobs only.
0. `bun skills/odds-metrics-report/scripts/report.ts --no-save`: tell the user where things stand (7 and 30 days). Ask for an Apify token (never store it).
1. **New employers need a LinkedIn page**: `skills/odds-company-info/scripts/linkedin-company.ts --days 7 --limit 150` (cheap). New jobs first if wanted: `odds-linkedin-new-jobs` + `odds-glassdoor-jobs`, then `sh scripts/after-new-jobs.sh` (odds repo).
2. **People, in parallel** (`skills/odds-fill-table/SKILL.md` "Parallel route"): `assign.ts` -> 5 helper agents (<= 30 web searches each; 200 per turn in total) -> `merge-links.ts` ->
   `odds-outreach-contacts/scripts/read-urls.ts` -> `run.ts --from-file` -> `run.ts --link-only`.
3. **Employers nobody was found for**: the company People page in the signed-in browser -> `expand-company-people.ts` -> `read-urls.ts` -> `run.ts --from-file` -> `--link-only`
   (adjacent departments and recruiters come from the same links by rule).
4. **Past hires**: LinkedIn people search in the browser per job -> `odds-past-hires/scripts/read-urls.ts` -> `run.ts --from-file`; then free `reuse-read.ts` for the other jobs of the same employers;
   then `fill-profiles.ts` so every shown candidate has experience and education.
5. **Reviews and company numbers** for the new employers: `odds-glassdoor-reviews`, `odds-company-info` (numbers only with a quote that states the figure and year).
6. `odds-typesafe-cluster` when the owner gives a TypeSafe key.
7. `bun skills/odds-metrics-report/scripts/report.ts` (saves a snapshot): report before/after in percentage points for 7 and 30 days, say what is left and what it costs. Commit snapshots and any script fixes; push.

## Do not
Burn credit on profiles the rules will drop (huge employers, non-Dutch people); let helper agents call Apify; exceed 200 web searches per turn; store tokens; invent data; add limits the owner did not set.
