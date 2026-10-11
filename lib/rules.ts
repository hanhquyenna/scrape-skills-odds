/**
 * The fixed rules every skill keeps or drops data by. No model decides here: same company, in the Netherlands, the department a
 * title belongs to, its seniority, and how close two job titles are.
 */
import { sql } from "./db"

/** Lower case, legal forms and filler words removed, only letters and digits: "Picnic Technologies B.V." -> "picnic technologies". */
export const norm = (s: unknown): string =>
  String(s ?? "").toLowerCase().replace(/&amp;/g, "&").replace(/\b(b\.?v\.?|n\.?v\.?|gmbh|ltd|llc|inc|plc|ag|sa|se|group|holding|holdings|nederland|netherlands|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim()
const words = (s: unknown): string[] => norm(s).split(" ").filter(Boolean)
const startsWith = (a: string[], b: string[]): boolean => b.length > 0 && b.length <= a.length && b.every((w, i) => a[i] === w)
const slug = (u: unknown): string => String(u ?? "").toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() ?? ""

/** True when a company line is this employer: the same LinkedIn page, or the names agree word for word from the start. */
export function sameCompany(line: { name?: unknown; url?: unknown }, employer: string, display: string, page?: string | null): boolean {
  if (page && line.url && slug(line.url) === slug(page)) return true
  const a = words(line.name)
  if (a.join("").length < 3) return false
  return [words(display), words(employer)].some((b) => startsWith(a, b) || startsWith(b, a))
}

const NL = /netherlands|nederland|holland|randstad|amsterdam|rotterdam|utrecht|the hague|den haag|'s-gravenhage|eindhoven|groningen|leiden|delft|haarlem|amstelveen|almere|tilburg|breda|nijmegen|arnhem|maastricht|zwolle|enschede|hoofddorp|schiphol|apeldoorn|amersfoort|hilversum|veldhoven|'s-hertogenbosch|den bosch|zaandam|diemen|wageningen|leeuwarden|dordrecht|zoetermeer|venlo|heerlen|deventer|\bnl\b/i
/** True when a place line is in the Netherlands. */
export const inNL = (place: unknown): boolean => NL.test(String(place ?? ""))

// ---- LinkedIn company pages ----
const PAGES: Record<string, string> = {}
let ENTRIES: Array<{ w: string[]; url: string }> = []
/** Loads each employer's LinkedIn company page from employer_facts. Call once before pageOf. */
export async function loadPages(): Promise<number> {
  for (const r of await sql<{ employer: string; name: string | null; linkedin_url: string }>("select employer, name, linkedin_url from employer_facts where coalesce(linkedin_url, '') <> ''")) {
    PAGES[r.employer.toLowerCase()] ??= r.linkedin_url
    if (r.name) PAGES[r.name.toLowerCase()] ??= r.linkedin_url
  }
  ENTRIES = Object.entries(PAGES).map(([k, url]) => ({ w: words(k), url }))
  return Object.keys(PAGES).length
}
/** The employer's LinkedIn company page, or null when none is known (fill-linkedin-company finds them). */
export function pageOf(employer: string, display: string): string | null {
  const exact = PAGES[employer.toLowerCase()] ?? PAGES[display.trim().toLowerCase()]
  if (exact) return exact
  const mine = words(display)
  if (mine.join("").length < 3) return null
  return ENTRIES.filter((x) => startsWith(x.w, mine) || (x.w.join("").length >= 3 && startsWith(mine, x.w))).sort((a, b) => a.w.length - b.w.length)[0]?.url ?? null
}

// ---- Departments (the `family` column of a job) ----
/** The words a department's people have in their titles. */
export const DEPARTMENT_TITLES: Record<string, string[]> = {
  "Finance & accounting": ["finance", "financial analyst", "accountant", "controller", "FP&A", "treasury", "audit"],
  "Software engineering": ["software engineer", "developer", "backend engineer", "frontend engineer"],
  "Data, analytics & AI": ["data analyst", "data scientist", "analytics", "machine learning", "business intelligence"],
  "Sales & account management": ["sales", "account manager", "business development"],
  "Product & project management": ["product manager", "project manager", "program manager"],
  "Risk, compliance & legal": ["risk", "compliance", "legal", "counsel"],
  "Operations & supply chain": ["operations", "supply chain", "logistics", "planner"],
  "IT, cloud & security": ["IT", "cloud", "security", "devops", "infrastructure"],
  "Research & academia": ["researcher", "scientist", "research"],
  "Consulting & strategy": ["consultant", "strategy"],
  "Hardware & engineering": ["engineer", "mechanical", "electrical", "hardware"],
  "Marketing & communications": ["marketing", "communications", "brand", "content"],
  "HR & recruiting": ["HR", "recruiter", "talent acquisition", "people"],
  "Healthcare & life sciences": ["clinical", "medical", "healthcare", "life sciences"],
  "Customer support & service": ["customer success", "customer support", "customer service"],
  "Design & UX": ["designer", "UX", "UI"],
}
const ADJACENT_GROUPS: string[][] = [
  ["Finance & accounting", "Risk, compliance & legal", "Consulting & strategy"],
  ["Software engineering", "Data, analytics & AI", "IT, cloud & security", "Hardware & engineering"],
  ["Hardware & engineering", "Operations & supply chain", "Product & project management"],
  ["Marketing & communications", "Sales & account management", "Customer support & service", "Design & UX"],
  ["Product & project management", "Consulting & strategy", "Operations & supply chain", "Design & UX"],
  ["Research & academia", "Data, analytics & AI", "Healthcare & life sciences"],
  ["HR & recruiting", "Operations & supply chain", "Customer support & service"],
]
/** The departments next to one department, nearest first. */
export function adjacentDepartments(family: string | null | undefined): string[] {
  const out: string[] = []
  for (const g of ADJACENT_GROUPS) if (family && g.includes(family)) for (const f of g) if (f !== family && !out.includes(f)) out.push(f)
  return out
}
/** The department a title belongs to by its words, or null. "Senior Data Analyst" -> "Data, analytics & AI". */
export function departmentOf(title: unknown): string | null {
  const t = ` ${String(title ?? "").toLowerCase()} `
  let best: [string, number] | null = null
  for (const [dep, ws] of Object.entries(DEPARTMENT_TITLES)) {
    for (const w of ws) {
      const rx = new RegExp(`\\b${w.toLowerCase().replace(/[.*+?^${}()|[\]\\&]/g, "\\$&")}\\b`)
      if (rx.test(t) && (!best || w.length > best[1])) best = [dep, w.length]
    }
  }
  return best?.[0] ?? null
}

const ALIASES: Array<[RegExp, string]> = [
  [/human resources|\bhr\b|recruit|talent|learning|people/i, "HR & recruiting"],
  [/data|analytics|\bai\b|artificial intelligence|machine learning/i, "Data, analytics & AI"],
  [/software|developer|\bit\b|information technology|infrastructure|cloud|security/i, "IT, cloud & security"],
  [/finance|treasury|audit|accounting|portfolio|investment/i, "Finance & accounting"],
  [/marketing|communications|brand|content|events/i, "Marketing & communications"],
  [/sales|commercial|business development|account/i, "Sales & account management"],
  [/supply chain|logistics|procurement|operations|hospitality|quality/i, "Operations & supply chain"],
  [/engineering|energy|hardware/i, "Hardware & engineering"],
  [/research|academ|science/i, "Research & academia"],
  [/strategy|consult|business|government|public affairs/i, "Consulting & strategy"],
  [/health|medical|clinical|pharma/i, "Healthcare & life sciences"],
  [/legal|risk|compliance/i, "Risk, compliance & legal"],
  [/design|ux|ui\b/i, "Design & UX"],
  [/customer/i, "Customer support & service"],
  [/product|project/i, "Product & project management"],
]
/** One of the standard departments for a job: its family when that is one, else read from the family's words, else from its title. */
export function departmentKey(family: string | null | undefined, title?: string | null): string | null {
  if (family && DEPARTMENT_TITLES[family]) return family
  if (family) {
    const hit = ALIASES.find(([rx]) => rx.test(family))
    if (hit) return hit[1]
  }
  return departmentOf(title) ?? (title ? ALIASES.find(([rx]) => rx.test(title))?.[1] ?? null : null)
}

// ---- Roles and seniority ----
export const RECRUITER = /recruit|talent acquisition|talent partner|talent sourc|sourcer|\bhr\b|human resources|people partner|people & culture|people and culture|early careers|campus|employer brand/i
export const MANAGER = /\bmanager\b|\bhead\b|\blead\b|director|team ?lead|supervisor|chief|\bvp\b|vice president/i
export const SENIOR = /\bsenior\b|\bsr\.?\b|\bprincipal\b|\bstaff\b|\bexpert\b|\bmanager\b|\bhead\b|\blead\b|director|chief|\bvp\b|partner\b/i
/** Level words in a held title, by the level of the job: who held an internship-level or an entry-level role. */
export const LEVEL_WORDS: Record<string, RegExp> = {
  Internship: /\b(intern|internship|stagiair|stage|trainee|working student|werkstudent|thesis|graduation|graduate intern)\b/i,
  Entry: /\b(junior|graduate|trainee|associate|entry|starter|analyst|assistant|medior)\b/i,
}

// ---- Title words ----
const STOP = new Set(["intern", "internship", "stage", "stagiair", "junior", "graduate", "trainee", "associate", "entry", "level", "m", "f", "d", "x", "and", "the", "of", "for", "in", "at", "to", "a", "an", "with", "programme", "program", "fall", "spring", "summer", "autumn", "winter", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "months", "month", "fulltime", "full", "time", "part", "nl", "netherlands", "amsterdam", "rotterdam", "eindhoven", "utrecht", "student", "working"])
const GENERIC = new Set(["product", "business", "management", "manager", "operations", "project", "global", "senior", "team", "services", "support", "officer", "specialist", "general", "corporate", "office"])
/** The words of a title that say what the work is. */
export const titleWords = (title: unknown): string[] =>
  norm(String(title ?? "").replace(/\(.*?\)/g, " ")).split(" ").filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w))
/** Share of the job's meaningful title words that the held title also has (generic words like "product" alone do not count). */
export function titleOverlap(jobTitle: unknown, heldTitle: unknown): number {
  const want = titleWords(jobTitle).filter((w) => !GENERIC.has(w))
  if (want.length === 0) return 0
  const have = new Set(titleWords(heldTitle))
  return want.filter((w) => have.has(w)).length / want.length
}
