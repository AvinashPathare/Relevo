/**
 * Is a Sputnik proposal kind this app's batch-funding proposal? A FunctionCall to the deployment's USDC
 * with exactly one ft_transfer_call whose receiver is the escrow and whose msg is fund_batch (for
 * `batchHash`, when given). Used before anything is signed or shown as "the" proposal: anyone can add
 * proposals to a Sputnik DAO, with any description. Browser-safe.
 */
interface FunctionCallKind {
  FunctionCall?: { receiver_id?: string; actions?: Array<{ method_name?: string; args?: string }> };
}

function decodeBase64Json(s: string): unknown {
  const bin = atob(s);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function isElivoFundingKind(
  kind: unknown,
  d: { usdc: string; escrow: string },
  batchHash?: string,
): boolean {
  const fc = (kind as FunctionCallKind | null)?.FunctionCall;
  if (!fc || fc.receiver_id !== d.usdc || fc.actions?.length !== 1) return false;
  const [a] = fc.actions;
  if (a.method_name !== "ft_transfer_call" || typeof a.args !== "string") return false;
  try {
    const args = decodeBase64Json(a.args) as { receiver_id?: string; msg?: string };
    if (args.receiver_id !== d.escrow) return false;
    const msg = JSON.parse(args.msg ?? "{}") as { kind?: string; batch_hash?: string };
    return msg.kind === "fund_batch" && (batchHash === undefined || msg.batch_hash === batchHash);
  } catch {
    return false;
  }
}
