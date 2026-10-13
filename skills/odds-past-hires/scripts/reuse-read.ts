/**
 * Free: match profiles already read (the profiles.json files written by read-urls.ts in <dir>) against the OTHER jobs of the same employer
 * that still have no past hires, then let `run.ts --from-file` apply the fixed rules (exact / adjacent by title words and department).
 *   bun skills/odds-past-hires/scripts/reuse-read.ts <dir> [--days 7]  ->  <dir>/reuse.json
 *   bun skills/odds-past-hires/scripts/run.ts --from-file <dir>/reuse.json
 * Measured 13 Oct 2026: 7-day past hires (exact or adjacent) 37.0% -> 43.5% at no Apify cost.
 */
import { readdirSync } from "node:fs"
import { sql } from "../../../lib/db"
import { arg } from "../../../lib/env"
import { scopeWhere } from "../../../lib/scope"

const dir = process.argv[2], DAYS = Number(arg("--days", "7"))
const pool = new Map<string, any>()
for (const f of readdirSync(dir).filter((x) => /prof/.test(x) && x.endsWith(".json")))
  for (const g of JSON.parse(await Bun.file(`${dir}/${f}`).text())) for (const p of g.profiles ?? []) pool.set(p.linkedinUrl, p)
const jobs = await sql(`select id, coalesce(employer_display, employer) d from app_jobs where ${scopeWhere(DAYS)}
  and not exists (select 1 from job_candidate_evidence c where c.posting_id = app_jobs.id and c.validation_status = 'validated')`)
const word = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(" ").filter((w) => w.length > 2 && !["the", "group", "holding", "company", "europe", "international", "corporation"].includes(w))[0] ?? "zzz"
const out: Array<{ jobId: string; profiles: any[] }> = []
for (const j of jobs) {
  const w = word(j.d), profiles = [...pool.values()].filter((p) => (p.experience ?? []).some((e: any) => (e.companyName ?? "").toLowerCase().includes(w)))
  if (profiles.length) out.push({ jobId: j.id, profiles })
}
await Bun.write(`${dir}/reuse.json`, JSON.stringify(out))
console.log(`${pool.size} profiles pooled; ${out.length} jobs have candidates from the same employer -> ${dir}/reuse.json`)
