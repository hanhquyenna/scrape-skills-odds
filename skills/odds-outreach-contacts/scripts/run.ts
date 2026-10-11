/**
 * People to reach out to for each job in scope, newest jobs first, per employer and department (the job's `family`):
 *   1. hiring managers: managers, heads, leads and directors in the job's department
 *   2. peers: everyone else in that department who is not senior (entry and in-training levels)
 *   3. adjacent: when 1 or 2 found nobody, the same two searches in the nearest departments (lib/rules.ts adjacentDepartments)
 *   4. recruiters: talent acquisition, HR, early careers (once per employer)
 * Stored per employer in job_people (jev.role, jev.department), then linked to each job in job_outreach_contacts with a rank
 * (1 hiring manager, 2 peer, 3 adjacent manager, 4 adjacent peer, 5 recruiter).
 *
 *   bun skills/odds-outreach-contacts/scripts/run.ts [--days 30] [--limit 50] [--dry]       Apify harvestapi/linkedin-profile-search (Short)
 *   bun skills/odds-outreach-contacts/scripts/run.ts --from-file people.json [--dry]         collected in the browser (shape in SKILL.md)
 *   bun skills/odds-outreach-contacts/scripts/run.ts --link-only                             only the job links (free)
 * --limit counts employer-and-department pairs. A pair already searched is skipped.
 * A person is kept only when, by fixed rules, their current position is at this employer, they are in the Netherlands, and their title
 * fits the role searched for.
 */
import { readFileSync } from "node:fs"
import { ApifyUnavailable, apifyReady, runActor } from "../../../lib/apify"
import { jsonb, lit, sql } from "../../../lib/db"
import { arg, flag } from "../../../lib/env"
import { DEPARTMENT_TITLES, MANAGER, RECRUITER, SENIOR, adjacentDepartments, departmentKey, departmentOf, inNL, loadPages, pageOf, sameCompany } from "../../../lib/rules"
import { DAY, scopeWhere } from "../../../lib/scope"

const DRY = flag("--dry"), LINK_ONLY = flag("--link-only")
const FILE = arg("--from-file", "")
const DAYS = Number(arg("--days", "30")), LIMIT = Number(arg("--limit", "100000"))

type Role = "hiring_manager" | "peer" | "adjacent_manager" | "adjacent_peer" | "recruiter"
const RANK: Record<Role, number> = { hiring_manager: 1, peer: 2, adjacent_manager: 3, adjacent_peer: 4, recruiter: 5 }
interface Person { url: string; name: string; title: string; headline: string; company: string; companyUrl: string; place: string; photo: string; since: string }

function fits(p: Person, role: Role): string | null {
  if (!p.company) return "not at the company now"
  if (!inNL(p.place)) return "not in the Netherlands"
  const t = p.title || p.headline
  if (role === "recruiter") return RECRUITER.test(`${t} ${p.headline}`) ? null : "title is not recruiting/HR"
  if (RECRUITER.test(t)) return "a recruiter, not in the department"
  if (role.endsWith("manager")) return MANAGER.test(t) ? null : "title is not a manager"
  return SENIOR.test(t) ? "senior" : null
}

async function store(employer: string, role: Role, department: string | null, people: Person[]): Promise<void> {
  if (!people.length) return
  await sql(`insert into job_people (employer, profile_url, name, headline, place, photo, positions, jev) values ${people.map((p) => `(${lit(employer)}, ${lit(p.url)}, ${lit(p.name)}, ${lit(p.title || p.headline)}, ${lit(p.place)}, ${lit(p.photo)}, ${jsonb([{ title: p.title, company: p.company, since: p.since }])}, ${jsonb({ source: "rules", role, department, decision_final: "keep", company: p.company })})`).join(",")}
    on conflict (employer, profile_url) do update set headline = excluded.headline, place = excluded.place, positions = excluded.positions,
      jev = job_people.jev || jsonb_build_object('role', case when (job_people.jev->>'role') is null then excluded.jev->>'role' else job_people.jev->>'role' end, 'department', coalesce(job_people.jev->>'department', excluded.jev->>'department'), 'source', 'rules', 'decision_final', 'keep'), fetched_at = now()`)
}

