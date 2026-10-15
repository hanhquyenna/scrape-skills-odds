/**
 * Is each open job in the table still open? LinkedIn jobs are asked through Apify (scrapingmonkey/linkedin-job-details-scraper, ~$0.003 per job),
 * newest jobs first, those not checked for --stale-days days (default 2) first.
 *   open            -> last_checked = now, miss_count = 0
 *   closed          -> closed_at = now (the app then hides it)
 *   nothing returned-> miss_count + 1, closed only after 3 misses in a row (LinkedIn sometimes returns nothing for a live job)
 *   bun skills/odds-verify-live-jobs/scripts/run.ts [--days 30] [--stale-days 2] [--limit 400] [--dry] [--free]
 * --free: no Apify; reads LinkedIn's public job page (jobs-guest API, no login), one job every ~3 s, waits and retries on HTTP 429. Closed = the page says "No longer
 * accepting applications" or the page is gone (404/410); open = the page loads with the job; anything else counts as no answer (3 in a row closes).
 * Jobs from other boards (Glassdoor, Indeed, company sites) are not checked here: the hourly in-database checker covers company sites and ATS boards.
 */
import { ApifyUnavailable, apifyReady, runActor } from "../../../lib/apify"
import { lit, sql } from "../../../lib/db"
import { arg, flag } from "../../../lib/env"
import { DAY } from "../../../lib/scope"

const DAYS = Number(arg("--days", "30")), STALE = Number(arg("--stale-days", "2")), LIMIT = Number(arg("--limit", "400")), DRY = flag("--dry")
const jobs = await sql<{ id: string; url: string; miss: number }>(`
  select p.id, p.url, coalesce(p.miss_count, 0) miss from postings p
  where p.closed_at is null and p.url ilike '%linkedin.com/jobs/view/%' and p.id in (select id from active_internship_entry_english)
    and (p.last_checked is null or p.last_checked < now() - interval '${STALE} days') and ${DAY.replace(/posted_on/g, "p.posted_on").replace(/days_open/g, "p.days_open")} >= current_date - ${DAYS}
  order by ${DAY.replace(/posted_on/g, "p.posted_on").replace(/days_open/g, "p.days_open")} desc limit ${LIMIT}`)
console.log(`${jobs.length} LinkedIn jobs to check (not checked for ${STALE}+ days, posted in the last ${DAYS} days, newest first)`)
if (DRY || !jobs.length) process.exit(0)
const FREE = flag("--free")
if (!FREE && !(await apifyReady())) { console.log("APIFY UNAVAILABLE: ask the user for a token, or run with --free (public pages, slower)"); process.exit(3) }
const idOf = (u: string): string => (/(\d{8,})/.exec(u) ?? [])[1] ?? ""
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function probe(id: string): Promise<"open" | "closed" | "none"> {
  for (let a = 0; a < 4; a++) {
    const r = await fetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`, { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36", "accept-language": "en" } }).catch(() => null)
    if (!r) { await sleep(5000); continue }
    if (r.status === 429) { await sleep(20000 * (a + 1)); continue }
    if (r.status === 404 || r.status === 410) return "closed"
    const t = await r.text()
    if (/No longer accepting applications/i.test(t)) return "closed"
    return r.status === 200 && t.length > 8000 && /top-card|show-more-less-html|description/i.test(t) ? "open" : "none"
  }
  return "none"
}
let open = 0, closed = 0, missed = 0, forced = 0
try {
  if (FREE) {
    let n = 0
    for (const j of jobs) {
      const s = await probe(idOf(j.url)); n++
      if (s === "closed") { await sql(`update postings set closed_at = now(), last_checked = now() where id = ${lit(j.id)}`); closed++ }
      else if (s === "open") { await sql(`update postings set last_checked = now(), miss_count = 0 where id = ${lit(j.id)}`); open++ }
      else if (j.miss + 1 >= 3) { await sql(`update postings set closed_at = now(), last_checked = now(), miss_count = ${j.miss + 1} where id = ${lit(j.id)}`); forced++ }
      else { await sql(`update postings set last_checked = now(), miss_count = ${j.miss + 1} where id = ${lit(j.id)}`); missed++ }
      if (n % 25 === 0) console.log(`${n}/${jobs.length}: open ${open}, closed ${closed}, no answer ${missed}, closed after 3 misses ${forced}`)
      await sleep(3000)
    }
    jobs.length = 0
  }
  for (let i = 0; i < jobs.length; i += 40) {
    const batch = jobs.slice(i, i + 40)
    const { items } = await runActor("scrapingmonkey/linkedin-job-details-scraper", { inputList: batch.map((j) => j.url) }, { quiet: true })
    const by = new Map((items as Array<Record<string, any>>).map((it) => [String(it.id), it]))
    for (const j of batch) {
      const it = by.get(idOf(j.url)), status = String(it?.job_status ?? "").toLowerCase()
      if (it && status === "closed") { await sql(`update postings set closed_at = now(), last_checked = now() where id = ${lit(j.id)}`); closed++ }
      else if (it && status === "open") { await sql(`update postings set last_checked = now(), miss_count = 0 where id = ${lit(j.id)}`); open++ }
      else if (j.miss + 1 >= 3) { await sql(`update postings set closed_at = now(), last_checked = now(), miss_count = ${j.miss + 1} where id = ${lit(j.id)}`); forced++ }
      else { await sql(`update postings set last_checked = now(), miss_count = ${j.miss + 1} where id = ${lit(j.id)}`); missed++ }
    }
    console.log(`batch ${i / 40 + 1}/${Math.ceil(jobs.length / 40)}: open ${open}, closed ${closed}, no answer ${missed}, closed after 3 misses ${forced}`)
  }
} catch (e) { if (e instanceof ApifyUnavailable) console.log(`stopped: ${e.message}`); else throw e }
console.log(`done: ${open} still open, ${closed} closed, ${forced} closed after 3 misses, ${missed} no answer (kept open)`)
