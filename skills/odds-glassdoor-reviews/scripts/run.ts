/**
 * Glassdoor reviews for the employers of the jobs in scope (newest jobs first), then each job's own reviews: the ones written by people
 * in the same role (title words) or the same department.
 *
 *   bun skills/odds-glassdoor-reviews/scripts/run.ts [--days 30] [--limit 100] [--reviews 100] [--dry]
 *       1. the Glassdoor page: employer_glassdoor's, else Google ("<name> glassdoor reviews", apify/google-search-scraper)
 *       2. the reviews, newest first: kaix/glassdoor-reviews-scraper, all companies in one run
 *       3. match reviews to jobs (job_glassdoor_reviews)
 *   bun skills/odds-glassdoor-reviews/scripts/run.ts --match-only            only step 3 (free)
 *   bun skills/odds-glassdoor-reviews/scripts/run.ts --from-file reviews.json (collected in the browser; shape in SKILL.md), then step 3
 *
 * Kept only when the page's name and the employer Glassdoor names on the reviews are this company (lib/rules.ts sameCompany).
 */
import { readFileSync } from "node:fs"
import { ApifyUnavailable, apifyReady, runActor } from "../../../lib/apify"
import { lit, num, sql } from "../../../lib/db"
import { arg, flag } from "../../../lib/env"
import { departmentOf, sameCompany, titleOverlap } from "../../../lib/rules"
import { employersSql, jobsSql } from "../../../lib/scope"

