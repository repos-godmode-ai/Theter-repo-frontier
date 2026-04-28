import cors from "cors";
import express from "express";
import { z } from "zod";
import { loadConfig } from "./config.js";
import {
  createPaymentChallenge,
  createProduct,
  getPaymentByReference,
  getPaymentByTxSignature,
  getProductByPublicId,
  listProducts,
  listRecentPayments,
  markPaymentVerified,
  openDbSync,
  setPaymentAwaitingApproval,
  sumVerifiedPaymentsForPayerToday,
  type ProductPolicy,
} from "./db.js";
import { signSessionToken, verifySessionToken } from "./jwt.js";
import { verifyUsdtPaymentTx } from "./solana-verify.js";

const cfg = loadConfig();
const db = openDbSync(cfg.DATABASE_PATH);

const app = express();
// Allow configured origin plus common tunnel hosts (mobile demos).
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origin === cfg.CORS_ORIGIN) return cb(null, true);
      try {
        const h = new URL(origin).hostname;
        if (h.endsWith(".loca.lt") || h.endsWith(".localtunnel.me")) return cb(null, true);
        if (h.endsWith(".trycloudflare.com")) return cb(null, true);
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

app.post("/v1/admin/products", requireAdmin, (req, res) => {
  const parsed = createProductSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }
  const publicId = createProduct(db, {
    name: parsed.data.name,
    merchantPayTo: parsed.data.merchantPayTo,
    amountAtomic: parsed.data.amountAtomic,
    policy: parsed.data.policy as ProductPolicy,
  });
  res.status(201).json({ publicId });
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

app.post("/v1/products/:productPublicId/challenges", (req, res) => {
  const product = getProductByPublicId(db, req.params.productPublicId);
  if (!product) {
    res.status(404).json({ error: "product_not_found" });
    return;
  }
  const ttl = 15;
  const { referenceId, expiresAt } = createPaymentChallenge(db, product.id, ttl);
  res.status(201).json({
    referenceId,
    payTo: product.merchant_pay_to,
    amountAtomic: product.amount_atomic,
    memo: referenceId,
    usdtMint: cfg.USDT_MINT,
    expiresAt,
    verifyUrl: `${cfg.publicBaseUrl}/v1/verify`,
    instructions:
      "Build a tx: SPL USDT transfer to payTo for >= amountAtomic, plus Memo program instruction with memo text === referenceId. Then POST verifyUrl with JSON { referenceId, transactionSignature }.",
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

  const existing = getPaymentByTxSignature(db, parsed.data.transactionSignature);
  if (existing) {
    res.status(409).json({ error: "signature_already_used" });
    return;
  }

  const payment = getPaymentByReference(db, parsed.data.referenceId);
  if (!payment) {
    res.status(404).json({ error: "reference_not_found" });
    return;
  }
  if (payment.status !== "pending") {
    res.status(400).json({ error: "invalid_payment_state", status: payment.status });
    return;
  }
  if (new Date(payment.expires_at).getTime() < Date.now()) {
    res.status(400).json({ error: "challenge_expired" });
    return;
  }

  const prodRow = db.prepare(`SELECT * FROM products WHERE id = ?`).get(payment.product_id) as
    | import("./db.js").ProductRow
    | undefined;
  if (!prodRow) {
    res.status(500).json({ error: "product_missing" });
    return;
  }

  const minAmount = BigInt(prodRow.amount_atomic);
  const verified = await verifyUsdtPaymentTx({
    rpcUrl: cfg.RPC_URL,
    usdtMint: cfg.USDT_MINT,
    merchantPayTo: prodRow.merchant_pay_to,
    minAmountAtomic: minAmount,
    referenceId: parsed.data.referenceId,
    signature: parsed.data.transactionSignature,
  });

  if (!verified.ok) {
    res.status(400).json({ error: "verification_failed", reason: verified.reason });
    return;
  }

  const policy = JSON.parse(prodRow.policy_json || "{}") as ProductPolicy;
  const dailyLimit = BigInt(policy.dailyLimitAtomic || "0");
  const approvalOver = BigInt(policy.approvalOverAtomic || "0");

  const spentToday = sumVerifiedPaymentsForPayerToday(db, prodRow.id, verified.payerPubkey);
  const nextTotal = spentToday + verified.amountPaidAtomic;
  if (dailyLimit > 0n && nextTotal > dailyLimit) {
    res.status(403).json({
      error: "daily_limit_exceeded",
      spentToday: spentToday.toString(),
      limit: dailyLimit.toString(),
    });
    return;
  }

  if (approvalOver > 0n && verified.amountPaidAtomic > approvalOver) {
    setPaymentAwaitingApproval(
      db,
      parsed.data.referenceId,
      parsed.data.transactionSignature,
      verified.payerPubkey,
      verified.amountPaidAtomic.toString()
    );
    res.status(202).json({
      status: "awaiting_approval",
      referenceId: parsed.data.referenceId,
      message: "Merchant must approve in console; then call POST /v1/admin/approvals/:referenceId/grant",
    });
    return;
  }

  markPaymentVerified(
    db,
    parsed.data.referenceId,
    parsed.data.transactionSignature,
    verified.payerPubkey,
    verified.amountPaidAtomic.toString()
  );

  const { token, exp } = signSessionToken(
    cfg.JWT_SECRET,
    {
      typ: "paywall_session",
      productPublicId: prodRow.public_id,
      payerPubkey: verified.payerPubkey,
      referenceId: parsed.data.referenceId,
    },
    3600
  );

  res.json({ status: "ok", token, expiresAt: new Date(exp * 1000).toISOString() });
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
