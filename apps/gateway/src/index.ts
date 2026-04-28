import cors from "cors";
import express from "express";
import { Connection, PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import {
  createPaymentChallenge,
  createProduct,
  getPaymentByReference,
  getProductByPublicId,
  listProducts,
  listRecentPayments,
  markPaymentVerified,
  openDbSync,
  type ProductPolicy,
} from "./db.js";
import { signSessionToken, verifySessionToken } from "./jwt.js";
import {
  deriveAtaAddresses,
  fetchMintDecimals,
  solanaDocsTokensUrl,
  solanaDocsTransactionsUrl,
  validateMerchantPayTo,
} from "./solana-helpers.js";
import { formatAtomicToDecimal } from "./format-atomic.js";
import { handlePaymentVerify } from "./services/paymentVerify.js";

const cfg = loadConfig();
const db = openDbSync(cfg.DATABASE_PATH);
const solanaConnection = new Connection(cfg.RPC_URL, "confirmed");

const app = express();

function isLocalDevOrigin(origin: string): boolean {
  try {
    const h = new URL(origin).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  } catch {
    return false;
  }
}

// Allow configured origin, local Vite/console hosts, plus common tunnel hosts.
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origin === cfg.CORS_ORIGIN) return cb(null, true);
      if (isLocalDevOrigin(origin)) return cb(null, true);
      try {
        const h = new URL(origin).hostname;
        if (h.endsWith(".loca.lt") || h.endsWith(".localtunnel.me")) return cb(null, true);
        if (h.endsWith(".trycloudflare.com")) return cb(null, true);
        if (h.endsWith(".vercel.app")) return cb(null, true);
        if (h.endsWith(".github.io")) return cb(null, true);
      } catch {
        /* ignore */
      }
      cb(null, false);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "512kb" }));

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== cfg.ADMIN_TOKEN) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "paywall-gateway" });
});

/** Public: mint metadata for UI (defaults to gateway USDT_MINT). See https://solana.com/docs/tokens */
app.get("/v1/solana/mint-info", async (req, res) => {
  try {
    const mintStr = (req.query.mint as string) || cfg.USDT_MINT;
    const mint = new PublicKey(mintStr);
    const decimals = await fetchMintDecimals(solanaConnection, mint);
    res.json({
      mint: mint.toBase58(),
      decimals,
      docs: {
        tokens: solanaDocsTokensUrl(),
        transactions: solanaDocsTransactionsUrl(),
      },
    });
  } catch (e) {
    res.status(400).json({ error: "invalid_mint", message: String(e instanceof Error ? e.message : e) });
  }
});

const deriveAtaSchema = z.object({
  owner: z.string().min(32).max(64),
  mint: z.string().min(32).max(64).optional(),
});

/** Public: canonical ATA addresses for (owner, mint) — https://solana.com/docs/tokens#associated-token-account */
app.post("/v1/solana/derive-ata", (req, res) => {
  const parsed = deriveAtaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }
  try {
    const owner = new PublicKey(parsed.data.owner);
    const mint = new PublicKey(parsed.data.mint ?? cfg.USDT_MINT);
    const addresses = deriveAtaAddresses(owner, mint);
    res.json({
      owner: owner.toBase58(),
      mint: mint.toBase58(),
      associatedTokenAccounts: addresses,
      docs: solanaDocsTokensUrl(),
    });
  } catch (e) {
    res.status(400).json({ error: "invalid_pubkey", message: String(e instanceof Error ? e.message : e) });
  }
});

const createProductSchema = z.object({
  name: z.string().min(1).max(120),
  merchantPayTo: z.string().min(32).max(64),
  amountAtomic: z.string().regex(/^\d+$/),
  policy: z
    .object({
      dailyLimitAtomic: z.string().regex(/^\d+$/).default("0"),
      approvalOverAtomic: z.string().regex(/^\d+$/).default("0"),
    })
    .default({ dailyLimitAtomic: "0", approvalOverAtomic: "0" }),
});

app.post("/v1/admin/products", requireAdmin, async (req, res) => {
  const parsed = createProductSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }
  try {
    let payToValidation: {
      mintDecimals: number;
      tokenProgram: string;
      isCanonicalAta: boolean;
      merchantWallet: string | null;
      skipped?: boolean;
    } | undefined;

    if (!cfg.skipPayToValidation) {
      const payTo = new PublicKey(parsed.data.merchantPayTo);
      const expectedMint = new PublicKey(cfg.USDT_MINT);
      const v = await validateMerchantPayTo({
        connection: solanaConnection,
        expectedMint,
        payTo,
      });
      if (!v.ok) {
        res.status(400).json({
          error: "invalid_merchant_pay_to",
          reason: v.reason,
          docs: solanaDocsTokensUrl(),
          hint: "payTo must be an SPL token account that holds the configured USDT mint (often the merchant wallet ATA). Set PAYWALL_SKIP_PAY_TO_VALIDATION=1 only for local dev.",
        });
        return;
      }
      payToValidation = {
        mintDecimals: v.mint.decimals,
        tokenProgram: v.mint.program,
        isCanonicalAta: v.isCanonicalAta,
        merchantWallet: v.tokenAccountOwner,
      };
    } else {
      payToValidation = {
        mintDecimals: 6,
        tokenProgram: "skipped",
        isCanonicalAta: false,
        merchantWallet: null,
        skipped: true,
      };
    }

    const publicId = createProduct(db, {
      name: parsed.data.name,
      merchantPayTo: parsed.data.merchantPayTo,
      amountAtomic: parsed.data.amountAtomic,
      policy: parsed.data.policy as ProductPolicy,
    });
    res.status(201).json({
      publicId,
      payToValidation,
    });
  } catch (e) {
    res.status(400).json({
      error: "validation_failed",
      message: String(e instanceof Error ? e.message : e),
      docs: solanaDocsTokensUrl(),
    });
  }
});

