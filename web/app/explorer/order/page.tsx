"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

const CONFIG_KEY = "garden_swap_config";

interface SwapLeg {
  chain: string; asset: string; amount: string;
  swap_id?: string; initiator?: string; redeemer?: string;
  initiate_tx_hash?: string; redeem_tx_hash?: string; refund_tx_hash?: string;
  initiate_timestamp?: string | null; redeem_timestamp?: string | null; refund_timestamp?: string | null;
  secret_hash?: string; secret?: string;
}
interface ExplorerOrder {
  order_id: string; created_at: string; solver_id?: string;
  integrator?: string; version?: string; nonce?: string;
  source_swap: SwapLeg; destination_swap: SwapLeg;
}

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "{}") as { orderbookUrl?: string; appId?: string }; }
  catch { return {}; }
}
function hasHash(h?: string) { return Boolean(h?.trim()); }
function fmt(v?: string | null) {
  if (!v?.trim()) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
function shortHash(h?: string) {
  if (!h?.trim()) return "—";
  return h.length > 20 ? `${h.slice(0, 10)}…${h.slice(-8)}` : h;
}
function orderStatus(order: ExplorerOrder) {
  const s = order.source_swap; const d = order.destination_swap;
  if (hasHash(s.refund_tx_hash) || hasHash(d.refund_tx_hash)) return { label: "Refunded", color: "#ef4444", bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.2)" };
  if (hasHash(s.redeem_tx_hash) && hasHash(d.redeem_tx_hash)) return { label: "Completed", color: "#22c55e", bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.2)", pulse: false };
  if (hasHash(s.redeem_tx_hash) || hasHash(d.redeem_tx_hash)) return { label: "Redeeming", color: "#3b82f6", bg: "rgba(59,130,246,0.08)", border: "rgba(59,130,246,0.2)", pulse: true };
  if (hasHash(s.initiate_tx_hash) && hasHash(d.initiate_tx_hash)) return { label: "Initiated", color: "#f7931a", bg: "rgba(247,147,26,0.08)", border: "rgba(247,147,26,0.2)", pulse: true };
  if (hasHash(s.initiate_tx_hash) || hasHash(d.initiate_tx_hash)) return { label: "Partially Initiated", color: "#a855f7", bg: "rgba(168,85,247,0.08)", border: "rgba(168,85,247,0.2)", pulse: true };
  return { label: "Pending", color: "#666", bg: "rgba(100,100,100,0.06)", border: "rgba(100,100,100,0.15)" };
}

function HashField({ label, value, copy = false }: { label: string; value?: string | null; copy?: boolean }) {
  const [copied, setCopied] = useState(false);
  const content = value?.trim() || null;
  function doCopy() {
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }
  return (
    <div style={{ padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "#555" }}>{label}</span>
        {copy && content && (
          <button onClick={doCopy} style={{ fontSize: 10, fontWeight: 700, color: copied ? "#22c55e" : "#f7931a", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            {copied ? "Copied!" : "Copy"}
          </button>
        )}
      </div>
      {content ? (
        <span
          style={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "#aaa", wordBreak: "break-all", lineHeight: 1.6, cursor: copy ? "pointer" : "default" }}
          onClick={copy ? doCopy : undefined}
          title={content}
        >{content}</span>
      ) : (
        <span style={{ fontSize: 13, color: "#333" }}>—</span>
      )}
    </div>
  );
}

function TextField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div style={{ padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "#555", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 14, color: value?.trim() ? "#e0e0e0" : "#333" }}>{value?.trim() || "—"}</div>
    </div>
  );
}

function AmountField({ label, value, asset }: { label: string; value?: string | null; asset?: string }) {
  if (!value?.trim()) return <TextField label={label} value={null} />;
  const num = Number(value);
  const display = isNaN(num) ? value : num.toLocaleString();
  const symbol = asset?.split(":")[1]?.toUpperCase() || "";
  return (
    <div style={{ padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "#555", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: "#f7931a" }}>{display}</span>
        {symbol && <span style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>{symbol}</span>}
      </div>
    </div>
  );
}

