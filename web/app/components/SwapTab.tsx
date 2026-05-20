"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { isValidSparkAddress } from "@buildonspark/spark-sdk";

interface Asset { id: string; chain: string; minAmount: string; decimals: number; }
interface SwapConfig { baseUrl:string; orderbookUrl:string; appId:string; evmPrivateKey:string; evmAddress:string; sparkAddress:string; evmRpcUrl:string; }
interface QuoteResult { source:{asset:string;amount:string}; destination:{asset:string;amount:string}; solver_id:string; fee:number; estimated_time:number; }
interface OrderRecord { orderId:string; fromAsset:string; toAsset:string; sendAmount:string; receiveAmount:string; createdAt:string; srcRedeemTx?:string; dstRedeemTx?:string; dstInitiateTx?:string; srcInitiateTx?:string; initiateTxHash?:string; }

const KEY = "garden_swap_config";
const ORDERS_KEY = "garden_swap_orders";

// Staging is hardcoded — these are not user-configurable.
const STAGING = {
  baseUrl: "http://gsg8cwk4k8oscg4sgcgg8ww8.garden-staging.dealpulley.com",
  orderbookUrl: "http://w4skog4oscw8sk00c8g8wg8s.garden-staging.dealpulley.com",
  appId: "5f4f9b96cdbe4d0c9f2dd95b7379b47fa44207dfcdabc0c12d15607ee1248f45",
} as const;

const EMPTY: SwapConfig = {
  baseUrl: STAGING.baseUrl,
  orderbookUrl: STAGING.orderbookUrl,
  appId: STAGING.appId,
  evmPrivateKey: "", evmAddress: "", sparkAddress: "", evmRpcUrl: "",
};

function load(): SwapConfig {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    // Staging URLs/appId are always overwritten — they are not user-editable.
    return { ...EMPTY, ...stored, baseUrl: STAGING.baseUrl, orderbookUrl: STAGING.orderbookUrl, appId: STAGING.appId };
  } catch { return EMPTY; }
}
function loadOrders(): OrderRecord[] { try { return JSON.parse(localStorage.getItem(ORDERS_KEY)??"[]"); } catch { return []; } }
function saveOrders(o: OrderRecord[]) { localStorage.setItem(ORDERS_KEY,JSON.stringify(o)); }

// Only EVM secrets are imported from .env. Spark address loads from env in WalletTab.
function parseEnv(txt: string): Partial<SwapConfig> {
  const r: Partial<SwapConfig> = {};
  for (const line of txt.split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const [k,...vs] = t.split("="); const v = vs.join("=").trim();
    if (!k||!v) continue;
    switch(k.toUpperCase()) {
      case "EVM_RPC_URL": r.evmRpcUrl=v; break;
      case "EVM_OWNER": r.evmAddress=v; break;
      case "EVM_PRIVATE_KEY": r.evmPrivateKey=v; break;
    }
  }
  return r;
}

function orderPhase(o: OrderRecord) {
  if (o.srcRedeemTx) return { label:"Completed", color:"#22c55e" };
  if (o.dstRedeemTx) return { label:"Redeeming", color:"#3b82f6" };
  if (o.dstInitiateTx) return { label:"Solver Initiated", color:"#a855f7" };
  if (o.srcInitiateTx||o.initiateTxHash) return { label:"Initiated", color:"#f59e0b" };
  return { label:"Pending", color:"#555" };
}

function chainGrad(chain:string) {
  const c = chain.toLowerCase();
  if (c.includes("bitcoin")||c.includes("spark")) return "linear-gradient(135deg,#f7931a,#e06800)";
  if (c.includes("arbitrum")) return "linear-gradient(135deg,#28a0f0,#1366a8)";
  if (c.includes("ethereum")||c.includes("eth")) return "linear-gradient(135deg,#627eea,#3b5bd5)";
  return "linear-gradient(135deg,#333,#1a1a1a)";
}

function AssetBadge({ id }: { id: string }) {
  const [chain, asset] = id.split(":");
  const letter = chain.toLowerCase().includes("bitcoin")||chain.toLowerCase().includes("spark") ? "₿" : chain[0].toUpperCase();
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      <div style={{ width:28,height:28,borderRadius:"50%",background:chainGrad(chain),display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:"#fff",boxShadow:"0 2px 8px rgba(0,0,0,0.4)" }}>{letter}</div>
      <div style={{ display:"flex",flexDirection:"column",lineHeight:1.2 }}>
        <span style={{ fontSize:14,fontWeight:800,color:"#f0f0f0" }}>{(asset||id).toUpperCase()}</span>
        <span style={{ fontSize:10,color:"#555",textTransform:"uppercase",letterSpacing:"0.5px" }}>{chain}</span>
      </div>
    </div>
  );
}

interface ManualAction { to: string; amount: string; asset: string; orderId: string; }

