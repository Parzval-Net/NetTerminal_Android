import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { History, Search, Zap } from "lucide-react";
import { Session, sessionTarget } from "../types";
import { SessionIcon, typeLabel } from "./SessionIcon";

interface Props {
  sessions: Session[];
  onClose: () => void;
  onOpen: (s: Session) => void;
}

/**
 * Interpreta conexiones rápidas:
 *   ssh admin@10.0.0.1:2222 · telnet 10.0.0.1 2323 · admin@router · 10.0.0.1
 *   2001:db8::1 · [2001:db8::1]:2222 · telnet fe80::1%en0 2323
 */
export function parseQuick(input: string): Session[] {
  const q = input.trim();
  if (!q || /\s{2,}/.test(q)) return [];
  const m = q.match(/^(?:(ssh|telnet)\s+)?(?:([^@\s]+)@)?(\S+?)(?:\s+(\d+))?$/i);
  if (!m) return [];
  const [, proto, user, target, spacePort] = m;
  let host: string;
  let colonPort: string | undefined;
  const bracket = target.match(/^\[([0-9a-f:.%\w-]+)\](?::(\d+))?$/i);
  if (bracket) [, host, colonPort] = bracket;
  else if ((target.match(/:/g) ?? []).length > 1) {
    // IPv6 sin corchetes: los ":" son parte de la dirección (el puerto va separado por espacio).
    if (!/^[0-9a-f:.]+(%[\w.-]+)?$/i.test(target)) return [];
    host = target;
  } else {
    const hp = target.match(/^([\w.-]+)(?::(\d+))?$/);
    if (!hp) return [];
    [, host, colonPort] = hp;
    if (!/[.-]|^[a-z][\w-]*$/i.test(host)) return [];
  }
  const p = colonPort || spacePort;
  const port = p ? Number(p) : undefined;
  if (port !== undefined && (port < 1 || port > 65535)) return [];
  const base = { id: "", folder: undefined, created_at: new Date().toISOString() };
  const ssh: Session = { ...base, type: "ssh", name: host, host, port: port ?? 22, username: user };
  const telnet: Session = { ...base, type: "telnet", name: host, host, port: port ?? 23 };
  if (proto?.toLowerCase() === "telnet") return [telnet];
  if (proto || user) return [ssh];
  return [ssh, telnet];
}

/** Forma canónica de un destino rápido, que parseQuick vuelve a interpretar. */
export function quickTarget(s: Session): string {
  return `${s.type} ${s.username ? `${s.username}@` : ""}${s.host ?? ""} ${s.port ?? ""}`.trim();
}

export function CommandPalette({ sessions, onClose, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  // Últimos destinos de conexión rápida (archivo en la carpeta de datos, máx. 20).
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    invoke<string[]>("recent_targets").then(setRecent).catch(() => {});
  }, []);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const recents = q
      ? []
      : recent
          .map((t) => parseQuick(t)[0])
          .filter((s): s is Session => !!s)
          .map((s) => ({ session: s, quick: true, recent: true }));
    const saved = sessions
      .filter((s) =>
        !q || [s.name, s.host, s.folder, s.serial_port].some((v) => v?.toLowerCase().includes(q)),
      )
      .slice(0, 50)
      .map((s) => ({ session: s, quick: false, recent: false }));
    const quick = parseQuick(query).map((s) => ({ session: s, quick: true, recent: false }));
    return [...recents, ...saved, ...quick];
  }, [query, sessions, recent]);

  useEffect(() => setIndex(0), [query]);

  const choose = (i: number) => {
    const item = items[i];
    if (!item) return;
    if (item.quick) invoke("recent_target_add", { target: quickTarget(item.session) }).catch(() => {});
    onOpen(item.session);
    onClose();
  };

  const clearRecent = () => {
    invoke("recent_targets_clear").catch(() => {});
    setRecent([]);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center pt-[12vh] bg-black/25" onMouseDown={onClose}>
      <div
        className="w-[520px] max-w-[92vw] h-fit bg-panel border border-line rounded-xl shadow-pop overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-line">
          <Search size={16} className="text-muted" />
          <input
            autoFocus
            className="flex-1 bg-transparent outline-none text-[14px] placeholder:text-muted"
            placeholder="Buscar sesión o escribir user@host para conexión rápida"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, items.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              }
              if (e.key === "Enter") choose(index);
            }}
          />
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5">
          {!query.trim() && recent.length > 0 && (
            <li className="flex items-center justify-between px-3 h-6 text-[11px] text-muted">
              Conexiones rápidas recientes
              <button className="hover:text-fg hover:underline" onClick={clearRecent}>
                Borrar recientes
              </button>
            </li>
          )}
          {items.map(({ session: s, quick, recent: isRecent }, i) => (
            <li
              key={isRecent ? `recent-${i}` : quick ? `quick-${s.type}` : s.id}
              onMouseMove={() => setIndex(i)}
              onClick={() => choose(i)}
              className={`flex items-center gap-3 px-3 h-11 rounded-lg ${i === index ? "bg-selected" : ""}`}
            >
              {isRecent ? (
                <History size={15} className="text-muted shrink-0" />
              ) : quick ? (
                <Zap size={15} className="text-warn shrink-0" />
              ) : (
                <SessionIcon type={s.type} size={15} />
              )}
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate">
                  {isRecent ? sessionTarget(s) : quick ? `Conexión rápida ${typeLabel[s.type]}` : s.name}
                </div>
                <div className="truncate text-[11.5px] text-muted">
                  {isRecent ? "Reciente" : sessionTarget(s)}
                  {!quick && s.folder ? ` · ${s.folder}` : ""}
                </div>
              </div>
              <span className="text-[10.5px] font-medium text-muted uppercase">{typeLabel[s.type]}</span>
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-3 py-6 text-center text-muted text-[12px]">
              Sin resultados. Prueba con <code>ssh user@host</code> o <code>telnet host 23</code>.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
