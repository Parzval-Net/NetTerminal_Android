import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { HlRule } from "./highlight";
import { type AlertRule, exampleAlerts } from "./alerts";
import type { MonitorTarget } from "./monitors";
import type { DeviceInfoMap } from "./lifecycle";
import type { TopoSnapshot, TopoSources, Topology } from "./topology";
import type { SnmpProfile } from "./snmp";
import { type GhostColor, type GhostStyle, type ListKey, SUGGEST_DEFAULT, migrateSuggest } from "./suggest";

export type ModuleId = "monitor" | "diag" | "topology" | "subnet" | "perf" | "transfer" | "syslog" | "plugins" | "backup" | "snmp";

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

export type TabLayout = "horizontal" | "vertical";

export interface Settings {
  appTheme: "system" | "light" | "dark";
  /** Pestañas arriba (por defecto) o en una columna a la izquierda. */
  tabLayout: TabLayout;
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
  /** Reintenta solo con algoritmos legacy si el equipo SSH los exige (apagado por defecto: abre la puerta a un downgrade). */
  autoLegacySsh: boolean;
  /** Sugerencias de comandos del catálogo al escribir. */
  commandSuggest: boolean;
  /** El usuario eligió el valor de commandSuggest (si no, sigue al valor por defecto). */
  commandSuggestSet: boolean;
  /** Tecla que abre la lista de sugerencias. */
  suggestListKey: ListKey;
  /** Color de la sugerencia (automático según el tema o un tono fijo). */
  suggestColor: GhostColor;
  /** Estilo extra de la sugerencia: cursiva o subrayado punteado. */
  suggestStyle: GhostStyle;
  /** Tab acepta la sugerencia visible (sin sugerencia, Tab sigue yendo al equipo). */
  suggestTabAccept: boolean;
  /** Ayuda "Tab o → acepta · Esc descarta" junto a la sugerencia (sus primeras veces). */
  suggestTip: boolean;
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
  /** Orden manual de la lista de sesiones por carpeta (ver SidebarOrder en folders.ts). */
  sidebarOrder: Record<string, string[]>;
  /** Modelo y versión vistos por destino (host), para el ciclo de vida en la barra de estado. */
  deviceInfo: DeviceInfoMap;
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
  /** Fuentes opcionales de Topología (ruteo, descripciones); apagadas por defecto. */
  topoSources: TopoSources;
  /** Nombre del log: {session} {host} {folder} {date} {time}. */
  logPattern: string;
  /** Anexar si el archivo ya existe (si no, se crea uno nuevo). */
  logAppend: boolean;
  logRotateDaily: boolean;
  /** Reemplaza por **** contraseñas, secrets, communities y llaves en los logs. */
  logMask: boolean;
  /** Carpeta de logs elegida por el usuario (ruta absoluta); vacío: `data/logs`. */
  logsDir: string;
  alertRules: AlertRule[];
  /** SNMP: perfiles sin secretos (los secretos solo en la bóveda, si el usuario lo pide). */
  snmpProfiles: SnmpProfile[];
  snmpTrapPort: number;
  /** IP local del receptor de traps ("" = 127.0.0.1). */
  snmpTrapBind: string;
  ftpPort: number;
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
  tabLayout: "horizontal",
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
  autoLegacySsh: false,
  commandSuggest: SUGGEST_DEFAULT,
  commandSuggestSet: false,
  suggestListKey: "ctrl+period",
  suggestColor: "auto",
  suggestStyle: "underline",
  suggestTabAccept: true,
  suggestTip: true,
  autoLog: false,
  highlightEnabled: true,
  highlightSchemes: ["cisco", "common"],
  customRules: [],
  sendLineDelay: 0,
  logTimestamps: false,
  extraFolders: [],
  sidebarOrder: {},
  deviceInfo: {},
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
  modules: { monitor: true, diag: true, topology: true, subnet: true, perf: true, transfer: true, syslog: true, plugins: true, backup: true, snmp: true },
  monitors: [],
  tftpPort: 69,
  httpPort: 8080,
  syslogPort: 514,
  syslogSave: false,
  speedHistory: [],
  updateDismissed: "",
  favCommands: [],
  catalogVendor: "cisco",
  disabledPacks: [],
  topology: { nodes: [], links: [] },
  topoSnapshots: [],
  topoSources: {},
  logPattern: "{session}_{date}-{time}",
  logAppend: false,
  logRotateDaily: false,
  logMask: true,
  logsDir: "",
  alertRules: exampleAlerts,
  snmpProfiles: [],
  snmpTrapPort: 162,
  snmpTrapBind: "",
  ftpPort: 21,
};

/** Opciones de log que se pasan a set_logging. */
export const logOptions = (s: Settings) => ({
  timestamps: s.logTimestamps,
  pattern: s.logPattern,
  append: s.logAppend,
  rotate: s.logRotateDaily,
  mask: s.logMask,
});

export function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Ajustes leídos del disco sobre los valores por defecto. Un valor de otro tipo que el
 * predeterminado (settings.json editado a mano o de otra versión) se reemplaza por este:
 * un `"alertRules": null` dejaba la ventana en blanco. Las claves desconocidas se conservan.
 */
export function mergeSettings(loaded: unknown): Settings {
  const out: Record<string, unknown> = { ...defaultSettings };
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) return out as unknown as Settings;
  const defaults = defaultSettings as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(loaded)) {
    const d = defaults[k];
    if (d === undefined || (v !== null && typeof v === typeof d && Array.isArray(v) === Array.isArray(d))) out[k] = v;
  }
  return out as unknown as Settings;
}

/** Carga los ajustes desde el backend y los guarda (con debounce) en cada cambio. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    invoke<unknown>("get_settings")
      .then((s) => {
        const raw = s && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, unknown>) : null;
        setSettings({ ...mergeSettings(s), ...migrateSuggest(raw) });
      })
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
