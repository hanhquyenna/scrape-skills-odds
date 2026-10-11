---
name: odds-typesafe-cluster
description: Check and cluster the data the other odds skills collected, with TypeSafe (Jev) - outreach contacts (in the Netherlands, works there, department, seniority), past-hire matches (same role / adjacent role / unrelated) and the same job found on two sites. Use after odds-outreach-contacts, odds-past-hires or new jobs, or when asked to verify, cluster or clean the collected data.
---

# Verify and cluster with TypeSafe (Jev)

Jev only classifies (yes/no probabilities and labels). It never writes text that people read; nothing is rewritten.

## 0. Before running

Repo root, odds repo next to it. **Ask the user for their TypeSafe API key** and pass it as `TYPESAFE_API_KEY=...` on the command line
(never write it to a file). Apify is not used here.

## 1. Run

```bash
TYPESAFE_API_KEY=... bun skills/odds-typesafe-cluster/scripts/run.ts --people       --dry   # then without --dry
TYPESAFE_API_KEY=... bun skills/odds-typesafe-cluster/scripts/run.ts --past-hires   --dry
TYPESAFE_API_KEY=... bun skills/odds-typesafe-cluster/scripts/run.ts --dedupe-jobs  --dry
TYPESAFE_API_KEY=... bun skills/odds-typesafe-cluster/scripts/run.ts                         # all three
```
- `--people`: for each contact stored by `odds-outreach-contacts` and not read yet: `in_netherlands` and `works_at_company` (noul, keep at
  ≥ 0.8, else `decision_final = 'reject'`), `department` (choice over the 16 standard departments + Other), `seniority` (student / entry /
  experienced / manager / director). The role is corrected to match (e.g. a "peer" who is a manager in another department becomes
  `adjacent_manager`). Results are kept in `job_people.jev`. Afterwards run `odds-outreach-contacts --link-only`.
- `--past-hires`: for each rules-validated match: `relation` (choice: same_role / adjacent_role / unrelated) from the posting's start and
  the held role. same_role → `exact`, adjacent_role → `adjacent`, unrelated (confidence ≥ 0.6) → `validation_status = 'conflict'` (the app
  hides it). The reading is appended to `validation_notes` and `relevant_history`.
- `--dedupe-jobs`: Glassdoor and LinkedIn jobs in scope with nearly the same title and place; Jev's `same_job` ≥ 0.85 → the Glassdoor copy
  gets `usable = 0` (hidden by the app; set it back to null to undo).

`--limit` caps how many rows are read per part (default 500). Rows already read are skipped, so re-running continues.

## Check

`bun coverage.ts`; `select jev->>'decision_final', count(*) from job_people where jev ? 'jev_checked' group by 1`;
`select validation_status, status, count(*) from job_candidate_evidence where validation_notes like '%jev:%' group by 1, 2`.
