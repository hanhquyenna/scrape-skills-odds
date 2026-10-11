---
name: odds-fill-table
description: Fill every kind of per-job data for odds' internship and entry jobs in English (newest to oldest) by running the other odds skills in order - new jobs, company info, Glassdoor reviews, outreach contacts, past hires, then TypeSafe checks - asking the user for an Apify token (or TypeSafe key) before the steps that need one and switching to the browser when Apify cannot run. Use when asked to "fill the table", "fill everything", or check what is missing per job.
---

# Fill the internship/entry table, everything, in order

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

Each step works newest jobs first and skips what is already filled, so a run that stops (credit, time) is continued by running the same
step again. Collected data is never rewritten by a model.
