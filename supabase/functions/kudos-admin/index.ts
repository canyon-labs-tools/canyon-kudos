// Supabase Edge Function — admin proxy for canyon-kudos.
//
// Validates the caller-supplied admin password against
// recognition_settings.admin_password using the service-role key, then
// performs the requested action on behalf of the admin. The browser never
// sees the service-role key. Public reads/writes (form submission, feed,
// TV display, sites list) continue to hit Supabase directly with the anon
// key under the existing RLS policies.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: any) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

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
  const { password, action, payload = {} } = body || {};
  if (!password || !action) {
    return json(400, { error: "Missing password or action" });
  }

  // Validate admin password with constant-ish-time-ish comparison.
  // (The password lives in a low-cardinality settings table; this is the
  // same threat model the previous client-side check used.)
  const { data: row, error: pwErr } = await sb
    .from("recognition_settings")
    .select("value")
    .eq("key", "admin_password")
    .single();
  if (pwErr || !row || row.value !== password) {
    return json(401, { error: "Unauthorized" });
  }

  try {
    switch (action) {
      case "ping":
        return json(200, { ok: true });

      case "loadModeration": {
        const [pendingRes, approvedRes] = await Promise.all([
          sb.from("recognitions").select("*, recognition_sites(name)")
            .eq("approved", false).order("created_at", { ascending: false }),
          sb.from("recognitions").select("*, recognition_sites(name)")
            .eq("approved", true).order("created_at", { ascending: false })
            .limit(50),
        ]);
        if (pendingRes.error) throw pendingRes.error;
        if (approvedRes.error) throw approvedRes.error;
        return json(200, {
          pending: pendingRes.data ?? [],
          approved: approvedRes.data ?? [],
        });
      }

      case "approve": {
        const { id } = payload;
        if (!id) return json(400, { error: "Missing id" });
        const { error } = await sb.from("recognitions")
          .update({ approved: true }).eq("id", id);
        if (error) throw error;
        return json(200, { ok: true });
      }

      case "approveBulk": {
        const { ids } = payload;
        if (!Array.isArray(ids) || ids.length === 0) {
          return json(400, { error: "Missing ids" });
        }
        const { error } = await sb.from("recognitions")
          .update({ approved: true }).in("id", ids);
        if (error) throw error;
        return json(200, { ok: true, count: ids.length });
      }

      case "deleteRec": {
        const { id } = payload;
        if (!id) return json(400, { error: "Missing id" });
        const { error } = await sb.from("recognitions").delete().eq("id", id);
        if (error) throw error;
        return json(200, { ok: true });
      }

      case "loadOverviewStats": {
        const [allRes, recentRes] = await Promise.all([
          sb.from("recognitions").select("id, core_value, created_at"),
          sb.from("recognitions").select("*, recognition_sites(name)")
            .order("created_at", { ascending: false }).limit(5),
        ]);
        if (allRes.error) throw allRes.error;
        if (recentRes.error) throw recentRes.error;
        return json(200, {
          all: allRes.data ?? [],
          recent: recentRes.data ?? [],
        });
      }

      case "loadDrawings": {
        const { data, error } = await sb.from("recognition_drawings")
          .select(
            "*, recognitions:winner_recognition_id(recipient_name, core_value)",
          )
          .order("drawn_at", { ascending: false }).limit(10);
        if (error) throw error;
        return json(200, { drawings: data ?? [] });
      }

      case "insertDrawing": {
        const { quarter, winner_recognition_id, notes } = payload;
        if (!quarter || !winner_recognition_id) {
          return json(400, { error: "Missing quarter or winner_recognition_id" });
        }
        const { error } = await sb.from("recognition_drawings")
          .insert({ quarter, winner_recognition_id, notes });
        if (error) throw error;
        return json(200, { ok: true });
      }

      case "updateSetting": {
        const { key, value } = payload;
        if (!key || key === "admin_password") {
          return json(400, { error: "Invalid key" });
        }
        const { error } = await sb.from("recognition_settings")
          .update({ value, updated_at: new Date().toISOString() })
          .eq("key", key);
        if (error) throw error;
        return json(200, { ok: true });
      }

      case "upsertSetting": {
        const { key, value } = payload;
        if (!key || key === "admin_password") {
          return json(400, { error: "Invalid key" });
        }
        const { error } = await sb.from("recognition_settings")
          .upsert(
            { key, value, updated_at: new Date().toISOString() },
            { onConflict: "key" },
          );
        if (error) throw error;
        return json(200, { ok: true });
      }

      case "addSite": {
        const name = (payload?.name ?? "").trim();
        if (!name) return json(400, { error: "Missing name" });
        const { error } = await sb.from("recognition_sites").insert({ name });
        if (error) throw error;
        return json(200, { ok: true });
      }

      case "toggleSite": {
        const { id, active } = payload;
        if (!id) return json(400, { error: "Missing id" });
        const { error } = await sb.from("recognition_sites")
          .update({ active: !active }).eq("id", id);
        if (error) throw error;
        return json(200, { ok: true });
      }

      default:
        return json(400, { error: "Unknown action: " + action });
    }
  } catch (e: any) {
    console.error("kudos-admin error", { action, err: e });
    return json(500, { error: String(e?.message || e) });
  }
});
