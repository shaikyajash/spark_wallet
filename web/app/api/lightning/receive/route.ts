import { SparkWallet } from "@buildonspark/spark-sdk";
import { getSession, getWalletSeed } from "@/lib/session";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not connected" }, { status: 401 });

  try {
    const { amountSats, memo } = await req.json();
    if (!amountSats || Number(amountSats) <= 0)
      return Response.json({ error: "amountSats must be a positive integer" }, { status: 400 });

    const { wallet } = await SparkWallet.initialize({
      mnemonicOrSeed: getWalletSeed(session),
      options: { network: session.network as "MAINNET" | "REGTEST" | "TESTNET" | "SIGNET" | "LOCAL" },
    });

    const request = await wallet.createLightningInvoice({
      amountSats: Number(amountSats),
      ...(memo ? { memo: String(memo) } : {}),
    });

    return Response.json({
      id:      request.id,
      invoice: request.invoice.encodedInvoice,
      status:  request.status,
    });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
