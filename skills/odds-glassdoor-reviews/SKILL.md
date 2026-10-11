---
name: odds-glassdoor-reviews
description: Fill Glassdoor employee reviews for the employers of odds' internship and entry jobs (newest jobs first), and link each job to the reviews from people in the same role or department. Use when asked for company reviews, ratings, "what employees say", or reviews per role.
---

# Glassdoor reviews per company and per role

Fills:
- `employer_glassdoor` (the company's Glassdoor page) and `employer_glassdoor_reviews` (each review: date, title, role, current/former,
  place, overall and sub-ratings, recommend, CEO, outlook, pros, cons). The job page's rating averages come from these reviews.
- `job_glassdoor_reviews`: per job, the reviews written by people in the **same role** (title words shared ≥ 50%) or, failing that, the
  **same department** (lib/rules.ts `departmentKey`).

## 0. Before running

Repo root, odds repo next to it. **Ask the user for their Apify API token**; pass it as `APIFY_TOKEN=...` only.

## 1. Run

```bash
APIFY_TOKEN=... bun skills/odds-glassdoor-reviews/scripts/run.ts --limit 100 --reviews 100
bun skills/odds-glassdoor-reviews/scripts/run.ts --match-only        # only re-link reviews to jobs (free)
```
1. Each employer without reviews (newest jobs first) gets its Glassdoor page: the stored one, else a Google search
   (`apify/google-search-scraper`, query `"<name> glassdoor reviews"`, ~$0.004 a company) keeping only a `/Reviews/<Name>-Reviews-E<id>.htm`
   address whose name is this company. (`site:glassdoor.nl/Reviews …` queries return nothing: keep the plain query.)
2. Reviews, newest first, for all those companies in one run: `kaix/glassdoor-reviews-scraper` (fractions of a cent per review).
   Reviews are dropped when the employer Glassdoor names on them is another company.
3. Reviews are linked to jobs (`job_glassdoor_reviews`). More reviews per company (`--reviews 200`) means more jobs get same-role reviews.

`APIFY UNAVAILABLE` (exit 3) → browser route.

## 2. Check

`bun coverage.ts` (`reviews_employer`, `reviews_same_role`).

## Browser route

For each employer the script lists (or `select employer, display from ...` in scope without reviews):
1. Find its page: search the web for `<company> glassdoor reviews`, open the `glassdoor.com/Reviews/<Name>-Reviews-E<id>.htm` result, and
   check the company name and logo match the employer.
2. Sort reviews by most recent. For each review copy exactly: `id` (the number in the review's link, `RVW<id>`), `date` (YYYY-MM-DD),
   `title`, `role` (the job title of the reviewer), `current` (true for current employee), `place`, `overall`, and the sub-ratings
   `balance`, `culture`, `diversity`, `career`, `pay`, `management` (1–5), `recommend` ("yes"/"no"), `ceo` ("approve"/"disapprove"/…),
   `outlook` ("positive"/"neutral"/"negative"), `pros`, `cons` (full text, unchanged).
3. Write `[{ "employer": "<app_jobs.employer>", "glassdoorUrl": "<reviews page>", "reviews": [ ... ] }]` and run
   `bun skills/odds-glassdoor-reviews/scripts/run.ts --from-file reviews.json` (it also re-links reviews to jobs).
Never shorten or rewrite review text. If Glassdoor asks to sign in after a few pages, ask the user to sign in in that browser.
