import { useEffect, useId, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Activity,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileCode2,
  GitCompare,
  Lightbulb,
  Maximize2,
  Network,
  PanelRight,
  PanelRightClose,
  Pencil,
  Plus,
  Radar,
  Route,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { runOnDevice } from "../../lib/deviceRun";
import {
  ADDRESS_COMMANDS,
  CommandOutput,
  FALLBACK_COMMANDS,
  LIMITS,
  LINK_LEGEND,
  LinkSuggestion,
  LinkTraffic,
  MAC_COMMANDS,
  MacPort,
  NEIGHBOR_COMMANDS,
  Neighbor,
  PortInfo,
  PORT_COMMANDS,
  Pt,
  ROUTING_COMMANDS,
  SUGGESTERS,
  TOPO_SOURCES,
  TopoLink,
  TopoNode,
  TopoResult,
  TopoSnapshot,
  TopoSources,
  TopoVendor,
  Topology,
  UTIL_LEGEND,
  UtilLevel,
  acceptSuggestion,
  addManualLink,
  addManualNode,
  buildMacPorts,
  collectSuggestions,
  deleteManualLink,
  deleteManualNode,
  diffTopology,
  fmtBps,
  isCliError,
  isIpv4,
  isIpv6,
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
  macPortLinked,
  macPortsFromRows,
  macVendors,
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
  trafficLabel,
  updateManualLink,
  updateManualNode,
  utilLevel,
} from "../../lib/topology";
import { ARP_FALLBACK, TopoRead, needsArpFallback, parseSnmpDiscovery, snmpDiscoveryPlan } from "../../lib/topoSnmp";
import { linkTraffic } from "../../lib/topoTraffic";
import { SnmpProfile, targetParams } from "../../lib/snmp";
import { TRAFFIC_INTERVALS, TrafficInterval, useTopoTraffic } from "./useTopoTraffic";
import { vendorFor } from "../../lib/commands";
import type { Session } from "../../types";
import type { TerminalRef } from "./FileManager";
import { Btn, Collapsible, CountBadge, Label, Toggle } from "./ui";
import { ContextMenu } from "../Sidebar";
import type { MenuItem } from "../tabMenu";

type Menu = { x: number; y: number; items: MenuItem[] };

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

/** Secciones del panel lateral. */
type PanelSection = "fuentes" | "trafico" | "sugerencias" | "detalle" | "ruta" | "manual" | "snapshots" | "leyenda";
type DiscoveryMode = "cli" | "snmp";
/**
 * Estado visual de la herramienta (panel, secciones, modo de descubrimiento, intervalo y animación
 * del tráfico). Es comodidad de interfaz: no va a Ajustes. El tráfico y la lectura por consola no se
 * recuerdan: parten apagados en cada apertura.
 */
interface TopoUi {
  panel: boolean;
  sec: Partial<Record<PanelSection, boolean>>;
  mode: DiscoveryMode;
  snmpProfile: string;
  interval: TrafficInterval;
  anim: boolean;
  /** Puntas de flecha por sentido sobre cada enlace con tráfico. */
  arrows: boolean;
  /** Etiqueta de tasas (↑ ↓ y %) junto a cada enlace con tráfico. */
  rates: boolean;
}
const UI_KEY = "topoUi";
const UI_DEFAULT: TopoUi = {
  panel: true,
  sec: { fuentes: false, trafico: false, sugerencias: false, detalle: true, ruta: true, manual: false, snapshots: false, leyenda: false },
  mode: "cli",
  snmpProfile: "",
  interval: 30,
  anim: false,
  arrows: true,
  rates: true,
};

function loadUi(): TopoUi {
  try {
    const v = JSON.parse(localStorage.getItem(UI_KEY) ?? "null") as Partial<TopoUi> | null;
    if (!v || typeof v !== "object") return UI_DEFAULT;
    const sec = v.sec && typeof v.sec === "object" ? v.sec : {};
    return {
      panel: v.panel !== false,
      sec: { ...UI_DEFAULT.sec, ...sec },
      mode: v.mode === "snmp" ? "snmp" : "cli",
      snmpProfile: typeof v.snmpProfile === "string" ? v.snmpProfile.slice(0, 64) : "",
      interval: TRAFFIC_INTERVALS.includes(v.interval as TrafficInterval) ? (v.interval as TrafficInterval) : 30,
      anim: v.anim === true,
      arrows: v.arrows !== false,
      rates: v.rates !== false,
    };
  } catch {
    return UI_DEFAULT;
  }
}

/** Color del tema por nivel de utilización (sin velocidad conocida: acento). */
const UTIL_VAR: Record<UtilLevel, string> = { ok: "var(--ok)", warn: "var(--warn)", crit: "var(--danger)", none: "var(--accent)" };

/** El sistema pide reducir movimiento (se respeta aunque "Animación" esté activa). */
function useReducedMotion(): boolean {
  const q = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const [reduced, setReduced] = useState(() => !!q?.matches);
  useEffect(() => {
    if (!q) return;
    const on = () => setReduced(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, [q]);
  return reduced;
}

/** Desplaza una curva cuadrática en paralelo (un carril por sentido). */
function lanePath(a: Pt, c: Pt, b: Pt, off: number): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * off;
  const ny = (dx / len) * off;
  return `M ${a.x + nx} ${a.y + ny} Q ${c.x + nx} ${c.y + ny} ${b.x + nx} ${b.y + ny}`;
}

/** Punta de flecha sobre la curva en t, hacia B (forward) o hacia A, en su carril. */
function arrowHead(a: Pt, c: Pt, b: Pt, t: number, forward: boolean, off: number): string {
  const px = (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t ** 2 * b.x;
  const py = (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t ** 2 * b.y;
  let tx = 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x);
  let ty = 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y);
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl;
  ty /= tl;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const cx = px + (-dy / len) * off;
  const cy = py + (dx / len) * off;
  const s = forward ? 1 : -1;
  const [ux, uy] = [tx * s, ty * s];
  const [nx, ny] = [-uy, ux];
  const pts = [
    [cx + ux * 6, cy + uy * 6],
    [cx - ux * 4 + nx * 4, cy - uy * 4 + ny * 4],
    [cx - ux * 4 - nx * 4, cy - uy * 4 - ny * 4],
  ];
  return pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ");
}

function saveUi(ui: TopoUi) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch {
    // Almacenamiento bloqueado o lleno: la herramienta sigue funcionando sin recordar el estado.
  }
}

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
  snmpProfiles,
  visible,
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
  /** Perfiles de Herramientas › SNMP (sin secretos: viven en la bóveda). */
  snmpProfiles: SnmpProfile[];
  /** La herramienta está a la vista: sin ella no se leen contadores de tráfico. */
  visible: boolean;
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
  const [exportMenu, setExportMenu] = useState<Menu | null>(null);
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
  const [ui, setUi] = useState<TopoUi>(loadUi);
  const scroller = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const manualRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const legendId = useId();
  const isOpen = (s: PanelSection) => !!ui.sec[s];
  const setOpen = (s: PanelSection, open: boolean) => setUi((u) => ({ ...u, sec: { ...u.sec, [s]: open } }));
  const setPanel = (panel: boolean) => setUi((u) => ({ ...u, panel }));

  useEffect(() => saveUi(ui), [ui]);

  // Descubrimiento por SNMP: perfiles v2c o v3 (GETBULK); v1 no se ofrece.
  const mode = ui.mode;
  const profiles = useMemo(() => snmpProfiles.filter((p) => p.version !== "1" && p.host.trim()), [snmpProfiles]);
  const profile = profiles.find((p) => p.id === ui.snmpProfile) ?? profiles[0];

  // Tráfico en enlaces: apagado al abrir; la lectura por consola también (envía comandos).
  const [trafficOn, setTrafficOn] = useState(false);
  const [trafficCli, setTrafficCli] = useState(false);
  const reducedMotion = useReducedMotion();
  const traffic = useTopoTraffic({
    topo,
    profiles: snmpProfiles,
    terminals,
    opts: { on: trafficOn, cli: trafficCli, interval: ui.interval },
    visible,
  });

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
  const macOn = sourceOn(sources, "mac");

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
        for (const iface of ifaces) {
          // La interfaz viene de la salida del equipo: solo se reenvía si es un nombre válido.
          const cmd = junosDetailCommand(iface);
          if (cmd) outputs.push(await run(cmd));
        }
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
      // Tablas MAC y ARP: solo con la fuente MAC/OUI activa (apagada no se envía ningún comando).
      // Los datos OUI se cargan recién aquí, en un módulo aparte, para no pesar en el arranque.
      let macs: Record<string, MacPort> | undefined;
      if (macOn && MAC_COMMANDS[vendor].length) {
        const results: CommandOutput[] = [];
        for (const cmd of MAC_COMMANDS[vendor]) results.push({ cmd, out: await run(cmd) });
        const { lookupOui } = await import("../../lib/oui");
        macs = buildMacPorts(results, lookupOui);
        outputs.push(...results.map((x) => x.out));
      }
      const last = [...outputs].reverse().find((o) => o.trim()) ?? "";
      const name = promptName(last) ?? term.name;
      onTopo((t) => mergeNeighbors(t, { name, ip: term.host, ports, addrs, macs }, [...neighbors, ...routing]));
      setSelected(nodeId(name));
      const parts = [
        `${neighbors.length} vecinos CDP/LLDP`,
        routingOn && ROUTING_COMMANDS[vendor].length ? `${routing.length} de ruteo` : "",
        macs ? `${Object.keys(macs).length} puertos con MAC` : "",
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

  /**
   * Descubrimiento con un perfil SNMP: solo lectura (GET y GETBULK de las tablas permitidas en el
   * backend), con las mismas fuentes activas que por consola. Los secretos salen de la bóveda.
   */
  const discoverSnmp = async () => {
    const p = profile;
    if (!p) return;
    if (!p.saved) {
      setMsg(`El perfil "${p.name || p.host}" no tiene secretos guardados: guárdalos en Herramientas › SNMP (bóveda cifrada).`);
      return;
    }
    setBusy(true);
    setMsg(`Leyendo por SNMP ${p.host} (LLDP, CDP${routingOn ? ", OSPF, BGP" : ""}${macOn ? ", tabla MAC y ARP" : ""})…`);
    try {
      const opts = { routing: routingOn, mac: macOn, ports: readPorts };
      const plan = snmpDiscoveryPlan(opts);
      const target = targetParams(p, { community: "", authPass: "", privPass: "" });
      let r = await invoke<TopoRead>("snmp_topo_read", { target, gets: plan.gets, walks: plan.walks });
      if (opts.mac && needsArpFallback(r)) {
        const r2 = await invoke<TopoRead>("snmp_topo_read", { target, gets: [], walks: ARP_FALLBACK });
        r = { ...r, walks: [...r.walks, ...r2.walks], ms: r.ms + r2.ms };
      }
      const d = parseSnmpDiscovery(r, opts);
      let macs: Record<string, MacPort> | undefined;
      if (opts.mac) {
        const { lookupOui } = await import("../../lib/oui");
        macs = macPortsFromRows(d.macRows, d.arpRows, lookupOui);
      }
      const host = p.host.trim();
      const name = d.name ?? (p.name.trim() || host);
      onTopo((t) => mergeNeighbors(t, { name, ip: isIpv4(host) || isIpv6(host) ? host : undefined, ports: d.ports, addrs: d.addrs, macs }, [...d.neighbors, ...d.routing]));
      setSelected(nodeId(name));
      traffic.prime(nodeId(name), p.id, d.ifIndex);
      const parts = [
        `${d.neighbors.length} vecinos CDP/LLDP`,
        routingOn ? `${d.routing.length} de ruteo` : "",
        macs ? `${Object.keys(macs).length} puertos con MAC` : "",
      ].filter(Boolean);
      const l2 = d.l2Empty
        ? "LLDP y CDP vacíos por SNMP: el protocolo está apagado en el equipo (o su agente no publica LLDP-MIB ni CISCO-CDP-MIB)."
        : "";
      const notes = d.notes.length ? `Avisos: ${d.notes.slice(0, 3).join("; ")}${d.notes.length > 3 ? ` y ${d.notes.length - 3} más` : ""}.` : "";
      setMsg([`${name}: ${parts.join(", ")} por SNMP en ${(r.ms / 1000).toFixed(1)} s.`, l2, notes].filter(Boolean).join(" "));
    } catch (e) {
      setMsg(`SNMP: ${String(e)}`);
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

  // Última tasa por enlace (se recalcula una vez por lectura, no por cuadro).
  const linkRates = useMemo(() => {
    const m = new Map<string, LinkTraffic>();
    if (!trafficOn) return m;
    for (const l of topo.links) {
      const lt = linkTraffic(l, traffic.rates);
      if (lt) m.set(linkKey(l), lt);
    }
    return m;
  }, [trafficOn, traffic.rates, topo.links]);
  // La animación va en los carriles de cada sentido: sin flechas tampoco se anima.
  const animate = ui.anim && ui.arrows && !reducedMotion && visible;
  /** Etiquetas de tasa: en enlaces paralelos se apilan en el centro del par, con el puerto de A. */
  const trafficLabels = useMemo(() => {
    if (!linkRates.size) return [];
    const pairKey = (l: TopoLink) => [l.a, l.b].sort().join("~");
    const mids = new Map<string, Pt[]>();
    for (const g of geometry) mids.set(pairKey(g.l), [...(mids.get(pairKey(g.l)) ?? []), g.mid]);
    const used = new Map<string, number>();
    const out: { key: string; x: number; y: number; text: string; color: string; dim: boolean; anchor: "middle" | "end" }[] = [];
    for (const g of geometry) {
      const k = linkKey(g.l);
      const lt = linkRates.get(k);
      if (!lt || removed.has(k)) continue;
      const pk = pairKey(g.l);
      const i = used.get(pk) ?? 0;
      used.set(pk, i + 1);
      const ms = mids.get(pk)!;
      const multi = g.pair.length > 1;
      // Paralelos: la pila queda a la izquierda del par, fuera de las líneas y del rótulo del agregado.
      const x = multi ? Math.min(...ms.map((m) => m.x)) - 18 : g.mid.x;
      const y = (multi ? ms.reduce((a, m) => a + m.y, 0) / ms.length - 6 : g.mid.y + 20) + i * 14;
      out.push({
        key: `${k}|${g.l.proto}`,
        x,
        y,
        anchor: multi ? "end" : "middle",
        text: `${multi ? `${g.l.aPort || "?"}: ` : ""}${trafficLabel(lt)}`,
        color: UTIL_VAR[utilLevel(lt.util)],
        dim: !!route && !routeKeys.has(k),
      });
    }
    return out;
  }, [geometry, linkRates, removed, route, routeKeys]);

  // Sugerencias: se calculan del diagrama ya leído, sin comandos, y solo con su fuente activa.
  const suggestions = useMemo(() => collectSuggestions(topo, sources, dismissed), [topo, sources, dismissed]);
  const suggestionSources = TOPO_SOURCES.filter((s) => SUGGESTERS[s.id] && sourceOn(sources, s.id));
  const emptyHints = [
    sourceOn(sources, "descriptions") &&
      (topo.nodes.some((n) => n.ports && Object.keys(n.ports).length)
        ? "Ninguna descripción menciona un equipo sin enlace."
        : 'Descubre con "Estado de puertos" para leer las descripciones.'),
    macOn &&
      (topo.nodes.some((n) => n.macs && Object.keys(n.macs).length)
        ? "Ningún puerto sin enlace tiene HSRP/VRRP, MAC de equipo de red o varias MAC."
        : 'Pulsa "Descubrir vecinos" para leer las tablas MAC y ARP.'),
  ].filter((x): x is string => !!x);

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
    // La IP viene de un vecino (dato del equipo): solo una IPv4/IPv6 literal, nunca un nombre ni "-o…".
    if (!isIpv4(n.ip) && !isIpv6(n.ip)) {
      setMsg(`IP de gestión no válida: ${n.ip.slice(0, 64)}`);
      return;
    }
    const base = term.session;
    // Solo lo necesario para llegar al vecino: usuario, llave, jump host y compatibilidad. No se copian
    // comandos al conectar, túneles ni argumentos extra hacia una IP que informó otro equipo.
    const ssh = proto === "ssh";
    onOpenSession({
      id: "",
      name: n.name,
      type: proto,
      host: n.ip,
      port: ssh ? (base.type === "ssh" ? base.port : 22) : base.type === "telnet" ? base.port : 23,
      username: ssh ? base.username : undefined,
      identity_file: ssh ? base.identity_file : undefined,
      jump_host: ssh ? base.jump_host : undefined,
      legacy_ssh: ssh ? base.legacy_ssh : undefined,
      highlight: base.highlight,
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


  // Detalle a demanda: al seleccionar un equipo se abre su sección.
  useEffect(() => {
    if (selected) setOpen("detalle", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const formKey = form ? (form.kind === "node" ? `n:${form.editId ?? ""}` : `l:${form.edit ? linkKey(form.edit) : ""}`) : "";
  // Un formulario manual (nuevo o editar desde Detalle) abre su sección y la deja a la vista.
  useEffect(() => {
    if (!form) return;
    setOpen("manual", true);
    requestAnimationFrame(() => manualRef.current?.scrollIntoView({ block: "nearest" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey]);

  // La primera vez que aparecen sugerencias (de 0 a más de 0) la sección se despliega sola.
  const autoOpened = useRef(false);
  const prevCount = useRef(0);
  useEffect(() => {
    if (!autoOpened.current && prevCount.current === 0 && suggestions.length > 0) {
      autoOpened.current = true;
      setOpen("sugerencias", true);
    }
    prevCount.current = suggestions.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions.length]);

  const showSuggestions = () => {
    setUi((u) => ({ ...u, panel: true, sec: { ...u.sec, sugerencias: true } }));
    requestAnimationFrame(() => suggestionsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  const fit = () => {
    setZoom(1);
    scroller.current?.scrollTo({ left: 0, top: 0 });
  };

  // Leyenda solo con lo que hay en la vista y solo si hay algo más que CDP/LLDP.
  const legendKinds = LINK_LEGEND.filter(([, s]) => linkDash(s) && view.links.some((l) => linkDash(l) === linkDash(s)));
  const hasPhysical = view.links.some((l) => !linkDash(l));
  const hasTentative = view.nodes.some((n) => n.manual || n.addrOnly);
  const hasTraffic = linkRates.size > 0;
  const showLegend = legendKinds.length > 0 || hasTentative || hasTraffic;

  const activeSources = TOPO_SOURCES.filter((s) => sourceOn(sources, s.id)).length;
  const trafficSummary = !trafficOn
    ? "Apagado"
    : !visible
      ? "En pausa (herramienta oculta)"
      : `Cada ${ui.interval} s · ${linkRates.size} enlaces con datos${trafficCli ? " · también por consola" : ""}`;
  const diffCount = diff ? diff.addedLinks.length + diff.removedLinks.length + diff.addedNodes.length + diff.removedNodes.length : 0;
  const hint = "Descubre los vecinos del equipo conectado y sigue la ruta salto a salto: clic en un vecino y 'Conectar'. Solo usa comandos de consulta.";

  return (
    <div className="@container h-full min-h-[480px] flex flex-col gap-3">
      <section className="rounded-xl border border-line bg-panel px-4 pt-3 pb-3">
        {/* En anchos chicos se oculta: el menú lateral ya dice Topología y el texto queda en el botón. */}
        <header className="flex items-baseline gap-2 min-w-0 mb-2 @max-[860px]:hidden">
          <h2 className="text-[13px] font-semibold shrink-0">Topología</h2>
          <p className="text-[11.5px] text-muted truncate" title={hint}>
            {hint}
          </p>
        </header>
        <div className="flex flex-wrap items-end gap-2">
          <Label text="Descubrir con" className="w-36">
            <select className="field" value={mode} onChange={(e) => setUi((u) => ({ ...u, mode: e.target.value as DiscoveryMode }))}>
              <option value="cli">Consola (CLI)</option>
              <option value="snmp">SNMP (perfil)</option>
            </select>
          </Label>
          {mode === "cli" ? (
            <>
              <Label text="Equipo (sesión conectada)" className="flex-1 min-w-40">
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
            </>
          ) : (
            <Label text="Perfil SNMP del equipo (v2c o v3)" className="flex-1 min-w-48">
              <select className="field" value={profile?.id ?? ""} onChange={(e) => setUi((u) => ({ ...u, snmpProfile: e.target.value }))}>
                {!profiles.length && <option value="">Sin perfiles: créalos en Herramientas › SNMP</option>}
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.host} · {p.host} · {p.version === "3" ? `v3 ${p.level}` : "v2c"}
                    {p.saved ? "" : " (sin secretos guardados)"}
                  </option>
                ))}
              </select>
            </Label>
          )}
          <label
            className="flex items-center gap-1.5 h-8 text-[12px]"
            title={mode === "cli" ? "Lee estado, velocidad, descripción y Port-channel de las interfaces (comandos de consulta)" : "Lee ifOperStatus, ifHighSpeed e ifAlias (IF-MIB)"}
          >
            <input type="checkbox" className="accent-[var(--accent)]" checked={readPorts} onChange={(e) => setReadPorts(e.target.checked)} />
            Estado de puertos
          </label>
          {mode === "cli" ? (
            <Btn kind="primary" disabled={!term || busy} onClick={discover} title={hint}>
              <Radar size={14} className={busy ? "animate-pulse" : ""} /> {busy ? "Leyendo…" : "Descubrir vecinos"}
            </Btn>
          ) : (
            <Btn kind="primary" disabled={!profile || busy} onClick={discoverSnmp} title="Lee LLDP-MIB y CISCO-CDP-MIB (y las fuentes activas) con GETBULK, solo lectura">
              <Radar size={14} className={busy ? "animate-pulse" : ""} /> {busy ? "Leyendo…" : "Descubrir por SNMP"}
            </Btn>
          )}
        </div>
        {mode === "snmp" && (
          <p className="mt-1.5 text-[11.5px] text-muted">
            Solo lectura con el perfil y sus secretos de la bóveda; tope de 10.000 filas y 20 s por tabla. Si LLDP y CDP vuelven vacíos por SNMP, el protocolo está apagado en el equipo.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1 mt-2.5 @max-[860px]:[&_button]:px-2" role="toolbar" aria-label="Diagrama">
          <Btn kind="ghost" title="Acercar" onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))}>
            <ZoomIn size={14} />
          </Btn>
          <Btn kind="ghost" title="Alejar" onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))}>
            <ZoomOut size={14} />
          </Btn>
          <Btn kind="ghost" title="Ajustar a la vista" aria-label="Ajustar a la vista" onClick={fit}>
            <Maximize2 size={14} />
          </Btn>
          <Btn kind="ghost" title="Reordenar automáticamente" onClick={() => onTopo((t) => layout({ ...t, nodes: t.nodes.map((n) => ({ ...n, x: 0, y: 0 })) }))}>
            <Network size={14} />
          </Btn>
          <span className="w-px h-5 bg-[var(--border)] mx-1 @max-[860px]:hidden" aria-hidden />
          <Btn
            kind="ghost"
            title="Exportar el diagrama: SVG, draw.io, CSV o Mermaid"
            aria-haspopup="menu"
            aria-expanded={!!exportMenu}
            disabled={!topo.nodes.length}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setExportMenu({
                x: r.left,
                y: r.bottom + 4,
                items: [
                  ["Imagen SVG", <Download size={13} />, () => exportFile("svg", toSvg(topo, W, H, linkRates))],
                  ["draw.io (editable)", <Download size={13} />, () => exportFile("drawio", toDrawio(topo, W, H))],
                  ["CSV de enlaces y puertos", <Download size={13} />, () => exportFile("csv", toCsv(topo, linkRates)), !topo.links.length],
                  [
                    "Copiar como Mermaid",
                    <FileCode2 size={13} />,
                    () => writeText(toMermaid(topo)).then(() => setMsg("Diagrama Mermaid copiado al portapapeles")),
                  ],
                ],
              });
            }}
          >
            <Download size={14} /> <span className="@max-[860px]:sr-only">Exportar</span> <ChevronDown size={12} aria-hidden />
          </Btn>
          {exportMenu && <ContextMenu menu={exportMenu} onClose={() => setExportMenu(null)} />}
          <div className="ml-auto flex items-center gap-1">
            <Btn
              kind={trafficOn ? "default" : "ghost"}
              aria-pressed={trafficOn}
              title={trafficOn ? "Dejar de leer el tráfico de los enlaces" : "Mostrar el tráfico de los enlaces (opciones en el panel)"}
              onClick={() => setTrafficOn(!trafficOn)}
              className={trafficOn ? "!text-accent" : ""}
            >
              <Activity size={14} aria-hidden /> <span className="@max-[860px]:sr-only">Tráfico</span>
            </Btn>
            {suggestions.length > 0 && (
              <Btn
                title="Ver sugerencias en el panel"
                aria-label={`Ver ${suggestions.length} sugerencias`}
                onClick={showSuggestions}
              >
                <Lightbulb size={14} className="text-warn" aria-hidden /> <span className="@max-[860px]:sr-only">Sugerencias</span> <CountBadge n={suggestions.length} />
              </Btn>
            )}
      <Btn
        kind="ghost"
        className="hover:!text-danger"
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
            <Btn
              aria-expanded={ui.panel}
              aria-controls={panelId}
              title={ui.panel ? "Ocultar panel lateral" : "Mostrar panel lateral"}
              onClick={() => setPanel(!ui.panel)}
            >
              {ui.panel ? <PanelRightClose size={14} aria-hidden /> : <PanelRight size={14} aria-hidden />} <span className="@max-[860px]:sr-only">Panel</span>
            </Btn>
          </div>
        </div>
        {msg && <p className="mt-2 text-[12px] text-accent">{msg}</p>}
      </section>

      <div className="relative flex-1 min-h-[240px] flex gap-3">
        <div className="relative flex-1 min-w-0 rounded-xl border border-line bg-panel overflow-hidden">
          <div ref={scroller} className="absolute inset-0 overflow-auto">
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
            const lt = state ? undefined : linkRates.get(k);
            const level = lt ? utilLevel(lt.util) : undefined;
            const color =
              state === "removed" ? "var(--danger)" : state === "added" ? "var(--ok)" : level ? UTIL_VAR[level] : hot ? "var(--accent)" : "var(--muted)";
            const dim = route && !isRoute;
            const aName = node(g.l.a)?.name ?? g.l.a;
            const bName = node(g.l.b)?.name ?? g.l.b;
            const dirLevel = (bps: number | null) => UTIL_VAR[lt?.speed && bps !== null ? utilLevel(bps / lt.speed) : "none"];
            const tip = [
              `${aName} ${g.l.aPort || "?"} ↔ ${g.l.bPort || "?"} ${bName} (${protoLabel(g.l)})`,
              lt &&
                `Tráfico: ↑ ${aName} → ${bName} ${fmtBps(lt.ab)} · ↓ ${bName} → ${aName} ${fmtBps(lt.ba)}${lt.speed ? ` · enlace de ${fmtBps(lt.speed)}, ${Math.round((lt.util ?? 0) * 100)} %` : " · velocidad desconocida"}`,
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
                  strokeWidth={isRoute ? 3.5 : lt ? 1.75 + 3 * Math.min(1, lt.util ?? 0) : hot || state ? 2.5 : g.l.logical ? 1.25 : 1.5}
                  strokeDasharray={dash}
                  strokeLinecap={dash ? "round" : undefined}
                />
                {lt && (
                  <>
                    {/* Un carril y una punta de flecha por sentido: A→B y B→A. */}
                    {animate && !!lt.ab && <path className="topo-flow" d={lanePath(g.a, g.c, g.b, 4)} fill="none" stroke={dirLevel(lt.ab)} strokeWidth={1.5} strokeLinecap="round" />}
                    {animate && !!lt.ba && <path className="topo-flow topo-flow-rev" d={lanePath(g.a, g.c, g.b, -4)} fill="none" stroke={dirLevel(lt.ba)} strokeWidth={1.5} strokeLinecap="round" />}
                    {ui.arrows && (
                      <>
                        <polygon points={arrowHead(g.a, g.c, g.b, 0.4, true, 5)} fill={dirLevel(lt.ab)} stroke="var(--panel)" strokeWidth={0.75} />
                        <polygon points={arrowHead(g.a, g.c, g.b, 0.6, false, -5)} fill={dirLevel(lt.ba)} stroke="var(--panel)" strokeWidth={0.75} />
                      </>
                    )}
                  </>
                )}
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
                  (isRoutingProto(g.l.proto) || g.l.proto === "MAC/OUI") && (
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
          {/* Las tasas van en una capa propia sobre los equipos: un enlace corto no las tapa. */}
          {ui.rates && trafficLabels.map((t) => (
            <text
              key={t.key}
              x={t.x}
              y={t.y}
              opacity={t.dim ? 0.25 : 1}
              fontSize={10.5}
              fontWeight={600}
              textAnchor={t.anchor}
              fill={t.color}
              stroke="var(--panel)"
              strokeWidth={4}
              paintOrder="stroke"
              pointerEvents="none"
            >
              {t.text}
            </text>
          ))}
        </svg>
      )}
          </div>
          {!ui.panel && sel && (
            <div className="absolute top-2 left-2 flex items-center gap-2 max-w-[calc(100%-1rem)] rounded-lg border border-line bg-panel shadow-pop pl-3 pr-1 py-1 text-[12px]">
              <span className="font-medium truncate">{sel.name}</span>
              <Btn kind="ghost" className="!h-6 !px-2 !text-[11.5px] !text-accent" onClick={() => setUi((u) => ({ ...u, panel: true, sec: { ...u.sec, detalle: true } }))}>
                Ver detalle
              </Btn>
            </div>
          )}
          {showLegend && (
            <div className="absolute bottom-2 left-2 flex flex-col items-start gap-1.5 max-w-[calc(100%-1rem)]">
              {isOpen("leyenda") && (
                <div
                  id={legendId}
                  className="flex flex-col gap-1 rounded-lg border border-line bg-panel shadow-pop px-3 py-2 text-[11.5px] text-muted"
                  aria-label="Leyenda de enlaces"
                  role="group"
                >
                  {hasPhysical && (
                    <span className="inline-flex items-center gap-1.5">
                      <LegendLine />
                      CDP / LLDP
                    </span>
                  )}
                  {legendKinds.map(([text, s]) => (
                    <span key={text} className="inline-flex items-center gap-1.5">
                      <LegendLine dash={linkDash(s)} />
                      {text}
                    </span>
                  ))}
                  {hasTentative && (
                    <span className="inline-flex items-center gap-1.5">
                      <svg width="34" height="12" aria-hidden className="shrink-0">
                        <rect x="7" y="1" width="20" height="10" rx="3" fill="var(--chrome)" stroke="var(--field-border)" strokeDasharray="4 3" />
                      </svg>
                      Equipo manual o visto solo por ruteo
                    </span>
                  )}
                  {hasTraffic && (
                    <>
                      <span className="mt-1 font-medium text-fg">Tráfico (color y grosor por utilización)</span>
                      {UTIL_LEGEND.map(([text, lv]) => (
                        <span key={lv} className="inline-flex items-center gap-1.5">
                          <svg width="34" height="8" aria-hidden className="shrink-0">
                            <line x1="2" y1="4" x2="32" y2="4" stroke={UTIL_VAR[lv]} strokeWidth={lv === "crit" ? 4.5 : lv === "warn" ? 3.5 : 2.5} strokeLinecap="round" />
                          </svg>
                          {text}
                        </span>
                      ))}
                      <span className="inline-flex items-center gap-1.5">
                        <svg width="34" height="8" aria-hidden className="shrink-0">
                          <line x1="2" y1="4" x2="32" y2="4" stroke={UTIL_VAR.none} strokeWidth={2.5} strokeLinecap="round" />
                        </svg>
                        Velocidad desconocida
                      </span>
                      {ui.arrows && <span className="inline-flex items-center gap-1.5">
                        <svg width="34" height="12" aria-hidden className="shrink-0">
                          <line x1="2" y1="6" x2="32" y2="6" stroke="var(--muted)" strokeWidth={1.5} />
                          <polygon points="13,1.5 19,4.5 13,7.5" fill="var(--ok)" />
                          <polygon points="21,4.5 15,7.5 21,10.5" fill="var(--warn)" />
                        </svg>
                        Una flecha por sentido · ↑ de A hacia B, ↓ de B hacia A (detalle al pasar el mouse)
                      </span>}
                    </>
                  )}
                </div>
              )}
              <button
                type="button"
                aria-expanded={isOpen("leyenda")}
                aria-controls={legendId}
                onClick={() => setOpen("leyenda", !isOpen("leyenda"))}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-line bg-panel text-[11.5px] text-muted hover:text-fg hover:bg-hover"
              >
                <ChevronUp size={13} aria-hidden className={`transition-transform ${isOpen("leyenda") ? "" : "rotate-180"}`} />
                Leyenda
              </button>
            </div>
          )}
        </div>

        {ui.panel && (
          <aside
            id={panelId}
            aria-label="Panel de topología"
            className="w-[320px] shrink-0 min-h-0 overflow-y-auto space-y-3 @max-[860px]:absolute @max-[860px]:top-0 @max-[860px]:right-0 @max-[860px]:bottom-0 @max-[860px]:z-10 @max-[860px]:max-w-[calc(100%-2rem)] @max-[860px]:rounded-xl @max-[860px]:bg-bg @max-[860px]:shadow-pop @max-[860px]:p-2"
          >
            <Collapsible
              title="Fuentes de descubrimiento"
              summary={`${activeSources} de ${TOPO_SOURCES.length} activas · CDP/LLDP y lo manual, siempre`}
              open={isOpen("fuentes")}
              onToggle={(v) => setOpen("fuentes", v)}
            >
        <div className="space-y-2.5">
          {TOPO_SOURCES.map((s) => (
            <div key={s.id}>
              <Toggle checked={sourceOn(sources, s.id)} onChange={(v) => onSources({ ...sources, [s.id]: v })} label={s.label} />
              <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">{s.hint}</p>
            </div>
          ))}
        </div>
            </Collapsible>

            <Collapsible
              title="Tráfico en enlaces"
              summary={trafficSummary}
              open={isOpen("trafico")}
              onToggle={(v) => setOpen("trafico", v)}
            >
              <div className="space-y-2.5 text-[12px]">
                <div>
                  <Toggle checked={trafficOn} onChange={setTrafficOn} label="Tráfico en enlaces" />
                  <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">
                    Lee los contadores de las interfaces con enlace de cada equipo explorado, solo mientras Topología está a la vista. Por SNMP usa el perfil del equipo (misma IP o
                    nombre, con secretos guardados): un GET de ifHCInOctets, ifHCOutOctets e ifHighSpeed (IF-MIB), o los de 32 bits si el agente no los tiene.
                  </p>
                </div>
                <label className="flex items-center gap-2 pl-10">
                  <span className="text-muted">Cada</span>
                  <select
                    className="field !h-7 !w-24 !text-[12px]"
                    value={ui.interval}
                    onChange={(e) => setUi((u) => ({ ...u, interval: Number(e.target.value) as TrafficInterval }))}
                  >
                    {TRAFFIC_INTERVALS.map((i) => (
                      <option key={i} value={i}>
                        {i} s
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <Toggle checked={trafficCli} onChange={setTrafficCli} label="También por consola" />
                  <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">
                    Para equipos sin perfil SNMP: envía <span className="font-mono">show interfaces</span>, <span className="font-mono">display interface</span> o{" "}
                    <span className="font-mono">show interfaces extensive</span> a su sesión conectada en cada lectura. Solo consulta, pero ocupa la sesión unos segundos.
                  </p>
                </div>
                <div>
                  <Toggle checked={ui.arrows} onChange={(arrows) => setUi((u) => ({ ...u, arrows }))} label="Flechas de dirección" />
                  <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">Una punta por sentido sobre cada enlace. Sin flechas, el color y el grosor siguen indicando la utilización.</p>
                </div>
                <div>
                  <Toggle checked={ui.rates} onChange={(rates) => setUi((u) => ({ ...u, rates }))} label="Velocidad de tráfico" />
                  <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">Muestra ↑ ↓ en Mb/s y el % de uso junto al enlace. El detalle sigue disponible al pasar el mouse.</p>
                </div>
                <div>
                  <Toggle checked={ui.anim && ui.arrows} onChange={(anim) => setUi((u) => ({ ...u, anim, arrows: anim || u.arrows }))} label="Animación" />
                  <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">
                    Trazo animado en el sentido del tráfico (CSS, se pausa con la herramienta oculta).
                    {reducedMotion ? " El sistema pide reducir movimiento: queda desactivada." : ""}
                  </p>
                </div>
                {trafficOn && (
                  <div className="rounded-md border border-line px-2 py-1.5 space-y-0.5 text-[11.5px]">
                    {!traffic.status.last && <p className="text-muted">Leyendo…</p>}
                    {traffic.status.snmp.length > 0 && <p>SNMP: {traffic.status.snmp.join(", ")}</p>}
                    {traffic.status.cli.length > 0 && <p>Consola: {traffic.status.cli.join(", ")}</p>}
                    {traffic.status.none.length > 0 && (
                      <p className="text-muted">
                        Sin fuente: {traffic.status.none.join(", ")}. {trafficCli ? "Conecta su sesión o crea su perfil SNMP." : 'Crea su perfil SNMP o activa "También por consola".'}
                      </p>
                    )}
                    {traffic.status.errors.map((e) => (
                      <p key={e} className="text-danger">
                        {e}
                      </p>
                    ))}
                    {traffic.status.last && !linkRates.size && !traffic.status.errors.length && (
                      <p className="text-muted">La tasa aparece desde la segunda lectura ({ui.interval} s).</p>
                    )}
                    {traffic.status.last && <p className="text-muted">Última lectura: {new Date(traffic.status.last).toLocaleTimeString()}</p>}
                  </div>
                )}
              </div>
            </Collapsible>

            {suggestionSources.length > 0 && (
              <div ref={suggestionsRef} className="scroll-mt-2">
                <Collapsible
                  title="Sugerencias"
                  badge={suggestions.length}
                  summary={suggestions.length ? "Confirma cada una antes de dibujarla" : "Sin sugerencias por ahora"}
                  open={isOpen("sugerencias")}
                  onToggle={(v) => setOpen("sugerencias", v)}
                >
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
                        {TOPO_SOURCES.find((x) => x.id === s.source)?.short ?? s.source}: {s.source === "descriptions" ? `"${s.reason}"` : s.reason}
                      </p>
                      {s.detail && (
                        <p className="text-muted truncate" title={s.detail.vendors.join(", ")}>
                          {s.detail.vendors.join(", ")} · {s.detail.macs} MAC{s.detail.ip && <span className="font-mono"> · {s.detail.ip}</span>}
                        </p>
                      )}
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
                <div className="space-y-1 text-[12px] text-muted">
                  {emptyHints.map((h) => (
                    <p key={h}>{h}</p>
                  ))}
                </div>
              )}
                </Collapsible>
              </div>
            )}

            <Collapsible
              title={sel ? sel.name : "Detalle"}
            summary={sel ? (sel.manual ? "Agregado a mano" : sel.addrOnly ? "Visto por ruteo, aún sin nombre" : sel.explored ? "Vecinos ya leídos" : "Aún no explorado") : "Selecciona un equipo"}
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
              open={isOpen("detalle")}
              onToggle={(v) => setOpen("detalle", v)}
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
                {sel.macs && Object.keys(sel.macs).length > 0 && (
                  <details className="rounded-md border border-line px-2 py-1">
                    <summary className="cursor-pointer text-[11.5px] text-muted">MAC por puerto ({Object.keys(sel.macs).length})</summary>
                    <ul className="mt-1 space-y-1 max-h-48 overflow-y-auto">
                      {Object.entries(sel.macs)
                        .sort(([, x], [, y]) => x.port.localeCompare(y.port, undefined, { numeric: true }))
                        .map(([k, mp]) => {
                          const ips = mp.macs.map((e) => e.ip).filter(Boolean);
                          return (
                            <li key={k} className="text-[11px] leading-snug">
                              <span className="font-mono">{mp.port}</span>
                              <span className="text-muted">
                                {" "}
                                · {mp.total} MAC · {macVendors(mp).join(", ")}
                                {ips.length > 0 && ` · ${ips.slice(0, 2).join(", ")}${ips.length > 2 ? "…" : ""}`}
                                {macPortLinked(topo, sel, k) && " · con enlace"}
                              </span>
                            </li>
                          );
                        })}
                    </ul>
                  </details>
                )}
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
                              <option value="telnet">Telnet (sin cifrar)</option>
                            </select>
                          </div>
                        )}
                        {!saved && sel.ip && proto === "telnet" && (
                          <p className="text-[11.5px] text-warn">
                            Telnet no cifra: usuario y contraseña viajan en claro hasta {sel.ip}. Úsalo solo si el equipo no tiene SSH.
                          </p>
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
            </Collapsible>

            {(path.from || path.to) && (
              <Collapsible
                title="Ruta"
                summary={`${path.from ? (node(path.from)?.name ?? path.from) : "?"} → ${path.to ? (node(path.to)?.name ?? path.to) : "elige destino"}`}
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
                open={isOpen("ruta")}
                onToggle={(v) => setOpen("ruta", v)}
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
              </Collapsible>
            )}

            <div ref={manualRef} className="scroll-mt-2">
              <Collapsible
                title="Manual"
                summary={form ? (form.kind === "node" ? "Equipo" : "Enlace") : "Equipos y enlaces agregados a mano"}
                open={isOpen("manual")}
                onToggle={(v) => setOpen("manual", v)}
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
              </Collapsible>
            </div>

            <Collapsible
              title="Snapshots y cambios"
              badge={diffCount || undefined}
              summary={snapshot ? `Comparando con "${snapshot.name}"` : snapshots.length ? `${snapshots.length} guardados` : "Guarda una copia para comparar después"}
              open={isOpen("snapshots")}
              onToggle={(v) => setOpen("snapshots", v)}
            >
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-1">
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
                </div>
                <div className="flex items-center gap-1">
          <label className="flex flex-1 min-w-0 items-center gap-1 text-[12px]" title="Compara el diagrama actual con un snapshot">
            <GitCompare size={14} className="text-muted" />
            <select className="field !h-7 !w-full flex-1 min-w-0 !text-[12px]" value={compareId} onChange={(e) => setCompareId(e.target.value)} disabled={!snapshots.length}>
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
                </div>
                {diff && snapshot && (
                  <div>
                    <p className="mb-1 text-[11.5px] font-medium text-muted">Cambios respecto de "{snapshot.name}"</p>
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
                  </div>
                )}
              </div>
            </Collapsible>
          </aside>
        )}
      </div>
    </div>
  );
}
