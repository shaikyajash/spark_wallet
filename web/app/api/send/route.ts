import { getWallet } from "@/lib/wallet-store";

export async function POST(req: Request) {
  const wallet = getWallet();
  if (!wallet) return Response.json({ error: "Not connected" }, { status: 401 });
  try {
    const { to, sats } = await req.json();
    if (!to || !sats) return Response.json({ error: "Missing to or sats" }, { status: 400 });
    const result = await wallet.transfer({ receiverSparkAddress: to.trim(), amountSats: Number(sats) });
    return Response.json({ txId: (result as unknown as Record<string, unknown>).id ?? "ok" });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
