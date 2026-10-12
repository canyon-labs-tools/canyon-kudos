// Supabase Edge Function — public submission proxy for canyon-kudos.
//
// Validates a recognition submission and inserts it with the service-role
// key. Submissions post straight to the board; there is no screening step.
//
// The browser calls this instead of inserting directly so that the
// `recognitions` table itself stays closed to anonymous writes.
//
// GET ?people=<text> powers the name picker on the form (see people.ts).
// After a successful insert, everyone picked from the staff list gets an
// email (see notify.ts). Email never fails the submission.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";
import { emailsFor, MAX_RECIPIENTS, searchPeople } from "./people.ts";
import { notifyNominees } from "./notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// The form is public, so cap how much mail it can cause. The busiest hour on
// record had 6 submissions.
const MAX_SUBMISSIONS_PER_HOUR_FOR_EMAIL = 20;
const MAX_EMAILS_PER_PERSON_PER_DAY = 3;

const CORE_VALUES = ["Innovation", "Integrity", "Hard Work", "Teamwork", "Passion"];
const MAX_LEN = 2000;

function json(status: number, body: any) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Keeps only people whose name is in the posted recipient text (so the email
// matches the board), and applies the rate caps. Counts include this submission.
async function allowedNominees(sb: any, nominees: { name: string; email: string }[], recipient: string) {
  if (nominees.length === 0) return nominees;
  const lower = recipient.toLowerCase();
  const named = nominees.filter((n) => lower.includes(n.name.toLowerCase()));
  if (named.length === 0) return named;

  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count: lastHour } = await sb.from("recognitions")
    .select("id", { count: "exact", head: true }).gte("created_at", hourAgo);
  if ((lastHour ?? 0) > MAX_SUBMISSIONS_PER_HOUR_FOR_EMAIL) {
    console.warn("kudos-submit: hourly email cap reached, skipped", { lastHour });
    return [];
  }

  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  const out = [];
  for (const n of named) {
    const pattern = "%" + n.name.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
    const { count } = await sb.from("recognitions")
      .select("id", { count: "exact", head: true })
      .gte("created_at", dayAgo).ilike("recipient_name", pattern);
    if ((count ?? 0) > MAX_EMAILS_PER_PERSON_PER_DAY) {
      console.warn("kudos-submit: daily per-person cap reached, skipped one");
    } else out.push(n);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method === "GET") {
    const q = new URL(req.url).searchParams.get("people");
    if (q === null) return json(400, { error: "Missing people query" });
    try {
      return json(200, { people: await searchPeople(q) });
    } catch (e) {
      console.error("kudos-submit people lookup error", { err: String(e) });
      return json(500, { error: "Lookup failed" });
    }
  }

  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  // Normalize + validate input.
  const recipient = String(body?.recipient_name ?? "").trim();
  const nominatorRaw = String(body?.nominator_name ?? "").trim();
  const nominator = nominatorRaw || "Anonymous";
  const value = String(body?.core_value ?? "").trim();
  const description = String(body?.description ?? "").trim();
  const site_id = body?.site_id || null;
  const recipientIds: string[] = Array.isArray(body?.recipient_ids)
    ? [...new Set(
      body.recipient_ids.map((x: any) => String(x ?? "").trim()).filter((x: string) => x && x.length <= 50),
    )] as string[]
    : [];

  if (!recipient || !value || !description) {
    return json(400, { error: "Missing required fields" });
  }
  if (!CORE_VALUES.includes(value)) {
    return json(400, { error: "Invalid core value" });
  }
  if (recipient.length > 200 || nominator.length > 200 || description.length > MAX_LEN) {
    return json(400, { error: "Field too long" });
  }
  if (recipientIds.length > MAX_RECIPIENTS) {
    return json(400, { error: "Too many recipients" });
  }

  const { error } = await sb.from("recognitions").insert({
    recipient_name: recipient,
    nominator_name: nominator,
    core_value: value,
    description,
    site_id,
    approved: true,
    flag_reason: null,
  });
  if (error) {
    console.error("kudos-submit insert error", { err: error });
    return json(500, { error: "Could not save recognition" });
  }

  let emailed = 0;
  try {
    const nominees = await allowedNominees(sb, await emailsFor(recipientIds), recipient);
    emailed = await notifyNominees(nominees, { nominator, value, description }, Deno.env);
    console.log("kudos-submit: nominee email", { picked: recipientIds.length, withEmail: nominees.length, sent: emailed });
  } catch (e) {
    console.error("kudos-submit: nominee email error", { err: String(e) });
  }

  return json(200, { ok: true, status: "published", emailed });
});