function ChainCard({ title, swap, color }: { title: string; swap: SwapLeg; color: string }) {
  const chain = swap.chain || "—";
  const asset = swap.asset?.split(":")[1]?.toUpperCase() || swap.asset || "—";
  const isBtc = chain.toLowerCase().includes("bitcoin") || chain.toLowerCase().includes("spark");
  return (
    <div style={{ background: "linear-gradient(145deg, #161616, #111)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 20, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "18px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 12, background: "rgba(0,0,0,0.2)" }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: isBtc ? "linear-gradient(135deg,#f7931a,#e06800)" : "linear-gradient(135deg,#28a0f0,#1366a8)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: "#fff", boxShadow: "0 2px 10px rgba(0,0,0,0.4)" }}>
          {isBtc ? "₿" : chain[0]?.toUpperCase() || "?"}
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "#555", marginBottom: 2 }}>{title}</div>
          <div style={{ fontSize: 15, fontWeight: 800, color }}>
            {asset} <span style={{ fontSize: 11, color: "#555", fontWeight: 500 }}>on {chain}</span>
          </div>
        </div>
      </div>
      {/* Fields */}
      <div style={{ padding: "0 24px" }}>
        <AmountField label="Amount" value={swap.amount} asset={swap.asset} />
        <HashField label="Swap ID" value={swap.swap_id} copy />
        <HashField label={title === "Source Chain" ? "Initiator" : "Redeemer"} value={swap.initiator ?? swap.redeemer} copy />
        <HashField label="Initiate TX" value={swap.initiate_tx_hash} copy />
        <HashField label="Redeem TX" value={swap.redeem_tx_hash} copy />
        <HashField label="Refund TX" value={swap.refund_tx_hash} copy />
        <div style={{ padding: "14px 0", borderBottom: "none" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "#555", marginBottom: 6 }}>
            {title === "Source Chain" ? "Initiate Timestamp" : "Redeem Timestamp"}
          </div>
          <div style={{ fontSize: 13, color: "#888" }}>
            {fmt(title === "Source Chain" ? swap.initiate_timestamp : swap.redeem_timestamp)}
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderDetailsContent() {
  const searchParams = useSearchParams();
  const [orderId] = useState(() => searchParams.get("orderId") ?? "");
  const [orderbookUrl] = useState(() => searchParams.get("orderbookUrl") ?? (typeof window !== "undefined" ? loadConfig().orderbookUrl ?? "" : ""));
  const [appId] = useState(() => searchParams.get("appId") ?? (typeof window !== "undefined" ? loadConfig().appId ?? "" : ""));
  const [order, setOrder] = useState<ExplorerOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchOrder = useCallback(async (silent = false) => {
    if (!orderbookUrl || !orderId) return;
    if (!silent) setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/swap/status?${new URLSearchParams({ orderbookUrl, orderId, ...(appId ? { appId } : {}) })}`);
      const data = await res.json() as ExplorerOrder | { error?: string };
      if (!res.ok) throw new Error("error" in data ? data.error ?? "Failed" : "Failed");
      setOrder(data as ExplorerOrder);
      setLastUpdated(new Date());
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { if (!silent) setLoading(false); }
  }, [orderbookUrl, orderId, appId]);

  useEffect(() => { void fetchOrder(); }, [fetchOrder]);
  useEffect(() => {
    if (!orderId || !orderbookUrl) return;
    const t = setInterval(() => void fetchOrder(true), 10000);
    return () => clearInterval(t);
  }, [fetchOrder, orderId, orderbookUrl]);

  const st = useMemo(() => order ? orderStatus(order) : null, [order]);

  const steps = order ? [
    { label: "Source Initiated", done: hasHash(order.source_swap.initiate_tx_hash) },
    { label: "Destination Initiated", done: hasHash(order.destination_swap.initiate_tx_hash) },
    { label: "Destination Redeemed", done: hasHash(order.destination_swap.redeem_tx_hash) },
    { label: "Source Redeemed", done: hasHash(order.source_swap.redeem_tx_hash) },
  ] : [];

  return (
    <div style={{ minHeight: "100vh", background: "var(--background, #080808)", color: "#e8e8e8", fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* Sticky header */}
      <header style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(8,8,8,0.95)", borderBottom: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(20px)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
          <Link href="/?tab=explorer" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: "#555", textDecoration: "none", letterSpacing: "0.5px", flexShrink: 0 }}
            onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.color = "#f7931a"}
            onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.color = "#555"}
          >
            <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span style={{ whiteSpace: "nowrap" }}>Back to Explorer</span>
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 12, overflowX: "auto", scrollbarWidth: "none" }}>
            {lastUpdated && <span style={{ fontSize: 11, color: "#333", whiteSpace: "nowrap" }}>Updated {lastUpdated.toLocaleTimeString()}</span>}
            {order && (
              <a href={`${orderbookUrl.replace(/\/+$/, "")}/v2/orders/${order.order_id}`} target="_blank" rel="noreferrer"
                style={{ fontSize: 11, fontWeight: 700, color: "#555", textDecoration: "none", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "5px 12px", whiteSpace: "nowrap" }}>
                View JSON API
              </a>
            )}
            <button onClick={() => void fetchOrder()} disabled={loading || !orderbookUrl || !orderId}
              style={{ fontSize: 11, fontWeight: 800, color: loading ? "#666" : "#000", background: loading ? "rgba(34,197,94,0.3)" : "#22c55e", border: "none", borderRadius: 8, padding: "6px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
              <svg style={{ width: 12, height: 12, animation: loading ? "spin 1s linear infinite" : "none" }} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {loading ? "Syncing…" : "Refresh"}
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 24 }}>

        {err && (
          <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 12, padding: "14px 18px", fontSize: 13, color: "#ef4444", wordBreak: "break-all" }}>{err}</div>
        )}

        {/* Order overview card */}
        {order && st && (
          <div style={{ background: "linear-gradient(145deg, #161616, #111)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 20, overflow: "hidden" }}>
            {/* Card header */}
            <div style={{ padding: "20px 28px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.2)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "#555", marginBottom: 8 }}>Order ID</div>
                <div style={{ fontSize: 13, fontFamily: "JetBrains Mono, monospace", color: "#888", wordBreak: "break-all" }}>{order.order_id}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: st.bg, border: `1px solid ${st.border}`, borderRadius: 12, padding: "8px 16px", flexShrink: 0 }}>
                {(st as { pulse?: boolean }).pulse && <div style={{ width: 7, height: 7, borderRadius: "50%", background: st.color, animation: "pulse 1.5s infinite" }} />}
                {!(st as { pulse?: boolean }).pulse && <div style={{ width: 7, height: 7, borderRadius: "50%", background: st.color }} />}
                <span style={{ fontSize: 12, fontWeight: 800, color: st.color, letterSpacing: "0.5px", textTransform: "uppercase" }}>{st.label}</span>
              </div>
            </div>
            {/* Meta grid */}
            <div style={{ padding: "20px 28px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 20 }}>
              {[
                { label: "Created", value: fmt(order.created_at) },
                { label: "Solver", value: order.solver_id ?? "—" },
                { label: "Integrator", value: order.integrator ?? "—" },
                { label: "Version", value: order.version ?? "—" },
              ].map(f => (
                <div key={f.label}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "#555", marginBottom: 6 }}>{f.label}</div>
                  <div style={{ fontSize: 13, color: "#ccc", wordBreak: "break-all" }}>{f.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Swap lifecycle */}
        {order && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            {steps.map((step, i) => (
              <div key={i} style={{ background: step.done ? "rgba(34,197,94,0.06)" : "rgba(255,255,255,0.02)", border: `1px solid ${step.done ? "rgba(34,197,94,0.2)" : "rgba(255,255,255,0.06)"}`, borderRadius: 14, padding: "16px 18px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: step.done ? "#22c55e" : "#444", letterSpacing: "0.5px", textTransform: "uppercase" }}>{i + 1}. {step.label}</span>
                  {step.done && (
                    <svg style={{ width: 16, height: 16, color: "#22c55e", flexShrink: 0 }} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: step.done ? "#22c55e" : "#333" }}>{step.done ? "Completed" : "Pending"}</span>
              </div>
            ))}
          </div>
        )}

        {/* Chain cards */}
        {order && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 20 }}>
            <ChainCard title="Source Chain" swap={order.source_swap} color="#f7931a" />
            <ChainCard title="Destination Chain" swap={order.destination_swap} color="#22c55e" />
          </div>
        )}

        {/* Orderbook URL input if missing */}
        {!orderbookUrl && (
          <div style={{ background: "rgba(247,147,26,0.06)", border: "1px solid rgba(247,147,26,0.15)", borderRadius: 12, padding: "16px 20px", fontSize: 13, color: "#f7931a" }}>
            No orderbook URL found. Go back to Explorer and configure it in Settings.
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !order && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {[180, 80, 300].map((h, i) => (
              <div key={i} style={{ height: h, background: "linear-gradient(90deg, #1a1a1a 25%, #222 50%, #1a1a1a 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite", borderRadius: 20 }} />
            ))}
          </div>
        )}

        {/* Raw data */}
        {order && (
          <div style={{ background: "linear-gradient(145deg, #161616, #111)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 20, overflow: "hidden" }}>
            <details>
              <summary style={{ padding: "18px 24px", cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "#555", display: "flex", alignItems: "center", gap: 8, listStyle: "none" }}>
                <svg style={{ width: 12, height: 12 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
                Raw Transaction Data
              </summary>
              <div style={{ padding: "0 24px 24px" }}>
                <pre style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "#666", background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: 16, overflow: "auto", maxHeight: 400, margin: 0 }}>
                  {JSON.stringify(order, null, 2)}
                </pre>
              </div>
            </details>
          </div>
        )}
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
        @keyframes shimmer { 0% { background-position:-200% 0; } 100% { background-position:200% 0; } }
      `}</style>
    </div>
  );
}

export default function OrderDetailsPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", background: "#080808", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 40, height: 40, border: "3px solid rgba(247,147,26,0.2)", borderTop: "3px solid #f7931a", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    }>
      <OrderDetailsContent />
    </Suspense>
  );
}
