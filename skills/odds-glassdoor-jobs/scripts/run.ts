/**
 * New internship and entry jobs in the Netherlands from Glassdoor, newest first, into odds' postings table (lib/intake.ts rules).
 *
 *   bun skills/odds-glassdoor-jobs/scripts/run.ts [--days 7] [--per-query 100] [--queries "intern,graduate"] [--dry]
 *       Apify actor valig/glassdoor-jobs-scraper.
 *   bun skills/odds-glassdoor-jobs/scripts/run.ts --from-dataset <apify dataset id> [--dry]
 *   bun skills/odds-glassdoor-jobs/scripts/run.ts --from-file jobs.json [--dry]      (collected in the browser; shape in SKILL.md)
 */
import { readFileSync } from "node:fs"
import { ApifyUnavailable, apifyReady, datasetItems, runActor } from "../../../lib/apify"
import { arg, flag } from "../../../lib/env"
import { addJobs, type JobInput } from "../../../lib/intake"

const DRY = flag("--dry")
const FILE = arg("--from-file", ""), DATASET = arg("--from-dataset", "")
const DAYS = Number(arg("--days", "7")), PER = Number(arg("--per-query", "100"))
const QUERIES = arg("--queries", "intern,internship,graduate,junior,trainee,working student,entry level").split(",").map((q) => q.trim()).filter(Boolean)

const text = (html: unknown): string => String(html ?? "").replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, "\n").replace(/<li[^>]*>/gi, "- ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\n{3,}/g, "\n\n").trim()
const daysAgo = (n: unknown): string | null => (Number.isFinite(Number(n)) ? new Date(Date.now() - Number(n) * 86_400_000).toISOString().slice(0, 10) : null)
// Glassdoor gives a city without its country: the search is limited to the Netherlands, so the country is added for the intake's place check.
const placeOf = (loc: Record<string, any> | string | undefined): string => {
  const name = typeof loc === "string" ? loc : String(loc?.name ?? "")
  return /netherlands|nederland/i.test(name) ? name : `${name}, Netherlands`
}
const fromItem = (x: Record<string, any>, source: string): JobInput => ({
  ats: "glassdoor", source, externalId: String(x.id ?? x.jobId), url: String(x.seoUrl ?? x.url), title: String(x.title ?? x.profile?.title ?? ""),
  company: String(x.employer?.name ?? x.company ?? ""), place: placeOf(x.location ?? x.place), description: text(x.description ?? x.profile?.description),
  postedOn: x.postedOn ?? daysAgo(x.ageInDays),
})

let jobs: JobInput[] = []
if (FILE) {
  jobs = (JSON.parse(readFileSync(FILE, "utf8")) as Array<Record<string, any>>).map((x) => fromItem(x, "glassdoor_browser"))
} else {
  if (!DATASET && !(await apifyReady())) { console.log("Switch to the browser route in SKILL.md (or ask the user for a working Apify token)."); process.exit(3) }
  const seen = new Set<string>()
  for (const q of DATASET ? ["(dataset)"] : QUERIES) {
    try {
      const items = DATASET ? await datasetItems(DATASET) : (await runActor("valig/glassdoor-jobs-scraper", { keywords: q, location: "Netherlands", daysOld: DAYS, sortBy: "date_desc", limit: PER })).items
      for (const x of items as Array<Record<string, any>>) {
        const j = fromItem(x, "glassdoor_apify")
        if (!j.externalId || seen.has(j.externalId)) continue
        seen.add(j.externalId)
        jobs.push(j)
      }
    } catch (e) {
      if (e instanceof ApifyUnavailable) { console.log(`APIFY UNAVAILABLE: ${e.message}\nSwitch to the browser route in SKILL.md.`); break }
      console.log(`  "${q}" failed: ${(e as Error).message}`)
    }
  }
  console.log(`${jobs.length} distinct jobs found on Glassdoor`)
}

jobs.sort((a, b) => String(b.postedOn ?? "").localeCompare(String(a.postedOn ?? "")))
const res = await addJobs(jobs, DRY)
console.log("result:", res.tally)
for (const r of res.rows.slice(0, 15)) console.log(`  + ${r.posted_on ?? "?"} | ${r.title} | ${r.employer} | ${r.region}`)
console.log(DRY ? "dry run: nothing saved" : `saved ${res.saved}. Next: in the odds repo run scripts/after-new-jobs.sh (field, industry, logo, audit).`)
