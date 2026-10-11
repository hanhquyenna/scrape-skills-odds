/**
 * Where things are and the keys the skills use. Keys come from the environment; when one is missing, the odds repo's own
 * .env.secrets and .env.local are read (ODDS_REPO, default: ../odds-beebalst next to this repo).
 *
 *   SUPABASE_ACCESS_TOKEN  Supabase personal access token (sbp_...): every read and write goes through the Management API.
 *   APIFY_TOKEN            Apify API token. The skills ask the user for it before a run that uses Apify.
 *   TYPESAFE_API_KEY       TypeSafe key, for the clustering and checking skill.
 *   ODDS_PROJECT_REF       Supabase project (default: ukpmpyfcnbhngkgbnkxi, the odds project).
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const SKILLS_REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..")
export const ODDS_REPO = resolve(process.env.ODDS_REPO ?? join(SKILLS_REPO, "..", "odds-beebalst"))
export const PROJECT_REF = process.env.ODDS_PROJECT_REF ?? "ukpmpyfcnbhngkgbnkxi"

const fileVars: Record<string, string> = {}
for (const f of [join(SKILLS_REPO, ".env"), join(ODDS_REPO, ".env.secrets"), join(ODDS_REPO, ".env.local")]) {
  if (!existsSync(f)) continue
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && m[2] && !(m[1] in fileVars)) fileVars[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

/** A key from the environment, else from the files above; undefined when it is nowhere. */
export const env = (name: string): string | undefined => process.env[name] || fileVars[name] || undefined

/** A key that must be there: stops with one clear line saying what to set. */
export function need(name: string, why: string): string {
  const v = env(name)
  if (v === undefined) {
    console.error(`Missing ${name} (${why}). Set it for this run, e.g. ${name}=... bun <script>, or put it in ${join(SKILLS_REPO, ".env")}.`)
    process.exit(2)
  }
  return v as string
}

/** Command-line flags: arg("--limit", "40"), flag("--dry"). */
export const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}
export const flag = (name: string): boolean => process.argv.includes(name)
