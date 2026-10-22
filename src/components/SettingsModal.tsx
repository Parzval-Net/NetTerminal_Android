import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeftRight, BellRing, Blocks, Bot, Check, FolderOpen, Highlighter, Info, KeyRound, Palette, ScrollText, Search, SquareTerminal, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import logo from "../assets/logo.svg";
import type { ModuleId } from "../lib/settings";
import { AiSettings } from "./AiSettings";
import { useDragResize } from "../lib/useDragResize";
import type { ITheme } from "@xterm/xterm";
import { HighlightSettings } from "./HighlightSettings";
import { AlertSettings } from "./AlertSettings";
import { CredentialSettings } from "./CredentialSettings";
import { allFolders } from "../lib/folders";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Settings, UpdateInfo, defaultSettings } from "../lib/settings";
import { Session } from "../types";
import { TermPreset, fontStack, presets } from "../lib/theme";
import { isMac } from "../lib/platform";

interface Props {
  settings: Settings;
  appDark: boolean;
  termTheme: ITheme;
  sessions: Session[];
  onImportSessions: (list: Session[]) => Promise<number>;
  /** Importación desde archivos de otros clientes. */
  onImportFile?: () => void;
  initialSection?: Section;
  mcpStatus: string;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}

export type Section = "appearance" | "highlight" | "terminal" | "alerts" | "modules" | "ai" | "credentials" | "data" | "sessions" | "about";

const MODULES: [ModuleId, string, string][] = [
  ["monitor", "Monitoreo", "Sondas ICMP/TCP con gráfico y alarma sonora"],
  ["diag", "Diagnóstico", "Ping continuo, traceroute y verificación de puertos"],
  ["topology", "Topología", "Diagrama de vecinos CDP/LLDP y seguimiento de rutas"],
  ["subnet", "Subredes", "Calculadora IPv4/IPv6 y división de redes"],
  ["perf", "Velocidad", "Speedtest (Cloudflare) e iperf3"],
  ["transfer", "Transferencias", "TFTP, HTTP, FTP y SFTP: servir firmware y recibir respaldos desde equipos"],
  ["syslog", "Syslog", "Recibir logs de equipos en vivo"],
  ["snmp", "SNMP", "Consultas v1/v2c/v3, conjuntos de OIDs y receptor de traps"],
  ["plugins", "Plugins", "Extensiones instalables en Python"],
  ["backup", "Respaldos", "Respaldo de configuración por fabricante y comparación de versiones"],
];

/**
 * Secciones agrupadas por tarea (General, Sesiones y datos, Herramientas, Integraciones):
 * grupos de 2 a 3 ítems con etiquetas que describen qué configura cada uno, en vez de una
 * lista plana de nueve. Los ids se conservan para que los enlaces directos sigan funcionando.
 * `keywords`: lo que busca el cuadro de búsqueda (etiquetas de los ajustes de la sección).
 */
const sections: { id: Section; label: string; Icon: typeof Palette; group: string; keywords: string }[] = [
  { id: "appearance", label: "Apariencia", Icon: Palette, group: "General", keywords: "interfaz claro oscuro sistema pestañas verticales horizontales tema de terminal fuente tamaño interlineado cursor parpadeante colores" },
  { id: "terminal", label: "Terminal", Icon: SquareTerminal, group: "General", keywords: "historial scrollback copiar al seleccionar pegar clic derecho confirmar al cerrar confirmar envío varias líneas barra de botones pausa entre líneas notas" },
  { id: "highlight", label: "Resaltado", Icon: Highlighter, group: "General", keywords: "resaltado sintaxis reglas regex esquemas fabricante cisco juniper huawei fortinet colores exportar importar" },
  { id: "data", label: "Logs", Icon: ScrollText, group: "Sesiones y datos", keywords: "logs grabar automáticamente hora en cada línea nombre del archivo patrón anexar rotación diaria ocultar secretos carpeta de logs" },
  { id: "credentials", label: "Credenciales", Icon: KeyRound, group: "Sesiones y datos", keywords: "contraseñas guardadas bóveda llavero contraseña maestra portable credenciales" },
  { id: "sessions", label: "Importar y exportar", Icon: ArrowLeftRight, group: "Sesiones y datos", keywords: "sesiones importar exportar portapapeles json putty securecrt mobaxterm ssh config csv carpeta de datos portable" },
  { id: "modules", label: "Módulos", Icon: Blocks, group: "Herramientas", keywords: "módulos monitoreo diagnóstico topología subredes velocidad tftp http syslog plugins respaldos herramientas" },
  { id: "alerts", label: "Alertas", Icon: BellRing, group: "Herramientas", keywords: "alertas palabra clave reglas sonido aviso pestaña expresión regular" },
  { id: "ai", label: "Agentes IA", Icon: Bot, group: "Integraciones", keywords: "agentes ia mcp claude gemini codex puerto token aprobación solo lectura servidor" },
  { id: "about", label: "Acerca de", Icon: Info, group: "Acerca de", keywords: "versión actualizaciones buscar ahora github repositorio autor" },
];

