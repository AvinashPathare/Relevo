/** USDC base units are 6-decimal integers held as bigint. FX is fixed and simulated. */
export const DEFAULT_MXN_PER_USDC = "18.50";
export const MAX_FEE_BPS = 25n;
const UNITS = 1_000_000n;

/** Parse a decimal string with at most two decimals into hundredths. */
function toCents(s: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) throw new Error(`bad decimal: ${s}`);
  return BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
}

/** floor(MXN cents × 10⁶ / (rate × 100)). */
export function mxnToUsdcUnits(mxn: string, rate: string): bigint {
  return (toCents(mxn) * UNITS) / toCents(rate);
}

/** amount + 25 bps fee buffer, rounded down (matches the contract's `locked_for`). */
export function lockedFor(units: bigint): bigint {
  return units + (units * MAX_FEE_BPS) / 10_000n;
}

export function formatUsdc(units: bigint): string {
  const cents = units / 10_000n;
  const whole = (cents / 100n).toLocaleString("en-US");
  return `${whole}.${(cents % 100n).toString().padStart(2, "0")}`;
}
