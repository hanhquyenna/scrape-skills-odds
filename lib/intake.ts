/**
 * Adds new jobs to odds' postings table by the same rules the app uses for a pasted link (supabase/functions/_shared/job-intake.ts in
 * the odds repo): outside the Netherlands, closed, needing Dutch, restricted to nationals and duplicate jobs are skipped. Only jobs that
 * fit the table (internship or entry level, English, no Dutch, in the Netherlands) are saved. Afterwards run the odds repo's
 * scripts/after-new-jobs.sh (field, industry, logo, audit).
 *
 * Every source (an Apify actor or what an agent collected in the browser) is first turned into JobInput.
 */
import { join } from "node:path"
import { sql } from "./db"
import { ODDS_REPO } from "./env"

export interface JobInput {
  /** Where it was found: "linkedin" or "glassdoor" (goes to postings.ats). */
  ats: "linkedin" | "glassdoor" | "indeed"
  /** postings.source, e.g. "linkedin_apify", "glassdoor_apify", "linkedin_browser". */
  source: string
  /** The job's own id at the source (LinkedIn job id, Glassdoor listing id). */
  externalId: string
  /** The address people open. LinkedIn: https://www.linkedin.com/jobs/view/<id>. */
  url: string
  title: string
  company: string
  place: string
  /** The full posting text, as written. */
  description: string
  /** YYYY-MM-DD when the source says when it was posted. */
  postedOn?: string | null
  applicants?: number | null
  applicantsText?: string | null
  /** LinkedIn's seniority line ("Internship", "Entry level") when there is one. */
  seniority?: string | null
  validThrough?: string | null
  closed?: boolean
}

const intake = await import(join(ODDS_REPO, "supabase/functions/_shared/job-intake.ts"))
const LEVEL_OK = /\b(intern|internship|stage|stagiair|trainee|traineeship|graduate|junior|entry|starter|associate|werkstudent|working student|student|thesis|graduation|young professional)\b/i
const n = (t: unknown): string => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

export interface IntakeResult { saved: number; tally: Record<string, number>; rows: Array<Record<string, unknown>> }

/** Reads, filters and saves jobs. `dry` reads and filters only. */
export async function addJobs(jobs: JobInput[], dry = false): Promise<IntakeResult> {
  const tally: Record<string, number> = {}
  const bump = (k: string): void => void (tally[k] = (tally[k] ?? 0) + 1)
  const urls = [...new Set(jobs.map((j) => j.url))]
  const held = new Set<string>()
  for (let i = 0; i < urls.length; i += 200) {
    for (const r of await sql<{ url: string }>(`select url from postings where url in (${urls.slice(i, i + 200).map((u) => `$q$${u.replace(/\$q\$/g, "")}$q$`).join(",")})`)) held.add(r.url)
  }
  const companies = [...new Set(jobs.map((j) => j.company.trim()).filter(Boolean))]
  const byEmployer = new Map<string, Array<Record<string, any>>>()
  for (let i = 0; i < companies.length; i += 100) {
    const list = companies.slice(i, i + 100).map((c) => `$q$${c.replace(/\$q\$/g, "")}$q$`).join(",")
    for (const r of await sql(`select employer, employer_display, ind_sponsor, ind_sponsor_name, industry, title, region from postings where employer in (${list}) and closed_at is null`)) {
      byEmployer.set(r.employer, [...(byEmployer.get(r.employer) ?? []), r])
    }
  }
  const today = new Date().toISOString().slice(0, 10)
  const rows: Array<Record<string, unknown>> = []
  for (const j of jobs) {
    if (held.has(j.url)) { bump("already held"); continue }
    const item = { status: "success", job_status: j.closed ? "closed" : null, id: j.externalId, title: j.title, location: j.place, description: j.description, applicants: j.applicants ?? null, applicants_text: j.applicantsText ?? null, seniority_level: j.seniority ?? null, valid_through: j.validThrough ?? null, "company.name": j.company }
    const verdict = intake.readVerdict(item)
    if (verdict !== "open") { bump(verdict); continue }
    if (!intake.inNetherlands(j.place)) { bump("not in the Netherlands"); continue }
    if (!LEVEL_OK.test(j.title) && !/internship|entry/i.test(j.seniority ?? "")) { bump("not internship or entry level"); continue }
    const same = byEmployer.get(j.company.trim()) ?? []
    if (same.some((h) => n(h.title) === n(j.title) && intake.cityOf(h.region ?? "") === intake.cityOf(j.place)) || rows.some((r) => r.employer === j.company.trim() && n(r.title) === n(j.title) && intake.cityOf(String(r.region)) === intake.cityOf(j.place))) { bump("duplicate"); continue }
    const known = same[0] ? { employer_display: same[0].employer_display, ind_sponsor: same[0].ind_sponsor, ind_sponsor_name: same[0].ind_sponsor_name, industry: same.find((h) => h.industry)?.industry ?? null } : null
    const row = await intake.rowFromDetails(item, { id: j.externalId, url: j.url }, known, today, new Date().toISOString())
    if (!row.student_fit) { bump(row.dutch_required ? "needs Dutch" : row.restricted ? "restricted to nationals" : !row.english ? "not in English" : "not a student fit"); continue }
    row.ats = j.ats
    row.source = j.source
    if (j.postedOn) {
      row.posted_on = j.postedOn
      row.days_open = Math.max(0, Math.round((Date.parse(today) - Date.parse(j.postedOn)) / 86_400_000))
      row.freshness_state = (row.days_open as number) <= 6 ? "fresh" : (row.days_open as number) <= 44 ? "active" : "aging"
    }
    rows.push(row)
    bump("to add")
  }
  let saved = 0
  if (!dry && rows.length) {
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))]
    for (let i = 0; i < rows.length; i += 20) {
      const chunk = JSON.stringify(rows.slice(i, i + 20)).replace(/\$j\$/g, "")
      const out = await sql(`insert into postings (${cols.map((c) => `"${c}"`).join(",")}) select ${cols.map((c) => `r."${c}"`).join(",")} from json_populate_recordset(null::postings, $j$${chunk}$j$::json) r on conflict (id) do nothing returning id`)
      saved += out.length
    }
  }
  return { saved, tally, rows }
}
