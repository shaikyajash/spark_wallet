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

    const request = await wallet.requestLightningSend({
      encodedInvoice: String(invoice).trim(),
      ...(amountSats ? { amountSats: Number(amountSats) } : {}),
    });

    if (!request) return Response.json({ error: "No response from Spark" }, { status: 500 });

    return Response.json({ id: request.id, status: request.status });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
