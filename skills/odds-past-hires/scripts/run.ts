/**
 * People who held this job, or one next to it, at this employer before ("successful historical candidates"), for the jobs in scope,
 * newest first. Found with Google and read with supreme_coder/linkedin-profile-scraper (lib/people.ts). Stored in candidate_profiles, candidate_experience, candidate_education and job_candidate_evidence, which the odds app
 * reads (job_successful_candidates). Every match says which role the person held and how it relates to the job:
 *   exact     same employer, same level, the job's title words (>= 60%)
 *   adjacent  same employer, same level, and either some of the title words or a role in the same or a neighbouring department;
 *             the held role and its department are stated (explanation, relevant_history)
 *
 *   bun skills/odds-past-hires/scripts/run.ts [--days 30] [--limit 50] [--dry]     Google (apify/google-search-scraper) + supreme_coder/linkedin-profile-scraper
 *   bun skills/odds-past-hires/scripts/run.ts --reuse-last     an earlier harvestapi/linkedin-profile-search run again (already paid for)
 *   bun skills/odds-past-hires/scripts/run.ts --from-file profiles.json            collected in the browser (shape in SKILL.md)
 * --limit counts searches (one per employer, title words and level). Jobs with validated evidence already are skipped.
 */
import { readFileSync } from "node:fs"
import { ApifyUnavailable, apifyReady, datasetItems, lastDataset, lastInput } from "../../../lib/apify"
import { discover, profileQuery, readProfiles } from "../../../lib/people"
import { jsonb, lit, sql } from "../../../lib/db"
import { arg, flag } from "../../../lib/env"
import { DEPARTMENT_TITLES, LEVEL_WORDS, adjacentDepartments, departmentKey, loadPages, pageOf, sameCompany, titleOverlap, titleWords } from "../../../lib/rules"
import { jobsSql } from "../../../lib/scope"

const DRY = flag("--dry"), REUSE = flag("--reuse-last")
const FILE = arg("--from-file", "")
const DAYS = Number(arg("--days", "30")), LIMIT = Number(arg("--limit", "100000"))

interface Job { id: string; employer: string; display: string; title: string; level: string; family: string | null; day: string }
const jobs = await sql<Job>(jobsSql(DAYS, "not exists (select 1 from job_candidate_evidence e where e.posting_id = app_jobs.id and e.validation_status = 'validated' and e.status in ('exact','adjacent'))"))
const groups = new Map<string, Job[]>()
for (const j of jobs) {
  const key = `${j.employer}\u0000${titleWords(j.title).slice(0, 3).join(" ")}\u0000${j.level}`
  groups.set(key, [...(groups.get(key) ?? []), j])
}
console.log(`${jobs.length} jobs without past hires, ${groups.size} searches (newest first)`)

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const monthOf = (m: unknown): number => (typeof m === "number" ? m : MONTHS.indexOf(String(m ?? "").slice(0, 3).toLowerCase()) + 1 || Number(m) || 1)
const ym = (d: any): string | null => (d?.year ? `${d.year}-${String(monthOf(d.month)).padStart(2, "0")}-01` : null)
const present = (d: any): boolean => !d || /present|heden/i.test(String(d?.text ?? ""))

interface Hit { status: "exact" | "adjacent"; confidence: number; position: Record<string, any>; heldDepartment: string | null; jobDepartment: string | null; overlap: number }
/** The best position at this employer that fits the job, by fixed rules; null when none does. */
function judge(profile: Record<string, any>, j: Job, page: string | null): Hit | null {
  const jobDep = departmentKey(j.family, j.title)
  let best: Hit | null = null
  for (const x of (Array.isArray(profile.experience) ? profile.experience : []) as Array<Record<string, any>>) {
    if (!sameCompany({ name: x.companyName, url: x.companyLinkedinUrl }, j.employer, j.display, page)) continue
    const held = String(x.position ?? x.title ?? "")
    if (!LEVEL_WORDS[j.level]?.test(held)) continue
    const overlap = titleOverlap(j.title, held)
    const heldDep = departmentKey(null, held)
    let hit: Hit | null = null
    if (overlap >= 0.6) hit = { status: "exact", confidence: Math.min(0.95, 0.6 + overlap * 0.35), position: x, heldDepartment: heldDep, jobDepartment: jobDep, overlap }
    else if (overlap > 0 || (heldDep && jobDep && (heldDep === jobDep || adjacentDepartments(jobDep).includes(heldDep)))) {
      const sameDep = heldDep !== null && heldDep === jobDep
      hit = { status: "adjacent", confidence: Math.min(0.8, 0.45 + overlap * 0.3 + (sameDep ? 0.15 : 0.05)), position: x, heldDepartment: heldDep, jobDepartment: jobDep, overlap }
    }
    if (hit && (!best || hit.confidence > best.confidence)) best = hit
  }
  return best
}

