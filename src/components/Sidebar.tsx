import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  ChevronsDownUp,
  Copy,
  FileUp,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { ConnStatus, Session, sessionTarget } from "../types";
import { SessionIcon } from "./SessionIcon";
import { modLabel } from "../lib/platform";
import {
  FolderNode,
  allFolders,
  baseName,
  buildTree,
  freeName,
  isWithin,
  joinPath,
  normPath,
  parentOf,
  rebase,
  sessionsWithin,
} from "../lib/folders";

export interface ConfirmRequest {
  title: string;
  message: string;
  label: string;
  danger?: boolean;
  action: () => void;
}

interface Props {
  sessions: Session[];
  extraFolders: string[];
  /** Estado de conexión por id de sesión guardada (si tiene pestañas abiertas). */
  live: Record<string, ConnStatus>;
  onOpen: (s: Session) => void;
  onOpenMany: (list: Session[]) => void;
  onNew: (folder?: string) => void;
  onEdit: (s: Session) => void;
  onDuplicate: (s: Session) => void;
  onDelete: (s: Session) => void;
  onUpdateSessions: (changed: Session[]) => void;
  onSetExtraFolders: (folders: string[]) => void;
  onConfirm: (req: ConfirmRequest) => void;
  /** Abre la importación desde PuTTY, SecureCRT, MobaXterm, OpenSSH o CSV. */
  onImportFile?: () => void;
}

type MenuItem = [string, React.ReactNode, () => void, boolean?];
type Menu = { x: number; y: number; items: MenuItem[] };
type Selected = { kind: "session"; id: string } | { kind: "folder"; path: string } | null;

const DND_SESSION = "application/x-nt-session";
const DND_FOLDER = "application/x-nt-folder";

function loadCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem("collapsedFolders") ?? "{}");
  } catch {
    return {};
  }
}

