/**
 * /rpc: forwards read-only view calls on this app's escrow to the NEAR RPC. Anything else (other
 * contracts, transactions, sandbox_* state patches, other queries) is refused, so a public site is not
 * an open RPC proxy.
 */
import { deployment, rpcUrl } from "../../lib/deployment.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const target = rpcUrl();
  let body: { method?: unknown; params?: { request_type?: unknown; account_id?: unknown } };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }
  if (body?.method !== "query" || body.params?.request_type !== "call_function")
    return Response.json({ error: "only contract view calls are allowed" }, { status: 403 });
  if (body.params.account_id !== deployment().escrow)
    return Response.json({ error: "only this app's escrow can be read" }, { status: 403 });
  const r = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
