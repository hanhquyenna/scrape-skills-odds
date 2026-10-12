/**
 * Hand-found profile links -> the profiles file for `run.ts --from-file`.
 *   links.json: [{ jobId, urls: ["https://www.linkedin.com/in/..."] }]   (found by web search, free)
 *   bun skills/odds-past-hires/scripts/read-urls.ts links.json profiles.json     reads each profile in full (~$0.005 each)
 *   bun skills/odds-past-hires/scripts/run.ts --from-file profiles.json          fixed rules decide exact / adjacent
 */
import { readFileSync, writeFileSync } from "node:fs"
import { apifyReady } from "../../../lib/apify"
import { readProfiles } from "../../../lib/people"

const [inFile, outFile] = process.argv.slice(2)
const norm = (u: string): string => u.trim().replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase()
const groups = (JSON.parse(readFileSync(inFile, "utf8")) as Array<{ jobId: string; urls: string[] }>).map((g) => ({ ...g, urls: g.urls.map(norm) }))
if (!(await apifyReady())) process.exit(3)
const profiles = await readProfiles([...new Set(groups.flatMap((g) => g.urls))])
writeFileSync(outFile, JSON.stringify(groups.map((g) => ({ jobId: g.jobId, profiles: g.urls.map((u) => profiles.get(u)).filter(Boolean) }))))
console.log(`read ${profiles.size} profiles for ${groups.length} jobs -> ${outFile}`)
