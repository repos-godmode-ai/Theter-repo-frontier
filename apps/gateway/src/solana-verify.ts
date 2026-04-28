import { Connection, PublicKey } from "@solana/web3.js";
import type { ParsedInstruction, ParsedTransactionWithMeta } from "@solana/web3.js";

export type VerifyResult =
  | {
      ok: true;
      payerPubkey: string;
      amountPaidAtomic: bigint;
    }
  | { ok: false; reason: string };

const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

function scanMemo(ix: ParsedInstruction, referenceId: string): boolean {
  if (!ix.programId.equals(MEMO_PROGRAM)) return false;
  const data = (ix as unknown as { data?: string }).data;
  return typeof data === "string" && data.includes(referenceId);
}

function collectSplTransfer(ix: ParsedInstruction, mint: PublicKey, payTo: PublicKey): bigint {
  if (ix.program !== "spl-token") return 0n;
  const p = ix.parsed as Record<string, unknown> | undefined;
  if (!p || typeof p !== "object") return 0n;
  const type = p.type as string | undefined;
  if (type !== "transfer" && type !== "transferChecked") return 0n;
  const info = p.info as Record<string, unknown> | undefined;
  if (!info) return 0n;
  if (String(info.mint) !== mint.toBase58()) return 0n;
  if (String(info.destination) !== payTo.toBase58()) return 0n;
  if (type === "transferChecked") {
    const ta = info.tokenAmount as { amount?: string } | undefined;
    return BigInt(ta?.amount ?? "0");
  }
  return BigInt(String(info.amount ?? "0"));
}

function walkInstructions(tx: ParsedTransactionWithMeta, cb: (ix: ParsedInstruction) => void) {
  const msg = tx.transaction.message;
  for (const ix of msg.instructions) {
    if ("programId" in ix) cb(ix as ParsedInstruction);
  }
  const inner = tx.meta?.innerInstructions ?? [];
  for (const group of inner) {
    for (const ix of group.instructions) {
      if ("programId" in ix) cb(ix as ParsedInstruction);
    }
  }
}

export async function verifyUsdtPaymentTx(params: {
  rpcUrl: string;
  usdtMint: string;
  merchantPayTo: string;
  minAmountAtomic: bigint;
  referenceId: string;
  signature: string;
}): Promise<VerifyResult> {
  const connection = new Connection(params.rpcUrl, "confirmed");
  const mint = new PublicKey(params.usdtMint);
  const payTo = new PublicKey(params.merchantPayTo);

  const tx = await connection.getParsedTransaction(params.signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });

  if (!tx || tx.meta?.err) {
    return { ok: false, reason: "Transaction not found or failed" };
  }

  let memoOk = false;
  let amountPaid = 0n;

  walkInstructions(tx, (ix) => {
    if (scanMemo(ix, params.referenceId)) memoOk = true;
    const paid = collectSplTransfer(ix, mint, payTo);
    if (paid > amountPaid) amountPaid = paid;
  });

  if (!memoOk) {
    return { ok: false, reason: "Memo with referenceId not found in transaction" };
  }

  if (amountPaid < params.minAmountAtomic) {
    return {
      ok: false,
      reason: `USDT transfer to merchant ATA too small or missing (paid ${amountPaid}, need ${params.minAmountAtomic})`,
    };
  }

  const keys = tx.transaction.message.accountKeys;
  const payer = keys[0]?.pubkey;
  if (!payer) {
    return { ok: false, reason: "Could not determine fee payer" };
  }

  return { ok: true, payerPubkey: payer.toBase58(), amountPaidAtomic: amountPaid };
}
