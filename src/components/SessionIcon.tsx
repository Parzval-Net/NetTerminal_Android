import { Cable, Globe, Network, Server, SquareTerminal } from "lucide-react";
import { SessionType } from "../types";

const icons = {
  local: { Icon: SquareTerminal, color: "#5b8def" },
  ssh: { Icon: Server, color: "#2fa36b" },
  telnet: { Icon: Globe, color: "#9b6ae0" },
  serial: { Icon: Cable, color: "#d9932b" },
  raw: { Icon: Network, color: "#4a9fb5" },
} as const;

export function SessionIcon({ type, size = 14 }: { type: SessionType; size?: number }) {
  const { Icon, color } = icons[type];
  return <Icon size={size} color={color} className="shrink-0" />;
}

export const typeLabel: Record<SessionType, string> = {
  local: "Local",
  ssh: "SSH",
  telnet: "Telnet",
  serial: "Serial",
  raw: "TCP",
};