export const Sidebar = memo(function Sidebar(p: Props) {
  const { sessions, extraFolders } = p;
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);
  const [selected, setSelected] = useState<Selected>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    try {
      localStorage.setItem("collapsedFolders", JSON.stringify(collapsed));
    } catch {
      /* sin almacenamiento: no se recuerda */
    }
  }, [collapsed]);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(""), 3000);
  };

  const folders = useMemo(() => allFolders(sessions, extraFolders), [sessions, extraFolders]);

  const q = filter.trim().toLowerCase();
  const tree = useMemo(() => {
    if (!q) return buildTree(sessions, extraFolders);
    const match = (s: Session) =>
      [s.name, s.host, s.serial_port, s.folder, s.username].some((v) => v?.toLowerCase().includes(q));
    return buildTree(sessions.filter(match), []);
  }, [sessions, extraFolders, q]);

  // ---------- Operaciones de carpetas ----------

  const createFolder = (parent: string) => {
    const path = freeName(folders, parent);
    p.onSetExtraFolders([...extraFolders, path]);
    if (parent) setCollapsed((c) => ({ ...c, [parent]: false }));
    setRenaming(path);
  };

  /** Mueve o renombra una carpeta con todo su contenido (si el destino existe, se fusionan). */
  const moveFolderTo = (from: string, to: string) => {
    if (from === to) return;
    const changed = sessionsWithin(sessions, from).map((s) => ({
      ...s,
      folder: rebase(normPath(s.folder), from, to),
    }));
    if (changed.length) p.onUpdateSessions(changed);
    p.onSetExtraFolders([...new Set(extraFolders.map((f) => rebase(normPath(f), from, to)))]);
    setCollapsed((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [rebase(k, from, to), v])));
  };

  const commitRename = (path: string, raw: string) => {
    setRenaming(null);
    const name = raw.replace(/\//g, "-").trim();
    if (!name || name === baseName(path)) return;
    const target = joinPath(parentOf(path), name);
    if (folders.includes(target)) return flash(`Ya existe la carpeta "${name}"`);
    moveFolderTo(path, target);
  };

  const deleteFolder = (path: string) => {
    const inside = sessionsWithin(sessions, path);
    const up = parentOf(path);
    const remove = () => {
      if (inside.length)
        p.onUpdateSessions(
          inside.map((s) => ({ ...s, folder: rebase(normPath(s.folder), path, up) || undefined })),
        );
      p.onSetExtraFolders(
        extraFolders
          .map((f) => normPath(f))
          .filter((f) => f !== path)
          .map((f) => rebase(f, path, up))
          .filter(Boolean),
      );
    };
    if (!inside.length) return remove();
    p.onConfirm({
      title: `¿Eliminar la carpeta "${baseName(path)}"?`,
      message: `Sus ${inside.length} sesiones y subcarpetas pasan a ${up || "la raíz"}. No se elimina ninguna sesión.`,
      label: "Eliminar carpeta",
      danger: true,
      action: remove,
    });
  };

  const connectAll = (path: string) => {
    const list = sessionsWithin(sessions, path);
    if (!list.length) return;
    if (list.length <= 5) return p.onOpenMany(list);
    p.onConfirm({
      title: `¿Conectar ${list.length} sesiones?`,
      message: `Se abrirá una pestaña por cada equipo de "${baseName(path)}".`,
      label: "Conectar todas",
      action: () => p.onOpenMany(list),
    });
  };

  const deleteSession = (s: Session) =>
    p.onConfirm({
      title: `¿Eliminar "${s.name}"?`,
      message: `${sessionTarget(s)}. Esta acción no se puede deshacer.`,
      label: "Eliminar",
      danger: true,
      action: () => p.onDelete(s),
    });

  // ---------- Menús contextuales ----------

  const openMenu = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const folderMenu = (e: React.MouseEvent, node: FolderNode) => {
    setSelected({ kind: "folder", path: node.path });
    openMenu(e, [
      [`Conectar todas (${node.total})`, <Play size={13} />, () => connectAll(node.path), node.total === 0],
      ["Nueva sesión aquí", <Plus size={13} />, () => p.onNew(node.path)],
      ["Nueva subcarpeta", <FolderPlus size={13} />, () => createFolder(node.path)],
      ["Renombrar", <Pencil size={13} />, () => setRenaming(node.path)],
      ["Eliminar carpeta", <Trash2 size={13} />, () => deleteFolder(node.path)],
    ]);
  };

  const sessionMenu = (e: React.MouseEvent, s: Session) => {
    setSelected({ kind: "session", id: s.id });
    openMenu(e, [
      ["Conectar", <Play size={13} />, () => p.onOpen(s)],
      ["Editar", <Pencil size={13} />, () => p.onEdit(s)],
      ["Duplicar", <Copy size={13} />, () => p.onDuplicate(s)],
      ["Eliminar", <Trash2 size={13} />, () => deleteSession(s)],
    ]);
  };

  // ---------- Arrastrar y soltar ----------

  const onDrop = (e: React.DragEvent, target: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const sid = e.dataTransfer.getData(DND_SESSION);
    const fpath = e.dataTransfer.getData(DND_FOLDER);
    if (sid) {
      const s = sessions.find((x) => x.id === sid);
      if (s && normPath(s.folder) !== target) p.onUpdateSessions([{ ...s, folder: target || undefined }]);
    } else if (fpath) {
      if (isWithin(target, fpath)) return flash("No se puede mover una carpeta dentro de sí misma");
      if (parentOf(fpath) === target) return;
      moveFolderTo(fpath, joinPath(target, baseName(fpath)));
    }
    if (target) setCollapsed((c) => ({ ...c, [target]: false }));
  };

  const dropProps = (target: string) => ({
    onDragOver: (e: React.DragEvent) => {
      const t = e.dataTransfer.types;
      if (!t.includes(DND_SESSION) && !t.includes(DND_FOLDER)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      setDropTarget(target);
    },
    onDragLeave: () => setDropTarget((t) => (t === target ? null : t)),
    onDrop: (e: React.DragEvent) => onDrop(e, target),
  });

  // ---------- Render ----------

  const renderFolder = (node: FolderNode, depth: number): React.ReactNode => {
    const isCollapsed = !q && collapsed[node.path];
    const isSel = selected?.kind === "folder" && selected.path === node.path;
    return (
      <div key={node.path}>
        <div
          draggable={renaming !== node.path}
          onDragStart={(e) => {
            e.dataTransfer.setData(DND_FOLDER, node.path);
            e.dataTransfer.effectAllowed = "move";
          }}
          {...dropProps(node.path)}
          tabIndex={0}
          onClick={() => {
            setSelected({ kind: "folder", path: node.path });
            setCollapsed((c) => ({ ...c, [node.path]: !c[node.path] }));
          }}
          onContextMenu={(e) => folderMenu(e, node)}
          onKeyDown={(e) => {
            if (e.key === "F2") setRenaming(node.path);
            if (e.key === "Delete") deleteFolder(node.path);
          }}
          style={{ paddingLeft: 6 + depth * 14 }}
          className={`group flex items-center gap-1.5 pr-1 h-7 rounded-md outline-none ${
            dropTarget === node.path
              ? "bg-selected ring-1 ring-[var(--accent)]"
              : isSel
                ? "bg-hover"
                : "hover:bg-hover"
          }`}
        >
          <ChevronRight
            size={12}
            className={`shrink-0 text-muted transition-transform ${isCollapsed ? "" : "rotate-90"}`}
          />
          {isCollapsed ? (
            <Folder size={14} className="shrink-0 text-muted" />
          ) : (
            <FolderOpen size={14} className="shrink-0 text-muted" />
          )}
          {renaming === node.path ? (
            <input
              autoFocus
              className="field !h-6 !px-1.5 flex-1 min-w-0"
              defaultValue={node.name}
              onClick={(e) => e.stopPropagation()}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => commitRename(node.path, e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenaming(null);
              }}
            />
          ) : (
            <span className="truncate flex-1 font-medium text-[12.5px]">{node.name}</span>
          )}
          <span className="text-[11px] text-muted group-hover:hidden">{node.total || ""}</span>
          <RowBtn title="Más acciones" className="hidden group-hover:grid" onClick={(e) => folderMenu(e, node)}>
            <MoreHorizontal size={14} />
          </RowBtn>
        </div>
        {!isCollapsed && (
          <>
            {node.children.map((c) => renderFolder(c, depth + 1))}
            {node.sessions.map((s) => renderSession(s, depth + 1))}
          </>
        )}
      </div>
    );
  };

  const renderSession = (s: Session, depth: number) => {
    const isSel = selected?.kind === "session" && selected.id === s.id;
    const status = p.live[s.id];
    return (
      <div
        key={s.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DND_SESSION, s.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        tabIndex={0}
        onClick={() => setSelected({ kind: "session", id: s.id })}
        onDoubleClick={() => p.onOpen(s)}
        onContextMenu={(e) => sessionMenu(e, s)}
        onKeyDown={(e) => {
          if (e.key === "Enter") p.onOpen(s);
          if (e.key === "Delete") deleteSession(s);
        }}
        title={`${sessionTarget(s)}\nDoble clic para conectar · clic derecho para más opciones`}
        style={{ paddingLeft: 24 + depth * 14 }}
        className={`group flex items-center gap-2 pr-1 h-7 rounded-md outline-none ${
          isSel ? "bg-selected" : "hover:bg-hover"
        }`}
      >
        <SessionIcon type={s.type} size={14} />
        <span className="truncate flex-1 text-[13px]">{s.name}</span>
        {status && (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0 group-hover:hidden"
            title="Pestaña abierta"
            style={{
              background:
                status === "connected" ? "var(--ok)" : status === "connecting" ? "var(--warn)" : "var(--muted)",
            }}
          />
        )}
        <div className="hidden group-hover:flex items-center">
          <RowBtn title="Editar" onClick={() => p.onEdit(s)}>
            <Pencil size={12} />
          </RowBtn>
          <RowBtn title="Más acciones" onClick={(e) => sessionMenu(e, s)}>
            <MoreHorizontal size={14} />
          </RowBtn>
        </div>
      </div>
    );
  };

  const empty = tree.children.length === 0 && tree.sessions.length === 0;
  const target = selectedFolder(selected, sessions);

  return (
    <aside className="w-64 shrink-0 h-full flex flex-col bg-chrome border-r border-line">
      <div className="flex items-center gap-0.5 px-2.5 pt-3 pb-2">
        <div className="relative flex-1 mr-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="field !h-7 !pl-8 !text-[12px]"
            placeholder="Filtrar nombre, IP, carpeta"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setFilter("")}
          />
        </div>
        <HeadBtn title={`Nueva sesión (${modLabel}N)`} onClick={() => p.onNew(target)}>
          <Plus size={16} />
        </HeadBtn>
        <HeadBtn title="Nueva carpeta" onClick={() => createFolder(target ?? "")}>
          <FolderPlus size={15} />
        </HeadBtn>
        <HeadBtn title="Contraer todo" onClick={() => setCollapsed(Object.fromEntries(folders.map((f) => [f, true])))}>
          <ChevronsDownUp size={15} />
        </HeadBtn>
      </div>

      {notice && <p className="px-3 pb-1 text-[11.5px] text-danger">{notice}</p>}

      <nav
        className={`flex-1 overflow-y-auto px-1.5 pb-3 ${dropTarget === "" ? "bg-selected" : ""}`}
        onContextMenu={(e) =>
          openMenu(e, [
            ["Nueva sesión", <Plus size={13} />, () => p.onNew()],
            ["Nueva carpeta", <FolderPlus size={13} />, () => createFolder("")],
            ...(p.onImportFile
              ? [["Importar sesiones…", <FileUp size={13} />, p.onImportFile] as MenuItem]
              : []),
          ])
        }
        {...dropProps("")}
        onClick={(e) => e.target === e.currentTarget && setSelected(null)}
      >
        {tree.children.map((c) => renderFolder(c, 0))}
        {tree.sessions.map((s) => renderSession(s, -1))}

        {empty && (
          <div className="px-3 py-8 text-center text-[12px] text-muted">
            {q ? "Sin coincidencias" : "Crea una sesión o una carpeta. Clic derecho para más opciones."}
            {!q && p.onImportFile && (
              <button className="block mx-auto mt-2 text-accent hover:underline" onClick={p.onImportFile}>
                Importar desde PuTTY, SecureCRT, MobaXterm…
              </button>
            )}
          </div>
        )}
      </nav>

      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
    </aside>
  );
});

