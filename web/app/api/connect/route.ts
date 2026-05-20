import { SparkWallet } from "@buildonspark/spark-sdk";
import { setSession } from "@/lib/session";

export async function POST(req: Request) {
  try {
    const { mnemonic, network } = await req.json();
    if (!mnemonic) return Response.json({ error: "Mnemonic required" }, { status: 400 });
    const net = (network || "REGTEST").toUpperCase();
    const { wallet } = await SparkWallet.initialize({ mnemonicOrSeed: mnemonic.trim(), options: { network: net } });
    const address = await wallet.getSparkAddress();
    await setSession(mnemonic.trim(), address, net);
    return Response.json({ address, network: net });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
