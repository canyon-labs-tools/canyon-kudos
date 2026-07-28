# Canyon Kudos — Open Submission + Email/PDF Export

**Date:** 2026-07-28
**Driver:** Bracelet App call with Tammy Boudreau ([Fathom](https://fathom.video/calls/762774084))
**Repo:** `canyon-kudos`

---

## Background

The Bracelet Recognition Program runs two disconnected processes. Rochester (Tammy) is
stable: paper slips into a box by her desk, and every Monday she retypes them into a Word
posting and emails it to the site. Salt Lake ran through this app, then stalled when the
program lost its owner.

The agreed direction is **one central collection point, two unchanged front doors**. Paper
slips stay — Tammy was explicit that forcing everyone onto a web form would kill
participation, and Clint agreed. Whoever empties the box types the slip into this app, so
every recognition company-wide lands in one table. The app then hands the announcer a
finished posting instead of making them retype anything.

Two changes get us there.

## Change 1 — Remove the screening gate

Every submission currently routes through `kudos-submit`, which asks Claude whether the
text is a genuine recognition and **fails closed**: any error holds the item for human
review. An admin then clears the queue from the Moderation tab.

This is not worth its cost. The tool sits behind Entra SSO, so submissions are already
attributable to a named employee, and the failure mode is backwards — an API hiccup
silently buries real recognitions in a queue nobody is watching. Clint's call on the
call: *"if someone ever wanted to get in here and just put something crazy they could, but
I kind of am thinking that's probably not worth it anymore."*

**Scope:**

- `supabase/functions/kudos-submit/index.ts` — delete `moderate()` and the Anthropic call.
  Always insert `approved: true`, `flag_reason: null`.
- **Keep the edge function.** It is still the service-role insert proxy, which is what
  prevents the browser from writing to `recognitions` directly. Field validation
  (core-value whitelist, length caps) stays.
- `index.html` — remove `'moderation'` from `TABS`/`TAB_LABELS`, delete `ModerationTab`,
  default the admin landing tab to `overview`. The "Approve All" button goes with it.
- `SubmitPage` — the `held` success branch becomes unreachable; the confirmation always
  reads as posted.

**Deliberately not done:** the `approved` column and the `.eq('approved', true)` read
filters stay in place. The column is `true` for every row from here, so the filters are
no-ops, and re-introducing a gate later is a one-line change rather than a migration.

**Data check (2026-07-28):** `recognitions` holds 50 rows, all `approved = true`, zero
held. Nothing is stranded by removing the gate.

## Change 2 — "Email / PDF" export tab

A new admin tab beside Slides that turns a date range into the artifacts Tammy already
sends, so her weekly job becomes select-range → download → paste → send.

**Range selection.** Presets *Last week (Mon–Sun)* / *This week* / *Last 2 weeks* /
*Custom*, plus explicit from/to date inputs. Defaults to last Mon–Sun to match the Monday
cadence. Shows a live count and an on-screen preview of exactly what will export.

**Download PDF** — jsPDF via CDN, following the existing `pptxgenjs` pattern. One click,
file lands in Downloads.

- Navy header band with the Canyon logo, title **Employee Achievement Bracelet Awards**,
  gold rule
- Subtitle mirrors Tammy's existing wording: a full Mon–Sun range renders
  "Awarded Week of July 20th, 2026"; any other range renders
  "Awarded July 20 – July 24, 2026"
- One card per award — recipient in large navy, core-value pill in that value's colour
  (reusing the hex map already in `SlidesTab`), "Nominated by …" or "From: Anonymous",
  then the write-up at readable size with real leading
- Multi-page flow with a "Canyon Labs · Page N of M" footer

This is the upgrade over the current Word posting: letterhead, coloured value pills,
consistent card rhythm, no wall of text.

**Copy email body** — the same content as rich HTML on the clipboard so an Outlook paste
keeps its formatting, with a plain-text fallback for clients that strip it. Tammy pastes
the body, attaches the PDF, sends — her existing process with the retyping removed.

**Edge cases.** Group recognitions arrive as comma-separated names in `recipient_name`;
they wrap rather than truncate. Long anonymous write-ups (the July 20 posting has two
of several hundred words) also wrap — the PDF has room the slides don't, so
`SlidesTab`'s `smartTrunc` is not reused here.

## Out of scope

Program ownership, whether Salt Lake and Rochester run one drawing or two, and where the
tool finally lives (SharePoint vs. Launchpad) are open questions for Clint's conversation
with Dave and Sarah. None of them block this build.

## Success criteria

1. A submission posts to the board immediately; no Moderation tab exists.
2. Selecting the week of July 20 and downloading produces a PDF containing the same four
   awards as Tammy's `Week 3 Q3 awarded July 20.docx`, in a visibly more polished layout.
3. "Copy email body" pastes into Outlook with formatting intact.
