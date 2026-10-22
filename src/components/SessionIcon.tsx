import { Cable, Globe, Network, Server, SquareTerminal, Zap } from "lucide-react";
import { SessionType } from "../types";

// Tonos medios: >= 3:1 (WCAG 1.4.11) tanto sobre fondos claros (blanco, hover, selección)
// como oscuros (paneles y temas de terminal), porque la pestaña activa usa el fondo del tema
// de terminal, que puede ser claro aunque la interfaz sea oscura (y al revés).
const icons = {
  local: { Icon: SquareTerminal, color: "#407bec" },
  ssh: { Icon: Server, color: "#298f5e" },
  telnet: { Icon: Globe, color: "#9663df" },
  serial: { Icon: Cable, color: "#ad741f" },
  raw: { Icon: Network, color: "#40899c" },
} as const;

/** Rayo de conexión rápida: amarillo con borde oscuro, visible sobre fondos claros y oscuros. */
export function QuickBolt({ size = 14, className = "" }: { size?: number; className?: string }) {
  return <Zap size={size} strokeWidth={2.25} className={`shrink-0 fill-bolt text-bolt-edge ${className}`} aria-hidden />;
}

export function SessionIcon({ type, size = 14, quick = false }: { type: SessionType; size?: number; quick?: boolean }) {
  const { Icon, color } = icons[type];
  if (!quick) return <Icon size={size} color={color} className="shrink-0" />;
  // Conexión rápida sin guardar: un rayo junto al ícono del protocolo.
  return (
    <span className="relative shrink-0 inline-flex" title="Conexión rápida sin guardar">
      <Icon size={size} color={color} />
      <QuickBolt size={Math.round(size * 0.75)} className="absolute -right-1.5 -bottom-1" />
    </span>
  );
}

/** Pestaña de una conexión rápida (sin sesión guardada). */
export const isQuickSession = (s: { id: string; type: SessionType; scp?: unknown }) => !s.id && s.type !== "local" && !s.scp;

export const typeLabel: Record<SessionType, string> = {
  local: "Local",
  ssh: "SSH",
  telnet: "Telnet",
  serial: "Serial",
  raw: "TCP",
};
