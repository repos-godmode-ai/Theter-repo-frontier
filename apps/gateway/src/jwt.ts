import jwt from "jsonwebtoken";

export type SessionClaims = {
  typ: "paywall_session";
  productPublicId: string;
  payerPubkey: string;
  referenceId: string;
};

export function signSessionToken(
  secret: string,
  claims: SessionClaims,
  ttlSeconds: number
): { token: string; exp: number } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = jwt.sign({ ...claims, exp }, secret, { algorithm: "HS256" });
  return { token, exp };
}

export function verifySessionToken(secret: string, token: string): SessionClaims {
  const decoded = jwt.verify(token, secret) as jwt.JwtPayload & SessionClaims;
  if (decoded.typ !== "paywall_session") {
    throw new Error("Invalid token type");
  }
  return {
    typ: "paywall_session",
    productPublicId: decoded.productPublicId,
    payerPubkey: decoded.payerPubkey,
    referenceId: decoded.referenceId,
  };
}
