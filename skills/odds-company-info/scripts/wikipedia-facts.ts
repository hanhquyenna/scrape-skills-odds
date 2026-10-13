/**
 * Company numbers from the English Wikipedia infobox ("Infobox company") of each employer: revenue, net income, assets, employees, each with the
 * year the page states. Free. Nothing is estimated or converted; the quote is the infobox line as written, so ingest-facts.ts checks the amount and year.
 *
 *   bun skills/odds-company-info/scripts/wikipedia-facts.ts [--days 7] [--limit 300] [--write]
 * Without --write it only prints. Employers that already have revenue are skipped. Matching is strict: the page title must be the employer's name
 * (all words of the shorter in the longer) and the page must have a company infobox.
 */
import { sql, lit } from "../../../lib/db"
import { arg, flag } from "../../../lib/env"
import { employersSql } from "../../../lib/scope"

const DAYS = Number(arg("--days", "7")), LIMIT = Number(arg("--limit", "300")), WRITE = flag("--write")
const UA = { "User-Agent": "odds-company-info/1.0 (kien.phung@goworkwize.com)" }
const norm = (s: string): string[] => s.toLowerCase().replace(/\b(b\.?v\.?|n\.?v\.?|inc\.?|plc|ltd|gmbh|s\.?a\.?|ag|group|holding|holdings|the|company|corporation|international|europe|nederland|netherlands|\(.*?\))\b/g, " ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1)
const sameName = (a: string, b: string): boolean => { const x = norm(a), y = norm(b); if (!x.length || !y.length) return false; const [s, l] = x.length <= y.length ? [x, y] : [y, x]; return s.every((w) => l.includes(w)) }
const api = async (q: string): Promise<any> => (await fetch(`https://en.wikipedia.org/w/api.php?format=json&origin=*&${q}`, { headers: UA })).json()

const CUR: Record<string, string> = { "€": "EUR", eur: "EUR", euro: "EUR", "$": "USD", usd: "USD", "us$": "USD", "£": "GBP", gbp: "GBP", chf: "CHF", "¥": "JPY", jpy: "JPY", sek: "SEK", dkk: "DKK", nok: "NOK" }
function clean(v: string): string {
  return v.replace(/&nbsp;|\u00a0/g, " ").replace(/<ref[^>]*\/>/g, " ").replace(/<ref[\s\S]*?<\/ref>/g, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<br\s*\/?>/gi, " ")
    .replace(/\{\{\s*(?:increase|decrease|steady|up|down|nowrap|nobr|small)\s*\}\}/gi, " ")
    .replace(/\{\{\s*(?:formatnum|nowrap|nobr|small)\s*[:|]([^{}]*)\}\}/gi, "$1")
    .replace(/\{\{\s*(US\$|USD|EUR|euro|GBP|CHF|SEK|DKK|NOK|JPY)\s*\|\s*([\d.,]+)\s*\|?\s*([a-z]*)[^}]*\}\}/gi, (_m, c, n, s) => `${CUR[String(c).toLowerCase()] ?? c} ${n} ${s}`)
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1").replace(/\{\{[^{}]*\}\}/g, " ").replace(/&nbsp;/g, " ").replace(/'''?/g, "").replace(/\s+/g, " ").trim()
}
const SC: Record<string, number> = { billion: 1e9, bn: 1e9, million: 1e6, m: 1e6, mn: 1e6, thousand: 1e3 }
function money(text: string): { amount: number; currency: string; year: number; quote: string } | null {
  const y = /\(\s*(?:FY\s*)?(20[12]\d)\s*\)|\b(20[12]\d)\b/.exec(text); if (!y) return null
  const m = /(€|\$|£|¥|US\$|EUR|USD|GBP|CHF|SEK|DKK|NOK|JPY)\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(billion|bn|million|mn|m|thousand)?/i.exec(text)
  if (!m) return null
  const cur = CUR[m[1].toLowerCase()]; if (!cur) return null
  const n = Number(m[2].replace(/,(?=\d{3}\b)/g, "")); if (!Number.isFinite(n)) return null
  const scale = SC[(m[3] ?? "").toLowerCase()] ?? 1
  return { amount: Math.round(n * scale), currency: cur, year: Number(y[1] ?? y[2]), quote: text.slice(0, 160) }
}
function employees(text: string): { amount: number; year: number; quote: string } | null {
  const m = /([\d]{1,3}(?:[,.]\d{3})+|\d{3,})/.exec(text), y = /\b(20[12]\d)\b/.exec(text)
  return m && y ? { amount: Number(m[1].replace(/[,.]/g, "")), year: Number(y[1]), quote: text.slice(0, 160) } : null
}
const KIND: Record<string, string> = { revenue: "revenue", net_income: "net_profit", assets: "total_assets", market_cap: "market_value" }

const rows = await sql<{ employer: string; display: string }>(`with recent as (${employersSql(DAYS)}) select r.employer, r.display from recent r
  where not exists (select 1 from employer_money m where lower(m.employer) = lower(r.employer) and m.kind = 'revenue') limit ${LIMIT}`)
const facts: Array<{ employer: string; facts: any[] }> = []
for (const r of rows) {
  try {
    const s = await api(`action=query&list=search&srlimit=4&srsearch=${encodeURIComponent(r.display + " company")}`)
    const title = (s.query?.search ?? []).map((x: any) => x.title as string).find((t: string) => sameName(t, r.display) || sameName(t, r.employer))
    if (!title) continue
    const p = await api(`action=parse&prop=wikitext&section=0&page=${encodeURIComponent(title)}`)
    const wt: string = p.parse?.wikitext?.["*"] ?? ""
    if (!/\{\{\s*infobox (?:company|bank|airline|brewery|winery|publisher|law firm|accounting)/i.test(wt)) continue
    const out: any[] = [], url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`
    for (const [field, kind] of Object.entries(KIND)) {
      const line = new RegExp(`\\|\\s*${field}\\s*=\\s*([^\\n]*(?:\\n(?!\\s*\\|)[^\\n]*)*)`, "i").exec(wt)?.[1]
      if (!line) continue
      const t = clean(line), f = money(t)
      if (f) out.push({ kind, amount: f.amount, currency: f.currency, year: f.year, source_url: url, quote: f.quote })
    }
    const ee = new RegExp(`\\|\\s*(?:num_employees|employees)\\s*=\\s*([^\\n]*)`, "i").exec(wt)?.[1]
    if (ee) { const t = clean(ee), e = employees(t); if (e) out.push({ kind: "employees", amount: e.amount, year: e.year, date: `${e.year}-12-31`, source_url: url, quote: e.quote }) }
    if (out.length) { facts.push({ employer: r.employer, facts: out }); console.log(`${r.display} -> ${title}: ${out.map((f) => `${f.kind} ${f.amount}${f.currency ?? ""} ${f.year}`).join("; ")}`) }
  } catch (e) { console.log(`${r.display}: ${(e as Error).message}`) }
}
const outFile = arg("--out", "wikipedia-facts.json")
await Bun.write(outFile, JSON.stringify(facts))
console.log(`${facts.length} of ${rows.length} employers have infobox numbers -> ${outFile}${WRITE ? "" : "  (run ingest-facts.ts on it)"}`)
