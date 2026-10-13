/**
 * New internship and entry jobs in the Netherlands from Indeed (nl.indeed.com), newest first, into odds' postings table (lib/intake.ts rules).
 *   bun skills/odds-indeed-jobs/scripts/run.ts [--days 7] [--per-query 100] [--queries "intern,graduate"] [--dry]
 * Apify actor valig/indeed-jobs-scraper (~$0.001 per 10 jobs). Indeed also returns the employer's size, revenue band and CEO (kept in the item, not stored here).
 */
import { ApifyUnavailable, apifyReady, runActor } from "../../../lib/apify"
import { arg, flag } from "../../../lib/env"
import { addJobs, type JobInput } from "../../../lib/intake"

const DRY = flag("--dry"), DAYS = Number(arg("--days", "7")), PER = Number(arg("--per-query", "100"))
const QUERIES = arg("--queries", "intern,internship,graduate,junior,trainee,traineeship,working student,student assistant,entry level,thesis,graduation internship,starter,associate,analyst intern").split(",").map((q) => q.trim()).filter(Boolean)
const text = (t: unknown): string => String((t as any)?.text ?? t ?? "")
const dayOf = (v: unknown): string | null => (v && !Number.isNaN(Date.parse(String(v))) ? new Date(String(v)).toISOString().slice(0, 10) : null)

if (!(await apifyReady())) { console.log("Switch to the browser route (or ask the user for a working Apify token)."); process.exit(3) }
const jobs: JobInput[] = [], seen = new Set<string>()
await Promise.all(QUERIES.map(async (q) => {
  try {
    const { items } = await runActor("valig/indeed-jobs-scraper", { country: "nl", title: q, location: "Netherlands", limit: PER, datePosted: String(DAYS) }, { quiet: true })
    for (const x of items as Array<Record<string, any>>) {
      const id = String(x.key ?? ""); if (!id || seen.has(id) || x.expired) continue
      seen.add(id)
      jobs.push({ ats: "indeed", source: "indeed_apify", externalId: id, url: String(x.url ?? `https://nl.indeed.com/viewjob?jk=${id}`), title: String(x.title ?? ""), company: String(x.employer?.name ?? ""),
        place: `${x.location?.city ?? ""}, Netherlands`.replace(/^, /, ""), description: text(x.description), postedOn: dayOf(x.datePublished ?? x.dateOnIndeed) })
    }
  } catch (e) {
    if (e instanceof ApifyUnavailable) console.log(`APIFY UNAVAILABLE: ${e.message}`)
    else console.log(`  "${q}" failed: ${(e as Error).message}`)
  }
}))
console.log(`${jobs.length} distinct jobs found on Indeed`)
jobs.sort((a, b) => String(b.postedOn ?? "").localeCompare(String(a.postedOn ?? "")))
const res = await addJobs(jobs, DRY)
console.log("result:", res.tally)
for (const r of res.rows.slice(0, 15)) console.log(`  + ${r.posted_on ?? "?"} | ${r.title} | ${r.employer} | ${r.region}`)
console.log(DRY ? "dry run: nothing saved" : `saved ${res.saved}. Next: in the odds repo run scripts/after-new-jobs.sh (field, industry, logo, audit).`)
