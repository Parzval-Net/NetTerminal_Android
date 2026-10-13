import { PanelLeft, Plus, Wrench, X } from "lucide-react";
import { ConnStatus, Tab, TabState } from "../types";
import { SessionIcon } from "./SessionIcon";
import { modLabel } from "../lib/platform";

interface Props {
  tabs: Tab[];
  states: Record<string, TabState>;
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onToggleSidebar: () => void;
  toolsOpen: boolean;
  onOpenTools: () => void;
  /** Sondas caídas: se muestran en la pestaña de herramientas. */
  alerts: number;
}

export const statusColor: Record<ConnStatus, string> = {
  connecting: "var(--warn)",
  connected: "var(--ok)",
  closed: "var(--muted)",
};

export function TabBar({
  tabs,
  states,
  activeId,
  onSelect,
  onClose,
  onNew,
  onToggleSidebar,
  toolsOpen,
  onOpenTools,
  alerts,
}: Props) {
  return (
    <div className="h-10 shrink-0 flex items-end gap-1 px-1.5 bg-chrome border-b border-line">
      <button
        onClick={onToggleSidebar}
        title={`Mostrar/ocultar sesiones (${modLabel}B)`}
        className="mb-1.5 w-7 h-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover"
      >
        <PanelLeft size={16} />
      </button>
      <div className="flex-1 min-w-0 flex items-end gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {toolsOpen && (
          <div
            onMouseDown={(e) => {
              if (e.button === 1) onClose("tools");
              else onSelect("tools");
            }}
            className={`group flex items-center gap-2 h-8 pl-3 pr-1.5 rounded-t-lg text-[12.5px] shrink-0 ${
              activeId === "tools"
                ? "bg-bg text-fg border border-line border-b-transparent -mb-px"
                : "text-muted hover:text-fg hover:bg-hover"
            }`}
          >
            <Wrench size={13} />
            Herramientas
            {alerts > 0 && (
              <span className="px-1.5 rounded-full bg-danger text-white text-[10.5px] font-semibold" title={`${alerts} sondas caídas`}>
                ✕ {alerts}
              </span>
            )}
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => onClose("tools")}
              className="hidden group-hover:grid w-5 h-5 place-items-center rounded text-muted hover:text-fg hover:bg-hover"
            >
              <X size={12} />
            </button>
          </div>
        )}
        {tabs.map((t) => {
          const active = t.id === activeId;
          const status = states[t.id]?.status ?? "connecting";
          return (
            <div
              key={t.id}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(t.id);
                } else onSelect(t.id);
              }}
              title={`${t.session.name}\nClic medio: cerrar · ${modLabel}D: duplicar`}
              className={`group relative flex items-center gap-2 h-8 pl-3 pr-1.5 min-w-[120px] max-w-[220px] rounded-t-lg text-[12.5px] ${
                active
                  ? "bg-term text-term-fg border border-line border-b-transparent -mb-px"
                  : "text-muted hover:text-fg hover:bg-hover"
              }`}
            >
              <SessionIcon type={t.session.type} size={13} />
              <span className="truncate flex-1">{t.session.name}</span>
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0 group-hover:hidden"
                style={{ background: statusColor[status] }}
              />
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => onClose(t.id)}
                title={`Cerrar (${modLabel}W)`}
                className="hidden group-hover:grid w-5 h-5 place-items-center rounded text-muted hover:text-fg hover:bg-hover"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        <button
          onClick={onNew}
          title={`Terminal local (${modLabel}T)`}
          className="mb-1.5 ml-1 w-7 h-7 shrink-0 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover"
        >
          <Plus size={16} />
        </button>
      </div>
      {(!toolsOpen || alerts > 0) && (
        <button
          onClick={onOpenTools}
          title={`Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins (${modLabel}E)`}
          className={`mb-1.5 h-7 px-2 shrink-0 flex items-center gap-1 rounded-md hover:bg-hover ${
            alerts > 0 ? "text-danger" : "text-muted hover:text-fg"
          }`}
        >
          <Wrench size={15} />
          {alerts > 0 && <span className="text-[11px] font-semibold">✕ {alerts}</span>}
        </button>
      )}
    </div>
  );
}
