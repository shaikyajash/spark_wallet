import { getWallet } from "@/lib/wallet-store";

export async function GET() {
  const wallet = getWallet();
  if (!wallet) return Response.json({ error: "Not connected" }, { status: 401 });
  try {
    const { satsBalance } = await wallet.getBalance();
    return Response.json({
      sats: String(satsBalance.available),
      owned: String(satsBalance.owned),
      incoming: String(satsBalance.incoming),
    });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
