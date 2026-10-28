import { useEffect, useMemo, useRef, useState } from "react";
import type { ITheme } from "@xterm/xterm";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { CircleAlert, CircleCheck, Copy, Play, Save, Square, Terminal, Trash2, X } from "lucide-react";
import { CodeEditor } from "./CodeEditor";
import { TargetOptions } from "./BroadcastTarget";
import { BroadcastDialog } from "./BroadcastDialog";
import { fillTemplate, templateVars } from "./TemplateDialog";
import { Compiled } from "../lib/highlight";
import { Resolved, isBroadcastRunning, targetLabel, useBroadcastTarget, useWorkspace } from "../lib/broadcast";
import { LabItem, SAVE_COMMAND, clearLab, isLabRunning, labReport, runLab, scriptLines, stopLab, useLabRun } from "../lib/cliLab";
import { runOnDeviceResult } from "../lib/deviceRun";
import { isSecretVar } from "../lib/templateSecrets";
import { useDragResize } from "../lib/useDragResize";
import { fontStack } from "../lib/theme";
import { persist, stored } from "../lib/prefs";
import { tabTitle } from "../types";
import { plural } from "../lib/plural";

type Script = { id: string; name: string; text: string };

interface Props {
  initialText?: string;
  scripts: Script[];
  onScripts: (list: Script[]) => void;
  /** Fabricante de la pestaña activa (catálogo): comando de guardado sugerido. */
  vendor: string;
  compiled: Compiled[];
  theme: ITheme;
  font: string;
  fontSize: number;
  /** Destinos según el selector de destino de la barra de estado. */
  resolve: () => Resolved;
  /** Conexión de una pestaña, si sigue conectada. */
  connOf: (tabId: string) => string | undefined;
  onClose: () => void;
}

const DRAFT = "cliLabDraft";
const LAB_DEFAULTS = { stopOnError: true, answer: false, parallel: 4, timeout: 30 };
const OPTS = "cliLabOptions";
const statusText = { pending: "En cola", running: "Ejecutando", ok: "OK", error: "Error", stopped: "Detenido", skipped: "Omitido" } as const;
const statusColor = { pending: "text-muted", running: "text-accent", ok: "text-ok", error: "text-danger", stopped: "text-warn", skipped: "text-muted" } as const;

/**
 * CLI Lab: script de varias líneas que se ejecuta en las sesiones del destino elegido, línea a
 * línea y leyendo cada respuesta. Se detiene al primer error de CLI y nunca confirma preguntas
 * del equipo salvo que se pida (o sea un comando de guardado).
 */
