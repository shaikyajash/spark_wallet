"use client";
import { ReactNode, useEffect, useState } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-[var(--surface)] border border-[rgba(255,255,255,0.05)] rounded-2xl p-6 shadow-2xl ${className}`}>
      {children}
    </div>
  );
}

export function CardTitle({ children, badge }: { children: ReactNode; badge?: string }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <span className="text-[0.72rem] font-semibold uppercase tracking-widest text-[#666]">{children}</span>
      {badge && (
        <span className="text-[0.65rem] uppercase tracking-wider text-[#f0b061] bg-[#24170a] border border-[#5b3a10] px-2 py-1 rounded-full whitespace-nowrap">
          {badge}
        </span>
      )}
    </div>
  );
}

export function Btn({
  children, onClick, disabled, variant = "primary", className = "", type = "button",
}: {
  children: ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: "primary" | "secondary"; className?: string; type?: "button" | "submit";
}) {
  const base = "w-full rounded-xl text-sm font-semibold py-3 px-4 cursor-pointer transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2";
  const styles = variant === "primary"
    ? "bg-gradient-to-r from-[#f7931a] to-[#e67e22] text-black hover:opacity-90 shadow-[0_0_15px_rgba(247,147,26,0.2)] hover:shadow-[0_0_25px_rgba(247,147,26,0.3)]"
    : "bg-[rgba(255,255,255,0.03)] text-[#ccc] border border-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.06)]";
  return (
    <button type={type} className={`${base} ${styles} ${className}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] rounded-xl text-[#e8e8e8] text-sm px-4 py-3 outline-none focus:border-[#f7931a] focus:ring-1 focus:ring-[#f7931a]/30 placeholder:text-[#555] transition-all mb-4 ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.08)] rounded-xl text-[#e8e8e8] text-sm px-4 py-3 outline-none focus:border-[#f7931a] focus:ring-1 focus:ring-[#f7931a]/30 cursor-pointer mb-4 appearance-none ${props.className ?? ""}`}
    />
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-[#222] rounded-md ${className}`} />
  );
}

type StatusType = "ok" | "err" | "info";

const STATUS_COLORS: Record<StatusType, { bg: string; fg: string; border: string }> = {
  ok:   { bg: "rgba(34,197,94,0.08)",  fg: "#22c55e", border: "rgba(34,197,94,0.25)" },
  err:  { bg: "rgba(239,68,68,0.08)",  fg: "#ef4444", border: "rgba(239,68,68,0.25)" },
  info: { bg: "rgba(247,147,26,0.06)", fg: "#f7931a", border: "rgba(247,147,26,0.2)" },
};

export function Status({
  msg,
  type,
  duration = 2000,
  onDismiss,
  persistent = false,
}: {
  msg: string;
  type: StatusType;
  duration?: number;
  onDismiss?: () => void;
  persistent?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState<{ msg: string; type: StatusType } | null>(null);

  useEffect(() => {
    if (!msg) {
      setVisible(false);
      return;
    }
    setShown({ msg, type });
    setVisible(true);
    if (persistent || type === "err") return; // errors stay until replaced/cleared
    const t = setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, duration);
    return () => clearTimeout(t);
  }, [msg, type, duration, onDismiss, persistent]);

  if (!shown) return null;
  const c = STATUS_COLORS[shown.type];
  return (
    <div
      style={{
        marginTop: 10,
        fontSize: 12,
        padding: "8px 12px",
        borderRadius: 10,
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.border}`,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(-2px)",
        transition: "opacity 280ms ease, transform 280ms ease",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      {shown.type === "err" && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      )}
      {shown.type === "ok" && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      )}
      {shown.type === "info" && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      )}
      <span>{shown.msg}</span>
    </div>
  );
}
