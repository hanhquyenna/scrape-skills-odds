/**
 * Apify: checking the token and running an actor. A run is started in the background and waited on (a synchronous call stops at 300 s).
 * When Apify cannot be used (no token, a wrong token, no credit, the actor refuses), ApifyUnavailable is thrown: the skill then says so
 * and switches to its browser route.
 */
import { env } from "./env"

export class ApifyUnavailable extends Error {}

const token = (): string => {
  const t = env("APIFY_TOKEN")
  if (!t) throw new ApifyUnavailable("No APIFY_TOKEN: ask the user for their Apify API token (apify.com > Settings > API & Integrations).")
  return t
}
const api = async (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`https://api.apify.com/v2${path}`, { ...init, headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", ...(init.headers ?? {}) } })

/** Who the token belongs to and how much of this month's credit is left. Throws ApifyUnavailable for a wrong token or no credit. */
export async function checkApify(): Promise<{ user: string; plan: string; usedUsd: number; limitUsd: number; leftUsd: number }> {
  const me = await api("/users/me")
  if (me.status === 401) throw new ApifyUnavailable("The Apify token is not valid (401). Ask the user to copy it again from apify.com > Settings > API & Integrations.")
  const user = ((await me.json()) as any).data
  const lim = ((await (await api("/users/me/limits")).json()) as any).data ?? {}
  const usedUsd = Number(lim.current?.monthlyUsageUsd ?? 0), limitUsd = Number(lim.limits?.maxMonthlyUsageUsd ?? 0)
  const out = { user: user?.username ?? "?", plan: user?.plan?.id ?? "?", usedUsd, limitUsd, leftUsd: limitUsd - usedUsd }
  if (limitUsd > 0 && out.leftUsd <= 0.01) throw new ApifyUnavailable(`Apify account ${out.user} (${out.plan}) has used $${usedUsd.toFixed(2)} of $${limitUsd} this month: no credit left.`)
  return out
}

export interface RunResult<T> { items: T[]; status: string; usd: number; runId: string; datasetId: string }

/**
 * Runs an actor and returns its items. `cap` (dollars) stops a pay-per-event actor once it has charged that much; leave it out to let
 * the run finish. Some actors refuse a cap below $0.50: the cap is raised to that.
 */
export async function runActor<T = Record<string, any>>(actor: string, input: unknown, opts: { cap?: number; maxItems?: number; quiet?: boolean } = {}): Promise<RunResult<T>> {
  const q = new URLSearchParams()
  if (opts.cap !== undefined) q.set("maxTotalChargeUsd", Math.max(opts.cap, 0.5).toFixed(3))
  if (opts.maxItems !== undefined) q.set("maxItems", String(opts.maxItems))
  const start = await api(`/acts/${actor.replace("/", "~")}/runs?${q}`, { method: "POST", body: JSON.stringify(input) })
  if (!start.ok) {
    const text = (await start.text()).slice(0, 300)
    if ([401, 402, 403].includes(start.status) || /credit|limit|paid plan|rent|trial/i.test(text)) throw new ApifyUnavailable(`${actor} refused to start (${start.status}): ${text}`)
    throw new Error(`${actor} start ${start.status}: ${text}`)
  }
  let run = ((await start.json()) as any).data
  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) {
    await new Promise((x) => setTimeout(x, 8000))
    run = ((await (await api(`/actor-runs/${run.id}`)).json()) as any).data
  }
  const items: T[] = []
  for (let offset = 0; ; offset += 1000) {
    const page = (await (await api(`/datasets/${run.defaultDatasetId}/items?clean=true&offset=${offset}&limit=1000`)).json()) as T[]
    items.push(...page)
    if (page.length < 1000) break
  }
  if (!opts.quiet) console.log(`  apify ${actor}: ${run.status}, ${items.length} items, $${Number(run.usageTotalUsd ?? 0).toFixed(3)}`)
  if (items.length === 0) {
    // Some actors cap free accounts ("Free users are limited to 10 runs") and still report SUCCEEDED with no items: read the log.
    const log = await (await api(`/actor-runs/${run.id}/log`)).text()
    if (/free (users|plan)|limited to \d+ runs|run limit|upgrade to a paid|insufficient|hard limit|credit/i.test(log)) throw new ApifyUnavailable(`${actor}: ${(log.match(/.*(free|limit|upgrade|insufficient|credit).*/gi) ?? []).slice(-2).join(" | ").slice(0, 300)}`)
  }
  return { items, status: run.status, usd: Number(run.usageTotalUsd ?? 0), runId: run.id, datasetId: run.defaultDatasetId }
}

/** The items of an earlier run's dataset (already paid for), e.g. to write them again after a failed write. */
export async function datasetItems<T = Record<string, any>>(datasetId: string): Promise<T[]> {
  return (await (await api(`/datasets/${datasetId}/items?clean=true&limit=100000`)).json()) as T[]
}

/** The dataset of an actor's most recent run. */
export async function lastDataset(actor: string): Promise<string | null> {
  const r = ((await (await api(`/acts/${actor.replace("/", "~")}/runs?limit=1&desc=1`)).json()) as any).data?.items?.[0]
  return r?.defaultDatasetId ?? null
}

/** The input of an actor's most recent run. */
export async function lastInput(actor: string): Promise<Record<string, any> | null> {
  const r = await api(`/acts/${actor.replace("/", "~")}/runs/last/key-value-store/records/INPUT`)
  return r.ok ? ((await r.json()) as Record<string, any>) : null
}

/** Prints the Apify account line and returns true, or prints why Apify cannot be used and returns false. */
export async function apifyReady(): Promise<boolean> {
  try {
    const a = await checkApify()
    console.log(`Apify: ${a.user} (${a.plan}), $${a.usedUsd.toFixed(2)} of $${a.limitUsd} used this month, $${a.leftUsd.toFixed(2)} left`)
    return true
  } catch (e) {
    if (e instanceof ApifyUnavailable) { console.log(`APIFY UNAVAILABLE: ${e.message}`); return false }
    throw e
  }
}
