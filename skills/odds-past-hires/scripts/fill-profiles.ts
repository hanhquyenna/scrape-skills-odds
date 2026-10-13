/**
 * Candidate profiles that the app shows (validated evidence) but that have no experience or no education rows: read the whole public profile
 * and store the positions (employer, title, dates, current) and the schools. Fixes "Education / Details only, no Experience" in the candidate card.
 *   bun skills/odds-past-hires/scripts/fill-profiles.ts [--limit 100] [--dry]
 * Reads with lib/people.ts readProfiles (supreme_coder, then harvestapi in chunks of 10). Profiles the readers cannot find are left as they are.
 */
import { lit, sql } from "../../../lib/db"
import { arg, flag } from "../../../lib/env"
import { apifyReady } from "../../../lib/apify"
import { readProfiles } from "../../../lib/people"

const LIMIT = Number(arg("--limit", "100")), DRY = flag("--dry")
const todo = await sql<{ id: string; url: string }>(`
  select p.id, p.canonical_linkedin_url url from candidate_profiles p
  where exists (select 1 from job_candidate_evidence c where c.candidate_profile_id = p.id and c.validation_status = 'validated')
    and (not exists (select 1 from candidate_experience e where e.candidate_profile_id = p.id) or not exists (select 1 from candidate_education e where e.candidate_profile_id = p.id))
  order by p.updated_at desc limit ${LIMIT}`)
console.log(`${todo.length} candidate profiles without experience or education`)
if (DRY || !todo.length) process.exit(0)
if (!(await apifyReady())) process.exit(3)
const profiles = await readProfiles(todo.map((t) => t.url.replace(/\/+$/, "")))
const ym = (d: any): string | null => (d?.year ? `${d.year}-${String(d.month ?? 1).padStart(2, "0")}-01` : null)
const present = (d: any): boolean => !d || d.text === "Present" || (!d.year && !d.month)
const now = new Date().toISOString()
let withExp = 0, withEdu = 0
for (const t of todo) {
  const p = profiles.get(t.url.replace(/\/+$/, "").toLowerCase().replace("https://www.linkedin.com/in/", "https://www.linkedin.com/in/"))
  if (!p) continue
  const has = async (table: string): Promise<boolean> => (await sql(`select 1 from ${table} where candidate_profile_id = '${t.id}' limit 1`)).length > 0
  if (p.experience.length && !(await has("candidate_experience"))) {
    await sql(`insert into candidate_experience (candidate_profile_id, employer, title, start_date, end_date, is_current, source_url, observed_at, experience_type, description) values ${p.experience.map((x) => `('${t.id}', ${lit(x.companyName)}, ${lit(x.position)}, ${ym(x.startDate) ? lit(ym(x.startDate)) + "::date" : "null"}, ${ym(x.endDate) ? lit(ym(x.endDate)) + "::date" : "null"}, ${present(x.endDate)}, ${lit(t.url)}, ${lit(now)}, ${lit(x.employmentType)}, ${lit(String(x.description ?? "").slice(0, 3000))})`).join(",")} on conflict do nothing`)
    withExp++
  }
  if (p.education.length && !(await has("candidate_education"))) {
    await sql(`insert into candidate_education (candidate_profile_id, school, degree, field, start_date, end_date, source_url, observed_at) values ${p.education.slice(0, 10).map((x) => `('${t.id}', ${lit(x.schoolName)}, ${lit(x.degree)}, ${lit(x.fieldOfStudy)}, ${ym(x.startDate) ? lit(ym(x.startDate)) + "::date" : "null"}, ${ym(x.endDate) ? lit(ym(x.endDate)) + "::date" : "null"}, ${lit(t.url)}, ${lit(now)})`).join(",")} on conflict do nothing`)
    withEdu++
  }
}
console.log(`read ${profiles.size} of ${todo.length}; experience added for ${withExp}, education added for ${withEdu}`)
