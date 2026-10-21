import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { HlRule } from "./highlight";
import type { MonitorTarget } from "./monitors";
import type { TopoSnapshot, Topology } from "./topology";

export type ModuleId = "monitor" | "diag" | "topology" | "subnet" | "perf" | "transfer" | "syslog" | "plugins";

export interface SpeedResult {
  ts: string;
  download_mbps: number;
  upload_mbps: number;
  latency_ms: number;
  jitter_ms: number;
  server?: { colo?: string | null; city?: string | null };
}

/** Botón de comando rápido: envía texto (con {{variables}}) o ejecuta un script Python. */
export interface Macro {
  id: string;
  label: string;
  kind: "send" | "script";
  text?: string;
  script?: string;
}

export interface Settings {
  appTheme: "system" | "light" | "dark";
  terminalTheme: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: "block" | "bar" | "underline";
  cursorBlink: boolean;
  scrollback: number;
  copyOnSelect: boolean;
  rightClickPaste: boolean;
  confirmClose: boolean;
  autoLog: boolean;
  highlightEnabled: boolean;
  /** Esquemas activos por defecto (las sesiones pueden fijar su fabricante). */
  highlightSchemes: string[];
  customRules: HlRule[];
  /** Pausa entre líneas al enviar desde Notas (consolas lentas). */
  sendLineDelay: number;
  logTimestamps: boolean;
  /** Carpetas creadas a mano (pueden estar vacías). */
  extraFolders: string[];
  confirmSend: boolean;
  macros: Macro[];
  showButtonBar: boolean;
  mcpEnabled: boolean;
  mcpPort: number;
  mcpToken: string;
  mcpApproval: boolean;
  mcpReadOnly: boolean;
  modules: Record<ModuleId, boolean>;
  monitors: MonitorTarget[];
  tftpPort: number;
  httpPort: number;
  syslogPort: number;
  tftpAllowWrite: boolean;
  syslogSave: boolean;
  speedHistory: SpeedResult[];
  updateDismissed: string;
  /** Comandos favoritos del catálogo ("fabricante:comando"). */
  favCommands: string[];
  catalogVendor: string;
  /** Packs de comandos desactivados (incluidos o importados). */
  disabledPacks: string[];
  /** Diagrama de topología en curso (se guarda con los datos, también en modo portable). */
  topology: Topology;
  topoSnapshots: TopoSnapshot[];
}

export interface UpdateInfo {
  current: string;
  latest: string;
  newer: boolean;
  url: string;
  notes: string;
  published: string;
  /** Si esta instalación puede actualizarse sola (portable y .deb no). */
  supported: boolean;
  reason: string | null;
}

export const defaultSettings: Settings = {
  appTheme: "system",
  terminalTheme: "auto",
  fontFamily: "",
  fontSize: 13,
  lineHeight: 1.15,
  cursorStyle: "block",
  cursorBlink: true,
  scrollback: 5000,
  copyOnSelect: true,
  rightClickPaste: true,
  confirmClose: true,
  autoLog: false,
  highlightEnabled: true,
  highlightSchemes: ["cisco", "common"],
  customRules: [],
  sendLineDelay: 0,
  logTimestamps: false,
  extraFolders: [],
  confirmSend: true,
  macros: [
    { id: "m1", label: "terminal length 0", kind: "send", text: "terminal length 0" },
    { id: "m2", label: "Interfaces", kind: "send", text: "show ip interface brief" },
  ],
  showButtonBar: true,
  mcpEnabled: false,
  mcpPort: 47821,
  mcpToken: "",
  mcpApproval: true,
  mcpReadOnly: false,
  modules: { monitor: true, diag: true, topology: true, subnet: true, perf: true, transfer: true, syslog: true, plugins: true },
  monitors: [],
  tftpPort: 69,
  httpPort: 8080,
  syslogPort: 514,
  tftpAllowWrite: false,
  syslogSave: false,
  speedHistory: [],
  updateDismissed: "",
  favCommands: [],
  catalogVendor: "cisco",
  disabledPacks: [],
  topology: { nodes: [], links: [] },
  topoSnapshots: [],
};

export function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Carga los ajustes desde el backend y los guarda (con debounce) en cada cambio. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    invoke<Partial<Settings> | null>("get_settings")
      .then((s) => setSettings({ ...defaultSettings, ...(s ?? {}) }))
      .catch(() => setSettings(defaultSettings));
  }, []);

  const update = useCallback((patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)) => {
    setSettings((prev) => {
      const base = prev ?? defaultSettings;
      const next = { ...base, ...(typeof patch === "function" ? patch(base) : patch) };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        invoke("save_settings", { settings: next }).catch(console.error);
      }, 300);
      return next;
    });
  }, []);

  return [settings, update] as const;
}
