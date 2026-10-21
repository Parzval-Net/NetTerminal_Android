import { memo } from "react";
import { ArrowLeftRight, BookOpen, Bot, Circle, CircleDot, NotebookPen, RotateCcw, Search, Settings, Unplug, Zap } from "lucide-react";
import { Tab, TabState, historyKey, sessionTarget, tunnelLabel } from "../types";
import { HistoryMenu } from "./HistoryMenu";
import { typeLabel } from "./SessionIcon";
import { statusColor } from "./TabBar";
import { isMac, modLabel } from "../lib/platform";

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
}: Props) {
  const gear = (
    <>
      {aiEnabled && (
        <BarBtn onClick={onAi} title="Servidor MCP activo: los agentes de IA pueden conectarse" className="!text-accent">
          <Bot size={12} />
          IA
        </BarBtn>
      )}
      <BarBtn onClick={onCommands} title={`Catálogo de comandos (${modLabel}L)`} className={commandsOpen ? "!text-accent" : ""}>
        <BookOpen size={12} />
        Comandos
      </BarBtn>
      <BarBtn onClick={onNotes} title={`Notas (${modLabel}J)`} className={notesOpen ? "!text-accent" : ""}>
        <NotebookPen size={12} />
        Notas
      </BarBtn>
      <BarBtn onClick={onSettings} title={`Ajustes (${isMac ? "⌘" : "Ctrl+"},)`}>
        <Settings size={12} />
      </BarBtn>
    </>
  );
  if (!tab || !state)
    return (
      <div className="h-6 shrink-0 flex items-center justify-end px-3 bg-chrome border-t border-line text-[11.5px] text-muted">
        {gear}
      </div>
    );
  const { session } = tab;
  const logging = !!state.logPath;
  const canBreak = session.type === "serial" || session.type === "telnet";
  const connected = state.status === "connected";

  return (
    <div className="h-6 shrink-0 flex items-center gap-3 px-3 bg-chrome border-t border-line text-[11.5px] text-muted">
      <span className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor[state.status] }} />
        {statusText[state.status]}
      </span>
      <span className="font-medium text-fg/80">{typeLabel[session.type]}</span>
      <span className="truncate">{sessionTarget(session)}</span>
      {session.type === "ssh" && !!session.tunnels?.length && (
        <span
          className="flex items-center gap-1 shrink-0 text-fg/80"
          title={`Túneles${connected ? " activos" : ""}:\n${session.tunnels.map(tunnelLabel).join("\n")}`}
        >
          <ArrowLeftRight size={11} />
          {session.tunnels.length === 1 ? tunnelLabel(session.tunnels[0]) : `${session.tunnels.length} túneles`}
        </span>
      )}

      <div className="ml-auto flex items-center gap-0.5">
        <BarBtn
          onClick={onToggleLog}
          disabled={!connected && !logging}
          title={logging ? `Grabando en ${state.logPath}` : "Grabar la sesión en un archivo de texto"}
          className={logging ? "!text-danger" : ""}
        >
          {logging ? <CircleDot size={12} /> : <Circle size={12} />}
          {logging ? "Grabando" : "Log"}
        </BarBtn>
        {canBreak && (
          <BarBtn onClick={onBreak} disabled={!connected} title="Enviar señal Break">
            <Zap size={12} />
            Break
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
            Desconectar
          </BarBtn>
        ) : (
          <BarBtn onClick={onReconnect} title="Reconectar (o Enter en la terminal)" className="!text-accent">
            <RotateCcw size={12} />
            Reconectar
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
      className={`flex items-center gap-1 h-5 px-1.5 rounded hover:bg-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent ${props.className ?? ""}`}
    />
  );
}
