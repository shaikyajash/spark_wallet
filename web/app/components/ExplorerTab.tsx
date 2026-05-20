"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

const CONFIG_KEY = "garden_swap_config";

interface SwapLeg {
  chain: string; asset: string; amount: string;
  initiate_tx_hash?: string; redeem_tx_hash?: string; refund_tx_hash?: string;
}
interface ExplorerOrder {
  order_id: string; created_at: string; solver_id?: string;
  source_swap: SwapLeg; destination_swap: SwapLeg;
}
interface OrdersPage {
  data: ExplorerOrder[]; page: number; per_page: number; total_pages: number; total_items: number;
}
interface ChainAsset { id: string; min_amount: string; decimals: number; }
interface ChainInfo { chain: string; assets: ChainAsset[]; }
interface LiquidityData { [chainAsset: string]: string; }

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "{}") as { orderbookUrl?: string; appId?: string }; }
  catch { return {}; }
}

function shortId(id: string) { return `${id.slice(0, 8)}…${id.slice(-6)}`; }
function hasHash(h?: string) { return Boolean(h?.trim()); }

function orderStatus(o: ExplorerOrder) {
  const s = o.source_swap; const d = o.destination_swap;
  if (hasHash(s.refund_tx_hash) || hasHash(d.refund_tx_hash)) return { label: "Refunded", color: "#ef4444", bg: "rgba(239,68,68,0.08)" };
  if (hasHash(s.redeem_tx_hash) && hasHash(d.redeem_tx_hash)) return { label: "Completed", color: "#22c55e", bg: "rgba(34,197,94,0.08)", pulse: false };
  if (hasHash(s.redeem_tx_hash) || hasHash(d.redeem_tx_hash)) return { label: "Redeeming", color: "#3b82f6", bg: "rgba(59,130,246,0.08)", pulse: true };
  if (hasHash(s.initiate_tx_hash) && hasHash(d.initiate_tx_hash)) return { label: "Initiated", color: "#f59e0b", bg: "rgba(245,158,11,0.08)", pulse: true };
  if (hasHash(s.initiate_tx_hash) || hasHash(d.initiate_tx_hash)) return { label: "Partial", color: "#a855f7", bg: "rgba(168,85,247,0.08)", pulse: true };
  return { label: "Pending", color: "#555", bg: "rgba(80,80,80,0.08)", pulse: false };
}

function chainGradient(chain: string) {
  const c = chain.toLowerCase();
  if (c.includes("bitcoin")) return "linear-gradient(135deg,#f7931a,#e06800)";
  if (c.includes("spark")) return "linear-gradient(135deg,#f7931a,#ff4f00)";
  if (c.includes("arbitrum")) return "linear-gradient(135deg,#28a0f0,#1366a8)";
  if (c.includes("ethereum") || c.includes("eth")) return "linear-gradient(135deg,#627eea,#3b5bd5)";
  return "linear-gradient(135deg,#3a3a3a,#222)";
}

function chainLetter(chain: string) {
  if (chain.toLowerCase().includes("bitcoin") || chain.toLowerCase().includes("spark")) return "₿";
  if (chain.toLowerCase().includes("arbitrum")) return "A";
  if (chain.toLowerCase().includes("ethereum")) return "E";
  return chain[0].toUpperCase();
}

function ChainIcon({ chain, size = 28 }: { chain: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: chainGradient(chain),
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.4, fontWeight: 800, color: "#fff",
      flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.4)"
    }}>{chainLetter(chain)}</div>
  );
}

function StatCard({ label, value, sub, loading }: { label: string; value: string | number; sub?: string; loading?: boolean }) {
  return (
    <div style={{
      background: "#0f0f0f", border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 16, padding: "20px 24px", display: "flex", flexDirection: "column", gap: 6,
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "#666" }}>{label}</span>
      {loading
        ? <div className="skeleton" style={{ height: 32, width: 80 }} />
        : <span style={{ fontSize: 32, fontWeight: 800, color: value === "—" || value === 0 ? "#444" : "#f0f0f0", letterSpacing: "-1px" }}>{value}</span>
      }
      {sub && <span style={{ fontSize: 11, color: "#666" }}>{sub}</span>}
    </div>
  );
}

const CFG_KEY = "garden_swap_config";

function saveConfig(updates: { orderbookUrl?: string; appId?: string }) {
  try {
    const existing = JSON.parse(localStorage.getItem(CFG_KEY) ?? "{}");
    localStorage.setItem(CFG_KEY, JSON.stringify({ ...existing, ...updates }));
  } catch { /* ignore */ }
}