function ManualActionPanel({ action, onClose }: { action: ManualAction; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, val: string) => {
    navigator.clipboard.writeText(val).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };
  const Row = ({ k, v, copyKey }: { k: string; v: string; copyKey: string }) => (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(60px, auto) 1fr auto", alignItems: "center", gap: 12, padding: "10px 12px", background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 10 }}>
      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "1px", textTransform: "uppercase", color: "#555", whiteSpace: "nowrap" }}>{k}</span>
      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#ccc", wordBreak: "break-all", lineHeight: 1.4, minWidth: 0 }}>{v}</span>
      <button onClick={() => copy(copyKey, v)} style={{ background: copied === copyKey ? "rgba(34,197,94,0.15)" : "rgba(247,147,26,0.1)", border: `1px solid ${copied === copyKey ? "rgba(34,197,94,0.3)" : "rgba(247,147,26,0.2)"}`, color: copied === copyKey ? "#22c55e" : "#f7931a", borderRadius: 8, padding: "4px 8px", fontSize: 9, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
        {copied === copyKey ? "Copied" : "Copy"}
      </button>
    </div>
  );
  return (
    <div style={{ background: "linear-gradient(160deg, #161616, #0c0c0c)", border: "1px solid rgba(247,147,26,0.3)", borderRadius: 20, padding: "20px", boxShadow: "0 20px 40px rgba(0,0,0,0.4)", animation: "fadeIn 0.3s ease" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(247,147,26,0.15)", border: "1px solid rgba(247,147,26,0.3)", display: "flex", alignItems: "center", justifyContent: "center", color: "#f7931a", fontSize: 16, fontWeight: 900 }}>!</div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "1.2px", textTransform: "uppercase", color: "#f7931a" }}>Manual Action</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#f0f0f0" }}>Send Payment</div>
          </div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#444", fontSize: 18, cursor: "pointer" }}>×</button>
      </div>
      
      <p style={{ fontSize: 11, color: "#777", marginBottom: 14, lineHeight: 1.5 }}>
        Source chain settles via UTXO. Send the exact amount below to the solver address to complete the swap.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Row k="To" v={action.to} copyKey="to" />
        <Row k="Amount" v={`${action.amount} sats`} copyKey="amount" />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button onClick={() => copy("to", action.to)} style={{ flex: 1, background: "linear-gradient(135deg, #f7931a, #e55a00)", border: "none", borderRadius: 10, padding: "10px", fontSize: 12, fontWeight: 800, color: "#000", cursor: "pointer", boxShadow: "0 4px 12px rgba(247,147,26,0.2)" }}>
          {copied === "to" ? "Address Copied ✓" : "Copy Address"}
        </button>
      </div>
    </div>
  );
}

export default function SwapTab() {
  const [config,setConfig] = useState<SwapConfig>(EMPTY);
  const [showConfig,setShowConfig] = useState(false);
  const [envText,setEnvText] = useState("");
  const [manualAction,setManualAction] = useState<ManualAction|null>(null);
  const [assets,setAssets] = useState<Asset[]>([]);
  const [assetsLoading,setAssetsLoading] = useState(false);
  const [fromAsset,setFromAsset] = useState("");
  const [toAsset,setToAsset] = useState("");
  const [amount,setAmount] = useState("");
  const [quote,setQuote] = useState<QuoteResult|null>(null);
  const [quoteLoading,setQuoteLoading] = useState(false);
  const [quoteErr,setQuoteErr] = useState("");
  const [logs,setLogs] = useState<{text:string;type:"ok"|"err"|"info"}[]>([]);
  const [swapLoading,setSwapLoading] = useState(false);
  const [orders,setOrders] = useState<OrderRecord[]>([]);
  const cfgRef = useRef<SwapConfig>(EMPTY);
  const quoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quoteRequestId = useRef(0);
  const prevFromAssetRef = useRef<string | null>(null);

  const loadAssets = useCallback(async (cfg: SwapConfig) => {
    if (!cfg.baseUrl) return;
    setAssetsLoading(true);
    try {
      const [assetsRes, liqRes] = await Promise.all([
        fetch(`/api/swap/assets?baseUrl=${encodeURIComponent(cfg.baseUrl)}`),
        fetch(`/api/swap/liquidity?baseUrl=${encodeURIComponent(cfg.baseUrl)}`),
      ]);

      const assetsData = await assetsRes.json();
      const liqData = await liqRes.json();

      if (!assetsRes.ok) throw new Error(assetsData.error);
      
      const rawAssets: Asset[] = assetsData.assets ?? [];
      
      // Correctly parse the array-based liquidity response
      // The structure is { status: "Ok", result: [ { solver_id: "...", liquidity: [...] }, ... ] }
      const solvers = liqData.result ?? (Array.isArray(liqData) ? liqData : []);
      const devSolver = solvers.find((s: any) => s.solver_id === "devsolver");
      const devLiquidity = devSolver?.liquidity ?? [];
      
      // Map asset IDs to their balances for the devsolver
      const liqMap: Record<string, string | number> = {};
      devLiquidity.forEach((item: any) => {
        if (item.asset) liqMap[item.asset] = item.balance;
      });
      
      // Filter assets: must have a non-zero balance for the devsolver
      const list = rawAssets.filter(a => {
        const val = liqMap[a.id];
        return val !== undefined && BigInt(val) > 0n;
      });

      setAssets(list);
      
      const defaultFrom = "spark_regtest:btc";
      const defaultTo = "arbitrum_sepolia:wbtc";

      setFromAsset(p => {
        if (p && list.find(a => a.id === p)) return p;
        const found = list.find(a => a.id.toLowerCase() === defaultFrom);
        return found ? found.id : (list[0]?.id || "");
      });
      setToAsset(p => {
        if (p && list.find(a => a.id === p)) return p;
        const found = list.find(a => a.id.toLowerCase() === defaultTo);
        return found ? found.id : (list[1]?.id || list[0]?.id || "");
      });
    } catch { /* ignore */ }
    finally { setAssetsLoading(false); }
  }, []);

  useEffect(() => {
    (async () => {
      const s = load();
      // Auto-load EVM_RPC_URL and Spark address from server env
      try {
        const envConfig = await fetch("/api/config").then(r => r.json());
        if (envConfig?.evmRpcUrl && !s.evmRpcUrl) {
          s.evmRpcUrl = envConfig.evmRpcUrl;
        }
        if (envConfig?.sparkOwner && !s.sparkAddress) {
          s.sparkAddress = envConfig.sparkOwner;
        }
        localStorage.setItem(KEY, JSON.stringify(s));
      } catch (e) {
        console.error("Failed to load config from env:", e);
      }
      setConfig(s);
      cfgRef.current = s;
      // Show settings until the user has supplied an EVM key
      setShowConfig(!s.evmAddress);
      loadAssets(s);
      setOrders(loadOrders());
    })();
  }, [loadAssets]);

  const refreshOrder = useCallback(async (orderId: string) => {
    const cfg = cfgRef.current;
    if (!cfg.orderbookUrl) return;
    try {
      const p = new URLSearchParams({ orderbookUrl:cfg.orderbookUrl, orderId, ...(cfg.appId?{appId:cfg.appId}:{}) });
      const res = await fetch(`/api/swap/status?${p}`);
      if (!res.ok) return;
      const data = await res.json();
      setOrders(prev => {
        const next = prev.map(o => o.orderId!==orderId ? o : {
          ...o,
          srcInitiateTx: data.source_swap?.initiate_tx_hash ?? o.srcInitiateTx,
          dstInitiateTx: data.destination_swap?.initiate_tx_hash ?? o.dstInitiateTx,
          dstRedeemTx: data.destination_swap?.redeem_tx_hash ?? o.dstRedeemTx,
          srcRedeemTx: data.source_swap?.redeem_tx_hash ?? o.srcRedeemTx,
        });
        saveOrders(next); return next;
      });
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const pending = orders.filter(o => !o.srcRedeemTx);
    if (!pending.length) return;
    const t = setInterval(() => pending.forEach(o => refreshOrder(o.orderId)), 10000);
    return () => clearInterval(t);
  }, [orders, refreshOrder]);

  const fromInfo = useMemo(() => assets.find(a => a.id===fromAsset), [assets,fromAsset]);
  const toInfo = useMemo(() => assets.find(a => a.id===toAsset), [assets,toAsset]);
  const sparkRequired = useMemo(() => fromAsset.startsWith("spark") || toAsset.startsWith("spark"), [fromAsset, toAsset]);
  const sparkAddressTrimmed = config.sparkAddress.trim();
  const sparkAddressValid = useMemo(() => !sparkRequired || (sparkAddressTrimmed && isValidSparkAddress(sparkAddressTrimmed)), [sparkRequired, sparkAddressTrimmed]);

  // Convert a human decimal string ("0.00000005") into integer base units ("5") using `decimals`.
  function toBaseUnits(decimal: string, decimals: number): string {
    const trimmed = decimal.trim();
    if (!trimmed) throw new Error("Amount required");
    if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === ".") throw new Error("Invalid amount");
    const [intPart = "0", fracPart = ""] = trimmed.split(".");
    if (fracPart.length > decimals) throw new Error(`Too many decimals (max ${decimals})`);
    const padded = (fracPart + "0".repeat(decimals)).slice(0, decimals);
    const combined = (intPart + padded).replace(/^0+/, "") || "0";
    return combined;
  }
  function fromBaseUnits(base: string | number, decimals: number): string {
    const s = String(base);
    if (decimals === 0) return s;
    const padded = s.padStart(decimals + 1, "0");
    const intPart = padded.slice(0, padded.length - decimals);
    const fracPart = padded.slice(padded.length - decimals).replace(/0+$/, "");
    return fracPart ? `${intPart}.${fracPart}` : intPart;
  }

  useEffect(() => {
    if (!fromInfo || prevFromAssetRef.current === fromAsset) return;
    const isFirstLoad = prevFromAssetRef.current === null;
    prevFromAssetRef.current = fromAsset;
    
    // Default to 0.00000005 if it's the first load and we're on Spark BTC
    if (isFirstLoad && fromAsset.toLowerCase() === "spark_regtest:btc") {
      setAmount("0.00000005");
    } else {
      const min = fromBaseUnits(fromInfo.minAmount, fromInfo.decimals);
      setAmount(min);
    }
    
    setQuote(null);
    setQuoteErr("");
  }, [fromAsset, fromInfo]);

  useEffect(() => {
    if (quoteTimerRef.current) {
      clearTimeout(quoteTimerRef.current);
      quoteTimerRef.current = null;
    }
    const requestId = ++quoteRequestId.current;
    setQuoteErr("");
    if (!fromAsset || !toAsset || !amount || !fromInfo) {
      setQuote(null);
      setQuoteLoading(false);
      return;
    }
    if (!/^\d*\.?\d*$/.test(amount) || amount === ".") {
      setQuote(null);
      setQuoteLoading(false);
      return;
    }
    setQuote(null);
    quoteTimerRef.current = setTimeout(() => { void getQuote(requestId); }, 400);
    return () => {
      if (quoteTimerRef.current) {
        clearTimeout(quoteTimerRef.current);
        quoteTimerRef.current = null;
      }
    };
  }, [fromAsset, toAsset, amount, fromInfo, config.baseUrl, config.appId]);

  async function getQuote(requestId: number) {
    if (!fromAsset||!toAsset||!amount||!fromInfo) return;
    setQuoteLoading(true); setQuoteErr(""); setQuote(null);
    try {
      const amountBase = toBaseUnits(amount, fromInfo.decimals);
      if (BigInt(amountBase) < BigInt(fromInfo.minAmount)) {
        throw new Error(`Below minimum (${fromBaseUnits(fromInfo.minAmount, fromInfo.decimals)} ${fromInfo.id.split(":")[1].toUpperCase()})`);
      }
      const p = new URLSearchParams({ baseUrl:config.baseUrl, from:fromAsset, to:toAsset, amount: amountBase, appId:config.appId });
      const res = await fetch(`/api/swap/quote?${p}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (requestId !== quoteRequestId.current) return;
      setQuote((data.result??[])[0]??null);
    } catch(e) {
      if (requestId !== quoteRequestId.current) return;
      setQuoteErr(e instanceof Error?e.message:String(e));
    }
    finally {
      if (requestId === quoteRequestId.current) setQuoteLoading(false);
    }
  }

  async function executeSwap() {
    if (!quote) return;
    const { evmPrivateKey,evmAddress,sparkAddress,evmRpcUrl,orderbookUrl,baseUrl,appId } = config;
    if (!evmAddress) return setLogs([{text:"Set EVM address in config.",type:"err"}]);
    if (sparkRequired && !sparkAddressTrimmed) return setLogs([{text:"Set Spark address in config.",type:"err"}]);
    if (sparkRequired && !isValidSparkAddress(sparkAddressTrimmed)) return setLogs([{text:"Spark address is invalid.",type:"err"}]);
    setSwapLoading(true); setLogs([]);
    try {
      const destAddress = toAsset.startsWith("spark") ? sparkAddressTrimmed : evmAddress;
      setLogs([{text:"Creating order…",type:"info"}]);
      const amountBase = fromInfo ? toBaseUnits(amount, fromInfo.decimals) : amount;
      const orderRes = await fetch("/api/swap/order",{ method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({orderbookUrl,baseUrl,appId,from:fromAsset,to:toAsset,amount:amountBase,evmAddress,sparkAddress:sparkAddressTrimmed,destAddress,quote}) });
      const orderData = await orderRes.json();
      if (!orderRes.ok) throw new Error(orderData.error);
      const order = orderData.order;
      const orderId = order.order_id??order.id;
      const record: OrderRecord = { orderId,fromAsset,toAsset, sendAmount:quote.source.amount, receiveAmount:quote.destination.amount, createdAt:new Date().toISOString() };
      const isUtxoSource = fromAsset.startsWith("spark") || fromAsset.startsWith("bitcoin");
      if (isUtxoSource) {
        const to = (order.to as string | undefined) ?? "";
        const amt = (order.amount as string | undefined) ?? quote.source.amount;
        if (to) {
          setManualAction({ to, amount: String(amt), asset: fromAsset, orderId });
          setLogs(l => [...l, { text: "Manual initiation required: please send the payment.", type: "info" }]);
        } else {
          setLogs(l => [...l, { text: "Order created, but no payment address was returned.", type: "err" }]);
        }
      }
      if (!isUtxoSource && (order.approval_transaction||order.initiate_transaction)) {
        setLogs(l=>[...l,{text:"Sending EVM transactions…",type:"info"}]);
        const execRes = await fetch("/api/swap/execute",{ method:"POST", headers:{"Content-Type":"application/json"},
          body:JSON.stringify({privateKey:evmPrivateKey,rpcUrl:evmRpcUrl,order}) });
        const execData = await execRes.json();
        if (!execRes.ok) throw new Error(execData.error);
        for (const log of execData.logs??[]) {
          setLogs(l=>[...l,{text:log,type:"ok"}]);
          if (log.includes("Initiate tx:")) record.initiateTxHash=log.split("Initiate tx:")[1].trim();
        }
      }
      setOrders(prev=>{ const next=[record,...prev]; saveOrders(next); return next; });
      
      if (isUtxoSource) {
        setLogs(l=>[...l,{text:"Order created! Please complete the manual transfer.",type:"ok"}]);
      } else {
        setLogs(l=>[...l,{text:"Swap initiated on-chain!",type:"ok"}]);
      }
      
      setQuote(null); setAmount("");
    } catch(e) { setLogs(l=>[...l,{text:e instanceof Error?e.message:String(e),type:"err"}]); }
    finally { setSwapLoading(false); }
  }

  function saveConfig(c: SwapConfig) { localStorage.setItem(KEY,JSON.stringify(c)); cfgRef.current=c; }

  const inp: React.CSSProperties = {
    background:"#0a0a0a", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10,
    color:"#e0e0e0", fontSize:13, padding:"10px 14px", outline:"none", width:"100%", fontFamily:"inherit",
  };

  return (
    <div style={{ padding:"32px 20px", maxWidth:580, margin:"0 auto", display:"flex", flexDirection:"column", gap:20 }}>

      {/* Network status bar */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:7,height:7,borderRadius:"50%", background:"#22c55e", boxShadow:"0 0 8px rgba(34,197,94,0.5)" }} />
          <span style={{ fontSize:11,fontWeight:600,color:"#555",letterSpacing:"0.5px" }}>Staging · {config.evmAddress?"Signer Loaded":"No Signer"}</span>
        </div>
        <button onClick={()=>setShowConfig(!showConfig)} style={{ background:"none",border:"none",fontSize:11,fontWeight:600,color:"#555",cursor:"pointer",letterSpacing:"0.5px" }}>
          {showConfig?"✕ Close":"⚙ Settings"}
        </button>
      </div>

      {/* Config Panel */}
      {showConfig && (() => {
        const importEnv = () => {
          const p = parseEnv(envText);
          if (Object.keys(p).length === 0) return;
          const u = { ...config, ...p };
          setConfig(u); saveConfig(u); loadAssets(u); setEnvText("");
        };
        const fields = [
          { ph: "EVM Address", env: "EVM_OWNER", val: config.evmAddress, key: "evmAddress" as const, required: true },
          { ph: "EVM Private Key", env: "EVM_PRIVATE_KEY", val: config.evmPrivateKey, key: "evmPrivateKey" as const, pwd: true, required: true },
        ];
        return (
          <div style={{ background: "linear-gradient(160deg, #131313, #0c0c0c)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 18, overflow: "hidden", boxShadow: "0 12px 32px rgba(0,0,0,0.4)" }}>
            {/* Header */}
            <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(247,147,26,0.03)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(247,147,26,0.12)", border: "1px solid rgba(247,147,26,0.25)", display: "flex", alignItems: "center", justifyContent: "center", color: "#f7931a", fontSize: 13, fontWeight: 800 }}>⚙</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#f0f0f0" }}>Signer Configuration</div>
                  <div style={{ fontSize: 10, color: "#555", marginTop: 1 }}>Staging URLs & app ID are baked in</div>
                </div>
              </div>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: "#f7931a", background: "rgba(247,147,26,0.08)", border: "1px solid rgba(247,147,26,0.2)", padding: "4px 9px", borderRadius: 999 }}>Local-only</span>
            </div>

            {/* Body */}
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
              {/* Env import block */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "1.3px", textTransform: "uppercase", color: "#666" }}>Quick Import</span>
                  <span style={{ fontSize: 10, color: "#444" }}>Paste your <code style={{ background: "#0a0a0a", padding: "1px 5px", borderRadius: 4, color: "#888", fontFamily: "JetBrains Mono,monospace" }}>.env</code> contents</span>
                </div>
                <div style={{ position: "relative" }}>
                  <textarea
                    placeholder={"EVM_PRIVATE_KEY=0x…\nEVM_OWNER=0x…"}
                    rows={5}
                    value={envText}
                    onChange={e => setEnvText(e.target.value)}
                    style={{
                      width: "100%",
                      background: "#070707",
                      border: "1px solid rgba(255,255,255,0.07)",
                      borderRadius: 12,
                      color: "#e0e0e0",
                      fontFamily: "JetBrains Mono, monospace",
                      fontSize: 11,
                      lineHeight: 1.65,
                      padding: "12px 14px",
                      outline: "none",
                      resize: "vertical",
                      minHeight: 110,
                      boxShadow: "inset 0 1px 2px rgba(0,0,0,0.4)",
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = "rgba(247,147,26,0.4)")}
                    onBlur={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)")}
                  />
                  <button
                    onClick={importEnv}
                    disabled={!envText.trim()}
                    style={{
                      position: "absolute",
                      right: 10,
                      bottom: 10,
                      background: envText.trim() ? "linear-gradient(135deg, #f7931a, #e55a00)" : "rgba(255,255,255,0.05)",
                      border: "none",
                      borderRadius: 8,
                      padding: "7px 14px",
                      fontSize: 11,
                      fontWeight: 800,
                      color: envText.trim() ? "#000" : "#555",
                      cursor: envText.trim() ? "pointer" : "default",
                      letterSpacing: "0.3px",
                      boxShadow: envText.trim() ? "0 2px 8px rgba(247,147,26,0.3)" : "none",
                    }}
                  >
                    Parse →
                  </button>
                </div>
              </div>

              {/* Divider */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.05)" }} />
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "1.5px", color: "#333", textTransform: "uppercase" }}>or fill manually</span>
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.05)" }} />
              </div>

              {/* Manual fields */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {fields.map(f => (
                  <div key={f.key}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#888", letterSpacing: "0.3px" }}>{f.ph}</span>
                      <span style={{ fontSize: 9, fontFamily: "JetBrains Mono,monospace", color: f.required ? "#f7931a" : "#444", background: f.required ? "rgba(247,147,26,0.06)" : "transparent", padding: "2px 6px", borderRadius: 4 }}>
                        {f.env}{f.required ? "" : " · optional"}
                      </span>
                    </div>
                    <input
                      type={f.pwd ? "password" : "text"}
                      placeholder={f.pwd ? "0x…" : f.env.startsWith("EVM_RPC") ? "https://…" : f.env.startsWith("SPARK") ? "spark1…" : "0x…"}
                      value={f.val}
                      onChange={e => setConfig({ ...config, [f.key]: e.target.value })}
                      style={{
                        width: "100%",
                        background: "#070707",
                        border: `1px solid ${f.required && !f.val ? "rgba(247,147,26,0.15)" : "rgba(255,255,255,0.07)"}`,
                        borderRadius: 10,
                        color: "#e0e0e0",
                        fontFamily: f.pwd ? "JetBrains Mono,monospace" : "inherit",
                        fontSize: 12,
                        padding: "10px 12px",
                        outline: "none",
                      }}
                      onFocus={e => (e.currentTarget.style.borderColor = "rgba(247,147,26,0.4)")}
                      onBlur={e => (e.currentTarget.style.borderColor = f.required && !f.val ? "rgba(247,147,26,0.15)" : "rgba(255,255,255,0.07)")}
                    />
                  </div>
                ))}
              </div>

              {/* Save */}
              <button
                onClick={() => { saveConfig(config); loadAssets(config); setShowConfig(false); }}
                disabled={!config.evmAddress || !config.evmPrivateKey}
                style={{
                  background: (!config.evmAddress || !config.evmPrivateKey) ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg, #f7931a, #e55a00)",
                  border: "none",
                  borderRadius: 12,
                  padding: "13px",
                  fontSize: 13,
                  fontWeight: 800,
                  color: (!config.evmAddress || !config.evmPrivateKey) ? "#555" : "#000",
                  cursor: (!config.evmAddress || !config.evmPrivateKey) ? "default" : "pointer",
                  letterSpacing: "0.3px",
                  boxShadow: (!config.evmAddress || !config.evmPrivateKey || !config.evmRpcUrl) ? "none" : "0 4px 16px rgba(247,147,26,0.25)",
                }}
              >
                Save &amp; Connect
              </button>
            </div>

            {/* Footer pinned info */}
            <div style={{ padding: "10px 20px", borderTop: "1px solid rgba(255,255,255,0.04)", background: "rgba(0,0,0,0.3)", fontSize: 10, color: "#444", fontFamily: "JetBrains Mono,monospace", lineHeight: 1.6, wordBreak: "break-all" }}>
              <div><span style={{ color: "#666" }}>GARDEN_BASE_URL</span> = <span style={{ color: "#555" }}>{STAGING.baseUrl.replace(/^https?:\/\//, "")}</span></div>
              <div><span style={{ color: "#666" }}>ORDERBOOK_BASE_URL</span> = <span style={{ color: "#555" }}>{STAGING.orderbookUrl.replace(/^https?:\/\//, "")}</span></div>
              <div><span style={{ color: "#666" }}>GARDEN_APP_ID</span> = <span style={{ color: "#555" }}>{STAGING.appId.slice(0, 8)}…{STAGING.appId.slice(-8)}</span></div>
            </div>
          </div>
        );
      })()}

      {/* Swap Box */}
      <div style={{ background:"rgba(20,20,20,0.7)",backdropFilter:"blur(24px)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:24,padding:8,position:"relative",overflow:"hidden",boxShadow:"0 16px 40px rgba(0,0,0,0.5)" }}>
        <div style={{ position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,transparent,rgba(247,147,26,0.5),transparent)" }} />

        {/* From */}
        <div style={{ background:"rgba(0,0,0,0.4)",border:"1px solid rgba(255,255,255,0.03)",borderRadius:20,padding:"20px 20px 16px",boxShadow:"inset 0 2px 10px rgba(0,0,0,0.2)", minWidth: 0 }}>
          <div style={{ display:"flex",justifyContent:"space-between",marginBottom:12, flexWrap: "wrap", gap: 4 }}>
            <span style={{ fontSize:11,fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",color:"#555" }}>Sell</span>
            {fromInfo && <span style={{ fontSize:11,color:"#444", wordBreak: "break-all" }}>Min: {(() => { const amt = Number(fromInfo.minAmount) / Math.pow(10, fromInfo.decimals); return amt.toLocaleString(undefined, { maximumFractionDigits: fromInfo.decimals }).replace(/\.0+$/,''); })()} {fromInfo.id.split(":")[1].toUpperCase()}</span>}
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:12 }}>
            <input type="text" inputMode="decimal" placeholder="0.00" value={amount} onChange={e=>{const v=e.target.value;if(v===""||/^\d*\.?\d*$/.test(v)){setAmount(v);setQuoteErr("");}}}
              style={{ background:"transparent",border:"none",outline:"none",fontSize:28,fontWeight:800,color:amount?"#f0f0f0":"#2a2a2a",width:"100%",fontFamily:"inherit", minWidth: 0 }} />
            {assetsLoading ? (
              <div style={{ width:110,height:40,borderRadius:12,background:"#1a1a1a", flexShrink: 0 }} />
            ) : (
              <select value={fromAsset} onChange={e=>{const next=e.target.value;if(next!==fromAsset){setFromAsset(next);setQuoteErr("");}}}
                style={{ background:"#1a1a1a",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,color:"#f0f0f0",fontSize:13,fontWeight:700,padding:"8px 12px",outline:"none",cursor:"pointer",minWidth:120, flexShrink: 0 }}>
                {assets.map(a=><option key={a.id} value={a.id}>{a.id.split(":")[1]?.toUpperCase()||a.id} ({a.chain})</option>)}
              </select>
            )}
          </div>
          {fromAsset && <div style={{ marginTop:10 }}><AssetBadge id={fromAsset} /></div>}
        </div>

        {/* Switch */}
        <div style={{ display:"flex",justifyContent:"center",margin:"-14px 0",position:"relative",zIndex:2 }}>
          <button onClick={()=>{setFromAsset(toAsset);setToAsset(fromAsset);setQuoteErr("");}}
            style={{ background:"#1a1a1a",border:"4px solid #141414",borderRadius:"50%",width:44,height:44,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:18,color:"#888",transition:"all 0.2s",boxShadow:"0 4px 12px rgba(0,0,0,0.5)", flexShrink: 0 }}
            onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor="rgba(247,147,26,0.2)";(e.currentTarget as HTMLButtonElement).style.color="#f7931a";}}
            onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor="#141414";(e.currentTarget as HTMLButtonElement).style.color="#888";}}
          >↕</button>
        </div>

        {/* To */}
        <div style={{ background:"rgba(0,0,0,0.4)",border:"1px solid rgba(255,255,255,0.03)",borderRadius:20,padding:"20px 20px 16px",boxShadow:"inset 0 2px 10px rgba(0,0,0,0.2)", minWidth: 0 }}>
          <div style={{ display:"flex",justifyContent:"space-between",marginBottom:12 }}>
            <span style={{ fontSize:11,fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",color:"#555" }}>Buy</span>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:12 }}>
            <div style={{ fontSize:28,fontWeight:800,color:quote?"#22c55e":"#2a2a2a",width:"100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
              {quote ? (toInfo ? fromBaseUnits(quote.destination.amount, toInfo.decimals) : quote.destination.amount) : (quoteLoading ? "…" : "0.00")}
            </div>
            {assetsLoading ? (
              <div style={{ width:110,height:40,borderRadius:12,background:"#1a1a1a", flexShrink: 0 }} />
            ) : (
              <select value={toAsset} onChange={e=>{const next=e.target.value;if(next!==toAsset){setToAsset(next);setQuoteErr("");}}}
                style={{ background:"#1a1a1a",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,color:"#f0f0f0",fontSize:13,fontWeight:700,padding:"8px 12px",outline:"none",cursor:"pointer",minWidth:120, flexShrink: 0 }}>
                {assets.map(a=><option key={a.id} value={a.id}>{a.id.split(":")[1]?.toUpperCase()||a.id} ({a.chain})</option>)}
              </select>
            )}
          </div>
          {toAsset && <div style={{ marginTop:10 }}><AssetBadge id={toAsset} /></div>}
        </div>

        {/* Actions */}
        <div style={{ padding:"12px 6px 6px" }}>
          {quoteErr && <div style={{ marginBottom:10,padding:"10px 14px",background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:10,fontSize:12,color:"#ef4444",wordBreak:"break-word",overflowWrap:"anywhere" }}>{quoteErr}</div>}
          {sparkRequired && !sparkAddressValid && (
            <div style={{ marginBottom:10,padding:"10px 14px",background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:10,fontSize:12,color:"#ef4444",wordBreak:"break-word",overflowWrap:"anywhere" }}>
              Enter a valid Spark address in Settings.
            </div>
          )}

          {quote && (
            <div style={{ marginBottom:10,background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)",borderRadius:14,padding:"14px 16px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
              {[
                { label:"Market Maker", val:quote.solver_id },
                { label:"Protocol Fee", val:`${quote.fee} bips` },
                { label:"Est. Time", val:`~${quote.estimated_time}s` },
                { label:"Route", val:`${fromAsset.split(":")[1]?.toUpperCase()} → ${toAsset.split(":")[1]?.toUpperCase()}` },
              ].map(r=>(
                <div key={r.label} style={{ display:"flex",flexDirection:"column",gap:3 }}>
                  <span style={{ fontSize:9,fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",color:"#444" }}>{r.label}</span>
                  <span style={{ fontSize:12,fontWeight:700,color:"#aaa" }}>{r.val}</span>
                </div>
              ))}
            </div>
          )}
          <button onClick={executeSwap} disabled={!quote||quoteLoading||swapLoading||!config.evmAddress||!sparkAddressValid}
            style={{ width:"100%",background:(!quote||quoteLoading||swapLoading||!config.evmAddress||!sparkAddressValid)?"rgba(255,255,255,0.05)":"#22c55e",boxShadow:(!quote||quoteLoading||swapLoading||!config.evmAddress||!sparkAddressValid)?"none":"0 4px 15px rgba(34,197,94,0.3)",border:"none",borderRadius:18,padding:"16px",fontSize:15,fontWeight:800,color:(!quote||quoteLoading||swapLoading||!config.evmAddress||!sparkAddressValid)?"#555":"#000",cursor:(!quote||quoteLoading||swapLoading||!config.evmAddress||!sparkAddressValid)?"default":"pointer",transition:"all 0.2s" }}>
            {!config.evmAddress ? "Configure EVM signer first" : !sparkAddressValid ? "Set valid Spark address" : swapLoading ? "Executing…" : quoteLoading ? "Fetching quote…" : "Swap"}
          </button>
        </div>
      </div>

      {manualAction && <ManualActionPanel action={manualAction} onClose={() => setManualAction(null)} />}

      {/* Logs */}
      {logs.length > 0 && (
        <div style={{ background:"#080808",border:"1px solid rgba(255,255,255,0.05)",borderRadius:14,padding:"14px 16px" }}>
          <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:10 }}>
            <div style={{ width:6,height:6,borderRadius:"50%",background:"#22c55e",animation:"pulse 1.5s infinite" }} />
            <span style={{ fontSize:10,fontWeight:700,letterSpacing:"1.2px",textTransform:"uppercase",color:"#444" }}>Execution Log</span>
          </div>
          {logs.map((l,i)=>(
            <div key={i} style={{ fontFamily:"JetBrains Mono,monospace",fontSize:11,display:"flex",gap:8,marginBottom:4,color:l.type==="err"?"#ef4444":l.type==="ok"?"#22c55e":"#555",alignItems:"flex-start" }}>
              <span style={{ opacity:0.4 }}>[{l.type==="ok"?"PASS":l.type==="err"?"FAIL":"WAIT"}]</span>
              <span style={{ wordBreak:"break-word",overflowWrap:"anywhere" }}>{l.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Order History */}
      {orders.length > 0 && (
        <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0 4px" }}>
            <span style={{ fontSize:11,fontWeight:700,letterSpacing:"1.2px",textTransform:"uppercase",color:"#444" }}>Recent Swaps</span>
            <button onClick={()=>{setOrders([]);saveOrders([]);}} style={{ background:"none",border:"none",fontSize:11,color:"#333",cursor:"pointer",fontWeight:600 }}>Clear</button>
          </div>
          {orders.map(o=>{
            const ph = orderPhase(o);
            const explorerLink = `https://lo7f6nzsz0rpumbmurojel17.garden-staging.dealpulley.com/order/${o.orderId}`;
            return (
              <a 
                key={o.orderId} 
                href={explorerLink} 
                target="_blank" 
                rel="noopener noreferrer" 
                style={{ background:"#0f0f0f",border:"1px solid rgba(255,255,255,0.06)",borderRadius:16,padding:"16px 18px", textDecoration: "none", display: "block", transition: "all 0.2s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(247,147,26,0.3)"; e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; e.currentTarget.style.background = "#0f0f0f"; }}
              >
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
                  <span style={{ fontFamily:"JetBrains Mono,monospace",fontSize:11,color:"#444" }}>{o.orderId.slice(0,8)}…{o.orderId.slice(-6)}</span>
                  <div style={{ display:"flex",alignItems:"center",gap:6,background:`${ph.color}12`,border:`1px solid ${ph.color}30`,borderRadius:8,padding:"3px 10px" }}>
                    <div style={{ width:5,height:5,borderRadius:"50%",background:ph.color }} />
                    <span style={{ fontSize:10,fontWeight:800,color:ph.color,letterSpacing:"0.8px",textTransform:"uppercase" }}>{ph.label}</span>
                  </div>
                </div>
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between" }}>
                  <div>
                    <div style={{ fontSize:16,fontWeight:800,color:"#f0f0f0" }}>{o.sendAmount}</div>
                    <div style={{ fontSize:10,color:"#555",textTransform:"uppercase",letterSpacing:"0.8px" }}>{o.fromAsset.split(":")[1]}</div>
                  </div>
                  <svg style={{ width:20,height:20,color:"#333" }} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:16,fontWeight:800,color:"#22c55e" }}>{o.receiveAmount}</div>
                    <div style={{ fontSize:10,color:"#555",textTransform:"uppercase",letterSpacing:"0.8px" }}>{o.toAsset.split(":")[1]}</div>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
    </div>
  );
}
