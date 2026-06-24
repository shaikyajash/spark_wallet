import { SparkWallet } from "@buildonspark/spark-sdk";
import { getSession, getWalletSeed } from "@/lib/session";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not connected" }, { status: 401 });

  try {
    const { to, sats } = await req.json();
    if (!to || !sats) return Response.json({ error: "Missing to or sats" }, { status: 400 });

    const { wallet } = await SparkWallet.initialize({
      mnemonicOrSeed: getWalletSeed(session),
      options: { network: session.network as "MAINNET" | "REGTEST" | "TESTNET" | "SIGNET" | "LOCAL" },
    });
    const result = await wallet.transfer({ receiverSparkAddress: to.trim(), amountSats: Number(sats) });
    return Response.json({ txId: (result as unknown as Record<string, unknown>).id ?? "ok" });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
