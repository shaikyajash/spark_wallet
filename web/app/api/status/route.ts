import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  return Response.json({
    connected: session !== null,
    address: session?.address ?? null,
    network: session?.network ?? null,
  });
}
