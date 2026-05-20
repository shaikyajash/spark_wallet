import crypto from "crypto";
import { isValidSparkAddress } from "@buildonspark/spark-sdk";

export async function POST(req: Request) {
  try {
    const { orderbookUrl, appId, from, to, amount, evmAddress, sparkAddress, destAddress, quote } = await req.json();
    if (!orderbookUrl || !from || !to || !amount || !destAddress || !quote)
      return Response.json({ error: "Missing required fields" }, { status: 400 });

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (appId) headers["garden-app-id"] = appId;

    // Generate secret
    const secretBytes = crypto.randomBytes(32);
    const secretHex = secretBytes.toString("hex");
    const secretHash = crypto.createHash("sha256").update(secretBytes).digest("hex");

    // Determine source owner based on source chain
    const fromChain = from.split(":")[0];
    const toChain = to.split(":")[0];
    const isSparkSource = fromChain.startsWith("spark");
    const isSparkDest = toChain.startsWith("spark");
    if (isSparkSource) {
      if (!sparkAddress) return Response.json({ error: "Spark address required for Spark source" }, { status: 400 });
      if (!isValidSparkAddress(sparkAddress)) return Response.json({ error: "Invalid Spark address format" }, { status: 400 });
    }
    if (isSparkDest) {
      if (!destAddress) return Response.json({ error: "Spark address required for Spark destination" }, { status: 400 });
      if (!isValidSparkAddress(destAddress)) return Response.json({ error: "Invalid Spark address format" }, { status: 400 });
    }
    const sourceOwner = isSparkSource ? sparkAddress : evmAddress;

    const orderBody = {
      source: {
        asset: from,
        owner: sourceOwner,
        amount: String(amount),
      },
      destination: {
        asset: to,
        owner: destAddress,
        amount: String(quote.destination.amount),
      },
      solver_id: quote.solver_id,
    };

    const createRes = await fetch(`${orderbookUrl}/v2/orders`, {
      method: "POST",
      headers,
      body: JSON.stringify(orderBody),
    });
    const createText = await createRes.text();
    let createData: Record<string, unknown> = {};
    try { createData = JSON.parse(createText); } catch { /* ignore */ }
    if (!createRes.ok) return Response.json({ error: (createData.error ?? createText) || `HTTP ${createRes.status}` }, { status: createRes.status });

    return Response.json({ order: createData.result ?? createData, secretHex, secretHash });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
