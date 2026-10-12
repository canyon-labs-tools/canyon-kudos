// Staff lookups for canyon-kudos, read from the HR table echo.employee.
//
// The echo schema is not exposed through the Data API, so this reads over the
// function's own database connection (SUPABASE_DB_URL). Only active employees.
// The browser only ever gets id + name + site; emails stay on the server.

import postgres from "npm:postgres@3.4.5";

export type Person = { id: string; name: string; site: string | null };

let sql: ReturnType<typeof postgres> | null = null;
function db() {
  if (!sql) {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 1, prepare: false });
  }
  return sql;
}

export const MIN_QUERY = 2;
export const MAX_RESULTS = 8;
export const MAX_RECIPIENTS = 10;

// Escapes LIKE wildcards so a typed % or _ matches literally.
export function likeTerm(q: string): string {
  return "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
}

// Substring matches first, then close spellings (pg_trgm word similarity), so
// "Christansen" still finds "Christensen". Used by the type-ahead and by the
// "did you mean" check when a typed name was never picked.
export const FUZZY_MIN = 0.4;

export async function searchPeople(q: string): Promise<Person[]> {
  const term = q.trim().slice(0, 100);
  if (term.length < MIN_QUERY) return [];
  const rows = await db()`
    select employee_id as id, full_name as name, site
    from echo.employee
    where status = 'active'
      and (full_name ilike ${likeTerm(term)}
        or (length(${term}::text) >= 3 and extensions.word_similarity(${term}::text, full_name) >= ${FUZZY_MIN}::real))
    order by (full_name ilike ${likeTerm(term)}) desc,
      (full_name ilike ${term + "%"}) desc,
      extensions.word_similarity(${term}::text, full_name) desc, full_name
    limit ${MAX_RESULTS}`;
  return rows.map((r) => ({ id: r.id, name: r.name, site: r.site ?? null }));
}

export async function emailsFor(ids: string[]): Promise<{ name: string; email: string }[]> {
  if (ids.length === 0) return [];
  const rows = await db()`
    select full_name as name, work_email as email
    from echo.employee
    where status = 'active' and work_email is not null and work_email <> ''
      and employee_id in ${db()(ids)}`;
  return rows.map((r) => ({ name: r.name, email: r.email }));
}
