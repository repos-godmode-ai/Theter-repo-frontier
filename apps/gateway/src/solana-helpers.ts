import { Connection, PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";

export type TokenProgramKind = "tokenkeg" | "token2022";

export type MintSummary = {
  address: string;
  decimals: number;
  supply: string;
  program: TokenProgramKind;
};

export type PayToValidation = {
  ok: true;
  mint: MintSummary;
  /** True if payTo equals the canonical ATA for (owner, mint) on the detected token program */
  isCanonicalAta: boolean;
  /** Owner wallet of the token account (from chain), if account exists */
  tokenAccountOwner: string | null;
} | { ok: false; reason: string };

/**
 * Validates that `payTo` is an SPL token account holding `expectedMint`,
 * per Solana token model (mint + token account): https://solana.com/docs/tokens
 */
export async function validateMerchantPayTo(params: {
  connection: Connection;
  expectedMint: PublicKey;
  payTo: PublicKey;
}): Promise<PayToValidation> {
  const acc = await params.connection.getAccountInfo(params.payTo, "confirmed");
  if (!acc) {
    return { ok: false, reason: "payTo account not found on chain" };
  }

  const programId = acc.owner;
  const isClassic = programId.equals(TOKEN_PROGRAM_ID);
  const is2022 = programId.equals(TOKEN_2022_PROGRAM_ID);
  if (!isClassic && !is2022) {
    return { ok: false, reason: "payTo is not an SPL token account (wrong owner program)" };
  }

  let mintPk: PublicKey;
  let tokenAccountOwner: PublicKey | null = null;
  try {
    const parsed = await params.connection.getParsedAccountInfo(params.payTo, "confirmed");
    const val = parsed.value?.data;
    if (!val || typeof val === "string" || !("parsed" in val)) {
      return { ok: false, reason: "Could not parse token account data" };
    }
    const p = val.parsed as { type?: string; info?: Record<string, unknown> };
    if (p.type !== "account" || !p.info) {
      return { ok: false, reason: "payTo is not a parsed SPL token account" };
    }
    const mintStr = String(p.info.mint ?? "");
    mintPk = new PublicKey(mintStr);
    tokenAccountOwner = new PublicKey(String(p.info.owner ?? ""));
  } catch {
    return { ok: false, reason: "Invalid token account layout" };
  }

  if (!mintPk.equals(params.expectedMint)) {
    return {
      ok: false,
      reason: `Token account mint mismatch: account holds ${mintPk.toBase58()}, gateway expects ${params.expectedMint.toBase58()}`,
    };
  }

  const program: TokenProgramKind = is2022 ? "token2022" : "tokenkeg";
  let decimals = 6;
  let supply = "0";
  try {
    const mintInfo = await getMint(params.connection, params.expectedMint, "confirmed", programId);
    decimals = mintInfo.decimals;
    supply = mintInfo.supply.toString();
  } catch {
    try {
      const altProgram = is2022 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
      const mintInfo = await getMint(params.connection, params.expectedMint, "confirmed", altProgram);
      decimals = mintInfo.decimals;
      supply = mintInfo.supply.toString();
    } catch {
      /* mint layout mismatch — decimals default */
    }
  }

  const mintSummary: MintSummary = {
    address: params.expectedMint.toBase58(),
    decimals,
    supply,
    program,
  };

  let isCanonicalAta = false;
  if (tokenAccountOwner) {
    try {
      const ataClassic = getAssociatedTokenAddressSync(params.expectedMint, tokenAccountOwner, false, TOKEN_PROGRAM_ID);
      const ata2022 = getAssociatedTokenAddressSync(params.expectedMint, tokenAccountOwner, false, TOKEN_2022_PROGRAM_ID);
      isCanonicalAta = params.payTo.equals(ataClassic) || params.payTo.equals(ata2022);
    } catch {
      /* ignore */
    }
  }

  return {
    ok: true,
    mint: mintSummary,
    isCanonicalAta,
    tokenAccountOwner: tokenAccountOwner?.toBase58() ?? null,
  };
}

export function solanaDocsTokensUrl(): string {
  return "https://solana.com/docs/tokens";
}

export function solanaDocsTransactionsUrl(): string {
  return "https://solana.com/docs/core/transactions";
}

/** Mint decimals for pricing UX (tries Token program then Token-2022). */
export async function fetchMintDecimals(connection: Connection, mint: PublicKey): Promise<number> {
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const m = await getMint(connection, mint, "confirmed", programId);
      return m.decimals;
    } catch {
      /* try next */
    }
  }
  return 6;
}

export function deriveAtaAddresses(owner: PublicKey, mint: PublicKey): { tokenProgram: string; address: string }[] {
  return [
    {
      tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
      address: getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID).toBase58(),
    },
    {
      tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
      address: getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID).toBase58(),
    },
  ];
}
