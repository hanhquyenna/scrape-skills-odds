/**
 * Splits the people still missing into N work lists, one per helper agent (each agent only web-searches for LinkedIn links).
 *   bun skills/odds-fill-table/scripts/assign.ts <dir> [--days 7] [--agents 5] [--prefix a]
 * Writes <dir>/<prefix>_assign_1.json ... : { outreach_pairs: [{employer, display, department, jobs}], recruiter_employers: [{employer, display, jobs}],
 * past_hire_jobs: [{id, display, employer, title}] }, newest jobs first, only what is not filled yet.
 */
import { mkdirSync } from "node:fs"
import { sql } from "../../../lib/db"
import { arg } from "../../../lib/env"
import { scopeWhere } from "../../../lib/scope"

const dir = process.argv[2]
if (!dir) throw new Error("usage: assign.ts <dir> [--days 7] [--agents 5] [--prefix a]")
mkdirSync(dir, { recursive: true })
const DAYS = Number(arg("--days", "7")), N = Number(arg("--agents", "5")), PREFIX = arg("--prefix", "a")
const has = (role: string, byDept: boolean): string =>
  `exists (select 1 from job_people j where lower(j.employer) in (lower(trim(p.employer)), lower(trim(p.d))) and j.jev->>'role' in (${role === "hiring_manager" ? "'hiring_manager','department_manager'" : `'${role}'`}) ${byDept ? "and j.jev->>'department' = p.family" : ""} and coalesce(j.jev->>'decision_final','') <> 'reject')`
const pairs = (await sql(`with p0 as (select employer, coalesce(employer_display, employer) d, family from app_jobs where ${scopeWhere(DAYS)})
  select employer, d as display, family as department, count(*) jobs from p0 p where family is not null and (not ${has("hiring_manager", true)} or not ${has("peer", true)}) group by 1,2,3 order by jobs desc limit 120`))
const recruiters = (await sql(`with p0 as (select employer, coalesce(employer_display, employer) d, family from app_jobs where ${scopeWhere(DAYS)})
  select employer, d as display, count(*) jobs from p0 p where not ${has("recruiter", false)} group by 1,2 order by jobs desc limit 60`))
const jobs = (await sql(`select id, coalesce(employer_display, employer) display, employer, coalesce(title_clean, title) title from app_jobs
  where ${scopeWhere(DAYS)} and not exists (select 1 from job_candidate_evidence c where c.posting_id = app_jobs.id and c.validation_status = 'validated')
  order by coalesce(posted_on, current_date - days_open) desc limit 60`))
for (let i = 0; i < N; i++) {
  const pick = <T>(xs: T[]): T[] => xs.filter((_, k) => k % N === i)
  await Bun.write(`${dir}/${PREFIX}_assign_${i + 1}.json`, JSON.stringify({ outreach_pairs: pick(pairs), recruiter_employers: pick(recruiters), past_hire_jobs: pick(jobs) }, null, 1))
}
console.log(`${pairs.length} pairs, ${recruiters.length} employers without a recruiter, ${jobs.length} jobs without past hires -> ${N} lists in ${dir}`)
