export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const baseUrl = searchParams.get("baseUrl") ?? searchParams.get("orderbookUrl");
    if (!baseUrl) return Response.json({ error: "baseUrl required" }, { status: 400 });

    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/v2/liquidity`);
    if (!res.ok) return Response.json({ error: `Liquidity fetch failed: ${res.status}` }, { status: 502 });

    const data = await res.json();
    return Response.json(data);
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
