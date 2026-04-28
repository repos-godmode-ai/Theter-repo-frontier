# USDT Paywall — Solana micro-billing for APIs (x402-style)

Programmable **USDT (SPL)** payment challenges for HTTP APIs on **Solana**, with a **developer console**, **session tokens** after on-chain verification, and a **policy layer** (daily caps, per-payment max, optional approval queue).

Built for hackathon-style demos: **devnet-first**, clear README, copy-paste integration.

## Monorepo

| Package | Description |
|---------|-------------|
| `apps/gateway` | Express API: challenges, verify tx, sessions, admin, SQLite |
| `apps/console` | Vite + React operator UI |
| `packages/paywall-sdk` | Express middleware for protected routes |
| `apps/example-api` | Sample API using the SDK |

## Quick start

### 1. Install

```bash
npm install
```

### 2. Configure gateway

```bash
cp apps/gateway/.env.example apps/gateway/.env
```

Edit `apps/gateway/.env`:

- `JWT_SECRET` — long random string (HS256 for sessions).
- `ADMIN_TOKEN` — bearer token for console + admin API.
- `RPC_URL` — Solana RPC (Helius, Triton, public devnet, etc.).
- `USDT_MINT` — SPL mint for USDT on your cluster (must match the token account in `merchantPayTo`).
- `PUBLIC_BASE_URL` (optional) — public URL of the gateway (used in challenge JSON `verifyUrl`; defaults to `http://localhost:<PORT>`).

### 3. Run gateway

```bash
npm run dev -w @paywall/gateway
```

Gateway default: `http://localhost:8787`.

### 4. Run console

```bash
npm run dev -w @paywall/console
```

Set `VITE_GATEWAY_URL=http://localhost:8787` and `VITE_ADMIN_TOKEN=<same as ADMIN_TOKEN>` in `apps/console/.env` (see `.env.example`).

### 5. Run example protected API

```bash
cp apps/example-api/.env.example apps/example-api/.env
npm run dev -w @paywall/example-api
```

## Payment + access flow

1. Client calls a protected route **without** `Authorization: Bearer <session>`.
2. API responds **402** with JSON containing `referenceId`, `payTo` (merchant USDT token account), `amountAtomic`, `memo`, `expiresAt`.
3. Payer sends an SPL **USDT** transfer to `payTo` for at least `amountAtomic`, **same transaction** includes a **memo** instruction containing `referenceId`.
4. Client `POST /v1/verify` with `{ referenceId, transactionSignature }` to the gateway.
5. Gateway verifies the transaction on Solana, applies **policies**, then returns a **session JWT**.
6. Client retries the API with `Authorization: Bearer <session>`.

## Security notes (read before mainnet)

- This is **hackathon-grade**: HS256 shared secret, SQLite, no multi-tenant hardening.
- **Recipient** in the product should be the merchant’s **USDT associated token account (ATA)** for the configured `USDT_MINT`.
- For production you’d want: KMS, Postgres, rate limits per IP, mint allowlist, replay protection beyond tx signature uniqueness, and audited token parsing.

## Scripts

```bash
npm run build   # build all workspaces
npm run dev     # gateway only (root shortcut)
```

## License

MIT
