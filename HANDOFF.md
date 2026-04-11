# Canyon Kudos — Developer Handoff

**Project:** Employee Recognition Tool ("Canyon Kudos")
**Status:** Working prototype (single-file HTML/React app)
**Handoff to:** Ken (Code/IDE)
**Date:** 2026-04-11

---

## What This Is

A web-based employee recognition tool for Canyon Labs. Any employee can recognize a colleague for embodying one of five core values. Recognitions display on a feed, rotate on office TVs, and feed into a quarterly prize drawing.

---

## Supabase Connection Details

| Key | Value |
|-----|-------|
| **Project Name** | `canyon-connect` |
| **Project ID** | `vnoaofrvtaallrbiggob` |
| **Region** | `us-west-2` |
| **Supabase URL** | `https://vnoaofrvtaallrbiggob.supabase.co` |
| **Anon Key (legacy)** | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZub2FvZnJ2dGFhbGxyYmlnZ29iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0Mzc3MjgsImV4cCI6MjA4OTAxMzcyOH0.T0VJH25VmTPLNfUQ1rCYrLI4vCEJLh2lABj_9l6_Cms` |
| **Publishable Key** | `sb_publishable_WLuTPE0GHlO2GB7Rw42UbQ_JOm4Zi7L` |
| **DB Host** | `db.vnoaofrvtaallrbiggob.supabase.co` |
| **Postgres Version** | 17.6 |

> **Note:** This project shares the `canyon-connect` Supabase instance with other Canyon Labs tools. The recognition tables are prefixed with `recognition_` to avoid collisions.

---

## Database Schema

### `recognitions` (main table)
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK, auto-generated |
| `recipient_name` | `text` | Who is being recognized |
| `nominator_name` | `text` | Who submitted the recognition |
| `core_value` | `enum(core_value)` | One of: `Innovation`, `Integrity`, `Hard Work`, `Teamwork`, `Passion` |
| `description` | `text` | What they did |
| `site_id` | `uuid` | FK → `recognition_sites.id`, nullable |
| `created_at` | `timestamptz` | Defaults to `now()` |

### `recognition_sites`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK, auto-generated |
| `name` | `text` | Unique site name |
| `active` | `boolean` | Default `true`, controls visibility in dropdowns |
| `created_at` | `timestamptz` | Defaults to `now()` |

**Seeded with:** Salt Lake City, Rochester, San Diego

### `recognition_settings`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `key` | `text` | Unique setting key |
| `value` | `text` | Setting value |
| `updated_at` | `timestamptz` | Defaults to `now()` |

**Current settings:**
- `tv_display_days` = `14` (rolling window for TV slideshow)

### `recognition_drawings`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `quarter` | `text` | Format: `2026-Q2` |
| `winner_recognition_id` | `uuid` | FK → `recognitions.id`, nullable |
| `drawn_at` | `timestamptz` | Defaults to `now()` |
| `notes` | `text` | Nullable, auto-filled with eligible count |

**RLS is enabled on all tables** with permissive policies for anon access (since this is an internal tool).

---

## App Features

### 1. Give Recognition (Submit Form)
- Fields: recipient name, your name, site (dropdown), core value (pill selector), description (textarea)
- Inserts into `recognitions` table
- Success modal with option to submit another

### 2. Recognition Feed
- Scrollable list of all recognitions, newest first
- Filterable by core value and site
- Quick print button
- Each card shows: recipient, value badge (color-coded), description, nominator, site, relative time

### 3. TV Display Mode
- Access via URL param: `?view=tv`
- Full-screen dark theme with animated card slideshow
- Auto-rotates every 8 seconds
- Auto-refreshes data every 60 seconds
- Shows recognitions from the last N days (configurable, default 14)
- Dot indicators at bottom for slide position

### 4. Admin Dashboard
- **Overview tab:** Total/monthly/quarterly stats, breakdown by core value, recent recognitions
- **Drawing tab:** Select quarter + optional site filter, spin animation, random winner selection, saves to `recognition_drawings`, shows past drawing history
- **Settings tab:** Adjust TV display window (days), manage sites (add/enable/disable)
- **Print Cards tab:** Filter by date range + site, opens print-formatted window with styled cards for bulletin boards

---

## Core Values & Colors

| Value | Color | Hex | Icon |
|-------|-------|-----|------|
| Innovation | Purple | `#8b5cf6` | light bulb |
| Integrity | Cyan | `#0891b2` | shield |
| Hard Work | Red | `#dc2626` | fire |
| Teamwork | Green | `#16a34a` | handshake |
| Passion | Orange | `#ea580c` | heart |