const FONTS = [
  "JetBrains Mono",
  "Fira Code",
  "Cascadia Code",
  "Cascadia Mono",
  "Consolas",
  "SF Mono",
  "Menlo",
  "Monaco",
  "Source Code Pro",
  "IBM Plex Mono",
  "Ubuntu Mono",
  "DejaVu Sans Mono",
  "Hack",
];

export function SettingsModal({
  settings: s,
  appDark,
  termTheme,
  sessions,
  onImportSessions,
  onImportFile,
  initialSection,
  mcpStatus,
  onChange,
  onClose,
}: Props) {
  const [section, setSection] = useState<Section>(initialSection ?? "appearance");
  const win = useDragResize("settingsWindow");
  const [dataDir, setDataDir] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => (q ? sections.filter((x) => x.label.toLowerCase().includes(q) || x.keywords.includes(q)) : sections),
    [q],
  );
  // Al buscar se muestra la primera sección que coincide.
  useEffect(() => {
    if (q && visible.length && !visible.some((x) => x.id === section)) setSection(visible[0].id);
  }, [q, visible, section]);
  const groups = useMemo(() => {
    const out: { name: string; items: typeof sections }[] = [];
    for (const x of visible) {
      const g = out.find((o) => o.name === x.group);
      if (g) g.items.push(x);
      else out.push({ name: x.group, items: [x] });
    }
    return out;
  }, [visible]);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(""), 3500);
  };

  const exportSessions = async () => {
    const list = sessions
      .filter((x) => x.type !== "local")
      .map(({ id: _id, created_at: _c, save_password: _pw, ...rest }) => rest);
    await writeText(JSON.stringify(list, null, 2));
    flash(`${list.length} sesiones copiadas al portapapeles (nunca incluye contraseñas)`);
  };

  const importSessions = async () => {
    let list: Session[];
    try {
      const data = JSON.parse(await readText());
      list = (Array.isArray(data) ? data : [data]).filter(
        (x): x is Session => x && typeof x.name === "string" && ["ssh", "telnet", "raw", "serial", "local"].includes(x.type),
      );
    } catch {
      return flash("El portapapeles no contiene sesiones válidas (JSON)");
    }
    if (!list.length) return flash("El portapapeles no contiene sesiones válidas (JSON)");
    try {
      const added = await onImportSessions(list);
      flash(`${added} sesiones importadas${added < list.length ? `, ${list.length - added} ya existían` : ""}`);
    } catch (e) {
      flash(`Importación incompleta: ${e}`);
    }
  };

  useEffect(() => {
    invoke<string>("data_dir").then(setDataDir).catch(() => {});
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const autoPreset = presets[appDark ? 0 : 1];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4" onMouseDown={onClose}>
      <div
        {...win.box}
        className="@container w-[800px] h-[600px] min-w-[420px] min-h-[340px] max-w-[96vw] max-h-[94vh] resize flex bg-panel border border-line rounded-xl shadow-pop overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <nav className="w-12 @[640px]:w-44 shrink-0 bg-chrome border-r border-line p-2 space-y-0.5 overflow-y-auto">
          <div {...win.handle} className="hidden @[640px]:block px-2 pt-1.5 pb-2 text-[14px] font-semibold select-none">
            Ajustes
          </div>
          <label className="hidden @[640px]:flex items-center gap-1.5 mx-1 mb-2 h-7 px-2 rounded-md border border-field-line bg-field focus-within:border-accent focus-within:ring-3 focus-within:ring-[var(--selected)]">
            <Search size={13} className="text-muted shrink-0" />
            <input
              className="flex-1 min-w-0 bg-transparent outline-none text-[12px] placeholder:text-muted"
              placeholder="Buscar ajuste"
              aria-label="Buscar ajuste"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {groups.map((g) => (
            <div key={g.name} className="pb-1.5">
              {g.name !== "Acerca de" && (
                <div className="hidden @[640px]:block px-2 pt-1.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted">{g.name}</div>
              )}
              {g.items.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => setSection(id)}
                  title={label}
                  className={`w-full flex items-center gap-2 px-2 h-8 rounded-md text-left ${
                    section === id ? "bg-selected text-fg" : "text-muted hover:text-fg hover:bg-hover"
                  }`}
                >
                  <Icon size={15} className="shrink-0" />
                  <span className="hidden @[640px]:inline truncate">{label}</span>
                </button>
              ))}
            </div>
          ))}
          {q && !visible.length && <p className="px-2 text-[11.5px] text-muted">Sin resultados</p>}
        </nav>

        <div className="flex-1 min-w-0 flex flex-col">
          <header {...win.handle} className="flex items-center justify-between h-12 px-5 border-b border-line select-none">
            <h2 className="text-[14px] font-semibold">{sections.find((x) => x.id === section)?.label}</h2>
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="w-7 h-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover"
            >
              <X size={16} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {section === "appearance" && (
              <>
                <Item label="Interfaz">
                  <Segmented
                    value={s.appTheme}
                    onChange={(v) => onChange({ appTheme: v })}
                    options={[
                      ["system", "Sistema"],
                      ["light", "Claro"],
                      ["dark", "Oscuro"],
                    ]}
                  />
                </Item>

                <Item label="Pestañas" hint="Verticales: en una columna a la izquierda">
                  <Segmented
                    value={s.tabLayout}
                    onChange={(v) => onChange({ tabLayout: v })}
                    options={[
                      ["horizontal", "Horizontales"],
                      ["vertical", "Verticales"],
                    ]}
                  />
                </Item>

                <div>
                  <Label>Tema de terminal</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <ThemeCard
                      preset={{ ...autoPreset, name: "Automático" }}
                      hint="Sigue la interfaz"
                      selected={s.terminalTheme === "auto"}
                      onClick={() => onChange({ terminalTheme: "auto" })}
                      font={s.fontFamily}
                    />
                    {presets.map((p) => (
                      <ThemeCard
                        key={p.id}
                        preset={p}
                        selected={s.terminalTheme === p.id}
                        onClick={() => onChange({ terminalTheme: p.id })}
                        font={s.fontFamily}
                      />
                    ))}
                  </div>
                </div>

                <Item label="Fuente">
                  <input
                    className="field !w-52"
                    list="font-list"
                    placeholder="Predeterminada del sistema"
                    value={s.fontFamily}
                    onChange={(e) => onChange({ fontFamily: e.target.value })}
                  />
                  <datalist id="font-list">
                    {FONTS.map((f) => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                </Item>

                <Item label="Tamaño" hint={`${isMac ? "⌘" : "Ctrl"} + / − también lo ajusta`}>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={9}
                      max={28}
                      value={s.fontSize}
                      onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
                      className="w-36 accent-[var(--accent)]"
                    />
                    <span className="w-10 text-right tabular-nums">{s.fontSize}px</span>
                  </div>
                </Item>

                <Item label="Interlineado">
                  <select
                    className="field !w-28"
                    value={s.lineHeight}
                    onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}
                  >
                    {[1, 1.1, 1.15, 1.2, 1.3, 1.5].map((v) => (
                      <option key={v} value={v}>
                        {v.toFixed(2)}
                      </option>
                    ))}
                  </select>
                </Item>

                <Item label="Cursor">
                  <Segmented
                    value={s.cursorStyle}
                    onChange={(v) => onChange({ cursorStyle: v })}
                    options={[
                      ["block", "Bloque"],
                      ["bar", "Barra"],
                      ["underline", "Subrayado"],
                    ]}
                  />
                </Item>

                <Item label="Cursor parpadeante">
                  <Switch checked={s.cursorBlink} onChange={(v) => onChange({ cursorBlink: v })} />
                </Item>
              </>
            )}

            {section === "highlight" && (
              <HighlightSettings settings={s} theme={termTheme} onChange={onChange} />
            )}

            {section === "modules" && (
              <>
                <p className="text-[12px] text-muted">
                  Muestra u oculta herramientas en la pestaña Herramientas. Desactivar un módulo no borra su configuración.
                </p>
                {MODULES.map(([id, label, hint]) => (
                  <Item key={id} label={label} hint={hint}>
                    <Switch
                      checked={s.modules[id] !== false}
                      onChange={(v) => onChange({ modules: { ...s.modules, [id]: v } })}
                    />
                  </Item>
                ))}
              </>
            )}

            {section === "ai" && <AiSettings settings={s} status={mcpStatus} onChange={onChange} />}

            {section === "terminal" && (
              <>
                <Item label="Historial (scrollback)" hint="Líneas por pestaña. Cada 1.000 líneas llenas ocupan unos 3 MB; el log en disco guarda todo">
                  <select
                    className="field !w-32"
                    value={s.scrollback}
                    onChange={(e) => onChange({ scrollback: Number(e.target.value) })}
                  >
                    {[1000, 2000, 5000, 10000, 50000, 100000].map((v) => (
                      <option key={v} value={v}>
                        {v.toLocaleString("es-CL")}
                      </option>
                    ))}
                  </select>
                </Item>
                <Item label="Copiar al seleccionar" hint="El texto seleccionado pasa al portapapeles">
                  <Switch checked={s.copyOnSelect} onChange={(v) => onChange({ copyOnSelect: v })} />
                </Item>
                <Item label="Pegar con clic derecho">
                  <Switch checked={s.rightClickPaste} onChange={(v) => onChange({ rightClickPaste: v })} />
                </Item>
                <Item label="Confirmar al cerrar" hint="Pide confirmación antes de cortar una sesión remota activa">
                  <Switch checked={s.confirmClose} onChange={(v) => onChange({ confirmClose: v })} />
                </Item>
                <div className="pt-2 text-[12px] font-medium text-muted">Notas</div>
                <Item label="Confirmar envío de varias líneas" hint="Muestra un resumen antes de enviar o pegar un bloque en un equipo remoto">
                  <Switch checked={s.confirmSend} onChange={(v) => onChange({ confirmSend: v })} />
                </Item>
                <Item label="Barra de botones" hint="Comandos rápidos y scripts sobre la barra de estado">
                  <Switch checked={s.showButtonBar} onChange={(v) => onChange({ showButtonBar: v })} />
                </Item>
                <Item label="Pausa entre líneas" hint="Útil en consolas serial o equipos que pierden caracteres al pegar">
                  <select
                    className="field !w-32"
                    value={s.sendLineDelay}
                    onChange={(e) => onChange({ sendLineDelay: Number(e.target.value) })}
                  >
                    {[0, 25, 50, 100, 250, 500].map((v) => (
                      <option key={v} value={v}>
                        {v === 0 ? "Sin pausa" : `${v} ms`}
                      </option>
                    ))}
                  </select>
                </Item>
              </>
            )}

            {section === "about" && <About settings={s} onChange={onChange} />}

            {section === "credentials" && <CredentialSettings />}

            {section === "alerts" && (
              <AlertSettings settings={s} folders={allFolders(sessions, s.extraFolders)} onChange={onChange} />
            )}

            {section === "data" && (
              <>
                <Item label="Grabar logs automáticamente" hint="Cada sesión remota se registra en texto plano">
                  <Switch checked={s.autoLog} onChange={(v) => onChange({ autoLog: v })} />
                </Item>
                <Item label="Hora en cada línea del log" hint="Formato [AAAA-MM-DD HH:MM:SS], útil como evidencia de cambios">
                  <Switch checked={s.logTimestamps} onChange={(v) => onChange({ logTimestamps: v })} />
                </Item>
                <LogNaming settings={s} onChange={onChange} />
                <Item label="Si el archivo ya existe" hint="Anexar sirve con nombres sin hora, p. ej. un log por equipo y día">
                  <Segmented
                    value={s.logAppend ? "append" : "new"}
                    onChange={(v) => onChange({ logAppend: v === "append" })}
                    options={[
                      ["new", "Archivo nuevo"],
                      ["append", "Anexar"],
                    ]}
                  />
                </Item>
                <Item label="Rotación diaria" hint="Al cambiar el día se continúa en un archivo con la fecha nueva">
                  <Switch checked={s.logRotateDaily} onChange={(v) => onChange({ logRotateDaily: v })} />
                </Item>
                <Item label="Ocultar secretos en los logs" hint="password, secret, community, key-string, pre-shared-key… se guardan como ****">
                  <Switch checked={s.logMask} onChange={(v) => onChange({ logMask: v })} />
                </Item>
                <LogsFolder settings={s} onChange={onChange} />
              </>
            )}

            {section === "sessions" && (
              <>
                <Item label="Sesiones" hint="Comparte tu lista de equipos vía portapapeles (JSON) o importa desde otros clientes">
                  <div className="flex gap-1.5">
                    <button
                      onClick={importSessions}
                      className="px-3 h-7 rounded-md border border-line hover:bg-hover"
                    >
                      Importar
                    </button>
                    {onImportFile && (
                      <button
                        onClick={onImportFile}
                        title="PuTTY, SecureCRT, MobaXterm, ~/.ssh/config o CSV"
                        className="px-3 h-7 rounded-md border border-line hover:bg-hover"
                      >
                        Desde archivo…
                      </button>
                    )}
                    <button
                      onClick={exportSessions}
                      className="px-3 h-7 rounded-md border border-line hover:bg-hover"
                    >
                      Exportar
                    </button>
                  </div>
                </Item>
                {notice && <p className="text-[11.5px] text-accent -mt-2">{notice}</p>}
                <Item label="Carpeta de datos" hint={dataDir}>
                  <OpenBtn which="data" />
                </Item>
                <p className="text-[11.5px] text-muted">
                  Para modo portable, crea un archivo llamado <code>portable</code> junto al ejecutable: sesiones,
                  ajustes y logs se guardarán en <code>./data</code>.
                </p>
              </>
            )}
          </div>

          <footer className="flex justify-between items-center px-5 h-12 border-t border-line">
            <button
              onClick={() => onChange({ ...defaultSettings, customRules: s.customRules })}
              title="Las reglas de resaltado personalizadas se conservan"
              className="text-[12px] text-muted hover:text-danger"
            >
              Restablecer valores
            </button>
            <span className="text-[11.5px] text-muted">Los cambios se aplican al instante</span>
          </footer>
        </div>
      </div>
    </div>
  );
}

