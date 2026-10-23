import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Camera, Check, Copy, Download, FileCode2, GitCompare, Network, Pencil, Plus, Radar, Route, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { runOnDevice } from "../../lib/deviceRun";
import {
  ADDRESS_COMMANDS,
  CommandOutput,
  FALLBACK_COMMANDS,
  LIMITS,
  LINK_LEGEND,
  LinkSuggestion,
  NEIGHBOR_COMMANDS,
  Neighbor,
  PortInfo,
  PORT_COMMANDS,
  Pt,
  ROUTING_COMMANDS,
  TOPO_SOURCES,
  TopoLink,
  TopoNode,
  TopoResult,
  TopoSnapshot,
  TopoSources,
  TopoVendor,
  Topology,
  acceptSuggestion,
  addManualLink,
  addManualNode,
  collectSuggestions,
  deleteManualLink,
  deleteManualNode,
  diffTopology,
  isCliError,
  isPhysicalProto,
  isRoutingProto,
  isUserProto,
  junosDetailCommand,
  knownAddrs,
  layout,
  linkDash,
  linkGeometry,
  linkGroup,
  linkKey,
  mergeNeighbors,
  nodeId,
  parseNeighbors,
  parseOwnAddresses,
  parsePortInfo,
  parseRoutingNeighbors,
  pathToText,
  portOf,
  promptName,
  protoLabel,
  shortestPath,
  sourceOn,
  toCsv,
  toDrawio,
  toMermaid,
  toSvg,
  updateManualLink,
  updateManualNode,
} from "../../lib/topology";
import { vendorFor } from "../../lib/commands";
import type { Session } from "../../types";
import type { TerminalRef } from "./FileManager";
import { Btn, Label, Section, Toggle } from "./ui";

const W = 170;
const H = 54;
/** Separación entre enlaces paralelos del mismo par de equipos. */
const PARALLEL_GAP = 26;
/** Máximo de interfaces que se consultan en detalle (Junos) para no saturar la sesión. */
const MAX_DETAIL = 32;
const MAX_SNAPSHOTS = 20;
const VENDORS: { id: TopoVendor; label: string }[] = [
  { id: "cisco", label: "Cisco (CDP + LLDP)" },
  { id: "huawei", label: "Huawei (LLDP)" },
  { id: "juniper", label: "Juniper (LLDP)" },
  { id: "fortinet", label: "Fortinet (LLDP)" },
];
const CONFIDENCE_COLOR = { alta: "var(--ok)", media: "var(--warn)", baja: "var(--muted)" } as const;

type ManualForm =
  | { kind: "node"; editId?: string; name: string; ip: string; platform: string }
  | { kind: "link"; edit?: TopoLink; a: string; aPort: string; b: string; bPort: string };

/** Topología guardada por versiones anteriores en el almacenamiento del navegador. */
function legacyTopo(): Topology | null {
  try {
    const t = JSON.parse(localStorage.getItem("topology") ?? "null") as Topology | null;
    return t?.nodes?.length ? t : null;
  } catch {
    return null;
  }
}

/** Muestra de línea para la leyenda (mismo trazo que el diagrama). */
function LegendLine({ dash }: { dash?: string }) {
  return (
    <svg width="34" height="8" aria-hidden className="shrink-0">
      <line x1="2" y1="4" x2="32" y2="4" stroke="var(--muted)" strokeWidth={2} strokeDasharray={dash} strokeLinecap="round" />
    </svg>
  );
}

