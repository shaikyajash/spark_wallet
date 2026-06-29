import { SparkWallet } from "@buildonspark/spark-sdk";
import { getSession, getWalletSeed } from "@/lib/session";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not connected" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const invoice = searchParams.get("invoice")?.trim();

  if (!invoice) return Response.json({ error: "Missing invoice" }, { status: 400 });

  try {
    const { wallet } = await SparkWallet.initialize({
      mnemonicOrSeed: getWalletSeed(session),
      options: { network: session.network as "MAINNET" | "REGTEST" | "TESTNET" | "SIGNET" | "LOCAL" },
    });

    const feeSats = await wallet.getLightningSendFeeEstimate({ encodedInvoice: invoice });

    return Response.json({ feeSats: String(feeSats ?? 0) });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
