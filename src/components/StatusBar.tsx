import { memo, useEffect, useState } from "react";
import { ArrowLeftRight, BookOpen, KeyRound, Bot, Circle, CircleDot, NotebookPen, RotateCcw, Search, Settings, ShieldAlert, ShieldCheck, Unplug, Zap } from "lucide-react";
import { DeviceInfo, LIFE_LABEL, LifeLevel, Lifecycle, findLifecycle, lifeDetail, lifeLevel, loadLifecycle } from "../lib/lifecycle";
import { Tab, TabState, historyKey, sessionTarget, tunnelLabel } from "../types";
import { HistoryMenu } from "./HistoryMenu";
import { BroadcastTargetPicker } from "./BroadcastTarget";
import { QuickBolt, typeLabel } from "./SessionIcon";
import { statusColor } from "./TabBar";
import { isMac, modLabel } from "../lib/platform";

/** Etiquetas de botones: con la barra angosta (ventana mínima o vista con barra lateral) solo
 *  queda el icono y el title; antes los últimos botones se salían de la ventana. */
const LBL = "hidden @[52rem]:inline";

const statusText = { connecting: "Conectando", connected: "Conectado", closed: "Desconectado" };

interface Props {
  tab: Tab | undefined;
  state: TabState | undefined;
  onToggleLog: () => void;
  onBreak: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
  onFind: () => void;
  onSettings: () => void;
  notesOpen: boolean;
  onNotes: () => void;
  commandsOpen: boolean;
  onCommands: () => void;
  aiEnabled: boolean;
  onAi: () => void;
  /** Reenvía un comando del historial (opcional: sin él no se muestra el historial). */
  onResend?: (cmd: string) => void;
  /** Guarda la conexión rápida de la pestaña como sesión. */
  onSaveAs?: () => void;
  /** Modelo y versión leídos de la pantalla (show version): ciclo de vida del equipo. */
  device?: DeviceInfo;
}

export const StatusBar = memo(function StatusBar({
  tab,
  state,
  onToggleLog,
  onBreak,
  onReconnect,
  onDisconnect,
  onFind,
  onSettings,
  notesOpen,
  onNotes,
  commandsOpen,
  onCommands,
  aiEnabled,
  onAi,
  onResend,
  onSaveAs,
  device,
}: Props) {
  const gear = (
    <>
      {aiEnabled && (
        <BarBtn onClick={onAi} title="Servidor MCP activo: los agentes de IA pueden conectarse" className="!text-accent">
          <Bot size={12} />
          <span className={LBL}>IA</span>
        </BarBtn>
      )}
      <BarBtn onClick={onCommands} title={`Catálogo de comandos (${modLabel}L)`} className={commandsOpen ? "!text-accent" : ""}>
        <BookOpen size={12} />
        <span className={LBL}>Comandos</span>
      </BarBtn>
      <BarBtn onClick={onNotes} title={`Notas (${modLabel}J)`} className={notesOpen ? "!text-accent" : ""}>
        <NotebookPen size={12} />
        <span className={LBL}>Notas</span>
      </BarBtn>
      <BarBtn onClick={onSettings} title={`Ajustes (${isMac ? "⌘" : "Ctrl+"},)`}>
        <Settings size={12} />
      </BarBtn>
    </>
  );
  if (!tab || !state)
    return (
      <div className="@container h-7 shrink-0 flex items-center justify-end px-3 bg-chrome border-t border-line text-[11.5px] text-muted">
        {gear}
      </div>
    );
  const { session } = tab;
  const logging = !!state.logPath;
  const canBreak = session.type === "serial" || session.type === "telnet";
  const connected = state.status === "connected";

  return (
    <div className="@container h-7 shrink-0 flex items-center gap-3 px-3 bg-chrome border-t border-line text-[11.5px] text-muted">
      <span className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor[state.status] }} />
        {statusText[state.status]}
      </span>
      <span className="font-medium text-fg/80">{typeLabel[session.type]}</span>
      <span className="truncate min-w-0">{sessionTarget(session)}</span>
      {session.type === "ssh" && !!session.tunnels?.length && (
        <span
          className="flex items-center gap-1 shrink-0 text-fg/80"
          title={`Túneles${connected ? " activos" : ""}:\n${session.tunnels.map(tunnelLabel).join("\n")}`}
        >
          <ArrowLeftRight size={11} />
          {session.tunnels.length === 1 ? tunnelLabel(session.tunnels[0]) : `${session.tunnels.length} túneles`}
        </span>
      )}

      {onSaveAs && !session.id && session.type !== "local" && !session.scp && (
        <BarBtn onClick={onSaveAs} title="Conexión rápida sin guardar: guardar como sesión">
          <QuickBolt size={12} />
          <span className={LBL}>Guardar como sesión…</span>
        </BarBtn>
      )}

      {session.save_password && session.type !== "local" && (
        <span
          className="flex items-center shrink-0 text-fg/80"
          title="Contraseña guardada: se completa sola en el primer pedido de contraseña al conectar"
        >
          <KeyRound size={11} />
        </span>
      )}

      {device?.model && <LifecycleChip model={device.model} version={device.version} name={device.name} />}

      <div className="ml-auto shrink-0 flex items-center gap-0.5">
        {/* Destino único de Notas, catálogo, botones y scripts: siempre a la vista. */}
        <BroadcastTargetPicker />
        <span className="w-px h-3.5 mx-1 bg-line" />
        <BarBtn
          onClick={onToggleLog}
          disabled={!connected && !logging}
          title={logging ? `Grabando en ${state.logPath}` : "Grabar la sesión en un archivo de texto"}
          className={logging ? "!text-danger" : ""}
        >
          {logging ? <CircleDot size={12} /> : <Circle size={12} />}
          <span className={LBL}>{logging ? "Grabando" : "Log"}</span>
        </BarBtn>
        {canBreak && (
          <BarBtn onClick={onBreak} disabled={!connected} title="Enviar señal Break">
            <Zap size={12} />
            <span className={LBL}>Break</span>
          </BarBtn>
        )}
        {onResend && !session.scp && (
          <HistoryMenu historyKey={historyKey(session)} connected={connected} onResend={onResend} />
        )}
        <BarBtn onClick={onFind} title={`Buscar (${modLabel}F)`}>
          <Search size={12} />
        </BarBtn>
        {connected || state.status === "connecting" ? (
          <BarBtn onClick={onDisconnect} title="Desconectar (la pestaña queda abierta)">
            <Unplug size={12} />
            <span className={LBL}>Desconectar</span>
          </BarBtn>
        ) : (
          <BarBtn onClick={onReconnect} title="Reconectar (o Enter en la terminal)" className="!text-accent">
            <RotateCcw size={12} />
            <span className={LBL}>Reconectar</span>
          </BarBtn>
        )}
        <span className="w-px h-3.5 mx-1 bg-line" />
        {gear}
      </div>
    </div>
  );
});

function BarBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`shrink-0 whitespace-nowrap flex items-center justify-center gap-1 h-6 min-w-6 px-1.5 rounded hover:bg-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent ${props.className ?? ""}`}
    />
  );
}

const LIFE_CLASS: Record<LifeLevel, string> = {
  ldos: "text-danger",
  eosw: "text-danger",
  eos: "text-warn",
  announced: "text-warn",
  none: "text-fg/80",
  unknown: "text-warn",
};

/**
 * Modelo y etapa del ciclo de vida (fin de venta, de software, de soporte). La base se descarga
 * recién aquí, la primera vez que una pestaña muestra un modelo.
 */
export function LifecycleChip({ model, version, name }: { model: string; version?: string; name?: string }) {
  const [life, setLife] = useState<{ model: string; l: Lifecycle | null } | null>(null);
  useEffect(() => {
    let live = true;
    loadLifecycle()
      .then((db) => live && setLife({ model, l: findLifecycle(db, model) }))
      .catch(() => live && setLife(null));
    return () => {
      live = false;
    };
  }, [model]);
  if (!life || life.model !== model) return null;
  const level = lifeLevel(life.l, new Date().toISOString().slice(0, 10));
  const bad = level !== "none";
  const tip = `${name ? `Equipo: ${name}\n` : ""}${lifeDetail(model, life.l, version)}\nSe actualiza con cada show version (o equivalente) que ejecutes.`;
  return (
    <span className={`flex items-center gap-1 min-w-0 shrink ${LIFE_CLASS[level]}`} title={tip} aria-label={`${model}: ${LIFE_LABEL[level]}`}>
      {bad ? <ShieldAlert size={11} className="shrink-0" /> : <ShieldCheck size={11} className="shrink-0" />}
      <span className="truncate">
        <span className="font-medium">{model}</span>
        {version && <span className="hidden @[60rem]:inline text-muted"> · {version}</span>} · {LIFE_LABEL[level]}
      </span>
    </span>
  );
}
