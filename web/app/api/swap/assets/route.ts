export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const baseUrl = searchParams.get("baseUrl");
    if (!baseUrl) return Response.json({ error: "baseUrl required" }, { status: 400 });

    const res = await fetch(`${baseUrl}/v2/chains`);
    if (!res.ok) return Response.json({ error: `Chains fetch failed: ${res.status}` }, { status: 502 });

    const data = await res.json();
    const chains: { chain: string; assets: { id: string; min_amount: string; decimals: number }[] }[] = data.result ?? data;

    const assets: { id: string; chain: string; minAmount: string; decimals: number }[] = [];
    for (const chain of chains) {
      for (const asset of chain.assets ?? []) {
        assets.push({ id: asset.id, chain: chain.chain, minAmount: asset.min_amount, decimals: asset.decimals });
      }
    }
    return Response.json({ assets });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
