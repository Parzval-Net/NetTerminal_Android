import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ITheme } from "@xterm/xterm";
import { ArrowDownToLine, Check, FolderOpen, Lock, Pencil, Plus, Replace, Search, Send, SendHorizontal, ShieldCheck, Trash2, X } from "lucide-react";
import { CodeEditor } from "./CodeEditor";
import { NoteSecurity, NoteUnlock } from "./NoteLock";
import { BroadcastTargetPicker } from "./BroadcastTarget";
import { Compiled } from "../lib/highlight";
import { fontStack } from "../lib/theme";
import { isMac, modLabel } from "../lib/platform";

interface NoteInfo {
  name: string;
  modified: number;
  /** Cifrada con contraseña: el contenido solo existe en memoria mientras está desbloqueada. */
  protected: boolean;
}

interface NoteMatch {
  name: string;
  line: number;
  snippet: string;
  /** Nota protegida que coincide por nombre (su contenido no se busca). */
  protected: boolean;
}

const AUTO_LOCK_KEY = "notesAutoLockMin";
function storedAutoLock(): number {
  try {
    const v = Number(localStorage.getItem(AUTO_LOCK_KEY));
    return v >= 1 && v <= 60 ? v : 5;
  } catch {
    return 5;
  }
}

/** Posiciones de `find` en `text` (texto plano, opcionalmente sin distinguir mayúsculas). */
function occurrences(text: string, find: string, matchCase: boolean): number[] {
  if (!find) return [];
  const hay = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? find : find.toLowerCase();
  // toLowerCase puede cambiar el largo en algunos caracteres: entonces se busca tal cual.
  if (hay.length !== text.length || needle.length !== find.length) return occurrences(text, find, true);
  const out: number[] = [];
  for (let i = hay.indexOf(needle); i !== -1 && out.length < 10000; i = hay.indexOf(needle, i + needle.length)) out.push(i);
  return out;
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
  // Búsqueda en todas las notas y buscar/reemplazar en la actual (cerradas por defecto).
  const [tool, setTool] = useState<"search" | "replace" | "secure" | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NoteMatch[] | null>(null);
  const [find, setFind] = useState("");
  const [replaceWith, setReplaceWith] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const pendingSave = useRef<{ name: string; content: string; secure: boolean } | null>(null);
  // Nota protegida abierta: el texto descifrado vive solo en `content` y se borra al bloquear.
  const [unlocked, setUnlocked] = useState(false);
  const unlockedRef = useRef(false);
  const [autoLock, setAutoLock] = useState(storedAutoLock);
  const lastActivity = useRef(Date.now());
  const lastTouch = useRef(0);
  const isProtected = notes.find((n) => n.name === current)?.protected ?? false;
  const locked = isProtected && !unlocked;
  const markUnlocked = (v: boolean) => {
    unlockedRef.current = v;
    setUnlocked(v);
    lastActivity.current = Date.now();
  };

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(""), 3000);
  };

  const flushSave = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const job = pendingSave.current;
    if (!job) return;
    pendingSave.current = null;
    if (job.secure) {
      const ok = await invoke("note_save_secure", { name: job.name, content: job.content }).then(
        () => true,
        (e) => (flash(`No se pudo guardar: ${e}`), false),
      );
      // La llave caducó en el backend: se bloquea también aquí (sin texto en claro en memoria).
      if (!ok && unlockedRef.current) {
        unlockedRef.current = false;
        setUnlocked(false);
        setContent("");
      }
    } else {
      await invoke("save_note", { name: job.name, content: job.content }).catch((e) => flash(`No se pudo guardar: ${e}`));
    }
    setSaved(true);
  }, []);

  /** Guarda lo pendiente, borra la llave del backend y el texto descifrado de la memoria. */
  const lockNote = useCallback(
    async (msg?: string) => {
      await flushSave();
      if (!unlockedRef.current) return;
      await invoke("note_lock").catch(() => {});
      unlockedRef.current = false;
      setUnlocked(false);
      setContent("");
      if (msg) flash(msg);
    },
    [flushSave],
  );

  const refresh = useCallback(() => invoke<NoteInfo[]>("list_notes").then(setNotes), []);

  const open = useCallback(
    async (name: string) => {
      await lockNote();
      const list = await invoke<NoteInfo[]>("list_notes").catch(() => null);
      if (list) setNotes(list);
      if (list?.find((n) => n.name === name)?.protected) {
        // Protegida: se muestra la pantalla de contraseña, sin leer nada del disco.
        setCurrent(name);
        setContent("");
        setSaved(true);
        setConfirmDelete(false);
        return;
      }
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
    [lockNote],
  );

  const create = useCallback(async (rename = true) => {
    await lockNote();
    const list = await invoke<NoteInfo[]>("list_notes");
    let name = "Nota";
    for (let i = 2; list.some((n) => n.name === name); i++) name = `Nota ${i}`;
    await invoke("save_note", { name, content: "" });
    await refresh();
    setCurrent(name);
    setContent("");
    if (rename) setRenaming(name);
  }, [lockNote, refresh]);

  useEffect(() => {
    invoke<NoteInfo[]>("list_notes").then((list) => {
      setNotes(list);
      if (list[0]) open(list[0].name);
      else create(false);
    });
    // Al cerrar el panel se guarda lo pendiente y se bloquea la nota protegida abierta.
    return () => {
      flushSave().finally(() => invoke("note_lock").catch(() => {}));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tool !== "search" || query.trim().length < 2) return setResults(null);
    const t = window.setTimeout(async () => {
      await flushSave();
      invoke<NoteMatch[]>("search_notes", { query })
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [tool, query, flushSave]);

  // Bloqueo por inactividad de la nota protegida abierta (el backend tiene su propio plazo).
  useEffect(() => {
    if (!unlocked) return;
    const t = window.setInterval(() => {
      if (Date.now() - lastActivity.current > autoLock * 60_000) lockNote("Nota bloqueada por inactividad");
    }, 5000);
    return () => window.clearInterval(t);
  }, [unlocked, autoLock, lockNote]);

  const activity = () => {
    lastActivity.current = Date.now();
    if (unlockedRef.current && current && Date.now() - lastTouch.current > 30_000) {
      lastTouch.current = Date.now();
      invoke("note_touch", { name: current }).catch(() => {});
    }
  };

  const setAutoLockMin = (min: number) => {
    setAutoLock(min);
    try {
      localStorage.setItem(AUTO_LOCK_KEY, String(min));
    } catch {
      /* sin almacenamiento local: vale solo para esta sesión */
    }
  };

  const idleSecs = autoLock * 60;
  const unlock = async (password: string): Promise<string | null> => {
    if (!current) return null;
    try {
      const text = await invoke<string>("note_unlock", { name: current, password, idleSecs });
      setContent(text);
      setSaved(true);
      markUnlocked(true);
      return null;
    } catch (e) {
      return String(e);
    }
  };

  const protect = async (password: string): Promise<string | null> => {
    if (!current) return null;
    await flushSave();
    try {
      await invoke("note_protect", { name: current, password, idleSecs });
    } catch (e) {
      return String(e);
    }
    markUnlocked(true);
    await refresh();
    setTool(null);
    flash("Nota protegida: cifrada en disco");
    return null;
  };

  const changePassword = async (old: string, next: string): Promise<string | null> => {
    if (!current) return null;
    await flushSave();
    try {
      await invoke("note_change_password", { name: current, old, new: next });
    } catch (e) {
      return String(e);
    }
    flash("Contraseña de la nota actualizada");
    return null;
  };

  const unprotect = async (): Promise<string | null> => {
    if (!current) return null;
    await flushSave();
    try {
      await invoke("note_unprotect", { name: current });
    } catch (e) {
      return String(e);
    }
    unlockedRef.current = false;
    setUnlocked(false);
    await refresh();
    setTool(null);
    flash("Protección quitada: la nota vuelve a ser texto plano");
    return null;
  };

  /** Abre la nota y selecciona la línea encontrada. */
  const jumpTo = async (m: NoteMatch) => {
    if (m.name !== current) await open(m.name);
    if (m.protected) return;
    window.setTimeout(() => {
      const ta = editorRef.current;
      if (!ta) return;
      const lines = ta.value.split("\n");
      const start = lines.slice(0, m.line - 1).reduce((n, l) => n + l.length + 1, 0);
      ta.focus();
      ta.setSelectionRange(start, start + (lines[m.line - 1]?.length ?? 0));
      ta.scrollTop = Math.max(0, (m.line - 1) * p.fontSize * 1.5 - ta.clientHeight / 3);
    }, 30);
  };

  const hits = useMemo(
    () => (tool === "replace" ? occurrences(content, find, matchCase) : []),
    [tool, content, find, matchCase],
  );

  const replaceAll = () => {
    if (!hits.length) return;
    let out = "";
    let last = 0;
    for (const i of hits) {
      out += content.slice(last, i) + replaceWith;
      last = i + find.length;
    }
    edit(out + content.slice(last));
    flash(`${hits.length} reemplazos`);
  };

  const toggleTool = (t: "search" | "replace" | "secure") => setTool((cur) => (cur === t ? null : t));

  const edit = (text: string) => {
    if (locked) return;
    setContent(text);
    if (!current) return;
    setSaved(false);
    pendingSave.current = { name: current, content: text, secure: isProtected };
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
    unlockedRef.current = false;
    setUnlocked(false);
    await invoke("delete_note", { name: current }).catch(() => {});
    const list = await invoke<NoteInfo[]>("list_notes");
    setNotes(list);
    setConfirmDelete(false);
    if (list[0]) open(list[0].name);
    else create();
  };

  /** Selección del editor o, si no hay, la línea del cursor (y avanza a la siguiente). */
  const sendSelectionOrLine = () => {
    if (locked) return;
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
    if (locked) return;
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
    <aside
      className="relative shrink-0 flex flex-col border-l border-line bg-chrome"
      style={{ width: p.width }}
      onKeyDownCapture={activity}
      onMouseDownCapture={activity}
      onMouseMove={activity}
      onCopy={() => unlocked && flash("Copiado. Ojo: el portapapeles no está protegido")}
      onCut={() => unlocked && flash("Cortado. Ojo: el portapapeles no está protegido")}
    >
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
          <>
            {/* Candado de la nota protegida: con la nota abierta, clic para bloquear. */}
            {isProtected &&
              (unlocked ? (
                <HeadBtn title="Bloquear nota" onClick={() => lockNote()} className="!text-accent">
                  <Lock size={13} />
                </HeadBtn>
              ) : (
                <span title="Nota protegida" className="shrink-0 px-1 text-accent">
                  <Lock size={13} />
                </span>
              ))}
            <select
              className="field !h-7 flex-1 min-w-0 !text-[12.5px]"
              value={current ?? ""}
              onChange={(e) => open(e.target.value)}
            >
              {notes.map((n) => (
                <option key={n.name} value={n.name}>
                  {n.protected ? `${n.name} (protegida)` : n.name}
                </option>
              ))}
            </select>
          </>
        )}
        <HeadBtn title="Buscar en todas las notas" onClick={() => toggleTool("search")} className={tool === "search" ? "!text-accent" : ""}>
          <Search size={14} />
        </HeadBtn>
        <HeadBtn title="Buscar y reemplazar en esta nota" onClick={() => toggleTool("replace")} className={tool === "replace" ? "!text-accent" : ""}>
          <Replace size={14} />
        </HeadBtn>
        <HeadBtn
          title={locked ? "Desbloquea la nota para cambiar su protección" : isProtected ? "Protección de la nota" : "Proteger con contraseña"}
          onClick={() => !locked && toggleTool("secure")}
          disabled={locked}
          className={`${tool === "secure" ? "!text-accent" : ""} disabled:opacity-40`}
        >
          <ShieldCheck size={14} />
        </HeadBtn>
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

      {tool === "search" && (
        <div className="border-b border-line px-2 py-1.5 space-y-1">
          <input
            autoFocus
            className="field !h-7 !text-[12px]"
            placeholder="Buscar en todas las notas (mín. 2 caracteres)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setTool(null);
              if (e.key === "Enter" && results?.[0]) jumpTo(results[0]);
            }}
          />
          {results && (
            <ul className="max-h-[35vh] overflow-y-auto text-[12px]">
              {results.length === 0 && <li className="px-1 py-1 text-muted">Sin coincidencias</li>}
              {notes.some((n) => n.protected) && (
                <li className="px-1 py-1 text-[11px] text-muted">Las notas protegidas no se incluyen en la búsqueda</li>
              )}
              {results.map((m, i) => (
                <li key={i}>
                  <button
                    onClick={() => jumpTo(m)}
                    className="w-full text-left px-1.5 py-1 rounded hover:bg-hover"
                    title={m.protected ? `${m.name} (protegida)` : `${m.name}, línea ${m.line}`}
                  >
                    {m.protected ? (
                      <span className="flex items-center gap-1 text-[11px] text-muted truncate">
                        <Lock size={10} className="shrink-0" /> {m.name} · nota protegida, contenido no buscado
                      </span>
                    ) : (
                      <>
                        <span className="block text-[11px] text-muted truncate">
                          {m.name} · línea {m.line}
                        </span>
                        <span className="block truncate font-mono">{m.snippet}</span>
                      </>
                    )}
                  </button>
                </li>
              ))}
              {results.length >= 200 && <li className="px-1 py-1 text-muted">Se muestran los primeros 200 resultados</li>}
            </ul>
          )}
        </div>
      )}
      {tool === "secure" && current && !locked && (
        <NoteSecurity
          key={`${current}-${isProtected}`}
          name={current}
          isProtected={isProtected}
          autoLock={autoLock}
          onAutoLock={setAutoLockMin}
          onProtect={protect}
          onChange={changePassword}
          onUnprotect={unprotect}
          onLock={() => {
            setTool(null);
            lockNote();
          }}
          onClose={() => setTool(null)}
        />
      )}
      {tool === "replace" && !locked && (
        <div className="border-b border-line px-2 py-1.5 space-y-1 text-[12px]">
          <div className="flex items-center gap-1">
            <input
              autoFocus
              className="field !h-7 !text-[12px] flex-1"
              placeholder="Buscar en esta nota"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setTool(null)}
            />
            <button
              title="Distinguir mayúsculas"
              onClick={() => setMatchCase((v) => !v)}
              className={`w-7 h-7 shrink-0 rounded-md text-[11px] font-semibold hover:bg-hover ${matchCase ? "text-accent bg-hover" : "text-muted"}`}
            >
              Aa
            </button>
          </div>
          <div className="flex items-center gap-1">
            <input
              className="field !h-7 !text-[12px] flex-1"
              placeholder="Reemplazar por"
              value={replaceWith}
              onChange={(e) => setReplaceWith(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setTool(null);
                if (e.key === "Enter") replaceAll();
              }}
            />
            <button
              onClick={replaceAll}
              disabled={!hits.length}
              className="px-2 h-7 shrink-0 rounded-md border border-line hover:bg-hover disabled:opacity-40"
            >
              Reemplazar todo
            </button>
          </div>
          <p className="text-[11px] text-muted">
            {find ? `${hits.length >= 10000 ? "10.000+" : hits.length} ${hits.length === 1 ? "coincidencia" : "coincidencias"} en ${current ?? "la nota"}` : "Texto plano, sin expresiones regulares"}
          </p>
        </div>
      )}

      {locked && current ? (
        <NoteUnlock key={current} name={current} onUnlock={unlock} />
      ) : (
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
      )}

      <footer className="border-t border-line px-2 py-1.5 space-y-1">
        <div className="flex items-center gap-1">
          <FootBtn onClick={sendSelectionOrLine} disabled={!p.target || locked} title={`${isMac ? "⌘" : "Ctrl+"}Enter`}>
            <SendHorizontal size={13} /> Línea / selección
          </FootBtn>
          <FootBtn onClick={() => p.onSend(content)} disabled={!p.target || locked || !content.trim()} title={`${isMac ? "⌘⇧" : "Ctrl+Shift+"}Enter`}>
            <Send size={13} /> Todo
          </FootBtn>
          <FootBtn onClick={capture} disabled={locked} title="Agregar a la nota el texto seleccionado en la terminal">
            <ArrowDownToLine size={13} /> Capturar
          </FootBtn>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted h-6">
          <span className="truncate flex-1 min-w-0">{notice || (p.target ? `Destino: ${p.target}` : "Sin sesión conectada")}</span>
          <BroadcastTargetPicker />
          <span className="flex items-center gap-1 shrink-0">
            {locked ? <Lock size={11} /> : saved ? <Check size={11} /> : null}
            {locked ? "Bloqueada" : saved ? (unlocked ? "Cifrada" : "Guardado") : "Guardando…"}
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
