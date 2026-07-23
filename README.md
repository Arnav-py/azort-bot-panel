# Azort Control Panel

A lightweight client dashboard + admin panel for restarting/stopping bots
hosted on Orihost (Pterodactyl), built for a small client base (10-20 users)
without a database or always-on server.

## What's in here

```
/                     client-facing static pages (root = clean URLs)
  index.html            → login
  dashboard.html         → bot list + restart/stop + detail drawer
  assets/css/style.css  → shared design system (client + devs)
  assets/js/app.js      → client dashboard logic

/devs                 admin-only static pages
  index.html            → devs login
  dashboard.html        → client management table + add/edit modal
  assets/js/devs.js    → admin logic

/api                  serverless functions (Vercel convention)
  login.js / logout.js           → client auth
  get-bots.js                    → returns only the logged-in user's bot(s)
  bot-action.js                  → restart/stop, with authorization + cooldown
  devs-login.js / devs-logout.js → admin auth
  devs-clients.js                → admin CRUD (list/add/edit/reset password)

/lib
  store.js         → JSON storage, password hashing, signed sessions, cooldowns
  pterodactyl.js   → the ONLY file that talks to the Pterodactyl Client API

/data
  users.json    → client accounts (username + password hash)
  bots.json     → user → server ID mapping (the authorization boundary)
  admins.json   → your own devs login

/scripts
  hash-password.js  → CLI to generate a password hash for seeding data files
```

## Setup

1. **Install the Vercel CLI** if you don't have it: `npm i -g vercel`
2. **Copy env vars**: `cp .env.example .env` and fill in:
   - `SESSION_SECRET` — any long random string (`openssl rand -hex 32`)
   - `PTERODACTYL_BASE_URL` — your Orihost panel URL
   - `PTERODACTYL_API_KEY` — your master Pterodactyl **Client API** key
3. **Set your own admin login.** Generate a password hash:
   ```
   node scripts/hash-password.js "yourRealPassword"
   ```
   Paste the output into `data/admins.json` → `passwordHash`, and change
   `username` to whatever you want to log in as at `/devs`.
4. **Delete the demo client** in `data/users.json` and `data/bots.json` (or
   just add real clients through the `/devs` panel once it's running — it
   generates the user + a temp password for you).
5. **Run locally**: `vercel dev`
6. **Deploy**: push this repo to GitHub, then `vercel --prod` or import the
   repo in the Vercel dashboard. Set the same env vars there under
   Project Settings → Environment Variables.

## Important: persistent storage on Vercel

Vercel's serverless functions have a **read-only filesystem** at runtime
(except `/tmp`, which doesn't persist between requests). The JSON
read/write helpers in `lib/store.js` work as-is for local dev (`vercel dev`)
and clearly show the data shape, but for a real production deployment you
have two straightforward options — both are called out with comments right
in `lib/store.js`:

- **Swap in a small persistent store**: Vercel KV, Upstash Redis, or Turso
  (hosted SQLite) all have free tiers big enough for 10-20 users. You'd only
  need to change what's inside `readJSON`/`writeJSON` — every API route stays
  the same.
- **Host on an always-on Node process instead** (a small VPS, Railway,
  Fly.io) — then the filesystem persists normally and nothing changes.

## Where the security boundaries live

- **Authentication**: `login.js` / `devs-login.js` check a hashed password
  and issue a signed, HttpOnly session cookie. The password itself is never
  stored or shown in plaintext anywhere — including in the devs panel. "Reset
  password" generates a new temp password rather than revealing the old one.
- **Authorization (the important one)**: `get-bots.js` and `bot-action.js`
  both look up the bot by the **session's** `userId` server-side — never by
  a value the browser sends. Even if someone edits the `botId` in devtools
  or replays a request with a different ID, the ownership check in
  `bot-action.js` rejects it with a 403 unless that bot actually belongs to
  their session.
- **Rate limiting**: `bot-action.js` enforces a 60-second cooldown per
  user+bot before another power signal is allowed, so a laggy bot doesn't
  turn into a spam-click storm against Orihost's own API.
- **Secrets**: `PTERODACTYL_API_KEY` only ever exists inside
  `lib/pterodactyl.js`, read from an environment variable. It's never sent
  to the browser, logged, or committed to the repo.

## Customizing

- Colors, type, and the pulse-ring status indicator all live in
  `assets/css/style.css` as CSS variables at the top — safe to retheme
  without touching layout.
- The watermark (`Azort Development | Built by Arnav`) is a fixed-position
  element on every page — edit the text directly in each HTML file if you
  ever want to change it.
