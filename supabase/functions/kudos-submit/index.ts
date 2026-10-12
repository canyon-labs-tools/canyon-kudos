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
// email (see notify.ts), sent after the response. Email never fails the submission.

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

// Normalizes and validates a submission. The real submit and the system check
// both use it, so the check proves the same rules.
type Submission = {
  recipient: string;
  nominator: string;
  value: string;
  description: string;
  site_id: any;
  recipientIds: string[];
};
function validate(body: any): Submission | { error: string } {
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
    return { error: "Missing required fields" };
  }
  if (!CORE_VALUES.includes(value)) {
    return { error: "Invalid core value" };
  }
  if (recipient.length > 200 || nominator.length > 200 || description.length > MAX_LEN) {
    return { error: "Field too long" };
  }
  if (recipientIds.length > MAX_RECIPIENTS) {
    return { error: "Too many recipients" };
  }

  return { recipient, nominator, value, description, site_id, recipientIds };
}

// System check: the admin page's "Run system check" button. It runs the real
// save and email steps without posting anything to the board:
//   1. the admin password is checked, the same way kudos-admin checks it;
//   2. the entry is saved hidden (approved=false, so the board and TV display
//      never show it), then deleted by its id straight away;
//   3. one email goes to the one person the admin picked (themselves), marked
//      [SYSTEM CHECK]. The email is awaited so the result can report it.
const CHECK_FLAG = "SYSTEM CHECK — removed automatically";

async function systemCheck(sb: any, body: any, v: Submission) {
  const { data: row } = await sb.from("recognition_settings")
    .select("value").eq("key", "admin_password").single();
  if (!row || !body?.password || row.value !== body.password) {
    return json(401, { error: "Unauthorized" });
  }
  if (v.recipientIds.length !== 1) {
    return json(400, { error: "Pick exactly one person (yourself) for the check" });
  }

  const steps: { step: string; ok: boolean; detail: string }[] = [];
  steps.push({ step: "Form rules", ok: true, detail: "The entry passed the same checks a real submission gets." });

  const { data: saved, error: insErr } = await sb.from("recognitions").insert({
    recipient_name: v.recipient,
    nominator_name: v.nominator,
    core_value: v.value,
    description: v.description,
    site_id: v.site_id,
    approved: false,
    flag_reason: CHECK_FLAG,
  }).select("id").single();
  if (insErr || !saved) {
    console.error("kudos-submit check: insert error", { err: insErr });
    steps.push({ step: "Save to database", ok: false, detail: "The save failed." });
  } else {
    steps.push({ step: "Save to database", ok: true, detail: "Saved as a hidden entry." });
    const { error: delErr } = await sb.from("recognitions").delete()
      .eq("id", saved.id).eq("flag_reason", CHECK_FLAG);
    steps.push(delErr
      ? { step: "Remove test entry", ok: false, detail: `Could not remove hidden entry ${saved.id}. It is not shown on the board.` }
      : { step: "Remove test entry", ok: true, detail: "The hidden entry was deleted." });
  }

  const people = await emailsFor(v.recipientIds);
  if (people.length === 0) {
    steps.push({ step: "Find email address", ok: false, detail: "No work email found for the person picked." });
  } else {
    steps.push({ step: "Find email address", ok: true, detail: `Found the work email for ${people[0].name}.` });
    const sent = await notifyNominees(people.slice(0, 1), {
      nominator: v.nominator,
      value: v.value,
      description: v.description,
      subjectPrefix: "[SYSTEM CHECK] ",
    }, Deno.env);
    steps.push(sent === 1
      ? { step: "Send email", ok: true, detail: `Email sent to ${people[0].name}. Check that inbox.` }
      : { step: "Send email", ok: false, detail: "The email did not send. See the kudos-submit function logs." });
  }

  console.log("kudos-submit: system check", { ok: steps.every((s) => s.ok) });
  return json(200, { ok: steps.every((s) => s.ok), steps });
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

  const v = validate(body);
  if ("error" in v) return json(400, { error: v.error });
  const { recipient, nominator, value, description, site_id, recipientIds } = v;

  if (body?.check === true) return systemCheck(sb, body, v);

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

  // The email takes a second or more (sign-in to Microsoft, one send per
  // person), so it runs after the response: the person submitting doesn't wait.
  const sendEmail = async () => {
    try {
      const nominees = await allowedNominees(sb, await emailsFor(recipientIds), recipient);
      const sent = await notifyNominees(nominees, { nominator, value, description }, Deno.env);
      console.log("kudos-submit: nominee email", { picked: recipientIds.length, withEmail: nominees.length, sent });
    } catch (e) {
      console.error("kudos-submit: nominee email error", { err: String(e) });
    }
  };
  const runtime = (globalThis as any).EdgeRuntime;
  if (recipientIds.length === 0) {
    // Nothing to send.
  } else if (runtime?.waitUntil) runtime.waitUntil(sendEmail());
  else await sendEmail();

  return json(200, { ok: true, status: "published" });
});
