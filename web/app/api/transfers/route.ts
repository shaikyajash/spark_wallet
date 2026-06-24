import { SparkWallet } from "@buildonspark/spark-sdk";
import { getSession, getWalletSeed } from "@/lib/session";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not connected" }, { status: 401 });

  try {
    const { wallet } = await SparkWallet.initialize({
      mnemonicOrSeed: getWalletSeed(session),
      options: { network: session.network as "MAINNET" | "REGTEST" | "TESTNET" | "SIGNET" | "LOCAL" },
    });
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get("limit") ?? 20);
    const offset = Number(searchParams.get("offset") ?? 0);
    const result = await wallet.getTransfers(limit, offset) as {
      transfers: { id: string; transferDirection: string; type: string; status: string; totalValue: number; createdTime: Date | null }[];
      offset: number;
    };
    const transfers = result.transfers.map((t) => ({
      id: t.id,
      direction: t.transferDirection,
      type: t.type,
      status: t.status,
      sats: t.totalValue,
      createdAt: t.createdTime ? t.createdTime.toISOString() : null,
    }));
    return Response.json({ transfers, offset: result.offset });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
