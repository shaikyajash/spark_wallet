import { SparkReadonlyClient, getNetworkFromSparkAddress, isValidSparkAddress } from "@buildonspark/spark-sdk";

type SparkNetwork = "MAINNET" | "TESTNET" | "SIGNET" | "REGTEST" | "LOCAL";
const clients = new Map<string, SparkReadonlyClient>();

function getClient(network: string): SparkReadonlyClient {
  if (!clients.has(network)) {
    clients.set(network, SparkReadonlyClient.createPublic({ network: network as SparkNetwork }));
  }
  return clients.get(network)!;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const address = searchParams.get("address")?.trim();
    if (!address) return Response.json({ error: "address required" }, { status: 400 });
    if (!isValidSparkAddress(address)) return Response.json({ error: "Invalid Spark address" }, { status: 400 });

    const network = getNetworkFromSparkAddress(address);
    if (!network) return Response.json({ error: "Unknown network for address" }, { status: 400 });

    const client = getClient(network);
    const balance = await client.getAvailableBalance(address);
    return Response.json({ sats: String(balance), network });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
