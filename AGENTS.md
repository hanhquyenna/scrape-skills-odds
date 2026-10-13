# START HERE: odds / beeblast, and how to fill its job table with Apify

You are an agent picking up a job for Kien (the owner). Read this file fully, then do "How to start" below. Nothing here contains a key:
you ask the user for keys when a step needs one.

## What odds is

**odds** (hosted at https://odds.beeblast.co, "beeblast" is the company/domain) lists jobs in the Netherlands for international students:
internships, traineeships, entry-level and working-student jobs. For each job it shows pay, take-home pay, visa threshold, an
estimated interview chance, what to put on the CV, people to ask for a referral, the company's facts and reviews, and people who held
the role before. Everything shown must come from a source; nothing is invented, and a language model may only **format**, never write
or rewrite content, unless the owner says so.

**The table this repo fills data for: the view `active_internship_entry_english`** (internship and entry-level jobs, still open, no
Dutch needed), jobs posted in the last 30 days, **from the newest job to the oldest**.

## Where things are (on the owner's Mac)

| What | Path / address |
|---|---|
| The odds app (React + Vite + Supabase) | `/Users/kien/Documents/Files/odds-beebalst` · GitHub `hanhquyenna/odds-beebalst` · live branch `main` (the working tree may sit on another branch: `git branch --show-current`) |
| **These skills (this repo)** | `/Users/kien/Documents/Files/scrape-skills-odds` · GitHub `hanhquyenna/scrape-skills-odds` · branch `main`. It must sit **next to** the odds repo; or set `ODDS_REPO=/path/to/odds-beebalst` |
| Owner's reports | `/Users/kien/Documents/Odds/Jobs data validation/VALIDATION_REPORT.md` (live/closed validation, 11 Oct), `/Users/kien/Documents/Odds/Engine/` (interview-chance data plan and report) |
| Validation data files | `odds-beebalst/research-data/coverage/` (`apify_check*.jsonl`, `closed_by_apify.csv`, `waiting_undated_linkedin.csv`, …) |
| The odds repo's own docs | `odds-beebalst/docs/DATA.md` (how data is made, rules, keys), `DEPLOY.md` (hosting, edge functions), `ENGINE_DATA_PLAN.md`, `google-drive-setup.md` |
| Database | Supabase project `ukpmpyfcnbhngkgbnkxi` (Postgres). Read/write through the Management API, see below |
| Keys on disk (never commit, never print) | `odds-beebalst/.env.secrets` (`SUPABASE_ACCESS_TOKEN`, optional `APIFY_TOKEN`, …), `odds-beebalst/.env.local` (public anon key only) |

Other Claude sessions may be working in the same odds tree (names seen: "Storing", "Engine"). Do not edit odds files you were not asked to
touch; this repo's scripts only write to the **database** (and to this repo). If a peer asks which files you edit, answer with that.

## How to open and run things

```bash
# the app, locally (odds repo; needs Bun)
cd /Users/kien/Documents/Files/odds-beebalst && bun install && bun run dev      # http://localhost:5173
bun run check                                                                   # types, lint, knip, 893+ tests (CI also runs e2e, perf, bench)

# these skills
cd /Users/kien/Documents/Files/scrape-skills-odds && bun install
bun coverage.ts                 # how complete each kind of data is, for the table above (default 30 days; --days 7)
```
Git: commit with the owner's git identity already set in each repo; end commit messages with the Co-Authored-By line you were given.
Pushing to odds `main` deploys to production (a GitHub Action); do not push there unless asked. Pushing this repo is safe.

## Database access (no password in this repo)

`lib/db.ts` runs SQL through `POST https://api.supabase.com/v1/projects/ukpmpyfcnbhngkgbnkxi/database/query` with
`SUPABASE_ACCESS_TOKEN` (a `sbp_…` token), read from the environment or `odds-beebalst/.env.secrets`. If it is missing, ask the owner.
Key tables/views: `postings` (all jobs; `closed_at` marks closed ones), views `app_jobs`, `active_internship_entry`,
**`active_internship_entry_english`**; `employer_facts` (LinkedIn company pages), `employer_money` (revenue etc. by year),
`employer_headcount`, `employer_glassdoor`, `employer_glassdoor_reviews`, `job_glassdoor_reviews` (per job), `employer_news`,
`job_people` (outreach contacts per employer; `jev.role`, `jev.department`), `job_outreach_contacts` (per job, ranked),
`candidate_profiles`, `candidate_experience`, `candidate_education`, `job_candidate_evidence` (past hires per job; the app shows
`validated` rows with status `exact` or `adjacent`).

## The skills (each has its own SKILL.md with steps, and a browser route for when Apify cannot run)

| Skill | Fills |
|---|---|
| `skills/odds-fill-table` | runs all the others in order and reports coverage before → after |
| `skills/odds-linkedin-new-jobs`, `skills/odds-glassdoor-jobs` | new jobs |
| `skills/odds-company-info` | revenue, profit, net worth, growth, headcount, LinkedIn company page |
| `skills/odds-glassdoor-reviews` | reviews per company and per role |
| `skills/odds-outreach-contacts` | hiring managers → same-department non-senior people → adjacent departments → recruiters |
| `skills/odds-past-hires` | people who held this role (exact) or an adjacent role (stated) |
| `skills/odds-typesafe-cluster` | TypeSafe (Jev) checks and clustering of people, past hires, duplicate jobs |

## How to start (do exactly this)

1. `cd` to this repo, `bun install`, run `bun coverage.ts --days 7` and `bun coverage.ts` and tell the user the numbers.
2. **Ask the user for an Apify API token** (apify.com > Settings > API & Integrations). Pass it only as `APIFY_TOKEN=... bun …` for that
   command. Never write it to a file, a commit, or repeat it back. Every script first prints the account, plan and credit left
   (`lib/apify.ts apifyReady`). If it prints **`APIFY UNAVAILABLE`** (no/wrong token, no credit, an actor refuses): tell the user, ask for
   another token, otherwise switch that step to its **browser route** in its SKILL.md. Do not add limits the owner did not ask for.
3. Open `skills/odds-fill-table/SKILL.md` and follow it. Work **newest job first** in every step; each step skips what is filled, so a run
   that stops (credit, time) is continued by running it again. Use `--dry` first, and `--limit 1` before a large run.
4. Finish with `bun coverage.ts` again and report before → after per line. Commit and push this repo if you changed it.

## Fastest way to fill people (13 Oct 2026, measured)

Use **the agent's own web search to find LinkedIn links (free, run several helper agents in parallel) and Apify only to read the shortlist**
(`skills/odds-fill-table/SKILL.md`, "Parallel route"). 7-day jobs with a contact: 33% -> 60%, hiring manager in the department 14% -> 43%,
peers 17% -> 42%, recruiter 22% -> 33%, for about $2 of Apify. The old Apify-only Google+read route cost ~$0.50 per point. Past hires do not
work this way (web search finds current staff): 5 matches from 125 profiles; use the Apify Google route or the browser for them.
Apify limits seen on free accounts vary by token ($5 or $10 a month): read the first line each script prints.

## Apify: what works on a free account (measured 11 Oct 2026; details in README.md)

- Free plan = $10/month credit. Only pay-per-event/per-result actors run; rental actors need a paid plan.
- **`harvestapi/linkedin-profile-search` allows free accounts only 10 runs**, then returns nothing while saying SUCCEEDED. Do not use it.
  People are found with **Google** (`apify/google-search-scraper`, ~$0.004/query, minimum run cap $0.50) and read with
  **`supreme_coder/linkedin-profile-scraper`** (~$0.005/profile). Keep Google queries short (≤3 OR phrases): long ones return nothing.
- Glassdoor reviews: `kaix/glassdoor-reviews-scraper` (cheap). LinkedIn company pages: `harvestapi/linkedin-company`.
  Jobs: `valig/linkedin-jobs-scraper`, `valig/glassdoor-jobs-scraper` (~$0.001 per 10 jobs).
- Cost per unit: outreach ~$0.055 per employer-and-department pair; past hires ~$0.035 per search.

## Rules the owner set (do not invent others)

- Collect as published; fixed rules keep or drop; TypeSafe (Jev) only classifies; no model writes or rewrites text people read.
- Company numbers collected in the browser are stored only with year, currency, source URL and an exact quote that states the figure
  (`skills/odds-company-info/scripts/ingest-facts.ts` enforces it).
- Past hires: an `adjacent` match must state which role the person held (the scripts write it in `explanation` and `relevant_history`).
- Do not add moral or platform constraints the owner did not state.
- Keep the database to live jobs: a closed job gets `postings.closed_at = now()`. Live check: Apify
  `scrapingmonkey/linkedin-job-details-scraper` (LinkedIn links only; `odds-beebalst/scripts/research/apify_open_check.py`), the
  hourly in-database checker for other boards. "LinkedIn returned nothing" three times in a row → closed; once or twice → leave open.

## State on 11 Oct 2026 (end of the last session)

Coverage for `active_internship_entry_english`, jobs posted in the last 7 days (124 jobs) / 30 days (≈690 jobs):

| | 7 days | 30 days |
|---|---|---|
| any outreach contact | 50% | 78% |
| hiring manager in the job's department | 15% | 8% |
| non-senior people in the department | 20% | 10% |
| recruiter | 29% | 29% |
| past hire, exact / exact or adjacent | 12% / 29% | 9% / 23% |
| reviews from the same role | 13% | 17% |
| LinkedIn company page | 94% | 94% |
| revenue / revenue growth / net worth | 28% / 26% / 13% | 29% / 25% / 17% |

Done: Wikidata money and headcount by year, LinkedIn company pages, Glassdoor reviews and per-job links, 33 closed jobs marked.
**Not done, needs Apify credit (the last token ran out):** outreach contacts for ≈100 employer-and-department pairs of the last 7 days
(~$6), past hires for ≈120 searches (~$4); for 30 days ≈$45 in total. TypeSafe checks (`odds-typesafe-cluster`) have never run: they need
the owner's `TYPESAFE_API_KEY`. The app does not yet show `job_glassdoor_reviews` / `job_outreach_contacts`.