app.get("/v1/admin/products", requireAdmin, (_req, res) => {
  const rows = listProducts(db).map((r) => ({
    publicId: r.public_id,
    name: r.name,
    merchantPayTo: r.merchant_pay_to,
    amountAtomic: r.amount_atomic,
    policy: JSON.parse(r.policy_json || "{}") as ProductPolicy,
    createdAt: r.created_at,
  }));
  res.json({ products: rows });
});

app.get("/v1/admin/payments", requireAdmin, (_req, res) => {
  const rows = listRecentPayments(db, 100).map((p) => ({
    referenceId: p.reference_id,
    productPublicId: p.product_public_id,
    status: p.status,
    transactionSignature: p.transaction_signature,
    payerPubkey: p.payer_pubkey,
    amountPaidAtomic: p.amount_paid_atomic,
    createdAt: p.created_at,
    expiresAt: p.expires_at,
  }));
  res.json({ payments: rows });
});

app.post("/v1/products/:productPublicId/challenges", async (req, res) => {
  const product = getProductByPublicId(db, req.params.productPublicId);
  if (!product) {
    res.status(404).json({ error: "product_not_found" });
    return;
  }
  const ttl = 15;
  const { referenceId, expiresAt } = createPaymentChallenge(db, product.id, ttl);
  let mintDecimals = 6;
  try {
    mintDecimals = await fetchMintDecimals(solanaConnection, new PublicKey(cfg.USDT_MINT));
  } catch {
    /* default */
  }
  const humanAmount = formatAtomicToDecimal(BigInt(product.amount_atomic), mintDecimals);

  res.status(201).json({
    referenceId,
    payTo: product.merchant_pay_to,
    amountAtomic: product.amount_atomic,
    mintDecimals,
    humanAmount,
    humanCurrency: "USDT",
    memo: referenceId,
    memoProgram: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    usdtMint: cfg.USDT_MINT,
    expiresAt,
    verifyUrl: `${cfg.publicBaseUrl}/v1/verify`,
    solanaDocs: {
      tokens: solanaDocsTokensUrl(),
      transactions: solanaDocsTransactionsUrl(),
    },
    instructions:
      "Atomic: all instructions in one transaction succeed or all revert (https://solana.com/docs/core/transactions). Include: (1) SPL transfer or transferChecked of >= amountAtomic of usdtMint into payTo, (2) Memo instruction with UTF-8 memo exactly containing referenceId. Sign with the token account authority (wallet). POST verifyUrl with { referenceId, transactionSignature }.",
  });
});

const verifySchema = z.object({
  referenceId: z.string().min(4),
  transactionSignature: z.string().min(32),
});

app.post("/v1/verify", async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }

  const result = await handlePaymentVerify({
    db,
    cfg,
    referenceId: parsed.data.referenceId,
    transactionSignature: parsed.data.transactionSignature,
  });

  switch (result.kind) {
    case "ok":
      res.json(result.body);
      return;
    case "awaiting":
      res.status(202).json(result.body);
      return;
    case "daily_limit":
      res.status(403).json(result.body);
      return;
    case "error":
      res.status(result.status).json(result.body);
      return;
    default: {
      const _exhaustive: never = result;
      void _exhaustive;
      res.status(500).json({ error: "internal" });
    }
  }
});

app.post("/v1/admin/approvals/:referenceId/grant", requireAdmin, (req, res) => {
  const payment = getPaymentByReference(db, req.params.referenceId);
  if (!payment || payment.status !== "awaiting_approval") {
    res.status(400).json({ error: "not_awaiting_approval" });
    return;
  }
  const prodRow = db.prepare(`SELECT * FROM products WHERE id = ?`).get(payment.product_id) as
    | import("./db.js").ProductRow
    | undefined;
  if (!prodRow || !payment.transaction_signature || !payment.payer_pubkey || !payment.amount_paid_atomic) {
    res.status(500).json({ error: "invalid_row" });
    return;
  }
  markPaymentVerified(
    db,
    payment.reference_id,
    payment.transaction_signature,
    payment.payer_pubkey,
    payment.amount_paid_atomic
  );
  const { token, exp } = signSessionToken(
    cfg.JWT_SECRET,
    {
      typ: "paywall_session",
      productPublicId: prodRow.public_id,
      payerPubkey: payment.payer_pubkey,
      referenceId: payment.reference_id,
    },
    3600
  );
  res.json({ status: "ok", token, expiresAt: new Date(exp * 1000).toISOString() });
});

app.get("/v1/session/introspect", (req, res) => {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "missing_token" });
    return;
  }
  try {
    const claims = verifySessionToken(cfg.JWT_SECRET, token);
    res.json({ valid: true, claims });
  } catch {
    res.status(401).json({ valid: false });
  }
});

app.listen(cfg.PORT, () => {
  console.log(`paywall-gateway listening on http://localhost:${cfg.PORT}`);
});