const LOG_VARS = ["{session}", "{host}", "{folder}", "{date}", "{time}"];

/** Patrón del nombre del log con vista previa (el backend sanea y lo mantiene en la carpeta de logs). */
function LogNaming({ settings: s, onChange }: { settings: Settings; onChange: (p: Partial<Settings>) => void }) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const clean = (v: string) => v.replace(/[^\p{L}\p{N}._\u0000-]/gu, "_");
  const vars: Record<string, string> = {
    "{session}": "core-sw01",
    "{host}": "192.0.2.10",
    "{folder}": "Clientes/Sitio_A/",
    "{date}": `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
    "{time}": `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
  };
  const pattern = s.logPattern || defaultSettings.logPattern;
  let preview = pattern
    .replace(/\{folder\}[\/\\]?/g, "\u0000")
    .split(/(\{[a-z]+\})/)
    .map((part) => vars[part] ?? clean(part))
    .join("")
    .replace(/\u0000/g, vars["{folder}"]);
  if (s.logRotateDaily && !pattern.includes("{date}")) preview += `_${vars["{date}"]}`;
  return (
    <div className="space-y-1.5">
      <Item label="Nombre del archivo" hint="Variables: {session} {host} {folder} {date} {time}. {folder} crea subcarpetas">
        <input
          className="field !w-56 font-mono !text-[12px]"
          value={s.logPattern}
          maxLength={200}
          placeholder={defaultSettings.logPattern}
          onChange={(e) => onChange({ logPattern: e.target.value })}
        />
      </Item>
      <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted">
        {LOG_VARS.map((v) => (
          <button
            key={v}
            onClick={() => onChange({ logPattern: (s.logPattern || "") + v })}
            className="px-1.5 h-5 rounded border border-line hover:bg-hover font-mono"
          >
            {v}
          </button>
        ))}
      </div>
      <div className="text-[11px] text-muted truncate font-mono" title={`logs/${preview}.log`}>
        Ejemplo: logs/{preview}.log
      </div>
    </div>
  );
}

