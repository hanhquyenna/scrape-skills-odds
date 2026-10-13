# What we learned (11-14 Oct 2026) - read before you spend any credit

Measured on `active_internship_entry_english`, jobs of the last 7 and 30 days. Numbers below come from `bun skills/odds-metrics-report/scripts/report.ts`.

## Results so far (7 days, % of jobs; start 12 Oct -> 14 Oct)
Any contact 33 -> 61-68 · hiring manager in the job's department 14 -> 46-55 · same-department people 17 -> 43-51 · recruiter 22 -> 33-42 ·
past hires exact-or-adjacent 19 -> 45 · reviews 84 -> 64-82 (fell when other agents added ~150 new jobs: the new employers have no reviews yet: next step).
The table grows while we work (7-day window 274 -> 483 jobs): always read the job counts, not only the percent.

## The order that works (cheapest first)
1. **New jobs** (`odds-linkedin-new-jobs`, `odds-glassdoor-jobs`, run both at once; ~$0.001 per 10 jobs), then `sh scripts/after-new-jobs.sh` in the odds repo.
2. **LinkedIn company pages** for every new employer (`odds-company-info/scripts/linkedin-company.ts`, ~$0.004 each). Without a page nothing else can match the
   employer: 105 of 140 employers with no people had no page. Names refused as "another company" (Hogeschool van Amsterdam, TU/e, Albert Heijn B.V.) need a hand alias.
3. **Same company = same LinkedIn page.** Employer names that share one `employer_facts.linkedin_url` are one company ("Koninklijke Philips Electronics N.V." = "Philips").
   `coverage.ts` and `run.ts --link-only` use it; people found under one spelling now reach jobs under the other.
4. **People (outreach, recruiters)**: find with free web search in parallel helper agents, read the shortlist with Apify (`odds-fill-table` "Parallel route").
   61% of profiles read were kept (~$0.008 per kept person); the old Apify-only Google route cost ~$0.5 per percentage point.
5. **Company People page in the signed-in browser** for employers nobody found (`linkedin.com/company/<slug>/people/`): everyone at the company, recruiters included,
   expanded by rule to the job's department and the nearest departments (`expand-company-people.ts`). Skip huge employers (worldwide lists).
6. **Past hires**: LinkedIn people search in the signed-in browser ("<company> <role> intern") + Apify read + fixed rules (50% kept). Web search finds current staff (4% kept).
   Then `reuse-read.ts` (free): profiles already read are matched against the other jobs of the same employer (+6 points at no cost).
7. **Shown candidates with no Experience**: `fill-profiles.ts` (Education/Details only in the candidate card = profile made from a snippet, never read in full).
8. Reviews (`odds-glassdoor-reviews`), company numbers (`odds-company-info`, browser + exact quotes), TypeSafe checks (`odds-typesafe-cluster`, needs the owner's key).
9. `bun skills/odds-metrics-report/scripts/report.ts` before and after; it prints the change in percentage points and saves a snapshot to `reports/`.

## Limits and failures we hit (do not rediscover them)
- Apify free accounts are $5-$10 a month, differently per token: read the first line each script prints. `harvestapi/linkedin-profile-search` allows 10 runs;
  `harvestapi/linkedin-profile-scraper` allows 10 items per run on free accounts (`lib/people.ts` calls it in chunks of 10). `supreme_coder/linkedin-profile-scraper`
  sometimes returns nothing ("no available accounts found"): `readProfiles` falls back to harvestapi. `apify/google-search-scraper` refuses a cap below $0.50.
- Reading a profile costs $0.005 (supreme) to $0.01 (harvestapi fallback). Do not read profiles that rules will drop: skip large employers' People pages, skip
  links with `%` in them, skip people outside the Netherlands in the snippet.
- **Web search is capped at 200 searches per turn, shared by every helper agent.** 5 agents x 30 searches fits; 6 x 50 does not (the last ones are cut off).
- A helper agent only searches and writes link files; it never calls Apify or the database (so credit is not burnt in parallel and nothing is written twice).
- Helper agents sometimes return people outside the Netherlands or at the wrong company: the fixed rules (`lib/rules.ts`) are the judge, never the agent.
- Google queries longer than 3 OR phrases return nothing. Hotels, restaurants and companies under ~5 LinkedIn employees rarely give anyone.
- The signed-in built-in browser works for LinkedIn people search (`main [role="listitem"]` cards, first `a[href*="/in/"]` per card). 25 actions per `browser_batch`.
- Percent can fall while counts rise (new jobs from other agents). Report both.

## What is honestly not reachable
Exact-role past hires when nobody held that role (new or odd roles), people at employers with no LinkedIn page or no Dutch staff, revenue/net worth of private
companies that publish nothing. The app already shows LinkedIn search links when a group has nobody. Realistic ceilings (7 days): any contact 80-85%, hiring manager
65-70%, recruiter ~55%, past hires exact-or-adjacent ~55%, reviews ~90%.

## Rules from the owner (unchanged)
Collect as published; fixed rules decide; TypeSafe (Jev) only classifies; no model writes or rewrites text people read; no moral or platform limits that were not stated;
never write API tokens to files or repeat them back (pass them as `APIFY_TOKEN=...` for one command and ask the owner to rotate pasted tokens).