if (!LINK_ONLY) {
  if (FILE) {
    // [{ employer, role, department, people: [{ url, name, title, headline, company, companyUrl, place, photo }] }]
    const data = JSON.parse(readFileSync(FILE, "utf8")) as Array<{ employer: string; display?: string; role: Role; department?: string | null; people: Person[] }>
    let kept = 0
    for (const g of data) {
      const ok = (g.people ?? []).filter((p) => sameCompany({ name: p.company, url: p.companyUrl }, g.employer, g.display ?? g.employer) && !fits(p, g.role))
      kept += ok.length
      if (!DRY) await store(g.employer, g.role, g.department ?? null, ok)
    }
    console.log(`${DRY ? "would keep" : "kept"} ${kept} people from the file`)
  } else {
    await loadPages()
    // Employer-and-department pairs, newest job first; the department is one of the standard ones (lib/rules.ts departmentKey).
    const jobRows = await sql<{ employer: string; display: string; family: string | null; title: string; day: string }>(`
      select employer, coalesce(employer_display, employer) as display, family, coalesce(title_clean, title) as title, ${DAY}::text as day from app_jobs where ${scopeWhere(DAYS)} order by ${DAY} desc`)
    const have = await sql<{ employer: string; role: string; department: string | null }>(`select distinct employer, jev->>'role' as role, jev->>'department' as department from job_people where jev->>'source' = 'rules'`)
    const has = (e: string, roles: string[], d: string | null): boolean => have.some((h) => h.employer === e && roles.includes(h.role) && (d === null || h.department === d))
    const seen = new Set<string>()
    const pairs: Array<{ employer: string; display: string; family: string | null; newest: string; has_mgr: boolean; has_peer: boolean; has_rec: boolean }> = []
    for (const j of jobRows) {
      const family = departmentKey(j.family, j.title)
      const key = `${j.employer}\u0000${family}`
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push({ employer: j.employer, display: j.display, family, newest: j.day, has_mgr: has(j.employer, ["hiring_manager", "adjacent_manager"], family), has_peer: has(j.employer, ["peer", "adjacent_peer"], family), has_rec: has(j.employer, ["recruiter"], null) })
    }
    const todo = pairs.filter((p) => !(p.has_mgr && p.has_peer && p.has_rec)).slice(0, LIMIT)
    console.log(`${pairs.length} employer-and-department pairs, ${todo.length} to search (newest jobs first)`)
    if (DRY) { for (const p of todo.slice(0, 30)) console.log(`  ${p.newest} ${p.display} / ${p.family ?? "(no department)"} -> ${pageOf(p.employer, p.display) ?? "NO LINKEDIN PAGE (run odds-company-info first)"}`); process.exit(0) }
    if (!(await apifyReady())) { console.log("Switch to the browser route in SKILL.md (or ask the user for a working Apify token)."); process.exit(3) }
    const recruitersDone = new Set<string>()
    const search = async (page: string, titles: string[], seniority: string[] | null): Promise<Person[]> => {
      const { items } = await runActor("harvestapi/linkedin-profile-search", { currentCompanies: [page], locations: ["Netherlands"], currentJobTitles: titles, ...(seniority ? { seniorityLevelIds: seniority } : {}), maxItems: 25, takePages: 1, profileScraperMode: "Short" }, { quiet: true })
      return (items as Array<Record<string, any>>).filter((p) => p.linkedinUrl).map((p) => {
        const cur = (Array.isArray(p.currentPositions) ? p.currentPositions : []) as Array<Record<string, any>>
        const here = cur.find((c) => c.companyLinkedinUrl && page.toLowerCase().includes(String(c.companyLinkedinUrl).toLowerCase().replace(/\/+$/, "").split("/").pop() ?? "~")) ?? cur[0] ?? {}
        return { url: String(p.linkedinUrl), name: [p.firstName, p.lastName].filter(Boolean).join(" "), title: String(here.title ?? ""), headline: String(p.headline ?? ""), company: String(here.companyName ?? ""), companyUrl: String(here.companyLinkedinUrl ?? ""), place: String(p.location?.linkedinText ?? ""), photo: String(p.photo ?? ""), since: String(here.startedOn?.year ?? "") }
      })
    }
    try {
      for (const pair of todo) {
        const page = pageOf(pair.employer, pair.display)
        if (!page) { console.log(`- ${pair.display}: no LinkedIn company page known (run odds-company-info first), skipped`); continue }
        const keep = (list: Person[], role: Role): Person[] => list.filter((p) => sameCompany({ name: p.company, url: p.companyUrl }, pair.employer, pair.display, page) && !fits(p, role))
        const dep = pair.family
        const titlesOf = (d: string | null): string[] => (d ? DEPARTMENT_TITLES[d] ?? [] : []).slice(0, 6)
        const line: string[] = []
        let mgr: Person[] = [], peer: Person[] = []
        if (dep && !pair.has_mgr) { mgr = keep(await search(page, titlesOf(dep), ["200", "210", "220"]), "hiring_manager"); await store(pair.employer, "hiring_manager", dep, mgr); line.push(`managers ${mgr.length}`) }
        if (dep && !pair.has_peer) { peer = keep(await search(page, titlesOf(dep), ["100", "110"]), "peer"); await store(pair.employer, "peer", dep, peer); line.push(`peers ${peer.length}`) }
        for (const adj of dep && (!pair.has_mgr && mgr.length === 0 || !pair.has_peer && peer.length === 0) ? adjacentDepartments(dep).slice(0, 2) : []) {
          if (!pair.has_mgr && mgr.length === 0) { const a = keep(await search(page, titlesOf(adj), ["200", "210", "220"]), "adjacent_manager"); await store(pair.employer, "adjacent_manager", adj, a); line.push(`adjacent managers (${adj}) ${a.length}`); mgr = a }
          if (!pair.has_peer && peer.length === 0) { const a = keep(await search(page, titlesOf(adj), ["100", "110"]), "adjacent_peer"); await store(pair.employer, "adjacent_peer", adj, a); line.push(`adjacent peers (${adj}) ${a.length}`); peer = a }
        }
        if (!pair.has_rec && !recruitersDone.has(pair.employer)) {
          recruitersDone.add(pair.employer)
          const r = keep(await search(page, ["recruiter", "talent acquisition", "HR business partner", "early careers", "campus recruiter", "people partner"], null), "recruiter")
          await store(pair.employer, "recruiter", null, r); line.push(`recruiters ${r.length}`)
        }
        console.log(`- ${pair.newest} ${pair.display} / ${dep ?? "(no department)"}: ${line.join(", ") || "nothing new to search"}`)
      }
    } catch (e) {
      if (e instanceof ApifyUnavailable) console.log(`APIFY UNAVAILABLE: ${e.message}\nStopped. Continue with the browser route in SKILL.md.`)
      else throw e
    }
  }
}
if (DRY) process.exit(0)