const currentOf = (p: Record<string, any>): Record<string, string> => {
  const x = ((p.experience ?? []) as Array<Record<string, any>>)[0] ?? {}
  return { title: String(x.position ?? x.title ?? ""), employer: String(x.companyName ?? ""), start_date: String(x.startDate?.text ?? ""), end_date: String(x.endDate?.text ?? ""), employment_type: String(x.employmentType ?? "") }
}

async function store(profile: Record<string, any>, j: Job, hit: Hit): Promise<void> {
  const url = String(profile.linkedinUrl).replace(/\/+$/, "")
  const now = new Date().toISOString()
  const [{ id }] = await sql<{ id: string }>(`
    insert into candidate_profiles (canonical_linkedin_url, public_identifier, full_name, headline, current_position, public_location, avatar_url, avatar_status, evidence_status)
    values (${lit(url)}, ${lit(profile.publicIdentifier)}, ${lit([profile.firstName, profile.lastName].filter(Boolean).join(" "))}, ${lit(profile.headline)}, ${jsonb(currentOf(profile))}, ${lit(profile.location?.linkedinText)},
      ${profile.photo ? lit(profile.photo) : "null"}, ${profile.photo ? "'available'" : "'unavailable'"}, 'apify_verified')
    on conflict (canonical_linkedin_url) do update set headline = excluded.headline, current_position = excluded.current_position, public_location = excluded.public_location, updated_at = now()
    returning id`)
  await sql(`delete from candidate_experience where candidate_profile_id = '${id}'; delete from candidate_education where candidate_profile_id = '${id}';`)
  const exp = ((profile.experience ?? []) as Array<Record<string, any>>).slice(0, 25)
  if (exp.length) await sql(`insert into candidate_experience (candidate_profile_id, employer, title, start_date, end_date, is_current, source_url, observed_at, experience_type, description) values ${exp.map((x) => `('${id}', ${lit(x.companyName)}, ${lit(x.position ?? x.title)}, ${ym(x.startDate) ? lit(ym(x.startDate)) + "::date" : "null"}, ${ym(x.endDate) ? lit(ym(x.endDate)) + "::date" : "null"}, ${present(x.endDate)}, ${lit(url)}, ${lit(now)}, ${lit(x.employmentType)}, ${lit(String(x.description ?? "").slice(0, 3000))})`).join(",")}`)
  const edu = ((profile.education ?? []) as Array<Record<string, any>>).slice(0, 10)
  if (edu.length) await sql(`insert into candidate_education (candidate_profile_id, school, degree, field, start_date, end_date, source_url, observed_at) values ${edu.map((x) => `('${id}', ${lit(x.schoolName ?? x.title)}, ${lit(x.degree)}, ${lit(x.fieldOfStudy)}, ${ym(x.startDate) ? lit(ym(x.startDate)) + "::date" : "null"}, ${ym(x.endDate) ? lit(ym(x.endDate)) + "::date" : "null"}, ${lit(url)}, ${lit(now)})`).join(",")}`)
  const p = hit.position, heldTitle = String(p.position ?? p.title ?? "")
  const span = `${ym(p.startDate) ?? "?"} to ${present(p.endDate) ? "now" : ym(p.endDate) ?? "?"}`
  const why = hit.status === "exact"
    ? `Was "${heldTitle}" at ${p.companyName} (${span}): the same role.`
    : `Was "${heldTitle}" at ${p.companyName} (${span}): an adjacent role${hit.heldDepartment ? ` in ${hit.heldDepartment}` : ""}${hit.jobDepartment && hit.heldDepartment !== hit.jobDepartment ? `, next to this job's ${hit.jobDepartment}` : ""}.`
  await sql(`delete from job_candidate_evidence where posting_id = ${lit(j.id)} and candidate_profile_id = '${id}' and validation_notes like 'rules:%';
    insert into job_candidate_evidence (posting_id, candidate_profile_id, source_url, observed_at, label, current_position, previous_experience, relevant_history, employer_match, role_function_match, level_match, status, confidence, explanation, validation_status, validated_at, validation_notes)
    values (${lit(j.id)}, '${id}', ${lit(url)}, ${lit(now)}, ${lit(hit.status === "exact" ? "same role" : "adjacent role")}, ${jsonb(currentOf(profile))},
      ${jsonb({ title: heldTitle, employer: p.companyName, start: ym(p.startDate), end: present(p.endDate) ? null : ym(p.endDate) })},
      ${jsonb({ relation: hit.status, held_title: heldTitle, held_department: hit.heldDepartment, job_department: hit.jobDepartment, title_overlap: Number(hit.overlap.toFixed(2)) })},
      'same employer', ${lit(hit.status === "exact" ? "same role" : `adjacent: ${hit.heldDepartment ?? "related title"}`)}, 'same level', ${lit(hit.status)}, ${hit.confidence.toFixed(2)}, ${lit(why)},
      'validated', now(), 'rules: same employer, same level words, title words or department (scrape-skills-odds/odds-past-hires)')`)
}

