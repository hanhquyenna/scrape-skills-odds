/**
 * Checks and clusters what the other skills stored, with TypeSafe (Jev). Jev only classifies; it never writes text people read.
 *
 *   bun skills/odds-typesafe-cluster/scripts/run.ts --people      [--limit 500] [--dry]
 *       each outreach contact: in the Netherlands? works at this employer now? which department? which seniority?
 *       -> jev.in_netherlands, jev.works_at, jev.department_jev, jev.seniority; decision_final 'reject' when either check is below 0.8;
 *          the role is corrected when Jev puts them in another department or seniority (hiring manager / peer / recruiter)
 *   bun skills/odds-typesafe-cluster/scripts/run.ts --past-hires  [--limit 500] [--dry]
 *       each past-hire match: is the held role the same role as the job, an adjacent one, or unrelated?
 *       -> status exact/adjacent as Jev reads it; unrelated (confidence >= 0.6) -> validation_status 'conflict' (hidden by the app)
 *   bun skills/odds-typesafe-cluster/scripts/run.ts --dedupe-jobs [--days 30] [--dry]
 *       the same job found twice (LinkedIn and Glassdoor, different employer spellings): -> the Glassdoor copy gets usable = 0
 * Without a flag, all three run. Rows Jev already read are skipped.
 */
import { lit, sql } from "../../../lib/db"
import { arg, flag } from "../../../lib/env"
import { DEPARTMENT_TITLES, titleOverlap } from "../../../lib/rules"
import { scopeWhere } from "../../../lib/scope"
import { ask, pool, type Question } from "../../../lib/typesafe"

const DRY = flag("--dry"), LIMIT = Number(arg("--limit", "500")), DAYS = Number(arg("--days", "30"))
const ALL = !flag("--people") && !flag("--past-hires") && !flag("--dedupe-jobs")
const DEPARTMENTS: Record<string, string> = Object.fromEntries([...Object.entries(DEPARTMENT_TITLES).map(([k, v]) => [k, `Works in ${k}: titles such as ${v.join(", ")}.`]), ["Other", "None of these departments, or the title does not say."]])

// ---- 1. People ----
if (ALL || flag("--people")) {
  const people = await sql<{ employer: string; display: string; profile_url: string; name: string; headline: string; place: string; positions: any; jev: any }>(`
    select p.employer, coalesce((select max(employer_display) from app_jobs a where a.employer = p.employer), p.employer) display, p.profile_url, p.name, p.headline, p.place, p.positions, p.jev
    from job_people p where p.jev->>'source' = 'rules' and p.jev->>'jev_checked' is null and p.employer in (select employer from app_jobs where ${scopeWhere(DAYS)})
    order by p.fetched_at desc limit ${LIMIT}`)
  console.log(`people to check: ${people.length}`)
  const questions: Record<string, Question> = {
    in_netherlands: { type: "noul", instructions: "The person is based in the Netherlands now.", criteria: { true: "The place line names a Dutch city, town, province or region, or the Netherlands.", false: "The place is outside the Netherlands, missing, or too vague to tell." } },
    works_at_company: { type: "noul", instructions: "The person works at the company in the Company line now.", criteria: { true: "The current position is at that company, written with or without a legal form or as a clearly named part of it.", false: "The current position is at another company, or the role ended, or it cannot be told." } },
    department: { type: "choice", instructions: "Which department does the person's current title belong to?", criteria: DEPARTMENTS },
    seniority: { type: "choice", instructions: "How senior is the person's current title?", criteria: { student: "Intern, working student, trainee or graduate programme.", entry: "Junior or first job, or a plain title with no seniority word.", experienced: "Medior, senior, specialist, principal or expert, without managing people.", manager: "Manages people or a team: manager, team lead, head of a team.", director: "Director, vice president, head of a whole function, C-level, founder or partner." } },
  }
  let rejected = 0, moved = 0
  await pool(people, 6, async (p) => {
    const pos = (Array.isArray(p.positions) ? p.positions : [])[0] ?? {}
    const a = await ask(`Company line: ${p.display}\nCurrent position: ${pos.title ?? p.headline} at ${pos.company ?? p.jev?.company ?? "(not given)"}\nHeadline: ${p.headline}\nPlace line: ${p.place}`, questions)
    if (!a) return
    const inNl = a.in_netherlands?.noul ?? 0, works = a.works_at_company?.noul ?? 0
    const dep = a.department?.choice ?? null, sen = a.seniority?.choice ?? null
    const keep = inNl >= 0.8 && works >= 0.8
    let role = p.jev?.role as string | undefined
    if (keep && role && role !== "recruiter" && dep && dep !== "Other") {
      const level = sen === "manager" || sen === "director" ? "manager" : sen === "experienced" ? null : "peer"
      const sameDep = dep === p.jev?.department
      const next = dep === "HR & recruiting" && /recruit|talent/i.test(p.headline) ? "recruiter" : level ? `${sameDep || !p.jev?.department ? "" : "adjacent_"}${level === "manager" ? (sameDep ? "hiring_manager" : "manager") : "peer"}` : null
      const fixed = next === "adjacent_manager" || next === "hiring_manager" || next === "adjacent_peer" || next === "peer" || next === "recruiter" ? next : next === "manager" ? "adjacent_manager" : null
      if (fixed && fixed !== role) { role = fixed; moved++ }
      if (!fixed && level === null && !role.startsWith("adjacent")) { /* experienced, not senior management: leave as stored */ }
    }
    if (!keep) rejected++
    if (DRY) return
    await sql(`update job_people set jev = jev || ${lit(JSON.stringify({ jev_checked: new Date().toISOString().slice(0, 10), in_netherlands: inNl, works_at: works, department_jev: dep, seniority: sen, ...(role ? { role } : {}), ...(keep ? {} : { decision_final: "reject" }) }))}::jsonb where employer = ${lit(p.employer)} and profile_url = ${lit(p.profile_url)}`)
  })
  console.log(`people: ${people.length} checked, ${rejected} rejected (not in NL or not at the company), ${moved} moved to another role`)
}

