import type { RequestHandler } from "express";

export type PaywallMiddlewareOptions = {
  gatewayUrl: string;
  productPublicId: string;
};

async function introspect(gatewayUrl: string, bearer: string): Promise<{ valid: boolean; claims?: any }> {
  const r = await fetch(new URL("/v1/session/introspect", gatewayUrl).toString(), {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  if (!r.ok) return { valid: false };
  return (await r.json()) as { valid: boolean; claims?: any };
}

/**
 * Express middleware: requires a valid paywall session JWT (from gateway /v1/verify).
 * If missing/invalid, returns 402 and a fresh payment challenge from the gateway.
 */
export function paywallProtect(opts: PaywallMiddlewareOptions): RequestHandler {
  return async (req, res, next) => {
    const auth = req.headers.authorization ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";

    if (bearer) {
      const intro = await introspect(opts.gatewayUrl, bearer);
      if (intro.valid && intro.claims?.productPublicId === opts.productPublicId) {
        (req as any).paywall = { claims: intro.claims };
        next();
        return;
      }
    }

    const chRes = await fetch(new URL(`/v1/products/${opts.productPublicId}/challenges`, opts.gatewayUrl).toString(), {
      method: "POST",
    });
    if (!chRes.ok) {
      const text = await chRes.text();
      res.status(502).json({ error: "gateway_challenge_failed", status: chRes.status, body: text });
      return;
    }
    const challenge = await chRes.json();
    res.status(402).setHeader("Content-Type", "application/json").json({
      error: "payment_required",
      challenge,
    });
  };
}
