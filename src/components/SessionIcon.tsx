import { Cable, Globe, Network, Server, SquareTerminal, Zap } from "lucide-react";
import { SessionType } from "../types";

const icons = {
  local: { Icon: SquareTerminal, color: "#5b8def" },
  ssh: { Icon: Server, color: "#2fa36b" },
  telnet: { Icon: Globe, color: "#9b6ae0" },
  serial: { Icon: Cable, color: "#d9932b" },
  raw: { Icon: Network, color: "#4a9fb5" },
} as const;

export function SessionIcon({ type, size = 14, quick = false }: { type: SessionType; size?: number; quick?: boolean }) {
  const { Icon, color } = icons[type];
  if (!quick) return <Icon size={size} color={color} className="shrink-0" />;
  // Conexión rápida sin guardar: un rayo junto al ícono del protocolo.
  return (
    <span className="relative shrink-0 inline-flex" title="Conexión rápida sin guardar">
      <Icon size={size} color={color} />
      <Zap size={Math.round(size * 0.7)} className="absolute -right-1.5 -bottom-1 text-warn fill-current" />
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
