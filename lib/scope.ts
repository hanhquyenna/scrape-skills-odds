/**
 * THE TABLE every skill fills data for: the view `active_internship_entry_english` (internship and entry-level jobs that are still open and
 * do not need Dutch), restricted to jobs posted in the last DAYS days, and always worked NEWEST FIRST (job day, then employer's newest job).
 * Rows are read through `app_jobs` (the same columns plus level_view) so a job's data can be matched to it. A job's day is its posting
 * date, else today minus its age in days.
 */
export const TABLE = "active_internship_entry_english"

export const DAY = "coalesce(posted_on, current_date - days_open)"

export const scopeWhere = (days: number): string =>
  `id in (select id from ${TABLE}) and ${DAY} >= current_date - ${days}`

/** One row per job in scope: id, employer (the table's key), display name, title, level, family, day; newest first. */
export const jobsSql = (days: number, extraWhere = "true"): string => `
  select id, employer, coalesce(employer_display, employer) as display, coalesce(title_clean, title) as title, level_view as level, family, ${DAY}::text as day
  from app_jobs where ${scopeWhere(days)} and (${extraWhere}) order by ${DAY} desc, id`

/** One row per employer in scope, ordered by its newest job: employer, display, families of its jobs, job count, newest day. */
export const employersSql = (days: number): string => `
  select employer, max(coalesce(employer_display, employer)) as display,
    coalesce(array_agg(distinct family) filter (where family is not null), '{}') as families, count(*)::int as jobs, max(${DAY})::text as newest
  from app_jobs where ${scopeWhere(days)} group by employer order by max(${DAY}) desc, count(*) desc`