async function handle(people: Array<Record<string, any>>, group: Job[], page: string | null): Promise<number> {
  let kept = 0
  for (const profile of people) for (const job of group) {
    const hit = judge(profile, job, page)
    if (!hit) continue
    if (!DRY) await store(profile, job, hit)
    kept++
  }
  return kept
}

if (FILE) {
  // [{ jobId, profiles: [ harvestapi-shaped profiles: { linkedinUrl, firstName, lastName, headline, location: { linkedinText }, experience: [...], education: [...] } ] }]
  await loadPages()
  let kept = 0
  for (const g of JSON.parse(readFileSync(FILE, "utf8")) as Array<{ jobId: string; profiles: Array<Record<string, any>> }>) {
    const job = jobs.find((j) => j.id === g.jobId) ?? (await sql<Job>(jobsSql(3650, `id = ${lit(g.jobId)}`)))[0]
    if (!job) { console.log(`  ${g.jobId}: not a job in the table`); continue }
    kept += await handle(g.profiles, [job], pageOf(job.employer, job.display))
  }
  console.log(`${DRY ? "would keep" : "kept"} ${kept} matches from the file`)
  process.exit(0)
}
if (DRY) { for (const [, g] of [...groups].slice(0, 20)) console.log(`  ${g[0].day} ${g[0].display}: "${titleWords(g[0].title).slice(0, 3).join(" ")}" ${g[0].level} (${g.length} jobs)`); process.exit(0) }
if (!REUSE && !(await apifyReady())) { console.log("Switch to the browser route in SKILL.md (or ask the user for a working Apify token)."); process.exit(3) }
await loadPages()
let searched = 0, kept = 0, covered = 0
if (REUSE) {
  // The last paid search again: the jobs at the employer it searched (its pastCompanies page).
  const input = await lastInput("harvestapi/linkedin-profile-search"), ds = await lastDataset("harvestapi/linkedin-profile-search")
  const page = String(input?.pastCompanies?.[0] ?? "").toLowerCase().replace(/\/+$/, "")
  const group = [...groups.values()].flat().filter((j) => (pageOf(j.employer, j.display) ?? "").toLowerCase().replace(/\/+$/, "") === page)
  if (!ds || !page || group.length === 0) { console.log(`The last run (${page || "no past-company search"}) matches no job without past hires.`); process.exit(0) }
  const here = await handle(await datasetItems(ds), group, input!.pastCompanies[0])
  console.log(`reused the last search (${page}): ${here} matches for ${group.length} jobs`)
  process.exit(0)
}
// Google finds people who name this employer and a title like the job's (apify/google-search-scraper); their whole profiles are read
// (supreme_coder/linkedin-profile-scraper); the fixed rules above decide. Searches go in batches of BATCH.
const BATCH = Number(arg("--batch", "10")), READ = Number(arg("--read", "6"))
try {
  const todo = [...groups.values()].slice(0, LIMIT)
  for (let b = 0; b < todo.length; b += BATCH) {
    const batch = todo.slice(b, b + BATCH).map((group) => {
      const j = group[0], page = pageOf(j.employer, j.display)
      const words = titleWords(j.title).slice(0, 3).join(" ")
      const dep = departmentKey(j.family, j.title)
      const main = words || (dep ? (DEPARTMENT_TITLES[dep] ?? [])[0] : "")
      const titles = j.level === "Internship" ? [`${main} intern`, `${main} internship`, `${main} stagiair`, `${main} trainee`] : [`junior ${main}`, `${main} graduate`, `${main} associate`, `${main} trainee`]
      return { group, j, page, query: main ? profileQuery(j.display, titles, "") : "" }
    }).filter((x) => x.query)
    const found = await discover(batch.map((x) => x.query))
    const urls = new Set<string>()
    batch.forEach((x) => (found.get(x.query) ?? []).slice(0, READ).forEach((r) => urls.add(r.url)))
    const profiles = await readProfiles([...urls])
    for (const x of batch) {
      const people = (found.get(x.query) ?? []).slice(0, READ).map((r) => profiles.get(r.url)).filter(Boolean) as unknown as Array<Record<string, any>>
      searched++
      const here = await handle(people, x.group, x.page)
      if (here) covered += x.group.length
      kept += here
      console.log(`- ${x.j.day} ${x.j.display} "${x.j.title.slice(0, 50)}" (${x.group.length} jobs): ${people.length} profiles read, ${here} matches`)
    }
  }
} catch (e) {
  if (e instanceof ApifyUnavailable) console.log(`APIFY UNAVAILABLE: ${e.message}\nStopped. Continue with the browser route in SKILL.md.`)
  else throw e
}
console.log(`\nsearched ${searched}; matches kept ${kept}; jobs now covered ${covered}`)
