"use client";
import { useState } from "react";
import dynamic from "next/dynamic";

const WalletTab = dynamic(() => import("./components/WalletTab"), { ssr: false });
const SwapTab = dynamic(() => import("./components/SwapTab"), { ssr: false });

const EXPLORER_URL = "https://lo7f6nzsz0rpumbmurojel17.garden-staging.dealpulley.com/";

const TABS = [
  { id: "wallet",   label: "Wallet",   icon: "⚡" },
  { id: "swap",     label: "Swap",     icon: "↕" },
  { id: "explorer", label: "Explorer", icon: "◎", href: EXPLORER_URL },
] as const;

type TabId = "wallet" | "swap" | "explorer";

export default function Home() {
  const [tab, setTab] = useState<TabId>("wallet");

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header style={{
        borderBottom: "1px solid var(--border)",
        background: "rgba(13,17,23,0.92)",
        backdropFilter: "blur(20px)",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 20px", height: 58, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 9,
              background: "linear-gradient(135deg, #f0893a, #c9680c)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 900, color: "#fff",
              boxShadow: "0 0 14px rgba(240,137,58,0.3)",
            }}>G</div>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.4px" }}>
              Garden<span style={{ color: "var(--orange)" }}>.</span><span style={{ color: "var(--text-muted)", fontWeight: 500 }}>Staging</span>
            </span>
          </div>

          {/* Tab Nav */}
          <nav style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: 3, border: "1px solid var(--border)", overflowX: "auto", scrollbarWidth: "none" }}>
            {TABS.map(t => {
              const isExternal = "href" in t && t.href;
              const isActive = !isExternal && tab === t.id;
              const style: React.CSSProperties = {
                padding: "6px 16px",
                borderRadius: 9,
                fontSize: 12,
                fontWeight: 600,
                border: isActive ? "1px solid var(--orange-border)" : "1px solid transparent",
                cursor: "pointer",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: isActive ? "rgba(240,137,58,0.12)" : "transparent",
                color: isActive ? "var(--orange)" : "var(--text-muted)",
                letterSpacing: "0.2px",
                textDecoration: "none",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              };
              if (isExternal) {
                return <a key={t.id} href={t.href} target="_blank" rel="noopener noreferrer" style={style}><span style={{ fontSize: 11 }}>{t.icon}</span>{t.label}</a>;
              }
              return (
                <button key={t.id} onClick={() => setTab(t.id)} style={style}>
                  <span style={{ fontSize: 11 }}>{t.icon}</span>{t.label}
                </button>
              );
            })}
          </nav>

          {/* Status */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 8px rgba(45,211,110,0.5)" }} />
            <span style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 500 }}>Staging</span>
          </div>
        </div>
      </header>

      <main>
        {tab === "wallet" && <WalletTab />}
        {tab === "swap"   && <SwapTab />}
      </main>
    </div>
  );
}
