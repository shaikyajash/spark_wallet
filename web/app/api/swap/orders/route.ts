export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const orderbookUrl = searchParams.get("orderbookUrl");
    const appId = searchParams.get("appId") ?? "";
    const page = searchParams.get("page") ?? "1";
    const perPage = searchParams.get("perPage") ?? searchParams.get("per_page") ?? "20";
    const fromChain = searchParams.get("fromChain") ?? searchParams.get("from_chain") ?? "";
    const toChain = searchParams.get("toChain") ?? searchParams.get("to_chain") ?? "";
    const status = searchParams.get("status") ?? "";

    if (!orderbookUrl) {
      return Response.json({ error: "orderbookUrl required" }, { status: 400 });
    }

    const cleanBase = orderbookUrl.replace(/\/+$/, "");
    const upstreamParams = new URLSearchParams({ page, per_page: perPage });
    if (fromChain) upstreamParams.set("from_chain", fromChain);
    if (toChain) upstreamParams.set("to_chain", toChain);
    if (status) upstreamParams.set("status", status);

    const headers: Record<string, string> = {};
    if (appId) headers["garden-app-id"] = appId;

    const res = await fetch(`${cleanBase}/v2/orders?${upstreamParams.toString()}`, { headers });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text);
    } catch {
      return Response.json({ error: text || "Invalid response from orderbook" }, { status: 502 });
    }

    if (!res.ok) {
      return Response.json({ error: (data.error as string) ?? `HTTP ${res.status}` }, { status: res.status });
    }

    return Response.json(data.result ?? data);
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
