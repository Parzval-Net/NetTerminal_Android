import { ClipboardCopy, Columns2, Copy, Eraser, LayoutGrid, PanelLeftDashed, PanelTop, Pencil, RefreshCcw, RotateCcw, Rows2, Square, Undo2, Unplug, X } from "lucide-react";
import type { ReactNode } from "react";
import { SplitLayout, layoutLabel } from "../lib/split";
import type { TabLayout } from "../lib/settings";
import type { Tab, TabState } from "../types";

/** [etiqueta, icono, acción, deshabilitado/marcado] — formato de ContextMenu. */
export type MenuItem = [string, ReactNode, () => void, boolean?];

export interface TabMenuHandlers {
  onRename: (id: string, title: string | undefined) => void;
  onDuplicate: (id: string) => void;
  onReconnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onClearScrollback: (id: string) => void;
  onResetTerminal: (id: string) => void;
  onCopyAll: (id: string) => void;
  onClose: (id: string) => void;
  tabLayout?: TabLayout;
  onTabLayout?: (layout: TabLayout) => void;
}

/** Ítem para alternar pestañas horizontales/verticales (vacío si no hay manejador). */
export function layoutItem(p: Pick<TabMenuHandlers, "tabLayout" | "onTabLayout">): MenuItem[] {
  const { onTabLayout } = p;
  if (!onTabLayout) return [];
  return p.tabLayout === "vertical"
    ? [["Pestañas horizontales", <PanelTop size={13} />, () => onTabLayout("horizontal")]]
    : [["Pestañas verticales", <PanelLeftDashed size={13} />, () => onTabLayout("vertical")]];
}

/** Menú contextual de una pestaña; el mismo en la barra horizontal y en la vertical. */
export function tabMenuItems(t: Tab, state: TabState | undefined, p: TabMenuHandlers, startRename: () => void): MenuItem[] {
  return [
    ["Renombrar", <Pencil size={13} />, startRename],
    ["Restaurar nombre original", <Undo2 size={13} />, () => p.onRename(t.id, undefined), !t.title],
    ["Duplicar", <Copy size={13} />, () => p.onDuplicate(t.id)],
    ["Reconectar", <RotateCcw size={13} />, () => p.onReconnect(t.id)],
    ["Desconectar", <Unplug size={13} />, () => p.onDisconnect(t.id), state?.status === "closed"],
    ["Copiar toda la salida", <ClipboardCopy size={13} />, () => p.onCopyAll(t.id)],
    ["Limpiar historial", <Eraser size={13} />, () => p.onClearScrollback(t.id)],
    ["Reiniciar terminal", <RefreshCcw size={13} />, () => p.onResetTerminal(t.id)],
    ["Cerrar", <X size={13} />, () => p.onClose(t.id)],
    ...layoutItem(p),
  ];
}

/** Opciones de vista dividida (el booleano marca la opción actual como deshabilitada). */
export function splitMenuItems(split: SplitLayout | null, onSplit: (layout: SplitLayout | null) => void): MenuItem[] {
  const icons = { cols: <Columns2 size={13} />, rows: <Rows2 size={13} />, grid: <LayoutGrid size={13} /> };
  return [
    ["Vista única", <Square size={13} />, () => onSplit(null), split === null],
    ...(["cols", "rows", "grid"] as SplitLayout[]).map((l) => [layoutLabel[l], icons[l], () => onSplit(l), split === l] as MenuItem),
  ];
}
