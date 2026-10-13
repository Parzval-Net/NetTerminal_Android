import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  FilePlus,
  Folder,
  FileText,
  FolderOpen,
  HardDrive,
  Monitor,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { Settings } from "../../lib/settings";
import { RemoteFile, guessProfile, parseListing, profiles } from "../../lib/devicefs";
import { Btn, Console, Label, fmtBytes } from "./ui";

export interface TerminalRef {
  connId: string;
  name: string;
  host?: string;
  highlight?: string;
}

interface Op {
  id: string;
  kind: "send" | "pull" | "backup";
  file: string;
  conn: string;
  command: string;
  status: "pending" | "running" | "ok" | "error";
  lines: string[];
  error?: string;
  bytes?: number;
  total?: number | null;
}

interface Props {
  terminals: TerminalRef[];
  settings: Settings;
  running: string[];
  onChange: (p: Partial<Settings>) => void;
  refreshRunning: () => void;
  onConfirm: (req: { title: string; message: string; label: string; danger?: boolean; action: () => void }) => void;
}

const DND_LOCAL = "application/x-nt-local";
const DND_REMOTE = "application/x-nt-remote";
const TIMEOUT = 3600; // firmware grandes por TFTP pueden tardar decenas de minutos

export function FileManager({ terminals, settings: s, running, onChange, refreshRunning, onConfirm }: Props) {
  const [connId, setConnId] = useState<string>("");
  const term = terminals.find((t) => t.connId === connId);
  const [profileId, setProfileId] = useState("cisco");
  const profile = profiles.find((p) => p.id === profileId)!;
  const [fs, setFs] = useState(profile.fs);
  const [extra, setExtra] = useState("");
  const [proto, setProto] = useState<"tftp" | "http">("tftp");
  const [ips, setIps] = useState<{ name: string; ip: string }[]>([]);
  const [ip, setIp] = useState("");
  const [local, setLocal] = useState<[string, number][]>([]);
  const [remote, setRemote] = useState<{ files: RemoteFile[]; free: number | null; total: number | null } | null>(null);
  const [listing, setListing] = useState(false);
  const [selLocal, setSelLocal] = useState<Set<string>>(new Set());
  const [selRemote, setSelRemote] = useState<Set<string>>(new Set());
  const [ops, setOps] = useState<Op[]>([]);
  const [error, setError] = useState("");
  const [drop, setDrop] = useState<"local" | "remote" | null>(null);
  const [showLog, setShowLog] = useState<string | null>(null);
  const jobToOp = useRef(new Map<string, string>());
  const listJob = useRef<string | null>(null);

  // Primera sesión conectada por defecto; perfil según el fabricante de la sesión.
  useEffect(() => {
    if (!term && terminals[0]) setConnId(terminals[0].connId);
  }, [terminals, term]);
  useEffect(() => {
    if (!term) return;
    const p = guessProfile(term.highlight);
    setProfileId(p);
    setFs(profiles.find((x) => x.id === p)!.fs);
    setRemote(null);
    if (term.host)
      invoke<string>("source_ip", { host: term.host })
        .then(setIp)
        .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId]);

  const loadLocal = useCallback(() => invoke<[string, number][]>("tftp_files").then(setLocal), []);
  useEffect(() => {
    loadLocal();
    invoke<{ name: string; ip: string }[]>("local_ips").then((l) => {
      setIps(l);
      setIp((cur) => cur || l[0]?.ip || "");
    });
  }, [loadLocal]);

  // Eventos: salida de comandos en el equipo y progreso de transferencias.
  useEffect(() => {
    const subs = [
      listen<{ job: string; kind: string; text: string; data?: { ok: boolean; output: string } }>("tool-job", ({ payload: e }) => {
        if (e.job === listJob.current) {
          if (e.kind === "result" && e.data) setRemote(parseListing(e.data.output));
          if (e.kind === "error") setError(e.text);
          if (e.kind === "done") {
            listJob.current = null;
            setListing(false);
          }
          return;
        }
        const opId = jobToOp.current.get(e.job);
        if (!opId) return;
        setOps((list) =>
          list.map((o) => {
            if (o.id !== opId) return o;
            if (e.kind === "line") return { ...o, lines: [...o.lines.slice(-300), e.text] };
            if (e.kind === "error") return { ...o, status: "error", error: e.text };
            if (e.kind === "result" && e.data)
              return o.status === "error" ? o : { ...o, status: e.data.ok ? "ok" : "error", error: e.data.ok ? undefined : "El equipo informó un error (ver salida)" };
            return o;
          }),
        );
      }),
      listen<{ file: string; bytes: number; total: number | null; done: boolean }>("transfer", ({ payload: t }) => {
        setOps((list) =>
          list.map((o) => (o.status === "running" && t.file.endsWith(o.file) ? { ...o, bytes: t.bytes, total: t.total } : o)),
        );
        if (t.done) loadLocal();
      }),
    ];
    return () => subs.forEach((u) => u.then((f) => f()));
  }, [loadLocal]);

  const refreshRemote = useCallback(async () => {
    if (!connId) return;
    setError("");
    setListing(true);
    try {
      listJob.current = await invoke<string>("device_run", { conn: connId, command: profile.list(fs), timeoutSecs: 60 });
    } catch (e) {
      setError(String(e));
      setListing(false);
    }
  }, [connId, profile, fs]);

  // Asegura el servidor necesario. "write" habilita subidas TFTP (el equipo envía al PC).
  const ensureServer = async (kind: "tftp" | "http", write: boolean) => {
    if (kind === "http") {
      if (!running.includes("http")) await invoke("server_start", { kind: "http", port: s.httpPort });
    } else if (!running.includes("tftp") || (write && !s.tftpAllowWrite)) {
      if (write && !s.tftpAllowWrite) onChange({ tftpAllowWrite: true });
      await invoke("server_start", { kind: "tftp", port: s.tftpPort, allowWrite: write || s.tftpAllowWrite });
    }
    refreshRunning();
  };

  // Cola: una operación a la vez sobre el equipo.
  const runningOp = ops.find((o) => o.status === "running");
  useEffect(() => {
    if (runningOp) return;
    const next = ops.find((o) => o.status === "pending");
    if (!next) return;
    setOps((l) => l.map((o) => (o.id === next.id ? { ...o, status: "running" } : o)));
    (async () => {
      try {
        await ensureServer(next.kind === "send" ? proto : "tftp", next.kind !== "send");
        const job = await invoke<string>("device_run", { conn: next.conn, command: next.command, timeoutSecs: TIMEOUT });
        jobToOp.current.set(job, next.id);
      } catch (e) {
        setOps((l) => l.map((o) => (o.id === next.id ? { ...o, status: "error", error: String(e) } : o)));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops, runningOp]);

  // Al terminar todas las operaciones, refresca ambos paneles.
  const pending = ops.some((o) => o.status === "pending" || o.status === "running");
  const prevPending = useRef(false);
  useEffect(() => {
    if (prevPending.current && !pending) {
      loadLocal();
      refreshRemote();
    }
    prevPending.current = pending;
  }, [pending, loadLocal, refreshRemote]);

  const enqueue = (kind: Op["kind"], files: string[]) => {
    if (!term) return setError("Conecta una sesión con el equipo primero");
    if (!ip) return setError("Selecciona la IP de este PC que el equipo puede alcanzar");
    const vars = (file: string) => ({ ip, port: s.httpPort, file, fs, extra });
    const items: Op[] = files.map((file) => ({
      id: `${Date.now()}-${file}`,
      kind,
      file,
      conn: term.connId,
      command: kind === "send" ? profile.upload(vars(file), proto) : kind === "pull" ? profile.download!(vars(file)) : profile.backup!(vars(file)),
      status: "pending",
      lines: [],
    }));
    const overwrite = kind === "send" ? files.filter((f) => remote?.files.some((r) => r.name === f)) : files.filter((f) => local.some(([n]) => n === f));
    const go = () => setOps((o) => [...items, ...o.filter((x) => x.status !== "ok")].slice(0, 30));
    if (overwrite.length)
      onConfirm({
        title: "¿Sobrescribir archivos?",
        message: `Ya existe${overwrite.length > 1 ? "n" : ""} en el destino: ${overwrite.join(", ")}`,
        label: "Sobrescribir",
        danger: true,
        action: go,
      });
    else go();
    setSelLocal(new Set());
    setSelRemote(new Set());
  };

  const addFiles = async () => {
    const paths = await open({ multiple: true, directory: false, title: "Archivos para enviar a equipos" });
    const list = typeof paths === "string" ? [paths] : (paths ?? []);
    for (const path of list) await invoke("tftp_add", { path }).catch((e) => setError(String(e)));
    loadLocal();
  };

  const backupName = useMemo(
    () => `${(term?.name ?? "equipo").replace(/[^\w.-]+/g, "_")}_${new Date().toISOString().slice(0, 10)}.cfg`,
    [term],
  );

  const remoteFiles = remote?.files.filter((f) => !f.dir) ?? [];

  return (
    <div className="space-y-3">
      <div className="grid gap-3 [grid-template-columns:2fr_1.6fr_1fr_1.3fr_0.9fr]">
        <Label text="Equipo (sesión conectada)">
          <select className="field" value={connId} onChange={(e) => setConnId(e.target.value)}>
            {terminals.length === 0 && <option value="">Sin sesiones conectadas</option>}
            {terminals.map((t) => (
              <option key={t.connId} value={t.connId}>
                {t.name}
                {t.host ? ` · ${t.host}` : ""}
              </option>
            ))}
          </select>
        </Label>
        <Label text="Tipo de equipo">
          <select
            className="field"
            value={profileId}
            onChange={(e) => {
              setProfileId(e.target.value);
              setFs(profiles.find((p) => p.id === e.target.value)!.fs);
              setRemote(null);
            }}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Label>
        <Label text="Almacenamiento">
          <input className="field font-mono !text-[12px]" value={fs} onChange={(e) => setFs(e.target.value.trim())} />
        </Label>
        <Label text="IP de este PC">
          <select className="field" value={ip} onChange={(e) => setIp(e.target.value)}>
            {ip && !ips.some((i) => i.ip === ip) && <option value={ip}>{ip} (ruta al equipo)</option>}
            {ips.map((i) => (
              <option key={i.ip} value={i.ip}>
                {i.ip} · {i.name}
              </option>
            ))}
          </select>
        </Label>
        <Label text="Protocolo envío">
          <select className="field" value={proto} onChange={(e) => setProto(e.target.value as "tftp" | "http")}>
            <option value="tftp">TFTP</option>
            <option value="http" disabled={profileId === "huawei"}>
              HTTP (rápido)
            </option>
          </select>
        </Label>
      </div>
      {(profile.note || profileId === "nxos") && (
        <div className="flex items-center gap-3 text-[11.5px] text-muted">
          {profile.note}
          {profileId === "nxos" && (
            <input className="field !h-6 !w-40 !text-[11.5px]" placeholder="VRF (management)" value={extra} onChange={(e) => setExtra(e.target.value)} />
          )}
        </div>
      )}
      {error && <p className="text-[12px] text-danger">{error}</p>}

      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-stretch">
        {/* Panel PC */}
        <Pane
          icon={<Monitor size={14} />}
          title="Este PC · carpeta compartida"
          highlight={drop === "local"}
          actions={
            <>
              <Btn kind="ghost" className="!px-1.5 !h-7" title="Agregar archivos" onClick={addFiles}>
                <FilePlus size={14} />
              </Btn>
              <Btn kind="ghost" className="!px-1.5 !h-7" title="Abrir carpeta" onClick={() => invoke("open_dir", { which: "tftp" })}>
                <FolderOpen size={14} />
              </Btn>
              <Btn kind="ghost" className="!px-1.5 !h-7" title="Actualizar" onClick={loadLocal}>
                <RefreshCw size={13} />
              </Btn>
            </>
          }
          dropProps={{
            onDragOver: (e) => {
              if (!e.dataTransfer.types.includes(DND_REMOTE)) return;
              e.preventDefault();
              setDrop("local");
            },
            onDragLeave: () => setDrop(null),
            onDrop: (e) => {
              setDrop(null);
              const names = e.dataTransfer.getData(DND_REMOTE).split("\n").filter(Boolean);
              if (names.length && profile.download) enqueue("pull", names);
            },
          }}
          footer={`${local.length} archivos`}
        >
          {local.length === 0 && <Empty text="Agrega firmware o configuraciones con el botón +" />}
          {local.map(([name, size]) => (
            <Row
              key={name}
              name={name}
              detail={fmtBytes(size)}
              selected={selLocal.has(name)}
              onToggle={() => setSelLocal(toggle(selLocal, name))}
              onDragStart={(e) => {
                const names = selLocal.has(name) ? [...selLocal] : [name];
                e.dataTransfer.setData(DND_LOCAL, names.join("\n"));
              }}
              onDelete={() =>
                onConfirm({
                  title: `¿Eliminar ${name} de la carpeta compartida?`,
                  message: "Solo se borra la copia en este PC.",
                  label: "Eliminar",
                  danger: true,
                  action: () => invoke("tftp_delete", { name }).then(loadLocal),
                })
              }
            />
          ))}
        </Pane>

        {/* Acciones */}
        <div className="flex flex-col justify-center gap-2">
          <Btn kind="primary" disabled={!selLocal.size || !term} onClick={() => enqueue("send", [...selLocal])} title="El equipo descarga los archivos seleccionados">
            Enviar <ArrowRight size={14} />
          </Btn>
          <Btn
            disabled={!selRemote.size || !term || !profile.download}
            onClick={() => enqueue("pull", [...selRemote])}
            title={profile.download ? "El equipo sube los archivos seleccionados a este PC" : "No soportado por TFTP en este equipo"}
          >
            <ArrowLeft size={14} /> Traer
          </Btn>
          <Btn
            kind="ghost"
            disabled={!term || !profile.backup}
            onClick={() => enqueue("backup", [backupName])}
            title="copy running-config a este PC"
          >
            <Save size={14} /> Respaldar config
          </Btn>
        </div>

        {/* Panel equipo */}
        <Pane
          icon={<HardDrive size={14} />}
          title={term ? `${term.name} · ${fs}` : "Equipo"}
          highlight={drop === "remote"}
          actions={
            <Btn kind="ghost" className="!h-7" disabled={!term || listing} onClick={refreshRemote}>
              <RefreshCw size={13} className={listing ? "animate-spin" : ""} /> {remote ? "Actualizar" : "Leer archivos"}
            </Btn>
          }
          dropProps={{
            onDragOver: (e) => {
              if (!e.dataTransfer.types.includes(DND_LOCAL)) return;
              e.preventDefault();
              setDrop("remote");
            },
            onDragLeave: () => setDrop(null),
            onDrop: (e) => {
              setDrop(null);
              const names = e.dataTransfer.getData(DND_LOCAL).split("\n").filter(Boolean);
              if (names.length) enqueue("send", names);
            },
          }}
          footer={
            remote?.free != null
              ? `${remoteFiles.length} archivos · libre ${fmtBytes(remote.free)}${remote.total ? ` de ${fmtBytes(remote.total)}` : ""}`
              : remote
                ? `${remoteFiles.length} archivos`
                : ""
          }
        >
          {!term && <Empty text="Conecta una sesión SSH, Telnet o Serial con el equipo" />}
          {term && !remote && !listing && <Empty text={`Pulsa "Leer archivos" para listar ${fs}`} />}
          {remote?.files.map((f) => (
            <Row
              key={f.name}
              name={f.name}
              dir={f.dir}
              detail={f.dir ? "carpeta" : fmtBytes(f.size)}
              sub={f.date}
              selected={selRemote.has(f.name)}
              onToggle={() => !f.dir && setSelRemote(toggle(selRemote, f.name))}
              onDragStart={(e) => {
                const names = selRemote.has(f.name) ? [...selRemote] : [f.name];
                e.dataTransfer.setData(DND_REMOTE, names.join("\n"));
              }}
            />
          ))}
          {remote && remote.files.length === 0 && <Empty text="No se reconocieron archivos en la salida del equipo" />}
        </Pane>
      </div>

      {ops.length > 0 && (
        <div className="rounded-xl border border-line bg-panel p-3 space-y-2">
          <div className="flex justify-between items-center">
            <h4 className="text-[12.5px] font-semibold">Operaciones</h4>
            <Btn kind="ghost" className="!h-6" disabled={pending} onClick={() => setOps([])}>
              Limpiar
            </Btn>
          </div>
          {ops.map((o) => {
            const pct = o.total ? Math.min(100, ((o.bytes ?? 0) / o.total) * 100) : o.status === "ok" ? 100 : null;
            return (
              <div key={o.id}>
                <div className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="truncate">
                    <span className="text-muted">{o.kind === "send" ? "→ Enviar" : o.kind === "pull" ? "← Traer" : "← Respaldo"}</span>{" "}
                    <span className="font-mono">{o.file}</span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span
                      className={
                        o.status === "ok" ? "text-ok" : o.status === "error" ? "text-danger" : o.status === "running" ? "text-accent" : "text-muted"
                      }
                    >
                      {o.status === "ok" ? "● Completado" : o.status === "error" ? `✕ ${o.error ?? "Error"}` : o.status === "running" ? `En curso${o.bytes ? ` · ${fmtBytes(o.bytes)}` : ""}` : "En cola"}
                    </span>
                    <button className="text-muted hover:text-fg" title="Ver salida del equipo" onClick={() => setShowLog(showLog === o.id ? null : o.id)}>
                      <ChevronDown size={14} className={showLog === o.id ? "rotate-180" : ""} />
                    </button>
                  </span>
                </div>
                <div className="h-1 mt-1 rounded-full bg-hover overflow-hidden">
                  <div
                    className={`h-full ${o.status === "error" ? "bg-danger" : "bg-accent"} ${o.status === "running" && pct == null ? "animate-pulse w-1/3" : ""}`}
                    style={pct != null ? { width: `${pct}%` } : undefined}
                  />
                </div>
                {showLog === o.id && (
                  <div className="mt-2">
                    <p className="text-[11px] text-muted mb-1 font-mono">{o.command}</p>
                    <Console lines={o.lines} height={140} empty="Sin salida todavía" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function toggle(set: Set<string>, v: string) {
  const n = new Set(set);
  if (n.has(v)) n.delete(v);
  else n.add(v);
  return n;
}

function Pane({
  icon,
  title,
  actions,
  footer,
  highlight,
  dropProps,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  actions: React.ReactNode;
  footer: string;
  highlight: boolean;
  dropProps: React.HTMLAttributes<HTMLDivElement>;
  children: React.ReactNode;
}) {
  return (
    <div
      {...dropProps}
      className={`min-w-0 flex flex-col rounded-xl border bg-panel ${highlight ? "border-accent ring-2 ring-[var(--selected)]" : "border-line"}`}
    >
      <div className="flex items-center gap-2 px-3 h-10 border-b border-line">
        <span className="text-muted">{icon}</span>
        <span className="text-[12.5px] font-semibold truncate flex-1">{title}</span>
        {actions}
      </div>
      <div className="h-[300px] overflow-y-auto p-1">{children}</div>
      <div className="px-3 h-7 flex items-center border-t border-line text-[11px] text-muted">{footer}</div>
    </div>
  );
}

function Row({
  name,
  detail,
  sub,
  dir,
  selected,
  onToggle,
  onDragStart,
  onDelete,
}: {
  name: string;
  detail: string;
  sub?: string;
  dir?: boolean;
  selected: boolean;
  onToggle: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDelete?: () => void;
}) {
  return (
    <div
      draggable={!dir}
      onDragStart={onDragStart}
      onClick={onToggle}
      title={sub}
      className={`group flex items-center gap-2 px-2 h-8 rounded-md text-[12.5px] ${selected ? "bg-selected" : "hover:bg-hover"}`}
    >
      {dir ? <Folder size={14} className="text-muted shrink-0" /> : <FileText size={14} className="text-muted shrink-0" />}
      <span className="truncate flex-1 font-mono text-[12px]">{name}</span>
      <span className="text-[11px] text-muted tabular-nums shrink-0">{detail}</span>
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="hidden group-hover:block text-muted hover:text-danger"
          title="Eliminar del PC"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="p-4 text-center text-[12px] text-muted">{text}</p>;
}
