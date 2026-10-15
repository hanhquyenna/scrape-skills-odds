/**
 * Company "People" page links -> the groups file for read-urls.ts. For every employer, the same profile links are offered for each role the
 * job table needs (hiring manager and peer for each department of its jobs, the nearest departments' manager and peer, and recruiter);
 * the fixed rules in run.ts --from-file keep only the people who fit (this company now, Netherlands, title). This is how adjacent
 * departments are covered for employers that have nobody in the job's own department.
 *   links.json: { "<employer as in app_jobs>": ["https://www.linkedin.com/in/...", ...] }
 *   bun skills/odds-outreach-contacts/scripts/expand-company-people.ts links.json groups.json [--days 30]
 */
import { readFileSync, writeFileSync } from "node:fs"
import { sql, lit } from "../../../lib/db"
import { arg } from "../../../lib/env"
import { adjacentDepartments, departmentKey } from "../../../lib/rules"
import { scopeWhere } from "../../../lib/scope"

const [inFile, outFile] = process.argv.slice(2)
const DAYS = Number(arg("--days", "30"))
const links = JSON.parse(readFileSync(inFile, "utf8")) as Record<string, string[]>
const out: any[] = []
for (const [name, urls] of Object.entries(links)) {
  if (!urls.length) continue
  const rows = await sql<{ employer: string; title: string; family: string | null }>(
    `select employer, coalesce(title_clean, title) title, family from app_jobs where ${scopeWhere(DAYS)} and (lower(employer) = lower(${lit(name)}) or lower(coalesce(employer_display, employer)) = lower(${lit(name)}))`)
  const employer = rows[0]?.employer ?? name
  const deps = [...new Set(rows.map((r) => departmentKey(r.family, r.title)).filter(Boolean))] as string[]
  const add = (role: string, department: string | null) => out.push({ employer, display: name, role, department, urls })
  for (const d of deps.length ? deps : [null]) {
    add("department_manager", d); add("peer", d)
    const adj = adjacentDepartments(d)[0]
    if (adj) { add("adjacent_manager", adj); add("adjacent_peer", adj) }
  }
  add("recruiter", null)
}
writeFileSync(outFile, JSON.stringify(out))
console.log(`${Object.keys(links).length} employers -> ${out.length} groups`)
