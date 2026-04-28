#!/usr/bin/env node
/**
 * Smoke test: start is manual; set GATEWAY_URL and ADMIN_TOKEN or pass as env.
 * Usage: GATEWAY_URL=http://127.0.0.1:9876 ADMIN_TOKEN=xxx node scripts/smoke-test.mjs
 */
const base = process.env.GATEWAY_URL || "http://127.0.0.1:8787";
const admin = process.env.ADMIN_TOKEN || "";

const j = (r) => r.json().catch(() => ({}));

async function req(path, opts = {}) {
  const url = new URL(path, base);
  const headers = { "Content-Type": "application/json", ...opts.headers };
  const r = await fetch(url, { ...opts, headers });
  const body = await j(r);
  return { ok: r.ok, status: r.status, body };
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("OK:", msg);
  }
}

async function main() {
  console.log("Gateway:", base);

  let r = await req("/health");
  assert(r.ok && r.body.service === "paywall-gateway", "GET /health");

  r = await req("/v1/solana/mint-info");
  assert(r.ok && typeof r.body.decimals === "number", "GET /v1/solana/mint-info");

  r = await req("/v1/solana/derive-ata", {
    method: "POST",
    body: JSON.stringify({
      owner: "11111111111111111111111111111111",
    }),
  });
  assert(r.ok && Array.isArray(r.body.associatedTokenAccounts), "POST /v1/solana/derive-ata");

  if (!admin) {
    console.log("SKIP: ADMIN_TOKEN not set — admin and verify tests skipped");
    process.exit(failed ? 1 : 0);
  }

  r = await req("/v1/admin/products", {
    headers: { Authorization: `Bearer ${admin}` },
  });
  assert(r.ok && Array.isArray(r.body.products), "GET /v1/admin/products");

  const productBody = {
    name: `smoke-${Date.now()}`,
    merchantPayTo: "So11111111111111111111111111111111111111112",
    amountAtomic: "1000",
    policy: { dailyLimitAtomic: "0", approvalOverAtomic: "0" },
  };

  r = await req("/v1/admin/products", {
    method: "POST",
    headers: { Authorization: `Bearer ${admin}` },
    body: JSON.stringify(productBody),
  });

  if (!r.ok && r.body.error === "invalid_merchant_pay_to") {
    console.log("INFO: create product failed payTo validation (expected without PAYWALL_SKIP_PAY_TO_VALIDATION). Skipping challenge/verify.");
    process.exit(failed ? 1 : 0);
  }

  assert(r.ok && r.body.publicId, "POST /v1/admin/products");
  const publicId = r.body.publicId;

  r = await req(`/v1/products/${publicId}/challenges`, { method: "POST" });
  assert(r.ok && r.status === 201 && r.body.referenceId, "POST challenge");

  const ref = r.body.referenceId;
  r = await req("/v1/verify", {
    method: "POST",
    body: JSON.stringify({
      referenceId: ref,
      transactionSignature: "1111111111111111111111111111111111111111111111111111111111111111",
    }),
  });
  assert(!r.ok && r.status === 400, "POST /v1/verify bogus tx should 400");

  r = await req("/v1/session/introspect", {
    headers: { Authorization: "Bearer invalid" },
  });
  assert(r.status === 401 && r.body.valid === false, "GET introspect invalid token → 401 valid:false");

  console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
