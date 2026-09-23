# Member Portal — Setup Guide

This adds a login-protected member portal to thespaceship.my: members request a
session date, you confirm it from an admin page, and confirming it emails you
(thespaceshipmy@gmail.com) a calendar invite you add with one click, plus a
confirmation email to the member. You also update each member's renewal date
from the same admin page.

It's built as an add-on — it doesn't touch your existing homepage except for
one link you'll add to the nav. Everything below is a one-time setup; after
that, day-to-day you just use `/portal/admin.html`.

> **Note on the calendar step:** the original plan was to have the site
> create the event on your Google Calendar automatically via Google's API.
> That requires a Google Cloud project, which now requires a verified card
> even for free usage — and that verification step wasn't working for you.
> So instead, confirming a booking emails thespaceshipmy@gmail.com with a
> calendar invite (`.ics`) attached — Gmail shows an **"Add to Calendar"**
> button right on that attachment. One click instead of fully automatic, but
> zero Google Cloud setup, no card needed. If you ever do get a working
> Google Cloud billing setup later and want the fully-automatic version
> instead, ask and I'll switch it back.

## Important: how you deploy has to change

Your site so far has been deployed by dragging a zip into Netlify. **That
method does not support the booking backend** (Netlify's serverless
Functions only deploy via a connected Git repo or the Netlify CLI). You have
two options:

- **Connect a GitHub repo to Netlify** (recommended, and free) — push this
  code to a new GitHub repo, then in Netlify: Add new site → Import an
  existing project → connect the repo. Every future update is then a `git
  push` instead of a manual zip upload.
- **Netlify CLI** — install it (`npm install -g netlify-cli`), run `netlify
  login`, `netlify link` (to your existing site), then `netlify deploy
  --prod` from this folder whenever you want to publish.

Either way, merge this portal's files into the same folder as your existing
`index.html`, `images/`, etc. — the file layout at the bottom of this doc
shows how it all sits together.

## Step 1 — Supabase (accounts + database) — DONE

Already set up and verified working: the project is created, `schema.sql`
has run, and `portal/config.js` has your real URL and key in it. Nothing
more to do here. (For reference: Supabase's dashboard recently renamed
things — what this doc calls the "anon key" is the classic key under
**Settings → API Keys → "Legacy anon, service_role API keys"** tab. The
**service_role** key from that same tab is used in Step 3 below — keep it
secret, it never goes into any file in this folder.)

## Step 2 — Resend (sending emails)

1. Go to resend.com → sign up (free tier: 3,000 emails/month, plenty for
   this).
2. Go to **Domains → Add Domain**, enter `thespaceship.my`, and add the DNS
   records it gives you wherever you manage thespaceship.my's DNS (same
   place you pointed it at Netlify). This proves you own the domain so
   Resend can send from it.
3. Once verified, go to **API Keys → Create API Key** (full access is fine).
   Copy it — you'll only see it once.
4. Decide the "from" address, e.g. `bookings@thespaceship.my` — it doesn't
   need to be a real inbox, it just needs to be `@thespaceship.my`.

## Step 3 — Netlify environment variables

In Netlify: **Site settings → Environment variables → Add a variable**, and
add each of these:

| Key | Value |
|---|---|
| `SUPABASE_URL` | `https://pogrjmkzlhwoabuyskok.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role / secret key from Supabase's Legacy API keys tab (keep secret) |
| `RESEND_API_KEY` | the API key from Step 2 |
| `EMAIL_FROM` | e.g. `The Spaceship <bookings@thespaceship.my>` |
| `ADMIN_NOTIFICATION_EMAIL` | `thespaceshipmy@gmail.com` |
| `PORTAL_URL` | `https://thespaceship.my` |

Then trigger a new deploy (Netlify → Deploys → Trigger deploy) so the
functions pick up the new variables.

## Step 4 — Add the portal link to your homepage nav

In `index.html`, find the nav links (`<a href="#about">About</a>` etc.) and
add:

```html
<a href="/portal/login.html">Member Login</a>
```

## Step 5 — Add yourself as the first member

Go to `https://thespaceship.my/portal/login.html`, and since you're already
an admin (from the SQL in Step 1), you need one login of your own to get in.
Easiest path: go to Supabase → **Authentication → Users → Add user**, create
a user with your email and a password directly (skip the invite email for
your own account), then log in at `/portal/login.html` and add yourself as a
"member" row too from the admin page if you also want to test the booking
flow as a member.

For every real member after that: use the **Add a Member** form on
`/portal/admin.html` — it creates their login and emails them an invite link
to set their own password.

## File layout

```
thespaceship.my/               (your existing site root)
├── index.html                 (unchanged, except the nav link in Step 4)
├── images/                    (unchanged)
├── robots.txt, sitemap.xml    (unchanged)
├── netlify.toml                ← new
├── package.json                ← new
├── netlify/
│   └── functions/
│       ├── lib/lib.js           ← new (shared helper, not its own endpoint)
│       ├── create-member.js     ← new
│       ├── notify-new-booking.js ← new
│       └── confirm-booking.js   ← new (emails the calendar invite)
├── portal/
│   ├── portal.css               ← new
│   ├── config.js                ← new (already filled in)
│   ├── login.html                ← new
│   ├── dashboard.html            ← new (member view)
│   └── admin.html                ← new (your view)
└── supabase/
    └── schema.sql                ← already run in Supabase, not deployed
```

## Testing it end to end

1. Add yourself as a member (Step 5), log into `/portal/dashboard.html`,
   submit a booking request.
2. Check thespaceshipmy@gmail.com's inbox for the "New booking request"
   email.
3. Log into `/portal/admin.html`, find the request under **Pending Booking
   Requests**, click **Confirm**.
4. Check thespaceshipmy@gmail.com's inbox for the "Booking confirmed"
   email — open the attached invite and click **Add to Calendar**.
5. Try **Decline** on a separate test request too, and confirm the member
   would get the "can't confirm" email.

If a step fails, the error message on the page usually tells you which of
Steps 2–3 needs a second look (wrong key, domain not verified, etc.).
