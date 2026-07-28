// Supabase Edge Function — public submission proxy for canyon-kudos.
//
// Validates a recognition submission and inserts it with the service-role
// key. Submissions post straight to the board; there is no screening step.
//
// The browser calls this instead of inserting directly so that the
// `recognitions` table itself stays closed to anonymous writes.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CORE_VALUES = ["Innovation", "Integrity", "Hard Work", "Teamwork", "Passion"];
const MAX_LEN = 2000;

function json(status: number, body: any) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
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

  if (!recipient || !value || !description) {
    return json(400, { error: "Missing required fields" });
  }
  if (!CORE_VALUES.includes(value)) {
    return json(400, { error: "Invalid core value" });
  }
  if (recipient.length > 200 || nominator.length > 200 || description.length > MAX_LEN) {
    return json(400, { error: "Field too long" });
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

  return json(200, { ok: true, status: "published" });
});
