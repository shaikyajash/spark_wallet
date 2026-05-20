export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const orderbookUrl = searchParams.get("orderbookUrl");
  const orderId = searchParams.get("orderId");
  const appId = searchParams.get("appId");
  if (!orderbookUrl || !orderId)
    return Response.json({ error: "orderbookUrl and orderId required" }, { status: 400 });

  const headers: Record<string, string> = {};
  if (appId) headers["garden-app-id"] = appId;

  try {
    const res = await fetch(`${orderbookUrl}/v2/orders/${orderId}`, { headers });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(text); } catch { /* ignore */ }
    if (!res.ok) return Response.json({ error: ((data.error as string) ?? text) || `HTTP ${res.status}` }, { status: res.status });
    return Response.json(data.result ?? data);
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
