import { useEffect, useState } from "react";

export const TEMPLATE_VAR = /\{\{\s*([\w.-]+)\s*\}\}/g;

export function templateVars(text: string): string[] {
  return [...new Set([...text.matchAll(TEMPLATE_VAR)].map((m) => m[1]))];
}

export function fillTemplate(text: string, values: Record<string, string>): string {
  return text.replace(TEMPLATE_VAR, (_, name: string) => values[name] ?? "");
}

const STORE = "templateValues";

function remembered(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}");
  } catch {
    return {};
  }
}

interface Props {
  text: string;
  onSubmit: (filled: string) => void;
  onCancel: () => void;
}

/** Pide el valor de cada {{variable}} de una plantilla antes de enviarla. */
export function TemplateDialog({ text, onSubmit, onCancel }: Props) {
  const names = templateVars(text);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const prev = remembered();
    return Object.fromEntries(names.map((n) => [n, prev[n] ?? ""]));
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const missing = names.filter((n) => !values[n]?.trim());
  const preview = fillTemplate(text, values).split("\n").slice(0, 6).join("\n");

  const submit = () => {
    if (missing.length) return;
    try {
      localStorage.setItem(STORE, JSON.stringify({ ...remembered(), ...values }));
    } catch {
      /* sin almacenamiento: no se recuerdan valores */
    }
    onSubmit(fillTemplate(text, values));
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4" onMouseDown={onCancel}>
      <form
        className="w-[440px] max-w-full bg-panel border border-line rounded-xl shadow-pop"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <header className="px-5 pt-4 pb-2">
          <h2 className="text-[14px] font-semibold">Completar plantilla</h2>
          <p className="text-muted text-[12px]">Los valores se recuerdan para la próxima vez.</p>
        </header>
        <div className="px-5 py-2 space-y-2.5 max-h-[40vh] overflow-y-auto">
          {names.map((n, i) => (
            <label key={n} className="grid grid-cols-[140px_1fr] items-center gap-3">
              <span className="font-mono text-[12px] truncate" title={n}>
                {n}
              </span>
              <input
                className="field"
                autoFocus={i === 0}
                value={values[n] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [n]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <pre className="mx-5 my-3 p-2.5 rounded-lg bg-hover text-[11.5px] font-mono whitespace-pre-wrap break-all max-h-32 overflow-hidden select-text">
          {preview}
        </pre>
        <footer className="flex justify-end gap-2 px-5 py-3 border-t border-line">
          <button type="button" onClick={onCancel} className="px-3.5 h-8 rounded-md border border-line hover:bg-hover">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={missing.length > 0}
            className="px-3.5 h-8 rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-40"
          >
            Continuar
          </button>
        </footer>
      </form>
    </div>
  );
}
