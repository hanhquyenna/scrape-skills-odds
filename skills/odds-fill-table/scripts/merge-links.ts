/**
 * Merges what the helper agents wrote (links_outreach_*.json, links_recruiter_*.json, links_past_*.json in <dir>), drops profiles already stored,
 * and writes <dir>/merged_people.json (for odds-outreach-contacts/scripts/read-urls.ts) and <dir>/merged_past.json (for odds-past-hires/scripts/read-urls.ts).
 *   bun skills/odds-fill-table/scripts/merge-links.ts <dir>
 */
import { readdirSync } from "node:fs"
import { sql } from "../../../lib/db"

const dir = process.argv[2]
const norm = (u: string): string => u.trim().replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase()
const read = async (prefix: string): Promise<any[]> => {
  const rows: any[] = []
  for (const f of readdirSync(dir).filter((x) => x.startsWith(prefix) && x.endsWith(".json"))) rows.push(...JSON.parse(await Bun.file(`${dir}/${f}`).text()))
  return rows
}
const people = [...(await read("links_outreach_")), ...(await read("links_recruiter_"))]
const past = await read("links_past_")
const stored = new Set((await sql(`select lower(profile_url) u from job_people`)).map((r: any) => norm(r.u)))
for (const g of people) g.urls = [...new Set<string>((g.urls as string[]).map(norm))].filter((u) => /linkedin\.com\/in\//.test(u) && !stored.has(u))
for (const g of past) g.urls = [...new Set<string>((g.urls as string[]).map(norm))].filter((u) => /linkedin\.com\/in\//.test(u))
const keepP = people.filter((g) => g.urls.length), keepJ = past.filter((g) => g.urls.length)
await Bun.write(`${dir}/merged_people.json`, JSON.stringify(keepP)); await Bun.write(`${dir}/merged_past.json`, JSON.stringify(keepJ))
console.log(`people: ${keepP.length} groups, ${new Set(keepP.flatMap((g) => g.urls)).size} profiles (about $${(new Set(keepP.flatMap((g) => g.urls)).size * 0.005).toFixed(2)} to read) | past hires: ${keepJ.length} jobs, ${new Set(keepJ.flatMap((g) => g.urls)).size} profiles`)
