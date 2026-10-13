/**
 * Hides the extra copies of the same job in the table: same employer (by name words), same title, same city, different source or requisition.
 * The view app_jobs keeps one row per "employer_display | title | city" already; this catches name variants ("ASML" / "ASML Holding N.V.", "Bosch" / "Bosch Group").
 * The copy kept is the best source (company ATS, then Magnet.me, Indeed, Glassdoor, LinkedIn), then the newest. The others get usable = 0 (the view hides
 * rows with usable < 0.5); nothing is deleted and the old values are written to <backup> so `--revert <backup>` puts them back.
 *   bun skills/odds-fill-table/scripts/dedupe.ts [--apply] [--backup dedupe-backup.json]      (without --apply it only prints)
 *   bun skills/odds-fill-table/scripts/dedupe.ts --revert dedupe-backup.json
 */
import { sql } from "../../../lib/db"
import { arg, flag } from "../../../lib/env"

const APPLY = flag("--apply"), BACKUP = arg("--backup", "dedupe-backup.json"), REVERT = arg("--revert", "")
if (REVERT) {
  const rows = JSON.parse(await Bun.file(REVERT).text()) as Array<{ id: string; usable: number | null }>
  for (const r of rows) await sql(`update postings set usable = ${r.usable === null ? "null" : r.usable} where id = '${r.id.replace(/'/g, "''")}'`)
  console.log(`restored ${rows.length} rows`); process.exit(0)
}
const words = (s: string): string[] => s.toLowerCase().replace(/\b(b\.?v\.?|n\.?v\.?|inc\.?|plc|ltd|gmbh|s\.?a\.?|ag|co|the|company|corporation|group|holding|holdings|international|europe|netherlands|nederland|the netherlands)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean)
const same = (a: string, b: string): boolean => { const x = words(a), y = words(b); if (!x.length || !y.length) return false; const [s, l] = x.length <= y.length ? [x, y] : [y, x]; return s.every((w) => l.includes(w)) }
const RANK: Record<string, number> = { workday: 0, greenhouse: 0, ashby: 0, smartrecruiters: 0, successfactors: 0, recruitee: 0, lever: 0, teamtailor: 0, personio: 0, workable: 0, academictransfer: 1, "magnet.me": 2, indeed: 3, glassdoor: 4 }
const rows = await sql<{ id: string; emp: string; ats: string | null; title: string; city: string; posted_on: string | null; usable: number | null }>(`
  select p.id, coalesce(a.employer_display, a.employer) emp, a.ats, lower(regexp_replace(coalesce(a.title_clean, a.title), '(m ?/ ?f ?/ ?[dx]|all genders|\\(.*?\\)|[^a-zA-Z0-9]+)', '', 'gi')) title,
    lower(split_part(split_part(coalesce(a.region, ''), ';', 1), ',', 1)) city, a.posted_on::text, p.usable
  from active_internship_entry_english e join app_jobs a on a.id = e.id join postings p on p.id = a.id`)
const byKey = new Map<string, typeof rows>()
for (const r of rows) { const k = `${r.title}|${r.city}`; if (r.title.length >= 12) byKey.set(k, [...(byKey.get(k) ?? []), r]) }
const hide: typeof rows = []
for (const g of byKey.values()) {
  if (g.length < 2) continue
  const clusters: Array<typeof rows> = []
  for (const r of g) { const c = clusters.find((c) => same(c[0].emp, r.emp)); if (c) c.push(r); else clusters.push([r]) }
  for (const c of clusters) {
    if (c.length < 2) continue
    c.sort((a, b) => (RANK[(a.ats ?? "").toLowerCase()] ?? 5) - (RANK[(b.ats ?? "").toLowerCase()] ?? 5) || String(b.posted_on ?? "").localeCompare(String(a.posted_on ?? "")) || a.id.localeCompare(b.id))
    hide.push(...c.slice(1))
    if (hide.length <= 25) console.log(`keep ${c[0].ats ?? "?"} / hide ${c.slice(1).map((x) => x.ats ?? "?").join(",")} | ${c[0].emp} | ${c[0].title.slice(0, 40)} | ${c[0].city}`)
  }
}
console.log(`${hide.length} extra copies of ${rows.length} jobs`)
if (!APPLY) { console.log("dry run: nothing changed (add --apply)"); process.exit(0) }
await Bun.write(BACKUP, JSON.stringify(hide.map((h) => ({ id: h.id, usable: h.usable }))))
for (let i = 0; i < hide.length; i += 100) await sql(`update postings set usable = 0 where id in (${hide.slice(i, i + 100).map((h) => `'${h.id.replace(/'/g, "''")}'`).join(",")})`)
console.log(`hidden ${hide.length} (usable = 0); backup in ${BACKUP}`)
