/** Minimal NEAR JSON-RPC view client over fetch (browser and Node). Defaults to the /rpc rewrite. */
export interface ViewOptions {
  rpcUrl?: string;
  fetch?: typeof fetch;
}

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function viewCall<T>(
  contractId: string,
  method: string,
  args: object = {},
  opts: ViewOptions = {},
): Promise<T> {
  const f = opts.fetch ?? fetch;
  const res = await f(opts.rpcUrl ?? "/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "elivo",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contractId,
        method_name: method,
        args_base64: toBase64(JSON.stringify(args)),
      },
    }),
  });
  const body = (await res.json().catch(() => null)) as {
    error?: { data?: unknown; message?: string; cause?: unknown };
    result?: { result?: number[]; error?: string };
  } | null;
  if (!body) throw new Error(`view ${method}: HTTP ${res.status}`);
  if (body.error) {
    const detail = body.error.data ?? body.error.message ?? body.error.cause;
    throw new Error(`view ${method}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  if (body.result?.error) throw new Error(`view ${method}: ${body.result.error}`);
  const raw = new TextDecoder().decode(new Uint8Array(body.result?.result ?? []));
  return JSON.parse(raw) as T;
}