const DRY = flag("--dry"), MATCH_ONLY = flag("--match-only")
const FILE = arg("--from-file", "")
const DAYS = Number(arg("--days", "30")), LIMIT = Number(arg("--limit", "100")), PER = Number(arg("--reviews", "100"))
const ID = /glassdoor\.[a-z.]+\/Reviews\/([^/?#]+)-Reviews-E(\d+)\.htm/i

interface Review { employer: string; glassdoorId: string; reviewId: string; date: string | null; title: string; role: string; current: boolean | null; place: string; overall: number | null; balance: number | null; culture: number | null; diversity: number | null; career: number | null; pay: number | null; management: number | null; recommend: string | null; ceo: string | null; outlook: string | null; pros: string; cons: string }

async function save(firms: Map<string, { url: string; id: string }>, reviews: Review[]): Promise<void> {
  if (firms.size) await sql(`insert into employer_glassdoor (employer, glassdoor_id, glassdoor_url, scope, read_on) values ${[...firms].map(([e, f]) => `(${lit(e)}, ${lit(f.id)}, ${lit(f.url)}, 'Company-wide Glassdoor profile', current_date)`).join(",")} on conflict (employer) do nothing`)
  for (let i = 0; i < reviews.length; i += 200) {
    await sql(`insert into employer_glassdoor_reviews (employer, review_key, review_date, title, role, status, place, overall, rating_balance, rating_culture, rating_diversity, rating_career, rating_pay, rating_management, recommend, ceo_approval, outlook, pros, cons, read_on)
      values ${reviews.slice(i, i + 200).map((r) => `(${lit(r.employer)}, ${lit(`glassdoor:${r.glassdoorId}:${r.reviewId}`)}, ${r.date ? lit(r.date) + "::date" : "null"}, ${lit(r.title)}, ${lit(r.role)}, ${r.current == null ? "null" : lit(r.current ? "current" : "former")}, ${lit(r.place)},
        ${num(r.overall)}, ${num(r.balance)}, ${num(r.culture)}, ${num(r.diversity)}, ${num(r.career)}, ${num(r.pay)}, ${num(r.management)}, ${r.recommend ? lit(r.recommend) : "null"}, ${r.ceo ? lit(r.ceo) : "null"}, ${r.outlook ? lit(r.outlook) : "null"}, ${lit(r.pros)}, ${lit(r.cons)}, current_date)`).join(",")}
      on conflict (employer, review_key) do nothing`)
  }
}

if (!MATCH_ONLY && FILE) {
  // Browser route: [{ employer, glassdoorUrl, reviews: [{ id, date, title, role, current, place, overall, ..., pros, cons }] }]
  const data = JSON.parse(readFileSync(FILE, "utf8")) as Array<Record<string, any>>
  const firms = new Map<string, { url: string; id: string }>(), all: Review[] = []
  for (const c of data) {
    const m = ID.exec(String(c.glassdoorUrl ?? ""))
    if (!m) { console.log(`  ${c.employer}: no Glassdoor reviews address, skipped`); continue }
    firms.set(c.employer, { url: c.glassdoorUrl, id: m[2] })
    for (const r of c.reviews ?? []) all.push({ employer: c.employer, glassdoorId: m[2], reviewId: String(r.id ?? `${r.date}-${String(r.title).slice(0, 20)}`), date: r.date ?? null, title: r.title ?? "", role: r.role ?? "", current: r.current ?? null, place: r.place ?? "", overall: r.overall ?? null, balance: r.balance ?? null, culture: r.culture ?? null, diversity: r.diversity ?? null, career: r.career ?? null, pay: r.pay ?? null, management: r.management ?? null, recommend: r.recommend ?? null, ceo: r.ceo ?? null, outlook: r.outlook ?? null, pros: r.pros ?? "", cons: r.cons ?? "" })
  }
  if (!DRY) await save(firms, all)
  console.log(`${DRY ? "would store" : "stored"} ${all.length} reviews for ${firms.size} employers`)
} else if (!MATCH_ONLY) {
  if (!(await apifyReady())) { console.log("Switch to the browser route in SKILL.md (or ask the user for a working Apify token)."); process.exit(3) }
  const employers = await sql<{ employer: string; display: string; url: string | null }>(`
    with recent as (${employersSql(DAYS)})
    select r.employer, r.display, g.glassdoor_url as url from recent r left join employer_glassdoor g on g.employer = r.employer
    where not exists (select 1 from employer_glassdoor_reviews v where lower(v.employer) in (lower(r.employer), lower(r.display)))
    limit ${LIMIT}`)
  console.log(`${employers.length} employers without reviews (newest jobs first)`)
  try {
    const need = employers.filter((e) => !e.url)
    if (need.length && !DRY) {
      const { items } = await runActor("apify/google-search-scraper", { queries: need.map((e) => `${e.display} glassdoor reviews`).join("\n"), maxPagesPerQuery: 1, resultsPerPage: 10, countryCode: "nl" })
      for (const res of items as Array<Record<string, any>>) {
        const e = need.find((x) => `${x.display} glassdoor reviews` === res.searchQuery?.term)
        for (const o of (e ? res.organicResults ?? [] : []) as Array<{ url?: string }>) {
          const m = ID.exec(o.url ?? "")
          if (m && e && sameCompany({ name: decodeURIComponent(m[1]).replace(/-/g, " ") }, e.employer, e.display)) { e.url = `https://www.glassdoor.com/Reviews/${m[1]}-Reviews-E${m[2]}.htm`; break }
        }
      }
    }
    const withUrl = employers.filter((e) => e.url && ID.test(e.url))
    console.log(`Glassdoor page found for ${withUrl.length} of ${employers.length}`)
    if (!DRY && withUrl.length) {
      const { items } = await runActor("kaix/glassdoor-reviews-scraper", { urls: withUrl.map((e) => e.url), maxReviews: PER, sort: "DATE", includeCompanyData: false })
      const byId = new Map(withUrl.map((e) => [ID.exec(e.url!)![2], e]))
      const firms = new Map<string, { url: string; id: string }>(), all: Review[] = [], refused = new Set<string>()
      const rec = (v: unknown): string | null => (v === "POSITIVE" ? "yes" : v === "NEGATIVE" ? "no" : null)
      for (const it of items as Array<Record<string, any>>) {
        const e = byId.get(String(it.employer?.id ?? ""))
        if (!e) continue
        if (!sameCompany({ name: it.employer?.shortName ?? it.employer?.name }, e.employer, e.display)) { refused.add(`${e.display} (Glassdoor: ${it.employer?.shortName})`); continue }
        firms.set(e.employer, { url: e.url!, id: String(it.employer.id) })
        const r = it.ratings ?? {}, em = it.employment ?? {}, c = it.content ?? {}
        all.push({ employer: e.employer, glassdoorId: String(it.employer.id), reviewId: String(it.reviewId), date: it.postedAt ? String(it.postedAt).slice(0, 10) : null, title: c.summary ?? "", role: em.jobTitle?.text ?? "", current: em.isCurrentJob ?? null, place: em.location?.name ?? "", overall: r.overall ?? null, balance: r.workLifeBalance ?? null, culture: r.cultureAndValues ?? null, diversity: r.diversityAndInclusion ?? null, career: r.careerOpportunities ?? null, pay: r.compensationAndBenefits ?? null, management: r.seniorLeadership ?? null, recommend: rec(r.recommendation), ceo: r.ceo ? String(r.ceo).toLowerCase() : null, outlook: r.outlook ? String(r.outlook).toLowerCase() : null, pros: c.pros ?? "", cons: c.cons ?? "" })
      }
      await save(firms, all)
      console.log(`stored ${all.length} reviews for ${firms.size} employers; refused (another company): ${[...refused].join("; ") || "none"}`)
    }
  } catch (e) {
    if (e instanceof ApifyUnavailable) { console.log(`APIFY UNAVAILABLE: ${e.message}\nSwitch to the browser route in SKILL.md.`); process.exit(3) }
    throw e
  }
}

// 3. Each job's own reviews: same role (title words shared) first, else same department. Fixed rules, no model.
if (DRY) process.exit(0)
await sql(`create table if not exists public.job_glassdoor_reviews (
  posting_id text not null, employer text not null, review_key text not null, match text not null check (match in ('same_role','same_department')), overlap numeric,
  primary key (posting_id, review_key));
  alter table public.job_glassdoor_reviews enable row level security;
  drop policy if exists job_glassdoor_reviews_read on public.job_glassdoor_reviews;
  create policy job_glassdoor_reviews_read on public.job_glassdoor_reviews for select using (true);
  grant select on public.job_glassdoor_reviews to anon, authenticated;`)
const jobs = await sql<{ id: string; employer: string; display: string; title: string; family: string | null }>(jobsSql(DAYS))
const reviews = await sql<{ employer: string; review_key: string; role: string | null }>(`
  select employer, review_key, role from employer_glassdoor_reviews where coalesce(role, '') <> ''
    and lower(employer) in (select lower(employer) from app_jobs union select lower(employer_display) from app_jobs)`)
const byEmp = new Map<string, typeof reviews>()
for (const r of reviews) byEmp.set(r.employer.toLowerCase(), [...(byEmp.get(r.employer.toLowerCase()) ?? []), r])
const rows: string[] = []
let jobsWithRole = 0, jobsWithDept = 0
for (const j of jobs) {
  const list = byEmp.get(j.employer.toLowerCase()) ?? byEmp.get(j.display.toLowerCase()) ?? []
  const dept = j.family ?? departmentOf(j.title)
  let role = 0, dep = 0
  for (const r of list) {
    const o = titleOverlap(j.title, r.role)
    if (o >= 0.5) { rows.push(`(${lit(j.id)}, ${lit(r.employer)}, ${lit(r.review_key)}, 'same_role', ${o.toFixed(2)})`); role++ }
    else if (dept && departmentOf(r.role) === dept) { rows.push(`(${lit(j.id)}, ${lit(r.employer)}, ${lit(r.review_key)}, 'same_department', ${o.toFixed(2)})`); dep++ }
  }
  if (role) jobsWithRole++
  else if (dep) jobsWithDept++
}
for (let i = 0; i < rows.length; i += 500) await sql(`insert into job_glassdoor_reviews (posting_id, employer, review_key, match, overlap) values ${rows.slice(i, i + 500).join(",")} on conflict (posting_id, review_key) do update set match = excluded.match, overlap = excluded.overlap`)
console.log(`${jobs.length} jobs in scope: ${jobsWithRole} have reviews from the same role, ${jobsWithDept} more from the same department (${rows.length} links)`)
