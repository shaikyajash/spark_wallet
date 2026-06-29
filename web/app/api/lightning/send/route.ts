import { SparkWallet } from "@buildonspark/spark-sdk";
import { getSession, getWalletSeed } from "@/lib/session";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not connected" }, { status: 401 });

  try {
    const { invoice, amountSats } = await req.json();
    if (!invoice) return Response.json({ error: "Missing invoice" }, { status: 400 });

    const { wallet } = await SparkWallet.initialize({
      mnemonicOrSeed: getWalletSeed(session),
      options: { network: session.network as "MAINNET" | "REGTEST" | "TESTNET" | "SIGNET" | "LOCAL" },
    });

    const result = await wallet.payLightningInvoice({
      invoice: String(invoice).trim(),
      maxFeeSats: 1000,
      ...(amountSats ? { amountSatsToSend: Number(amountSats) } : {}),
    });

    const r = result as unknown as Record<string, unknown>;
    return Response.json({ id: String(r.id ?? ""), status: String(r.status ?? "PENDING") });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
