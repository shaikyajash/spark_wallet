import { SparkWallet } from "@buildonspark/spark-sdk";
import { getSession } from "@/lib/session";

// PreimageRequestRole enum values from proto (not re-exported by the SDK package)
const ROLE_RECEIVER = 0;
const ROLE_SENDER   = 1;

function bytesToHex(b: Uint8Array) {
  return Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");
}

type PreimageReq = {
  paymentHash: Uint8Array;
  status: number;
  createdTime: unknown;
  transfer?: { id?: string; totalValue?: number };
};

export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not connected" }, { status: 401 });

  try {
    const { wallet } = await SparkWallet.initialize({
      mnemonicOrSeed: session.mnemonic,
      options: { network: session.network as "MAINNET" | "REGTEST" | "TESTNET" | "SIGNET" | "LOCAL" },
    });

    const [incoming, outgoing] = await Promise.all([
      wallet.queryHTLC({ matchRole: ROLE_RECEIVER as never }),
      wallet.queryHTLC({ matchRole: ROLE_SENDER   as never }),
    ]);

    const mapReq = (r: PreimageReq) => ({
      paymentHash: r.paymentHash instanceof Uint8Array ? bytesToHex(r.paymentHash) : r.paymentHash,
      status:      r.status,
      createdTime: r.createdTime,
      transferId:  r.transfer?.id,
      amountSats:  r.transfer?.totalValue,
    });

    return Response.json({
      incoming: (incoming.preimageRequests as PreimageReq[]).map(mapReq),
      outgoing: (outgoing.preimageRequests as PreimageReq[]).map(mapReq),
    });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Not connected" }, { status: 401 });

  try {
    const { receiverSparkAddress, amountSats, preimage, expiryMinutes } = await req.json();
    if (!receiverSparkAddress || !amountSats)
      return Response.json({ error: "Missing receiverSparkAddress or amountSats" }, { status: 400 });

    const { wallet } = await SparkWallet.initialize({
      mnemonicOrSeed: session.mnemonic,
      options: { network: session.network as "MAINNET" | "REGTEST" | "TESTNET" | "SIGNET" | "LOCAL" },
    });

    const expiryTime = new Date(Date.now() + (Number(expiryMinutes) || 60) * 60 * 1000);

    const result = await wallet.createHTLC({
      receiverSparkAddress: receiverSparkAddress.trim(),
      amountSats: Number(amountSats),
      ...(preimage ? { preimage } : {}),
      expiryTime,
    });

    const r = result as unknown as Record<string, unknown>;
    return Response.json({ id: r.id, status: r.status, result: r });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
