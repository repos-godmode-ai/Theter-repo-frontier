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
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config & { publicBaseUrl: string } {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  const data = parsed.data;
  const publicBaseUrl = data.PUBLIC_BASE_URL ?? `http://localhost:${data.PORT}`;
  return { ...data, publicBaseUrl };
}
