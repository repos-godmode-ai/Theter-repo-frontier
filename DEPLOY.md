# Deploy: GitHub + Vercel + API hosting

The **operator console** is a static Vite app.

- **GitHub Pages (automated):** push to `main` runs `.github/workflows/deploy-console-pages.yml` once you add repo secrets and enable Pages (see below).
- **Vercel:** use the dashboard, or run the manual workflow **Deploy console to Vercel** after adding `VERCEL_*` secrets.

The **gateway** (Express + SQLite + `better-sqlite3`) is **not** suited to Vercel serverless; run it on **Railway**, **Fly.io**, **Render**, or a small VPS.

## GitHub

Repository: **https://github.com/repos-godmode-ai/Theter-repo-frontier**

The paywall monorepo lives on `main`.

## GitHub Pages (Actions)

1. Repo **Settings → Secrets and variables → Actions → New repository secret**:
   - `VITE_GATEWAY_URL` — public HTTPS URL of your gateway  
   - `VITE_ADMIN_TOKEN` — same string as gateway `ADMIN_TOKEN`

2. **Settings → Pages → Build and deployment → Source:** choose **GitHub Actions** (not “Deploy from a branch”).

3. Push to `main` (or **Actions → Deploy console to GitHub Pages → Run workflow**).  
   The site will be at:

   `https://<owner>.github.io/<repo>/`

   Example: `https://repos-godmode-ai.github.io/Theter-repo-frontier/`

4. CORS: set gateway `CORS_ORIGIN` to that exact URL (the gateway also allows `*.github.io` for previews—see code).

## 1) Deploy the console to Vercel

### Option A — Vercel Dashboard (recommended)

1. Go to [vercel.com](https://vercel.com) → **Add New…** → **Project** → **Import** this GitHub repo.
2. **Root Directory**: leave as repository root (`.`).  
   Vercel reads `vercel.json`: install at root, build workspace `@paywall/console`, output `apps/console/dist`.
3. **Environment variables** (Production + Preview):

   | Name | Example | Purpose |
   |------|---------|---------|
   | `VITE_GATEWAY_URL` | `https://your-gateway.up.railway.app` | Public URL of your gateway |
   | `VITE_ADMIN_TOKEN` | long random string | Same value as gateway `ADMIN_TOKEN` |

4. Deploy. Your console URL will look like `https://<project>.vercel.app`.

### Option B — Vercel CLI

```bash
npm i -g vercel
cd /path/to/Theter-repo-frontier
vercel link   # follow prompts
vercel env add VITE_GATEWAY_URL
vercel env add VITE_ADMIN_TOKEN
vercel --prod
```

You need a Vercel account linked to GitHub. The CLI will open a browser to log in if needed.

Public Solana helper endpoints (no admin token): `GET /v1/solana/mint-info`, `POST /v1/solana/derive-ata`. Product creation validates `merchantPayTo` on-chain against `USDT_MINT` (see [Solana token docs](https://solana.com/docs/tokens)).

## 2) Deploy the gateway (Railway example)

1. Create a **new Railway project** from this repo (same GitHub repo).
2. **Settings → Deploy**:
   - **Root directory**: leave default or repo root.
   - **Start command**: `npm run start -w @paywall/gateway`
   - **Build command**: `npm ci && npm run build -w @paywall/gateway`
3. **Variables**:

   | Variable | Notes |
   |----------|--------|
   | `JWT_SECRET` | ≥16 chars |
   | `ADMIN_TOKEN` | Same as `VITE_ADMIN_TOKEN` on Vercel |
   | `RPC_URL` | Solana RPC HTTPS URL |
   | `USDT_MINT` | Must match the mint of the merchant USDT ATA |
   | `DATABASE_PATH` | e.g. `/data/paywall.db` — add a **volume** mount in Railway for persistence |
   | `PORT` | Railway sets `PORT`; gateway already uses `process.env.PORT` |
   | `CORS_ORIGIN` | Your Vercel console URL, e.g. `https://xxx.vercel.app` |
   | `PUBLIC_BASE_URL` | Public gateway URL (Railway HTTPS URL) |

4. After deploy, set **Vercel** `VITE_GATEWAY_URL` to this public URL and **redeploy** the console so the browser calls the right host.

## 3) Optional: example API

Same pattern as gateway: deploy `apps/example-api` with:

- `GATEWAY_URL` = public gateway URL  
- `PAYWALL_PRODUCT_PUBLIC_ID` = product id from the console  
- `PORT` from host

## CORS

The gateway allows the configured `CORS_ORIGIN` plus `*.vercel.app` and `*.trycloudflare.com` for previews. For a custom domain on Vercel, set `CORS_ORIGIN` to that exact origin or extend `apps/gateway/src/index.ts`.

## Security

- Rotate `ADMIN_TOKEN` and `JWT_SECRET` for production.
- Do not commit real `.env` files (they are gitignored).
