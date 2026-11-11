/** CLABE (Mexican 18-digit bank account number) validation: weights 3,7,1 over 17 digits. */
export type ClabeResult =
  | { ok: true }
  | { ok: false; reason: "clabe_length" | "clabe_non_digit" | "clabe_check_digit" };

const WEIGHTS = [3, 7, 1];

export function clabeCheckDigit(first17: string): number {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (Number(first17[i]) * WEIGHTS[i % 3]) % 10;
  return (10 - (sum % 10)) % 10;
}

export function validateClabe(s: string): ClabeResult {
  if (s.length !== 18) return { ok: false, reason: "clabe_length" };
  if (!/^\d{18}$/.test(s)) return { ok: false, reason: "clabe_non_digit" };
  if (clabeCheckDigit(s.slice(0, 17)) !== Number(s[17])) return { ok: false, reason: "clabe_check_digit" };
  return { ok: true };
}

export function clabeLast4(s: string): string {
  return s.slice(-4);
}
