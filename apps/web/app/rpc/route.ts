/**
 * /rpc: forwards read-only contract view calls to the NEAR RPC. Anything else (transactions,
 * sandbox_* state patches, other queries) is refused, so the web server is not an open RPC proxy.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const target = process.env.NEAR_RPC_URL;
  if (!target) return Response.json({ error: "rpc not configured" }, { status: 503 });
  let body: { method?: unknown; params?: { request_type?: unknown } };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }
  if (body?.method !== "query" || body.params?.request_type !== "call_function")
    return Response.json({ error: "only contract view calls are allowed" }, { status: 403 });
  const r = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
