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
//   KUDOS_SITE_URL    — the site; the email links to this week's Bracelet Awards
//     page on it (defaults to the Azure site)
//   KUDOS_EMAIL_TEST_TO — if set, every email goes to this address instead of the
//     nominee (for testing); the subject says who it was meant for

import { LOGO_WHITE_PNG_BASE64 } from "./logo.ts";
import { BRACELET_PNG_BASE64 } from "./bracelets.ts";

export type Nominee = { name: string; email: string };
export type Recognition = {
  nominator: string;
  value: string;
  description: string;
  subjectPrefix?: string; // e.g. "[SYSTEM CHECK] " from the admin system check
  note?: string; // a short note shown above the award (one-time copy below)
};

// ONE-TIME COPY, 14 Oct 2026, at Clint's request: Richard Floyd's award (the
// first one under the new design) is also sent as a separate copy to Sarah Ptach (Clint
// copied), with a note to her. Richard's own email has no note and no copies.
// It matches only that one nominee and switches itself off at the end of the
// day. Remove it in the next change.
export const ONE_TIME_COPY = {
  nominee: "rfloyd@canyonlabs.com",
  to: "sarah.ptach@canyonlabs.com",
  cc: ["cchristensen@canyonlabs.com"],
  replyTo: "cchristensen@canyonlabs.com",
  until: Date.parse("2026-10-15T06:00:00Z"), // end of 14 Oct, Mountain time
  note: "Sarah, I've copied you on Richard's award. This is how we are now letting " +
    "employees know they've been recognized and earned a bracelet. I would love your " +
    "feedback, positive or negative. — Clint",
};

export function oneTimeCopy(email: string, now = Date.now()) {
  const c = ONE_TIME_COPY;
  return email.toLowerCase() === c.nominee && now < c.until ? c : null;
}

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
const LINKISH = new RegExp(
  [
    String.raw`\b[a-z][a-z0-9+.-]*:(?!\s)\S*`, // any scheme: web, mailto, file, …
    String.raw`\\\\\S+`, // \\host\share paths
    String.raw`\bwww\.\S+`,
    String.raw`\b\d{1,3}(?:\.\d{1,3}){3}\b\S*`, // IP addresses
    String.raw`\b[\w-]+(?:\.[\w-]+)*\.[a-z][a-z-]{1,62}\b\S*`, // any dotted host name, any ending
  ].join("|"),
  "gi",
);
export function stripLinks(s: string): string {
  return s.replace(LINKISH, "[link removed]");
}

export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || full;
}

// Monday of the current week in the program's time zone, as YYYY-MM-DD. The
// awards page opens on last week by default, so the link names this week.
export function awardsWeek(now = new Date()): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(now);
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function awardsUrl(siteUrl: string, now = new Date()): string {
  return `${siteUrl.replace(/\/+$/, "")}/?view=awards&week=${awardsWeek(now)}`;
}

// The five core values, with the board's colours and taglines (index.html).
const VALUES: Record<string, { color: string; tint: string; tagline: string }> = {
  "Innovation": { color: "#8b5cf6", tint: "#ede9fe", tagline: "Be the innovation leaders in the industry." },
  "Integrity": { color: "#0891b2", tint: "#cffafe", tagline: "Exemplify integrity & quality in service every day." },
  "Hard Work": { color: "#dc2626", tint: "#fee2e2", tagline: "Be timely, accessible, and willing to go above & beyond." },
  "Teamwork": { color: "#16a34a", tint: "#dcfce7", tagline: "Celebrate shared success and team unity." },
  "Passion": { color: "#ea580c", tint: "#fff7ed", tagline: "Embody a passion for improving life." },
};

export const LOGO_CID = "canyon-logo";
export const BRACELET_CID = "canyon-bracelet";

