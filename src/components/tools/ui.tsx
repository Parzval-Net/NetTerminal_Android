import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Check, Copy } from "lucide-react";

export function Section({ title, hint, children, right }: { title: string; hint?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel">
      <header className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold truncate">{title}</h3>
          {hint && <p className="text-[11.5px] text-muted truncate" title={hint}>{hint}</p>}
        </div>
        {right}
      </header>
      <div className="px-4 pb-4">{children}</div>
    </section>
  );
}

export function Btn({
  kind = "default",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "default" | "primary" | "danger" | "ghost" }) {
  const styles = {
    default: "border border-line hover:bg-hover",
    primary: "bg-accent text-accent-fg font-medium hover:opacity-90",
    danger: "bg-danger text-accent-fg font-medium hover:opacity-90",
    ghost: "text-muted hover:text-fg hover:bg-hover",
  }[kind];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 px-3 h-8 rounded-md text-[12.5px] disabled:opacity-40 disabled:pointer-events-none ${styles} ${className}`}
    />
  );
}

export function Label({ text, children, className = "" }: { text: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="block mb-1 text-[11.5px] font-medium text-muted">{text}</span>
      {children}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-[12.5px] cursor-default select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-8 h-[18px] rounded-full transition-colors ${checked ? "bg-accent" : "bg-field-line"}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-3.5" : ""}`} />
      </button>
      {label}
    </label>
  );
}

/** Estado con ícono + texto (nunca solo color). */
export function StatusPill({ state, label }: { state: "up" | "down" | "unknown" | "running" | "stopped"; label: string }) {
  const map = {
    up: ["var(--ok)", "●"],
    running: ["var(--ok)", "●"],
    down: ["var(--danger)", "✕"],
    unknown: ["var(--muted)", "○"],
    stopped: ["var(--muted)", "○"],
  } as const;
  const [color, icon] = map[state];
  return (
    <span className="inline-flex items-center gap-1 px-2 h-5 rounded-full border border-line text-[11px] font-medium whitespace-nowrap shrink-0" style={{ color }}>
      <span aria-hidden>{icon}</span>
      <span className="text-fg">{label}</span>
    </span>
  );
}

export function CopyText({ text, mono = true }: { text: string; mono?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        await writeText(text);
        setDone(true);
        window.setTimeout(() => setDone(false), 1500);
      }}
      title="Copiar"
      className={`group inline-flex items-center gap-1.5 px-2 h-6 rounded-md bg-hover text-[12px] hover:text-fg ${mono ? "font-mono" : ""}`}
    >
      {text}
      {done ? <Check size={12} className="text-ok" /> : <Copy size={12} className="text-muted opacity-0 group-hover:opacity-100" />}
    </button>
  );
}

export function Console({ lines, empty = "Sin salida", height = 220 }: { lines: string[]; empty?: string; height?: number }) {
  return (
    <pre
      className="rounded-lg bg-hover p-3 font-mono text-[11.5px] leading-[1.5] overflow-auto whitespace-pre-wrap break-all select-text"
      style={{ height }}
      ref={(el) => {
        if (el) el.scrollTop = el.scrollHeight;
      }}
    >
      {lines.length ? lines.join("\n") : <span className="text-muted">{empty}</span>}
    </pre>
  );
}

export const fmtBytes = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(0)} KB` : `${n} B`;

export const fmtMs = (v: number | null | undefined) => (v == null ? "—" : `${v >= 10 ? v.toFixed(0) : v.toFixed(1)} ms`);
