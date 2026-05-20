import { ethers } from "ethers";

interface EvmTxData {
  to: string;
  data: string;
  gas_limit: string;
  value: string;
  chain_id?: string | number;
}

async function sendTx(signer: ethers.Wallet, provider: ethers.JsonRpcProvider, tx: EvmTxData): Promise<string> {
  let chainId: bigint | undefined;
  if (tx.chain_id != null) {
    const raw = String(tx.chain_id);
    chainId = raw.startsWith("0x") ? BigInt(raw) : BigInt(raw);
  }
  if (!chainId) chainId = (await provider.getNetwork()).chainId;

  const sent = await signer.sendTransaction({
    to: tx.to,
    data: tx.data,
    gasLimit: tx.gas_limit ? BigInt(tx.gas_limit) : undefined,
    value: tx.value && tx.value !== "0" ? BigInt(tx.value) : 0n,
    chainId,
  });
  await sent.wait(1);
  return sent.hash;
}

export async function POST(req: Request) {
  try {
    const { privateKey, rpcUrl, order } = await req.json();
    if (!privateKey || !rpcUrl || !order)
      return Response.json({ error: "privateKey, rpcUrl, order required" }, { status: 400 });

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const pk = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
    const signer = new ethers.Wallet(pk, provider);
    const logs: string[] = [];

    if (order.approval_transaction) {
      const hash = await sendTx(signer, provider, order.approval_transaction);
      logs.push(`Approve tx: ${hash}`);
    }

    if (order.initiate_transaction) {
      const hash = await sendTx(signer, provider, order.initiate_transaction);
      logs.push(`Initiate tx: ${hash}`);
    }

    if (logs.length === 0)
      return Response.json({ error: "No EVM transactions in order response" }, { status: 400 });

    return Response.json({ logs });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
