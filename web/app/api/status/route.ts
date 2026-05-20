import { getStatus } from "@/lib/wallet-store";

export async function GET() {
  return Response.json(getStatus());
}
