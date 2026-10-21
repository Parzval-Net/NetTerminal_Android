import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { History, Send, Trash2 } from "lucide-react";

interface Entry {
  cmd: string;
  ts: number;
}

interface Props {
  /** Clave del equipo (ver historyKey). */
  historyKey: string;
  connected: boolean;
  /** Reenvía por el mismo camino con control de riesgo que Notas y el catálogo. */
  onResend: (cmd: string) => void;
}

/**
 * Historial de comandos enviados desde Notas, catálogo y botones para el equipo activo.
 * Se lee solo al abrir el menú: sin costo mientras está cerrado.
 */
export function HistoryMenu({ historyKey, connected, onResend }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Entry[] | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setItems(null);
    setConfirmClear(false);
    invoke<Entry[]>("cmd_history", { key: historyKey })
      .then(setItems)
      .catch(() => setItems([]));
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, historyKey]);

  const clear = () => {
    if (!confirmClear) return setConfirmClear(true);
    invoke("cmd_history_clear", { key: historyKey }).catch(() => {});
    setItems([]);
    setConfirmClear(false);
  };

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Historial de comandos enviados a este equipo"
        className={`flex items-center gap-1 h-5 px-1.5 rounded hover:bg-hover hover:text-fg ${open ? "text-fg bg-hover" : ""}`}
      >
        <History size={12} />
        Historial
      </button>
      {open && (
        <div className="absolute bottom-7 right-0 z-40 w-[420px] max-w-[80vw] bg-panel border border-line rounded-lg shadow-pop text-[12px] text-fg overflow-hidden">
          <div className="flex items-center justify-between px-3 h-8 border-b border-line text-muted">
            <span>Últimos comandos enviados (Notas, catálogo y botones)</span>
            {!!items?.length && (
              <button
                onClick={clear}
                onMouseLeave={() => setConfirmClear(false)}
                className={`flex items-center gap-1 hover:text-danger ${confirmClear ? "text-danger" : ""}`}
                title="Borrar el historial de este equipo"
              >
                <Trash2 size={12} />
                {confirmClear ? "Confirmar" : "Borrar"}
              </button>
            )}
          </div>
          <ul className="max-h-[320px] overflow-y-auto p-1">
            {items === null && <li className="px-2 py-3 text-muted">Cargando…</li>}
            {items?.length === 0 && (
              <li className="px-2 py-3 text-muted">
                Sin comandos registrados. Se guardan los enviados desde Notas, el catálogo y los botones, nunca lo que
                escribes en la terminal.
              </li>
            )}
            {items?.map((e) => {
              const lines = e.cmd.split("\n");
              return (
                <li key={e.ts + e.cmd}>
                  <button
                    disabled={!connected}
                    title={connected ? `Reenviar:\n${e.cmd}` : "Conecta la sesión para reenviar"}
                    onClick={() => {
                      setOpen(false);
                      onResend(e.cmd);
                    }}
                    className="group w-full flex items-center gap-2 px-2 h-7 rounded-md text-left hover:bg-hover disabled:opacity-60 disabled:hover:bg-transparent"
                  >
                    <span className="flex-1 min-w-0 truncate font-mono">
                      {lines[0]}
                      {lines.length > 1 && <span className="text-muted"> (+{lines.length - 1} líneas)</span>}
                    </span>
                    <span className="text-[10.5px] text-muted shrink-0">
                      {new Date(e.ts).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                    </span>
                    {connected && <Send size={12} className="text-accent shrink-0 opacity-0 group-hover:opacity-100" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