interface LogsDirInfo {
  path: string;
  default: string;
  custom: boolean;
  portable: boolean;
}

/** Carpeta de logs: el backend valida (absoluta, existente, con escritura) y la aplica al instante. */
function LogsFolder({ settings: s, onChange }: { settings: Settings; onChange: (p: Partial<Settings>) => void }) {
  const [info, setInfo] = useState<LogsDirInfo | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    invoke<LogsDirInfo>("logs_dir_get").then(setInfo).catch(() => {});
  }, [s.logsDir]);
  const apply = async (path: string) => {
    setError("");
    try {
      setInfo(await invoke<LogsDirInfo>("logs_dir_set", { path: path || null }));
      onChange({ logsDir: path });
    } catch (e) {
      setError(String(e));
    }
  };
  const pick = async () => {
    const dir = await openDialog({ directory: true, multiple: false, title: "Carpeta de logs", defaultPath: info?.path }).catch(() => null);
    if (typeof dir === "string") apply(dir);
  };
  return (
    <div className="space-y-1.5">
      <Item label="Carpeta de logs" hint={info?.path ?? ""}>
        <div className="flex gap-1.5">
          <button onClick={pick} className="px-3 h-7 rounded-md border border-line hover:bg-hover">
            Elegir…
          </button>
          <OpenBtn which="logs" />
        </div>
      </Item>
      {s.logsDir && (
        <div className="flex items-center gap-2 text-[11.5px] text-muted">
          <button onClick={() => apply("")} className="hover:text-fg hover:underline">
            Restablecer a la predeterminada
          </button>
          <span className="truncate" title={info?.default}>({info?.default})</span>
        </div>
      )}
      {s.logsDir && info?.portable && (
        <p className="text-[11.5px] text-warn">Modo portable: los logs fuera de la carpeta data/ no viajan con el pendrive.</p>
      )}
      {error && <p className="text-[11.5px] text-danger">{error}</p>}
    </div>
  );
}

