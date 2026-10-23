import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Columns2, LayoutGrid, PanelLeft, Plus, Rows2, Wrench, X } from "lucide-react";
import { newTabMenuItems } from "./tabMenu";
import { SplitLayout, layoutLabel } from "../lib/split";
import type { TabLayout } from "../lib/settings";
import { MenuItem, layoutItem, splitMenuItems, tabMenuItems } from "./tabMenu";
import { ConnStatus, Tab, TabState, tabTitle } from "../types";
import { ContextMenu } from "./Sidebar";
import { QuickBolt, SessionIcon, isQuickSession } from "./SessionIcon";
import { modLabel } from "../lib/platform";

export interface TabBarProps {
  tabs: Tab[];
  states: Record<string, TabState>;
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  /** Conexión rápida sin guardar y nueva sesión guardada (menú del "+"). */
  onQuickConnect?: () => void;
  onNewSession?: () => void;
  /** Guarda una pestaña abierta con conexión rápida como sesión. */
  onSaveAs?: (id: string) => void;
  onToggleSidebar: () => void;
  toolsOpen: boolean;
  onOpenTools: () => void;
  /** Sondas caídas: se muestran en la pestaña de herramientas. */
  alerts: number;
  onRename: (id: string, title: string | undefined) => void;
  onDuplicate: (id: string) => void;
  onReconnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onClearScrollback: (id: string) => void;
  onResetTerminal: (id: string) => void;
  onCopyAll: (id: string) => void;
  /** Pestañas con salida nueva sin ver. */
  activity: Set<string>;
  /** Vista dividida activa (null: una sola terminal). */
  split?: SplitLayout | null;
  onSplit?: (layout: SplitLayout | null) => void;
  /** Pestañas con una alerta por palabra clave sin ver. */
  alerted?: Set<string>;
  /** "vertical": las pestañas van en VerticalTabs y esta barra solo deja las acciones globales. */
  tabLayout?: TabLayout;
  onTabLayout?: (layout: TabLayout) => void;
}

export const statusColor: Record<ConnStatus, string> = {
  connecting: "var(--warn)",
  connected: "var(--ok)",
  closed: "var(--muted)",
};

/**
 * Color del punto de estado. En la pestaña activa el fondo es el del tema de terminal, que
 * puede ser claro con la interfaz oscura (o al revés): se mezcla con --term-fg para que el
 * punto mantenga >= 3:1 contra ese fondo (WCAG 1.4.11).
 */
export const dotColor = (status: ConnStatus, active: boolean) =>
  active ? `color-mix(in oklab, ${statusColor[status]} 60%, var(--term-fg))` : statusColor[status];

/**
 * Botón "cerrar" de una pestaña. La pestaña activa usa el fondo del tema de terminal, así que
 * el color va sobre --term-fg (no sobre --muted, que es de la interfaz: en modo oscuro con un
 * tema claro, o al revés, no contrasta). Siempre visible al enfocar con el teclado.
 */
export const closeBtnClass = (active: boolean) =>
  `hidden group-hover:grid focus-visible:grid w-5 h-5 shrink-0 place-items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-accent ${
    active ? "text-term-fg/70 hover:text-term-fg hover:bg-term-fg/15" : "text-muted hover:text-fg hover:bg-hover"
  }`;

