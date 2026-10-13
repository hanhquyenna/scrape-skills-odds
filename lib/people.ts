/**
 * Finding people on LinkedIn without the actors that cap free accounts at 10 runs (harvestapi/linkedin-profile-search):
 *   1. discover: Google, through apify/google-search-scraper (~$0.004 a query, 10 results), with LinkedIn profile queries
 *      (site:linkedin.com/in "<company>" ("title a" OR "title b") Netherlands). Many queries go in one run.
 *   2. read:     the whole public profile of each address found, through supreme_coder/linkedin-profile-scraper (~$0.005 a profile):
 *      every position with its dates, location, education. Many profiles go in one run.
 * Profiles come back in one shape (Profile), the one the rules in the skills judge.
 */
import { runActor } from "./apify"

export interface Position { position: string; companyName: string; companyLinkedinUrl: string; startDate: { month?: number; year?: number } | null; endDate: { month?: number; year?: number; text?: string } | null; employmentType: string; description: string; location: string }
export interface Profile {
  linkedinUrl: string; publicIdentifier: string; firstName: string; lastName: string; headline: string; photo: string
  location: { linkedinText: string }
  experience: Position[]
  education: Array<{ schoolName: string; degree: string; fieldOfStudy: string; startDate: { year?: number } | null; endDate: { year?: number } | null }>
}

