"use client";
import { useState } from "react";
import dynamic from "next/dynamic";

const WalletTab = dynamic(() => import("./components/WalletTab"), { ssr: false });
const SwapTab = dynamic(() => import("./components/SwapTab"), { ssr: false });

const EXPLORER_URL = "https://lo7f6nzsz0rpumbmurojel17.garden-staging.dealpulley.com/";

const TABS = [
  { id: "wallet", label: "Wallet", icon: "⚡" },
  { id: "swap",   label: "Swap",   icon: "↕" },
  { id: "explorer", label: "Explorer", icon: "◎", href: EXPLORER_URL },
] as const;

type TabId = "wallet" | "swap" | "explorer";

export default function Home() {
  const [tab, setTab] = useState<TabId>("wallet");

  return (
    <div className="min-h-screen" style={{ background: "var(--background)" }}>
      {/* Top Nav */}
      <header style={{
        borderBottom: "1px solid var(--border)",
        background: "rgba(8,8,8,0.95)",
        backdropFilter: "blur(20px)",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 20px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: "linear-gradient(135deg, #f7931a, #e55a00)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 800, color: "#000", boxShadow: "0 0 16px rgba(247,147,26,0.3)"
            }}>G</div>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.3px", display: "inline-block" }}>
              Garden<span style={{ color: "var(--orange)" }}>.</span>Staging
            </span>
          </div>

          {/* Tab Nav */}
          <nav style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: 3, border: "1px solid var(--border)", overflowX: "auto", scrollbarWidth: "none" }}>
            {TABS.map(t => {
              const isExternal = "href" in t && t.href;
              const isActive = !isExternal && tab === t.id;
              const sharedStyle: React.CSSProperties = {
                padding: "6px 16px",
                borderRadius: 9,
                fontSize: 12,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: isActive ? "var(--orange)" : "transparent",
                color: isActive ? "#000" : "var(--text-muted)",
                letterSpacing: "0.2px",
                textDecoration: "none",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              };
              if (isExternal) {
                return (
                  <a key={t.id} href={t.href} target="_blank" rel="noopener noreferrer" style={sharedStyle}>
                    <span style={{ fontSize: 11 }}>{t.icon}</span>
                    {t.label}
                  </a>
                );
              }
              return (
                <button key={t.id} onClick={() => setTab(t.id)} style={sharedStyle}>
                  <span style={{ fontSize: 11 }}>{t.icon}</span>
                  {t.label}
                </button>
              );
            })}
          </nav>

          {/* Status dot */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 8px rgba(34,197,94,0.6)" }} />
            <span style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 500 }}>Staging</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main>
        {tab === "wallet" && <WalletTab />}
        {tab === "swap" && <SwapTab />}
      </main>
    </div>
  );
}
