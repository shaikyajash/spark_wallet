import { SparkWallet } from "@buildonspark/spark-sdk";
import { getSession } from "@/lib/session";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not connected" }, { status: 401 });

  try {
    const { preimage } = await req.json();
    if (!preimage) return Response.json({ error: "Missing preimage" }, { status: 400 });

    const { wallet } = await SparkWallet.initialize({
      mnemonicOrSeed: session.mnemonic,
      options: { network: session.network as "MAINNET" | "REGTEST" | "TESTNET" | "SIGNET" | "LOCAL" },
    });

    const result = await wallet.claimHTLC(preimage.trim());
    const r = result as unknown as Record<string, unknown>;
    return Response.json({ id: r.id, status: r.status });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