function UpdateSettings({ settings: s, onChange }: { settings: Settings; onChange: (p: Partial<Settings>) => void }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState("");
  const [repo, setRepo] = useState("");
  useEffect(() => {
    invoke<string>("app_version").then(setVersion).catch(() => {});
    invoke<string>("app_repo").then(setRepo).catch(() => {});
  }, []);
  const check = async () => {
    setBusy(true);
    setStatus("");
    try {
      const u = await invoke<UpdateInfo>("update_check");
      if (s.updateDismissed) onChange({ updateDismissed: "" });
      if (u.newer) window.dispatchEvent(new CustomEvent("nt-update-found", { detail: u }));
      setStatus(
        u.newer
          ? u.supported
            ? `Hay una versión nueva: ${u.latest}. Instálala desde el aviso en la parte superior.`
            : `Hay una versión nueva: ${u.latest}. ${u.reason ?? ""}`
          : `Estás al día (${u.current}).`,
      );
    } catch (e) {
      setStatus(String(e));
    }
    setBusy(false);
  };
  return (
    <div className="rounded-lg border border-line p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div>Actualizaciones</div>
          <div className="text-[11.5px] text-muted">
            Versión instalada {version}. Revisa al abrir la app y cada 6 horas; instala con un clic y verifica la firma del
            proyecto antes de instalar.
          </div>
        </div>
        <button onClick={check} disabled={busy} className="shrink-0 px-3 h-7 rounded-md border border-line hover:bg-hover disabled:opacity-40">
          {busy ? "Buscando…" : "Buscar ahora"}
        </button>
      </div>
      {repo && <p className="text-[11px] text-muted">Fuente: releases de github.com/{repo}</p>}
      {status && <p className="text-[12px] text-accent">{status}</p>}
    </div>
  );
}

