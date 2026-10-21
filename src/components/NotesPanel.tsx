import { memo, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ITheme } from "@xterm/xterm";
import { ArrowDownToLine, Check, FolderOpen, Pencil, Plus, Send, SendHorizontal, Trash2, X } from "lucide-react";
import { CodeEditor } from "./CodeEditor";
import { Compiled } from "../lib/highlight";
import { fontStack } from "../lib/theme";
import { isMac, modLabel } from "../lib/platform";

interface NoteInfo {
  name: string;
  modified: number;
}

interface Props {
  width: number;
  onResize: (w: number) => void;
  onClose: () => void;
  compiled: Compiled[];
  theme: ITheme;
  font: string;
  fontSize: number;
  /** Destino de "Enviar"; null si no hay sesión activa. */
  target: string | null;
  onSend: (text: string) => void;
  onCapture: () => string;
}

export const NotesPanel = memo(function NotesPanel(p: Props) {
  const [notes, setNotes] = useState<NoteInfo[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState(true);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const pendingSave = useRef<{ name: string; content: string } | null>(null);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(""), 3000);
  };

  const flushSave = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const job = pendingSave.current;
    if (!job) return;
    pendingSave.current = null;
    await invoke("save_note", job).catch((e) => flash(`No se pudo guardar: ${e}`));
    setSaved(true);
  }, []);

  const refresh = useCallback(() => invoke<NoteInfo[]>("list_notes").then(setNotes), []);

  const open = useCallback(
    async (name: string) => {
      await flushSave();
      let text: string;
      try {
        text = await invoke<string>("read_note", { name });
      } catch (e) {
        // Sin abrirla: mostrarla vacía haría que el autoguardado borre su contenido.
        flash(`No se pudo abrir ${name}: ${e}`);
        return;
      }
      setCurrent(name);
      setContent(text);
      setSaved(true);
      setConfirmDelete(false);
    },
    [flushSave],
  );

  const create = useCallback(async (rename = true) => {
    await flushSave();
    const list = await invoke<NoteInfo[]>("list_notes");
    let name = "Nota";
    for (let i = 2; list.some((n) => n.name === name); i++) name = `Nota ${i}`;
    await invoke("save_note", { name, content: "" });
    await refresh();
    setCurrent(name);
    setContent("");
    if (rename) setRenaming(name);
  }, [flushSave, refresh]);

  useEffect(() => {
    invoke<NoteInfo[]>("list_notes").then((list) => {
      setNotes(list);
      if (list[0]) open(list[0].name);
      else create(false);
    });
    return () => {
      flushSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edit = (text: string) => {
    setContent(text);
    if (!current) return;
    setSaved(false);
    pendingSave.current = { name: current, content: text };
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flushSave, 600);
  };

  const commitRename = async (to: string) => {
    const from = renaming;
    setRenaming(null);
    if (!from || !to.trim() || to.trim() === from) return;
    await flushSave();
    try {
      const name = await invoke<string>("rename_note", { from, to });
      await refresh();
      setCurrent(name);
    } catch (e) {
      flash(String(e));
    }
  };

  const remove = async () => {
    if (!current) return;
    if (!confirmDelete) return setConfirmDelete(true);
    window.clearTimeout(saveTimer.current);
    pendingSave.current = null;
    await invoke("delete_note", { name: current }).catch(() => {});
    const list = await invoke<NoteInfo[]>("list_notes");
    setNotes(list);
    setConfirmDelete(false);
    if (list[0]) open(list[0].name);
    else create();
  };

  /** Selección del editor o, si no hay, la línea del cursor (y avanza a la siguiente). */
  const sendSelectionOrLine = () => {
    const ta = editorRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    if (s !== e) return p.onSend(value.slice(s, e));
    const start = value.lastIndexOf("\n", s - 1) + 1;
    const endIdx = value.indexOf("\n", s);
    const end = endIdx === -1 ? value.length : endIdx;
    p.onSend(value.slice(start, end) + "\n");
    const next = end === value.length ? end : end + 1;
    ta.setSelectionRange(next, next);
  };

  const capture = () => {
    const sel = p.onCapture();
    if (!sel) return flash("Selecciona texto en la terminal primero");
    const sep = content && !content.endsWith("\n") ? "\n" : "";
    edit(content + sep + sel.replace(/\r/g, "") + "\n");
    flash("Selección agregada al final");
  };

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = p.width;
    const move = (ev: MouseEvent) => p.onResize(startW + (startX - ev.clientX));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <aside className="relative shrink-0 flex flex-col border-l border-line bg-chrome" style={{ width: p.width }}>
      <div
        onMouseDown={startDrag}
        className="absolute -left-1 top-0 bottom-0 w-2 cursor-col-resize z-10 hover:bg-[var(--selected)]"
      />

      <header className="flex items-center gap-1 h-9 px-2 border-b border-line">
        {renaming !== null ? (
          <input
            autoFocus
            className="field !h-7 flex-1"
            defaultValue={renaming}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => commitRename(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setRenaming(null);
            }}
          />
        ) : (
          <select
            className="field !h-7 flex-1 min-w-0 !text-[12.5px]"
            value={current ?? ""}
            onChange={(e) => open(e.target.value)}
          >
            {notes.map((n) => (
              <option key={n.name} value={n.name}>
                {n.name}
              </option>
            ))}
          </select>
        )}
        <HeadBtn title="Nueva nota" onClick={() => create()}>
          <Plus size={15} />
        </HeadBtn>
        <HeadBtn title="Renombrar" onClick={() => current && setRenaming(current)}>
          <Pencil size={13} />
        </HeadBtn>
        <HeadBtn
          title={confirmDelete ? "Clic para confirmar" : "Eliminar nota"}
          onClick={remove}
          onMouseLeave={() => setConfirmDelete(false)}
          className={confirmDelete ? "!text-danger bg-hover" : ""}
        >
          <Trash2 size={13} />
        </HeadBtn>
        <HeadBtn title="Abrir carpeta de notas" onClick={() => invoke("open_dir", { which: "notes" })}>
          <FolderOpen size={14} />
        </HeadBtn>
        <HeadBtn title={`Cerrar (${modLabel}J)`} onClick={p.onClose}>
          <X size={15} />
        </HeadBtn>
      </header>

      <CodeEditor
        ref={editorRef}
        value={content}
        onChange={edit}
        compiled={p.compiled}
        theme={p.theme}
        font={fontStack(p.font)}
        fontSize={p.fontSize}
        placeholder={"Comandos, plantillas o configuración.\nCtrl/⌘+Enter envía la línea o selección a la sesión."}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) p.onSend(content);
            else sendSelectionOrLine();
          }
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            flushSave();
          }
        }}
      />

      <footer className="border-t border-line px-2 py-1.5 space-y-1">
        <div className="flex items-center gap-1">
          <FootBtn onClick={sendSelectionOrLine} disabled={!p.target} title={`${isMac ? "⌘" : "Ctrl+"}Enter`}>
            <SendHorizontal size={13} /> Línea / selección
          </FootBtn>
          <FootBtn onClick={() => p.onSend(content)} disabled={!p.target || !content.trim()} title={`${isMac ? "⌘⇧" : "Ctrl+Shift+"}Enter`}>
            <Send size={13} /> Todo
          </FootBtn>
          <FootBtn onClick={capture} title="Agregar a la nota el texto seleccionado en la terminal">
            <ArrowDownToLine size={13} /> Capturar
          </FootBtn>
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted h-4">
          <span className="truncate">{notice || (p.target ? `Destino: ${p.target}` : "Sin sesión conectada")}</span>
          <span className="flex items-center gap-1 shrink-0">
            {saved ? <Check size={11} /> : null}
            {saved ? "Guardado" : "Guardando…"}
          </span>
        </div>
      </footer>
    </aside>
  );
});

function HeadBtn({ className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`w-7 h-7 shrink-0 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover ${className}`}
    />
  );
}

function FootBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="flex items-center gap-1.5 px-2 h-7 rounded-md text-[12px] text-muted hover:text-fg hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent"
    />
  );
}
