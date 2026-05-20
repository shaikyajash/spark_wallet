export async function GET() {
  return Response.json({
    sparkOwner: process.env.SPARK_OWNER || "",
    evmRpcUrl: process.env.EVM_RPC_URL || "",
  });
}
