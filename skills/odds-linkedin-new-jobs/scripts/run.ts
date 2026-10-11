/**
 * New internship and entry jobs in the Netherlands from LinkedIn, newest first, into odds' postings table (lib/intake.ts rules).
 *
 *   bun skills/odds-linkedin-new-jobs/scripts/run.ts [--since day|week|month] [--per-query 100] [--queries "intern,graduate"] [--dry]
 *       Apify actor valig/linkedin-jobs-scraper (LinkedIn's own filters: Netherlands, posted since, experience Internship + Entry level).
 *   bun skills/odds-linkedin-new-jobs/scripts/run.ts --from-dataset <apify dataset id> [--dry]
 *       Items of an earlier valig run (already paid for).
 *   bun skills/odds-linkedin-new-jobs/scripts/run.ts --from-file jobs.json [--dry]
 *       What an agent collected in the browser (see SKILL.md for the shape).
 */
import { readFileSync } from "node:fs"
import { ApifyUnavailable, apifyReady, datasetItems, runActor } from "../../../lib/apify"
import { arg, flag } from "../../../lib/env"
import { addJobs, type JobInput } from "../../../lib/intake"

const DRY = flag("--dry")
const FILE = arg("--from-file", "")
const DATASET = arg("--from-dataset", "")
const SINCE = { day: "r86400", week: "r604800", month: "r2592000" }[arg("--since", "week")] ?? "r604800"
const PER = Number(arg("--per-query", "100"))
const QUERIES = arg("--queries", "intern,internship,graduate,junior,trainee,working student,entry level,starter").split(",").map((q) => q.trim()).filter(Boolean)

const linkedinUrl = (id: string): string => `https://www.linkedin.com/jobs/view/${id}`
const dayOf = (v: unknown): string | null => (v && !Number.isNaN(Date.parse(String(v))) ? new Date(String(v)).toISOString().slice(0, 10) : null)

let jobs: JobInput[] = []
if (FILE) {
  const raw = JSON.parse(readFileSync(FILE, "utf8")) as Array<Record<string, any>>
  jobs = raw.map((x) => ({
    ats: "linkedin", source: "linkedin_browser", externalId: String(x.id), url: linkedinUrl(String(x.id)), title: String(x.title ?? ""), company: String(x.company ?? ""),
    place: String(x.place ?? ""), description: String(x.description ?? ""), postedOn: dayOf(x.postedOn), applicants: Number(x.applicants) || null, applicantsText: x.applicantsText ?? null,
    seniority: x.seniority ?? null, closed: Boolean(x.closed),
  }))
} else {
  if (!DATASET && !(await apifyReady())) {
    console.log("Switch to the browser route in SKILL.md (or ask the user for a working Apify token).")
    process.exit(3)
  }
  const seen = new Set<string>()
  for (const q of DATASET ? ["(dataset)"] : QUERIES) {
    try {
      const items = DATASET ? await datasetItems(DATASET) : (await runActor("valig/linkedin-jobs-scraper", { keywords: q, location: "Netherlands", datePosted: SINCE, limit: PER, urlParam: [{ key: "f_E", value: "1,2" }] })).items
      for (const x of items as Array<Record<string, any>>) {
        const id = String(x.id ?? "")
        if (!/^\d{8,12}$/.test(id) || seen.has(id)) continue
        seen.add(id)
        jobs.push({
          ats: "linkedin", source: "linkedin_apify", externalId: id, url: linkedinUrl(id), title: String(x.title ?? ""), company: String(x.companyName ?? ""), place: String(x.location ?? ""),
          description: String(x.description ?? ""), postedOn: dayOf(x.postedDate), applicants: Number(/\d+/.exec(String(x.applicationsCount ?? ""))?.[0]) || null,
          applicantsText: x.applicationsCount ?? null, seniority: x.experienceLevel || x.contractType || null,
        })
      }
    } catch (e) {
      if (e instanceof ApifyUnavailable) { console.log(`APIFY UNAVAILABLE: ${e.message}\nSwitch to the browser route in SKILL.md.`); break }
      console.log(`  "${q}" failed: ${(e as Error).message}`)
    }
  }
  console.log(`${jobs.length} distinct jobs found on LinkedIn`)
}

jobs.sort((a, b) => String(b.postedOn ?? "").localeCompare(String(a.postedOn ?? "")))
const res = await addJobs(jobs, DRY)
console.log("result:", res.tally)
for (const r of res.rows.slice(0, 15)) console.log(`  + ${r.posted_on ?? "?"} | ${r.title} | ${r.employer} | ${r.region}`)
console.log(DRY ? "dry run: nothing saved" : `saved ${res.saved}. Next: in the odds repo run scripts/after-new-jobs.sh (field, industry, logo, audit).`)
