// Supabase Edge Function — public submission proxy for canyon-kudos.
//
// Receives a recognition submission, runs it through an automated
// moderation check (Claude), and inserts it with the service-role key.
// Clean submissions are auto-approved (approved=true) and post immediately;
// anything derogatory/inappropriate — or any moderation error/uncertainty —
// is held for human review (approved=false + flag_reason). FAIL-CLOSED:
// if the check can't run confidently, the item is held, never auto-posted.
//
// The browser calls this instead of inserting directly, so it cannot set
// approved=true itself.

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

// Ask Claude whether a submission is a genuine, respectful recognition.
// Returns { verdict: "clean" | "flag", reason }. Throws on any failure so
// the caller can fail closed (hold for review).
async function moderate(input: {
  recipient: string;
  nominator: string;
  value: string;
  description: string;
}): Promise<{ verdict: "clean" | "flag"; reason: string }> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const system =
    "You are a content moderator for Canyon Labs' internal employee-recognition tool. " +
    "Employees submit a short note praising a coworker for embodying a core value. " +
    "Decide whether a submission is a genuine, respectful, workplace-appropriate recognition, " +
    "or should be HELD for human review. Hold (flag) if it contains ANY of: insults, derogatory, " +
    "demeaning or mocking language; sarcastic or backhanded 'praise'; harassment or threats; " +
    "profanity or slurs; sexual content; discriminatory remarks (race, gender, religion, age, etc.); " +
    "or content that is clearly not a real recognition (spam, gibberish, a test, or a personal attack). " +
    "When in doubt, flag. Respond with ONLY minified JSON, no prose, no code fences: " +
    '{"verdict":"clean"|"flag","reason":"<=12 words, empty string if clean"}.';

  const user =
    `Recipient: ${input.recipient}\nFrom: ${input.nominator}\n` +
    `Core value: ${input.value}\nRecognition: ${input.description}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 80,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!resp.ok) {
    throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = await resp.json();
  const text: string = (data?.content?.[0]?.text ?? "").trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Unparseable moderation response");
  const parsed = JSON.parse(match[0]);
  const verdict = parsed?.verdict === "clean" ? "clean" : "flag";
  const reason = typeof parsed?.reason === "string" ? parsed.reason : "";
  return { verdict, reason };
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

  // Moderate — fail closed: any error → hold for human review.
  let approved = false;
  let flag_reason: string | null = null;
  try {
    const m = await moderate({ recipient, nominator, value, description });
    if (m.verdict === "clean") {
      approved = true;
    } else {
      flag_reason = m.reason || "Flagged by automated review";
    }
  } catch (e: any) {
    console.error("kudos-submit moderation error", { err: String(e?.message || e) });
    flag_reason = "Held for review — automated check unavailable";
  }

  const { error } = await sb.from("recognitions").insert({
    recipient_name: recipient,
    nominator_name: nominator,
    core_value: value,
    description,
    site_id,
    approved,
    flag_reason,
    moderated_at: new Date().toISOString(),
  });
  if (error) {
    console.error("kudos-submit insert error", { err: error });
    return json(500, { error: "Could not save recognition" });
  }

  return json(200, { ok: true, status: approved ? "published" : "held" });
});