// ---- 2. Past hires ----
if (ALL || flag("--past-hires")) {
  const rows = await sql<{ id: string; title: string; employer: string; body: string | null; status: string; relevant_history: any; previous_experience: any }>(`
    select e.id, coalesce(a.title_clean, a.title) title, a.employer_display employer, left(p.body, 1500) body, e.status, e.relevant_history, e.previous_experience
    from job_candidate_evidence e join app_jobs a on a.id = e.posting_id join postings p on p.id = e.posting_id
    where e.validation_status = 'validated' and e.validation_notes like 'rules:%' and coalesce(e.validation_notes, '') not like '%jev:%'
    order by e.created_at desc limit ${LIMIT}`)
  console.log(`past-hire matches to check: ${rows.length}`)
  const questions: Record<string, Question> = {
    relation: { type: "choice", instructions: "How does the role the person held relate to the job? Judge the work itself (what the posting describes and what the held title says), at the same employer.", criteria: {
      same_role: "The held role is this job or the same kind of work at the same level (the same team or function and the same tasks).",
      adjacent_role: "A different but neighbouring role: the same department with other tasks, or a nearby function whose skills carry over to this job.",
      unrelated: "The held role is different work: another field, whose experience says little about doing this job.",
    } },
  }
  let changed = 0, dropped = 0
  await pool(rows, 6, async (r) => {
    const held = r.previous_experience ?? {}
    const a = await ask(`Job: ${r.title} at ${r.employer}\nPosting (start): ${r.body ?? "(not available)"}\nRole the person held at ${held.employer ?? r.employer}: ${held.title ?? r.relevant_history?.held_title ?? "(unknown)"} (${held.start ?? "?"} to ${held.end ?? "now"})`, questions)
    const c = a?.relation?.choice, conf = a?.relation?.confidence ?? 0
    if (!c) return
    const note = `jev: ${c} ${conf.toFixed(2)}`
    if (DRY) return
    if (c === "unrelated" && conf >= 0.6) {
      dropped++
      await sql(`update job_candidate_evidence set validation_status = 'conflict', validation_notes = validation_notes || ${lit(`; ${note}`)}, updated_at = now() where id = ${lit(r.id)}`)
    } else {
      const status = c === "same_role" ? "exact" : "adjacent"
      if (status !== r.status) changed++
      await sql(`update job_candidate_evidence set status = ${lit(status)}, relevant_history = coalesce(relevant_history, '{}'::jsonb) || ${lit(JSON.stringify({ jev_relation: c, jev_confidence: conf }))}::jsonb, validation_notes = validation_notes || ${lit(`; ${note}`)}, updated_at = now() where id = ${lit(r.id)}`)
    }
  })
  console.log(`past hires: ${rows.length} checked, ${changed} changed between exact and adjacent, ${dropped} unrelated (hidden)`)
}

// ---- 3. The same job from two sources ----
if (ALL || flag("--dedupe-jobs")) {
  const jobs = await sql<{ id: string; ats: string; employer: string; title: string; region: string; body: string | null }>(`
    select p.id, p.ats, p.employer, p.title, p.region, left(p.body, 800) body from postings p
    where p.closed_at is null and coalesce(p.usable, 1) >= 0.5 and p.id in (select id from app_jobs where ${scopeWhere(DAYS)})`)
  const city = (r: string): string => r.toLowerCase().split(",")[0].replace(/[^a-z ]/g, "").trim()
  const pairs: Array<[typeof jobs[0], typeof jobs[0]]> = []
  const gd = jobs.filter((j) => j.ats === "glassdoor"), other = jobs.filter((j) => j.ats !== "glassdoor")
  for (const g of gd) for (const o of other) if (titleOverlap(g.title, o.title) >= 0.8 && titleOverlap(o.title, g.title) >= 0.8 && (city(g.region) === city(o.region) || city(g.region) === "netherlands" || city(o.region) === "netherlands")) pairs.push([g, o])
  console.log(`possible duplicates (Glassdoor vs LinkedIn): ${pairs.length}`)
  const questions: Record<string, Question> = { same_job: { type: "noul", instructions: "Posting A and posting B are the same job opening (the same employer, possibly under another name such as a parent company or brand, the same role and place).", criteria: { true: "Same employer (or its parent or brand), same role, same place, the texts describe the same opening.", false: "Different employers, or different roles, places or openings." } } }
  let hidden = 0
  await pool(pairs, 6, async ([g, o]) => {
    const a = await ask(`Posting A: ${g.title} at ${g.employer}, ${g.region}\n${g.body ?? ""}\n\nPosting B: ${o.title} at ${o.employer}, ${o.region}\n${o.body ?? ""}`, questions)
    if ((a?.same_job?.noul ?? 0) >= 0.85) { hidden++; if (!DRY) await sql(`update postings set usable = 0 where id = ${lit(g.id)}`) }
  })
  console.log(`duplicates hidden: ${hidden}`)
}
