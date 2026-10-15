import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Blocks, Bot, Check, FolderOpen, Highlighter, Palette, ScrollText, SquareTerminal, X } from "lucide-react";
import type { ModuleId } from "../lib/settings";
import { AiSettings } from "./AiSettings";
import { useDragResize } from "../lib/useDragResize";
import type { ITheme } from "@xterm/xterm";
import { HighlightSettings } from "./HighlightSettings";
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
  initialSection?: Section;
  mcpStatus: string;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}

export type Section = "appearance" | "highlight" | "terminal" | "modules" | "ai" | "data";

const MODULES: [ModuleId, string, string][] = [
  ["monitor", "Monitoreo", "Sondas ICMP/TCP con gráfico y alarma sonora"],
  ["diag", "Diagnóstico", "Ping continuo, traceroute y verificación de puertos"],
  ["topology", "Topología", "Diagrama de vecinos CDP/LLDP y seguimiento de rutas"],
  ["subnet", "Subredes", "Calculadora IPv4/IPv6 y división de redes"],
  ["perf", "Velocidad", "Speedtest (Cloudflare) e iperf3"],
  ["transfer", "TFTP / HTTP", "Servir firmware y recibir respaldos desde equipos"],
  ["syslog", "Syslog", "Recibir logs de equipos en vivo"],
  ["plugins", "Plugins", "Extensiones instalables en Python"],
];

const sections: { id: Section; label: string; Icon: typeof Palette }[] = [
  { id: "appearance", label: "Apariencia", Icon: Palette },
  { id: "highlight", label: "Resaltado", Icon: Highlighter },
  { id: "terminal", label: "Terminal", Icon: SquareTerminal },
  { id: "modules", label: "Módulos", Icon: Blocks },
  { id: "ai", label: "Agentes IA", Icon: Bot },
  { id: "data", label: "Logs y datos", Icon: ScrollText },
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
  initialSection,
  mcpStatus,
  onChange,
  onClose,
}: Props) {
  const [section, setSection] = useState<Section>(initialSection ?? "appearance");
  const win = useDragResize("settingsWindow");
  const [dataDir, setDataDir] = useState("");
  const [notice, setNotice] = useState("");

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(""), 3500);
  };

  const exportSessions = async () => {
    const list = sessions.filter((x) => x.type !== "local").map(({ id: _id, created_at: _c, ...rest }) => rest);
    await writeText(JSON.stringify(list, null, 2));
    flash(`${list.length} sesiones copiadas al portapapeles (sin contraseñas: no se guardan)`);
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
          <div {...win.handle} className="hidden @[640px]:block px-2 pt-1.5 pb-3 text-[14px] font-semibold select-none">
            Ajustes
          </div>
          {sections.map(({ id, label, Icon }) => (
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
        </nav>

        <div className="flex-1 min-w-0 flex flex-col">
          <header {...win.handle} className="flex items-center justify-between h-12 px-5 border-b border-line select-none">
            <h2 className="text-[14px] font-semibold">{sections.find((x) => x.id === section)?.label}</h2>
            <button
              onClick={onClose}
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
                <Item label="Historial (scrollback)" hint="Líneas que se conservan por pestaña">
                  <select
                    className="field !w-32"
                    value={s.scrollback}
                    onChange={(e) => onChange({ scrollback: Number(e.target.value) })}
                  >
                    {[1000, 5000, 10000, 50000, 100000].map((v) => (
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

            {section === "data" && (
              <>
                <Item label="Grabar logs automáticamente" hint="Cada sesión remota se registra en texto plano">
                  <Switch checked={s.autoLog} onChange={(v) => onChange({ autoLog: v })} />
                </Item>
                <Item label="Hora en cada línea del log" hint="Formato [AAAA-MM-DD HH:MM:SS], útil como evidencia de cambios">
                  <Switch checked={s.logTimestamps} onChange={(v) => onChange({ logTimestamps: v })} />
                </Item>
                <Item label="Carpeta de logs">
                  <OpenBtn which="logs" />
                </Item>
                <Item label="Sesiones" hint="Comparte tu lista de equipos con el equipo vía portapapeles (JSON)">
                  <div className="flex gap-1.5">
                    <button
                      onClick={importSessions}
                      className="px-3 h-7 rounded-md border border-line hover:bg-hover"
                    >
                      Importar
                    </button>
                    <button
                      onClick={exportSessions}
                      className="px-3 h-7 rounded-md border border-line hover:bg-hover"
                    >
                      Exportar
                    </button>
                  </div>
                </Item>
                {notice && <p className="text-[11.5px] text-accent -mt-2">{notice}</p>}
                <UpdateSettings settings={s} onChange={onChange} />
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

function UpdateSettings({ settings: s, onChange }: { settings: Settings; onChange: (p: Partial<Settings>) => void }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState("");
  useEffect(() => {
    invoke<string>("app_version").then(setVersion);
  }, []);
  const check = async () => {
    setBusy(true);
    setStatus("");
    try {
      const u = await invoke<UpdateInfo>("check_update", { repo: s.updateRepo, token: s.updateToken || null });
      onChange({ updateLastCheck: Date.now(), updateDismissed: "" });
      setStatus(u.newer ? `Hay una versión nueva: ${u.latest}. Reinicia la app para ver el aviso.` : `Estás al día (${u.latest || u.current}).`);
    } catch (e) {
      setStatus(String(e));
    }
    setBusy(false);
  };
  return (
    <div className="rounded-lg border border-line p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div>
          <div>Actualizaciones</div>
          <div className="text-[11.5px] text-muted">Versión instalada {version}. Solo avisa; la descarga es manual.</div>
        </div>
        <button onClick={check} disabled={busy} className="px-3 h-7 rounded-md border border-line hover:bg-hover disabled:opacity-40">
          {busy ? "Buscando…" : "Buscar ahora"}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className="field !h-7 !text-[12px]" placeholder="dueño/repositorio" value={s.updateRepo} onChange={(e) => onChange({ updateRepo: e.target.value.trim() })} />
        <input
          className="field !h-7 !text-[12px] font-mono"
          type="password"
          placeholder="Token de GitHub (solo si es privado)"
          value={s.updateToken}
          onChange={(e) => onChange({ updateToken: e.target.value.trim() })}
        />
      </div>
      <p className="text-[11px] text-muted">
        Para un repositorio privado crea un token "fine-grained" con acceso de solo lectura a Contents de ese repositorio, con
        vencimiento. Se guarda solo en este equipo.
      </p>
      {status && <p className="text-[12px] text-accent">{status}</p>}
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
      className={`relative w-9 h-5 rounded-full transition-colors ${checked ? "bg-accent" : "bg-line"}`}
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