export default function ExplorerTab() {
  const [cfg, setCfg] = useState(() => typeof window === "undefined" ? {} : loadConfig());
  const [showSettings, setShowSettings] = useState(() => {
    if (typeof window === "undefined") return false;
    const c = loadConfig();
    return !c.orderbookUrl;
  });
  const [urlInput, setUrlInput] = useState(() => typeof window === "undefined" ? "" : (loadConfig().orderbookUrl ?? ""));
  const [appIdInput, setAppIdInput] = useState(() => typeof window === "undefined" ? "" : (loadConfig().appId ?? ""));

  const [chains, setChains] = useState<ChainInfo[]>([]);
  const [liquidity, setLiquidity] = useState<LiquidityData>({});
  const [orders, setOrders] = useState<OrdersPage>({ data: [], page: 1, per_page: 20, total_pages: 1, total_items: 0 });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [page, setPage] = useState(1);
  const [fromChain, setFromChain] = useState("");
  const [toChain, setToChain] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [metaLoaded, setMetaLoaded] = useState(false);

  const orderbookUrl = (cfg as { orderbookUrl?: string }).orderbookUrl ?? "";
  const baseUrl = (cfg as { baseUrl?: string }).baseUrl ?? "";
  const appId = (cfg as { appId?: string }).appId ?? "";

  function applySettings() {
    const trimmed = urlInput.trim();
    const updates = { orderbookUrl: trimmed, appId: appIdInput.trim() };
    saveConfig(updates);
    setCfg(c => ({ ...c, ...updates }));
    setMetaLoaded(false);
    if (trimmed) setShowSettings(false);
  }

  const fetchMeta = useCallback(async () => {
    if (!orderbookUrl) return;
    const metaBase = baseUrl || orderbookUrl;
    try {
      const [cr, lr] = await Promise.all([
        fetch(`/api/swap/chains?baseUrl=${encodeURIComponent(metaBase)}`),
        fetch(`/api/swap/liquidity?baseUrl=${encodeURIComponent(metaBase)}`),
      ]);
      if (cr.ok) {
        const d = await cr.json();
        const chainList = d.result ?? d.chains ?? d.data ?? (Array.isArray(d) ? d : []);
        setChains(chainList);
      }
      if (lr.ok) {
        const d = await lr.json();
        const raw = d.result ?? d;
        const parsed = (typeof raw === "object" && !Array.isArray(raw) && raw.liquidity && typeof raw.liquidity === "object")
          ? raw.liquidity
          : raw;
        setLiquidity(typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {});
      }
    } catch { /* ignore */ }
    finally { setMetaLoaded(true); }
  }, [orderbookUrl, baseUrl]);

  const fetchOrders = useCallback(async (silent = false) => {
    if (!orderbookUrl) return;
    if (!silent) setLoading(true);
    setErr("");
    try {
      const p = new URLSearchParams({
        orderbookUrl, page: String(page), perPage: "20",
        ...(appId ? { appId } : {}),
        ...(fromChain ? { fromChain } : {}),
        ...(toChain ? { toChain } : {}),
      });
      const res = await fetch(`/api/swap/orders?${p}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setOrders(data as OrdersPage);
      setLastUpdated(new Date());
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [orderbookUrl, appId, page, fromChain, toChain]);

  useEffect(() => { void fetchMeta(); }, [fetchMeta]);
  useEffect(() => { void fetchOrders(); }, [fetchOrders]);
  useEffect(() => {
    if (!orderbookUrl) return;
    const t = setInterval(() => void fetchOrders(true), 10000);
    return () => clearInterval(t);
  }, [fetchOrders, orderbookUrl]);

  const chainOptions = useMemo(() => {
    const s = new Set(chains.map(c => c.chain));
    [fromChain, toChain].filter(Boolean).forEach(c => s.add(c));
    return Array.from(s).sort();
  }, [chains, fromChain, toChain]);

  const totalLiquidity = useMemo(() => {
    const vals = Object.values(liquidity).filter(v => typeof v === "string" || typeof v === "number");
    if (!vals.length) return null;
    const sum = vals.reduce((a, v) => a + Number(v), 0);
    return isNaN(sum) ? null : sum;
  }, [liquidity]);

  const inputStyle: React.CSSProperties = {
    background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 10, color: "#e0e0e0", fontSize: 13, padding: "9px 14px",
    outline: "none", width: "100%", fontFamily: "inherit", cursor: "pointer",
    appearance: "none" as const,
  };

  return (
    <div style={{ padding: "32px 20px", maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: 28 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 32, fontWeight: 800, background: "linear-gradient(to right, #fff, #888)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "-1px", margin: 0 }}>Explorer</h1>
            <span style={{
              fontSize: 9, fontWeight: 800, letterSpacing: "1.5px", textTransform: "uppercase",
              background: "rgba(34,197,94,0.1)", color: "#22c55e",
              border: "1px solid rgba(34,197,94,0.2)", padding: "3px 8px", borderRadius: 999,
              boxShadow: "0 0 10px rgba(34,197,94,0.2)", whiteSpace: "nowrap"
            }}>Live Data</span>
          </div>
          <p style={{ fontSize: 13, color: "#666", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            Cross-chain order feed · auto-refreshes every 10s
            {lastUpdated && <span style={{ marginLeft: 8, color: "#333" }}>· {lastUpdated.toLocaleTimeString()}</span>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => setShowSettings(s => !s)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: showSettings ? "rgba(247,147,26,0.1)" : "#141414",
              border: showSettings ? "1px solid rgba(247,147,26,0.3)" : "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10, padding: "8px 14px", color: showSettings ? "#f7931a" : "#888",
              fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap"
            }}
          >
            <svg style={{ width: 13, height: 13 }} viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><circle cx="12" cy="12" r="3" strokeWidth={2.5} />
            </svg>
            <span style={{ display: "none" }}>{showSettings ? "Close" : "Settings"}</span>
            {showSettings ? "Close" : "Settings"}
          </button>
          <button
            onClick={() => { setPage(1); fetchOrders(); fetchMeta(); }}
            disabled={loading || !orderbookUrl}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "#141414", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10, padding: "8px 16px", color: "#ccc",
              fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.2s", whiteSpace: "nowrap"
            }}
          >
            <svg style={{ width: 14, height: 14, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357-2H15" />
            </svg>
            {loading ? "Syncing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Inline Settings Panel */}
      {showSettings && (
        <div style={{ background: "#0f0f0f", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "#555" }}>Explorer Settings</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#666" }}>Orderbook URL</label>
              <input
                type="text"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && applySettings()}
                placeholder="https://orderbook.garden.finance"
                style={{ ...inputStyle, cursor: "text" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#666" }}>App ID <span style={{ color: "#444", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
              <input
                type="text"
                value={appIdInput}
                onChange={e => setAppIdInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && applySettings()}
                placeholder="your-app-id"
                style={{ ...inputStyle, cursor: "text" }}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={applySettings}
              style={{ background: "#f7931a", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 13, fontWeight: 800, color: "#000", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              Save &amp; Connect
            </button>
            {orderbookUrl && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: 10, minWidth: 0 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "#22c55e", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{orderbookUrl}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
        <StatCard label="Total Orders" value={orders.total_items > 0 ? orders.total_items.toLocaleString() : "—"} loading={loading && orders.total_items === 0} />
        <StatCard label="Active Chains" value={chainOptions.length > 0 ? chainOptions.length : "—"} loading={!metaLoaded && !!orderbookUrl} />
        <StatCard label="Liquid Assets" value={Object.keys(liquidity).length > 0 ? Object.keys(liquidity).length : "—"} loading={!metaLoaded && !!orderbookUrl} />
        <StatCard
          label="Total Liquidity"
          value={totalLiquidity && totalLiquidity > 0 ? `${(totalLiquidity / 1e8).toFixed(4)} BTC` : "—"}
          loading={!metaLoaded && !!orderbookUrl}
        />
      </div>

      {/* Liquidity Table */}
      {Object.keys(liquidity).length > 0 && (
        <div style={{ background: "#0f0f0f", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, overflow: "hidden" }}>
          <div style={{ padding: "18px 24px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "#555" }}>Liquidity Pools</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#0a0a0a" }}>
                  {["Asset", "Chain", "Available"].map(h => (
                    <th key={h} style={{ padding: "10px 20px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#444", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(liquidity).filter(([, val]) => typeof val === "string" || typeof val === "number").slice(0, 12).map(([key, val]) => {
                  const [chain, asset] = key.split(":");
                  const num = Number(val);
                  const display = isNaN(num) ? String(val) : (num / 1e8).toFixed(6);
                  return (
                    <tr key={key} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", transition: "background 0.15s" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <td style={{ padding: "12px 20px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <ChainIcon chain={chain} size={24} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#e0e0e0", textTransform: "uppercase" }}>{asset ?? key}</span>
                        </div>
                      </td>
                      <td style={{ padding: "12px 20px" }}>
                        <span style={{ fontSize: 11, color: "#666", fontWeight: 500 }}>{chain}</span>
                      </td>
                      <td style={{ padding: "12px 20px" }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#f7931a", fontFamily: "JetBrains Mono, monospace" }}>{display}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ background: "#0f0f0f", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: "20px 24px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 220 }}>
            <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#666" }}>From Chain</label>
            <select value={fromChain} onChange={e => { setFromChain(e.target.value); setPage(1); }} style={inputStyle}>
              <option value="">Any Chain</option>
              {chainOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 220 }}>
            <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#666" }}>To Chain</label>
            <select value={toChain} onChange={e => { setToChain(e.target.value); setPage(1); }} style={inputStyle}>
              <option value="">Any Chain</option>
              {chainOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button
            onClick={() => { setFromChain(""); setToChain(""); setPage(1); }}
            style={{
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10, padding: "9px 18px", color: "#ccc", height: 38,
              fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "background 0.2s"
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
          >Clear</button>
        </div>
      </div>

      {err && (
        <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 12, padding: "12px 18px", fontSize: 13, color: "#ef4444" }}>
          {err}
        </div>
      )}

      {/* Orders Table */}
      <div style={{ background: "#0f0f0f", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, overflow: "hidden" }}>
        <div style={{ padding: "18px 24px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "#555" }}>Orders</span>
          <span style={{ fontSize: 11, color: "#444" }}>{orders.total_items.toLocaleString()} total</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#0a0a0a" }}>
                {["Order ID", "Route", "Amount", "Status", "Time", ""].map(h => (
                  <th key={h} style={{ padding: "10px 20px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#444", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && orders.data.length === 0 ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={6} style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <div className="skeleton" style={{ height: 16, width: "100%" }} />
                    </td>
                  </tr>
                ))
              ) : orders.data.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: "60px 20px", textAlign: "center", color: "#444", fontSize: 13 }}>No transactions found.</td></tr>
              ) : orders.data.map(order => {
                const st = orderStatus(order);
                const src = order.source_swap;
                const dst = order.destination_swap;
                const srcAsset = src.asset.split(":")[1]?.toUpperCase() || src.asset;
                const dstAsset = dst.asset.split(":")[1]?.toUpperCase() || dst.asset;
                const srcAmt = src.amount ? (Number(src.amount) / 1e8).toFixed(6) : "—";
                return (
                  <tr key={order.order_id}
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", transition: "background 0.15s" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.015)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <td style={{ padding: "14px 20px" }}>
                      <span style={{ fontFamily: "JetBrains Mono,monospace", fontSize: 11, color: "#555" }}>{shortId(order.order_id)}</span>
                    </td>
                    <td style={{ padding: "14px 20px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <ChainIcon chain={src.chain} size={22} />
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}>
  <span style={{ fontSize: 11, fontWeight: 600, color: "#e0e0e0", textTransform: "uppercase" }}>{srcAsset}</span>
  <span style={{ fontSize: 9, color: "#888" }}>{src.chain}</span>
</div>
                        <svg style={{ width: 14, height: 14, color: "#333" }} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                        <ChainIcon chain={dst.chain} size={22} />
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#e0e0e0", textTransform: "uppercase" }}>{dstAsset}</span>
                          <span style={{ fontSize: 9, color: "#888" }}>{dst.chain}</span>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "14px 20px" }}>
                      <span style={{ fontFamily: "JetBrains Mono,monospace", fontSize: 12, color: "#f7931a", fontWeight: 700 }}>{srcAmt}</span>
                    </td>
                    <td style={{ padding: "14px 20px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, background: st.bg, border: `1px solid ${st.color}30`, borderRadius: 8, padding: "4px 10px", width: "fit-content" }}>
                        {st.pulse && <div style={{ width: 6, height: 6, borderRadius: "50%", background: st.color, animation: "pulse 1.5s infinite" }} />}
                        {!st.pulse && <div style={{ width: 6, height: 6, borderRadius: "50%", background: st.color }} />}
                        <span style={{ fontSize: 10, fontWeight: 800, color: st.color, letterSpacing: "0.8px", textTransform: "uppercase" }}>{st.label}</span>
                      </div>
                    </td>
                    <td style={{ padding: "14px 20px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 12, color: "#888" }}>{new Date(order.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                        <span style={{ fontSize: 10, color: "#444" }}>{new Date(order.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    </td>
                    <td style={{ padding: "14px 20px", textAlign: "right" }}>
                      <a
                        href={`https://lo7f6nzsz0rpumbmurojel17.garden-staging.dealpulley.com/order/${order.order_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 11, fontWeight: 700, color: "#f7931a", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        Details
                        <svg style={{ width: 12, height: 12 }} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div style={{ padding: "16px 24px", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, color: "#444" }}>
            Page <span style={{ color: "#888" }}>{orders.page}</span> / {orders.total_pages}
            <span style={{ marginLeft: 12 }}>· Showing {orders.data.length} of {orders.total_items}</span>
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { label: "← Prev", action: () => setPage(p => Math.max(1, p - 1)), disabled: page <= 1 },
              { label: "Next →", action: () => setPage(p => Math.min(orders.total_pages, p + 1)), disabled: page >= orders.total_pages },
            ].map(btn => (
              <button key={btn.label} onClick={btn.action} disabled={btn.disabled || loading}
                style={{
                  background: "#141414", border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600,
                  color: btn.disabled ? "#333" : "#888", cursor: btn.disabled ? "default" : "pointer",
                }}>{btn.label}</button>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
        select option { background: #111; }
      `}</style>
    </div>
  );
}
