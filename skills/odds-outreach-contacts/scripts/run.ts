/**
 * People to reach out to for each job in scope, newest jobs first, per employer and department (the job's `family`):
 *   1. hiring managers: managers, heads, leads and directors in the job's department
 *   2. peers: everyone else in that department who is not senior (entry and in-training levels)
 *   3. adjacent: when 1 or 2 found nobody, the same two searches in the nearest departments (lib/rules.ts adjacentDepartments)
 *   4. recruiters: talent acquisition, HR, early careers (once per employer)
 * Found with Google (apify/google-search-scraper) and read with supreme_coder/linkedin-profile-scraper (lib/people.ts).
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
import { ApifyUnavailable, apifyReady } from "../../../lib/apify"
import { currentPositions, discover, profileQueries, readProfiles, type Profile } from "../../../lib/people"
import { jsonb, lit, sql } from "../../../lib/db"
import { arg, flag } from "../../../lib/env"
import { DEPARTMENT_TITLES, MANAGER, RECRUITER, SENIOR, adjacentDepartments, departmentKey, departmentOf, inNL, loadPages, pageOf, sameCompany } from "../../../lib/rules"
import { DAY, scopeWhere } from "../../../lib/scope"

const DRY = flag("--dry"), LINK_ONLY = flag("--link-only")
const FILE = arg("--from-file", "")
const DAYS = Number(arg("--days", "30")), LIMIT = Number(arg("--limit", "100000"))

type Role = "department_manager" | "hiring_manager" | "peer" | "adjacent_manager" | "adjacent_peer" | "recruiter"
const RANK: Record<Role, number> = { hiring_manager: 1, department_manager: 1, peer: 2, adjacent_manager: 3, adjacent_peer: 4, recruiter: 5 }
interface Person { url: string; name: string; title: string; headline: string; company: string; companyUrl: string; place: string; photo: string; since: string }

function fits(p: Person, role: Role): string | null {
  if (!p.company) return "not at the company now"
  if (!inNL(p.place)) return "not in the Netherlands"
  const t = p.title || p.headline
  // Their current position title must say it (a headline can mention recruitment for other reasons).
  if (role === "recruiter") return RECRUITER.test(p.title || p.headline) ? null : "title is not recruiting/HR"
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
      pairs.push({ employer: j.employer, display: j.display, family, newest: j.day, has_mgr: has(j.employer, ["hiring_manager", "department_manager", "adjacent_manager"], family), has_peer: has(j.employer, ["peer", "adjacent_peer"], family), has_rec: has(j.employer, ["recruiter"], null) })
    }
    const todo = pairs.filter((p) => !(p.has_mgr && p.has_peer && p.has_rec)).slice(0, LIMIT)
    console.log(`${pairs.length} employer-and-department pairs, ${todo.length} to search (newest jobs first)`)
    if (DRY) { for (const p of todo.slice(0, 30)) console.log(`  ${p.newest} ${p.display} / ${p.family ?? "(no department)"} -> ${pageOf(p.employer, p.display) ?? "NO LINKEDIN PAGE (run odds-company-info first)"}`); process.exit(0) }
    if (!(await apifyReady())) { console.log("Switch to the browser route in SKILL.md (or ask the user for a working Apify token)."); process.exit(3) }
    // Google finds candidates (apify/google-search-scraper), their whole profiles are read (supreme_coder/linkedin-profile-scraper), and the
    // fixed rules keep the ones who work at this employer now, in the Netherlands, with a title that fits. Pairs go in batches of BATCH.
    const BATCH = Number(arg("--batch", "8")), READ = Number(arg("--read", "6"))
    const words = (d: string | null): string[] => (d ? DEPARTMENT_TITLES[d] ?? [] : []).filter((w) => w.length > 2).slice(0, 2)
    const titlesFor = (role: Role, d: string | null): string[] =>
      role === "recruiter" ? ["recruiter", "talent acquisition", "HR business partner", "campus recruiter", "early careers"]
      : role.endsWith("manager") ? words(d).flatMap((w) => [`${w} manager`, `head of ${w}`, `${w} lead`, `${w} director`])
      : words(d).flatMap((w) => [w, `junior ${w}`, `${w} associate`, `${w} specialist`])
    const toPerson = (pr: Profile, employer: string, display: string, page: string): Person => {
      const cur = currentPositions(pr)
      const here = cur.find((c) => sameCompany({ name: c.companyName, url: c.companyLinkedinUrl }, employer, display, page))
      return { url: pr.linkedinUrl, name: `${pr.firstName} ${pr.lastName}`.trim(), title: here?.position ?? "", headline: pr.headline, company: here?.companyName ?? "", companyUrl: here?.companyLinkedinUrl ?? "", place: pr.location.linkedinText, photo: pr.photo, since: String(here?.startDate?.year ?? "") }
    }
    const recruitersDone = new Set<string>()
    try {
      for (let b = 0; b < todo.length; b += BATCH) {
        const batch = todo.slice(b, b + BATCH).map((pair) => ({ pair, page: pageOf(pair.employer, pair.display) }))
        for (const x of batch) if (!x.page) console.log(`- ${x.pair.display}: no LinkedIn company page known (run odds-company-info first), skipped`)
        const runRound = async (wanted: Array<{ pair: (typeof todo)[0]; page: string; role: Role; dep: string | null }>): Promise<Map<string, Person[]>> => {
          const qsOf = wanted.map((w) => profileQueries(w.pair.display, titlesFor(w.role, w.dep), "Netherlands", 3))
          const found = await discover([...new Set(qsOf.flat())])
          // The results of one search's queries are merged (first results of each query first), then the top READ are read in full.
          const topOf = (qs: string[]): string[] => {
            const lists = qs.map((q) => (found.get(q) ?? []).map((r) => r.url)), merged: string[] = []
            for (let k = 0; merged.length < READ && k < 10; k++) for (const l of lists) if (l[k] && !merged.includes(l[k]) && merged.length < READ) merged.push(l[k])
            return merged
          }
          const profiles = await readProfiles([...new Set(qsOf.flatMap(topOf))])
          const out = new Map<string, Person[]>()
          wanted.forEach((w, i) => {
            const people = topOf(qsOf[i]).map((u) => profiles.get(u)).filter((p): p is Profile => Boolean(p)).map((p) => toPerson(p, w.pair.employer, w.pair.display, w.page))
            out.set(`${w.pair.employer}|${w.pair.family}|${w.role}|${w.dep}`, people.filter((p) => !fits(p, w.role)))
          })
          return out
        }
        const first: Array<{ pair: (typeof todo)[0]; page: string; role: Role; dep: string | null }> = []
        for (const { pair, page } of batch) {
          if (!page) continue
          if (pair.family && !pair.has_mgr) first.push({ pair, page, role: "department_manager", dep: pair.family })
          if (pair.family && !pair.has_peer) first.push({ pair, page, role: "peer", dep: pair.family })
          if (!pair.has_rec && !recruitersDone.has(pair.employer)) { recruitersDone.add(pair.employer); first.push({ pair, page, role: "recruiter", dep: null }) }
        }
        const got = await runRound(first)
        const second: typeof first = []
        for (const w of first) {
          const kept = got.get(`${w.pair.employer}|${w.pair.family}|${w.role}|${w.dep}`) ?? []
          await store(w.pair.employer, w.role, w.dep, kept)
          console.log(`- ${w.pair.newest} ${w.pair.display} / ${w.dep ?? "-"} ${w.role}: ${kept.length}`)
          const adj = adjacentDepartments(w.dep)[0]
          if (kept.length === 0 && adj && (w.role === "department_manager" || w.role === "hiring_manager" || w.role === "peer")) second.push({ ...w, role: w.role === "department_manager" || w.role === "hiring_manager" ? "adjacent_manager" : "adjacent_peer", dep: adj })
        }
        if (second.length) {
          const got2 = await runRound(second)
          for (const w of second) {
            const kept = got2.get(`${w.pair.employer}|${w.pair.family}|${w.role}|${w.dep}`) ?? []
            await store(w.pair.employer, w.role, w.dep, kept)
            console.log(`- ${w.pair.newest} ${w.pair.display} / ${w.dep} ${w.role}: ${kept.length}`)
          }
        }
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
    from jobs j join job_people p on coalesce(p.jev->>'decision_final', '') <> 'reject'
      and (lower(p.employer) = lower(j.employer) or exists (select 1 from employer_facts f1 join employer_facts f2 on f2.linkedin_url = f1.linkedin_url
        where f1.linkedin_url is not null and lower(f1.employer) = lower(j.employer) and lower(f2.employer) = lower(p.employer)))  -- same LinkedIn page = same company
  )
  insert into job_outreach_contacts (posting_id, employer, profile_url, role, department, rank)
  select distinct on (l.posting_id, l.profile_url) l.posting_id, l.employer, l.profile_url, l.role, l.department,
    case l.role when 'hiring_manager' then 1 when 'department_manager' then 1 when 'peer' then 2 when 'adjacent_manager' then 3 when 'adjacent_peer' then 4 when 'recruiter' then 5 else 6 end
      + case when l.department is not null and l.department is distinct from (select family from jobs where id = l.posting_id) and l.role in ('hiring_manager','department_manager','peer') then 2 else 0 end
  from links l where l.role is not null
  order by l.posting_id, l.profile_url, 6
  on conflict (posting_id, profile_url) do update set role = excluded.role, department = excluded.department, rank = excluded.rank
  returning 1 as n`)
console.log(`linked ${out.length} contacts to jobs`)
void departmentOf; void RANK
