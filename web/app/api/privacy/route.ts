import { getWallet } from "@/lib/wallet-store";

type WalletWithPrivacy = {
  getWalletSettings: () => Promise<unknown>;
  setPrivacyEnabled: (enabled: boolean) => Promise<unknown>;
};

export async function GET() {
  const wallet = getWallet() as unknown as WalletWithPrivacy | null;
  if (!wallet) return Response.json({ error: "Not connected" }, { status: 401 });
  try {
    const settings = await wallet.getWalletSettings();
    return Response.json({ settings });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const wallet = getWallet() as unknown as WalletWithPrivacy | null;
  if (!wallet) return Response.json({ error: "Not connected" }, { status: 401 });
  try {
    const { enabled } = await req.json();
    if (typeof enabled !== "boolean") {
      return Response.json({ error: "`enabled` boolean required" }, { status: 400 });
    }
    const settings = await wallet.setPrivacyEnabled(enabled);
    return Response.json({ settings });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
