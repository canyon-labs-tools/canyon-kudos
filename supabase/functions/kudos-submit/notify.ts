// Nominee email for canyon-kudos.
//
// When a recognition names people picked from the staff list, each of them gets
// an email from the shared kudos mailbox through Microsoft Graph. Email is a
// courtesy: any failure here is logged and never fails the submission.
//
// Settings (edge function secrets). If any of the first four is missing,
// nothing is sent.
//   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET — the app registration
//     allowed to send as the shared mailbox (Mail.Send, scoped to that mailbox)
//   KUDOS_SENDER      — the shared mailbox address
//   KUDOS_SITE_URL    — link in the email (defaults to the Azure site)
//   KUDOS_EMAIL_TEST_TO — if set, every email goes to this address instead of the
//     nominee (for testing); the subject says who it was meant for

export type Nominee = { name: string; email: string };
export type Recognition = {
  nominator: string;
  value: string;
  description: string;
};

const DEFAULT_SITE_URL = "https://canyon-labs-kudos.azurewebsites.net";

export function escHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// The description is typed by anyone on a public form, and mail clients turn
// web addresses into clickable links. Strip them so the kudos mailbox can't be
// used to deliver a link; the full text is on the board.
const LINKISH = /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|io|co|us|info|biz|xyz|app|dev|link|ly|me|site|online|top|click)\b\S*/gi;
export function stripLinks(s: string): string {
  return s.replace(LINKISH, "[link removed]");
}

export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || full;
}

export function buildEmail(n: Nominee, r: Recognition, siteUrl: string) {
  const from = r.nominator && r.nominator !== "Anonymous"
    ? escHtml(stripLinks(r.nominator))
    : "A colleague";
  const subject = `You've been recognized for ${r.value}`;
  const html = `<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:15px;color:#1f2937;max-width:560px">
<p>Hi ${escHtml(firstName(n.name))},</p>
<p>${from} just recognized you for the Canyon Labs core value <strong>${escHtml(r.value)}</strong>.</p>
<blockquote style="margin:16px 0;padding:12px 16px;border-left:4px solid #272E72;background:#f5f6fb;white-space:pre-wrap">${escHtml(stripLinks(r.description))}</blockquote>
<p>Your recognition is on the Canyon Kudos board and goes into this week's Bracelet Awards.</p>
<p><a href="${escHtml(siteUrl)}" style="color:#272E72;font-weight:600">See the Kudos board</a></p>
<p style="color:#6b7280;font-size:13px">Thank you for what you do.</p>
</div>`;
  return { subject, html };
}

type Env = { get(k: string): string | undefined };

export function readConfig(env: Env) {
  const tenant = env.get("GRAPH_TENANT_ID");
  const clientId = env.get("GRAPH_CLIENT_ID");
  const secret = env.get("GRAPH_CLIENT_SECRET");
  const sender = env.get("KUDOS_SENDER");
  if (!tenant || !clientId || !secret || !sender) return null;
  return {
    tenant,
    clientId,
    secret,
    sender,
    siteUrl: env.get("KUDOS_SITE_URL") || DEFAULT_SITE_URL,
    testTo: env.get("KUDOS_EMAIL_TEST_TO") || null,
  };
}

type Config = NonNullable<ReturnType<typeof readConfig>>;

async function graphToken(c: Config, f: typeof fetch): Promise<string> {
  const res = await f(
    `https://login.microsoftonline.com/${encodeURIComponent(c.tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: c.clientId,
        client_secret: c.secret,
        scope: "https://graph.microsoft.com/.default",
      }),
    },
  );
  if (!res.ok) throw new Error(`token ${res.status}`);
  return (await res.json()).access_token;
}

// Sends one email per nominee. Returns how many went out; never throws.
export async function notifyNominees(
  nominees: Nominee[],
  r: Recognition,
  env: Env,
  f: typeof fetch = fetch,
): Promise<number> {
  if (nominees.length === 0) return 0;
  const c = readConfig(env);
  if (!c) {
    console.log("kudos-submit: email not configured, skipped", { count: nominees.length });
    return 0;
  }
  let token: string;
  try {
    token = await graphToken(c, f);
  } catch (e) {
    console.error("kudos-submit: email sign-in failed", { err: String(e) });
    return 0;
  }
  let sent = 0;
  for (const n of nominees) {
    const { subject, html } = buildEmail(n, r, c.siteUrl);
    const to = c.testTo || n.email;
    try {
      const res = await f(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(c.sender)}/sendMail`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: {
              subject: c.testTo ? `[TEST for ${n.name}] ${subject}` : subject,
              body: { contentType: "HTML", content: html },
              toRecipients: [{ emailAddress: { address: to } }],
            },
            saveToSentItems: true,
          }),
        },
      );
      if (res.ok) sent++;
      else console.error("kudos-submit: email send failed", { status: res.status });
    } catch (e) {
      console.error("kudos-submit: email send error", { err: String(e) });
    }
  }
  return sent;
}
