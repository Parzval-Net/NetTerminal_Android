export type SessionType = "local" | "ssh" | "serial" | "telnet" | "raw";

export interface Session {
  id: string;
  name: string;
  type: SessionType;
  folder?: string;
  host?: string;
  port?: number;
  username?: string;
  identity_file?: string;
  legacy_ssh?: boolean;
  jump_host?: string;
  ssh_args?: string;
  serial_port?: string;
  baud_rate?: number;
  data_bits?: number;
  stop_bits?: number;
  parity?: "none" | "odd" | "even";
  flow_control?: "none" | "software" | "hardware";
  /** Perfil de resaltado: "default" (según ajustes), "off" o id de fabricante. */
  highlight?: string;
  /** Comandos que se envían al conectar (uno por línea). */
  on_connect?: string;
  /** Qué envía Enter: "cr" (por defecto), "lf" o "crlf". */
  newline?: "cr" | "lf" | "crlf";
  local_echo?: boolean;
  /** Codificación de la salida del equipo. */
  encoding?: string;
  auto_reconnect?: boolean;
  /** Plataforma detectada para el catálogo (ej. "vrp5", "iosxe"). */
  platform?: string;
  /** Pestaña temporal de transferencia SCP. */
  scp?: { upload: boolean; files: string[]; remote_dir: string };
  created_at: string;
}

export interface SerialPortInfo {
  port_name: string;
  port_type: string;
}

export type ConnStatus = "connecting" | "connected" | "closed";

export interface Tab {
  id: string;
  session: Session;
  /** Nombre puesto por el usuario solo para esta pestaña. */
  title?: string;
}

export const tabTitle = (t: Tab) => t.title?.trim() || t.session.name;

export interface TabState {
  status: ConnStatus;
  logPath: string | null;
}

/** Descripción corta del destino: user@host:port, COM3 · 9600 8N1, etc. */
export function sessionTarget(s: Session): string {
  switch (s.type) {
    case "ssh": {
      const user = s.username ? `${s.username}@` : "";
      const port = s.port && s.port !== 22 ? `:${s.port}` : "";
      return `${user}${s.host ?? ""}${port}`;
    }
    case "telnet":
      return `${s.host ?? ""}${s.port && s.port !== 23 ? `:${s.port}` : ""}`;
    case "raw":
      return `${s.host ?? ""}:${s.port ?? ""}`;
    case "serial": {
      const parity = (s.parity ?? "none")[0].toUpperCase();
      return `${s.serial_port ?? ""} · ${s.baud_rate ?? 9600} ${s.data_bits ?? 8}${parity}${s.stop_bits ?? 1}`;
    }
    default:
      return "Shell del sistema";
  }
}
