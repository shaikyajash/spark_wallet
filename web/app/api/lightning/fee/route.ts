import { SparkWallet } from "@buildonspark/spark-sdk";
import { getSession, getWalletSeed } from "@/lib/session";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not connected" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const invoice    = searchParams.get("invoice")?.trim();
  const amountSats = searchParams.get("amountSats");

  if (!invoice) return Response.json({ error: "Missing invoice" }, { status: 400 });

  try {
    const { wallet } = await SparkWallet.initialize({
      mnemonicOrSeed: getWalletSeed(session),
      options: { network: session.network as "MAINNET" | "REGTEST" | "TESTNET" | "SIGNET" | "LOCAL" },
    });

    const estimate = await wallet.getLightningSendFeeEstimate(
      invoice,
      amountSats ? Number(amountSats) : undefined,
    );

    const raw = estimate as unknown as Record<string, unknown> | null;
    const feeSats = raw
      ? String(raw.feeSats ?? raw.feeEstimate ?? raw.fee ?? 0)
      : "0";

    return Response.json({ feeSats });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
