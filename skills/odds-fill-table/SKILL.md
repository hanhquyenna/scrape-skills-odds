---
name: odds-fill-table
description: Fill every kind of per-job data for odds' internship and entry jobs in English (newest to oldest) by running the other odds skills in order - new jobs, company info, Glassdoor reviews, outreach contacts, past hires, then TypeSafe checks - asking the user for an Apify token (or TypeSafe key) before the steps that need one and switching to the browser when Apify cannot run. Use when asked to "fill the table", "fill everything", or check what is missing per job.
---

# Fill the internship/entry table, everything, in order

## Table and order (always)

Table: the view **`active_internship_entry_english`** in the odds database: internship and entry-level jobs that are still open and do not
need Dutch. Scope: jobs posted in the last 30 days (`--days`), **filled from the newest job to the oldest**, so whatever runs out first
(credit, time) leaves the oldest jobs unfilled. Do not fill other jobs (senior, Dutch, closed, older). Check with `bun coverage.ts`.

Work from the `scrape-skills-odds` repo root with the odds repo next to it (see `README.md`).

1. **See what is missing**: `bun coverage.ts`. Report the numbers to the user.
2. **Ask the user for their Apify API token** once ("Paste your Apify API token, from apify.com > Settings > API & Integrations") and use
   it for steps 3–7 as `APIFY_TOKEN=...` on each command. Every script prints the account and the credit left first. If a script prints
   `APIFY UNAVAILABLE` (wrong token, no credit, actor refused), tell the user, ask whether they have another token; otherwise continue that
   step with its skill's browser route.
3. New jobs: `odds-linkedin-new-jobs`, then `odds-glassdoor-jobs`; then `sh scripts/after-new-jobs.sh` in the odds repo.
4. Company info: `odds-company-info` (Wikidata `--write`, then LinkedIn pages, then the browser for published numbers of the rest).
   LinkedIn pages come first because steps 6 and 7 need each employer's page.
5. Reviews: `odds-glassdoor-reviews`.
6. Outreach contacts: `odds-outreach-contacts` (hiring managers in the department first, then the department's non-senior people,
   then adjacent departments, then recruiters).
7. Past hires: `odds-past-hires` (exact and adjacent, the adjacent role stated).
8. **Ask the user for their TypeSafe API key** and run `odds-typesafe-cluster` (people, past hires, duplicate jobs), then
   `bun skills/odds-outreach-contacts/scripts/run.ts --link-only`.
9. `bun coverage.ts` again and report before → after per line.

## Parallel route (faster; use when more than a handful of employers are missing people)

The slow part of finding people is one agent searching one company at a time, not Apify. So split it (measured: 5 agents, about 1 minute each):
1. `bun skills/odds-fill-table/scripts/assign.ts <dir> --days 7 --agents 5` -> `<dir>/a_assign_1..5.json` (employer-and-department pairs without a
   hiring manager or peer, employers without a recruiter, jobs without past hires; newest and most-jobs first).
2. **Web search is capped at 200 searches per turn, shared by all agents of that turn** (measured 13 Oct 2026: with 6 agents x 50 the last ones were cut off
   after 4-20 searches). Keep it under that: 5 agents x 30 searches, or run the next round in a new turn. Agents report which pairs stayed empty.
   Start one helper agent per list, in the background, with `skills/odds-fill-table/prompts/find-links-agent.md` (fill DIR and N). Helpers only
   web-search and write `links_*_N.json`; they never call Apify or the database (so credit is not split or burnt in parallel).
3. When all finish: `bun skills/odds-fill-table/scripts/merge-links.ts <dir>`; it prints how many profiles (and about what cost) will be read.
4. Read and store with the user's token, spending the credit on outreach first: `read-urls.ts` then `run.ts --from-file` in `odds-outreach-contacts`.
   Past hires from web search have a low yield (see that skill); spend credit there only after outreach.
5. `bun coverage.ts --days 7` before and after. Repeat from step 1 for the next gap (assign.ts only lists what is still missing).

Each step works newest jobs first and skips what is already filled, so a run that stops (credit, time) is continued by running the same
step again. Collected data is never rewritten by a model.