// Each job's contacts, best first: rank by role, the job's own department before an adjacent one.
await sql(`create table if not exists public.job_outreach_contacts (
  posting_id text not null, employer text not null, profile_url text not null, role text not null, department text, rank int not null,
  primary key (posting_id, profile_url));
  alter table public.job_outreach_contacts enable row level security;`)
const out = await sql<{ n: number; jobs: number }>(`
  with jobs as (select id, employer, family from app_jobs where ${scopeWhere(DAYS)}),
  links as (
    select j.id posting_id, p.employer, p.profile_url, coalesce(p.jev->>'role', case when p.headline ~* 'recruit|talent|\\mhr\\M|human resources' then 'recruiter' end) role, p.jev->>'department' department
    from jobs j join job_people p on p.employer = j.employer and coalesce(p.jev->>'decision_final', '') <> 'reject'
  )
  insert into job_outreach_contacts (posting_id, employer, profile_url, role, department, rank)
  select l.posting_id, l.employer, l.profile_url, l.role, l.department,
    case l.role when 'hiring_manager' then 1 when 'peer' then 2 when 'adjacent_manager' then 3 when 'adjacent_peer' then 4 when 'recruiter' then 5 else 6 end
      + case when l.department is not null and l.department is distinct from (select family from jobs where id = l.posting_id) and l.role in ('hiring_manager','peer') then 2 else 0 end
  from links l where l.role is not null
  on conflict (posting_id, profile_url) do update set role = excluded.role, department = excluded.department, rank = excluded.rank
  returning 1 as n`)
console.log(`linked ${out.length} contacts to jobs`)
void departmentOf; void RANK
