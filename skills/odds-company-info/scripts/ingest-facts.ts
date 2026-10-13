/**
 * Company numbers an agent collected in the browser (annual report, the company's own site, KVK, a regulator, a stock exchange page),
 * into employer_money (revenue, net profit, market value, total assets, by year) and employer_headcount (employees, by date).
 *
 *   bun skills/odds-company-info/scripts/ingest-facts.ts facts.json [--dry]
 *
 * facts.json: [ { "employer": "<as in app_jobs.employer>", "facts": [
 *     { "kind": "revenue" | "net_profit" | "market_value" | "total_assets" | "employees",
 *       "amount": 1234000000,            // the number as stated, scaled to units (1.234 billion -> 1234000000)
 *       "currency": "EUR",                // ISO code; leave out for employees
 *       "year": 2024,                     // the year the figure is for (fiscal year)
 *       "date": "2024-12-31",             // employees only: the date the count is for (else 31 Dec of the year)
 *       "source_url": "https://...",      // the exact page or PDF it was read on
 *       "quote": "Revenue of €1,234 million in 2024" } ] } ]   // the sentence or table cell, copied exactly
 *
 * A fact is kept only when its quote contains the figure (the same leading digits, in any of the usual notations) and its year (money);
 * the quote itself is not stored. Nothing is estimated or converted.
 */
import { readFileSync } from "node:fs"
import { lit, sql } from "../../../lib/db"
import { flag } from "../../../lib/env"

const file = process.argv.slice(2).find((a) => !a.startsWith("--"))
if (!file) { console.error("usage: ingest-facts.ts facts.json [--dry]"); process.exit(2) }
const DRY = flag("--dry")
const data = JSON.parse(readFileSync(file, "utf8")) as Array<{ employer: string; facts: Array<Record<string, any>> }>

const SCALE: Array<[RegExp, number]> = [[/^(billion|bn|mld|miljard|b)\b/i, 1e9], [/^(million|mln|mio|miljoen|m)\b/i, 1e6], [/^(thousand|k|duizend)\b/i, 1e3]]
/** Every amount the quote states, with its scale word applied: "€1,234 million" -> 1234000000, "1.234,5 mln" -> 1234500000. */
export function amountsIn(quote: string): number[] {
  const out: number[] = []
  for (const m of quote.matchAll(/(\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*([a-z]+)?/gi)) {
    let raw = m[1].replace(/\s/g, "")
    // Thousands separators are the ones followed by exactly three digits; the last separator followed by 1-2 or 4+ digits is the decimal point.
    const last = Math.max(raw.lastIndexOf("."), raw.lastIndexOf(","))
    if (last >= 0 && raw.length - last - 1 !== 3) raw = raw.slice(0, last).replace(/[.,]/g, "") + "." + raw.slice(last + 1)
    else raw = raw.replace(/[.,]/g, "")
    const scale = SCALE.find(([rx]) => rx.test(m[2] ?? ""))?.[1] ?? 1
    out.push(Number(raw) * scale)
    // "4.957 billion" / "€29.821 B": with a scale word a single separator followed by three digits is a decimal point, not a thousands separator.
    const one = m[1].replace(/\s/g, "")
    if (scale > 1 && /^\d{1,3}[.,]\d{3}$/.test(one)) out.push(Number(one.replace(",", ".")) * scale)
  }
  return out
}
/** The quote states this amount (within 0.5%). */
const quoted = (amount: number, quote: string): boolean => amountsIn(quote).some((v) => Math.abs(v - Math.abs(amount)) <= Math.abs(amount) * 0.005)

const money: string[] = [], heads: string[] = [], refused: string[] = []
for (const c of data) {
  for (const f of c.facts ?? []) {
    const amount = Number(f.amount), quote = String(f.quote ?? ""), url = String(f.source_url ?? "")
    if (!Number.isFinite(amount) || !/^https?:\/\//.test(url) || !quote) { refused.push(`${c.employer} ${f.kind}: missing amount, source_url or quote`); continue }
    if (!quoted(amount, quote)) { refused.push(`${c.employer} ${f.kind}: the quote does not state ${amount}`); continue }
    if (f.kind === "employees") {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(f.date)) ? f.date : f.year ? `${f.year}-12-31` : null
      if (!date) { refused.push(`${c.employer} employees: no date or year`); continue }
      heads.push(`(${lit(c.employer)}, ${lit(date)}::date, ${Math.round(amount)}, ${lit("company_report")})`)
    } else if (["revenue", "net_profit", "market_value", "total_assets"].includes(f.kind)) {
      if (!f.currency || !f.year || !quote.includes(String(f.year)) && f.kind !== "market_value") { refused.push(`${c.employer} ${f.kind}: currency or year missing, or the year is not in the quote`); continue }
      money.push(`(${lit(c.employer)}, ${lit(f.kind)}, ${amount}, ${lit(String(f.currency).toUpperCase())}, ${Number(f.year)}, '', ${lit(url)})`)
    } else refused.push(`${c.employer}: unknown kind ${f.kind}`)
  }
}
if (!DRY && money.length) await sql(`insert into employer_money (employer, kind, amount, currency, year, wikidata_id, source) values ${money.join(",")} on conflict (employer, kind, year) do update set amount = excluded.amount, currency = excluded.currency, source = excluded.source, read_on = current_date`)
if (!DRY && heads.length) await sql(`insert into employer_headcount (employer, read_on, employees, source) values ${heads.join(",")} on conflict (employer, read_on, source) do update set employees = excluded.employees`)
console.log(`${DRY ? "would store" : "stored"} ${money.length} money figures and ${heads.length} headcounts; refused ${refused.length}${refused.length ? ":\n  " + refused.join("\n  ") : ""}`)
