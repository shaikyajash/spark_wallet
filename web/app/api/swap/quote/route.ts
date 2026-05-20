export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const baseUrl = searchParams.get("baseUrl");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const amount = searchParams.get("amount");
    const appId = searchParams.get("appId") ?? "";

    if (!baseUrl || !from || !to || !amount)
      return Response.json({ error: "baseUrl, from, to, amount required" }, { status: 400 });

    const url = `${baseUrl}/v2/quote?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&from_amount=${amount}&indicative=false`;
    const res = await fetch(url, { headers: appId ? { "garden-app-id": appId } : {} });
    const data = await res.json();
    if (!res.ok) return Response.json({ error: data.error ?? `HTTP ${res.status}` }, { status: res.status });
    return Response.json(data);
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