---

## Converting to a Proper React Project

The current prototype is a single `index.html` file using CDN React + Babel. To convert to a proper codebase:

### 1. Scaffold
```bash
npm create vite@latest canyon-kudos -- --template react
cd canyon-kudos
npm install @supabase/supabase-js
```

### 2. Environment Variables
Create `.env`:
```
VITE_SUPABASE_URL=https://vnoaofrvtaallrbiggob.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZub2FvZnJ2dGFhbGxyYmlnZ29iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0Mzc3MjgsImV4cCI6MjA4OTAxMzcyOH0.T0VJH25VmTPLNfUQ1rCYrLI4vCEJLh2lABj_9l6_Cms
```

### 3. Supabase Client (`src/lib/supabase.js`)
```js
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
```

### 4. Suggested File Structure
```
src/
  lib/
    supabase.js          # Supabase client
    constants.js         # CORE_VALUES, VALUE_ICONS, VALUE_CLASS, etc.
  components/
    Nav.jsx
    RecCard.jsx          # Reusable recognition card
    SubmitPage.jsx       # Give Recognition form
    FeedPage.jsx         # Recognition feed with filters
    TVDisplay.jsx        # Full-screen TV slideshow
    admin/
      AdminPage.jsx      # Admin shell with tab routing
      OverviewTab.jsx    # Stats dashboard
      DrawingTab.jsx     # Quarterly drawing
      SettingsTab.jsx    # TV days + site management
      PrintTab.jsx       # Print cards generator
  App.jsx                # Router + site loading
  main.jsx               # Entry point
```

### 5. Routing
Currently uses simple `page` state. For a proper app, use `react-router-dom`:
- `/` → Submit form
- `/feed` → Recognition feed
- `/tv` → TV display (full-screen, no nav)
- `/admin` → Admin dashboard
- `/admin/drawing` → Drawing tab (optional sub-routes)

---

## Branding Notes

The prototype uses placeholder branding:
- **Logo:** A star SVG icon — replace with Canyon Labs logo
- **App name:** "Canyon Kudos" — confirm or change
- **Colors:** Navy (`#1a2744`), Blue (`#2563eb`), Gold (`#f59e0b`) — update to match Canyon Labs brand guide
- **Font:** Inter — update if Canyon Labs has a brand font
- Print cards header says "Canyon Labs Employee Recognition" — update as needed

---

## TV Deployment

To put this on office TVs:
1. Deploy the app to any static host (Vercel, Netlify, internal server)
2. On each TV, open a browser to: `https://your-domain.com/?view=tv`
3. Set browser to full-screen (F11)
4. The display auto-refreshes every 60 seconds — no manual intervention needed
5. Adjust the rolling window in Admin > Settings

---

## Quarterly Drawing Process

1. Go to Admin > Drawing
2. Select the quarter (e.g., `2026-Q2`)
3. Optionally filter by site
4. Click "Run Drawing" — animated spin, then random winner displayed
5. Winner is automatically saved to `recognition_drawings` table
6. Past drawings are shown in the right panel
7. Each recognition = one entry, so employees recognized multiple times have more chances

---

## Known Limitations / Future Enhancements

- **No authentication** — anyone with the URL can submit/admin. Consider adding Supabase Auth or SSO.
- **Name field is free-text** — could integrate with an employee directory for autocomplete.
- **No duplicate protection** — same person can submit the same recognition twice.
- **Drawing is purely random** — no weighting or exclusion of past winners (could be added).
- **Single-page app** — no SSR/SEO, but not needed for an internal tool.

---

## Source File

The working prototype is at:
```
/Users/clint/Dev/canyon-kudos/index.html
```

All logic, styles, and markup are in this single file. Use it as a reference when building out the component structure.
