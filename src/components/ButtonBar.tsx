import { memo, useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileCode2, FolderOpen, Pencil, Plus, Square, Trash2 } from "lucide-react";
import { Macro } from "../lib/settings";
import { ContextMenu } from "./Sidebar";
import { BroadcastTargetPicker } from "./BroadcastTarget";

interface Props {
  macros: Macro[];
  connected: boolean;
  running: { run: string; script: string; targets: number } | null;
  onRun: (m: Macro) => void;
  onRunScript: (script: string) => void;
  onStopScript: () => void;
  onEdit: (m: Macro | null) => void;
  onDelete: (m: Macro) => void;
}

type MenuState = { x: number; y: number; items: [string, React.ReactNode, () => void, boolean?][] };

/** Barra de comandos rápidos (equivalente a la button bar de SecureCRT). */
export const ButtonBar = memo(function ButtonBar(p: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [scripts, setScripts] = useState<string[]>([]);

  useEffect(() => {
    invoke<string[]>("list_scripts").then(setScripts).catch(() => {});
  }, []);

  const openScripts = async (e: React.MouseEvent) => {
    // Antes del await: React deja currentTarget en null al terminar el despacho del evento.
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const list = await invoke<string[]>("list_scripts").catch(() => scripts);
    setScripts(list);
    setMenu({
      x: r.left,
      y: r.bottom + 4,
      items: [
        ...list.map(
          (s) => [s, <FileCode2 size={13} />, () => p.onRunScript(s), !p.connected] as MenuState["items"][number],
        ),
        ["Abrir carpeta de scripts", <FolderOpen size={13} />, () => invoke("open_dir", { which: "scripts" })],
      ],
    });
  };

  return (
    <div className="h-8 shrink-0 flex items-center gap-1 px-2 bg-chrome border-t border-line overflow-x-auto [scrollbar-width:none]">
      {p.macros.map((m) => (
        <button
          key={m.id}
          disabled={!p.connected}
          onClick={() => p.onRun(m)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({
              x: e.clientX,
              y: e.clientY,
              items: [
                ["Editar", <Pencil size={13} />, () => p.onEdit(m)],
                ["Eliminar", <Trash2 size={13} />, () => p.onDelete(m)],
              ],
            });
          }}
          title={`${m.kind === "script" ? `Script: ${m.script}\nAl ejecutarlo eliges los destinos y el modo` : m.text}\nClic derecho para editar`}
          className="shrink-0 flex items-center gap-1.5 px-2.5 h-6 rounded-md border border-line text-[12px] hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {m.kind === "script" && <FileCode2 size={12} className="text-muted" />}
          {m.label}
        </button>
      ))}
      <button
        onClick={() => p.onEdit(null)}
        title="Nuevo botón"
        className="shrink-0 w-6 h-6 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover"
      >
        <Plus size={14} />
      </button>

      <div className="ml-auto shrink-0 flex items-center gap-1 pl-2">
        {p.macros.length > 0 && <BroadcastTargetPicker />}
        {p.running ? (
          <button
            onClick={p.onStopScript}
            title={`Detener script${p.running.targets > 1 ? ` (${p.running.targets} sesiones)` : ""}`}
            aria-label={`Detener script ${p.running.script}`}
            className="flex items-center gap-1.5 px-2 h-6 rounded-md text-[12px] text-warn hover:bg-hover"
          >
            <Square size={11} fill="currentColor" />
            Detener {p.running.script}
            {p.running.targets > 1 && <span className="text-muted">· {p.running.targets}</span>}
          </button>
        ) : (
          <button
            onClick={openScripts}
            className="flex items-center gap-1.5 px-2 h-6 rounded-md text-[12px] text-muted hover:text-fg hover:bg-hover"
          >
            <FileCode2 size={13} />
            Scripts
          </button>
        )}
      </div>
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
    </div>
  );
});