const profileUrl = (u: string): string | null => {
  const m = /linkedin\.com\/in\/([^/?#]+)/i.exec(u)
  return m ? `https://www.linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}` : null
}

/** Google results per query: the LinkedIn profile addresses, in result order, with the result title ("Name - Title - Company | LinkedIn"). */
export async function discover(queries: string[]): Promise<Map<string, Array<{ url: string; title: string }>>> {
  const out = new Map<string, Array<{ url: string; title: string }>>()
  if (queries.length === 0) return out
  const { items } = await runActor("apify/google-search-scraper", { queries: queries.join("\n"), maxPagesPerQuery: 1, resultsPerPage: 10, countryCode: "nl", mobileResults: false }, { quiet: true })
  for (const it of items as Array<Record<string, any>>) {
    const list: Array<{ url: string; title: string }> = []
    for (const o of (it.organicResults ?? []) as Array<{ url?: string; title?: string }>) {
      const url = profileUrl(o.url ?? "")
      if (url && !list.some((x) => x.url === url)) list.push({ url, title: String(o.title ?? "") })
    }
    out.set(String(it.searchQuery?.term ?? ""), list)
  }
  return out
}

/** Whole profiles for the addresses, in one run. Profiles that could not be read are left out. */
export async function readProfiles(urls: string[]): Promise<Map<string, Profile>> {
  const out = new Map<string, Profile>()
  const unique = [...new Set(urls)]
  if (unique.length === 0) return out
  const { items } = await runActor("supreme_coder/linkedin-profile-scraper", { urls: unique.map((url) => ({ url })) }, { quiet: true })
  for (const it of items as Array<Record<string, any>>) {
    const url = profileUrl(String(it.inputUrl ?? "")) ?? (it.publicIdentifier ? `https://www.linkedin.com/in/${String(it.publicIdentifier).toLowerCase()}` : null)
    if (!url || !it.firstName) continue
    const experience: Position[] = []
    for (const group of (it.positions ?? []) as Array<Record<string, any>>) {
      const company = group.company ?? {}
      const inner = Array.isArray(group.positions) && group.positions.length ? group.positions : [group]
      for (const p of inner as Array<Record<string, any>>) {
        const end = p.timePeriod?.endDate ?? null
        experience.push({
          position: String(p.title ?? ""), companyName: String(company.name ?? group.companyName ?? ""), companyLinkedinUrl: String(company.url ?? ""),
          startDate: p.timePeriod?.startDate ?? null, endDate: end ? { ...end } : { text: "Present" },
          employmentType: String(p.employmentType ?? group.employmentType ?? ""), description: String(p.description ?? ""), location: String(p.locationName ?? ""),
        })
      }
    }
    out.set(url, {
      linkedinUrl: url, publicIdentifier: String(it.publicIdentifier ?? ""), firstName: String(it.firstName ?? ""), lastName: String(it.lastName ?? ""),
      headline: String(it.headline ?? ""), photo: String(it.pictureUrl?.["400x400"] ?? it.pictureUrl?.["200x200"] ?? it.pictureUrl?.["100x100"] ?? ""),
      location: { linkedinText: String(it.geoLocationName ?? it.geoCountryName ?? "") },
      experience,
      education: ((it.educations ?? []) as Array<Record<string, any>>).map((e) => ({ schoolName: String(e.schoolName ?? ""), degree: String(e.degreeName ?? ""), fieldOfStudy: String(e.fieldOfStudy ?? ""), startDate: e.timePeriod?.startDate ?? null, endDate: e.timePeriod?.endDate ?? null })),
    })
  }
  // The reader above uses shared LinkedIn accounts and sometimes returns nothing ("no available accounts found"); the ones it missed are read
  // by harvestapi/linkedin-profile-scraper, whose output already has this shape (measured 13 Oct 2026: 3 of 3 read where the first returned 0).
  const missing = unique.filter((u) => !out.has(profileUrl(u) ?? u))
  if (missing.length) {
    // Free accounts get at most 10 items per run of this actor ("Free users are limited up to 10 items per run"), so it is called in chunks of 10.
    const more: Array<Record<string, any>> = []
    const chunks: string[][] = []
    for (let i = 0; i < missing.length; i += 10) chunks.push(missing.slice(i, i + 10).filter((u) => !u.includes("%")))
    // 4 runs at a time: one after the other took ~40 s each (39 runs = 26 min for 390 profiles)
    for (let i = 0; i < chunks.length; i += 4) {
      const got = await Promise.all(chunks.slice(i, i + 4).filter((c) => c.length).map((chunk) => runActor("harvestapi/linkedin-profile-scraper", { urls: chunk, profileScraperMode: "Profile details no email ($4 per 1k)" }, { quiet: true }).then((r) => r.items as Array<Record<string, any>>).catch(() => [])))
      for (const g of got) more.push(...g)
    }
    for (const it of more) {
      const url = profileUrl(String(it.linkedinUrl ?? "")) ?? (it.publicIdentifier ? `https://www.linkedin.com/in/${String(it.publicIdentifier).toLowerCase()}` : null)
      if (!url || !it.firstName) continue
      out.set(url, {
        linkedinUrl: url, publicIdentifier: String(it.publicIdentifier ?? ""), firstName: String(it.firstName ?? ""), lastName: String(it.lastName ?? ""),
        headline: String(it.headline ?? ""), photo: String(it.photo ?? ""), location: { linkedinText: String(it.location?.linkedinText ?? "") },
        experience: ((it.experience ?? []) as Array<Record<string, any>>).map((e) => ({
          position: String(e.position ?? ""), companyName: String(e.companyName ?? ""), companyLinkedinUrl: String(e.companyLinkedinUrl ?? ""),
          startDate: e.startDate ?? null, endDate: e.endDate ?? { text: "Present" }, employmentType: String(e.employmentType ?? ""), description: String(e.description ?? ""), location: String(e.location ?? ""),
        })),
        education: ((it.education ?? []) as Array<Record<string, any>>).map((e) => ({ schoolName: String(e.schoolName ?? ""), degree: String(e.degree ?? ""), fieldOfStudy: String(e.fieldOfStudy ?? ""), startDate: e.startDate ?? null, endDate: e.endDate ?? null })),
      })
    }
  }
  return out
}

/** The positions held now (no end date). */
export const currentPositions = (p: Profile): Position[] => p.experience.filter((x) => !x.endDate || x.endDate.text === "Present" || (!x.endDate.year && !x.endDate.month))

/** A company name as people write it on LinkedIn: legal forms and "Bank N.V." style tails removed ("ABN AMRO Bank N.V." -> "ABN AMRO"). */
export const shortName = (company: string): string =>
  company.replace(/&amp;/g, "&").replace(/\b(b\.?v\.?|n\.?v\.?|gmbh|ltd|llc|inc|plc|ag|se|sa|holding|holdings|group|nederland|netherlands|bank)\b\.?/gi, " ").replace(/[()"]/g, " ").replace(/\s+/g, " ").trim() || company

/**
 * Google queries for LinkedIn profiles at a company with any of the titles, in the Netherlands. Long OR lists make Google return little
 * or nothing (Philips finance: 8 phrases -> 0 profiles, Danone: 10), so the titles go in queries of at most `per` phrases each.
 */
export function profileQueries(company: string, titles: string[], extra = "Netherlands", per = 3): string[] {
  const name = shortName(company), out: string[] = []
  const list = [...new Set(titles.map((t) => t.replace(/"/g, "").trim()).filter(Boolean))]
  for (let i = 0; i < list.length; i += per) out.push(`site:linkedin.com/in "${name}" (${list.slice(i, i + per).map((t) => `"${t}"`).join(" OR ")}) ${extra}`.trim())
  return out
}
export const profileQuery = (company: string, titles: string[], extra = "Netherlands"): string => profileQueries(company, titles, extra, 99)[0]