export const TabBar = memo(function TabBar(props: TabBarProps) {
  const {
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
  onRename,
  activity,
  split = null,
  onSplit,
  alerted,
  tabLayout,
  } = props;
  const vertical = tabLayout === "vertical";
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  // La pestaña activa siempre visible: con muchas pestañas o la ventana angosta quedaba fuera
  // de la franja (que se desplaza sin barra visible).
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-tab="${activeId}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length]);

  const commit = (id: string, value: string) => {
    setEditing(null);
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    const v = value.trim();
    onRename(id, v && v !== tab.session.name ? v : undefined);
  };

  return (
    <div className="h-10 shrink-0 flex items-end gap-1 px-1.5 bg-chrome border-b border-line">
      <button
        onClick={onToggleSidebar}
        title={`Mostrar/ocultar sesiones (${modLabel}B)`}
        className="mb-1.5 w-7 h-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover"
      >
        <PanelLeft size={16} />
      </button>
      <div
        ref={stripRef}
        className="flex-1 min-w-0 self-stretch flex items-end gap-0.5 overflow-x-auto [scrollbar-width:none]"
        onContextMenu={(e) => {
          // Clic derecho en el espacio libre de la barra: alternar horizontal/vertical.
          if (e.target !== e.currentTarget || !props.onTabLayout) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, items: layoutItem(props) });
        }}
      >
        {!vertical && toolsOpen && (
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
              <span className="px-1.5 rounded-full bg-danger text-danger-fg text-[10.5px] font-semibold" title={`${alerts} sondas caídas`}>
                ✕ {alerts}
              </span>
            )}
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => onClose("tools")}
              aria-label="Cerrar Herramientas"
              className={closeBtnClass(false)}
            >
              <X size={12} />
            </button>
          </div>
        )}
        {!vertical && tabs.map((t) => {
          const active = t.id === activeId;
          const status = states[t.id]?.status ?? "connecting";
          return (
            <div
              key={t.id}
              data-tab={t.id}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(t.id);
                } else onSelect(t.id);
              }}
              onDoubleClick={() => setEditing(t.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                onSelect(t.id);
                setMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: tabMenuItems(t, states[t.id], props, () => setEditing(t.id)),
                });
              }}
              title={`${tabTitle(t)}${t.title ? ` (${t.session.name})` : ""}\nDoble clic: renombrar · clic derecho: opciones · clic medio: cerrar`}
              className={`group relative flex items-center gap-2 h-8 pl-3 pr-1.5 min-w-[120px] max-w-[220px] rounded-t-lg text-[12.5px] ${
                active
                  ? "bg-term text-term-fg border border-line border-b-transparent -mb-px"
                  : "text-muted hover:text-fg hover:bg-hover"
              }`}
            >
              <SessionIcon type={t.session.type} size={13} quick={isQuickSession(t.session)} />
              {editing === t.id ? (
                <input
                  autoFocus
                  className="field !h-6 !px-1.5 flex-1 min-w-0 !text-[12px]"
                  defaultValue={tabTitle(t)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => commit(t.id, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <span className={`truncate flex-1 ${t.title ? "italic" : ""}`}>{tabTitle(t)}</span>
              )}
              {alerted?.has(t.id) && !active ? (
                <span className="text-[10px] font-semibold text-danger shrink-0" title="Alerta por palabra clave">
                  ▲
                </span>
              ) : activity.has(t.id) && !active && (
                <span className="text-[10px] font-semibold text-accent shrink-0" title="Salida nueva">
                  ●
                </span>
              )}
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0 group-hover:hidden"
                style={{ background: dotColor(status, active) }}
              />
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => onClose(t.id)}
                title={`Cerrar (${modLabel}W)`}
                aria-label={`Cerrar ${tabTitle(t)}`}
                className={closeBtnClass(active)}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
        {!vertical && <button
          onClick={onNew}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, items: newTabMenuItems(props) });
          }}
          title={`Terminal local (${modLabel}T) · clic derecho: conexión rápida o nueva sesión`}
          className="mb-1.5 ml-1 w-7 h-7 shrink-0 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover"
        >
          <Plus size={16} />
        </button>}
        {!vertical && props.onQuickConnect && (
          <button
            onClick={props.onQuickConnect}
            title={`Conexión rápida sin guardar (${modLabel}O)`}
            aria-label="Conexión rápida sin guardar"
            className="mb-1.5 w-7 h-7 shrink-0 grid place-items-center rounded-md hover:bg-hover"
          >
            <QuickBolt size={15} />
          </button>
        )}
      </div>
      {onSplit && (
        <button
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.right - 200, y: r.bottom + 4, items: splitMenuItems(split, onSplit) });
          }}
          title={split ? `Vista dividida: ${layoutLabel[split]}` : "Vista dividida: ver 2 o 4 pestañas a la vez"}
          aria-pressed={!!split}
          className={`mb-1.5 w-7 h-7 shrink-0 grid place-items-center rounded-md hover:bg-hover ${split ? "text-accent" : "text-muted hover:text-fg"}`}
        >
          {split === "rows" ? <Rows2 size={15} /> : split === "grid" ? <LayoutGrid size={15} /> : <Columns2 size={15} />}
        </button>
      )}
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
});
