/**
 * How complete the per-job data is for the jobs in scope (internship and entry, no Dutch, posted in the last DAYS days).
 *   bun coverage.ts [--days 30]
 */
import { sql } from "./lib/db"
import { arg } from "./lib/env"
import { scopeWhere } from "./lib/scope"

const DAYS = Number(arg("--days", "30"))
const has = async (t: string): Promise<boolean> => (await sql(`select to_regclass('public.${t}') is not null as ok`))[0].ok
const contactsTable = await has("job_outreach_contacts"), reviewsTable = await has("job_glassdoor_reviews")

const [r] = await sql(`
with pool as (select id, family, lower(trim(employer)) e1, lower(trim(coalesce(employer_display, employer))) e2 from app_jobs where ${scopeWhere(DAYS)}),
people as (
  select lower(employer) emp, coalesce(jev->>'role', '') role,
    jev->>'role' = 'recruiter' or (jev->>'role' is null and headline ~* '(recruit|talent acquisition|\\mhr\\M|human resources|people partner|early careers|campus)') is_recruiter,
    jev->>'role' in ('hiring_manager','adjacent_manager') or (jev->>'role' is null and headline ~* '(\\mmanager\\M|\\mhead\\M|\\mlead\\M|director)' and not headline ~* '(recruit|talent|\\mhr\\M)') is_manager
  from job_people where coalesce(jev->>'decision_final', '') <> 'reject'),
h as (
  select p.id,
    exists (select 1 from people j where j.emp in (p.e1, p.e2)) contacts,
    exists (select 1 from people j where j.emp in (p.e1, p.e2) and j.role = 'hiring_manager') hiring_manager_dept,
    exists (select 1 from people j where j.emp in (p.e1, p.e2) and j.is_manager) any_manager,
    exists (select 1 from people j where j.emp in (p.e1, p.e2) and j.role in ('peer','adjacent_peer')) peers,
    exists (select 1 from people j where j.emp in (p.e1, p.e2) and j.is_recruiter) recruiter,
    exists (select 1 from job_candidate_evidence c where c.posting_id = p.id and c.validation_status = 'validated' and c.status = 'exact') past_exact,
    exists (select 1 from job_candidate_evidence c where c.posting_id = p.id and c.validation_status = 'validated' and c.status in ('exact','adjacent')) past_any,
    exists (select 1 from employer_glassdoor_reviews r where lower(r.employer) in (p.e1, p.e2)) reviews,
    ${reviewsTable ? "exists (select 1 from job_glassdoor_reviews x where x.posting_id = p.id and x.match = 'same_role')" : "false"} reviews_role,
    exists (select 1 from employer_facts f where lower(f.employer) in (p.e1, p.e2)) linkedin_facts,
    exists (select 1 from employer_money m where lower(m.employer) in (p.e1, p.e2) and m.kind = 'revenue') revenue,
    (select count(distinct m.year) from employer_money m where lower(m.employer) in (p.e1, p.e2) and m.kind = 'revenue') >= 2 revenue_growth,
    exists (select 1 from employer_money m where lower(m.employer) in (p.e1, p.e2) and m.kind = 'net_profit') profit,
    exists (select 1 from employer_money m where lower(m.employer) in (p.e1, p.e2) and m.kind in ('market_value','total_assets')) net_worth,
    exists (select 1 from employer_headcount x where lower(x.employer) in (p.e1, p.e2) group by x.source having count(distinct x.read_on) >= 2) headcount_growth,
    exists (select 1 from employer_news n where lower(n.employer) in (p.e1, p.e2)) news
  from pool p)
select count(*) jobs,
  count(*) filter (where contacts) contacts, count(*) filter (where hiring_manager_dept) hiring_manager_in_dept, count(*) filter (where any_manager) any_manager,
  count(*) filter (where peers) peers_not_senior, count(*) filter (where recruiter) recruiter,
  count(*) filter (where past_exact) past_hires_exact, count(*) filter (where past_any) past_hires_exact_or_adjacent,
  count(*) filter (where reviews) reviews_employer, count(*) filter (where reviews_role) reviews_same_role,
  count(*) filter (where linkedin_facts) linkedin_facts, count(*) filter (where revenue) revenue, count(*) filter (where revenue_growth) revenue_growth,
  count(*) filter (where profit) profit, count(*) filter (where net_worth) net_worth, count(*) filter (where headcount_growth) headcount_growth, count(*) filter (where news) news,
  count(*) filter (where not contacts and not past_any and not reviews and not linkedin_facts and not revenue and not news) nothing
from h`)
const n = Number(r.jobs)
console.log(`${n} jobs in scope (internship + entry, no Dutch, last ${DAYS} days)${contactsTable ? "" : "  [job_outreach_contacts not created yet]"}`)
for (const [k, v] of Object.entries(r)) if (k !== "jobs") console.log(`  ${k.padEnd(30)} ${String(v).padStart(5)}  ${((100 * Number(v)) / Math.max(n, 1)).toFixed(1).padStart(5)}%`)
