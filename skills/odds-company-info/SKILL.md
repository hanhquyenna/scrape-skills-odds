---
name: odds-company-info
description: Fill company information for the employers of odds' internship and entry jobs (newest first) - revenue, profit, net worth (market value, total assets), growth over the years, headcount, size, founded, headquarters, offices, where employees studied and what they do - from Wikidata, LinkedIn company pages and, for the rest, the company's own reports read in the browser. Collected as written; a model may only format, never rewrite. Use when asked for company facts, net worth, growth, size or "company insights".
---

# Company information (numbers and facts, as published)

Fills:
- `employer_money`: revenue, net_profit, market_value, total_assets, **one row per year** (growth = two or more years), with currency and source.
- `employer_headcount`: employees by date, per source (`wikidata`, `linkedin`, `company_report`). Growth is only compared within one source.
- `employer_facts`: the LinkedIn company page (name, website, founded, employees, range, followers, type, HQ, offices, industry,
  specialities, top locations, schools, functions, fields of study).

Rule: every value is copied from where it was published, with its year/date and source. Nothing is estimated, converted or rewritten.
A model may only put what was read into the fields (format), never write or summarise content.

## 0. Before running

Repo root, odds repo next to it. Steps 1 and 3 are free; for step 2 **ask the user for their Apify API token** (`APIFY_TOKEN=...` on
the command line only).

## 1. Wikidata (free): money and headcount by year for the larger companies

```bash
python3 skills/odds-company-info/scripts/wikidata.py            # prints what it found
python3 skills/odds-company-info/scripts/wikidata.py --write    # saves
```
Matches each employer to its Wikidata item strictly (official website domain; else exactly one item with the company's name described
as a company), then keeps every dated figure from 2010 on.

## 2. LinkedIn company pages (Apify `harvestapi/linkedin-company`, ~$0.004 a company)

```bash
APIFY_TOKEN=... bun skills/odds-company-info/scripts/linkedin-company.ts              # employers without facts, found by name
APIFY_TOKEN=... bun skills/odds-company-info/scripts/linkedin-company.ts --refresh    # read known pages again: a new dated headcount
```
Pages whose name is another company are refused (e.g. "Workwize" → "Workwise"); the script lists them. Run `--refresh` every few weeks:
two LinkedIn headcounts make LinkedIn growth. `APIFY UNAVAILABLE` (exit 3) → collect the page in the browser (below).

## 3. Browser: numbers the company publishes itself

For employers still without revenue / net worth / headcount after 1 and 2 (`bun coverage.ts`, then
`select a.employer from app_jobs a where ... and not exists (select 1 from employer_money m where m.employer = a.employer)`):
1. Find where the company publishes figures: its annual report or "investors"/"about us"/"facts and figures" page, its KVK/annual
   accounts filing, the stock exchange page, or a regulator's page. Prefer the most official source (annual report > own site > exchange).
2. For each figure copy: `kind` (revenue | net_profit | market_value | total_assets | employees), `amount` (the number as stated,
   scaled to units: "€1.2 billion" → 1200000000), `currency` (ISO), `year` (the fiscal year), `date` (employees: the date the count is
   for), `source_url` (the exact page or PDF), and `quote`: the sentence or table cell, **copied exactly**.
3. Write `[{ "employer": "<app_jobs.employer>", "facts": [ ... ] }]` and run
   `bun skills/odds-company-info/scripts/ingest-facts.ts facts.json --dry`, then without `--dry`.
   A fact is refused when its quote does not state that amount (within 0.5%, any notation: "1.234,5 mln", "€150 million") or its year.

For a LinkedIn page collected by hand: open `linkedin.com/company/<slug>/about/` and `/people/`, and save the same fields as the actor's
output (`name, linkedinUrl, website, foundedOn.year, employeeCount, employeeCountRange, followerCount, companyType, locations,
industries, specialities, peopleStats`) with `"employer": "<app_jobs.employer>"`, then
`bun skills/odds-company-info/scripts/linkedin-company.ts --from-file pages.json`.

## Check

`bun coverage.ts` (`linkedin_facts`, `revenue`, `revenue_growth`, `profit`, `net_worth`, `headcount_growth`).