export function TopologyTool({
  terminals,
  sessions,
  topo,
  snapshots,
  sources,
  onTopo,
  onSnapshots,
  onSources,
  onOpenSession,
}: {
  terminals: TerminalRef[];
  sessions: Session[];
  topo: Topology;
  snapshots: TopoSnapshot[];
  sources: TopoSources;
  onTopo: (t: Topology | ((t: Topology) => Topology)) => void;
  onSnapshots: (s: TopoSnapshot[]) => void;
  onSources: (s: TopoSources) => void;
  onOpenSession: (s: Session) => void;
}) {
  const [connId, setConnId] = useState("");
  const term = terminals.find((t) => t.connId === connId);
  const [vendor, setVendor] = useState<TopoVendor>("cisco");
  const [readPorts, setReadPorts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [proto, setProto] = useState<"ssh" | "telnet">("ssh");
  const [path, setPath] = useState<{ from?: string; to?: string }>({});
  const [compareId, setCompareId] = useState("");
  const [snapName, setSnapName] = useState<string | null>(null);
  const [form, setForm] = useState<ManualForm | null>(null);
  const [formErr, setFormErr] = useState("");
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const drag = useRef<{ id: string; sx: number; sy: number; x: number; y: number } | null>(null);

  // Migra el diagrama de versiones anteriores (antes vivía en el navegador, fuera de la carpeta de datos).
  useEffect(() => {
    const old = legacyTopo();
    if (old && !topo.nodes.length) onTopo(old);
    if (old) localStorage.removeItem("topology");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Por defecto la sesión más reciente (la que se acaba de abrir al seguir la ruta).
  useEffect(() => {
    if (!term && terminals.length) setConnId(terminals[terminals.length - 1].connId);
  }, [terminals, term]);
  useEffect(() => {
    if (!term) return;
    const v = vendorFor(term.highlight);
    if (VENDORS.some((x) => x.id === v)) setVendor(v as TopoVendor);
  }, [term]);

  /** Ejecuta un comando; si el equipo no lo reconoce, prueba la sintaxis alternativa. */
  const run = async (cmd: string): Promise<string> => {
    setMsg(`Ejecutando: ${cmd}`);
    const out = await runOnDevice(term!.connId, cmd, 60);
    const alt = FALLBACK_COMMANDS[cmd];
    if (alt && isCliError(out)) {
      setMsg(`Ejecutando: ${alt}`);
      return runOnDevice(term!.connId, alt, 60);
    }
    return out;
  };

  const routingOn = sourceOn(sources, "routing");

  const discover = async () => {
    if (!term) return;
    setBusy(true);
    setMsg("");
    try {
      const outputs: string[] = [];
      for (const cmd of NEIGHBOR_COMMANDS[vendor]) outputs.push(await run(cmd));
      // "% CDP is not enabled", "% LLDP is not enabled" o comando inexistente en todos.
      const l2Off = outputs.every(isCliError);
      let neighbors = parseNeighbors(vendor, outputs);
      // Junos: la tabla resumida no trae IP de gestión; se pide el detalle por interfaz.
      if (vendor === "juniper" && neighbors.some((n) => !n.ip)) {
        const ifaces = [...new Set(neighbors.filter((n) => !n.ip).map((n) => n.localPort))].slice(0, MAX_DETAIL);
        for (const iface of ifaces) outputs.push(await run(junosDetailCommand(iface)));
        neighbors = parseNeighbors(vendor, outputs);
      }
      // Vecinos de ruteo: solo con la fuente activa (apagada no se envía ningún comando).
      let routing: Neighbor[] = [];
      let addrs: string[] | undefined;
      if (routingOn && ROUTING_COMMANDS[vendor].length) {
        const results: CommandOutput[] = [];
        for (const cmd of ROUTING_COMMANDS[vendor]) results.push({ cmd, out: await run(cmd) });
        const r = parseRoutingNeighbors(results);
        routing = r.neighbors;
        addrs = r.selfAddrs;
        outputs.push(...results.map((x) => x.out));
        // Direcciones propias: para reconocer este equipo cuando otro lo reporta por IP.
        const addrCmd = ADDRESS_COMMANDS[vendor];
        if (addrCmd && (routing.length || topo.nodes.some((n) => n.addrOnly))) {
          const out = await run(addrCmd);
          addrs = [...addrs, ...parseOwnAddresses([out])];
          outputs.push(out);
        }
      }
      let ports: Record<string, PortInfo> | undefined;
      if (readPorts && PORT_COMMANDS[vendor].length) {
        const portOuts: string[] = [];
        for (const cmd of PORT_COMMANDS[vendor]) portOuts.push(await run(cmd));
        ports = parsePortInfo(portOuts);
        outputs.push(...portOuts);
      }
      const last = [...outputs].reverse().find((o) => o.trim()) ?? "";
      const name = promptName(last) ?? term.name;
      onTopo((t) => mergeNeighbors(t, { name, ip: term.host, ports, addrs }, [...neighbors, ...routing]));
      setSelected(nodeId(name));
      const parts = [
        `${neighbors.length} vecinos CDP/LLDP`,
        routingOn && ROUTING_COMMANDS[vendor].length ? `${routing.length} de ruteo` : "",
      ].filter(Boolean);
      const l2Hint =
        vendor === "fortinet"
          ? "Habilita la recepción LLDP (set lldp-reception enable) en la interfaz."
          : l2Off
            ? "CDP/LLDP no está habilitado en el equipo."
            : "";
      const routingHint =
        !neighbors.length && !routing.length && !routingOn && ROUTING_COMMANDS[vendor].length
          ? 'Activa "Vecinos de ruteo" en Fuentes de descubrimiento o agrega los enlaces a mano.'
          : "";
      setMsg([`${name}: ${parts.join(", ")}.`, neighbors.length ? "" : l2Hint, routingHint].filter(Boolean).join(" "));
    } catch (e) {
      setMsg(String(e));
    }
    setBusy(false);
  };

  const node = (id: string) => topo.nodes.find((n) => n.id === id);
  const sel = selected ? node(selected) : undefined;

  // Comparación con un snapshot: los enlaces y equipos que ya no están se dibujan fantasma.
  const snapshot = snapshots.find((s) => s.id === compareId);
  const diff = useMemo(() => (snapshot ? diffTopology(snapshot.topo, topo) : null), [snapshot, topo]);
  const view: Topology = useMemo(() => {
    if (!diff || !snapshot) return topo;
    // Los equipos que ya no están usan la posición del snapshot; si quedan encima de uno
    // actual se corren a la derecha para que ambos se lean.
    const placed = [...topo.nodes];
    const ghosts = diff.removedNodes.map((n) => {
      const g = { ...n, explored: false };
      while (placed.some((o) => Math.abs(o.x - g.x) < W + 10 && Math.abs(o.y - g.y) < H + 10)) g.x += W + 30;
      placed.push(g);
      return g;
    });
    return { nodes: [...topo.nodes, ...ghosts], links: [...topo.links, ...diff.removedLinks] };
  }, [diff, snapshot, topo]);
  const added = useMemo(() => new Set(diff?.addedLinks.map(linkKey)), [diff]);
  const removed = useMemo(() => new Set(diff?.removedLinks.map(linkKey)), [diff]);
  const ghostIds = useMemo(() => new Set(diff?.removedNodes.map((n) => n.id)), [diff]);
  const newIds = useMemo(() => new Set(diff?.addedNodes), [diff]);

  const route = useMemo(
    () => (path.from && path.to ? shortestPath(topo, path.from, path.to) : null),
    [path, topo],
  );
  const routeKeys = useMemo(() => new Set(route?.links.map(linkKey)), [route]);
  const routeNodes = useMemo(() => new Set(route?.nodes), [route]);

  const geometry = useMemo(() => linkGeometry(view, view.links, PARALLEL_GAP), [view]);

  // Sugerencias: se calculan del diagrama ya leído, sin comandos, y solo con su fuente activa.
  const suggestions = useMemo(() => collectSuggestions(topo, sources, dismissed), [topo, sources, dismissed]);
  const suggestionSources = TOPO_SOURCES.filter((s) => s.kind === "suggestions" && sourceOn(sources, s.id));

  const box = useMemo(() => {
    if (!view.nodes.length) return { x: 0, y: 0, w: 800, h: 400 };
    const xs = view.nodes.map((n) => n.x);
    const ys = view.nodes.map((n) => n.y);
    const pad = 30;
    const x = Math.min(...xs) - W / 2 - pad;
    const y = Math.min(...ys) - H / 2 - pad;
    return { x, y, w: Math.max(...xs) - x + W / 2 + pad, h: Math.max(...ys) - y + H / 2 + pad };
  }, [view.nodes]);

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const svg = e.currentTarget.getBoundingClientRect();
    // El SVG se ajusta al contenedor manteniendo proporción: manda el eje más ajustado.
    const scale = Math.max(box.w / svg.width, box.h / svg.height);
    const x = d.x + (e.clientX - d.sx) * scale;
    const y = d.y + (e.clientY - d.sy) * scale;
    onTopo((t) => ({ ...t, nodes: t.nodes.map((n) => (n.id === d.id ? { ...n, x, y } : n)) }));
  };

  const exportFile = async (ext: "svg" | "csv" | "drawio", content: string) => {
    const name = ext === "drawio" ? "draw.io" : ext.toUpperCase();
    const dest = await save({ defaultPath: `topologia.${ext}`, filters: [{ name, extensions: [ext] }] });
    if (!dest) return;
    await invoke("save_text", { dest, content }).then(() => setMsg(`Guardado: ${dest}`)).catch((e) => setMsg(String(e)));
  };

  /** Sesión guardada que corresponde al equipo (misma IP o mismo nombre). */
  const savedFor = (n: TopoNode) =>
    sessions.find((s) => (s.type === "ssh" || s.type === "telnet") && ((n.ip && s.host === n.ip) || nodeId(s.name) === n.id));

  const follow = (n: TopoNode) => {
    const saved = savedFor(n);
    if (saved) {
      onOpenSession(saved);
      setMsg(`Abriendo la sesión guardada "${saved.name}": autentícate, vuelve aquí y pulsa "Descubrir vecinos".`);
      return;
    }
    if (!term || !n.ip) return;
    const base = term.session;
    onOpenSession({
      ...base,
      id: "",
      name: n.name,
      type: proto,
      host: n.ip,
      port: proto === base.type ? base.port : proto === "ssh" ? 22 : 23,
      platform: undefined,
      on_connect: base.on_connect,
      scp: undefined,
      created_at: new Date().toISOString(),
    });
    setMsg(`Abriendo ${proto.toUpperCase()} a ${n.name}: autentícate en su pestaña, vuelve aquí y pulsa "Descubrir vecinos".`);
  };

  const saveSnapshot = () => {
    const name = snapName?.trim() || `Topología ${new Date().toLocaleString()}`;
    const snap: TopoSnapshot = { id: `s${Date.now()}`, name, ts: Date.now(), topo };
    onSnapshots([snap, ...snapshots].slice(0, MAX_SNAPSHOTS));
    setSnapName(null);
    setMsg(`Snapshot guardado: ${name}`);
  };

  const portLine = (n: TopoNode | undefined, port: string) => {
    const p = port ? portOf(n, port) : undefined;
    return p ? [p.status, p.speed, p.group, p.desc].filter(Boolean).join(" · ") : "";
  };

  /** Aplica una edición manual: si falla, muestra el error en el formulario o en el mensaje. */
  const apply = (r: TopoResult, ok: string, onDone?: () => void) => {
    if (!r.topo) {
      if (form) setFormErr(r.error);
      else setMsg(r.error);
      return false;
    }
    onTopo(r.topo);
    setMsg(ok);
    setFormErr("");
    onDone?.();
    return true;
  };

  const submitForm = () => {
    if (!form) return;
    if (form.kind === "node") {
      const input = { name: form.name, ip: form.ip, platform: form.platform };
      const r = form.editId ? updateManualNode(topo, form.editId, input) : addManualNode(topo, input);
      apply(r, form.editId ? "Equipo actualizado" : `Equipo "${form.name.trim()}" agregado`, () => {
        setForm(null);
        setSelected(nodeId(form.name));
      });
    } else {
      const input = { a: form.a, aPort: form.aPort, b: form.b, bPort: form.bPort };
      const r = form.edit ? updateManualLink(topo, form.edit, input) : addManualLink(topo, input);
      apply(r, form.edit ? "Enlace actualizado" : "Enlace manual agregado", () => setForm(null));
    }
  };

  const accept = (s: LinkSuggestion) => apply(acceptSuggestion(topo, s), `Enlace confirmado: ${node(s.a)?.name ?? s.a} ${s.aPort} ↔ ${s.target}`);

  const pathText = route ? pathToText(topo, route) : "";
  const nodesByName = useMemo(() => [...topo.nodes].sort((a, b) => a.name.localeCompare(b.name)), [topo.nodes]);
  const nodeSub = (n: TopoNode, ghost: boolean) =>
    ghost
      ? "ya no aparece"
      : n.ip && n.ip !== n.name
        ? n.ip
        : n.addrOnly
          ? "visto por ruteo"
          : n.manual
            ? "manual"
            : n.explored
              ? "explorado"
              : "sin IP de gestión";

  return (
    <div className="space-y-4">
      <Section
        title="Topología"
        hint="Descubre los vecinos del equipo conectado y sigue la ruta salto a salto: clic en un vecino y 'Conectar'. Solo usa comandos de consulta."
      >
        <div className="flex flex-wrap items-end gap-2">
          <Label text="Equipo (sesión conectada)" className="flex-1 min-w-48">
            <select className="field" value={connId} onChange={(e) => setConnId(e.target.value)}>
              {!terminals.length && <option value="">Sin sesiones conectadas</option>}
              {terminals.map((t) => (
                <option key={t.connId} value={t.connId}>
                  {t.name}
                  {t.host ? ` · ${t.host}` : ""}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Fabricante" className="w-40">
            <select className="field" value={vendor} onChange={(e) => setVendor(e.target.value as TopoVendor)}>
              {VENDORS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </Label>
          <label className="flex items-center gap-1.5 h-8 text-[12px]" title="Lee estado, velocidad, descripción y Port-channel de las interfaces (comandos de consulta)">
            <input type="checkbox" className="accent-[var(--accent)]" checked={readPorts} onChange={(e) => setReadPorts(e.target.checked)} />
            Estado de puertos
          </label>
          <Btn kind="primary" disabled={!term || busy} onClick={discover}>
            <Radar size={14} className={busy ? "animate-pulse" : ""} /> {busy ? "Leyendo…" : "Descubrir vecinos"}
          </Btn>
        </div>
        <div className="flex flex-wrap items-center gap-1 mt-3">
          <Btn kind="ghost" title="Acercar" onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))}>
            <ZoomIn size={14} />
          </Btn>
          <Btn kind="ghost" title="Alejar" onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))}>
            <ZoomOut size={14} />
          </Btn>
          <Btn kind="ghost" title="Reordenar automáticamente" onClick={() => onTopo((t) => layout({ ...t, nodes: t.nodes.map((n) => ({ ...n, x: 0, y: 0 })) }))}>
            <Network size={14} />
          </Btn>
          <span className="w-px h-5 bg-[var(--border)] mx-1" />
          <Btn kind="ghost" title="Exportar imagen SVG" disabled={!topo.nodes.length} onClick={() => exportFile("svg", toSvg(topo, W, H))}>
            <Download size={14} /> SVG
          </Btn>
          <Btn kind="ghost" title="Exportar a draw.io (editable)" disabled={!topo.nodes.length} onClick={() => exportFile("drawio", toDrawio(topo, W, H))}>
            draw.io
          </Btn>
          <Btn kind="ghost" title="Exportar tabla de enlaces con estado de puertos" disabled={!topo.links.length} onClick={() => exportFile("csv", toCsv(topo))}>
            CSV
          </Btn>
          <Btn
            kind="ghost"
            title="Copiar como Mermaid (Confluence, GitLab, GitHub)"
            disabled={!topo.nodes.length}
            onClick={() => writeText(toMermaid(topo)).then(() => setMsg("Diagrama Mermaid copiado al portapapeles"))}
          >
            <FileCode2 size={14} /> Mermaid
          </Btn>
          <span className="w-px h-5 bg-[var(--border)] mx-1" />
          {snapName === null ? (
            <Btn kind="ghost" title="Guardar una copia para comparar más adelante" disabled={!topo.nodes.length} onClick={() => setSnapName("")}>
              <Camera size={14} /> Snapshot
            </Btn>
          ) : (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                saveSnapshot();
              }}
            >
              <input
                autoFocus
                className="field !h-7 w-48 !text-[12px]"
                placeholder="Nombre (ej: antes del cambio)"
                value={snapName}
                onChange={(e) => setSnapName(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setSnapName(null)}
              />
              <Btn kind="primary" type="submit" className="!h-7">
                Guardar
              </Btn>
            </form>
          )}
          <label className="flex items-center gap-1 text-[12px]" title="Compara el diagrama actual con un snapshot">
            <GitCompare size={14} className="text-muted" />
            <select className="field !h-7 !w-52 !text-[12px]" value={compareId} onChange={(e) => setCompareId(e.target.value)} disabled={!snapshots.length}>
              <option value="">{snapshots.length ? "Comparar con…" : "Sin snapshots"}</option>
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {snapshot && (
            <>
              <Btn
                kind="ghost"
                title="Reemplazar el diagrama actual por este snapshot"
                onClick={() => {
                  onTopo(snapshot.topo);
                  setCompareId("");
                  setMsg(`Snapshot "${snapshot.name}" abierto`);
                }}
              >
                Abrir
              </Btn>
              <Btn
                kind="ghost"
                className="hover:!text-danger"
                title="Eliminar snapshot"
                onClick={() => {
                  onSnapshots(snapshots.filter((s) => s.id !== snapshot.id));
                  setCompareId("");
                }}
              >
                <X size={14} />
              </Btn>
            </>
          )}
          <Btn
            kind="ghost"
            className="hover:!text-danger ml-auto"
            title="Borrar diagrama"
            disabled={!topo.nodes.length}
            onClick={() => {
              onTopo({ nodes: [], links: [] });
              setSelected(null);
              setPath({});
            }}
          >
            <Trash2 size={14} />
          </Btn>
        </div>
        {msg && <p className="mt-2 text-[12px] text-accent">{msg}</p>}
      </Section>

      <div className="grid gap-4 [grid-template-columns:1fr_280px]">
        <div className="space-y-2 min-w-0">
          <div className="rounded-xl border border-line bg-panel overflow-auto" style={{ height: 520 }}>
            {!view.nodes.length ? (
              <div className="h-full grid place-items-center text-[12.5px] text-muted p-6 text-center">
                Conecta una sesión con un equipo y pulsa "Descubrir vecinos", o agrega equipos y enlaces a mano.
              </div>
            ) : (
              <svg
                viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
                style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
                onPointerMove={onPointerMove}
                onPointerUp={() => (drag.current = null)}
                onPointerLeave={() => (drag.current = null)}
              >
                {geometry.map((g, i) => {
                  const k = linkKey(g.l);
                  const isRoute = routeKeys.has(k);
                  const state = removed.has(k) ? "removed" : added.has(k) ? "added" : null;
                  const hot = isRoute || selected === g.l.a || selected === g.l.b;
                  const color = state === "removed" ? "var(--danger)" : state === "added" ? "var(--ok)" : hot ? "var(--accent)" : "var(--muted)";
                  const dim = route && !isRoute;
                  const tip = [
                    `${node(g.l.a)?.name ?? g.l.a} ${g.l.aPort || "?"} ↔ ${g.l.bPort || "?"} ${node(g.l.b)?.name ?? g.l.b} (${protoLabel(g.l)})`,
                    portLine(node(g.l.a), g.l.aPort) && `${g.l.aPort}: ${portLine(node(g.l.a), g.l.aPort)}`,
                    portLine(node(g.l.b), g.l.bPort) && `${g.l.bPort}: ${portLine(node(g.l.b), g.l.bPort)}`,
                    g.l.logical ? "Sesión lógica: no es un enlace físico" : "",
                    state === "removed" ? "Ya no aparece (respecto del snapshot)" : state === "added" ? "Nuevo (respecto del snapshot)" : "",
                  ]
                    .filter(Boolean)
                    .join("\n");
                  const grp = linkGroup(view, g.l);
                  const showGroup = grp && g.pair.length > 1 && g.pair.indexOf(g.l) === 0;
                  const dash = state === "removed" ? "6 5" : linkDash(g.l);
                  return (
                    <g key={i} opacity={dim ? 0.25 : 1}>
                      <title>{tip}</title>
                      <path
                        d={g.d}
                        fill="none"
                        stroke={color}
                        strokeWidth={isRoute ? 3.5 : hot || state ? 2.5 : g.l.logical ? 1.25 : 1.5}
                        strokeDasharray={dash}
                        strokeLinecap={dash ? "round" : undefined}
                      />
                      {/* Área de clic más ancha que la línea. */}
                      <path d={g.d} fill="none" stroke="transparent" strokeWidth={12} />
                      {[
                        [g.pa, g.l.aPort],
                        [g.pb, g.l.bPort],
                      ]
                        .filter(([, label]) => label)
                        .map(([pt, label], j) => (
                          <text
                            key={j}
                            x={(pt as Pt).x}
                            y={(pt as Pt).y}
                            fontSize={11}
                            textAnchor="middle"
                            fill="var(--text)"
                            stroke="var(--panel)"
                            strokeWidth={4}
                            paintOrder="stroke"
                          >
                            {label as string}
                          </text>
                        ))}
                      {showGroup ? (
                        <text x={g.mid.x} y={g.mid.y + 4} fontSize={11} fontWeight={600} textAnchor="middle" fill="var(--accent)" stroke="var(--panel)" strokeWidth={4} paintOrder="stroke">
                          {grp} ×{g.pair.length}
                        </text>
                      ) : (
                        isRoutingProto(g.l.proto) && (
                          <text x={g.mid.x} y={g.mid.y + 4} fontSize={10} fontWeight={600} textAnchor="middle" fill="var(--muted)" stroke="var(--panel)" strokeWidth={4} paintOrder="stroke">
                            {protoLabel(g.l)}
                          </text>
                        )
                      )}
                    </g>
                  );
                })}
                {view.nodes.map((n) => {
                  const ghost = ghostIds.has(n.id);
                  const isNew = newIds.has(n.id);
                  const onRoute = routeNodes.has(n.id);
                  const tentative = n.manual || n.addrOnly;
                  return (
                    <g
                      key={n.id}
                      style={{ cursor: ghost ? "default" : "grab" }}
                      opacity={route && !onRoute && !ghost ? 0.35 : 1}
                      onPointerDown={(e) => {
                        if (ghost) return;
                        (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId);
                        drag.current = { id: n.id, sx: e.clientX, sy: e.clientY, x: n.x, y: n.y };
                        setSelected(n.id);
                      }}
                    >
                      {/* Fondo opaco: el relleno de los explorados es translúcido y dejaba ver los enlaces. */}
                      <rect x={n.x - W / 2} y={n.y - H / 2} width={W} height={H} rx={10} fill="var(--panel)" />
                      <rect
                        x={n.x - W / 2}
                        y={n.y - H / 2}
                        width={W}
                        height={H}
                        rx={10}
                        fill={n.explored ? "var(--selected)" : "var(--chrome)"}
                        stroke={
                          ghost ? "var(--danger)" : isNew ? "var(--ok)" : selected === n.id || onRoute ? "var(--accent)" : n.explored ? "var(--accent)" : "var(--field-border)"
                        }
                        strokeDasharray={ghost ? "5 4" : tentative ? "4 3" : undefined}
                        strokeWidth={selected === n.id || onRoute || ghost || isNew ? 2.5 : 1.5}
                      />
                      <text x={n.x} y={n.y - 4} fontSize={13} fontWeight={600} textAnchor="middle" fill="var(--text)">
                        {n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name}
                      </text>
                      <text x={n.x} y={n.y + 14} fontSize={11} textAnchor="middle" fill="var(--muted)">
                        {nodeSub(n, ghost)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
          {!!view.nodes.length && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11.5px] text-muted" aria-label="Leyenda de enlaces">
              {LINK_LEGEND.map(([text, s]) => (
                <span key={text} className="inline-flex items-center gap-1.5">
                  <LegendLine dash={linkDash(s)} />
                  {text}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <svg width="22" height="12" aria-hidden className="shrink-0">
                  <rect x="1" y="1" width="20" height="10" rx="3" fill="var(--chrome)" stroke="var(--field-border)" strokeDasharray="4 3" />
                </svg>
                Equipo manual o visto solo por ruteo
              </span>
            </div>
          )}
        </div>

        <div className="space-y-4 min-w-0">
          <Section title="Fuentes de descubrimiento" hint="CDP/LLDP y lo manual, siempre activos">
            <div className="space-y-2.5">
              {TOPO_SOURCES.map((s) => (
                <div key={s.id}>
                  <Toggle checked={sourceOn(sources, s.id)} onChange={(v) => onSources({ ...sources, [s.id]: v })} label={s.label} />
                  <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">{s.hint}</p>
                </div>
              ))}
            </div>
          </Section>

          {suggestionSources.length > 0 && (
            <Section title="Sugerencias" hint={suggestions.length ? "Confirma cada una antes de dibujarla" : "Sin sugerencias por ahora"}>
              {suggestions.length ? (
                <ul className="space-y-2 max-h-56 overflow-y-auto">
                  {suggestions.map((s) => (
                    <li key={s.id} className="rounded-md border border-line px-2 py-1.5 text-[11.5px]">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono flex-1 min-w-0 [overflow-wrap:anywhere]" title={`${node(s.a)?.name ?? s.a} ${s.aPort} → ${s.target} ${s.bPort}`}>
                          <span className="whitespace-nowrap">
                            {node(s.a)?.name ?? s.a} {s.aPort}
                          </span>{" "}
                          <span className="whitespace-nowrap">
                            → {s.target} {s.bPort}
                          </span>
                        </span>
                        <span className="text-[10.5px] font-medium shrink-0" style={{ color: CONFIDENCE_COLOR[s.confidence] }} title={`Confianza ${s.confidence}`}>
                          {s.confidence}
                        </span>
                      </div>
                      <p className="text-muted truncate" title={s.reason}>
                        {TOPO_SOURCES.find((x) => x.id === s.source)?.short ?? s.source}: "{s.reason}"
                      </p>
                      <div className="flex gap-1 mt-1">
                        <Btn kind="primary" className="!h-6 !px-2 !text-[11px]" onClick={() => accept(s)}>
                          <Check size={12} /> Confirmar
                        </Btn>
                        <Btn kind="ghost" className="!h-6 !px-2 !text-[11px]" onClick={() => setDismissed((d) => new Set([...d, s.id]))}>
                          Descartar
                        </Btn>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-muted">
                  {topo.nodes.some((n) => n.ports && Object.keys(n.ports).length)
                    ? "Ninguna descripción menciona un equipo sin enlace."
                    : 'Descubre con "Estado de puertos" para leer las descripciones.'}
                </p>
              )}
            </Section>
          )}

          <Section
            title="Manual"
            right={
              !form && (
                <div className="flex gap-1">
                  <Btn kind="ghost" className="!px-1.5 !text-[11.5px]" title="Agregar equipo" onClick={() => (setFormErr(""), setForm({ kind: "node", name: "", ip: "", platform: "" }))}>
                    <Plus size={13} /> Equipo
                  </Btn>
                  <Btn
                    kind="ghost"
                    className="!px-1.5 !text-[11.5px]"
                    title="Agregar enlace"
                    disabled={topo.nodes.length < 2}
                    onClick={() => (setFormErr(""), setForm({ kind: "link", a: selected ?? "", aPort: "", b: "", bPort: "" }))}
                  >
                    <Plus size={13} /> Enlace
                  </Btn>
                </div>
              )
            }
          >
            {form?.kind === "node" && (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitForm();
                }}
              >
                <Label text="Nombre">
                  <input autoFocus className="field" maxLength={LIMITS.name} value={form.name} placeholder="ej: sw-bodega-01" onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </Label>
                <Label text="IP de gestión (opcional)">
                  <input className="field font-mono" maxLength={45} value={form.ip} placeholder="192.0.2.10" onChange={(e) => setForm({ ...form, ip: e.target.value })} />
                </Label>
                <Label text="Plataforma (opcional)">
                  <input className="field" maxLength={LIMITS.platform} value={form.platform} placeholder="ej: C9200L-24P" onChange={(e) => setForm({ ...form, platform: e.target.value })} />
                </Label>
                {formErr && <p className="text-[11.5px] text-danger">{formErr}</p>}
                <div className="flex gap-1.5">
                  <Btn kind="primary" type="submit" className="flex-1">
                    {form.editId ? "Guardar" : "Agregar equipo"}
                  </Btn>
                  <Btn type="button" onClick={() => setForm(null)}>
                    Cancelar
                  </Btn>
                </div>
              </form>
            )}
            {form?.kind === "link" && (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitForm();
                }}
              >
                {(["a", "b"] as const).map((side) => (
                  <div key={side} className="grid grid-cols-[1fr_92px] gap-1.5">
                    <Label text={`Equipo ${side.toUpperCase()}`}>
                      <select className="field" value={form[side]} onChange={(e) => setForm({ ...form, [side]: e.target.value })}>
                        <option value="">Elegir…</option>
                        {nodesByName.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.name}
                          </option>
                        ))}
                      </select>
                    </Label>
                    <Label text="Interfaz">
                      <input
                        className="field font-mono"
                        maxLength={LIMITS.port}
                        value={side === "a" ? form.aPort : form.bPort}
                        placeholder="Gi1/0/1"
                        onChange={(e) => setForm({ ...form, [side === "a" ? "aPort" : "bPort"]: e.target.value })}
                      />
                    </Label>
                  </div>
                ))}
                {formErr && <p className="text-[11.5px] text-danger">{formErr}</p>}
                <div className="flex gap-1.5">
                  <Btn kind="primary" type="submit" className="flex-1">
                    {form.edit ? "Guardar" : "Agregar enlace"}
                  </Btn>
                  <Btn type="button" onClick={() => setForm(null)}>
                    Cancelar
                  </Btn>
                </div>
              </form>
            )}
            {!form && <p className="text-[12px] text-muted">Se guardan con el diagrama, entran en snapshots, rutas y exportaciones.</p>}
          </Section>

          {diff && snapshot && (
            <Section title="Cambios" hint={`Respecto de "${snapshot.name}"`}>
              {!diff.addedLinks.length && !diff.removedLinks.length && !diff.addedNodes.length && !diff.removedNodes.length ? (
                <p className="text-[12px] text-muted">Sin diferencias.</p>
              ) : (
                <ul className="space-y-1 text-[11.5px] font-mono">
                  {diff.removedNodes.map((n) => (
                    <li key={`rn${n.id}`} className="text-danger">
                      − {n.name}
                    </li>
                  ))}
                  {diff.addedNodes.map((id) => (
                    <li key={`an${id}`} className="text-ok">
                      + {node(id)?.name ?? id}
                    </li>
                  ))}
                  {diff.removedLinks.map((l, i) => (
                    <li key={`rl${i}`} className="text-danger">
                      − {l.a} {l.aPort} ↔ {l.bPort} {l.b}
                    </li>
                  ))}
                  {diff.addedLinks.map((l, i) => (
                    <li key={`al${i}`} className="text-ok">
                      + {l.a} {l.aPort} ↔ {l.bPort} {l.b}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {(path.from || path.to) && (
            <Section
              title="Ruta"
              hint={`${path.from ? (node(path.from)?.name ?? path.from) : "?"} → ${path.to ? (node(path.to)?.name ?? path.to) : "elige destino"}`}
              right={
                <div className="flex gap-1">
                  {route && (
                    <Btn kind="ghost" className="!px-1.5" title="Copiar ruta" onClick={() => writeText(pathText).then(() => setMsg("Ruta copiada"))}>
                      <Copy size={13} />
                    </Btn>
                  )}
                  <Btn kind="ghost" className="!px-1.5" title="Quitar ruta" onClick={() => setPath({})}>
                    <X size={13} />
                  </Btn>
                </div>
              }
            >
              {path.from && path.to ? (
                route ? (
                  <pre className="text-[11.5px] font-mono whitespace-pre-wrap leading-relaxed">
                    {pathText}
                    {"\n"}
                    <span className="text-muted">{route.links.length} saltos</span>
                  </pre>
                ) : (
                  <p className="text-[12px] text-danger">No hay camino conocido entre ambos equipos.</p>
                )
              ) : (
                <p className="text-[12px] text-muted">Selecciona otro equipo y pulsa "Hasta aquí".</p>
              )}
            </Section>
          )}

          <Section
            title={sel ? sel.name : "Detalle"}
            hint={sel ? (sel.manual ? "Agregado a mano" : sel.addrOnly ? "Visto por ruteo, aún sin nombre" : sel.explored ? "Vecinos ya leídos" : "Aún no explorado") : "Selecciona un equipo"}
            right={
              sel?.manual && (
                <div className="flex gap-1">
                  <Btn
                    kind="ghost"
                    className="!px-1.5"
                    title="Editar equipo"
                    onClick={() => (setFormErr(""), setForm({ kind: "node", editId: sel.id, name: sel.name, ip: sel.ip ?? "", platform: sel.platform ?? "" }))}
                  >
                    <Pencil size={13} />
                  </Btn>
                  <Btn
                    kind="ghost"
                    className="!px-1.5 hover:!text-danger"
                    title="Eliminar equipo y sus enlaces"
                    onClick={() => apply(deleteManualNode(topo, sel.id), `Equipo "${sel.name}" eliminado`, () => setSelected(null))}
                  >
                    <Trash2 size={13} />
                  </Btn>
                </div>
              )
            }
          >
            {sel && (
              <div className="space-y-2 text-[12px]">
                {sel.ip && (
                  <p>
                    <span className="text-muted">{sel.addrOnly ? "Dirección:" : "Gestión:"}</span> <span className="font-mono">{sel.ip}</span>
                  </p>
                )}
                {sel.addrOnly && knownAddrs(sel).length > 1 && (
                  <p className="text-muted">
                    Conocido por: <span className="font-mono">{knownAddrs(sel).slice(0, 6).join(", ")}</span>
                  </p>
                )}
                {sel.platform && (
                  <p className="text-muted leading-snug" title={sel.platform}>
                    {sel.platform.length > 120 ? `${sel.platform.slice(0, 119)}…` : sel.platform}
                  </p>
                )}
                <div className="space-y-1 max-h-56 overflow-y-auto">
                  {topo.links
                    .filter((l) => l.a === sel.id || l.b === sel.id)
                    .map((l, i) => {
                      const mine = l.a === sel.id;
                      const other = node(mine ? l.b : l.a);
                      const myPort = mine ? l.aPort : l.bPort;
                      const info = portLine(sel, myPort);
                      const editable = isUserProto(l.proto);
                      return (
                        <div key={i} className="flex items-start rounded-md hover:bg-hover">
                          <button onClick={() => setSelected(other?.id ?? null)} className="flex-1 min-w-0 text-left px-2 py-1">
                            <span className="font-mono text-[11.5px]">
                              {myPort || "?"} → {other?.name} {(mine ? l.bPort : l.aPort) || ""}
                            </span>
                            {!isPhysicalProto(l.proto) && <span className="ml-1.5 text-[10.5px] text-muted">{protoLabel(l)}</span>}
                            {info && <span className="block text-[11px] text-muted truncate">{info}</span>}
                          </button>
                          {editable && (
                            <>
                              <Btn
                                kind="ghost"
                                className="!h-6 !px-1"
                                title="Editar enlace"
                                onClick={() => (setFormErr(""), setForm({ kind: "link", edit: l, a: l.a, aPort: l.aPort, b: l.b, bPort: l.bPort }))}
                              >
                                <Pencil size={12} />
                              </Btn>
                              <Btn kind="ghost" className="!h-6 !px-1 hover:!text-danger" title="Eliminar enlace" onClick={() => apply(deleteManualLink(topo, l), "Enlace eliminado")}>
                                <X size={12} />
                              </Btn>
                            </>
                          )}
                        </div>
                      );
                    })}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <Btn className="!text-[11.5px]" onClick={() => setPath({ from: sel.id, to: path.to !== sel.id ? path.to : undefined })}>
                    <Route size={13} /> Desde aquí
                  </Btn>
                  <Btn className="!text-[11.5px]" disabled={!path.from || path.from === sel.id} onClick={() => setPath({ ...path, to: sel.id })}>
                    Hasta aquí
                  </Btn>
                </div>
                {!sel.explored &&
                  (() => {
                    const saved = savedFor(sel);
                    return (
                      <div className="space-y-1.5">
                        {!saved && sel.ip && (
                          <div className="flex items-center gap-2">
                            <span className="text-muted">Protocolo</span>
                            <select className="field !h-7 !text-[12px]" value={proto} onChange={(e) => setProto(e.target.value as "ssh" | "telnet")}>
                              <option value="ssh">SSH</option>
                              <option value="telnet">Telnet</option>
                            </select>
                          </div>
                        )}
                        <Btn
                          kind="primary"
                          className="w-full"
                          disabled={!saved && (!sel.ip || !term)}
                          onClick={() => follow(sel)}
                          title={saved ? `Usa la sesión guardada "${saved.name}"` : sel.ip ? `${proto.toUpperCase()} a ${sel.ip}` : "El vecino no informó IP de gestión"}
                        >
                          {saved ? `Conectar con "${saved.name}"` : "Conectar y seguir la ruta"}
                        </Btn>
                      </div>
                    );
                  })()}
                {sel.ip && (
                  <Btn className="w-full" onClick={() => writeText(sel.ip!)}>
                    Copiar IP
                  </Btn>
                )}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
