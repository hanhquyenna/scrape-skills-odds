---
name: odds-metrics-report
description: Report how complete odds' per-job data is for the table active_internship_entry_english (people to contact, hiring managers, recruiters, past hires, reviews, company page, revenue, net worth, news) for the last 7 and 30 days, with the change in percentage points against the start (12 Oct 2026) and against the previous snapshot. Use when asked for the metrics, stats, coverage, "report the data", "what changed", before and after a fill run.
---

# Metrics report

Table: the view **`active_internship_entry_english`**; windows: jobs posted in the last 7 and 30 days (`coalesce(posted_on, current_date - days_open)`).

```bash
cd scrape-skills-odds && bun install            # once; the odds repo must sit next to it (SUPABASE_ACCESS_TOKEN from its .env.secrets)
bun skills/odds-metrics-report/scripts/report.ts            # prints two tables and saves reports/<date-time>.json
bun skills/odds-metrics-report/scripts/report.ts --no-save  # print only
bun coverage.ts --days 7                                    # the raw numbers for one window
```
Each row: jobs with the data, % now, % at the start (`reports/baseline-2026-10-12.json`), change in percentage points, % in the previous snapshot, change since then.

Rows: any outreach contact · hiring manager in the job's department · same-department people not senior · recruiter · past hires exact · past hires exact or adjacent ·
company reviews · reviews from the same role · company LinkedIn page · revenue · revenue growth · profit · net worth · headcount growth · news · jobs with nothing at all.

## How to read it
- Percent = jobs with the data / jobs in the window. Other agents add jobs while you work, so a percent can fall while the count of jobs with data rises:
  say both ("294 jobs, 60.9%"). The window also moves with the date.
- What each row needs and which skill fills it: contacts, hiring managers, recruiters -> `odds-outreach-contacts`; past hires -> `odds-past-hires`; reviews ->
  `odds-glassdoor-reviews`; company page, revenue, net worth, headcount, profit -> `odds-company-info`; new jobs -> `odds-linkedin-new-jobs`, `odds-glassdoor-jobs`.
  The order and the costs are in `LEARNINGS.md` and `skills/odds-playbook/SKILL.md`.
- Always give the user: the table for 7 days and for 30 days, the change vs start, what moved since the last report, and what to run next (with a credit estimate).
- Commit the new `reports/*.json` snapshot with the run that produced it, so the next agent sees the history.
