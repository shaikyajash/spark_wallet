import { SparkWallet } from "@buildonspark/spark-sdk";
import { getSession } from "@/lib/session";

const balanceCache = new Map<string, { sats: string; owned: string; incoming: string; timestamp: number }>();
const CACHE_TTL = 2000; // 2 second cache to smooth out fluctuations

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not connected" }, { status: 401 });

  const cacheKey = session.address;
  const cached = balanceCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return Response.json(cached);
  }

  try {
    const { wallet } = await SparkWallet.initialize({
      mnemonicOrSeed: session.mnemonic,
      options: { network: session.network as "MAINNET" | "REGTEST" | "TESTNET" | "SIGNET" | "LOCAL" },
    });
    const { satsBalance } = await wallet.getBalance();
    const result = {
      sats: String(satsBalance.available),
      owned: String(satsBalance.owned),
      incoming: String(satsBalance.incoming),
      timestamp: Date.now(),
    };
    balanceCache.set(cacheKey, result);
    return Response.json(result);
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
