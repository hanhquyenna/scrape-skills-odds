/**
 * Each employer's own LinkedIn company page (size, founded, headquarters, offices, industry, where its people studied and what they do)
 * for the jobs in scope, newest jobs first. Every read also adds a dated headcount (employer_headcount, source 'linkedin'), so reading
 * again later shows growth.
 *
 *   bun skills/odds-company-info/scripts/linkedin-company.ts [--days 30] [--limit 400] [--refresh] [--dry]
 *       Apify harvestapi/linkedin-company: by name for employers without facts; with --refresh, by page for the ones read before today.
 *   bun skills/odds-company-info/scripts/linkedin-company.ts --from-dataset <id>     an earlier run's items (already paid for)
 *   bun skills/odds-company-info/scripts/linkedin-company.ts --from-file pages.json   collected in the browser (shape in SKILL.md)
 * Kept only when the page's name (or address) is this company's.
 */
import { readFileSync } from "node:fs"
import { ApifyUnavailable, apifyReady, datasetItems, runActor } from "../../../lib/apify"
import { jsonb, lit, num, sql } from "../../../lib/db"
import { arg, flag } from "../../../lib/env"
import { sameCompany } from "../../../lib/rules"
import { employersSql } from "../../../lib/scope"

const DRY = flag("--dry"), REFRESH = flag("--refresh")
const FILE = arg("--from-file", ""), DATASET = arg("--from-dataset", "")
const DAYS = Number(arg("--days", "30")), LIMIT = Number(arg("--limit", "400"))

const employers = await sql<{ employer: string; display: string; page: string | null }>(`
  with recent as (${employersSql(DAYS)})
  select r.employer, r.display, f.linkedin_url as page from recent r left join employer_facts f on f.employer = r.employer
  where ${REFRESH ? "coalesce(f.linkedin_url, '') <> '' and coalesce(f.fetched_at, '2000-01-01') < current_date" : "f.employer is null"}
  limit ${LIMIT}`)
console.log(`${employers.length} employers to read (${REFRESH ? "refresh by page" : "no facts yet, by name"}), newest jobs first`)
if (employers.length === 0) process.exit(0)

let items: Array<Record<string, any>> = []
if (FILE) items = JSON.parse(readFileSync(FILE, "utf8"))
else if (DATASET) items = await datasetItems(DATASET)
else {
  if (DRY) process.exit(0)
  if (!(await apifyReady())) { console.log("Switch to the browser route in SKILL.md (or ask the user for a working Apify token)."); process.exit(3) }
  try {
    items = (await runActor("harvestapi/linkedin-company", REFRESH ? { companies: employers.map((e) => e.page) } : { searches: employers.map((e) => e.display) })).items as Array<Record<string, any>>
  } catch (e) {
    if (e instanceof ApifyUnavailable) { console.log(`APIFY UNAVAILABLE: ${e.message}\nSwitch to the browser route in SKILL.md.`); process.exit(3) }
    throw e
  }
}

const slug = (u: unknown): string => String(u ?? "").toLowerCase().replace(/\/+$/, "").split("/").pop() ?? ""
const stat = (it: Record<string, any>, ...titles: string[]): Array<{ title: string; count: number }> | null => {
  const s = ((it.peopleStats ?? []) as Array<{ statTitle: string; values: Array<{ title: string; count: number }> }>).find((x) => titles.includes(x.statTitle))
  return s ? s.values.slice(0, 10).map((v) => ({ title: v.title, count: v.count })) : null
}
let stored = 0
const refused: string[] = [], missing: string[] = []
for (const e of employers) {
  const it = items.find((x) => (REFRESH ? slug(x.linkedinUrl) === slug(e.page) : (x.originalQuery?.search ?? x.originalQuery ?? x.employer) === e.display || x.employer === e.employer))
  if (!it) { missing.push(e.display); continue }
  if (!sameCompany({ name: it.name, url: it.linkedinUrl }, e.employer, e.display, e.page)) { refused.push(`${e.display} -> ${it.name}`); continue }
  if (DRY) { stored++; continue }
  const locs = ((it.locations ?? []) as Array<Record<string, any>>)
  const hq = locs.find((l) => l.headquarter)
  const range = it.employeeCountRange ? `${it.employeeCountRange.start ?? ""}${it.employeeCountRange.end ? `-${it.employeeCountRange.end}` : "+"}` : null
  await sql(`
    insert into employer_facts (employer, linkedin_url, name, tagline, description, website, founded_year, employees, employee_range, followers, company_type, headquarters, locations, linkedin_industry, specialities, top_locations, top_schools, top_functions, top_fields, fetched_at, logo)
    values (${lit(e.employer)}, ${lit(it.linkedinUrl)}, ${lit(it.name)}, ${lit(it.tagline)}, ${lit(String(it.description ?? "").slice(0, 4000))}, ${lit(it.website)},
      ${num(it.foundedOn?.year)}, ${num(it.employeeCount)}, ${range ? lit(range) : "null"}, ${num(it.followerCount)}, ${lit(it.companyType)},
      ${hq?.parsed?.text ? lit(hq.parsed.text) : "null"}, ${jsonb(locs.slice(0, 20).map((l) => ({ city: l.city ?? l.parsed?.city ?? null, country: l.parsed?.country ?? l.country ?? null })))},
      ${lit(it.industries?.[0]?.name)}, ${it.specialities?.length ? `array[${(it.specialities as string[]).slice(0, 20).map(lit).join(",")}]` : "null"},
      ${jsonb(stat(it, "Locations", "Where they live"))}, ${jsonb(stat(it, "School", "Where they studied"))}, ${jsonb(stat(it, "Function", "What they do"))}, ${jsonb(stat(it, "Field of study", "What they studied"))}, current_date, ${it.logo ? lit(it.logo) : "null"})
    on conflict (employer) do update set linkedin_url = excluded.linkedin_url, name = excluded.name, tagline = excluded.tagline, description = excluded.description, website = excluded.website,
      founded_year = excluded.founded_year, employees = excluded.employees, employee_range = excluded.employee_range, followers = excluded.followers, company_type = excluded.company_type,
      headquarters = excluded.headquarters, locations = excluded.locations, linkedin_industry = excluded.linkedin_industry, specialities = excluded.specialities,
      top_locations = coalesce(excluded.top_locations, employer_facts.top_locations), top_schools = coalesce(excluded.top_schools, employer_facts.top_schools),
      top_functions = coalesce(excluded.top_functions, employer_facts.top_functions), top_fields = coalesce(excluded.top_fields, employer_facts.top_fields), fetched_at = current_date, logo = coalesce(excluded.logo, employer_facts.logo)`)
  if (it.employeeCount) await sql(`insert into employer_headcount (employer, read_on, employees, source) values (${lit(e.employer)}, current_date, ${num(it.employeeCount)}, 'linkedin') on conflict (employer, read_on, source) do update set employees = excluded.employees`)
  stored++
}
console.log(`${DRY ? "would store" : "stored"} ${stored}; refused (another company): ${refused.join("; ") || "none"}; not found: ${missing.join(", ") || "none"}`)