/** Acerca de: versión, autor, repositorio y el bloque de actualizaciones (misma información). */
function About({ settings, onChange }: { settings: Settings; onChange: (p: Partial<Settings>) => void }) {
  const [version, setVersion] = useState("");
  const [repo, setRepo] = useState("");
  useEffect(() => {
    invoke<string>("app_version").then(setVersion).catch(() => {});
    invoke<string>("app_repo").then(setRepo).catch(() => {});
  }, []);
  return (
    <div className="space-y-5">
    <div className="flex flex-col items-center text-center gap-2 pt-4">
      <img src={logo} alt="" className="w-16 h-16" />
      <div className="text-[18px] font-semibold">NetTerminal</div>
      <div className="text-[12px] text-muted">Versión {version}</div>
      <p className="text-[13px] mt-2">
        Creado por <span className="font-semibold">Nicolás Rivera</span>
      </p>
      <p className="text-[12px] text-muted">Desarrollado en conjunto con Claude</p>
      <p className="text-[12px] text-muted max-w-sm mt-2">
        Cliente SSH, Telnet, Serial y terminal local para el trabajo diario con equipos de red. Tauri 2, Rust y xterm.js.
      </p>
      {repo && (
        <button onClick={() => openUrl(`https://github.com/${repo}`)} className="mt-2 px-3 h-7 rounded-md border border-line hover:bg-hover text-[12px]">
          github.com/{repo}
        </button>
      )}
    </div>
    <UpdateSettings settings={settings} onChange={onChange} />
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-[12px] font-medium text-muted">{children}</div>;
}

function Item({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 min-h-8">
      <div className="min-w-0">
        <div>{label}</div>
        {hint && <div className="text-[11.5px] text-muted truncate" title={hint}>{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors ${checked ? "bg-accent" : "bg-field-line"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex p-0.5 rounded-lg bg-hover">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-3 h-7 rounded-md text-[12.5px] ${
            value === v ? "bg-panel shadow-sm text-fg" : "text-muted hover:text-fg"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ThemeCard({
  preset,
  hint,
  selected,
  onClick,
  font,
}: {
  preset: TermPreset;
  hint?: string;
  selected: boolean;
  onClick: () => void;
  font: string;
}) {
  const t = preset.theme;
  const swatches = [t.red, t.green, t.yellow, t.blue, t.magenta, t.cyan];
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg border overflow-hidden ${
        selected ? "border-accent ring-2 ring-[var(--selected)]" : "border-line hover:border-muted"
      }`}
    >
      <div className="px-2.5 py-2 text-[11px] leading-snug" style={{ background: t.background, color: t.foreground, fontFamily: fontStack(font) }}>
        <div>
          <span style={{ color: t.green }}>noc@core</span>
          <span style={{ color: t.blue }}>:~</span>$ show ver
        </div>
        <div className="flex gap-1 mt-1.5">
          {swatches.map((c, i) => (
            <span key={i} className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between px-2.5 h-7 text-[12px]">
        <span className="truncate">
          {preset.name}
          {hint && <span className="text-muted"> · {hint}</span>}
        </span>
        {selected && <Check size={13} className="text-accent shrink-0" />}
      </div>
    </button>
  );
}

function OpenBtn({ which }: { which: "logs" | "data" }) {
  return (
    <button
      onClick={() => invoke("open_dir", { which }).catch(console.error)}
      className="flex items-center gap-1.5 px-3 h-7 rounded-md border border-line hover:bg-hover"
    >
      <FolderOpen size={14} />
      Abrir
    </button>
  );
}
