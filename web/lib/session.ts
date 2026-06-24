import { cookies } from "next/headers";

const SESSION_NAME = "spark_session";
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface SessionData {
  mnemonic: string;
  seedType?: "mnemonic" | "privateKey";
  address: string;
  network: string;
  timestamp: number;
}

export function getWalletSeed(session: SessionData): string | Buffer {
  if (session.seedType === "privateKey") return Buffer.from(session.mnemonic, "hex");
  return session.mnemonic;
}

export async function setSession(mnemonic: string, address: string, network: string, seedType: "mnemonic" | "privateKey" = "mnemonic") {
  const cookieStore = await cookies();
  const data: SessionData = {
    mnemonic,
    seedType,
    address,
    network,
    timestamp: Date.now(),
  };

  cookieStore.set(SESSION_NAME, JSON.stringify(data), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL / 1000,
    path: "/",
  });
}

export async function getSession(): Promise<SessionData | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_NAME);

  if (!sessionCookie?.value) return null;

  try {
    const data = JSON.parse(sessionCookie.value) as SessionData;
    if (Date.now() - data.timestamp > SESSION_TTL) {
      await clearSession();
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_NAME);
}
