"use client";
import { useState, useEffect, useRef, useCallback, memo } from "react";
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

const TransactionRow = memo(({ tx, network, onCopyId }: {
  tx: Transfer;
  network: string;
  onCopyId: (id: string) => void;
}) => {
  const isIn = tx.direction === "INCOMING";
  const date = tx.createdAt ? new Date(tx.createdAt).toLocaleString() : "—";
  const shortId = tx.id ? `${tx.id.slice(0, 18)}…` : "—";
  const explorerUrl = network === "MAINNET"
    ? `https://sparkscan.io/tx/${tx.id}`
    : `https://sparkscan.io/tx/${tx.id}?network=regtest`;

  return (
    <a
      href={explorerUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group bg-[#0a0a0a] border border-[rgba(255,255,255,0.05)] hover:border-[rgba(247,147,26,0.3)] hover:bg-[rgba(255,255,255,0.02)] rounded-xl p-4 flex items-center justify-between gap-3 transition-all no-underline"
    >
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-[0.65rem] font-bold uppercase px-2 py-1 rounded rounded-md ${
            isIn ? "bg-[rgba(34,197,94,0.1)] text-[#22c55e]" : "bg-[rgba(239,68,68,0.1)] text-[#ef4444]"
          }`}>
            {isIn ? "Received" : "Sent"}
          </span>
          <span className="text-[0.75rem] text-[#555]">{date}</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[0.75rem] font-mono text-[#444] truncate">{shortId}</span>
          <svg className="w-2.5 h-2.5 text-[#666] opacity-30 group-hover:opacity-100 transition-opacity flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </div>
      </div>
      <span className={`text-base font-black whitespace-nowrap ${isIn ? "text-[#22c55e]" : "text-[#e0e0e0]"}`}>
        {isIn ? "+" : "−"}{Number(tx.sats).toLocaleString()} <span className="text-xs opacity-60">sats</span>
      </span>
    </a>
  );
});

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
        // Verify still connected before refresh
        const status = await api("/api/status", {}, 0);
        if (!status.connected) {
          setConnected(false);
          setAddress("");
          if (timerRef.current) clearInterval(timerRef.current);
          return;
        }
        await Promise.all([refreshBalance(true), loadTx({ page: txPage, offsets: txOffsets, silent: true })]);
      } catch {
        // Silent failure on refresh, don't disconnect
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
      <div className="min-h-[80vh] flex items-center justify-center p-5">
        <div className="w-full max-w-sm">
          <div className="relative">
            <div className="absolute -inset-10 bg-gradient-radial from-[rgba(247,147,26,0.08)] to-transparent pointer-events-none" />
            <div className="relative bg-gradient-to-br from-[#161616] to-[#111] border border-[rgba(255,255,255,0.12)] rounded-3xl p-9 shadow-[0_0_0_1px_rgba(0,0,0,0.5),0_24px_48px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.06)]">
              <div className="absolute top-0 left-1/5 right-1/5 h-px bg-gradient-to-r from-transparent via-[rgba(247,147,26,0.6)] to-transparent" />

              <div className="flex items-center gap-3.5 mb-7">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#f7931a] to-[#e55a00] flex items-center justify-center text-2xl font-black text-black shadow-[0_0_24px_rgba(247,147,26,0.35),inset_0_1px_0_rgba(255,255,255,0.2)] flex-shrink-0">₿</div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-bold text-[#f0f0f0] -tracking-[0.5px]">Connect Wallet</h2>
                    <span className="text-[0.65rem] font-bold uppercase tracking-widest text-[#f0b061] bg-[rgba(247,147,26,0.1)] border border-[rgba(247,147,26,0.2)] px-2 py-0.5 rounded-full">Secure</span>
                  </div>
                  <p className="text-[0.75rem] text-[#555] mt-0.5">Spark network · end-to-end encrypted</p>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-[0.7rem] font-bold uppercase tracking-widest text-[#666] mb-2">Network</label>
                <div className="relative">
                  <select
                    value={network}
                    onChange={(e) => setNetwork(e.target.value)}
                    className="w-full bg-[#0d0d0d] border border-[rgba(255,255,255,0.12)] focus:border-[rgba(247,147,26,0.5)] rounded-2xl text-[#e0e0e0] text-sm font-semibold py-3 pl-3.5 pr-10 outline-none appearance-none cursor-pointer shadow-inner transition-colors"
                  >
                    <option value="MAINNET">Mainnet — spark1...</option>
                    <option value="REGTEST">Regtest — sparkrt1...</option>
                  </select>
                  <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#555] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-[0.7rem] font-bold uppercase tracking-widest text-[#666] mb-2">Mnemonic Phrase</label>
                <input
                  type="password"
                  placeholder="Enter your 12-word seed phrase"
                  value={mnemonic}
                  onChange={(e) => setMnemonic(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && connect()}
                  className="w-full bg-[#0d0d0d] border border-[rgba(255,255,255,0.12)] focus:border-[rgba(247,147,26,0.5)] rounded-2xl text-[#e8e8e8] text-sm py-3 px-3.5 outline-none shadow-inner transition-colors"
                />
                <p className="text-[0.7rem] text-[#444] mt-1.5">Your phrase never leaves this device.</p>
              </div>

              <button
                onClick={connect}
                disabled={connectLoading}
                className={`w-full border-0 rounded-2xl py-3.5 text-sm font-black cursor-pointer flex items-center justify-center gap-2 transition-all shadow-[0_4px_16px_rgba(247,147,26,0.3)] ${
                  connectLoading
                    ? "bg-[rgba(247,147,26,0.3)] text-[rgba(0,0,0,0.5)] shadow-none"
                    : "bg-gradient-to-br from-[#f7931a] to-[#e55a00] text-black hover:opacity-90"
                }`}
              >
                {connectLoading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle opacity="0.25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path opacity="0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
                    Connecting…
                  </>
                ) : "Connect Wallet"}
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

  const SectionTitle = ({ text, badge }: { text: string; badge?: string }) => (
    <div className="flex items-center justify-between mb-1">
      <span className="text-sm font-bold text-[#ccc]">{text}</span>
      {badge && <span className="text-[0.65rem] font-bold uppercase tracking-widest text-[#f0b061] bg-[rgba(247,147,26,0.1)] border border-[rgba(247,147,26,0.2)] px-2 py-0.5 rounded-full">{badge}</span>}
    </div>
  );

  return (
    <div className="p-7 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-2 h-2 rounded-full bg-[#22c55e] shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
          <span className="text-xs font-semibold text-[#555]">Connected</span>
          <span className="text-[0.7rem] text-[#333] font-mono">·</span>
          <span className="text-[0.7rem] text-[#666] bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] px-2.5 py-0.5 rounded font-mono">
            {network === "REGTEST" ? "Regtest" : "Mainnet"}
          </span>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <button
            onClick={togglePrivacy}
            disabled={privacyLoading || privacyEnabled === null}
            title={privacyEnabled === false ? "Wallet is public — click to enable privacy" : "Wallet is private — click to make public"}
            className={`px-3 py-1.5 rounded text-[0.7rem] font-bold flex items-center gap-1.5 transition-all ${
              privacyEnabled === false
                ? "bg-[rgba(247,147,26,0.12)] border border-[rgba(247,147,26,0.35)] text-[#f0b061]"
                : "bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] text-[#888]"
            } disabled:opacity-60 disabled:cursor-not-allowed`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${privacyEnabled === false ? "bg-[#f7931a]" : "bg-[#555]"}`} />
            {privacyLoading ? "…" : privacyEnabled === null ? "Privacy" : privacyEnabled ? "Private" : "Public"}
          </button>
          <select
            value={network}
            onChange={(e) => switchNetwork(e.target.value)}
            disabled={connectLoading}
            className="bg-[#111] border border-[rgba(255,255,255,0.08)] rounded text-[#888] text-[0.7rem] font-semibold px-2.5 py-1.5 outline-none cursor-pointer disabled:opacity-50"
          >
            <option value="MAINNET">Mainnet</option>
            <option value="REGTEST">Regtest</option>
          </select>
          {privacyStatus.msg && (
            <span className={`text-[0.625rem] ${privacyStatus.type === "err" ? "text-[#ef4444]" : privacyStatus.type === "ok" ? "text-[#22c55e]" : "text-[#888]"}`}>
              {privacyStatus.msg}
            </span>
          )}
          <button
            onClick={disconnect}
            className="bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.2)] rounded px-3.5 py-1.5 text-[0.7rem] font-bold text-[#ef4444] hover:bg-[rgba(239,68,68,0.12)] transition-colors"
          >
            Disconnect
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
        <div className="bg-gradient-to-br from-[#141414] to-[#111] border border-[rgba(255,255,255,0.08)] rounded-2xl p-6 flex flex-col gap-4 relative overflow-hidden">
          <div className="absolute top-0 left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent via-[rgba(247,147,26,0.3)] to-transparent" />
          <SectionTitle text="Receive" badge="Address" />
          <div
            onClick={copyAddress}
            className="bg-[#0a0a0a] border border-[rgba(255,255,255,0.08)] hover:border-[rgba(247,147,26,0.4)] hover:text-[#ddd] rounded-xl p-3.5 text-xs font-mono text-[#aaa] cursor-pointer leading-relaxed min-h-14 break-all transition-colors"
          >
            {address || "—"}
          </div>
          <button
            onClick={copyAddress}
            className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.06)] rounded-xl p-2.5 text-xs font-semibold text-[#888] w-full mt-auto transition-colors"
          >
            Copy Address
          </button>
          <Status msg={copyMsg} type="ok" onDismiss={() => setCopyMsg("")} />
        </div>

        <div className="bg-gradient-to-br from-[#141414] to-[#111] border border-[rgba(255,255,255,0.08)] rounded-2xl p-6 flex flex-col gap-4 relative overflow-hidden">
          <div className="absolute top-0 left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent via-[rgba(247,147,26,0.3)] to-transparent" />
          <SectionTitle text="Balance" badge="Auto-refresh 5s" />
          <div className="min-w-0 overflow-hidden">
            <div className="text-5xl font-black bg-gradient-to-br from-[#f7931a] to-[#e06800] bg-clip-text text-transparent -tracking-[2px] leading-none overflow-hidden text-ellipsis whitespace-nowrap">
              {balanceSats !== null ? balanceSats.toLocaleString() : "—"}
            </div>
            {balanceSats !== null && <div className="text-2xl font-bold text-[#f7931a] opacity-70 mt-0.5">sats</div>}
            {balanceSats !== null && <div className="text-sm text-[#555] mt-1.5 break-all">{(Number(balanceSats) / 1e8).toFixed(8)} BTC</div>}
          </div>
          <button
            onClick={() => refreshBalance()}
            className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.06)] rounded-xl p-2.5 text-xs font-semibold text-[#888] w-full mt-auto transition-colors"
          >
            Refresh Balance
          </button>
          <Status msg={balanceStatus.msg} type={(balanceStatus.type || "info") as "ok" | "err" | "info"} onDismiss={() => setBalanceStatus({ msg: "", type: "" })} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
        <div className="bg-gradient-to-br from-[#141414] to-[#111] border border-[rgba(255,255,255,0.08)] rounded-2xl p-6 flex flex-col gap-4">
          <SectionTitle text="Check Any Balance" badge="Public" />
          <div>
            <label className="block text-[0.7rem] font-bold uppercase tracking-widest text-[#555] mb-2">Spark Address</label>
            <input
              type="text"
              placeholder="spark1... or sparkrt1..."
              value={checkAddr}
              onChange={(e) => setCheckAddr(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && checkAddressBalance()}
              className="w-full bg-[#0a0a0a] border border-[rgba(255,255,255,0.1)] focus:border-[rgba(247,147,26,0.5)] rounded-xl text-[#e0e0e0] text-sm px-3.5 py-2.75 outline-none mb-4 transition-colors"
            />
          </div>
          <button
            onClick={checkAddressBalance}
            disabled={checkLoading}
            className={`rounded-xl p-3 text-sm font-black text-center w-full transition-all ${
              checkLoading
                ? "bg-[rgba(247,147,26,0.2)] text-[#888]"
                : "bg-gradient-to-br from-[#f7931a] to-[#e55a00] text-black hover:opacity-90"
            }`}
          >
            {checkLoading ? "Checking…" : "Check Balance"}
          </button>
          {checkResult && (
            <div className="bg-[#0a0a0a] border border-[rgba(255,255,255,0.06)] rounded-xl p-3.5 min-w-0 overflow-hidden">
              <div className="text-2xl font-black text-[#f7931a] overflow-hidden text-ellipsis whitespace-nowrap">{checkResult.sats.toLocaleString()} <span className="text-sm opacity-70">sats</span></div>
              <div className="text-xs text-[#555] mt-1 break-all">{checkResult.btc} BTC · {checkResult.network}</div>
            </div>
          )}
          <Status msg={checkStatus.msg} type={(checkStatus.type || "info") as "ok" | "err" | "info"} onDismiss={() => setCheckStatus({ msg: "", type: "" })} />
        </div>

        <div className="bg-gradient-to-br from-[#141414] to-[#111] border border-[rgba(255,255,255,0.08)] rounded-2xl p-6 flex flex-col gap-4">
          <SectionTitle text="Send Funds" badge="Transfer" />
          <div>
            <label className="block text-[0.7rem] font-bold uppercase tracking-widest text-[#555] mb-2">Recipient Address</label>
            <input
              type="text"
              placeholder="spark1... or sparkrt1..."
              value={sendTo}
              onChange={(e) => setSendTo(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-[rgba(255,255,255,0.1)] focus:border-[rgba(247,147,26,0.5)] rounded-xl text-[#e0e0e0] text-sm px-3.5 py-2.75 outline-none mb-4 transition-colors"
            />
          </div>
          <div>
            <label className="block text-[0.7rem] font-bold uppercase tracking-widest text-[#555] mb-2">Amount (sats)</label>
            <input
              type="number"
              placeholder="e.g. 1000"
              min={1}
              value={sendSats}
              onChange={(e) => setSendSats(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-[rgba(255,255,255,0.1)] focus:border-[rgba(247,147,26,0.5)] rounded-xl text-[#e0e0e0] text-sm px-3.5 py-2.75 outline-none mb-4 transition-colors"
            />
          </div>
          <button
            onClick={send}
            disabled={sendLoading}
            className={`rounded-xl p-3 text-sm font-black text-center w-full mt-auto transition-all ${
              sendLoading
                ? "bg-[rgba(34,197,94,0.2)] text-[#888]"
                : "bg-[#22c55e] text-black hover:opacity-90"
            }`}
          >
            {sendLoading ? "Sending…" : "Send"}
          </button>
          <Status msg={sendStatus.msg} type={(sendStatus.type || "info") as "ok" | "err" | "info"} onDismiss={() => setSendStatus({ msg: "", type: "" })} />
        </div>
      </div>

      <div className="bg-gradient-to-br from-[#141414] to-[#111] border border-[rgba(255,255,255,0.08)] rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <SectionTitle text="Transaction History" badge="Auto-refresh 5s" />
          <button
            onClick={() => loadTx({ page: 0, offsets: [0] })}
            className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.07)] hover:bg-[rgba(255,255,255,0.05)] rounded text-[0.7rem] font-semibold text-[#555] px-3 py-1.5 transition-colors"
          >
            Refresh
          </button>
        </div>

        {transfers.length === 0 ? (
          <div className="text-center py-10 text-[#444] text-sm">No transactions found.</div>
        ) : (
          <div className="flex flex-col gap-2 mb-4">
            {transfers.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} network={network} onCopyId={copyTxId} />
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mt-4">
          <button
            disabled={txPage === 0}
            onClick={() => loadTx({ page: txPage - 1, offsets: txOffsets })}
            className="bg-transparent border border-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.03)] rounded px-4 py-1.5 text-xs font-semibold text-[#666] disabled:text-[#333] disabled:cursor-not-allowed transition-colors"
          >
            ← Prev
          </button>
          <span className="text-[0.7rem] text-[#444]">Page {txPage + 1}</span>
          <button
            disabled={!txHasNext}
            onClick={() => loadTx({ page: txPage + 1, offsets: txOffsets })}
            className="bg-transparent border border-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.03)] rounded px-4 py-1.5 text-xs font-semibold text-[#666] disabled:text-[#333] disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
        </div>
        <Status msg={txStatus.msg} type={(txStatus.type || "info") as "ok" | "err" | "info"} onDismiss={() => setTxStatus({ msg: "", type: "" })} />
      </div>
    </div>
  );
}
