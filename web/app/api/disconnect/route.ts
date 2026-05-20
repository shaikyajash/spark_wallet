import { clearWallet } from "@/lib/wallet-store";

export async function POST() {
  clearWallet();
  return Response.json({ ok: true });
}
