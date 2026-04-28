import "dotenv/config";
import express from "express";
import { paywallProtect } from "@paywall/sdk";

const port = Number(process.env.PORT ?? 8788);
const gatewayUrl = process.env.GATEWAY_URL ?? "http://localhost:8787";
const productId = process.env.PAYWALL_PRODUCT_PUBLIC_ID ?? "";

if (!productId) {
  console.error("Set PAYWALL_PRODUCT_PUBLIC_ID in .env");
  process.exit(1);
}

const app = express();

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get(
  "/api/premium-quote",
  paywallProtect({ gatewayUrl, productPublicId: productId }),
  (req, res) => {
    const payer = (req as express.Request & { paywall?: { claims: { payerPubkey: string } } }).paywall?.claims
      ?.payerPubkey;
    res.json({
      message: "Thanks for paying in USDT on Solana.",
      quote: { pair: "SOL/USDT", mid: "sample", ts: new Date().toISOString() },
      payer,
    });
  }
);

app.listen(port, () => {
  console.log(`example-api http://localhost:${port}  (protected: GET /api/premium-quote)`);
});
