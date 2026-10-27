import { memo, useCallback, useEffect, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, PanelTop, Plus, Wrench, X } from "lucide-react";
import { tabTitle } from "../types";
import { ContextMenu } from "./Sidebar";
import { SessionIcon, isQuickSession } from "./SessionIcon";
import { TabBarProps, closeBtnClass, dotColor, dropMark } from "./TabBar";
import { useTabDrag } from "../lib/tabDrag";
import { MenuItem, layoutItem, newTabMenuItems, tabMenuItems } from "./tabMenu";
import { modLabel } from "../lib/platform";

const MIN_W = 160;
const MAX_W = 420;
const DEFAULT_W = 220;
const RAIL_W = 44;

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
}

const clamp = (w: number) => Math.max(MIN_W, Math.min(MAX_W, Math.round(w)));

/**
 * Pestañas en columna (como Edge, Firefox o Arc). Mismos datos y acciones que TabBar;
 * se puede redimensionar desde el borde derecho y plegar a un riel de iconos.
 * Navegación: flechas/Inicio/Fin mueven el foco, Enter/Espacio activan, F2 renombra, Supr cierra.
 */
export const VerticalTabs = memo(function VerticalTabs(props: TabBarProps) {
  const { tabs, states, activeId, onSelect, onClose, onNew, toolsOpen, alerts, onRename, activity, alerted, onTabLayout } = props;
  const drag = useTabDrag("data-id", "y", props.onReorder);
  const [width, setWidth] = useState(() => clamp(load("vtabsWidth", DEFAULT_W)));
  const [collapsed, setCollapsed] = useState(() => load("vtabsCollapsed", false));
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => save("vtabsCollapsed", collapsed), [collapsed]);

  const commit = (id: string, value: string) => {
    setEditing(null);
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    const v = value.trim();
    onRename(id, v && v !== tab.session.name ? v : undefined);
  };

  const rename = (id: string) => {
    setCollapsed(false);
    setEditing(id);
  };

  // Redimensionado: el ancho se guarda al soltar, no en cada movimiento.
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let last = startW;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    const move = (ev: PointerEvent) => {
      last = clamp(startW + ev.clientX - startX);
      setWidth(last);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      document.body.style.cursor = "";
      save("vtabsWidth", last);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.getAttribute("role") !== "tab") return;
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
    const i = items.indexOf(target);
    const id = target.dataset.id!;
    let next = -1;
    if (e.key === "ArrowDown") next = (i + 1) % items.length;
    else if (e.key === "ArrowUp") next = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "Enter" || e.key === " ") onSelect(id);
    else if (e.key === "F2" && id !== "tools") rename(id);
    else if (e.key === "Delete") onClose(id);
    else return;
    e.preventDefault();
    e.stopPropagation();
    if (next >= 0) items[next]?.focus();
  };

  const rowBase = collapsed
    ? "group relative mx-auto w-8 h-8 grid place-items-center rounded-md"
    : "group relative flex items-center gap-2 h-8 pl-2.5 pr-1.5 rounded-md text-[12.5px]";
  const rowState = (active: boolean) =>
    active
      ? "bg-term text-term-fg ring-1 ring-line shadow-sm"
      : "text-muted hover:text-fg hover:bg-hover";
  const focusable = "cursor-default focus-visible:outline-offset-[-2px]";
  // Un único tab enfocable con Tab (roving tabindex): el activo o, si no hay, el primero.
  const focusId = activeId ?? (toolsOpen ? "tools" : tabs[0]?.id);

  return (
    <nav
      aria-label="Pestañas"
      className="relative shrink-0 flex flex-col min-h-0 border-r border-line bg-chrome"
      style={{ width: collapsed ? RAIL_W : width }}
    >
      <div className={`h-9 shrink-0 flex items-center gap-0.5 ${collapsed ? "justify-center" : "pl-3 pr-1.5"}`}>
        {!collapsed && (
          <span className="flex-1 min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-muted">
            Pestañas {tabs.length > 0 && <span className="tabular-nums font-normal">· {tabs.length}</span>}
          </span>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expandir pestañas" : "Plegar pestañas a iconos"}
          aria-label={collapsed ? "Expandir pestañas" : "Plegar pestañas"}
          aria-expanded={!collapsed}
          className="w-7 h-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover"
        >
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>

      <div
        ref={listRef}
        role="tablist"
        aria-orientation="vertical"
        aria-label="Pestañas abiertas"
        onKeyDown={onKeyDown}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget || !onTabLayout) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, items: layoutItem(props) });
        }}
        className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden [scrollbar-width:thin] flex flex-col gap-0.5 pb-1 ${collapsed ? "px-0" : "px-1.5"}`}
      >
        {toolsOpen && (
          <div
            role="tab"
            data-id="tools"
            aria-selected={activeId === "tools"}
            tabIndex={focusId === "tools" ? 0 : -1}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose("tools");
              } else onSelect("tools");
            }}
            title={`Herramientas${alerts > 0 ? ` · ${alerts} sondas caídas` : ""}\nClic medio: cerrar`}
            className={`${rowBase} ${rowState(activeId === "tools")} ${focusable}`}
          >
            <Wrench size={13} className="shrink-0" />
            {collapsed ? (
              alerts > 0 && <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-danger" />
            ) : (
              <>
                <span className="truncate flex-1">Herramientas</span>
                {alerts > 0 && (
                  <span className="px-1.5 rounded-full bg-danger text-danger-fg text-[10.5px] font-semibold shrink-0" title={`${alerts} sondas caídas`}>
                    ✕ {alerts}
                  </span>
                )}
                <button
                  tabIndex={-1}
                  aria-label="Cerrar Herramientas"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => onClose("tools")}
                  className={closeBtnClass(activeId === "tools")}
                >
                  <X size={12} />
                </button>
              </>
            )}
          </div>
        )}
        {tabs.map((t) => {
          const active = t.id === activeId;
          const status = states[t.id]?.status ?? "connecting";
          const marker = alerted?.has(t.id) && !active ? "alert" : activity.has(t.id) && !active ? "activity" : null;
          const title = tabTitle(t);
          return (
            <div
              key={t.id}
              role="tab"
              data-id={t.id}
              aria-selected={active}
              tabIndex={focusId === t.id ? 0 : -1}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(t.id);
                } else if (e.button === 0) {
                  onSelect(t.id);
                  drag.begin(e, t.id);
                }
              }}
              onDoubleClick={() => rename(t.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                onSelect(t.id);
                setMenu({ x: e.clientX, y: e.clientY, items: tabMenuItems(t, states[t.id], props, () => rename(t.id)) });
              }}
              title={`${title}${t.title ? ` (${t.session.name})` : ""}\nArrastra para mover · doble clic: renombrar · clic derecho: opciones · clic medio: cerrar`}
              className={`${rowBase} ${rowState(active)} ${focusable} ${drag.dragId === t.id ? "opacity-50" : ""} ${
                drag.target?.id === t.id ? dropMark(drag.target.after ? "bottom" : "top") : ""
              }`}
            >
              <SessionIcon type={t.session.type} size={13} quick={isQuickSession(t.session)} />
              {collapsed ? (
                <>
                  {/* Abajo a la izquierda: abajo a la derecha tapaba el rayo de conexión rápida. */}
                  <span
                    className={`absolute bottom-0.5 left-0.5 w-1.5 h-1.5 rounded-full ring-1 ${active ? "ring-term" : "ring-[var(--chrome)]"}`}
                    style={{ background: dotColor(status, active) }}
                  />
                  {marker && (
                    <span
                      className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${marker === "alert" ? "bg-danger" : "bg-accent"}`}
                      title={marker === "alert" ? "Alerta por palabra clave" : "Salida nueva"}
                    />
                  )}
                </>
              ) : (
                <>
                  {editing === t.id ? (
                    <input
                      autoFocus
                      aria-label="Nuevo nombre de la pestaña"
                      className="field !h-6 !px-1.5 flex-1 min-w-0 !text-[12px]"
                      defaultValue={title}
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
                    <span className={`truncate flex-1 min-w-0 ${t.title ? "italic" : ""}`}>{title}</span>
                  )}
                  {marker === "alert" ? (
                    <span className="text-[10px] font-semibold text-danger shrink-0" title="Alerta por palabra clave">
                      ▲
                    </span>
                  ) : marker === "activity" ? (
                    <span className="text-[10px] font-semibold text-accent shrink-0" title="Salida nueva">
                      ●
                    </span>
                  ) : null}
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0 group-hover:hidden"
                    style={{ background: dotColor(status, active) }}
                    aria-label={status === "connected" ? "Conectada" : status === "connecting" ? "Conectando" : "Cerrada"}
                  />
                  <button
                    tabIndex={-1}
                    aria-label={`Cerrar ${title}`}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => onClose(t.id)}
                    title={`Cerrar (${modLabel}W)`}
                    className={closeBtnClass(active)}
                  >
                    <X size={12} />
                  </button>
                </>
              )}
            </div>
          );
        })}
        <button
          onClick={onNew}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, items: newTabMenuItems(props) });
          }}
          title={`Terminal local (${modLabel}T) · clic derecho: conexión rápida o nueva sesión`}
          aria-label="Nueva terminal local"
          className={
            collapsed
              ? "mx-auto mt-0.5 w-8 h-8 shrink-0 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover"
              : "mt-0.5 h-8 shrink-0 flex items-center gap-2 pl-2.5 rounded-md text-[12.5px] text-muted hover:text-fg hover:bg-hover"
          }
        >
          <Plus size={14} />
          {!collapsed && "Nueva pestaña"}
        </button>
      </div>

      {onTabLayout && (
        <div className={`h-9 shrink-0 flex items-center border-t border-line ${collapsed ? "justify-center" : "px-1.5"}`}>
          <button
            onClick={() => onTabLayout("horizontal")}
            title="Mostrar las pestañas arriba (horizontales)"
            aria-label="Pestañas horizontales"
            className={
              collapsed
                ? "w-7 h-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover"
                : "h-7 px-1.5 flex items-center gap-1.5 rounded-md text-[12px] text-muted hover:text-fg hover:bg-hover"
            }
          >
            <PanelTop size={14} />
            {!collapsed && "Pestañas arriba"}
          </button>
        </div>
      )}

      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Ancho de las pestañas"
          aria-valuemin={MIN_W}
          aria-valuemax={MAX_W}
          aria-valuenow={width}
          onPointerDown={startResize}
          onDoubleClick={() => {
            setWidth(DEFAULT_W);
            save("vtabsWidth", DEFAULT_W);
          }}
          title="Arrastra para cambiar el ancho · doble clic: restaurar"
          className="absolute -right-1 top-0 bottom-0 w-2 cursor-col-resize z-10 hover:bg-[var(--selected)]"
        />
      )}
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
    </nav>
  );
});
