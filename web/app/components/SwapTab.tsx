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
  const [connectingMM, setConnectingMM] = useState(false);
  const [mmError, setMMError] = useState("");
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

  const STATIC_ASSETS: Asset[] = [
    { id: "spark_regtest:btc",     chain: "spark_regtest",    minAmount: "5",              decimals: 8  },
    { id: "arbitrum_sepolia:wbtc", chain: "arbitrum_sepolia", minAmount: "10",             decimals: 8  },
    { id: "arbitrum_sepolia:eth",  chain: "arbitrum_sepolia", minAmount: "500000000000000", decimals: 18 },
  ];

  const loadAssets = useCallback((_cfg: SwapConfig) => {
    setAssets(STATIC_ASSETS);
    setFromAsset(p => (p && STATIC_ASSETS.find(a => a.id === p)) ? p : "spark_regtest:btc");
    setToAsset(p  => (p && STATIC_ASSETS.find(a => a.id === p)) ? p : "arbitrum_sepolia:wbtc");
  }, []);

  useEffect(() => {
    (async () => {
      let s = load();
      // Auto-load EVM_RPC_URL from env, and Spark address from connected wallet session
      try {
        const [envConfig, status] = await Promise.all([
          fetch("/api/config").then(r => r.json()),
          fetch("/api/status").then(r => r.json()),
        ]);
        let changed = false;
        if (envConfig?.evmRpcUrl && !s.evmRpcUrl) {
          s.evmRpcUrl = envConfig.evmRpcUrl;
          changed = true;
        }
        // Always sync Spark address from connected wallet; fall back to SPARK_OWNER env
        const sparkAddr = status?.address || envConfig?.sparkOwner;
        if (sparkAddr && s.sparkAddress !== sparkAddr) {
          s.sparkAddress = sparkAddr;
          changed = true;
        }
        if (changed) {
          localStorage.setItem(KEY, JSON.stringify(s));
        }
      } catch (e) {
        console.error("Failed to load config:", e);
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
  const sparkAddressValid = useMemo(() => {
    if (!sparkRequired) return true; // Spark not required, so it's valid
    if (!sparkAddressTrimmed) return false; // Spark required but not set
    return isValidSparkAddress(sparkAddressTrimmed); // Validate if set
  }, [sparkRequired, sparkAddressTrimmed]);

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

      {/* MetaMask prompt — visible inline when not connected */}
      {!config.evmAddress && !showConfig && (
        <div style={{ background: "linear-gradient(135deg, rgba(247,147,26,0.08), rgba(247,147,26,0.04))", border: "1px solid rgba(247,147,26,0.25)", borderRadius: 18, padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(247,147,26,0.12)", border: "1px solid rgba(247,147,26,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>🦊</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#f0f0f0", marginBottom: 3 }}>Connect MetaMask</div>
              <div style={{ fontSize: 11, color: "#666" }}>Required to sign EVM transactions</div>
            </div>
          </div>
          <button
            onClick={async () => {
              setConnectingMM(true);
              setMMError("");
              try {
                if (!(window as any).ethereum) throw new Error("MetaMask not found. Please install MetaMask");
                const accounts = await (window as any).ethereum.request({ method: "eth_requestAccounts" });
                const cfg = { ...config, evmAddress: accounts[0] };
                setConfig(cfg);
                saveConfig(cfg);
                loadAssets(cfg);
              } catch (e: unknown) {
                setMMError(e instanceof Error ? e.message : String(e));
              } finally {
                setConnectingMM(false);
              }
            }}
            disabled={connectingMM}
            style={{ background: connectingMM ? "rgba(247,147,26,0.3)" : "linear-gradient(135deg, #f7931a, #e55a00)", border: "none", borderRadius: 12, padding: "10px 20px", fontSize: 13, fontWeight: 800, color: connectingMM ? "#888" : "#000", cursor: connectingMM ? "default" : "pointer", whiteSpace: "nowrap", boxShadow: connectingMM ? "none" : "0 4px 12px rgba(247,147,26,0.25)", flexShrink: 0 }}
          >
            {connectingMM ? "Connecting…" : "Connect"}
          </button>
        </div>
      )}
      {mmError && !showConfig && (
        <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "12px 14px", fontSize: 12, color: "#ef4444" }}>
          {mmError}
        </div>
      )}

      {/* Config Panel */}
      {showConfig && (
        <div style={{ background: "linear-gradient(160deg, #131313, #0c0c0c)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 18, overflow: "hidden", boxShadow: "0 12px 32px rgba(0,0,0,0.4)" }}>
          <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(247,147,26,0.03)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: config.evmAddress ? "rgba(34,197,94,0.12)" : "rgba(247,147,26,0.12)", border: `1px solid ${config.evmAddress ? "rgba(34,197,94,0.25)" : "rgba(247,147,26,0.25)"}`, display: "flex", alignItems: "center", justifyContent: "center", color: config.evmAddress ? "#22c55e" : "#f7931a", fontSize: 13, fontWeight: 800 }}>
                {config.evmAddress ? "✓" : "🦊"}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#f0f0f0" }}>
                  {config.evmAddress ? "MetaMask Connected" : "Connect Signer"}
                </div>
                <div style={{ fontSize: 10, color: "#555", marginTop: 1 }}>
                  {config.evmAddress ? `${config.evmAddress.slice(0, 6)}...${config.evmAddress.slice(-4)}` : "MetaMask required for EVM swaps"}
                </div>
              </div>
            </div>
          </div>

          <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
            {mmError && (
              <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "12px 14px", fontSize: 12, color: "#ef4444" }}>
                {mmError}
              </div>
            )}
            {!config.evmAddress ? (
              <button
                onClick={async () => {
                  setConnectingMM(true);
                  setMMError("");
                  try {
                    if (!(window as any).ethereum) {
                      throw new Error("MetaMask not found. Please install MetaMask");
                    }
                    const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
                    const cfg = { ...config, evmAddress: accounts[0] };
                    setConfig(cfg);
                    saveConfig(cfg);
                    loadAssets(cfg);
                  } catch (e: unknown) {
                    setMMError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setConnectingMM(false);
                  }
                }}
                disabled={connectingMM}
                style={{
                  width: "100%",
                  background: connectingMM ? "rgba(247,147,26,0.3)" : "linear-gradient(135deg, #f7931a, #e55a00)",
                  border: "none",
                  borderRadius: 12,
                  padding: "16px",
                  fontSize: 15,
                  fontWeight: 800,
                  color: connectingMM ? "#888" : "#000",
                  cursor: connectingMM ? "default" : "pointer",
                  letterSpacing: "0.3px",
                  boxShadow: connectingMM ? "none" : "0 4px 16px rgba(247,147,26,0.25)",
                }}
              >
                {connectingMM ? "Connecting..." : "Connect MetaMask"}
              </button>
            ) : (
              <button
                onClick={() => setShowConfig(false)}
                style={{
                  width: "100%",
                  background: "rgba(34,197,94,0.1)",
                  border: "1px solid rgba(34,197,94,0.3)",
                  borderRadius: 12,
                  padding: "16px",
                  fontSize: 15,
                  fontWeight: 800,
                  color: "#22c55e",
                  cursor: "pointer",
                  letterSpacing: "0.3px",
                }}
              >
                ✓ Close
              </button>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "#888" }}>
                Spark Address
              </label>
              <input
                type="text"
                value={config.sparkAddress}
                onChange={(e) => {
                  const cfg = { ...config, sparkAddress: e.target.value };
                  setConfig(cfg);
                  saveConfig(cfg);
                }}
                placeholder="sparkrt1... (loads automatically)"
                style={{
                  background: "rgba(0,0,0,0.4)",
                  border: `1px solid ${sparkAddressValid && config.sparkAddress ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.1)"}`,
                  borderRadius: 10,
                  padding: "12px 14px",
                  fontSize: 12,
                  color: "#f0f0f0",
                  fontFamily: "JetBrains Mono, monospace",
                  outline: "none",
                  wordBreak: "break-all",
                }}
              />
              {config.sparkAddress && !isValidSparkAddress(config.sparkAddress.trim()) && (
                <div style={{ fontSize: 11, color: "#ef4444" }}>
                  ✗ Invalid Spark address format
                </div>
              )}
              {config.sparkAddress && isValidSparkAddress(config.sparkAddress.trim()) && (
                <div style={{ fontSize: 11, color: "#22c55e" }}>
                  ✓ Valid Spark address
                </div>
              )}
            </div>

            <div style={{ padding: "12px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 10, fontSize: 11, color: "#666", lineHeight: 1.6 }}>
              <div style={{ marginBottom: 6 }}>✓ RPC URL pre-configured</div>
              <div>✓ No private keys needed</div>
            </div>
          </div>
        </div>
      )}

      {/* Swap Box */}
      <div style={{ background:"var(--surface-2)",border:"1px solid var(--border-2)",borderRadius:24,padding:8,position:"relative",overflow:"hidden",boxShadow:"0 12px 36px rgba(0,0,0,0.4)" }}>
        <div style={{ position:"absolute",top:0,left:0,right:0,height:1,background:"linear-gradient(90deg,transparent,rgba(240,137,58,0.4),transparent)" }} />

        {/* From */}
        <div style={{ background:"var(--surface)",border:"1px solid var(--border)",borderRadius:20,padding:"20px 20px 16px", minWidth: 0 }}>
          <div style={{ display:"flex",justifyContent:"space-between",marginBottom:12, flexWrap: "wrap", gap: 4 }}>
            <span style={{ fontSize:11,fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",color:"var(--text-muted)" }}>Sell</span>
            {fromInfo && <span style={{ fontSize:11,color:"var(--text-faint)", wordBreak: "break-all" }}>Min: {fromBaseUnits(fromInfo.minAmount, fromInfo.decimals)} {fromInfo.id.split(":")[1].toUpperCase()}</span>}
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:12 }}>
            <input type="text" inputMode="decimal" placeholder="0.00" value={amount} onChange={e=>{const v=e.target.value;if(v===""||/^\d*\.?\d*$/.test(v)){setAmount(v);setQuoteErr("");}}}
              style={{ background:"transparent",border:"none",outline:"none",fontSize:28,fontWeight:800,color:amount?"var(--text)":"var(--text-faint)",width:"100%",fontFamily:"inherit", minWidth: 0 }} />
            {assetsLoading ? (
              <div style={{ width:110,height:40,borderRadius:12,background:"var(--surface-2)", flexShrink: 0 }} />
            ) : (
              <select value={fromAsset} onChange={e=>{const next=e.target.value;if(next!==fromAsset){setFromAsset(next);setQuoteErr("");}}}
                style={{ background:"var(--surface-2)",border:"1px solid var(--border-2)",borderRadius:12,color:"var(--text)",fontSize:13,fontWeight:600,padding:"8px 12px",outline:"none",cursor:"pointer",minWidth:120, flexShrink: 0 }}>
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
        <div style={{ background:"var(--surface)",border:"1px solid var(--border)",borderRadius:20,padding:"20px 20px 16px", minWidth: 0 }}>
          <div style={{ display:"flex",justifyContent:"space-between",marginBottom:12 }}>
            <span style={{ fontSize:11,fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",color:"var(--text-muted)" }}>Buy</span>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:12 }}>
            <div style={{ fontSize:28,fontWeight:800,color:quote?"var(--green)":"var(--text-faint)",width:"100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
              {quote ? (toInfo ? fromBaseUnits(quote.destination.amount, toInfo.decimals) : quote.destination.amount) : (quoteLoading ? "…" : "0.00")}
            </div>
            {assetsLoading ? (
              <div style={{ width:110,height:40,borderRadius:12,background:"var(--surface-2)", flexShrink: 0 }} />
            ) : (
              <select value={toAsset} onChange={e=>{const next=e.target.value;if(next!==toAsset){setToAsset(next);setQuoteErr("");}}}
                style={{ background:"var(--surface-2)",border:"1px solid var(--border-2)",borderRadius:12,color:"var(--text)",fontSize:13,fontWeight:600,padding:"8px 12px",outline:"none",cursor:"pointer",minWidth:120, flexShrink: 0 }}>
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
            <div style={{ marginBottom:10,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:14,padding:"14px 16px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
              {[
                { label:"Market Maker", val:quote.solver_id },
                { label:"Protocol Fee", val:`${quote.fee} bips` },
                { label:"Est. Time", val:`~${quote.estimated_time}s` },
                { label:"Route", val:`${fromAsset.split(":")[1]?.toUpperCase()} → ${toAsset.split(":")[1]?.toUpperCase()}` },
              ].map(r=>(
                <div key={r.label} style={{ display:"flex",flexDirection:"column",gap:3 }}>
                  <span style={{ fontSize:9,fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",color:"var(--text-faint)" }}>{r.label}</span>
                  <span style={{ fontSize:12,fontWeight:600,color:"var(--text-muted)" }}>{r.val}</span>
                </div>
              ))}
            </div>
          )}
          <button onClick={executeSwap} disabled={!quote||quoteLoading||swapLoading||!config.evmAddress||!sparkAddressValid}
            style={{ width:"100%",background:(!quote||quoteLoading||swapLoading||!config.evmAddress||!sparkAddressValid)?"var(--surface-3)":"linear-gradient(135deg, #2dd36e, #1aaa52)",boxShadow:(!quote||quoteLoading||swapLoading||!config.evmAddress||!sparkAddressValid)?"none":"0 4px 16px rgba(45,211,110,0.25)",border:"1px solid",borderColor:(!quote||quoteLoading||swapLoading||!config.evmAddress||!sparkAddressValid)?"var(--border)":"rgba(45,211,110,0.3)",borderRadius:18,padding:"16px",fontSize:15,fontWeight:700,color:(!quote||quoteLoading||swapLoading||!config.evmAddress||!sparkAddressValid)?"var(--text-faint)":"#fff",cursor:(!quote||quoteLoading||swapLoading||!config.evmAddress||!sparkAddressValid)?"default":"pointer",transition:"all 0.2s" }}>
            {!config.evmAddress ? "Configure EVM signer first" : !sparkAddressValid ? "Set valid Spark address" : swapLoading ? "Executing…" : quoteLoading ? "Fetching quote…" : "Swap"}
          </button>
        </div>
      </div>

      {manualAction && <ManualActionPanel action={manualAction} onClose={() => setManualAction(null)} />}

      {/* Logs */}
      {logs.length > 0 && (
        <div style={{ background:"var(--surface)",border:"1px solid var(--border)",borderRadius:14,padding:"14px 16px" }}>
          <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:10 }}>
            <div style={{ width:6,height:6,borderRadius:"50%",background:"var(--green)",animation:"pulse 1.5s infinite" }} />
            <span style={{ fontSize:10,fontWeight:700,letterSpacing:"1.2px",textTransform:"uppercase",color:"var(--text-faint)" }}>Execution Log</span>
          </div>
          {logs.map((l,i)=>(
            <div key={i} style={{ fontFamily:"JetBrains Mono,monospace",fontSize:11,display:"flex",gap:8,marginBottom:4,color:l.type==="err"?"var(--red)":l.type==="ok"?"var(--green)":"var(--text-muted)",alignItems:"flex-start" }}>
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
                style={{ background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,padding:"16px 18px", textDecoration: "none", display: "block", transition: "all 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--orange-border)"; e.currentTarget.style.background = "var(--surface-2)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--surface)"; }}
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
