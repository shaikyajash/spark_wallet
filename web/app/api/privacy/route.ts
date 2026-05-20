import { SparkWallet } from "@buildonspark/spark-sdk";
import { getSession } from "@/lib/session";

type WalletWithPrivacy = {
  getWalletSettings: () => Promise<unknown>;
  setPrivacyEnabled: (enabled: boolean) => Promise<unknown>;
};

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not connected" }, { status: 401 });

  try {
    const { wallet } = await SparkWallet.initialize({
      mnemonicOrSeed: session.mnemonic,
      options: { network: session.network as "MAINNET" | "REGTEST" | "TESTNET" | "SIGNET" | "LOCAL" },
    });
    const w = wallet as unknown as WalletWithPrivacy;
    const settings = await w.getWalletSettings();
    return Response.json({ settings });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not connected" }, { status: 401 });

  try {
    const { enabled } = await req.json();
    if (typeof enabled !== "boolean") {
      return Response.json({ error: "`enabled` boolean required" }, { status: 400 });
    }
    const { wallet } = await SparkWallet.initialize({
      mnemonicOrSeed: session.mnemonic,
      options: { network: session.network as "MAINNET" | "REGTEST" | "TESTNET" | "SIGNET" | "LOCAL" },
    });
    const w = wallet as unknown as WalletWithPrivacy;
    const settings = await w.setPrivacyEnabled(enabled);
    return Response.json({ settings });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