export function CliLab(p: Props) {
  const [text, setText] = useState(() => p.initialText ?? stored(DRAFT, { text: "" }).text ?? "");
  const [scriptId, setScriptId] = useState<string>("");
  const [opts, setOpts] = useState(() => ({ ...LAB_DEFAULTS, ...stored(OPTS, LAB_DEFAULTS) }));
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ text: string; shown: string; resolved: Resolved } | null>(null);
  const [view, setView] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  /** Nombre en edición al guardar un script nuevo (sin window.prompt: no existe en todas las webviews). */
  const [naming, setNaming] = useState<string | null>(null);
  const run = useLabRun();
  const target = useBroadcastTarget();
  const ws = useWorkspace();
  const win = useDragResize<HTMLDivElement>("cliLabWindow");

  useEffect(() => persist(DRAFT, { text }), [text]);
  useEffect(() => persist(OPTS, opts), [opts]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !confirm && naming === null && p.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p.onClose, confirm, naming]);

  const vars = useMemo(() => templateVars(text), [text]);
  const lines = useMemo(() => scriptLines(text), [text]);
  const current = p.scripts.find((s) => s.id === scriptId);
  const dirty = current ? current.text !== text : !!text.trim();
  const saveCmd = SAVE_COMMAND[p.vendor];
  const missing = vars.filter((v) => !values[v]?.trim());
  const running = !!run?.running;

  const execute = () => {
    if (!lines.length) return setMsg("El script no tiene comandos (las líneas con !, # o // son comentarios)");
    if (missing.length) return setMsg(`Completa: ${missing.join(", ")}`);
    if (isLabRunning()) return setMsg("Ya hay un script en ejecución");
    if (isBroadcastRunning()) return setMsg("Hay un envío a varias sesiones en curso: espera a que termine");
    const filled = scriptLines(fillTemplate(text, values)).join("\n");
    const masked = Object.fromEntries(vars.map((v) => [v, isSecretVar(v) ? "••••••" : values[v]]));
    setMsg("");
    setConfirm({ text: filled, shown: scriptLines(fillTemplate(text, masked)).join("\n"), resolved: p.resolve() });
  };

  const start = () => {
    if (!confirm) return;
    const { text: body, resolved } = confirm;
    setConfirm(null);
    setView(null);
    const timeout = Math.max(5, Math.min(600, opts.timeout));
    runLab(
      resolved.targets.map((t) => ({ tabId: t.id, name: tabTitle(t), host: t.session.host })),
      body.split("\n"),
      {
        stopOnError: opts.stopOnError,
        parallel: opts.parallel,
        answer: opts.answer,
        conn: p.connOf,
        exec: (conn, cmd, answer) => runOnDeviceResult(conn, cmd, timeout, answer),
      },
    ).catch((e) => setMsg(String(e)));
  };

  const saveScript = (asNew: boolean) => {
    if (current && !asNew) {
      p.onScripts(p.scripts.map((s) => (s.id === current.id ? { ...s, text } : s)));
      return setMsg(`Guardado: ${current.name}`);
    }
    setNaming(current ? `${current.name} (copia)` : (lines[0]?.trim().slice(0, 40) ?? "Script"));
  };
  const commitName = () => {
    const name = naming?.trim();
    setNaming(null);
    if (!name) return;
    const id = crypto.randomUUID();
    p.onScripts([...p.scripts, { id, name, text }]);
    setScriptId(id);
    setMsg(`Guardado: ${name}`);
  };

  const n = p.resolve().targets.length;

  // Sin equipo elegido se muestra el primero con error; la vista salta al comando que falló.
  const shown = run?.items.find((i) => i.tabId === view) ?? (run?.running ? null : (run?.items.find((i) => i.status === "error") ?? null));
  const failRef = useRef<HTMLDivElement>(null);
  const failKey = shown && !run?.running ? `${shown.tabId}:${shown.steps.length}` : "";
  useEffect(() => {
    if (failKey) failRef.current?.scrollIntoView({ block: "nearest" });
  }, [failKey]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4" onMouseDown={p.onClose}>
      <div
        {...win.box}
        className="w-[960px] h-[640px] bg-panel border border-line rounded-xl shadow-pop resize overflow-hidden flex flex-col min-w-[620px] min-h-[420px] max-w-[98vw] max-h-[96vh]"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="CLI Lab"
      >
        <header {...win.handle} className="shrink-0 flex items-center gap-2 px-4 h-12 border-b border-line select-none">
          <Terminal size={16} className="text-accent" />
          <h2 className="text-[14px] font-semibold mr-2">CLI Lab</h2>
          <select
            className="field !h-7 !w-56 !text-[12px]"
            value={scriptId}
            aria-label="Script guardado"
            onChange={(e) => {
              const s = p.scripts.find((x) => x.id === e.target.value);
              setScriptId(e.target.value);
              if (s) setText(s.text);
            }}
          >
            <option value="">{current ? "Script nuevo" : dirty ? "Script sin guardar" : "Scripts guardados…"}</option>
            {p.scripts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {naming !== null ? (
            <input
              autoFocus
              className="field !h-7 !w-48 !text-[12px]"
              aria-label="Nombre del script"
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commitName();
                if (e.key === "Escape") setNaming(null);
              }}
              onBlur={commitName}
            />
          ) : (
          <button onClick={() => saveScript(false)} disabled={!text.trim() || (!!current && !dirty)} title={current ? "Guardar cambios" : "Guardar script"} className="flex items-center gap-1 px-2 h-7 rounded-md border border-line hover:bg-hover disabled:opacity-40 text-[12px]">
            <Save size={13} /> Guardar
          </button>
          )}
          {current && (
            <>
              <button onClick={() => saveScript(true)} className="px-2 h-7 rounded-md border border-line hover:bg-hover text-[12px]">
                Guardar como…
              </button>
              <button
                onClick={() => {
                  p.onScripts(p.scripts.filter((s) => s.id !== current.id));
                  setScriptId("");
                }}
                title="Eliminar script guardado"
                className="w-7 h-7 grid place-items-center rounded-md text-danger hover:bg-hover"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
          <span className="flex-1" />
          <button onClick={p.onClose} aria-label="Cerrar" className="w-7 h-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 min-h-0 flex">
          <section className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden border-b border-line">
              <CodeEditor
                value={text}
                onChange={setText}
                compiled={p.compiled}
                theme={p.theme}
                font={fontStack(p.font)}
                fontSize={p.fontSize}
                placeholder={"Un comando por línea; se ejecutan en orden y se lee cada respuesta.\n! comentario  # comentario  // comentario\n\nconfig system interface\n    edit {{puerto}}\n        set alias {{alias}}\n    next\nend"}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    execute();
                  }
                }}
              />
            </div>
            <div className="shrink-0 flex items-center gap-2 px-3 h-9 text-[11.5px] text-muted">
              <span>{plural(lines.length, "comando", "comandos")}</span>
              <button
                disabled={!saveCmd}
                title={
                  saveCmd
                    ? `Agrega "${saveCmd}" al final`
                    : p.vendor === "fortinet"
                      ? "FortiOS guarda la configuración al cerrar el bloque con end"
                      : "Sin comando de guardado conocido para este fabricante"
                }
                onClick={() => saveCmd && setText((t) => `${t.replace(/\s+$/, "")}${t.trim() ? "\n" : ""}${saveCmd}\n`)}
                className="px-2 h-6 rounded-md border border-line hover:bg-hover hover:text-fg disabled:opacity-40"
              >
                + Guardar config{saveCmd ? ` (${saveCmd})` : ""}
              </button>
              <span className="flex-1" />
              <span>{`Ctrl/⌘+Enter ejecuta`}</span>
            </div>
            {vars.length > 0 && (
              <div className="shrink-0 px-3 pb-2 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
                {vars.map((v) => (
                  <label key={v} className="block text-[11.5px]">
                    <span className="block mb-0.5 font-medium text-muted">{`{{${v}}}`}</span>
                    <input
                      className="field !h-7 !text-[12px]"
                      type={isSecretVar(v) ? "password" : "text"}
                      autoComplete="off"
                      value={values[v] ?? ""}
                      onChange={(e) => setValues((x) => ({ ...x, [v]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
            )}
            {run && (
              <section className="shrink-0 h-[48%] min-h-[150px] border-t border-line flex min-w-0">
                <div className="w-56 shrink-0 border-r border-line flex flex-col">
                  <div className="flex items-center gap-2 px-3 h-8 text-[11.5px] border-b border-line">
                    <span className="font-medium">{running ? "Ejecutando…" : "Resultado"}</span>
                    <span className="text-muted">
                      {run.items.filter((i) => i.status === "ok").length}/{run.items.length} OK
                    </span>
                    <span className="flex-1" />
                    <button title="Copiar informe" className="text-muted hover:text-fg" onClick={() => writeText(labReport(run)).then(() => setMsg("Informe copiado"))}>
                      <Copy size={13} />
                    </button>
                    {!running && (
                      <button title="Cerrar resultado" className="text-muted hover:text-fg" onClick={clearLab}>
                        <X size={13} />
                      </button>
                    )}
                  </div>
                  <ul className="flex-1 overflow-y-auto text-[12px]">
                    {run.items.map((i) => (
                      <li key={i.tabId}>
                        <button onClick={() => setView(i.tabId)} className={`w-full flex items-center gap-2 px-3 h-7 text-left hover:bg-hover ${shown?.tabId === i.tabId ? "bg-selected" : ""}`}>
                          <StatusIcon item={i} />
                          <span className="truncate flex-1">{i.name}</span>
                          <span className={`text-[11px] tabular-nums ${statusColor[i.status]}`}>
                            {i.status === "running" ? `${i.steps.length}/${run.lines}` : statusText[i.status]}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex-1 min-w-0 overflow-auto font-mono text-[11.5px] p-2">
                  {!shown && <p className="font-sans text-[12px] text-muted p-2">Elige un equipo para ver la respuesta de cada comando.</p>}
                  {shown && shown.reason && <p className="font-sans text-[12px] text-danger px-1 pb-1">{shown.reason}</p>}
                  {shown?.steps.map((s, k) => (
                    <div
                      key={k}
                      ref={!s.ok && shown.steps.findIndex((x) => !x.ok) === k ? failRef : undefined}
                      className={`mb-1.5 rounded border-l-2 pl-2 ${s.ok ? "border-line" : "border-danger"}`}
                    >
                      <div className={`font-semibold ${s.ok ? "" : "text-danger"}`}>
                        {k + 1}. {s.cmd}
                      </div>
                      {s.note && <div className="font-sans text-danger">{s.note}</div>}
                      <pre className="whitespace-pre-wrap text-muted">{s.output.replace(/\r/g, "").trim()}</pre>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </section>

          <aside className="w-72 shrink-0 border-l border-line flex flex-col overflow-y-auto">
            <div className="p-2">
              <h3 className="px-2 pb-1 text-[11.5px] font-medium text-muted">Destino ({targetLabel(target, ws)} · {plural(n, "conectada", "conectadas")})</h3>
              <TargetOptions />
            </div>
            <div className="px-4 py-2 space-y-2 border-t border-line text-[12px]">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-[var(--accent)]" checked={opts.stopOnError} onChange={(e) => setOpts((o) => ({ ...o, stopOnError: e.target.checked }))} />
                Detener el equipo al primer error
              </label>
              <label className="flex items-start gap-2" title="y/n, [confirm], Continue? [Y/N]. Los comandos de guardado siempre se confirman.">
                <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={opts.answer} onChange={(e) => setOpts((o) => ({ ...o, answer: e.target.checked }))} />
                <span>
                  Responder "sí" a las preguntas del equipo
                  <span className="block text-[11px] text-muted">Apagado: se responde que no y se marca error.</span>
                </span>
              </label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5">
                  Equipos a la vez
                  <input type="number" min={1} max={10} className="field !h-7 !w-14" value={opts.parallel} onChange={(e) => setOpts((o) => ({ ...o, parallel: Math.max(1, Math.min(10, Number(e.target.value) || 1)) }))} />
                </label>
                <label className="flex items-center gap-1.5" title="Tiempo máximo de respuesta por comando">
                  <input type="number" min={5} max={600} className="field !h-7 !w-16" value={opts.timeout} onChange={(e) => setOpts((o) => ({ ...o, timeout: Number(e.target.value) || 30 }))} />s
                </label>
              </div>
            </div>
            <div className="mt-auto p-3 border-t border-line space-y-2">
              {msg && <p className="text-[11.5px] text-warn">{msg}</p>}
              {running ? (
                <button onClick={stopLab} className="w-full flex items-center justify-center gap-1.5 h-9 rounded-md bg-danger text-danger-fg font-medium hover:opacity-90">
                  <Square size={11} fill="currentColor" /> Detener
                </button>
              ) : (
                <button
                  onClick={execute}
                  disabled={!lines.length || n === 0}
                  className="w-full flex items-center justify-center gap-1.5 h-9 rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-40"
                >
                  <Play size={13} /> Ejecutar en {plural(n, "equipo", "equipos")}
                </button>
              )}
            </div>
          </aside>
        </div>

      </div>
      {confirm && (
        <BroadcastDialog
          text={confirm.shown}
          resolved={confirm.resolved}
          delayMs={0}
          verb="Ejecutar"
          onCancel={() => setConfirm(null)}
          onConfirm={start}
        />
      )}
    </div>
  );
}

function StatusIcon({ item }: { item: LabItem }) {
  if (item.status === "ok") return <CircleCheck size={13} className="text-ok shrink-0" />;
  if (item.status === "error") return <CircleAlert size={13} className="text-danger shrink-0" />;
  return <span className={`w-[13px] h-[13px] shrink-0 rounded-full border ${item.status === "running" ? "border-accent animate-pulse" : "border-line"}`} />;
}
