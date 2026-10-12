/**
 * Hand-found profile links -> the people file for `run.ts --from-file`.
 * An agent finds LinkedIn profile links (web search, free), writes them as
 *   [{ employer, display, role, department, urls: ["https://www.linkedin.com/in/..."] }]
 * and this reads each profile in full (supreme_coder/linkedin-profile-scraper, ~$0.005 each) so the fixed rules can decide.
 *   bun skills/odds-outreach-contacts/scripts/read-urls.ts links.json people.json
 *   bun skills/odds-outreach-contacts/scripts/run.ts --from-file people.json
 */
import { readFileSync, writeFileSync } from "node:fs"
import { apifyReady } from "../../../lib/apify"
import { currentPositions, readProfiles } from "../../../lib/people"
import { loadPages, pageOf, sameCompany } from "../../../lib/rules"

const [inFile, outFile] = process.argv.slice(2)
const groups = JSON.parse(readFileSync(inFile, "utf8")) as Array<{ employer: string; display?: string; role: string; department?: string | null; urls: string[] }>
await loadPages()
if (!(await apifyReady())) process.exit(3)
const norm = (u: string): string => u.trim().replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase()
for (const g of groups) g.urls = g.urls.map(norm)
const profiles = await readProfiles([...new Set(groups.flatMap((g) => g.urls))])
const out = groups.map((g) => {
  const display = g.display ?? g.employer, page = pageOf(g.employer, display) ?? ""
  const people = g.urls.map((u) => profiles.get(u)).filter((p): p is NonNullable<typeof p> => Boolean(p)).map((pr) => {
    const here = currentPositions(pr).find((c) => sameCompany({ name: c.companyName, url: c.companyLinkedinUrl }, g.employer, display, page))
    return { url: pr.linkedinUrl, name: `${pr.firstName} ${pr.lastName}`.trim(), title: here?.position ?? "", headline: pr.headline, company: here?.companyName ?? "", companyUrl: here?.companyLinkedinUrl ?? "", place: pr.location.linkedinText, photo: pr.photo, since: String(here?.startDate?.year ?? "") }
  })
  return { employer: g.employer, display, role: g.role, department: g.department ?? null, people }
})
writeFileSync(outFile, JSON.stringify(out))
console.log(`read ${profiles.size} profiles for ${groups.length} groups -> ${outFile}`)
