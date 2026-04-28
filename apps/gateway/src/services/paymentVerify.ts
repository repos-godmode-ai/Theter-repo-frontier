import type { Database } from "better-sqlite3";
import type { LoadedConfig } from "../config.js";
import {
  getPaymentByReference,
  getPaymentByTxSignature,
  markPaymentVerified,
  setPaymentAwaitingApproval,
  sumVerifiedPaymentsForPayerToday,
  type ProductPolicy,
  type ProductRow,
} from "../db.js";
import { signSessionToken } from "../jwt.js";
import { verifyUsdtPaymentTx } from "../solana-verify.js";

export type VerifyHandlerResult =
  | { kind: "ok"; body: { status: "ok"; token: string; expiresAt: string } }
  | { kind: "awaiting"; body: { status: "awaiting_approval"; referenceId: string; message: string } }
  | { kind: "daily_limit"; body: { error: string; spentToday: string; limit: string } }
  | { kind: "error"; status: number; body: Record<string, unknown> };

function issueSession(
  jwtSecret: string,
  productPublicId: string,
  payerPubkey: string,
  referenceId: string
): { token: string; expiresAt: string } {
  const { token, exp } = signSessionToken(
    jwtSecret,
    {
      typ: "paywall_session",
      productPublicId,
      payerPubkey,
      referenceId,
    },
    3600
  );
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

/**
 * POST /v1/verify — idempotent where safe: same referenceId + same tx signature
 * after success returns a fresh JWT; awaiting_approval repeats return 202.
 */
export async function handlePaymentVerify(params: {
  db: Database;
  cfg: LoadedConfig;
  referenceId: string;
  transactionSignature: string;
}): Promise<VerifyHandlerResult> {
  const { db, cfg } = params;
  const sig = params.transactionSignature;
  const ref = params.referenceId;

  const paymentBySig = getPaymentByTxSignature(db, sig);
  if (paymentBySig && paymentBySig.reference_id !== ref) {
    return { kind: "error", status: 409, body: { error: "signature_already_used" } };
  }

  const payment = getPaymentByReference(db, ref);
  if (!payment) {
    return { kind: "error", status: 404, body: { error: "reference_not_found" } };
  }

  const prodRow = db.prepare(`SELECT * FROM products WHERE id = ?`).get(payment.product_id) as ProductRow | undefined;
  if (!prodRow) {
    return { kind: "error", status: 500, body: { error: "product_missing" } };
  }

  // Idempotent: already verified with this exact signature → issue JWT again
  if (payment.status === "verified" && payment.transaction_signature === sig && payment.payer_pubkey) {
    const session = issueSession(cfg.JWT_SECRET, prodRow.public_id, payment.payer_pubkey, ref);
    return { kind: "ok", body: { status: "ok", ...session } };
  }

  if (payment.status === "awaiting_approval" && payment.transaction_signature === sig) {
    return {
      kind: "awaiting",
      body: {
        status: "awaiting_approval",
        referenceId: ref,
        message: "Merchant must approve in console; then call POST /v1/admin/approvals/:referenceId/grant",
      },
    };
  }

  if (payment.status !== "pending") {
    return { kind: "error", status: 400, body: { error: "invalid_payment_state", status: payment.status } };
  }

  if (new Date(payment.expires_at).getTime() < Date.now()) {
    return { kind: "error", status: 400, body: { error: "challenge_expired" } };
  }

  const minAmount = BigInt(prodRow.amount_atomic);
  const verified = await verifyUsdtPaymentTx({
    rpcUrl: cfg.RPC_URL,
    usdtMint: cfg.USDT_MINT,
    merchantPayTo: prodRow.merchant_pay_to,
    minAmountAtomic: minAmount,
    referenceId: ref,
    signature: sig,
  });

  if (!verified.ok) {
    return { kind: "error", status: 400, body: { error: "verification_failed", reason: verified.reason } };
  }

  const policy = JSON.parse(prodRow.policy_json || "{}") as ProductPolicy;
  const dailyLimit = BigInt(policy.dailyLimitAtomic || "0");
  const approvalOver = BigInt(policy.approvalOverAtomic || "0");

  const spentToday = sumVerifiedPaymentsForPayerToday(db, prodRow.id, verified.payerPubkey);
  const nextTotal = spentToday + verified.amountPaidAtomic;

  if (dailyLimit > 0n && nextTotal > dailyLimit) {
    return {
      kind: "daily_limit",
      body: {
        error: "daily_limit_exceeded",
        spentToday: spentToday.toString(),
        limit: dailyLimit.toString(),
      },
    };
  }

  if (approvalOver > 0n && verified.amountPaidAtomic > approvalOver) {
    setPaymentAwaitingApproval(db, ref, sig, verified.payerPubkey, verified.amountPaidAtomic.toString());
    return {
      kind: "awaiting",
      body: {
        status: "awaiting_approval",
        referenceId: ref,
        message: "Merchant must approve in console; then call POST /v1/admin/approvals/:referenceId/grant",
      },
    };
  }

  markPaymentVerified(db, ref, sig, verified.payerPubkey, verified.amountPaidAtomic.toString());
  const session = issueSession(cfg.JWT_SECRET, prodRow.public_id, verified.payerPubkey, ref);
  return { kind: "ok", body: { status: "ok", ...session } };
}
