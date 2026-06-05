"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { Status } from "./ui";

interface Transfer {
  id: string;
  direction: string;
  sats: number;
  createdAt: string | null;
}

const TX_PAGE = 5;

async function api(path: string, opts?: RequestInit, retries = 2) {
  let lastError: Error | null = null;

  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(path, opts);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      return data;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (i < retries) {
        await new Promise(r => setTimeout(r, 100 * (i + 1)));
        continue;
      }
    }
  }

  throw lastError;
}

export default function WalletTab() {
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [network, setNetwork] = useState("REGTEST");
  const [connectStatus, setConnectStatus] = useState({ msg: "", type: "" as "" | "ok" | "err" | "info" });
  const [connectLoading, setConnectLoading] = useState(false);

  const [balanceSats, setBalanceSats] = useState<bigint | null>(null);
  const [balanceStatus, setBalanceStatus] = useState({ msg: "", type: "" as "" | "ok" | "err" | "info" });

  const [sendTo, setSendTo] = useState("");
  const [sendSats, setSendSats] = useState("");
  const [sendStatus, setSendStatus] = useState({ msg: "", type: "" as "" | "ok" | "err" | "info" });
  const [sendLoading, setSendLoading] = useState(false);

  const [checkAddr, setCheckAddr] = useState("");
  const [checkResult, setCheckResult] = useState<{ sats: bigint; btc: string; network: string } | null>(null);
  const [checkStatus, setCheckStatus] = useState({ msg: "", type: "" as "" | "ok" | "err" | "info" });
  const [checkLoading, setCheckLoading] = useState(false);

  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [txPage, setTxPage] = useState(0);
  const [txOffsets, setTxOffsets] = useState<number[]>([0]);
  const [txHasNext, setTxHasNext] = useState(false);
  const [txStatus, setTxStatus] = useState({ msg: "", type: "" as "" | "ok" | "err" | "info" });

  const [privacyEnabled, setPrivacyEnabled] = useState<boolean | null>(null);
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [privacyStatus, setPrivacyStatus] = useState({ msg: "", type: "" as "" | "ok" | "err" | "info" });

  // HTLC creation
  const [htlcTo, setHtlcTo] = useState("");
  const [htlcSats, setHtlcSats] = useState("");
  const [htlcPreimage, setHtlcPreimage] = useState("");
  const [htlcSecretHash, setHtlcSecretHash] = useState("");
  const [htlcExpiry, setHtlcExpiry] = useState("60");
  const [htlcLoading, setHtlcLoading] = useState(false);
  const [htlcStatus, setHtlcStatus] = useState({ msg: "", type: "" as "" | "ok" | "err" | "info" });
  const [htlcResult, setHtlcResult] = useState<{ id: string; result: Record<string, unknown> } | null>(null);

  // HTLC inbox
  type HtlcEntry = { paymentHash: string; status: number; amountSats: number; transferId: string; createdTime: unknown };
  const [htlcIncoming, setHtlcIncoming] = useState<HtlcEntry[]>([]);
  const [htlcOutgoing, setHtlcOutgoing] = useState<HtlcEntry[]>([]);
  const [htlcInboxLoading, setHtlcInboxLoading] = useState(false);
  const [htlcInboxStatus, setHtlcInboxStatus] = useState({ msg: "", type: "" as "" | "ok" | "err" | "info" });
  const [claimInputs, setClaimInputs] = useState<Record<string, string>>({});
  const [claimLoading, setClaimLoading] = useState<Record<string, boolean>>({});
  const [claimStatus, setClaimStatus] = useState<Record<string, { msg: string; type: "" | "ok" | "err" | "info" }>>({});

  const [copyMsg, setCopyMsg] = useState("");
  const refreshInFlight = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load Spark address from environment on mount
  useEffect(() => {
    (async () => {
      try {
        const config = await api("/api/config", {}, 0);
        if (config?.sparkOwner) {
          setCheckAddr(config.sparkOwner);
        }
      } catch (e) {
        console.error("Failed to load config:", e);
      }
    })();
  }, []);

  const refreshBalance = useCallback(async (silent = false) => {
    if (!silent) setBalanceStatus({ msg: "Fetching balance…", type: "info" });
    try {
      const data = await api("/api/balance");
      const sats = BigInt(data.sats);
      setBalanceSats(sats);
      if (!silent) setBalanceStatus({ msg: "Updated just now.", type: "ok" });
    } catch (e: unknown) {
      setBalanceStatus({ msg: `Error: ${e instanceof Error ? e.message : String(e)}`, type: "err" });
    }
  }, []);

  const loadTx = useCallback(async ({ page = 0, offsets = txOffsets, silent = false }: { page?: number; offsets?: number[]; silent?: boolean } = {}) => {
    const offset = offsets[page] ?? 0;
    if (!silent) setTxStatus({ msg: "Loading…", type: "info" });
    try {
      const data = await api(`/api/transfers?limit=${TX_PAGE}&offset=${offset}`);
      setTransfers(data.transfers ?? []);
      setTxPage(page);
      const newOffsets = [...offsets];
      newOffsets[page + 1] = data.offset;
      setTxOffsets(newOffsets);
      setTxHasNext((data.transfers ?? []).length === TX_PAGE);
      if (!silent) setTxStatus({ msg: "", type: "" });
    } catch (e: unknown) {
      setTxStatus({ msg: `Error: ${e instanceof Error ? e.message : String(e)}`, type: "err" });
    }
  }, [txOffsets]);

  const startAutoRefresh = useCallback((addr: string) => {
    try {
      setAddress(addr);
      setConnected(true);
      if (timerRef.current) clearInterval(timerRef.current);

      Promise.resolve()
        .then(() => refreshBalance(false))
        .catch(e => console.error("Initial balance refresh failed:", e));

      Promise.resolve()
        .then(() => loadTx({ page: 0, offsets: [0], silent: false }))
        .catch(e => console.error("Initial tx load failed:", e));

      timerRef.current = setInterval(async () => {
        if (refreshInFlight.current) return;
        refreshInFlight.current = true;
        try {
          const status = await api("/api/status", {}, 0);
          if (!status?.connected) {
            setConnected(false);
            setAddress("");
            if (timerRef.current) clearInterval(timerRef.current);
            return;
          }
          await Promise.all([
            refreshBalance(true).catch(e => console.error("Refresh failed:", e)),
            loadTx({ page: txPage, offsets: txOffsets, silent: true }).catch(e => console.error("Load tx failed:", e))
          ]);
        } catch (e) {
          console.error("Auto-refresh error:", e);
        } finally {
          refreshInFlight.current = false;
        }
      }, 5000);
    } catch (e) {
      console.error("startAutoRefresh error:", e);
      setConnectStatus({ msg: `Failed to start refresh: ${e instanceof Error ? e.message : String(e)}`, type: "err" });
    }
  }, [refreshBalance, loadTx, txPage, txOffsets, setConnectStatus]);

  // Check existing session on mount
  useEffect(() => {
    (async () => {
      try {
        const data = await api("/api/status", {}, 0);
        if (data?.connected && data?.address) {
          if (data.network) setNetwork(data.network);
          startAutoRefresh(data.address);
        }
      } catch (e) {
        console.error("Status check failed:", e);
      }
    })();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function connect() {
    if (!mnemonic.trim()) return setConnectStatus({ msg: "Enter your mnemonic.", type: "err" });
    setConnectLoading(true);
    setConnectStatus({ msg: "Connecting to Spark network…", type: "info" });
    try {
      const data = await api("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mnemonic: mnemonic.trim(), network }),
      });
      if (!data?.address) {
        throw new Error("No address received from server");
      }
      startAutoRefresh(data.address);
    } catch (e: unknown) {
      console.error("Connect failed:", e);
      setConnectLoading(false);
      setConnectStatus({ msg: `Error: ${e instanceof Error ? e.message : String(e)}`, type: "err" });
    }
  }

  const refreshPrivacy = useCallback(async () => {
    try {
      const data = await api("/api/privacy");
      const s = data.settings as { privateEnabled?: boolean } | undefined;
      if (typeof s?.privateEnabled === "boolean") setPrivacyEnabled(s.privateEnabled);
      else setPrivacyEnabled(true); // default — allow button to be clickable even if SE returns nothing
    } catch {
      setPrivacyEnabled(true);
    }
  }, []);

  useEffect(() => {
    if (connected) refreshPrivacy();
  }, [connected, refreshPrivacy]);

  async function togglePrivacy() {
    const next = !(privacyEnabled ?? true);
    setPrivacyLoading(true);
    setPrivacyStatus({ msg: next ? "Enabling privacy…" : "Making wallet public…", type: "info" });
    try {
      const data = await api("/api/privacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const s = data.settings as { privateEnabled?: boolean } | undefined;
      const enabled = typeof s?.privateEnabled === "boolean" ? s.privateEnabled : next;
      setPrivacyEnabled(enabled);
      setPrivacyStatus({ msg: enabled ? "Privacy enabled." : "Wallet is now public.", type: "ok" });
    } catch (e: unknown) {
      setPrivacyStatus({ msg: `Error: ${e instanceof Error ? e.message : String(e)}`, type: "err" });
    } finally {
      setPrivacyLoading(false);
    }
  }

  async function switchNetwork(next: string) {
    if (next === network) return;
    if (!mnemonic.trim()) {
      // Mnemonic was cleared (e.g. after a prior disconnect). Force a clean re-auth.
      await disconnect();
      setNetwork(next);
      return;
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setConnectLoading(true);
    setBalanceSats(null);
    setTransfers([]);
    setBalanceStatus({ msg: `Switching to ${next}…`, type: "info" });
    try {
      const data = await api("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mnemonic: mnemonic.trim(), network: next }),
      });
      setNetwork(next);
      setBalanceStatus({ msg: "", type: "" });
      startAutoRefresh(data.address);
    } catch (e: unknown) {
      setBalanceStatus({ msg: `Switch failed: ${e instanceof Error ? e.message : String(e)}`, type: "err" });
    } finally {
      setConnectLoading(false);
    }
  }

  async function send() {
    if (!sendTo.trim()) return setSendStatus({ msg: "Enter a recipient address.", type: "err" });
    if (!sendSats.trim() || !/^\d+$/.test(sendSats)) return setSendStatus({ msg: "Enter a valid amount in sats.", type: "err" });
    const amount = BigInt(sendSats);
    if (amount <= 0n) return setSendStatus({ msg: "Amount must be > 0.", type: "err" });
    if (balanceSats !== null && amount > balanceSats)
      return setSendStatus({ msg: `Insufficient balance. Available: ${balanceSats.toLocaleString()} sats.`, type: "err" });

    setSendLoading(true);
    setSendStatus({ msg: `Sending ${sendSats} sats…`, type: "info" });
    try {
      const data = await api("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: sendTo.trim(), sats: sendSats }),
      });
      setSendStatus({ msg: `Sent! TX: ${data.txId}`, type: "ok" });
      setSendTo(""); setSendSats("");
      await refreshBalance();
      await loadTx({ page: 0, offsets: [0] });
    } catch (e: unknown) {
      setSendStatus({ msg: `Error: ${e instanceof Error ? e.message : String(e)}`, type: "err" });
    } finally {
      setSendLoading(false);
    }
  }

  async function loadHtlcInbox() {
    setHtlcInboxLoading(true);
    setHtlcInboxStatus({ msg: "", type: "" });
    try {
      const data = await api("/api/htlc");
      setHtlcIncoming(data.incoming ?? []);
      setHtlcOutgoing(data.outgoing ?? []);
    } catch (e) {
      setHtlcInboxStatus({ msg: e instanceof Error ? e.message : String(e), type: "err" });
    } finally {
      setHtlcInboxLoading(false);
    }
  }

  async function claimHtlc(paymentHash: string) {
    const preimage = claimInputs[paymentHash]?.trim();
    if (!preimage) return setClaimStatus(p => ({ ...p, [paymentHash]: { msg: "Enter the preimage.", type: "err" } }));
    if (!/^[0-9a-fA-F]{64}$/.test(preimage)) return setClaimStatus(p => ({ ...p, [paymentHash]: { msg: "Preimage must be 64 hex chars.", type: "err" } }));
    setClaimLoading(p => ({ ...p, [paymentHash]: true }));
    setClaimStatus(p => ({ ...p, [paymentHash]: { msg: "Claiming…", type: "info" } }));
    try {
      await api("/api/htlc/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preimage }) });
      setClaimStatus(p => ({ ...p, [paymentHash]: { msg: "Claimed! Sats added to balance.", type: "ok" } }));
      void loadHtlcInbox();
    } catch (e) {
      setClaimStatus(p => ({ ...p, [paymentHash]: { msg: e instanceof Error ? e.message : String(e), type: "err" } }));
    } finally {
      setClaimLoading(p => ({ ...p, [paymentHash]: false }));
    }
  }

  function generatePreimage() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
    setHtlcPreimage(hex);
    // SHA-256 via SubtleCrypto
    void crypto.subtle.digest("SHA-256", bytes).then(buf => {
      const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
      setHtlcSecretHash(hash);
    });
  }

  function onPreimageChange(val: string) {
    setHtlcPreimage(val);
    setHtlcSecretHash("");
    const trimmed = val.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      const bytes = new Uint8Array(trimmed.match(/.{2}/g)!.map(b => parseInt(b, 16)));
      void crypto.subtle.digest("SHA-256", bytes).then(buf => {
        const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
        setHtlcSecretHash(hash);
      });
    }
  }

  async function createHtlc() {
    if (!htlcTo.trim()) return setHtlcStatus({ msg: "Enter a receiver Spark address.", type: "err" });
    if (!htlcSats || Number(htlcSats) <= 0) return setHtlcStatus({ msg: "Enter a valid amount in sats.", type: "err" });
    if (htlcPreimage && !/^[0-9a-fA-F]{64}$/.test(htlcPreimage.trim())) return setHtlcStatus({ msg: "Preimage must be 64 hex characters (32 bytes).", type: "err" });
    setHtlcLoading(true);
    setHtlcStatus({ msg: "Creating HTLC…", type: "info" });
    setHtlcResult(null);
    try {
      const data = await api("/api/htlc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiverSparkAddress: htlcTo.trim(),
          amountSats: Number(htlcSats),
          preimage: htlcPreimage.trim() || undefined,
          expiryMinutes: Number(htlcExpiry) || 60,
        }),
      });
      setHtlcResult({ id: data.id, result: data.result });
      setHtlcStatus({ msg: "HTLC created!", type: "ok" });
    } catch (e) {
      setHtlcStatus({ msg: e instanceof Error ? e.message : String(e), type: "err" });
    } finally {
      setHtlcLoading(false);
    }
  }

  async function checkAddressBalance() {
    if (!checkAddr.trim()) return setCheckStatus({ msg: "Enter a Spark address.", type: "err" });
    setCheckLoading(true);
    setCheckStatus({ msg: "Fetching balance…", type: "info" });
    try {
      const data = await api(`/api/address-balance?address=${encodeURIComponent(checkAddr.trim())}`);
      const sats = BigInt(data.sats);
      setCheckResult({ sats, btc: (Number(sats) / 1e8).toFixed(8), network: data.network });
      setCheckStatus({ msg: "Balance fetched.", type: "ok" });
    } catch (e: unknown) {
      setCheckStatus({ msg: `Error: ${e instanceof Error ? e.message : String(e)}`, type: "err" });
    } finally {
      setCheckLoading(false);
    }
  }

  function copyAddress() {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setCopyMsg("Address copied!");
      setTimeout(() => setCopyMsg(""), 2000);
    });
  }

  function copyTxId(id: string) {
    if (!id) return;
    navigator.clipboard.writeText(id).then(() => {
      setTxStatus({ msg: "Transaction ID copied!", type: "ok" });
      setTimeout(() => setTxStatus({ msg: "", type: "" }), 2000);
    });
  }

  if (!connected) {
    return (
      <div style={{ minHeight: "80vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
        <div style={{ width: "100%", maxWidth: 420 }}>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", inset: -60, background: "radial-gradient(circle, rgba(240,137,58,0.07) 0%, transparent 70%)", pointerEvents: "none" }} />
            <div style={{
              position: "relative",
              background: "linear-gradient(160deg, var(--surface-2), var(--surface))",
              border: "1px solid var(--border-2)",
              borderRadius: 24,
              padding: "36px 32px",
              boxShadow: "0 24px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(139,163,209,0.08)",
            }}>
              <div style={{ position: "absolute", top: 0, left: "20%", right: "20%", height: 1, background: "linear-gradient(90deg, transparent, rgba(240,137,58,0.5), transparent)" }} />

              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 14,
                  background: "linear-gradient(135deg, #f0893a, #c9680c)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 22, fontWeight: 900, color: "#fff",
                  boxShadow: "0 0 24px rgba(240,137,58,0.3)",
                  flexShrink: 0,
                }}>₿</div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <h2 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.5px", margin: 0 }}>Connect Wallet</h2>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "var(--orange)", background: "var(--orange-dim)", border: "1px solid var(--orange-border)", padding: "3px 7px", borderRadius: 999 }}>Secure</span>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 3 }}>Spark network · end-to-end encrypted</p>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Network</label>
                <div style={{ position: "relative" }}>
                  <select value={network} onChange={(e) => setNetwork(e.target.value)}
                    style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border-2)", borderRadius: 12, color: "var(--text)", fontSize: 14, fontWeight: 500, padding: "12px 40px 12px 14px", outline: "none", cursor: "pointer", appearance: "none", fontFamily: "inherit" }}
                    onFocus={e => (e.currentTarget.style.borderColor = "var(--orange-border)")}
                    onBlur={e => (e.currentTarget.style.borderColor = "var(--border-2)")}
                  >
                    <option value="MAINNET">Mainnet — spark1...</option>
                    <option value="REGTEST">Regtest — sparkrt1...</option>
                  </select>
                  <svg style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "var(--text-faint)", pointerEvents: "none" }} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Mnemonic Phrase</label>
                <input type="password" placeholder="Enter your 12-word seed phrase" value={mnemonic}
                  onChange={(e) => setMnemonic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && connect()}
                  style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border-2)", borderRadius: 12, color: "var(--text)", fontSize: 14, padding: "13px 14px", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                  onFocus={e => (e.currentTarget.style.borderColor = "rgba(240,137,58,0.45)")}
                  onBlur={e => (e.currentTarget.style.borderColor = "var(--border-2)")}
                />
                <p style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>Your phrase never leaves this device.</p>
              </div>

              <button onClick={connect} disabled={connectLoading}
                style={{ width: "100%", border: "none", borderRadius: 13, padding: "14px", fontSize: 15, fontWeight: 700, cursor: connectLoading ? "default" : "pointer", background: connectLoading ? "rgba(240,137,58,0.25)" : "linear-gradient(135deg, #f0893a, #c9680c)", color: connectLoading ? "var(--text-faint)" : "#fff", boxShadow: connectLoading ? "none" : "0 4px 18px rgba(240,137,58,0.28)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "all 0.2s" }}
              >
                {connectLoading ? (<><svg style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>Connecting…</>) : "Connect Wallet"}
              </button>

              <Status msg={connectStatus.msg} type={(connectStatus.type || "info") as "ok" | "err" | "info"} onDismiss={() => setConnectStatus({ msg: "", type: "" })} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  async function disconnect() {
    if (timerRef.current) clearInterval(timerRef.current);
    await fetch("/api/disconnect", { method: "POST" }).catch(() => {});
    setConnected(false);
    setAddress("");
    setBalanceSats(null);
    setTransfers([]);
    setMnemonic("");
    setConnectStatus({ msg: "", type: "" });
  }

  const card: React.CSSProperties = {
    background: "linear-gradient(160deg, var(--surface-2), var(--surface))",
    border: "1px solid var(--border)",
    borderRadius: 20,
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    position: "relative",
    overflow: "hidden",
    boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
  };
  const label: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: "1.2px",
    textTransform: "uppercase", color: "var(--text-muted)",
  };
  const inp: React.CSSProperties = {
    background: "var(--surface)", border: "1px solid var(--border-2)",
    borderRadius: 10, color: "var(--text)", fontSize: 13,
    padding: "11px 14px", outline: "none", width: "100%", fontFamily: "inherit",
  };
  const sectionTitle = (text: string, badge?: string) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{text}</span>
      {badge && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "var(--orange)", background: "var(--orange-dim)", border: "1px solid var(--orange-border)", padding: "3px 8px", borderRadius: 999 }}>{badge}</span>}
    </div>
  );

  return (
    <div style={{ padding: "28px 24px", maxWidth: 1100, margin: "0 auto" }}>

      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 8px rgba(45,211,110,0.5)" }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Connected</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--surface-2)", border: "1px solid var(--border)", padding: "3px 10px", borderRadius: 8, fontFamily: "JetBrains Mono, monospace" }}>
            {network === "REGTEST" ? "Regtest" : "Mainnet"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={togglePrivacy} disabled={privacyLoading || privacyEnabled === null}
            title={privacyEnabled === false ? "Wallet is public — click to enable privacy" : "Wallet is private — click to make public"}
            style={{ background: privacyEnabled === false ? "var(--orange-dim)" : "var(--surface-2)", border: `1px solid ${privacyEnabled === false ? "var(--orange-border)" : "var(--border)"}`, borderRadius: 8, padding: "6px 12px", fontSize: 11, fontWeight: 600, color: privacyEnabled === false ? "var(--orange)" : "var(--text-muted)", cursor: privacyLoading || privacyEnabled === null ? "default" : "pointer", opacity: privacyLoading || privacyEnabled === null ? 0.6 : 1, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6 }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: privacyEnabled === false ? "var(--orange)" : "var(--text-faint)" }} />
            {privacyLoading ? "…" : privacyEnabled === null ? "Privacy" : privacyEnabled ? "Private" : "Public"}
          </button>
          <select value={network} onChange={(e) => switchNetwork(e.target.value)} disabled={connectLoading}
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-muted)", fontSize: 11, fontWeight: 600, padding: "6px 10px", outline: "none", cursor: "pointer", fontFamily: "inherit" }}
          >
            <option value="MAINNET">Mainnet</option>
            <option value="REGTEST">Regtest</option>
          </select>
          {privacyStatus.msg && <span style={{ fontSize: 10, color: privacyStatus.type === "err" ? "var(--red)" : privacyStatus.type === "ok" ? "var(--green)" : "var(--text-muted)" }}>{privacyStatus.msg}</span>}
          <button onClick={disconnect} style={{ background: "rgba(232,87,87,0.08)", border: "1px solid rgba(232,87,87,0.2)", borderRadius: 8, padding: "6px 14px", fontSize: 11, fontWeight: 600, color: "var(--red)", cursor: "pointer" }}>
            Disconnect
          </button>
        </div>
      </div>

      {/* Top row: Receive + Balance */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20, marginBottom: 20 }}>

        {/* Receive */}
        <div style={card}>
          <div style={{ position: "absolute", top: 0, left: "15%", right: "15%", height: 1, background: "linear-gradient(90deg, transparent, rgba(240,137,58,0.35), transparent)" }} />
          {sectionTitle("Receive", "Address")}
          <div
            onClick={copyAddress}
            title="Click to copy"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", fontSize: 11, wordBreak: "break-all", color: "var(--text-muted)", cursor: "pointer", fontFamily: "JetBrains Mono, monospace", lineHeight: 1.6, minHeight: 60, transition: "all 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--orange-border)"; (e.currentTarget as HTMLDivElement).style.color = "var(--text)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLDivElement).style.color = "var(--text-muted)"; }}
          >
            {address || "—"}
          </div>
          <button onClick={copyAddress} style={{ background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", cursor: "pointer", width: "100%", marginTop: "auto" }}>
            Copy Address
          </button>
          <Status msg={copyMsg} type="ok" onDismiss={() => setCopyMsg("")} />
        </div>

        {/* Balance */}
        <div style={card}>
          <div style={{ position: "absolute", top: 0, left: "15%", right: "15%", height: 1, background: "linear-gradient(90deg, transparent, rgba(240,137,58,0.35), transparent)" }} />
          {sectionTitle("Balance", "Auto-refresh 5s")}
          <div style={{ minWidth: 0, overflow: "hidden" }}>
            <div style={{ fontSize: 46, fontWeight: 900, background: "linear-gradient(135deg, #f0893a, #c9680c)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "-2px", lineHeight: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {balanceSats !== null ? balanceSats.toLocaleString() : "—"}
            </div>
            {balanceSats !== null && <div style={{ fontSize: 22, fontWeight: 600, color: "var(--orange)", opacity: 0.65, marginTop: 2 }}>sats</div>}
            {balanceSats !== null && <div style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 6 }}>{(Number(balanceSats) / 1e8).toFixed(8)} BTC</div>}
          </div>
          <button onClick={() => refreshBalance()} style={{ background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", cursor: "pointer", width: "100%", marginTop: "auto" }}>
            Refresh Balance
          </button>
          <Status msg={balanceStatus.msg} type={(balanceStatus.type || "info") as "ok" | "err" | "info"} onDismiss={() => setBalanceStatus({ msg: "", type: "" })} />
        </div>
      </div>

      {/* Middle row: Check Balance + Send */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20, marginBottom: 20 }}>

        {/* Check address balance */}
        <div style={card}>
          {sectionTitle("Check Any Balance", "Public")}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>Spark Address</span>
            <input
              type="text" placeholder="spark1... or sparkrt1..." value={checkAddr}
              onChange={(e) => setCheckAddr(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && checkAddressBalance()}
              style={inp}
            />
          </div>
          <button onClick={checkAddressBalance} disabled={checkLoading}
            style={{ background: checkLoading ? "rgba(240,137,58,0.2)" : "linear-gradient(135deg, #f0893a, #c9680c)", border: "none", borderRadius: 10, padding: "12px", fontSize: 13, fontWeight: 700, color: checkLoading ? "var(--text-faint)" : "#fff", cursor: "pointer", width: "100%", boxShadow: checkLoading ? "none" : "0 3px 12px rgba(240,137,58,0.2)" }}
          >
            {checkLoading ? "Checking…" : "Check Balance"}
          </button>
          {checkResult && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px", minWidth: 0, overflow: "hidden" }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: "var(--orange)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{checkResult.sats.toLocaleString()} <span style={{ fontSize: 14, opacity: 0.6 }}>sats</span></div>
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>{checkResult.btc} BTC · {checkResult.network}</div>
            </div>
          )}
          <Status msg={checkStatus.msg} type={(checkStatus.type || "info") as "ok" | "err" | "info"} onDismiss={() => setCheckStatus({ msg: "", type: "" })} />
        </div>

        {/* Send */}
        <div style={card}>
          {sectionTitle("Send Funds", "Transfer")}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>Recipient Address</span>
            <input type="text" placeholder="spark1... or sparkrt1..." value={sendTo}
              onChange={(e) => setSendTo(e.target.value)} style={inp} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>Amount (sats)</span>
            <input type="number" placeholder="e.g. 1000" min={1} value={sendSats}
              onChange={(e) => setSendSats(e.target.value)} style={inp} />
          </div>
          <button onClick={send} disabled={sendLoading}
            style={{ background: sendLoading ? "rgba(45,211,110,0.15)" : "linear-gradient(135deg, #2dd36e, #1aaa52)", border: "none", borderRadius: 10, padding: "12px", fontSize: 13, fontWeight: 700, color: sendLoading ? "var(--text-faint)" : "#fff", cursor: "pointer", width: "100%", marginTop: "auto", boxShadow: sendLoading ? "none" : "0 3px 12px rgba(45,211,110,0.2)" }}
          >
            {sendLoading ? "Sending…" : "Send"}
          </button>
          <Status msg={sendStatus.msg} type={(sendStatus.type || "info") as "ok" | "err" | "info"} onDismiss={() => setSendStatus({ msg: "", type: "" })} />
        </div>
      </div>

      {/* Create HTLC */}
      {connected && (
        <div style={{ ...card }}>
          {sectionTitle("Create HTLC", "Lock sats behind a secret hash")}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>Receiver Spark Address</span>
              <input
                type="text" placeholder="sparkrt1p…" value={htlcTo}
                onChange={e => setHtlcTo(e.target.value)} style={{ ...inp, fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>Amount (sats)</span>
              <input
                type="number" placeholder="e.g. 1000" min={1} value={htlcSats}
                onChange={e => setHtlcSats(e.target.value)} style={inp}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={label}>Preimage (32 bytes hex)</span>
                <button
                  onClick={generatePreimage}
                  style={{ background: "rgba(240,137,58,0.1)", border: "1px solid rgba(240,137,58,0.25)", borderRadius: 7, padding: "3px 10px", fontSize: 10, fontWeight: 700, color: "var(--orange)", cursor: "pointer", letterSpacing: "0.3px" }}
                >
                  Generate Random
                </button>
              </div>
              <input
                type="text" placeholder="64 hex chars — or leave blank to auto-generate" value={htlcPreimage}
                onChange={e => onPreimageChange(e.target.value)}
                style={{ ...inp, fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}
              />
            </div>

            {htlcSecretHash && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={label}>Secret Hash (SHA-256 of preimage)</span>
                <div style={{ background: "rgba(45,211,110,0.05)", border: "1px solid rgba(45,211,110,0.15)", borderRadius: 10, padding: "10px 14px", fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--green)", wordBreak: "break-all", lineHeight: 1.5 }}>
                  {htlcSecretHash}
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={label}>Expiry (minutes from now)</span>
              <input
                type="number" placeholder="60" min={1} value={htlcExpiry}
                onChange={e => setHtlcExpiry(e.target.value)} style={{ ...inp, width: 120 }}
              />
            </div>

            <button
              onClick={createHtlc} disabled={htlcLoading}
              style={{ background: htlcLoading ? "rgba(240,137,58,0.15)" : "linear-gradient(135deg, #f0893a, #c9680c)", border: "none", borderRadius: 10, padding: "12px", fontSize: 13, fontWeight: 700, color: htlcLoading ? "var(--text-faint)" : "#000", cursor: htlcLoading ? "default" : "pointer", width: "100%", boxShadow: htlcLoading ? "none" : "0 3px 12px rgba(240,137,58,0.2)" }}
            >
              {htlcLoading ? "Creating HTLC…" : "Create HTLC"}
            </button>

            <Status msg={htlcStatus.msg} type={(htlcStatus.type || "info") as "ok" | "err" | "info"} onDismiss={() => setHtlcStatus({ msg: "", type: "" })} />

            {htlcResult && (
              <div style={{ background: "rgba(45,211,110,0.05)", border: "1px solid rgba(45,211,110,0.2)", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "1px", textTransform: "uppercase", color: "var(--green)" }}>HTLC Created</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.5px" }}>Transfer ID</span>
                  <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#ccc", wordBreak: "break-all" }}>{htlcResult.id}</span>
                </div>
                {htlcPreimage && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.5px" }}>Preimage (keep secret)</span>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#f7931a", wordBreak: "break-all" }}>{htlcPreimage}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* HTLC Inbox */}
      {connected && (
        <div style={{ ...card }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            {sectionTitle("HTLC Inbox", "Incoming & sent HTLCs")}
            <button onClick={loadHtlcInbox} disabled={htlcInboxLoading}
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "5px 12px", fontSize: 11, fontWeight: 600, color: htlcInboxLoading ? "#333" : "#555", cursor: htlcInboxLoading ? "default" : "pointer" }}>
              {htlcInboxLoading ? "Loading…" : "Refresh"}
            </button>
          </div>

          <Status msg={htlcInboxStatus.msg} type={(htlcInboxStatus.type || "info") as "ok" | "err" | "info"} onDismiss={() => setHtlcInboxStatus({ msg: "", type: "" })} />

          {/* Incoming — claimable */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "1px", textTransform: "uppercase", color: "var(--green)", marginBottom: 10 }}>
              Incoming ({htlcIncoming.length})
            </div>
            {htlcIncoming.length === 0 ? (
              <div style={{ fontSize: 12, color: "#444", padding: "12px 0" }}>No incoming HTLCs. Hit Refresh to check.</div>
            ) : htlcIncoming.map(h => {
              const hash = h.paymentHash;
              const statusLabel = h.status === 0 ? "Waiting" : h.status === 1 ? "Claimed" : "Returned";
              const statusColor = h.status === 0 ? "var(--orange)" : h.status === 1 ? "var(--green)" : "#888";
              const cs = claimStatus[hash];
              return (
                <div key={hash} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", marginBottom: 8, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: "#555" }}>Payment Hash</span>
                      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "#aaa", wordBreak: "break-all" }}>{hash}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end", flexShrink: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--green)" }}>{h.amountSats ? `+${Number(h.amountSats).toLocaleString()} sats` : "—"}</span>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: `${statusColor}15`, color: statusColor, textTransform: "uppercase", letterSpacing: "0.6px" }}>{statusLabel}</span>
                    </div>
                  </div>
                  {h.status === 0 && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <input type="text" placeholder="Preimage (64 hex chars)"
                        value={claimInputs[hash] ?? ""}
                        onChange={e => setClaimInputs(p => ({ ...p, [hash]: e.target.value }))}
                        style={{ flex: 1, background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#e0e0e0", fontSize: 11, padding: "8px 12px", outline: "none", fontFamily: "JetBrains Mono, monospace", minWidth: 0 }}
                      />
                      <button onClick={() => claimHtlc(hash)} disabled={claimLoading[hash]}
                        style={{ background: claimLoading[hash] ? "rgba(45,211,110,0.1)" : "linear-gradient(135deg,#2dd36e,#1aaa52)", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 700, color: claimLoading[hash] ? "#555" : "#fff", cursor: claimLoading[hash] ? "default" : "pointer", whiteSpace: "nowrap", boxShadow: claimLoading[hash] ? "none" : "0 2px 8px rgba(45,211,110,0.2)" }}>
                        {claimLoading[hash] ? "…" : "Claim"}
                      </button>
                    </div>
                  )}
                  {cs?.msg && (
                    <div style={{ fontSize: 11, color: cs.type === "ok" ? "var(--green)" : cs.type === "err" ? "var(--red)" : "#888" }}>{cs.msg}</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Outgoing — status only */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "1px", textTransform: "uppercase", color: "#555", marginBottom: 10 }}>
              Sent ({htlcOutgoing.length})
              <span style={{ fontWeight: 400, fontSize: 9, marginLeft: 8, color: "#444", textTransform: "none", letterSpacing: 0 }}>Expired HTLCs auto-refund — no action needed</span>
            </div>
            {htlcOutgoing.length === 0 ? (
              <div style={{ fontSize: 12, color: "#444", padding: "12px 0" }}>No sent HTLCs. Hit Refresh to check.</div>
            ) : htlcOutgoing.map(h => {
              const statusLabel = h.status === 0 ? "Waiting for claim" : h.status === 1 ? "Claimed" : "Returned to you";
              const statusColor = h.status === 0 ? "var(--orange)" : h.status === 1 ? "var(--green)" : "#888";
              return (
                <div key={h.paymentHash} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "#666", wordBreak: "break-all" }}>{h.paymentHash.slice(0, 24)}…</span>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: `${statusColor}15`, color: statusColor, textTransform: "uppercase", letterSpacing: "0.6px", alignSelf: "flex-start" }}>{statusLabel}</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: h.status === 2 ? "var(--green)" : "var(--text-muted)", whiteSpace: "nowrap" }}>
                    {h.status === 2 ? "↩ " : "−"}{h.amountSats ? `${Number(h.amountSats).toLocaleString()} sats` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Transaction History */}
      <div style={{ ...card, gap: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          {sectionTitle("Transaction History", "Auto-refresh 5s")}
          <button
            onClick={() => loadTx({ page: 0, offsets: [0] })}
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "5px 12px", fontSize: 11, fontWeight: 600, color: "#555", cursor: "pointer" }}
          >
            Refresh
          </button>
        </div>

        {transfers.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "#444", fontSize: 13 }}>No transactions found.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {transfers.map((tx) => {
              const isIn = tx.direction === "INCOMING";
              const date = tx.createdAt ? new Date(tx.createdAt).toLocaleString() : "—";
              const shortId = tx.id ? `${tx.id.slice(0, 18)}…` : "—";
              const explorerUrl = network === "MAINNET"
                ? `https://sparkscan.io/tx/${tx.id}`
                : `https://sparkscan.io/tx/${tx.id}?network=regtest`;
              return (
                <a key={tx.id} href={explorerUrl} target="_blank" rel="noopener noreferrer"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, textDecoration: "none", transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--orange-border)"; e.currentTarget.style.background = "var(--surface-2)"; (e.currentTarget.querySelector(".link-hint") as HTMLElement).style.opacity = "1"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--surface)"; (e.currentTarget.querySelector(".link-hint") as HTMLElement).style.opacity = "0.3"; }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", padding: "2px 8px", borderRadius: 6, background: isIn ? "var(--green-dim)" : "rgba(232,87,87,0.1)", color: isIn ? "var(--green)" : "var(--red)" }}>
                        {isIn ? "Received" : "Sent"}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{date}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortId}</span>
                      <svg className="link-hint" style={{ width: 10, height: 10, color: "var(--text-muted)", opacity: 0.3, transition: "all 0.15s", flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </div>
                  </div>
                  <span style={{ fontSize: 16, fontWeight: 700, color: isIn ? "var(--green)" : "var(--text)", whiteSpace: "nowrap" }}>
                    {isIn ? "+" : "−"}{Number(tx.sats).toLocaleString()} <span style={{ fontSize: 11, opacity: 0.5 }}>sats</span>
                  </span>
                </a>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16 }}>
          <button disabled={txPage === 0} onClick={() => loadTx({ page: txPage - 1, offsets: txOffsets })}
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 18px", fontSize: 12, fontWeight: 600, color: txPage === 0 ? "var(--text-faint)" : "var(--text-muted)", cursor: txPage === 0 ? "default" : "pointer" }}
          >← Prev</button>
          <span style={{ fontSize: 11, color: "var(--text-faint)" }}>Page {txPage + 1}</span>
          <button disabled={!txHasNext} onClick={() => loadTx({ page: txPage + 1, offsets: txOffsets })}
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 18px", fontSize: 12, fontWeight: 600, color: !txHasNext ? "var(--text-faint)" : "var(--text-muted)", cursor: !txHasNext ? "default" : "pointer" }}
          >Next →</button>
        </div>
        <Status msg={txStatus.msg} type={(txStatus.type || "info") as "ok" | "err" | "info"} onDismiss={() => setTxStatus({ msg: "", type: "" })} />
      </div>

    </div>
  );
}
