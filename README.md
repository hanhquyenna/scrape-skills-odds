# scrape-skills-odds

Skills that fill the data behind odds' internship and entry-level job table: for each job, newest first, the people to reach out to,
the people who held the role before, what employees say about the company and the role, and the company's published numbers - plus
new jobs from LinkedIn and Glassdoor.

Scope, always: `app_jobs` rows with `level_view in ('Internship','Entry')`, `dutch_required is not true`, posted in the last 30 days
(`coalesce(posted_on, current_date - days_open)`), newest first (`lib/scope.ts`).

Data is collected as published. Fixed rules (`lib/rules.ts`) keep or drop it; TypeSafe (Jev) only classifies; no model writes or
rewrites anything people read.

## Skills

| Skill | Fills | Apify actor (free credits) | Without Apify |
|---|---|---|---|
| [odds-fill-table](skills/odds-fill-table/SKILL.md) | everything, in order | - | - |
| [odds-linkedin-new-jobs](skills/odds-linkedin-new-jobs/SKILL.md) | new jobs (postings) | `valig/linkedin-jobs-scraper` | odds' public-page reader, or browser |
| [odds-glassdoor-jobs](skills/odds-glassdoor-jobs/SKILL.md) | new jobs (postings) | `valig/glassdoor-jobs-scraper` | browser |
| [odds-glassdoor-reviews](skills/odds-glassdoor-reviews/SKILL.md) | reviews per company, per role | `apify/google-search-scraper` + `kaix/glassdoor-reviews-scraper` | browser |
| [odds-company-info](skills/odds-company-info/SKILL.md) | revenue, profit, net worth, growth, headcount, LinkedIn page | `harvestapi/linkedin-company` (+ Wikidata, free) | Wikidata + browser (company reports) |
| [odds-outreach-contacts](skills/odds-outreach-contacts/SKILL.md) | hiring managers, same-department people, adjacent, recruiters | `harvestapi/linkedin-profile-search` (Short) | browser (LinkedIn, signed in) |
| [odds-past-hires](skills/odds-past-hires/SKILL.md) | exact and adjacent past role holders | `harvestapi/linkedin-profile-search` (Full) | browser (LinkedIn, signed in) |
| [odds-typesafe-cluster](skills/odds-typesafe-cluster/SKILL.md) | checks people, past hires, duplicate jobs | - (TypeSafe) | - |

### Actors tested on the Apify free plan (11 Oct 2026)

| Actor | Measured | Verdict |
|---|---|---|
| `harvestapi/linkedin-profile-search` | $0.05 per Short search (25 people); $0.10 per Full search (15 profiles with history) | used |
| `harvestapi/linkedin-company` | ~$0.004 per company (a one-company test shows only the start fee) | used |
| `kaix/glassdoor-reviews-scraper` | fractions of a cent per review, 3 s | used (best) |
| `apify/google-search-scraper` | ~$0.004 per query; refuses a cap below $0.50 | used to find Glassdoor pages |
| `valig/linkedin-jobs-scraper` | $0.001 per 10 jobs | used |
| `valig/glassdoor-jobs-scraper` | $0.001 per 15 jobs | used |
| `valig/indeed-jobs-scraper` | $0.001 per 10 jobs; many Dutch/non-entry results | possible |
| `kaix/glassdoor-jobs-scraper` | ~$0.0001 per 15 jobs | works too |
| `memo23/glassdoor-scraper-ppr` | $0.005 per 5 reviews | works, kaix is cheaper |
| `schesds/glassdoor-reviews` | $0.05 per 5 reviews, 190 s | not used |
| `burbn/glassdoor-company-search` | $0.08 per company (4 starts) | not used |
| `curious_coder/linkedin-jobs-scraper` | $0.018 per 10 jobs | not used |

Rental actors (monthly price) need a paid Apify plan and are not used.

## Setup

```bash
git clone https://github.com/hanhquyenna/scrape-skills-odds.git   # next to odds-beebalst
cd scrape-skills-odds && bun install
```
- The odds repo (`odds-beebalst`) must sit next to this one, or set `ODDS_REPO=/path/to/odds-beebalst`: the job intake rules are
  imported from it and `SUPABASE_ACCESS_TOKEN` is read from its `.env.secrets`.
- Keys are passed on the command line for one run (`APIFY_TOKEN=... bun ...`, `TYPESAFE_API_KEY=...`). The skills ask the user for them;
  they are never written to files. A local `.env` in this repo (git-ignored) also works.
- To make the skills available to Claude Code: link the folders into a skills directory, e.g.
  `ln -s "$PWD"/skills/* ~/.claude/skills/` (or into the odds repo's `.claude/skills/`).

## Shared code

- `lib/env.ts` keys and paths · `lib/db.ts` SQL through the Supabase Management API · `lib/apify.ts` token/credit check, runs (background +
  wait), `ApifyUnavailable` · `lib/rules.ts` same company, in NL, departments, seniority, title words · `lib/scope.ts` the jobs in scope ·
  `lib/intake.ts` new jobs into `postings` with odds' intake rules · `lib/typesafe.ts` Jev questions.
- `bun coverage.ts` - how complete each kind of data is for the jobs in scope.
- `bun run check` - type-check.
