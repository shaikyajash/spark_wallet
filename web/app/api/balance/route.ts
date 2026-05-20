import { SparkWallet } from "@buildonspark/spark-sdk";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not connected" }, { status: 401 });

  try {
    const { wallet } = await SparkWallet.initialize({
      mnemonicOrSeed: session.mnemonic,
      options: { network: session.network as "MAINNET" | "REGTEST" | "TESTNET" | "SIGNET" | "LOCAL" },
    });
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
