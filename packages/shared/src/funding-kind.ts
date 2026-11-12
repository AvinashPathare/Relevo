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

interface FundMsg {
  kind?: string;
  batch_hash?: string;
  router_id?: string;
  oracle_pk?: string;
}

/** The fund_batch msg inside this app's funding proposal, or null when `kind` is anything else. */
function fundMsgOf(kind: unknown, d: { usdc: string; escrow: string }): FundMsg | null {
  const fc = (kind as FunctionCallKind | null)?.FunctionCall;
  if (!fc || fc.receiver_id !== d.usdc || fc.actions?.length !== 1) return null;
  const [a] = fc.actions;
  if (a.method_name !== "ft_transfer_call" || typeof a.args !== "string") return null;
  try {
    const args = decodeBase64Json(a.args) as { receiver_id?: string; msg?: string };
    if (args.receiver_id !== d.escrow) return null;
    const msg = JSON.parse(args.msg ?? "{}") as FundMsg;
    return msg.kind === "fund_batch" ? msg : null;
  } catch {
    return null;
  }
}

export function isElivoFundingKind(
  kind: unknown,
  d: { usdc: string; escrow: string },
  batchHash?: string,
): boolean {
  const msg = fundMsgOf(kind, d);
  return msg !== null && (batchHash === undefined || msg.batch_hash === batchHash);
}

/**
 * The escrow refuses funding whose router or oracle key differs from its live config, so voting on such
 * a proposal can only end in "approved, never funded". Returns the first field that differs ("kind" when
 * this is not a funding proposal at all), or null when the proposal would be accepted.
 */
export function fundingConfigMismatch(
  kind: unknown,
  d: { usdc: string; escrow: string },
  live: { router_id: string; oracle_pk: string },
): "kind" | "router_id" | "oracle_pk" | null {
  const msg = fundMsgOf(kind, d);
  if (!msg) return "kind";
  if (msg.router_id !== live.router_id) return "router_id";
  if (msg.oracle_pk !== live.oracle_pk) return "oracle_pk";
  return null;
}
