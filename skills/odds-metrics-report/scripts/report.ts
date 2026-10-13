/**
 * The metrics report: how complete the per-job data is for the table active_internship_entry_english, for the last 7 and 30 days, with the change
 * against the start (reports/baseline-2026-10-12.json) and against the previous snapshot, and a new snapshot saved to reports/.
 *   bun skills/odds-metrics-report/scripts/report.ts [--no-save] [--md]
 * Percent = jobs that have the data / jobs in the window. The window moves with the date and other agents add jobs, so the number of jobs is
 * printed too: a falling percent with a rising count of jobs with data is growth of the table, not a loss.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { flag } from "../../../lib/env"

const ROOT = new URL("../../../", import.meta.url).pathname
const KEYS: Array<[string, string]> = [
  ["contacts", "Outreach: any contact"], ["hiring_manager_in_dept", "Outreach: hiring manager in the job's department"],
  ["peers_not_senior", "Outreach: same-department people, not senior"], ["recruiter", "Outreach: recruiter"],
  ["past_hires_exact", "Past hires: exact role"], ["past_hires_exact_or_adjacent", "Past hires: exact or adjacent role"],
  ["reviews_employer", "Company reviews"], ["reviews_same_role", "Reviews from the same role"],
  ["linkedin_facts", "Company LinkedIn page"], ["revenue", "Revenue"], ["revenue_growth", "Revenue growth (2+ years)"], ["profit", "Profit"],
  ["net_worth", "Net worth (market value / assets)"], ["headcount_growth", "Headcount growth (2+ readings)"], ["news", "News"], ["nothing", "Jobs with nothing at all"],
]
const run = async (days: number): Promise<Record<string, number>> => {
  const p = Bun.spawn(["bun", "coverage.ts", "--days", String(days), "--json"], { cwd: ROOT, stdout: "pipe", stderr: "inherit" })
  const o = JSON.parse((await new Response(p.stdout).text()).trim().split("\n").pop()!)
  const n = Number(o.jobs), out: Record<string, number> = { jobs: n }
  for (const [k] of KEYS) out[k] = Number(o[k] ?? 0)
  return out
}
const now = { d7: await run(7), d30: await run(30) }
const snaps = readdirSync(`${ROOT}reports`).filter((f) => /^\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(f)).sort()
const prev = snaps.length ? JSON.parse(readFileSync(`${ROOT}reports/${snaps[snaps.length - 1]}`, "utf8")) : null
const base = JSON.parse(readFileSync(`${ROOT}reports/baseline-2026-10-12.json`, "utf8"))
const pct = (w: Record<string, number>, k: string): number => (100 * (w[k] ?? 0)) / Math.max(w.jobs, 1)
const fmt = (x: number | null): string => (x === null ? "-" : `${x.toFixed(1)}%`)
const delta = (a: number, b: number | null): string => (b === null ? "-" : `${a - b >= 0 ? "+" : ""}${(a - b).toFixed(1)}`)
for (const [label, key] of [["7 days", "d7"], ["30 days", "d30"]] as const) {
  const w = now[key]
  console.log(`\n${label}: ${w.jobs} jobs in active_internship_entry_english${prev ? `  (previous snapshot ${snaps[snaps.length - 1].slice(0, -5)}: ${prev[key].jobs} jobs)` : ""}`)
  console.log("| Data | Jobs | Now | Start (12 Oct) | Change vs start (pp) | Previous snapshot | Change vs previous (pp) |")
  console.log("|---|---|---|---|---|---|---|")
  for (const [k, name] of KEYS) {
    const a = pct(w, k), b = base[key][k] ?? null, c = prev ? pct(prev[key], k) : null
    console.log(`| ${name} | ${w[k]} | ${fmt(a)} | ${fmt(b)} | ${delta(a, b)} | ${fmt(c)} | ${delta(a, c)} |`)
  }
}
if (!flag("--no-save")) {
  const d = new Date(), s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`
  writeFileSync(`${ROOT}reports/${s}.json`, JSON.stringify({ at: d.toISOString(), ...now }, null, 1))
  console.log(`\nsnapshot saved: reports/${s}.json`)
}
