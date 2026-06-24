import { SparkWallet } from "@buildonspark/spark-sdk";
import { setSession } from "@/lib/session";

export async function POST(req: Request) {
  try {
    const { mnemonic, privateKey, network } = await req.json();
    const net = (network || "REGTEST").toUpperCase();

    let mnemonicOrSeed: string | Buffer;
    let seedType: "mnemonic" | "privateKey";

    if (privateKey) {
      if (!/^[0-9a-fA-F]{64}$/.test(privateKey.trim()))
        return Response.json({ error: "Private key must be exactly 64 hex characters." }, { status: 400 });
      mnemonicOrSeed = Buffer.from(privateKey.trim(), "hex");
      seedType = "privateKey";
    } else if (mnemonic) {
      mnemonicOrSeed = mnemonic.trim();
      seedType = "mnemonic";
    } else {
      return Response.json({ error: "Mnemonic or private key required" }, { status: 400 });
    }

    const { wallet } = await SparkWallet.initialize({ mnemonicOrSeed, options: { network: net } });
    const address = await wallet.getSparkAddress();
    await setSession(privateKey ? privateKey.trim() : mnemonic.trim(), address, net, seedType);
    return Response.json({ address, network: net });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
