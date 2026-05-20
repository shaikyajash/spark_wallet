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

  const [copyMsg, setCopyMsg] = useState("");
  const refreshInFlight = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    setAddress(addr);
    setConnected(true);
    if (timerRef.current) clearInterval(timerRef.current);
    refreshBalance(false);
    loadTx({ page: 0, offsets: [0], silent: false });
    timerRef.current = setInterval(async () => {
      if (refreshInFlight.current) return;
      refreshInFlight.current = true;
      try {
        const status = await api("/api/status", {}, 0);
        if (!status.connected) {
          setConnected(false);
          setAddress("");
          if (timerRef.current) clearInterval(timerRef.current);
          return;
        }
        await Promise.all([refreshBalance(true), loadTx({ page: txPage, offsets: txOffsets, silent: true })]);
      } catch {
        // Silent failure on refresh
      } finally {
        refreshInFlight.current = false;
      }
    }, 5000);
  }, [refreshBalance, loadTx, txPage, txOffsets]);

  // Check existing session on mount
  useEffect(() => {
    api("/api/status").then((data) => {
      if (data.connected && data.address) {
        if (data.network) setNetwork(data.network);
        startAutoRefresh(data.address);
      }
    }).catch(() => {});
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
      startAutoRefresh(data.address);
    } catch (e: unknown) {
      setConnectStatus({ msg: `Error: ${e instanceof Error ? e.message : String(e)}`, type: "err" });
    } finally {
      setConnectLoading(false);
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
          {/* Ambient glow behind card */}
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", inset: -40, background: "radial-gradient(circle, rgba(247,147,26,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />

            <div style={{
              position: "relative",
              background: "linear-gradient(145deg, #161616, #111)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 24,
              padding: "36px 32px",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.5), 0 24px 48px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)",
            }}>
              {/* Top accent */}
              <div style={{ position: "absolute", top: 0, left: "20%", right: "20%", height: 1, background: "linear-gradient(90deg, transparent, rgba(247,147,26,0.6), transparent)" }} />

              {/* Logo + title */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 14,
                  background: "linear-gradient(135deg, #f7931a, #e55a00)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 22, fontWeight: 900, color: "#000",
                  boxShadow: "0 0 24px rgba(247,147,26,0.35), inset 0 1px 0 rgba(255,255,255,0.2)",
                  flexShrink: 0,
                }}>₿</div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <h2 style={{ fontSize: 22, fontWeight: 800, color: "#f0f0f0", letterSpacing: "-0.5px", margin: 0 }}>Connect Wallet</h2>
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "1.2px", textTransform: "uppercase", color: "#f0b061", background: "rgba(247,147,26,0.1)", border: "1px solid rgba(247,147,26,0.2)", padding: "3px 7px", borderRadius: 999 }}>Secure</span>
                  </div>
                  <p style={{ fontSize: 12, color: "#555", marginTop: 2 }}>Spark network · end-to-end encrypted</p>
                </div>
              </div>

              {/* Network selector */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "#666", marginBottom: 8 }}>Network</label>
                <div style={{ position: "relative" }}>
                  <select
                    value={network}
                    onChange={(e) => setNetwork(e.target.value)}
                    style={{
                      width: "100%", background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 12, color: "#e0e0e0", fontSize: 14, fontWeight: 600,
                      padding: "12px 40px 12px 14px", outline: "none", cursor: "pointer",
                      appearance: "none", fontFamily: "inherit",
                      boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)",
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = "rgba(247,147,26,0.5)")}
                    onBlur={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)")}
                  >
                    <option value="MAINNET">Mainnet — spark1...</option>
                    <option value="REGTEST">Regtest — sparkrt1...</option>
                  </select>
                  <svg style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "#555", pointerEvents: "none" }} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Mnemonic input */}
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "#666", marginBottom: 8 }}>Mnemonic Phrase</label>
                <input
                  type="password"
                  placeholder="Enter your 12-word seed phrase"
                  value={mnemonic}
                  onChange={(e) => setMnemonic(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && connect()}
                  style={{
                    width: "100%", background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 12, color: "#e8e8e8", fontSize: 14,
                    padding: "13px 14px", outline: "none", fontFamily: "inherit",
                    boxShadow: "inset 0 2px 4px rgba(0,0,0,0.3)",
                    boxSizing: "border-box",
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = "rgba(247,147,26,0.5)")}
                  onBlur={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)")}
                />
                <p style={{ fontSize: 11, color: "#444", marginTop: 6 }}>Your phrase never leaves this device.</p>
              </div>

              {/* Connect button */}
              <button
                onClick={connect}
                disabled={connectLoading}
                style={{
                  width: "100%", border: "none", borderRadius: 14, padding: "14px",
                  fontSize: 15, fontWeight: 800, cursor: connectLoading ? "default" : "pointer",
                  background: connectLoading ? "rgba(247,147,26,0.3)" : "linear-gradient(135deg, #f7931a, #e55a00)",
                  color: connectLoading ? "rgba(0,0,0,0.5)" : "#000",
                  boxShadow: connectLoading ? "none" : "0 4px 16px rgba(247,147,26,0.3)",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  transition: "all 0.2s",
                }}
              >
                {connectLoading ? (
                  <>
                    <svg style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
                    Connecting…
                  </>
                ) : "Connect Wallet"}
              </button>

              <Status msg={connectStatus.msg} type={(connectStatus.type || "info") as "ok" | "err" | "info"} onDismiss={() => setConnectStatus({ msg: "", type: "" })} />
            </div>
          </div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
    background: "linear-gradient(145deg, #141414, #111)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 20,
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    position: "relative",
    overflow: "hidden",
  };
  const label: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: "1.2px",
    textTransform: "uppercase", color: "#555",
  };
  const inp: React.CSSProperties = {
    background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10, color: "#e0e0e0", fontSize: 13,
    padding: "11px 14px", outline: "none", width: "100%", fontFamily: "inherit",
  };
  const sectionTitle = (text: string, badge?: string) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: "#ccc" }}>{text}</span>
      {badge && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#f0b061", background: "rgba(247,147,26,0.1)", border: "1px solid rgba(247,147,26,0.2)", padding: "3px 8px", borderRadius: 999 }}>{badge}</span>}
    </div>
  );

  return (
    <div style={{ padding: "28px 24px", maxWidth: 1100, margin: "0 auto" }}>

      {/* Top bar: address + network + disconnect */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 8px rgba(34,197,94,0.6)" }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#555" }}>Connected</span>
          <span style={{ fontSize: 11, color: "#333", fontFamily: "JetBrains Mono, monospace" }}>·</span>
          <span style={{ fontSize: 11, color: "#666", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", padding: "3px 10px", borderRadius: 8, fontFamily: "JetBrains Mono, monospace" }}>
            {network === "REGTEST" ? "Regtest" : "Mainnet"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={togglePrivacy}
            disabled={privacyLoading || privacyEnabled === null}
            title={privacyEnabled === false ? "Wallet is public — click to enable privacy" : "Wallet is private — click to make public"}
            style={{
              background: privacyEnabled === false ? "rgba(247,147,26,0.12)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${privacyEnabled === false ? "rgba(247,147,26,0.35)" : "rgba(255,255,255,0.08)"}`,
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 11,
              fontWeight: 700,
              color: privacyEnabled === false ? "#f0b061" : "#888",
              cursor: privacyLoading || privacyEnabled === null ? "default" : "pointer",
              opacity: privacyLoading || privacyEnabled === null ? 0.6 : 1,
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: privacyEnabled === false ? "#f7931a" : "#555" }} />
            {privacyLoading
              ? "…"
              : privacyEnabled === null
              ? "Privacy"
              : privacyEnabled
              ? "Private"
              : "Public"}
          </button>
          <select
            value={network}
            onChange={(e) => switchNetwork(e.target.value)}
            disabled={connectLoading}
            style={{ background: "#111", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#888", fontSize: 11, fontWeight: 600, padding: "6px 10px", outline: "none", cursor: "pointer", fontFamily: "inherit" }}
          >
            <option value="MAINNET">Mainnet</option>
            <option value="REGTEST">Regtest</option>
          </select>
          {privacyStatus.msg && (
            <span style={{ fontSize: 10, color: privacyStatus.type === "err" ? "#ef4444" : privacyStatus.type === "ok" ? "#22c55e" : "#888" }}>
              {privacyStatus.msg}
            </span>
          )}
          <button
            onClick={disconnect}
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: "6px 14px", fontSize: 11, fontWeight: 700, color: "#ef4444", cursor: "pointer" }}
          >
            Disconnect
          </button>
        </div>
      </div>

      {/* Top row: Receive + Balance */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20, marginBottom: 20 }}>

        {/* Receive */}
        <div style={card}>
          <div style={{ position: "absolute", top: 0, left: "15%", right: "15%", height: 1, background: "linear-gradient(90deg, transparent, rgba(247,147,26,0.3), transparent)" }} />
          {sectionTitle("Receive", "Address")}
          <div
            onClick={copyAddress}
            title="Click to copy"
            style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "12px 14px", fontSize: 12, wordBreak: "break-all", color: "#aaa", cursor: "pointer", fontFamily: "JetBrains Mono, monospace", lineHeight: 1.6, minHeight: 60 }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(247,147,26,0.4)"; (e.currentTarget as HTMLDivElement).style.color = "#ddd"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLDivElement).style.color = "#aaa"; }}
          >
            {address || "—"}
          </div>
          <button
            onClick={copyAddress}
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px", fontSize: 12, fontWeight: 600, color: "#888", cursor: "pointer", width: "100%", marginTop: "auto" }}
          >
            Copy Address
          </button>
          <Status msg={copyMsg} type="ok" onDismiss={() => setCopyMsg("")} />
        </div>

        {/* Balance */}
        <div style={card}>
          <div style={{ position: "absolute", top: 0, left: "15%", right: "15%", height: 1, background: "linear-gradient(90deg, transparent, rgba(247,147,26,0.3), transparent)" }} />
          {sectionTitle("Balance", "Auto-refresh 5s")}
          <div style={{ minWidth: 0, overflow: "hidden" }}>
            <div style={{ fontSize: 48, fontWeight: 900, background: "linear-gradient(135deg, #f7931a, #e06800)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "-2px", lineHeight: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {balanceSats !== null ? balanceSats.toLocaleString() : "—"}
            </div>
            {balanceSats !== null && <div style={{ fontSize: 24, fontWeight: 700, color: "#f7931a", opacity: 0.7, marginTop: 2 }}>sats</div>}
            {balanceSats !== null && <div style={{ fontSize: 13, color: "#555", marginTop: 6, wordBreak: "break-all" }}>{(Number(balanceSats) / 1e8).toFixed(8)} BTC</div>}
          </div>
          <button
            onClick={() => refreshBalance()}
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px", fontSize: 12, fontWeight: 600, color: "#888", cursor: "pointer", width: "100%", marginTop: "auto" }}
          >
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
          <button
            onClick={checkAddressBalance} disabled={checkLoading}
            style={{ background: checkLoading ? "rgba(247,147,26,0.2)" : "linear-gradient(135deg,#f7931a,#e55a00)", border: "none", borderRadius: 10, padding: "12px", fontSize: 13, fontWeight: 800, color: checkLoading ? "#888" : "#000", cursor: "pointer", width: "100%" }}
          >
            {checkLoading ? "Checking…" : "Check Balance"}
          </button>
          {checkResult && (
            <div style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "14px", minWidth: 0, overflow: "hidden" }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#f7931a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{checkResult.sats.toLocaleString()} <span style={{ fontSize: 14, opacity: 0.7 }}>sats</span></div>
              <div style={{ fontSize: 12, color: "#555", marginTop: 4, wordBreak: "break-all" }}>{checkResult.btc} BTC · {checkResult.network}</div>
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
          <button
            onClick={send} disabled={sendLoading}
            style={{ background: sendLoading ? "rgba(34,197,94,0.2)" : "#22c55e", border: "none", borderRadius: 10, padding: "12px", fontSize: 13, fontWeight: 800, color: sendLoading ? "#888" : "#000", cursor: "pointer", width: "100%", marginTop: "auto" }}
          >
            {sendLoading ? "Sending…" : "Send"}
          </button>
          <Status msg={sendStatus.msg} type={(sendStatus.type || "info") as "ok" | "err" | "info"} onDismiss={() => setSendStatus({ msg: "", type: "" })} />
        </div>
      </div>

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
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {transfers.map((tx) => {
              const isIn = tx.direction === "INCOMING";
              const date = tx.createdAt ? new Date(tx.createdAt).toLocaleString() : "—";
              const shortId = tx.id ? `${tx.id.slice(0, 18)}…` : "—";
              const explorerUrl = network === "MAINNET" 
                ? `https://sparkscan.io/tx/${tx.id}` 
                : `https://sparkscan.io/tx/${tx.id}?network=regtest`;
              return (
                <a 
                  key={tx.id} 
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, textDecoration: "none", transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(247,147,26,0.3)"; e.currentTarget.style.background = "rgba(255,255,255,0.02)"; (e.currentTarget.querySelector(".link-hint") as HTMLElement).style.opacity = "1"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)"; e.currentTarget.style.background = "#0a0a0a"; (e.currentTarget.querySelector(".link-hint") as HTMLElement).style.opacity = "0.3"; }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "1px", textTransform: "uppercase", padding: "2px 8px", borderRadius: 6, background: isIn ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: isIn ? "#22c55e" : "#ef4444" }}>
                        {isIn ? "Received" : "Sent"}
                      </span>
                      <span style={{ fontSize: 11, color: "#555" }}>{date}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#444", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {shortId}
                      </span>
                      <svg className="link-hint" style={{ width: 10, height: 10, color: "#666", opacity: 0.3, transition: "all 0.2s", flexShrink: 0 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </div>
                  </div>
                  <span style={{ fontSize: 16, fontWeight: 800, color: isIn ? "#22c55e" : "#e0e0e0", whiteSpace: "nowrap" }}>
                    {isIn ? "+" : "−"}{Number(tx.sats).toLocaleString()} <span style={{ fontSize: 11, opacity: 0.6 }}>sats</span>
                  </span>
                </a>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16 }}>
          <button
            disabled={txPage === 0}
            onClick={() => loadTx({ page: txPage - 1, offsets: txOffsets })}
            style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "6px 18px", fontSize: 12, fontWeight: 600, color: txPage === 0 ? "#333" : "#666", cursor: txPage === 0 ? "default" : "pointer" }}
          >← Prev</button>
          <span style={{ fontSize: 11, color: "#444" }}>Page {txPage + 1}</span>
          <button
            disabled={!txHasNext}
            onClick={() => loadTx({ page: txPage + 1, offsets: txOffsets })}
            style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "6px 18px", fontSize: 12, fontWeight: 600, color: !txHasNext ? "#333" : "#666", cursor: !txHasNext ? "default" : "pointer" }}
          >Next →</button>
        </div>
        <Status msg={txStatus.msg} type={(txStatus.type || "info") as "ok" | "err" | "info"} onDismiss={() => setTxStatus({ msg: "", type: "" })} />
      </div>

    </div>
  );
}