/** Carpeta destino según la selección: la carpeta seleccionada o la de la sesión seleccionada. */
function selectedFolder(sel: Selected, sessions: Session[]): string | undefined {
  if (sel?.kind === "folder") return sel.path;
  if (sel?.kind === "session") return normPath(sessions.find((s) => s.id === sel.id)?.folder) || undefined;
  return undefined;
}

export function ContextMenu({ menu, onClose }: { menu: Menu; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  // Ajusta la posición para que el menú no se salga de la ventana.
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 8),
      y: Math.min(menu.y, window.innerHeight - r.height - 8),
    });
  }, [menu]);

  useEffect(() => {
    const onMouse = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onMouse);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onMouse);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-48 py-1 bg-panel border border-line rounded-lg shadow-pop"
      style={{ left: pos.x, top: pos.y }}
    >
      {menu.items.map(([label, icon, action, disabled]) => (
        <button
          key={label}
          role="menuitem"
          disabled={disabled}
          onClick={() => {
            onClose();
            action();
          }}
          className={`w-full flex items-center gap-2.5 px-3 h-7 text-left text-[12.5px] hover:bg-hover disabled:opacity-40 ${
            label.startsWith("Eliminar") ? "text-danger" : ""
          }`}
        >
          <span className="text-muted">{icon}</span>
          {label}
        </button>
      ))}
    </div>
  );
}

function HeadBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="w-7 h-7 shrink-0 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover"
    />
  );
}

function RowBtn({ className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick?.(e);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`w-6 h-6 place-items-center rounded text-muted hover:text-fg ${className || "grid"}`}
    />
  );
}
