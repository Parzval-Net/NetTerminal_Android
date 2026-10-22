import { useEffect } from "react";
import { useDragResize } from "../lib/useDragResize";

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onCancel }: Props) {
  const win = useDragResize("confirmWindow", false);
  useEffect(() => {
    // En captura para que Enter/Esc no lleguen a la terminal que está detrás.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") onCancel();
      else onConfirm();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onConfirm, onCancel]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4" onMouseDown={onCancel}>
      <div
        role="alertdialog"
        {...win.box}
        className="w-[400px] max-w-full bg-panel border border-line rounded-xl shadow-pop p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 {...win.handle} className="text-[14px] font-semibold mb-1 select-none">
          {title}
        </h2>
        <p className="text-muted mb-5 whitespace-pre-wrap break-words max-h-40 overflow-y-auto font-[inherit]">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3.5 h-8 rounded-md border border-line hover:bg-hover">
            Cancelar
          </button>
          <button
            autoFocus
            onClick={onConfirm}
            className={`px-3.5 h-8 rounded-md font-medium hover:opacity-90 ${danger ? "bg-danger text-danger-fg" : "bg-accent text-accent-fg"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
