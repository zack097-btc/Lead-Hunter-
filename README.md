# JZac Lead Generator

A mobile-first Progressive Web App (PWA) that helps JZac Designs reps discover nearby
businesses from their live GPS location and instantly generate a tailored cold email +
walk-in pitch for each one (vinyl wraps, signage, decals, window graphics).

**This build is 100% free to run — no API keys and no credit card anywhere.**

- **Frontend:** React (Vite) + Leaflet map (OpenStreetMap tiles — free)
- **Backend:** Node.js serverless functions on Vercel (free Hobby tier)
- **Auth:** Email/password with JWT (reps stay logged in)
- **Discovery:** OpenStreetMap **Overpass API** — no key, no card
- **Pitches:** built-in template engine tailored per business type — no key, no card
- **Database:** **Neon** Postgres — free tier, no card
- **Installable:** PWA "Add to Home Screen" on iPhone + Windows `.exe` via Electron

> Every piece above is genuinely $0 with no card on file. See *Cost* at the bottom.

---

## 1. Folder structure

```
jzac-lead-generator/
├─ api/                      # Node serverless functions (the backend)
│  ├─ _lib/                  # shared: auth (JWT/bcrypt), db, http helpers
│  ├─ auth/                  # login, register, me
│  ├─ places/nearby.js       # OpenStreetMap Overpass discovery (no key)
│  ├─ ai/pitch.js            # template pitch generator (no key)
│  ├─ activity/index.js      # activity logging + feed
│  └─ admin/reps.js          # admin-only team view
├─ src/                      # React frontend
│  ├─ components/            # Login, Dashboard, Map, List, BusinessDetail, Admin
│  ├─ config/states.js       # territory config (add states here)
│  ├─ api.js  auth.jsx  App.jsx  main.jsx  styles.css
├─ public/                   # manifest, service worker, icons
├─ electron/                 # Windows desktop wrapper (.exe)
├─ scripts/generate-icons.mjs
├─ index.html  vite.config.js  vercel.json  package.json  .env.example
```

---

## 2. Prerequisites

- **Node.js 18+**
- **Vercel CLI** (`npm i -g vercel`) — for local dev and deploy
- A free **Neon** account for the database (no card)

That's it. No Google Cloud, no Anthropic, no billing accounts.

---

## 3. Set up the free database (Neon)

1. Go to **[neon.tech](https://neon.tech)** → **Sign up** (GitHub or email — no card asked).
2. Click **Create project**, name it `jzac-leads`, pick the nearest region, **Create**.
3. Copy the **Connection string**. Choose the **Pooled connection** (host contains
   `-pooler`) — this is the one that works reliably with Vercel serverless.
   It looks like:
   ```
   postgres://user:pass@ep-name-12345-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
4. Paste it into `.env` as `POSTGRES_URL=...` (and later into Vercel's env vars).

On first run the app auto-creates the `users` and `activity` tables and seeds your admin.

---

## 4. Local development

```bash
npm install
cp .env.example .env        # then edit .env (JWT secret is generated for you already)
npm run dev                 # runs `vercel dev` (frontend + API together)
```

Open the printed URL (usually <http://localhost:3000>).

> For a quick click-through you can leave `POSTGRES_URL` blank — the app uses an
> in-memory store so it runs instantly. **Data won't persist** without Neon, so set it
> before real use.

**Default admin login** (from your `.env`): `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
Reps self-register from the login screen.

### Generate app icons (optional, nicer iPhone install)
```bash
npm i -D sharp
npm run gen:icons
```

---

## 5. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | ✅ | Signs login tokens. Long random string (already generated in your `.env`). |
| `POSTGRES_URL` | ✅ (prod) | Neon connection string. |
| `ADMIN_EMAIL` | ✅ | Seed admin account email. |
| `ADMIN_PASSWORD` | ✅ | Seed admin account password (change it!). |
| `ADMIN_NAME` | — | Display name for the admin. |

No API keys needed. (Discovery = OpenStreetMap, pitches = templates.)

---

## 6. Deploy to Vercel (free)

1. Push this folder to a GitHub repo (or run `vercel` from the CLI).
2. In Vercel: **Add New → Project →** import the repo (auto-detects Vite + `/api`).
3. **Project → Settings → Environment Variables:** add the 4 variables above
   (Production environment), including your Neon `POSTGRES_URL`.
4. **Deploy.** You'll get a URL like `https://jzac-lead-generator.vercel.app`.

Re-deploys happen automatically on every `git push`.

---

## 7. Install on iPhone (PWA)

1. Open the deployed URL in **Safari** on the iPhone.
2. **Share** → **Add to Home Screen** → **Add**.
3. Launch from the home screen — full-screen, like a native app.
4. On first search, allow **location access**. GPS updates as the rep moves.

---

## 8. Build the Windows `.exe` (Electron)

The desktop app loads your live Vercel deployment, so the backend just works.

```bash
cd electron
npm install
# set your deployment URL (edit APP_URL in electron/main.js, or):
#   (PowerShell)  $env:APP_URL="https://your-app.vercel.app"; npm run dist
npm run dist
```

The installer appears in `electron/dist/`.

> **Desktop GPS note:** PCs have no GPS chip, so location is estimated from the network
> (approximate). Precise GPS is the iPhone PWA's job. Everything else works on desktop.

---

## 9. Adding more states later (GA, FL, OR, MT, ID)

Edit `src/config/states.js` and set `enabled: true` for the state:

```js
{ code: 'GA', name: 'Georgia', enabled: true },
```

That's the only change — the filter UI and territory logic update automatically.

---

## 10. Cost

| Piece | Cost |
|---|---|
| Vercel hosting | **$0** — Hobby tier, no card |
| Neon Postgres | **$0** — free tier, no card |
| Map tiles (OpenStreetMap) | **$0** — no key |
| Business discovery (Overpass) | **$0** — no key, no card |
| Pitch generation (templates) | **$0** — runs in your own code |

**Total: $0/month, no credit card required anywhere.**

Trade-offs to know:
- **OpenStreetMap coverage** varies by area — it's community-mapped, so some small
  businesses may be missing vs. Google. It's real data and completely free. Big radii can
  be slow on the free Overpass service; if a search times out, use a smaller radius.
- **Template pitches** are solid and tailored by business type, but not AI-written. When
  you're ready, you can upgrade `api/ai/pitch.js` to call the Anthropic API for
  AI-generated copy (that needs a small amount of prepaid credit — ~$5 goes a long way).

---

## 11. How the pieces fit

- The React app calls your own `/api/*` functions; no third-party keys ever touch the
  browser (there aren't any to leak).
- Login returns a JWT stored in `localStorage`, sent on every request and verified by the
  API. Tokens last 30 days so reps stay signed in.
- All meaningful actions (login, search, view, pitch) are logged to the `activity` table;
  the admin **Team** tab aggregates them across all reps.
```
