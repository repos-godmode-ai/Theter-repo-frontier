/** Format SPL token atomic amount using mint decimals (Solana token model). */
export function formatAtomicToDecimal(amountAtomic: bigint, decimals: number): string {
  if (decimals < 0 || decimals > 18) return amountAtomic.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = amountAtomic / scale;
  const frac = amountAtomic % scale;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}
