import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(8787),
  JWT_SECRET: z.string().min(16),
  ADMIN_TOKEN: z.string().min(8),
  RPC_URL: z.string().url(),
  USDT_MINT: z.string().min(32),
  DATABASE_PATH: z.string().default("./data/paywall.db"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  PUBLIC_BASE_URL: z.string().url().optional(),
  /** Set to "1" to skip on-chain merchant token-account check (local dev / wrong cluster). */
  PAYWALL_SKIP_PAY_TO_VALIDATION: z.enum(["0", "1"]).optional().default("0"),
});

export type Config = z.infer<typeof envSchema>;
export type LoadedConfig = Config & { publicBaseUrl: string; skipPayToValidation: boolean };

export function loadConfig(): LoadedConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  const data = parsed.data;
  const publicBaseUrl = data.PUBLIC_BASE_URL ?? `http://localhost:${data.PORT}`;
  const skipPayToValidation = data.PAYWALL_SKIP_PAY_TO_VALIDATION === "1";
  return { ...data, publicBaseUrl, skipPayToValidation };
}