// Table layout and inline styles only: Outlook ignores most modern CSS.
export function buildEmail(n: Nominee, r: Recognition, siteUrl: string) {
  const named = r.nominator && r.nominator !== "Anonymous";
  const from = named ? escHtml(stripLinks(r.nominator)) : "A colleague";
  const first = escHtml(firstName(n.name));
  const value = escHtml(r.value);
  const v = VALUES[r.value] ?? { color: "#272E72", tint: "#eef0fa", tagline: "" };
  const subject = `${r.subjectPrefix ?? ""}Congratulations, ${firstName(n.name)}! You've earned a ${r.value} bracelet`;
  const font = "'Segoe UI',Arial,sans-serif";
  const head = "'Titillium Web','Segoe UI',Arial,sans-serif";
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
${r.note ? `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin-bottom:14px"><tr><td style="background:#ffffff;border:1px solid #e2e8f0;border-left:5px solid #272E72;border-radius:8px;padding:14px 18px;font-family:${font};font-size:15px;line-height:1.5;color:#191919">${escHtml(r.note)}</td></tr></table>` : ""}
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:${font};color:#191919">
  <tr><td align="center" style="background:#272E72;padding:28px 24px 22px">
    <img src="cid:${LOGO_CID}" width="150" alt="Canyon Labs" style="display:block;width:150px;height:auto;border:0">
    <div style="font-family:${font};font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#c7cbe8;padding-top:10px">Employee Achievement Bracelet Award</div>
  </td></tr>
  <tr><td style="height:5px;line-height:5px;font-size:0;background:#D14124">&nbsp;</td></tr>
  <tr><td align="center" style="padding:36px 32px 8px">
    <div style="font-size:40px;line-height:1">&#127881;</div>
    <h1 style="margin:14px 0 6px;font-family:${head};font-size:30px;line-height:1.2;color:#272E72">Congratulations, ${first}!</h1>
    <p style="margin:0;font-size:16px;line-height:1.5;color:#475569">${from} recognized you for living one of our core values, and you've earned a bracelet.</p>
  </td></tr>
  <tr><td align="center" style="padding:20px 32px 4px">
    ${BRACELET_PNG_BASE64[r.value]
      ? `<img src="cid:${BRACELET_CID}" width="480" alt="Your ${value} bracelet" style="display:block;width:100%;max-width:480px;height:auto;border:0;margin:0 auto">`
      : `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${v.tint};border:1.5px solid ${v.color};border-radius:999px;padding:8px 22px;font-family:${head};font-size:16px;font-weight:700;color:${v.color}">${value}</td></tr></table>`}
    ${v.tagline ? `<p style="margin:10px 0 0;font-size:13px;font-style:italic;color:#64748b">${escHtml(v.tagline)}</p>` : ""}
  </td></tr>
  <tr><td style="padding:24px 32px 8px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#f8fafc;border-left:5px solid ${v.color};border-radius:8px;padding:20px 22px">
      <div style="font-family:Georgia,serif;font-size:36px;line-height:0.6;color:${v.color};padding-bottom:6px">&ldquo;</div>
      <div style="font-size:16px;line-height:1.6;color:#191919;white-space:pre-wrap">${escHtml(stripLinks(r.description))}</div>
      <div style="padding-top:12px;font-size:14px;font-weight:600;color:#272E72">&mdash; ${from}</div>
    </td></tr></table>
  </td></tr>
  <tr><td style="padding:20px 32px 4px;font-size:16px;line-height:1.6;color:#191919">
    <p style="margin:0 0 12px"><strong>Thank you, ${first}.</strong> What you do makes a real difference to your team and to everyone at Canyon Labs. People notice, and it matters.</p>
    <p style="margin:0">Your recognition is now on the board and is part of this week's Bracelet Awards.</p>
  </td></tr>
  <tr><td style="padding:20px 32px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:${v.tint};border:1.5px dashed ${v.color};border-radius:10px;padding:16px 20px;font-size:16px;line-height:1.5;color:#191919">
      <strong style="color:${v.color}">&#127873;&nbsp; Pick up your bracelet.</strong> Come see your site's recognition contact to collect your ${value} bracelet. Wear it with pride.
    </td></tr></table>
  </td></tr>
  <tr><td align="center" style="padding:26px 32px 34px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#D14124;border-radius:8px">
      <a href="${escHtml(awardsUrl(siteUrl))}" style="display:inline-block;padding:13px 28px;font-family:${font};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none">See this week's Bracelet Awards</a>
    </td></tr></table>
  </td></tr>
  <tr><td align="center" style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 24px;font-size:12px;line-height:1.5;color:#64748b">
    Canyon Labs &middot; Innovation &middot; Integrity &middot; Hard Work &middot; Teamwork &middot; Passion<br>
    Employee Achievement Bracelet Awards. Know someone who deserves a bracelet? Recognize them too.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { subject, html };
}

// The logo and the bracelet are attached inline, so they show without
// downloading pictures (the site's own images sit behind sign-in).
export function emailAttachments(value: string) {
  const out = [logoAttachment()];
  const bracelet = BRACELET_PNG_BASE64[value];
  if (bracelet) {
    out.push({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: "bracelet.png",
      contentType: "image/png",
      contentId: BRACELET_CID,
      isInline: true,
      contentBytes: bracelet,
    });
  }
  return out;
}

export function logoAttachment() {
  return {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: "canyon-labs-logo.png",
    contentType: "image/png",
    contentId: LOGO_CID,
    isInline: true,
    contentBytes: LOGO_WHITE_PNG_BASE64,
  };
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
    const msgs = [{
      subject: c.testTo ? `[TEST for ${n.name}] ${subject}` : subject,
      html,
      to: [to],
      cc: [] as string[],
      replyTo: [] as string[],
    }];
    // The one-time copy is its own email, so the nominee never sees the note.
    const copy = c.testTo ? null : oneTimeCopy(n.email);
    if (copy) {
      msgs.push({
        subject: `Copy: ${subject}`,
        html: buildEmail(n, { ...r, note: copy.note }, c.siteUrl).html,
        to: [copy.to],
        cc: copy.cc,
        replyTo: [copy.replyTo],
      });
    }
    for (const m of msgs) {
      const addr = (a: string[]) => a.map((address) => ({ emailAddress: { address } }));
      try {
        const res = await f(
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(c.sender)}/sendMail`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              message: {
                subject: m.subject,
                body: { contentType: "HTML", content: m.html },
                toRecipients: addr(m.to),
                ...(m.cc.length ? { ccRecipients: addr(m.cc) } : {}),
                ...(m.replyTo.length ? { replyTo: addr(m.replyTo) } : {}),
                attachments: emailAttachments(r.value),
              },
              saveToSentItems: true,
            }),
          },
        );
        if (res.ok) {
          if (m === msgs[0]) sent++;
        } else console.error("kudos-submit: email send failed", { status: res.status, copy: m !== msgs[0] });
      } catch (e) {
        console.error("kudos-submit: email send error", { err: String(e), copy: m !== msgs[0] });
      }
    }
  }
  return sent;
}
