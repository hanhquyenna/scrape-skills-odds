/** The odds database, through the Supabase Management API (SQL as the project owner). */
import { PROJECT_REF, need } from "./env"

const PAT = need("SUPABASE_ACCESS_TOKEN", "Supabase personal access token for the odds project")

/** Runs SQL and returns the rows of the last statement. Retries when the API throttles or hiccups. */
export async function sql<T = Record<string, any>>(query: string): Promise<T[]> {
  let last = ""
  for (let i = 0; i < 8; i++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json", "User-Agent": "scrape-skills-odds" },
      body: JSON.stringify({ query }),
    }).catch((e: Error) => ({ ok: false, status: 0, text: async () => e.message }) as unknown as Response)
    if (r.ok) return (await r.json()) as T[]
    last = `${r.status} ${(await r.text()).slice(0, 300)}`
    if (r.status === 429 || r.status >= 500 || r.status === 0) { await new Promise((x) => setTimeout(x, 2000 * 2 ** i)); continue }
    throw new Error(`sql ${last}`)
  }
  throw new Error(`sql kept failing: ${last}`)
}

/** A SQL string literal that cannot break out (dollar-quoted). */
export const lit = (s: unknown): string => `$q$${String(s ?? "").replace(/\$q\$/g, "")}$q$`
/** A jsonb literal, or null. */
export const jsonb = (v: unknown): string => (v == null ? "null" : `${lit(JSON.stringify(v))}::jsonb`)
/** A number, or null. */
export const num = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? String(v) : "null")
