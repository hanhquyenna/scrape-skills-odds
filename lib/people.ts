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
  return out
}

/** The positions held now (no end date). */
export const currentPositions = (p: Profile): Position[] => p.experience.filter((x) => !x.endDate || x.endDate.text === "Present" || (!x.endDate.year && !x.endDate.month))

/** A Google query for LinkedIn profiles at a company with any of the titles, in the Netherlands. */
export const profileQuery = (company: string, titles: string[], extra = "Netherlands"): string =>
  `site:linkedin.com/in "${company.replace(/"/g, "")}" (${titles.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ")}) ${extra}`.trim()
