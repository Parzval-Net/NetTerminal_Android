import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  ListFilter,
  Radar,
  Route,
  Search,
  Trash2,
  TriangleAlert,
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
  DismissedMap,
  PendingFollow,
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
  addDismissed,
  addManualLink,
  addManualNode,
  buildMacPorts,
  collectSuggestions,
  deleteManualLink,
  deleteManualNode,
  diffTopology,
  dismissedSet,
  fmtBps,
  followedTerminal,
  hopCommand,
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
  parseDismissed,
  parseOwnAddresses,
  parsePortInfo,
  parseRoutingNeighbors,
  pathToText,
  portOf,
  promptName,
  vendorFromPrompt,
  protoLabel,
  shortestPath,
  sourceOn,
  toCsv,
  toDrawio,
  toMermaid,
  toSvg,
  shortName,
  trafficShort,
  UTIL_WARN,
  updateManualLink,
  updateManualNode,
  utilLevel,
  flowTiming,
} from "../../lib/topology";
import {
  ARP_FALLBACK,
  LLDP_V2_FALLBACK,
  MAX_VLAN_READS,
  TopoRead,
  VLAN_FDB_WALKS,
  VLAN_LIST,
  VlanRead,
  activeVlans,
  needsArpFallback,
  needsLldpV2Fallback,
  needsVlanFdb,
  parseSnmpDiscovery,
  snmpDiscoveryPlan,
} from "../../lib/topoSnmp";
import { linkTraffic } from "../../lib/topoTraffic";
import {
  ISSUE_LABEL,
  NO_FILTER,
  NO_SCOPE,
  NodeRole,
  NodeState,
  NodeVendor,
  ROLE_LABEL,
  STATE_LABEL,
  SearchHit,
  TopoFilter,
  TopoScope,
  VENDOR_LABEL,
  filterActive,
  filterView,
  linkChecks,
  nodeRole,
  nodeState,
  nodeVendor,
  parseCidrs,
  scopeNeighbors,
  searchTopo,
  unknownL2,
  worstSev,
} from "../../lib/topoInsights";
import { SnmpProfile, targetParams } from "../../lib/snmp";
import { TRAFFIC_INTERVALS, TrafficInterval, useTopoTraffic } from "./useTopoTraffic";
import { vendorFor } from "../../lib/commands";
import type { Session } from "../../types";
import type { TerminalRef } from "./FileManager";
import { Btn, Collapsible, CountBadge, Label, Toggle } from "./ui";
import { ContextMenu } from "../Sidebar";
import { LifecycleChip } from "../StatusBar";
import { isMac } from "../../lib/platform";
import { modelFromPlatform } from "../../lib/lifecycle";
import type { MenuItem } from "../tabMenu";

import { plural } from "../../lib/plural";
import type { LinkIssue, UnknownL2 } from "../../lib/topoInsights";
type Menu = { x: number; y: number; items: MenuItem[] };

const W = 170;
const H = 54;
/** Nodo virtual "L2 desconocido" (puertos activos sin vecino). */
const L2W = 128;
const L2H = 38;
/** Sobre esta cantidad de equipos con puertos sin vecino, el nodo L2 se dibuja solo para el seleccionado. */
const MAX_L2_NODES = 120;
/** Límites del zoom del mapa (botones, pellizco y Ctrl/⌘ + rueda). */
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 4;
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
type PanelSection = "fuentes" | "alcance" | "filtros" | "revisiones" | "trafico" | "sugerencias" | "detalle" | "ruta" | "manual" | "snapshots" | "leyenda" | "enlaces";
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
  /** Versión de la preferencia de animación: hasta la 2 venía apagada por defecto y quedó guardada así. */
  /** Puntas de flecha por sentido sobre cada enlace con tráfico. */
  arrows: boolean;
  /** Etiqueta de tasas (↑ ↓ y %) junto a cada enlace con tráfico. */
  rates: boolean;
  /** Color y grosor del enlace según su utilización (verde, amarillo, rojo). */
  color: boolean;
  /** Puertos activos sin vecino dibujados como "L2 desconocido" junto a su equipo. */
  l2: boolean;
  /** Alcance del descubrimiento: qué vecinos nuevos se incorporan. */
  scope: TopoScope;
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
  color: true,
  l2: true,
  scope: NO_SCOPE,
};

function loadUi(): TopoUi {
  try {
    const v = JSON.parse(localStorage.getItem(UI_KEY) ?? "null") as Partial<TopoUi> | null;
    // Ventana angosta: el panel lateral se abre encima del diagrama y lo tapa; parte cerrado.
    const roomy = typeof window === "undefined" || window.innerWidth >= 1100;
    if (!v || typeof v !== "object") return { ...UI_DEFAULT, panel: roomy };
    const sec = v.sec && typeof v.sec === "object" ? v.sec : {};
    return {
      panel: v.panel !== false && roomy,
      sec: { ...UI_DEFAULT.sec, ...sec },
      mode: v.mode === "snmp" ? "snmp" : "cli",
      snmpProfile: typeof v.snmpProfile === "string" ? v.snmpProfile.slice(0, 64) : "",
      interval: TRAFFIC_INTERVALS.includes(v.interval as TrafficInterval) ? (v.interval as TrafficInterval) : 30,
      // Desde la versión 2 la animación parte encendida; lo guardado antes era el valor por defecto.
      anim: v.anim === true,
      arrows: v.arrows !== false,
      rates: v.rates !== false,
      color: v.color !== false,
      l2: v.l2 !== false,
      scope: {
        skipEndpoints: v.scope?.skipEndpoints === true,
        cidrs: typeof v.scope?.cidrs === "string" ? v.scope.cidrs.slice(0, 500) : "",
        maxDepth: Number.isInteger(v.scope?.maxDepth) && v.scope!.maxDepth > 0 && v.scope!.maxDepth <= 20 ? v.scope!.maxDepth : 0,
      },
    };
  } catch {
    return UI_DEFAULT;
  }
}

/** Color del tema por nivel de utilización (sin velocidad conocida: gris violeta, distinto del azul de selección y ruta). */
const UTIL_VAR: Record<UtilLevel, string> = { ok: "var(--ok)", warn: "var(--warn)", crit: "var(--danger)", none: "var(--util-unknown)" };

/** Sugerencias descartadas por equipo: comodidad de este navegador, con tope. */
const DISMISSED_KEY = "topoDismissed";
function loadDismissed(): DismissedMap {
  try {
    return parseDismissed(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "null"));
  } catch {
    return {};
  }
}

type ConfirmReq = { title: string; message: string; label: string; danger?: boolean; defaultCancel?: boolean; action: () => void };

/** El sistema pide reducir movimiento (se respeta aunque "Animación" esté activa). */
const reducedQuery = () =>
  typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => !!reducedQuery()?.matches);
  // Una sola suscripción: la topología se vuelve a dibujar con cada muestra del monitoreo.
  useEffect(() => {
    const q = reducedQuery();
    if (!q) return;
    const on = () => setReduced(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * Desplazamiento con dos dedos en un touchpad (no una rueda de mouse). WebKit (macOS) entrega la
 * rueda del mouse en múltiplos de 4.000244 px por paso (el mismo criterio que usa Mapbox GL);
 * Chromium (WebView2 en Windows) informa wheelDeltaY en pasos de 120 para la rueda y otros valores
 * para el touchpad. Sin esos datos, el movimiento horizontal o un delta fino delatan el touchpad.
 */
const WEBKIT_WHEEL_STEP = 4.000244140625;
function isTrackpadScroll(e: { deltaX: number; deltaY: number; deltaMode: number; wheelDeltaY?: number }): boolean {
  if (e.deltaMode !== 0) return false;
  if (e.deltaY !== 0 && Math.abs(e.deltaY) % WEBKIT_WHEEL_STEP === 0) return false;
  const w = e.wheelDeltaY;
  if (typeof w === "number" && w !== 0) return Math.abs(w) % 120 !== 0;
  return e.deltaX !== 0 || Math.abs(e.deltaY) < 40 || !Number.isInteger(e.deltaY);
}

/**
 * Un sentido del tráfico: puntos que viajan junto al enlace (un trazo de largo cero con punta
 * redonda es un círculo), con un borde del color del fondo para que se lean sobre cualquier línea.
 */
function FlowLane({ d, color, style, reverse }: { d: string; color: string; style: React.CSSProperties; reverse?: boolean }) {
  const cls = `topo-flow${reverse ? " topo-flow-rev" : ""}`;
  return (
    <>
      <path className={cls} style={style} d={d} fill="none" stroke="var(--panel)" strokeWidth={6} strokeLinecap="round" />
      <path className={cls} style={style} d={d} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" />
    </>
  );
}

/** Duración y pasos del carril animado (ver flowTiming). */
function flowStyle(bps: number | null, speed: number | undefined): React.CSSProperties {
  const { dur, steps } = flowTiming(bps, speed);
  return { animationDuration: `${dur}s`, animationTimingFunction: `steps(${steps})` };
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

/** Resumen de los vecinos que quedaron fuera del alcance (los primeros tres, con su motivo). */
const scopeNote = (skipped: string[]) =>
  skipped.length ? `${skipped.length} fuera de alcance: ${skipped.slice(0, 3).join(", ")}${skipped.length > 3 ? "…" : ""}` : "";

/** Mismo equipo salvo la posición (los objetos anidados se conservan al mover un nodo). */
function samePayload(a: TopoNode, b: TopoNode): boolean {
  if (a === b) return true;
  for (const k in b) if (k !== "x" && k !== "y" && a[k as keyof TopoNode] !== b[k as keyof TopoNode]) return false;
  for (const k in a) if (!(k in b)) return false;
  return true;
}

/**
 * Los nodos como datos: devuelve el arreglo anterior mientras solo cambien posiciones, para que
 * lo que no depende de x/y no se recalcule en cada cuadro de un arrastre.
 */
function useNodeData(nodes: TopoNode[]): TopoNode[] {
  const ref = useRef(nodes);
  const prev = ref.current;
  if (prev !== nodes && !(prev.length === nodes.length && prev.every((p, i) => samePayload(p, nodes[i])))) ref.current = nodes;
  return ref.current;
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

/** Geometría de un enlace más su clave (linkKey), calculada una vez por enlace y no en cada redibujo. */
type Geo = ReturnType<typeof linkGeometry>[number] & { k: string };

/** Línea de "puerto: estado" para el tooltip de un extremo. */
const infoLine = (port: string, info: string) => (info ? `${port}: ${info}` : "");
/** Estado de un puerto para el tooltip del enlace (estado, velocidad, grupo y descripción). */
const portLine = (n: TopoNode | undefined, port: string) => {
  const p = port ? portOf(n, port) : undefined;
  return p ? [p.status, p.speed, p.group, p.desc].filter(Boolean).join(" · ") : "";
};
/** Segunda línea del equipo en el mapa: IP de gestión o cómo se conoce. */
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

interface TrafficRow {
  key: string;
  a: string;
  b: string;
  aPort: string;
  bPort: string;
  lt: LinkTraffic;
}

/** Máximo de enlaces animados a la vez (los más cargados): medido en una topología de 400 equipos. */
const FLOW_MAX = 60;

/** Filas a la vista antes de "Ver todos": las más cargadas, que son las que importan. */
const TRAFFIC_TOP = 10;

/**
 * Tabla flotante de enlaces por carga (botón "Enlaces" junto a la leyenda). Memorizada: solo se
 * redibuja con una lectura nueva o al cambiar el enlace elegido, no al arrastrar equipos. Muestra
 * las 10 más cargadas; con más, busca por equipo o puerto y filtra las que pasan el 70 %.
 */
const TrafficTable = memo(function TrafficTable({
  id,
  rows,
  byUtil,
  focus,
  onPick,
  onClose,
}: {
  id: string;
  rows: TrafficRow[];
  byUtil: boolean;
  focus: string | null;
  onPick: (r: TrafficRow) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [onlyHot, setOnlyHot] = useState(false);
  const [all, setAll] = useState(false);
  const needle = q.trim().toLowerCase();
  const matched = rows.filter(
    (r) => (!onlyHot || (r.lt.util ?? 0) >= UTIL_WARN) && (!needle || `${r.a} ${r.aPort} ${r.b} ${r.bPort}`.toLowerCase().includes(needle)),
  );
  const list = all || needle || onlyHot ? matched : matched.slice(0, TRAFFIC_TOP);
  const big = rows.length > TRAFFIC_TOP;
  return (
    <div
      id={id}
      role="group"
      aria-label="Enlaces por carga"
      className="w-[340px] max-w-full flex flex-col rounded-lg border border-line bg-panel shadow-pop text-[12px]"
      style={{ maxHeight: "min(360px, 60vh)" }}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1.5 border-b border-line">
        <span className="font-medium flex-1">Enlaces por carga</span>
        <button
          type="button"
          aria-pressed={onlyHot}
          onClick={() => setOnlyHot((v) => !v)}
          className={`h-6 px-2 rounded-md border text-[11px] ${onlyHot ? "border-[var(--accent)] text-accent bg-[var(--selected)]" : "border-line text-muted hover:bg-hover"}`}
        >
          ≥ 70 %
        </button>
        <button type="button" aria-label="Cerrar" onClick={onClose} className="h-6 w-6 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover">
          <X size={13} />
        </button>
      </div>
      {big && (
        <div className="px-2.5 py-1.5 border-b border-line">
          <input className="field !h-7 !text-[12px] w-full" placeholder="Buscar equipo o puerto" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar enlace" />
        </div>
      )}
      <ul className="min-h-0 overflow-auto py-1">
        {list.map((r) => {
          const c = byUtil ? UTIL_VAR[utilLevel(r.lt.util)] : "var(--text)";
          const on = focus === r.key;
          return (
            <li key={r.key}>
              <button
                type="button"
                aria-pressed={on}
                title={`${r.a} ${r.aPort || "?"} → ${r.b}: ${fmtBps(r.lt.ab)}\n${r.b} ${r.bPort || "?"} → ${r.a}: ${fmtBps(r.lt.ba)}${r.lt.speed ? `\nEnlace de ${fmtBps(r.lt.speed)}` : ""}\nClic para ubicarlo en el mapa`}
                onClick={() => onPick(r)}
                className={`w-full flex items-center gap-2 px-2.5 h-7 text-left hover:bg-hover ${on ? "bg-selected" : ""}`}
              >
                <span className="flex-1 min-w-0 truncate">
                  {shortName(r.a)} <span className="text-muted">{r.aPort}</span> ↔ {shortName(r.b)}
                </span>
                {r.lt.util !== undefined && (
                  <span className="w-10 h-1 shrink-0 rounded-full bg-line overflow-hidden" aria-hidden>
                    <span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.round(r.lt.util * 100))}%`, background: c }} />
                  </span>
                )}
                <span className="w-14 shrink-0 text-right font-semibold tabular-nums" style={{ color: c }}>
                  {trafficShort(r.lt)}
                </span>
              </button>
            </li>
          );
        })}
        {!list.length && <li className="px-2.5 py-2 text-muted">{onlyHot ? "Ningún enlace sobre 70 %." : "Sin coincidencias."}</li>}
      </ul>
      {big && !all && !needle && !onlyHot && (
        <button type="button" onClick={() => setAll(true)} className="h-7 border-t border-line text-[11.5px] text-accent hover:bg-hover rounded-b-lg">
          Ver todos ({rows.length})
        </button>
      )}
    </div>
  );
});

/**
 * Un enlace del diagrama. Memorizado: al arrastrar un equipo solo se redibujan sus enlaces (los
 * demás conservan la misma geometría y props).
 */
const LinkView = memo(function LinkView({
  g,
  a,
  b,
  aName,
  bName,
  ga,
  gb,
  state,
  isRoute,
  hot,
  dim,
  lt,
  color: byUtil,
  arrows,
  animate,
  noGroup,
  issues,
  onIssue,
}: {
  g: Geo;
  /** Extremos en el diagrama actual (sin los fantasma del snapshot): nombre y estado de puerto. */
  a: TopoNode | undefined;
  b: TopoNode | undefined;
  aName: string;
  bName: string;
  /** Extremos a la vista (con fantasma): el grupo (Port-channel) del enlace. */
  ga: TopoNode | undefined;
  gb: TopoNode | undefined;
  state: "removed" | "added" | null;
  isRoute: boolean;
  hot: boolean;
  dim: boolean;
  lt: LinkTraffic | undefined;
  color: boolean;
  arrows: boolean;
  animate: boolean;
  /** El par lleva píldora de tráfico: su rótulo de agregado ("Po1 ×2") ya va dentro de ella. */
  noGroup: boolean;
  issues: LinkIssue[] | undefined;
  onIssue: (id: string) => void;
}) {
  // Textos por enlace aquí y no en el padre: con cientos de enlaces, cada redibujo del mapa solo
  // los rehace para los que cambiaron (al arrastrar un equipo, los suyos).
  const aInfo = portLine(a, g.l.aPort);
  const bInfo = portLine(b, g.l.bPort);
  const grp = noGroup ? undefined : (portOf(ga, g.l.aPort)?.group ?? portOf(gb, g.l.bPort)?.group);
  const level = lt && byUtil ? utilLevel(lt.util) : undefined;
  const color = state === "removed" ? "var(--danger)" : state === "added" ? "var(--ok)" : level ? UTIL_VAR[level] : hot ? "var(--accent)" : "var(--muted)";
  const sev = worstSev(issues);
  // Sin color por utilización, las flechas van en el tono neutro del texto.
  const dirLevel = (bps: number | null) => (byUtil ? UTIL_VAR[lt?.speed && bps !== null ? utilLevel(bps / lt.speed) : "none"] : "var(--muted)");
  const tip = [
    `${aName} ${g.l.aPort || "?"} ↔ ${g.l.bPort || "?"} ${bName} (${protoLabel(g.l)})`,
    lt &&
      `Tráfico: ${aName} → ${bName} ${fmtBps(lt.ab)} · ${bName} → ${aName} ${fmtBps(lt.ba)}${lt.speed ? ` · enlace de ${fmtBps(lt.speed)}, ${lt.approx ? "≈" : ""}${Math.round((lt.util ?? 0) * 100)} %${lt.approx ? " (aproximada: velocidad desde el BW configurado)" : ""}` : " · velocidad desconocida"}`,
    infoLine(g.l.aPort, aInfo),
    infoLine(g.l.bPort, bInfo),
    g.l.logical ? "Sesión lógica: no es un enlace físico" : "",
    state === "removed" ? "Ya no aparece (respecto del snapshot)" : state === "added" ? "Nuevo (respecto del snapshot)" : "",
    ...(issues ?? []).map((i) => `${i.sev === "crit" ? "✖" : "⚠"} ${ISSUE_LABEL[i.kind]}: ${i.text}`),
  ]
    .filter(Boolean)
    .join("\n");
  const showGroup = grp && g.pair.length > 1 && g.pair.indexOf(g.l) === 0;
  const dash = state === "removed" ? "6 5" : linkDash(g.l);
  const midLabel = showGroup || isRoutingProto(g.l.proto) || g.l.proto === "MAC/OUI";
  return (
    <g opacity={dim ? 0.25 : 1}>
      <title>{tip}</title>
      <path
        d={g.d}
        fill="none"
        stroke={color}
        strokeWidth={isRoute ? 3.5 : lt && byUtil ? 1.75 + 3 * Math.min(1, lt.util ?? 0) : hot || state ? 2.5 : g.l.logical ? 1.25 : 1.5}
        strokeDasharray={dash}
        strokeLinecap={dash ? "round" : undefined}
      />
      {lt && (
        <>
          {/* Un carril por sentido (A→B y B→A): puntos en movimiento con animación, flechas fijas sin ella. */}
          {animate && !!lt.ab && <FlowLane d={lanePath(g.a, g.c, g.b, 5)} color={dirLevel(lt.ab)} style={flowStyle(lt.ab, lt.speed)} />}
          {animate && !!lt.ba && <FlowLane d={lanePath(g.a, g.c, g.b, -5)} color={dirLevel(lt.ba)} style={flowStyle(lt.ba, lt.speed)} reverse />}
          {arrows && !animate && (
            <>
              <polygon points={arrowHead(g.a, g.c, g.b, 0.4, true, 5)} fill={dirLevel(lt.ab)} stroke="var(--panel)" strokeWidth={0.75} />
              <polygon points={arrowHead(g.a, g.c, g.b, 0.6, false, -5)} fill={dirLevel(lt.ba)} stroke="var(--panel)" strokeWidth={0.75} />
            </>
          )}
        </>
      )}
      {/* Área de clic más ancha que la línea. */}
      <path d={g.d} fill="none" stroke="transparent" strokeWidth={12} />
      {(
        [
          [g.pa, g.l.aPort],
          [g.pb, g.l.bPort],
        ] as [Pt, string][]
      )
        .filter(([, label]) => label)
        .map(([pt, label], j) => (
          <text key={j} x={pt.x} y={pt.y} fontSize={11} textAnchor="middle" fill="var(--text)" stroke="var(--panel)" strokeWidth={4} paintOrder="stroke">
            {label}
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
      {sev && (
        <g style={{ cursor: "pointer" }} onClick={() => onIssue(g.l.a)}>
          <circle cx={g.mid.x} cy={g.mid.y - (midLabel ? 17 : 0)} r={8.5} fill={sev === "crit" ? "var(--danger)" : "var(--warn)"} stroke="var(--panel)" strokeWidth={2} />
          <text x={g.mid.x} y={g.mid.y - (midLabel ? 17 : 0) + 4} fontSize={12} fontWeight={700} textAnchor="middle" fill="#fff" pointerEvents="none">
            !
          </text>
        </g>
      )}
    </g>
  );
});

type L2Geo = { id: string; x: number; y: number; from: TopoNode; info: UnknownL2 };

/** Nodo virtual "L2 desconocido": puertos activos sin vecino de un equipo explorado. */
const L2View = memo(function L2View({ v, faded, onPick }: { v: L2Geo; faded: boolean; onPick: (id: string) => void }) {
  const { ports, macs, vendors } = v.info;
  return (
    <g style={{ cursor: "pointer" }} opacity={faded ? 0.35 : 1} onClick={() => onPick(v.id)}>
      <title>
        {[
          `${v.from.name}: ${plural(ports.length, "puerto activo", "puertos activos")} sin vecino CDP/LLDP`,
          `${ports.slice(0, 24).join(", ")}${ports.length > 24 ? "…" : ""}`,
          macs ? `${macs} MAC${vendors.length ? `: ${vendors.join(", ")}` : ""}` : "",
          "Hay algo conectado que no anuncia CDP/LLDP (PC, AP, cámara, switch no administrable). Con la fuente MAC/OUI se ve qué es.",
        ]
          .filter(Boolean)
          .join("\n")}
      </title>
      <line x1={v.from.x} y1={v.from.y} x2={v.x} y2={v.y} stroke="var(--muted)" strokeWidth={1.25} strokeDasharray="2 4" />
      <rect x={v.x - L2W / 2} y={v.y - L2H / 2} width={L2W} height={L2H} rx={8} fill="var(--panel)" stroke="var(--field-border)" strokeDasharray="3 3" />
      <text x={v.x} y={v.y - 2} fontSize={11.5} fontWeight={600} textAnchor="middle" fill="var(--text)">
        L2 desconocido
      </text>
      <text x={v.x} y={v.y + 12} fontSize={10.5} textAnchor="middle" fill="var(--muted)">
        {plural(ports.length, "puerto", "puertos")}
        {macs ? ` · ${macs} MAC` : ""}
      </text>
    </g>
  );
});

/** Un equipo del diagrama (memorizado: al arrastrar solo se redibuja el que se mueve). */
const NodeView = memo(function NodeView({
  n,
  ghost,
  isNew,
  onRoute,
  selected,
  faded,
  onDown,
  onMenu,
}: {
  n: TopoNode;
  ghost: boolean;
  isNew: boolean;
  onRoute: boolean;
  selected: boolean;
  faded: boolean;
  onDown: (e: React.PointerEvent<SVGGElement>, n: TopoNode) => void;
  onMenu: (e: React.MouseEvent<SVGGElement>, n: TopoNode) => void;
}) {
  const tentative = n.manual || n.addrOnly;
  const sub = nodeSub(n, ghost);
  return (
    <g style={{ cursor: ghost ? "default" : "grab" }} opacity={faded ? 0.35 : 1} onPointerDown={(e) => !ghost && e.button === 0 && onDown(e, n)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!ghost) onMenu(e, n);
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
        stroke={ghost ? "var(--danger)" : isNew ? "var(--ok)" : selected || onRoute ? "var(--accent)" : n.explored ? "var(--accent)" : "var(--field-border)"}
        strokeDasharray={ghost ? "5 4" : tentative ? "4 3" : undefined}
        strokeWidth={selected || onRoute || ghost || isNew ? 2.5 : 1.5}
      />
      <text x={n.x} y={n.y - 4} fontSize={13} fontWeight={600} textAnchor="middle" fill="var(--text)">
        {n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name}
      </text>
      <text x={n.x} y={n.y + 14} fontSize={11} textAnchor="middle" fill="var(--muted)">
        {sub}
      </text>
    </g>
  );
});

/** Píldora de tráfico sobre un enlace (o el centro de un par de paralelos). */
interface Pill {
  key: string;
  x: number;
  y: number;
  text: string;
  color: string;
  dim: boolean;
  keys: string[];
}

/**
 * Capas del mapa (enlaces, nodos L2, equipos y píldoras). Memorizadas: el zoom, el arrastre del
 * fondo, los mensajes y el panel cambian el estado de la herramienta sin tocar el diagrama, y con
 * cientos de equipos rehacer y comparar los elementos de cada enlace y equipo costaba decenas de ms
 * por redibujo.
 */
const TopoLayers = memo(function TopoLayers({
  geometry,
  nodes,
  l2Nodes,
  pills,
  byId,
  shownById,
  snapshot,
  hasRoute,
  routeKeys,
  routeNodes,
  removed,
  added,
  ghostIds,
  newIds,
  selected,
  focusLink,
  linkRates,
  color,
  arrows,
  animate,
  animKeys,
  pillPairs,
  checks,
  onIssue,
  onNodeDown,
  onNodeMenu,
  onPick,
}: {
  geometry: Geo[];
  nodes: TopoNode[];
  l2Nodes: L2Geo[];
  /** Píldoras de tráfico, o null con el rótulo apagado. */
  pills: Pill[] | null;
  byId: Map<string, TopoNode>;
  shownById: Map<string, TopoNode>;
  snapshot: TopoSnapshot | undefined;
  hasRoute: boolean;
  routeKeys: Set<string>;
  routeNodes: Set<string>;
  removed: Set<string>;
  added: Set<string>;
  ghostIds: Set<string>;
  newIds: Set<string>;
  selected: string | null;
  focusLink: string | null;
  linkRates: Map<string, LinkTraffic>;
  color: boolean;
  arrows: boolean;
  animate: boolean;
  animKeys: Set<string>;
  pillPairs: Set<string>;
  checks: Map<string, LinkIssue[]>;
  onIssue: (id: string) => void;
  onNodeDown: (e: React.PointerEvent<SVGGElement>, n: TopoNode) => void;
  onNodeMenu: (e: React.MouseEvent<SVGGElement>, n: TopoNode) => void;
  onPick: (id: string) => void;
}) {
  /** Nombre del equipo en el diagrama o en el snapshot (los ids son nombres normalizados en minúscula). */
  const anyName = (id: string) => byId.get(id)?.name ?? snapshot?.topo.nodes.find((n) => n.id === id)?.name ?? id;
  return (
    <>
      {geometry.map((g) => {
        const k = g.k;
        const isRoute = routeKeys.has(k);
        const state = removed.has(k) ? "removed" : added.has(k) ? "added" : null;
        const a = byId.get(g.l.a);
        const b = byId.get(g.l.b);
        return (
          <LinkView
            key={`${k}|${g.l.proto}`}
            g={g}
            a={a}
            b={b}
            aName={a?.name ?? anyName(g.l.a)}
            bName={b?.name ?? anyName(g.l.b)}
            ga={shownById.get(g.l.a)}
            gb={shownById.get(g.l.b)}
            state={state}
            isRoute={isRoute}
            hot={isRoute || focusLink === k || selected === g.l.a || selected === g.l.b}
            dim={hasRoute && !isRoute}
            lt={state ? undefined : linkRates.get(k)}
            color={color}
            arrows={arrows}
            animate={animate && animKeys.has(k)}
            noGroup={pillPairs.has(k)}
            issues={state === "removed" ? undefined : checks.get(k)}
            onIssue={onIssue}
          />
        );
      })}
      {l2Nodes.map((v) => (
        <L2View key={`l2:${v.id}`} v={v} faded={hasRoute && !routeNodes.has(v.id)} onPick={onPick} />
      ))}
      {nodes.map((n) => {
        const ghost = ghostIds.has(n.id);
        const onRoute = routeNodes.has(n.id);
        return (
          <NodeView
            key={n.id}
            n={n}
            ghost={ghost}
            isNew={newIds.has(n.id)}
            onRoute={onRoute}
            selected={selected === n.id}
            faded={hasRoute && !onRoute && !ghost}
            onDown={onNodeDown}
            onMenu={onNodeMenu}
          />
        );
      })}
      {/* Las píldoras van en una capa propia sobre los equipos: un enlace corto no las tapa. */}
      {pills?.map((t) => {
        const w = t.text.length * 6.4 + 12;
        return (
          <g key={t.key} opacity={t.dim ? 0.25 : 1} pointerEvents="none">
            <rect x={t.x - w / 2} y={t.y - 9} width={w} height={18} rx={9} fill="var(--panel)" stroke={t.color} strokeWidth={1.25} />
            <text x={t.x} y={t.y + 3.8} fontSize={11} fontWeight={600} textAnchor="middle" fill={t.color} style={{ fontVariantNumeric: "tabular-nums" }}>
              {t.text}
            </text>
          </g>
        );
      })}
    </>
  );
});

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
  onConfirm,
  lifecycle = false,
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
  /** Confirmación de la app (ConfirmDialog) para borrar o reemplazar el diagrama y los snapshots. */
  onConfirm: (req: ConfirmReq) => void;
  /** Ciclo de vida activado en Ajustes: muestra EoL y versión en el detalle del equipo. */
  lifecycle?: boolean;
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
  const [dismissedMap, setDismissedMap] = useState<DismissedMap>(loadDismissed);
  const dismissed = useMemo(() => dismissedSet(dismissedMap), [dismissedMap]);
  const dismiss = (id: string) =>
    setDismissedMap((m) => {
      const next = addDismissed(m, id);
      try {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
      } catch {
        /* solo comodidad */
      }
      return next;
    });
  const [pendingFollow, setPendingFollow] = useState<PendingFollow | null>(null);
  /**
   * Saltos hechos dentro de cada pestaña (ssh/telnet desde la consola del equipo), para vecinos
   * que solo se alcanzan desde el equipo inicial y no desde el PC. Pila por conexión.
   */
  const [hops, setHops] = useState<Record<string, { name: string; ip: string }[]>>({});
  const [hopUser, setHopUser] = useState("");
  const drag = useRef<{ id: string; sx: number; sy: number; x: number; y: number; w: number; h: number } | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const [ui, setUi] = useState<TopoUi>(loadUi);
  // El descubrimiento tarda segundos: el alcance se evalúa contra el diagrama vigente al terminar.
  const topoRef = useRef(topo);
  topoRef.current = topo;
  // Arrastrar un equipo solo cambia x/y: revisiones, sugerencias, conteos y búsqueda no se recalculan.
  const dataNodes = useNodeData(topo.nodes);
  const topoData = useMemo(() => ({ nodes: dataNodes, links: topo.links }), [dataNodes, topo.links]);
  const [filter, setFilter] = useState<TopoFilter>(NO_FILTER);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusReq, setFocusReq] = useState<string | Pt | null>(null);
  /** Enlace elegido en la tabla de tráfico: se resalta y se centra en el mapa. */
  const [focusLink, setFocusLink] = useState<string | null>(null);
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

  // Equipos alcanzados saltando en una pestaña: el tráfico por consola se lee por esa pestaña.
  const hopVia = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [conn, list] of Object.entries(hops)) for (const h of list) m[nodeId(h.name)] = conn;
    return m;
  }, [hops]);
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
    via: hopVia,
  });

  // Migra el diagrama de versiones anteriores (antes vivía en el navegador, fuera de la carpeta de datos).
  useEffect(() => {
    const old = legacyTopo();
    if (old && !topo.nodes.length) onTopo(old);
    if (old) localStorage.removeItem("topology");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Por defecto la sesión más reciente.
  useEffect(() => {
    if (!term && terminals.length) setConnId(terminals[terminals.length - 1].connId);
  }, [terminals, term]);
  // "Conectar y seguir la ruta": en cuanto la sesión abierta queda conectada, se elige sola en "Equipo".
  useEffect(() => {
    if (!pendingFollow) return;
    const t = followedTerminal(terminals, pendingFollow);
    if (!t) return;
    setConnId(t.connId);
    setPendingFollow(null);
    setMsg(`${t.name} conectado y elegido en "Equipo": pulsa "Descubrir vecinos" para seguir la ruta.`);
  }, [terminals, pendingFollow]);
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

  const selectedVendor = vendor;
  const discover = async (forced?: TopoVendor): Promise<void> => {
    if (!term) return;
    const vendor = forced ?? selectedVendor;
    setBusy(true);
    setMsg("");
    try {
      const outputs: string[] = [];
      for (const cmd of NEIGHBOR_COMMANDS[vendor]) {
        const out = await run(cmd);
        // Tras un salto el equipo puede ser de otra marca: su prompt lo dice y se repite con su sintaxis.
        if (!forced && !outputs.length) {
          const seen = vendorFromPrompt(out);
          if (seen && seen !== vendor) {
            setVendor(seen);
            return await discover(seen);
          }
        }
        outputs.push(out);
      }
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
      // Dentro de un salto la IP es la del vecino al que se saltó, no la de la sesión del PC.
      const chain = hops[term.connId] ?? [];
      const at = chain.findIndex((h) => nodeId(h.name) === nodeId(name));
      // La pila se ajusta a lo que dice el prompt (un "exit" tecleado a mano también cuenta).
      if (at >= 0 && at < chain.length - 1) setHops((h) => ({ ...h, [term.connId]: chain.slice(0, at + 1) }));
      if (at < 0 && chain.length && nodeId(name) === nodeId(term.name)) setHops((h) => ({ ...h, [term.connId]: [] }));
      const ip = at >= 0 ? chain[at].ip : chain.length && nodeId(name) !== nodeId(term.name) ? undefined : term.host;
      const sc = scopeNeighbors(topoRef.current, name, [...neighbors, ...routing], ui.scope);
      onTopo((t) => mergeNeighbors(t, { name, ip, ports, addrs, macs }, sc.kept));
      setSelected(nodeId(name));
      const parts = [
        `${plural(neighbors.length, "vecino", "vecinos")} CDP/LLDP`,
        routingOn && ROUTING_COMMANDS[vendor].length ? `${routing.length} de ruteo` : "",
        macs ? `${Object.keys(macs).length} puertos con MAC` : "",
        scopeNote(sc.skipped),
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
      // Alternativas en lecturas aparte: ARP antiguo y LLDP-V2-MIB (802.1AB-2009) si la de 2005 vino vacía.
      const extra = [...(opts.mac && needsArpFallback(r) ? ARP_FALLBACK : []), ...(needsLldpV2Fallback(r) ? LLDP_V2_FALLBACK : [])];
      if (extra.length) {
        const r2 = await invoke<TopoRead>("snmp_topo_read", { target, gets: [], walks: extra });
        r = { ...r, walks: [...r.walks, ...r2.walks], ms: r.ms + r2.ms };
      }
      // Cisco: la tabla MAC de BRIDGE-MIB es por VLAN (community@vlan en v2c, contexto vlan-N en v3).
      const vlanReads: VlanRead[] = [];
      let vlanNote = "";
      if (opts.mac && needsVlanFdb(r)) {
        const list = await invoke<TopoRead>("snmp_topo_read", { target, gets: [], walks: VLAN_LIST });
        r = { ...r, walks: [...r.walks, ...list.walks], ms: r.ms + list.ms };
        const { vlans, total } = activeVlans(list);
        for (const [i, vlan] of vlans.entries()) {
          setMsg(`Leyendo la tabla MAC de la VLAN ${vlan} (${i + 1} de ${vlans.length})…`);
          try {
            const read = await invoke<TopoRead>("snmp_topo_read", { target, gets: [], walks: VLAN_FDB_WALKS, vlan });
            vlanReads.push({ vlan, read });
            r = { ...r, ms: r.ms + read.ms };
          } catch (e) {
            vlanNote = `VLAN ${vlan}: ${String(e)}`;
          }
        }
        if (total > vlans.length) vlanNote = `Tabla MAC: se leyeron ${vlans.length} de ${total} VLAN (tope ${MAX_VLAN_READS}).`;
      }
      const d = parseSnmpDiscovery(r, opts, vlanReads);
      if (vlanNote) d.notes.push(vlanNote);
      let macs: Record<string, MacPort> | undefined;
      if (opts.mac) {
        const { lookupOui } = await import("../../lib/oui");
        macs = macPortsFromRows(d.macRows, d.arpRows, lookupOui);
      }
      const host = p.host.trim();
      const name = d.name ?? (p.name.trim() || host);
      const sc = scopeNeighbors(topoRef.current, name, [...d.neighbors, ...d.routing], ui.scope);
      onTopo((t) => mergeNeighbors(t, { name, ip: isIpv4(host) || isIpv6(host) ? host : undefined, ports: d.ports, addrs: d.addrs, macs }, sc.kept));
      setSelected(nodeId(name));
      traffic.prime(nodeId(name), p.id, d.ifIndex);
      const parts = [
        `${plural(d.neighbors.length, "vecino", "vecinos")} CDP/LLDP`,
        routingOn ? `${d.routing.length} de ruteo` : "",
        macs ? `${Object.keys(macs).length} puertos con MAC` : "",
        scopeNote(sc.skipped),
      ].filter(Boolean);
      const l2 = d.l2Empty
        ? "LLDP y CDP vacíos por SNMP: el protocolo está apagado en el equipo (o su agente no publica LLDP-MIB, LLDP-V2-MIB ni CISCO-CDP-MIB)."
        : "";
      const notes = d.notes.length ? `Avisos: ${d.notes.slice(0, 3).join("; ")}${d.notes.length > 3 ? ` y ${d.notes.length - 3} más` : ""}.` : "";
      setMsg([`${name}: ${parts.join(", ")} por SNMP en ${(r.ms / 1000).toFixed(1)} s.`, l2, notes].filter(Boolean).join(" "));
    } catch (e) {
      setMsg(`SNMP: ${String(e)}`);
    }
    setBusy(false);
  };

  // Índice por id: buscar con find por cada enlace era O(enlaces × equipos) en cada render.
  const topoById = useMemo(() => new Map(topo.nodes.map((n) => [n.id, n])), [topo.nodes]);
  const node = (id: string) => topoById.get(id);
  const sel = selected ? node(selected) : undefined;

  // Comparación con un snapshot: los enlaces y equipos que ya no están se dibujan fantasma.
  const snapshot = snapshots.find((s) => s.id === compareId);
  /** Nombre del equipo en el diagrama o en el snapshot (los ids son nombres normalizados en minúscula). */
  const anyName = (id: string) => node(id)?.name ?? snapshot?.topo.nodes.find((n) => n.id === id)?.name ?? id;
  const diff = useMemo(() => (snapshot ? diffTopology(snapshot.topo, topo) : null), [snapshot, topo]);
  // Arrastre: la posición vive aquí mientras se mueve y se guarda una vez al soltar (antes cada
  // cuadro actualizaba los ajustes de toda la app).
  const liveTopo = useMemo(
    () => (dragPos ? { ...topo, nodes: topo.nodes.map((n) => (n.id === dragPos.id ? { ...n, x: dragPos.x, y: dragPos.y } : n)) } : topo),
    [topo, dragPos],
  );
  const view: Topology = useMemo(() => {
    const topo = liveTopo;
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
  }, [diff, snapshot, liveTopo]);
  // Filtros: solo cambian lo que se dibuja; el diagrama guardado, las rutas y las exportaciones siguen completos.
  const shown = useMemo(() => filterView(view, filter), [view, filter]);
  const filtering = filterActive(filter);
  const checks = useMemo(() => linkChecks(topoData), [topoData]);
  const checkCount = useMemo(() => {
    let crit = 0;
    let warn = 0;
    for (const list of checks.values()) for (const i of list) i.sev === "crit" ? crit++ : warn++;
    return { crit, warn };
  }, [checks]);
  // Puertos activos sin vecino: un nodo virtual por equipo, del lado opuesto a sus vecinos.
  const l2 = useMemo(() => (ui.l2 ? unknownL2(topoData) : null), [ui.l2, topoData]);
  const l2Cache = useRef(new Map<string, L2Geo>());
  const l2Nodes = useMemo(() => {
    if (!l2?.size) return [];
    // Con muchos equipos se dibuja solo el del seleccionado: cientos de nodos virtuales tapan el mapa
    // y duplican lo que el navegador tiene que pintar.
    const only = l2.size > MAX_L2_NODES ? selected : null;
    if (l2.size > MAX_L2_NODES && !only) return [];
    const pos = new Map(shown.nodes.map((n) => [n.id, n]));
    const pull = new Map<string, [number, number]>();
    const add = (id: string, o: TopoNode | undefined) => {
      const n = pos.get(id);
      if (!n || !o) return;
      const [x, y] = pull.get(id) ?? [0, 0];
      pull.set(id, [x + o.x - n.x, y + o.y - n.y]);
    };
    for (const l of shown.links) {
      if (l2.has(l.a)) add(l.a, pos.get(l.b));
      if (l2.has(l.b)) add(l.b, pos.get(l.a));
    }
    const out: L2Geo[] = [];
    const next = new Map<string, L2Geo>();
    for (const [id, info] of l2) {
      if (only && id !== only) continue;
      const n = pos.get(id);
      if (!n) continue;
      const [dx, dy] = pull.get(id) ?? [0, 0];
      const len = Math.hypot(dx, dy);
      const [ux, uy] = len ? [-dx / len, -dy / len] : [0, 1];
      const x = n.x + ux * 130;
      const y = n.y + uy * 95;
      // Mismo objeto si no se movió: su L2View no se redibuja.
      const prev = l2Cache.current.get(id);
      const v = prev && prev.x === x && prev.y === y && prev.from.x === n.x && prev.from.y === n.y && prev.info === info ? prev : { id, x, y, from: n, info };
      next.set(id, v);
      out.push(v);
    }
    l2Cache.current = next;
    return out;
  }, [l2, shown, selected]);
  const hits: SearchHit[] = useMemo(() => (searchOpen ? searchTopo(topoData, query) : []), [topoData, query, searchOpen]);
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

  // Geometría estable: un enlace cuyo trazo no cambió conserva su objeto y su LinkView no se redibuja.
  const geoCache = useRef(new Map<TopoLink, Geo>());
  const geometry = useMemo(() => {
    const prev = geoCache.current;
    const next = new Map<TopoLink, Geo>();
    const out = linkGeometry(shown, shown.links, PARALLEL_GAP).map((g0) => {
      const p = prev.get(g0.l);
      // La clave se conserva mientras el enlace sea el mismo con los mismos extremos: al arrastrar
      // un equipo la geometría se rehace en cada cuadro y no hay que normalizar los puertos de nuevo.
      const k = p && p.l.a === g0.l.a && p.l.b === g0.l.b && p.l.aPort === g0.l.aPort && p.l.bPort === g0.l.bPort ? p.k : linkKey(g0.l);
      const g: Geo = Object.assign(g0, { k });
      const keep = p && p.d === g.d && p.pair.length === g.pair.length ? p : g;
      next.set(g.l, keep);
      return keep;
    });
    geoCache.current = next;
    return out;
  }, [shown]);
  const shownById = useMemo(() => new Map(shown.nodes.map((n) => [n.id, n])), [shown.nodes]);
  const onIssue = useCallback((id: string) => {
    setSelected(id);
    setUi((u) => ({ ...u, panel: true, sec: { ...u.sec, revisiones: true } }));
  }, []);
  /** Copia al portapapeles y lo confirma en el mensaje de la herramienta. */
  const copyText = (text: string, what: string) =>
    writeText(text)
      .then(() => setMsg(`${what} copiada: ${text.length > 80 ? `${text.slice(0, 79)}…` : text}`))
      .catch((e) => setMsg(`No se pudo copiar: ${String(e)}`));
  const [nodeMenu, setNodeMenu] = useState<Menu | null>(null);
  // Menú del equipo (clic derecho): la función cambia con el diagrama; NodeView recibe una estable.
  const nodeMenuRef = useRef<(e: React.MouseEvent<SVGGElement>, n: TopoNode) => void>(() => {});
  nodeMenuRef.current = (e, n) => {
    setSelected(n.id);
    const addrs = knownAddrs(n);
    setNodeMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        [n.ip ? `Copiar IP (${n.ip})` : "Copiar IP (sin IP de gestión)", <Copy size={13} />, () => n.ip && copyText(n.ip, "IP"), !n.ip],
        ["Copiar nombre", <Copy size={13} />, () => copyText(n.name, "Nombre")],
        ["Copiar nombre e IP", <Copy size={13} />, () => copyText(n.ip ? `${n.name} ${n.ip}` : n.name, "Nombre e IP"), !n.ip],
        ...(addrs.length > 1 ? [[`Copiar sus ${addrs.length} direcciones`, <Copy size={13} />, () => copyText(addrs.join("\n"), "Direcciones")] as MenuItem] : []),
        ["Ver su vecindario", <ListFilter size={13} />, () => setFilter((f) => ({ ...f, hops: f.hops || 2, focus: n.id }))],
      ],
    });
  };
  const onNodeMenu = useCallback((e: React.MouseEvent<SVGGElement>, n: TopoNode) => nodeMenuRef.current(e, n), []);
  const onNodeDown = useCallback((e: React.PointerEvent<SVGGElement>, n: TopoNode) => {
    const svg = e.currentTarget.ownerSVGElement as SVGSVGElement;
    svg.setPointerCapture(e.pointerId);
    // El tamaño en px del SVG se toma una vez: medirlo en cada movimiento forzaba un layout extra
    // del mapa por cuadro (el tamaño no cambia durante el arrastre; el viewBox sí puede).
    const r = svg.getBoundingClientRect();
    drag.current = { id: n.id, sx: e.clientX, sy: e.clientY, x: n.x, y: n.y, w: r.width, h: r.height };
    setSelected(n.id);
  }, []);

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
  /**
   * Rótulos de tráfico del mapa: una píldora corta por enlace (% de uso, o la tasa si no se conoce la
   * velocidad) sobre el centro de la línea, como las etiquetas de enlace de Weathermap o SolarWinds.
   * Los enlaces paralelos entre el mismo par llevan una sola, con el agregado y el peor uso. El
   * detalle por sentido queda en el tooltip y en la tabla del panel.
   */
  const trafficPills = useMemo(() => {
    if (!linkRates.size) return [];
    const pairKey = (l: TopoLink) => [l.a, l.b].sort().join("~");
    // Una pasada: por par, los centros de todas sus curvas, sus claves y los enlaces con tráfico.
    const pairs = new Map<string, { mids: Pt[]; keys: string[]; items: { g: Geo; lt: LinkTraffic }[] }>();
    for (const g of geometry) {
      const k = g.k;
      if (removed.has(k)) continue;
      const pk = pairKey(g.l);
      let e = pairs.get(pk);
      if (!e) pairs.set(pk, (e = { mids: [], keys: [], items: [] }));
      e.mids.push(g.mid);
      e.keys.push(k);
      const lt = linkRates.get(k);
      if (lt) e.items.push({ g, lt });
    }
    const out: Pill[] = [];
    for (const [pk, { mids, keys, items }] of pairs) {
      if (!items.length) continue;
      const worst = items.reduce((a, b) => ((b.lt.util ?? -1) > (a.lt.util ?? -1) ? b : a));
      const multi = items[0].g.pair.length > 1;
      const grp = multi ? linkGroup(shown, items[0].g.l, shownById) : undefined;
      const short = trafficShort(worst.lt);
      out.push({
        key: pk,
        x: mids.reduce((a, m) => a + m.x, 0) / mids.length,
        y: mids.reduce((a, m) => a + m.y, 0) / mids.length,
        text: multi ? `${grp ? `${grp} ×${items[0].g.pair.length}` : "máx"} · ${short}` : short,
        color: ui.color ? UTIL_VAR[utilLevel(worst.lt.util)] : "var(--text)",
        dim: !!route && !keys.some((k) => routeKeys.has(k)),
        keys,
      });
    }
    return out;
  }, [geometry, linkRates, removed, route, routeKeys, ui.color, shown, shownById]);
  /** Pares con píldora (todos sus enlaces): su rótulo de agregado ("Po1 ×2") ya va dentro de ella. */
  const pillPairs = useMemo(() => new Set(ui.rates ? trafficPills.flatMap((p) => p.keys) : []), [trafficPills, ui.rates]);

  /** Tabla del panel: cada enlace con tráfico, del más cargado al menos (sin velocidad, por tasa). */
  // Sin posiciones: al arrastrar un equipo la geometría cambia en cada cuadro, pero las filas no, y
  // se devuelve el mismo arreglo para que la tabla (memorizada) y la animación no se recalculen.
  const rowsRef = useRef<TrafficRow[]>([]);
  const trafficRows = useMemo(() => {
    const rows: TrafficRow[] = [];
    for (const g of geometry) {
      const k = g.k;
      const lt = linkRates.get(k);
      if (!lt || removed.has(k)) continue;
      rows.push({ key: k, a: node(g.l.a)?.name ?? anyName(g.l.a), b: node(g.l.b)?.name ?? anyName(g.l.b), aPort: g.l.aPort, bPort: g.l.bPort, lt });
    }
    const peak = (lt: LinkTraffic) => Math.max(lt.ab ?? 0, lt.ba ?? 0);
    rows.sort((x, y) => (y.lt.util ?? -1) - (x.lt.util ?? -1) || peak(y.lt) - peak(x.lt));
    const prev = rowsRef.current;
    const same = prev.length === rows.length && prev.every((r, i) => r.key === rows[i].key && r.lt === rows[i].lt && r.a === rows[i].a && r.b === rows[i].b);
    if (!same) rowsRef.current = rows;
    return rowsRef.current;
  }, [geometry, linkRates, removed]);
  /** Geometría a la vista, para ubicar el enlace que se elige en la tabla (sin un índice por cuadro). */
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  /**
   * Enlaces animados: solo los FLOW_MAX más cargados. Cada paso de la animación repinta el mapa, y
   * con cientos de enlaces animados una topología grande baja de 60 a pocos cuadros por segundo;
   * el resto conserva las flechas fijas.
   */
  const animKeys = useMemo(() => new Set(animate ? trafficRows.slice(0, FLOW_MAX).map((r) => r.key) : []), [animate, trafficRows]);
  const trafficHot = useMemo(() => trafficRows.filter((r) => (r.lt.util ?? 0) >= UTIL_WARN).length, [trafficRows]);
  const linksId = useId();
  const closeLinks = useCallback(() => setUi((u) => ({ ...u, sec: { ...u.sec, enlaces: false } })), []);
  /** Clic en la tabla: resalta el enlace y lo centra (otro clic en el mismo lo suelta). */
  const focusLinkRef = useRef(focusLink);
  focusLinkRef.current = focusLink;
  const pickLink = useCallback((r: TrafficRow) => {
    if (focusLinkRef.current === r.key) return setFocusLink(null);
    setFocusLink(r.key);
    const mid = geometryRef.current.find((g) => g.k === r.key)?.mid;
    if (!mid) return;
    setZoom((z) => Math.max(z, 1.4));
    setFocusReq(mid);
  }, []);
  // El enlace elegido dejó de tener tráfico o de estar a la vista: se suelta el resaltado.
  useEffect(() => {
    if (focusLink && !trafficRows.some((r) => r.key === focusLink)) setFocusLink(null);
  }, [focusLink, trafficRows]);

  // Sugerencias: se calculan del diagrama ya leído, sin comandos, y solo con su fuente activa.
  const suggestions = useMemo(() => collectSuggestions(topoData, sources, dismissed), [topoData, sources, dismissed]);
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
    if (!shown.nodes.length) return { x: 0, y: 0, w: 800, h: 400 };
    // En mapas grandes el nodo L2 es solo el del seleccionado: no cuenta para el encuadre, que si
    // no cambiaría (y se redibujaría todo el mapa) con cada selección.
    const l2Box = l2 && l2.size > MAX_L2_NODES ? [] : l2Nodes;
    const xs = [...shown.nodes.map((n) => n.x), ...l2Box.map((n) => n.x)];
    const ys = [...shown.nodes.map((n) => n.y), ...l2Box.map((n) => n.y)];
    const pad = 30;
    const x = Math.min(...xs) - W / 2 - pad;
    const y = Math.min(...ys) - H / 2 - pad;
    return { x, y, w: Math.max(...xs) - x + W / 2 + pad, h: Math.max(...ys) - y + H / 2 + pad };
  }, [shown.nodes, l2Nodes, l2]);

  /** Suelta el equipo: la posición final se guarda en el diagrama una sola vez. */
  const endDrag = () => {
    drag.current = null;
    if (!dragPos) return;
    const { id, x, y } = dragPos;
    onTopo((t) => ({ ...t, nodes: t.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) }));
    setDragPos(null);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    // El SVG se ajusta al contenedor manteniendo proporción: manda el eje más ajustado.
    const scale = Math.max(box.w / d.w, box.h / d.h);
    const x = d.x + (e.clientX - d.sx) * scale;
    const y = d.y + (e.clientY - d.sy) * scale;
    setDragPos({ id: d.id, x, y });
  };

  const exportFile = async (ext: "svg" | "csv" | "drawio", content: string) => {
    const name = ext === "drawio" ? "draw.io" : ext.toUpperCase();
    const dest = await save({ defaultPath: `topologia.${ext}`, filters: [{ name, extensions: [ext] }] });
    if (!dest) return;
    await invoke("save_text", { dest, content }).then(() => setMsg(`Guardado: ${dest}`)).catch((e) => setMsg(String(e)));
  };

  /**
   * draw.io con los íconos de red de su biblioteca Cisco, zonas por carpeta de la sesión guardada
   * y, con el ciclo de vida activo, la etapa EoL bajo cada equipo.
   */
  const exportDrawioIcons = async () => {
    const [{ toDrawioIcons }, life] = await Promise.all([
      import("../../lib/topoDrawio"),
      lifecycle ? import("../../lib/lifecycle").then(async (L) => ({ L, db: await L.loadLifecycle() })) : null,
    ]);
    const zones = new Map<string, string>();
    const notes = new Map<string, string>();
    const today = new Date().toISOString().slice(0, 10);
    for (const n of topo.nodes) {
      const folder = savedFor(n)?.folder?.trim();
      if (folder) zones.set(n.id, folder);
      const model = life && modelFromPlatform(n.platform);
      if (life && model) {
        const level = life.L.lifeLevel(life.L.findLifecycle(life.db, model), today);
        if (level !== "none") notes.set(n.id, life.L.LIFE_LABEL[level]);
      }
    }
    await exportFile("drawio", toDrawioIcons(topo, { zones, notes, l2: ui.l2 }));
  };

  /** Sesión guardada que corresponde al equipo (misma IP o mismo nombre). */
  const savedFor = (n: TopoNode) =>
    sessions.find((s) => (s.type === "ssh" || s.type === "telnet") && ((n.ip && s.host === n.ip) || nodeId(s.name) === n.id));

  const follow = (n: TopoNode) => {
    const saved = savedFor(n);
    const known = terminals.map((t) => t.connId);
    if (saved) {
      setPendingFollow({ sessionId: saved.id, host: saved.host, known });
      onOpenSession(saved);
      setMsg(`Abriendo la sesión guardada "${saved.name}": autentícate en su pestaña. Al conectar queda elegida aquí; vuelve y pulsa "Descubrir vecinos".`);
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
    setPendingFollow({ host: n.ip, known });
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
    setMsg(`Abriendo ${proto.toUpperCase()} a ${n.name}: autentícate en su pestaña. Al conectar queda elegida aquí; vuelve y pulsa "Descubrir vecinos".`);
  };

  const hopRoute = term ? (hops[term.connId] ?? []) : [];
  const here = hopRoute.length ? hopRoute[hopRoute.length - 1].name : term?.name;

  /** Salta al vecino desde la consola del equipo actual, en la misma pestaña. */
  const hopTo = (n: TopoNode) => {
    if (!term || !n.ip) return;
    const user = (hopUser || term.session.username || "").trim();
    const cmd = hopCommand(vendor, term.session.platform, proto, user, n.ip);
    if (!cmd) {
      setMsg(isIpv4(n.ip) || isIpv6(n.ip) ? "Escribe un usuario válido para el salto (sin espacios)." : `IP de gestión no válida: ${n.ip.slice(0, 64)}`);
      return;
    }
    invoke("write", { id: term.connId, data: `${cmd}\r` }).catch((e) => setMsg(String(e)));
    setHops((h) => ({ ...h, [term.connId]: [...(h[term.connId] ?? []), { name: n.name, ip: n.ip! }] }));
    setMsg(`Enviado "${cmd}" en la pestaña de ${term.name}: autentícate ahí. Cuando veas el prompt de ${n.name}, vuelve y pulsa "Descubrir vecinos".`);
  };

  /** Vuelve al equipo anterior de la ruta (exit en la misma pestaña). */
  const hopBack = () => {
    if (!term || !hopRoute.length) return;
    invoke("write", { id: term.connId, data: "exit\r" }).catch((e) => setMsg(String(e)));
    setHops((h) => ({ ...h, [term.connId]: hopRoute.slice(0, -1) }));
    setMsg(`Enviado "exit": vuelves a ${hopRoute.length > 1 ? hopRoute[hopRoute.length - 2].name : term.name}.`);
  };

  const saveSnapshot = () => {
    const name = snapName?.trim() || `Topología ${new Date().toLocaleString()}`;
    const snap: TopoSnapshot = { id: `s${Date.now()}`, name, ts: Date.now(), topo };
    const save = () => {
      onSnapshots([snap, ...snapshots].slice(0, MAX_SNAPSHOTS));
      setSnapName(null);
      setMsg(`Snapshot guardado: ${name}`);
    };
    // Sobre el tope se descarta el más antiguo: se avisa cuál antes de guardar.
    const dropped = snapshots.slice(MAX_SNAPSHOTS - 1);
    if (dropped.length)
      onConfirm({
        title: "¿Guardar y eliminar el snapshot más antiguo?",
        message: `Se guardan hasta ${MAX_SNAPSHOTS} snapshots. Al guardar "${name}" se elimina ${dropped.length === 1 ? "el más antiguo" : `los ${dropped.length} más antiguos`}: ${dropped.map((d) => `"${d.name}"`).join(", ")}.`,
        label: "Guardar",
        danger: true,
        defaultCancel: true,
        action: save,
      });
    else save();
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

  /** Selecciona un equipo, acerca y lo centra en la vista (si un filtro lo oculta, se quitan los filtros). */
  const focusOn = (id: string) => {
    if (!shown.nodes.some((n) => n.id === id)) setFilter(NO_FILTER);
    setSelected(id);
    setZoom((z) => Math.max(z, 1.6));
    setFocusReq(id);
  };
  // Se centra después del render con el zoom nuevo (el SVG ya tiene su tamaño final).
  useEffect(() => {
    if (!focusReq) return;
    setFocusReq(null);
    const el = scroller.current;
    const n = typeof focusReq === "string" ? shown.nodes.find((x) => x.id === focusReq) : focusReq;
    if (!el || !n) return;
    const w = el.clientWidth * zoom;
    const h = el.clientHeight * zoom;
    const k = Math.min(w / box.w, h / box.h);
    const left = (w - box.w * k) / 2 + (n.x - box.x) * k - el.clientWidth / 2;
    const top = (h - box.h * k) / 2 + (n.y - box.y) * k - el.clientHeight / 2;
    el.scrollTo({ left, top, behavior: reducedMotion ? "auto" : "smooth" });
  }, [focusReq, shown, zoom, box, reducedMotion]);

  // Zoom con pellizco (touchpad) o Ctrl/⌘ + rueda, hacia el punto bajo el puntero.
  // Un pellizco o la rueda entregan varios eventos por cuadro: se junta todo en un redibujo por
  // cuadro (cada uno relayouta el mapa completo al cambiar el tamaño del SVG).
  const zoomFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(zoomFrame.current), []);
  const zoomRef = useRef(zoom);
  // Con un redibujo pendiente, el valor que manda es el del último evento, no el del estado.
  if (!zoomFrame.current) zoomRef.current = zoom;
  const zoomAnchor = useRef<{ cx: number; cy: number; sx: number; sy: number; from: number } | null>(null);
  const zoomAt = useCallback((next: number, cx: number, cy: number) => {
    const el = scroller.current;
    const from = zoomRef.current;
    const to = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    if (!el || Math.abs(to - from) < 0.001) return;
    // Varios eventos antes de redibujar (lo normal en un touchpad): el ancla parte del último zoom dibujado.
    const pending = zoomAnchor.current;
    zoomAnchor.current = pending ? { ...pending, cx, cy } : { cx, cy, sx: el.scrollLeft, sy: el.scrollTop, from };
    zoomRef.current = to;
    if (!zoomFrame.current) {
      zoomFrame.current = requestAnimationFrame(() => {
        zoomFrame.current = 0;
        setZoom(zoomRef.current);
      });
    }
  }, []);
  // El dibujo crece en proporción al zoom: se corre el scroll para que el punto bajo el puntero no se mueva.
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    const el = scroller.current;
    if (!a || !el) return;
    zoomAnchor.current = null;
    const f = zoom / a.from;
    el.scrollLeft = (a.sx + a.cx) * f - a.cx;
    el.scrollTop = (a.sy + a.cy) * f - a.cy;
  }, [zoom]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const local = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      return [x - r.left, y - r.top] as const;
    };
    // Rueda del mouse: zoom anclado al puntero, como un mapa. Pellizco del touchpad en Windows,
    // Linux y Chromium: llega como rueda con ctrlKey. Dos dedos en el touchpad sin pellizco y
    // Shift + rueda: desplazamiento normal (el mapa también se mueve arrastrando el fondo).
    let gesturing = false;
    const onWheel = (e: WheelEvent) => {
      const pinch = e.ctrlKey || e.metaKey;
      if (!pinch && (e.shiftKey || isTrackpadScroll(e as WheelEvent & { wheelDeltaY?: number }))) return;
      e.preventDefault();
      if (gesturing) return;
      const [cx, cy] = local(e.clientX, e.clientY);
      if (pinch) {
        const d = Math.max(-50, Math.min(50, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
        zoomAt(zoomRef.current * Math.exp(-d * 0.01), cx, cy);
      } else {
        // Un paso de rueda (100 px) acerca o aleja un 16 %.
        const d = Math.max(-300, Math.min(300, e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY));
        zoomAt(zoomRef.current * Math.exp(-d * 0.0015), cx, cy);
      }
    };
    // macOS (WebKit): el pellizco llega como gesto con su escala.
    let base = 1;
    type Gesture = Event & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gesturing = true;
      base = zoomRef.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Gesture;
      const [cx, cy] = local(g.clientX, g.clientY);
      zoomAt(base * g.scale, cx, cy);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gesturing = false;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    el.addEventListener("gestureend", onGestureEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureEnd);
    };
  }, [zoomAt]);

  // Arrastrar el fondo (o con el botón del medio, en cualquier parte) mueve el mapa: con la rueda
  // dedicada al zoom, es la forma de desplazarse con mouse.
  const [panning, setPanning] = useState(false);
  const endPan = useRef<(() => void) | null>(null);
  // Si la herramienta se cierra a mitad de un arrastre, no quedan escuchas en la ventana.
  useEffect(() => () => endPan.current?.(), []);
  const startPan = (e: React.PointerEvent<SVGSVGElement>) => {
    const el = scroller.current;
    const onBackground = e.button === 0 && e.target === e.currentTarget;
    if (!el || !(onBackground || e.button === 1)) return;
    e.preventDefault();
    endPan.current?.();
    const start = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
    setPanning(true);
    const move = (ev: PointerEvent) => {
      el.scrollLeft = start.sl - (ev.clientX - start.x);
      el.scrollTop = start.st - (ev.clientY - start.y);
    };
    // pointercancel: en pantallas táctiles el navegador puede quedarse con el gesto sin pointerup.
    const up = () => {
      endPan.current = null;
      setPanning(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    endPan.current = up;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  // Ctrl/⌘+C con un equipo seleccionado en el mapa copia su IP, salvo que haya texto
  // seleccionado o el foco esté en un campo (ahí manda la copia normal).
  const selIp = selected ? topoById.get(selected)?.ip : undefined;
  useEffect(() => {
    if (!visible || !selIp) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "c") return;
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
      if (window.getSelection()?.toString()) return;
      e.preventDefault();
      void copyText(selIp, "IP");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, selIp]);

  const pickHit = (h: SearchHit) => {
    focusOn(h.id);
    setSearchOpen(false);
    setMsg(`${node(h.id)?.name ?? h.id}: ${h.what}${h.detail ? ` ${h.detail}` : ""}`);
  };

  /** Chips de un criterio de filtro: solo los valores presentes en el diagrama, con su cantidad. */
  const chipGroup = <K extends string>(label: string, field: "roles" | "vendors" | "protos" | "states", counts: Map<K, number>, names: (k: K) => string) =>
    counts.size > 0 && (
      <div>
        <p className="mb-1 text-[11.5px] font-medium text-muted">{label}</p>
        <div className="flex flex-wrap gap-1">
          {[...counts].map(([k, c]) => {
            const list = filter[field] as string[];
            const on = list.includes(k);
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter((f) => ({ ...f, [field]: on ? list.filter((x) => x !== k) : [...list, k] }))}
                className={`h-7 px-2 rounded-md border text-[11.5px] ${on ? "border-[var(--accent)] text-accent bg-[var(--selected)]" : "border-line hover:bg-hover"}`}
              >
                {names(k)} <span className="text-muted">{c}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  const countBy = <K extends string>(items: K[]) => {
    const m = new Map<K, number>();
    for (const k of items) m.set(k, (m.get(k) ?? 0) + 1);
    return new Map([...m].sort((a, b) => b[1] - a[1]));
  };
  const roleCounts = useMemo(() => countBy<NodeRole>(dataNodes.map((n) => nodeRole(n))), [dataNodes]);
  const vendorCounts = useMemo(() => countBy<NodeVendor>(dataNodes.map((n) => nodeVendor(n))), [dataNodes]);
  const stateCounts = useMemo(() => countBy<NodeState>(dataNodes.map(nodeState)), [dataNodes]);
  const protoCounts = useMemo(() => countBy<string>(topo.links.map((l) => String(l.proto))), [topo.links]);
  const scopeErr = parseCidrs(ui.scope.cidrs).error;
  const setScope = (p: Partial<TopoScope>) => setUi((u) => ({ ...u, scope: { ...u.scope, ...p } }));
  const scopeSummary =
    [ui.scope.skipEndpoints && "sin teléfonos ni AP", ui.scope.cidrs.trim() && !scopeErr && ui.scope.cidrs.trim(), ui.scope.maxDepth && `hasta ${ui.scope.maxDepth} saltos`]
      .filter(Boolean)
      .join(" · ") || "Sin restricciones";
  const issueList = useMemo(() => {
    const byKey = new Map(topo.links.map((l) => [linkKey(l), l]));
    return [...checks]
      .flatMap(([k, list]) => (byKey.has(k) ? list.map((i) => ({ k, ...i, l: byKey.get(k)! })) : []))
      .sort((x, y) => Number(y.sev === "crit") - Number(x.sev === "crit"));
  }, [checks, topo.links]);
  const showChecks = () => {
    setUi((u) => ({ ...u, panel: true, sec: { ...u.sec, revisiones: true } }));
  };

  // Leyenda solo con lo que hay en la vista y solo si hay algo más que CDP/LLDP.
  const legendKinds = LINK_LEGEND.filter(([, s]) => linkDash(s) && shown.links.some((l) => linkDash(l) === linkDash(s)));
  const hasPhysical = shown.links.some((l) => !linkDash(l));
  const hasTentative = shown.nodes.some((n) => n.manual || n.addrOnly);
  const hasTraffic = linkRates.size > 0;
  const showLegend = legendKinds.length > 0 || hasTentative || hasTraffic;

  const activeSources = TOPO_SOURCES.filter((s) => sourceOn(sources, s.id)).length;
  const trafficSummary = !trafficOn
    ? "Apagado"
    : !visible
      ? "En pausa (herramienta oculta)"
      : `Cada ${ui.interval} s · ${plural(linkRates.size, "enlace", "enlaces")} con datos${trafficCli ? " · también por consola" : ""}`;
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
            <Btn kind="primary" disabled={!term || busy} onClick={() => void discover()} title={hint}>
              <Radar size={14} className={busy ? "animate-pulse" : ""} /> {busy ? "Leyendo…" : "Descubrir vecinos"}
            </Btn>
          ) : (
            <Btn kind="primary" disabled={!profile || busy} onClick={discoverSnmp} title="Lee LLDP-MIB y CISCO-CDP-MIB (y las fuentes activas) con GETBULK, solo lectura">
              <Radar size={14} className={busy ? "animate-pulse" : ""} /> {busy ? "Leyendo…" : "Descubrir por SNMP"}
            </Btn>
          )}
        </div>
        {mode === "cli" && term && hopRoute.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px]">
            <span className="text-muted">Ruta en la pestaña de {term.name}:</span>
            <span className="font-medium">{[term.name, ...hopRoute.map((h) => h.name)].join(" → ")}</span>
            <Btn className="!h-6 !px-2 !text-[11.5px]" disabled={busy} onClick={hopBack} title='Envía "exit" en la pestaña: vuelve al equipo anterior'>
              Volver a {hopRoute.length > 1 ? hopRoute[hopRoute.length - 2].name : term.name}
            </Btn>
          </div>
        )}
        {mode === "snmp" && (
          <p className="mt-1.5 text-[11.5px] text-muted">
            Solo lectura con el perfil y sus secretos de la bóveda; tope de 10.000 filas y 20 s por tabla. Si LLDP y CDP vuelven vacíos por SNMP, el protocolo está apagado en el equipo.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1 mt-2.5 @max-[860px]:[&_button]:px-2" role="toolbar" aria-label="Diagrama">
          <Btn kind="ghost" title="Acercar (o rueda del mouse o pellizco del touchpad sobre el mapa; arrastra el fondo para moverlo)" onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + 0.2))}>
            <ZoomIn size={14} />
          </Btn>
          <Btn kind="ghost" title="Alejar (o rueda del mouse o pellizco del touchpad sobre el mapa; arrastra el fondo para moverlo)" onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - 0.2))}>
            <ZoomOut size={14} />
          </Btn>
          <Btn kind="ghost" title="Ajustar a la vista" aria-label="Ajustar a la vista" onClick={fit}>
            <Maximize2 size={14} />
          </Btn>
          <Btn kind="ghost" title="Reordenar automáticamente" onClick={() => onTopo((t) => layout({ ...t, nodes: t.nodes.map((n) => ({ ...n, x: 0, y: 0 })) }))}>
            <Network size={14} />
          </Btn>
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
            <input
              type="search"
              className="field !h-8 !pl-7 !w-64 @max-[860px]:!w-48 !text-[12px]"
              placeholder="Buscar (nombre, IP, MAC, puerto)"
              title="Busca por nombre, IP, MAC, interfaz o descripción; Enter va al primero"
              aria-label="Buscar en el diagrama"
              disabled={!topo.nodes.length}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && hits[0]) pickHit(hits[0]);
                if (e.key === "Escape") setSearchOpen(false);
              }}
            />
            {searchOpen && query.trim().length >= 2 && (
              <ul className="absolute z-20 left-0 top-full mt-1 w-72 max-h-72 overflow-y-auto rounded-lg border border-line bg-panel shadow-pop py-1 text-[12px]" role="listbox">
                {hits.length ? (
                  hits.map((h, i) => (
                    <li key={`${h.id}${i}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={i === 0}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickHit(h)}
                        className="w-full text-left px-3 py-1.5 hover:bg-hover"
                      >
                        <span className="font-medium">{node(h.id)?.name ?? h.id}</span>
                        <span className="block text-[11px] text-muted truncate">
                          {h.what}
                          {h.detail ? `: ${h.detail}` : ""}
                        </span>
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="px-3 py-1.5 text-muted">Sin resultados</li>
                )}
              </ul>
            )}
          </div>
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
                  ["draw.io con íconos de red", <Download size={13} />, () => void exportDrawioIcons()],
                  ["draw.io simple (cajas)", <Download size={13} />, () => exportFile("drawio", toDrawio(topo, W, H))],
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
          {nodeMenu && <ContextMenu menu={nodeMenu} onClose={() => setNodeMenu(null)} />}
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
            {filtering && (
              <Btn title="Hay filtros activos: el diagrama muestra una parte" onClick={() => setUi((u) => ({ ...u, panel: true, sec: { ...u.sec, filtros: true } }))}>
                <ListFilter size={14} className="text-accent" aria-hidden /> <span className="@max-[860px]:sr-only">{shown.nodes.length} de {view.nodes.length}</span>
              </Btn>
            )}
            {issueList.length > 0 && (
              <Btn title="Ver las revisiones de enlaces en el panel" aria-label={`Ver ${issueList.length} revisiones de enlaces`} onClick={showChecks}>
                <TriangleAlert size={14} className={checkCount.crit ? "text-danger" : "text-warn"} aria-hidden /> <span className="@max-[860px]:sr-only">Revisiones</span>{" "}
                <CountBadge n={issueList.length} />
              </Btn>
            )}
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
          const manual = topo.nodes.filter((n) => n.manual).length + topo.links.filter((l) => isUserProto(l.proto)).length;
          onConfirm({
            title: "¿Borrar el diagrama?",
            message: `Se borran ${topo.nodes.length} ${topo.nodes.length === 1 ? "equipo" : "equipos"} y ${topo.links.length} ${topo.links.length === 1 ? "enlace" : "enlaces"}${manual ? `, incluidos ${manual} ${manual === 1 ? "elemento agregado" : "elementos agregados"} a mano o desde sugerencias` : ""}. Los snapshots no se tocan: guarda uno antes si quieres recuperarlo.`,
            label: "Borrar diagrama",
            danger: true,
            defaultCancel: true,
            action: () => {
              onTopo({ nodes: [], links: [] });
              setSelected(null);
              setPath({});
            },
          });
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
      ) : !shown.nodes.length ? (
        <div className="h-full grid place-items-center text-[12.5px] text-muted p-6 text-center">
          <div className="space-y-2">
            <p>Ningún equipo coincide con los filtros.</p>
            <Btn onClick={() => setFilter(NO_FILTER)}>Quitar filtros</Btn>
          </div>
        </div>
      ) : (
        <svg
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%`, cursor: panning ? "grabbing" : "grab" }}
          onPointerDown={startPan}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
        >
          <TopoLayers
            geometry={geometry}
            nodes={shown.nodes}
            l2Nodes={l2Nodes}
            pills={ui.rates ? trafficPills : null}
            byId={topoById}
            shownById={shownById}
            snapshot={snapshot}
            hasRoute={!!route}
            routeKeys={routeKeys}
            routeNodes={routeNodes}
            removed={removed}
            added={added}
            ghostIds={ghostIds}
            newIds={newIds}
            selected={selected}
            focusLink={focusLink}
            linkRates={linkRates}
            color={ui.color}
            arrows={ui.arrows}
            animate={animate}
            animKeys={animKeys}
            pillPairs={pillPairs}
            checks={checks}
            onIssue={onIssue}
            onNodeDown={onNodeDown}
            onNodeMenu={onNodeMenu}
            onPick={setSelected}
          />
        </svg>
      )}
          </div>
          {!ui.panel && sel && (
            <div className="absolute top-2 left-2 flex items-center gap-2 max-w-[calc(100%-1rem)] rounded-lg border border-line bg-panel shadow-pop pl-3 pr-1 py-1 text-[12px]">
              <span className="font-medium truncate">{sel.name}</span>
              {sel.ip && (
                <Btn kind="ghost" className="!h-6 !px-2 !text-[11.5px]" title={`Copiar IP (${sel.ip})`} aria-label={`Copiar IP ${sel.ip}`} onClick={() => copyText(sel.ip!, "IP")}>
                  <Copy size={12} /> <span className="font-mono">{sel.ip}</span>
                </Btn>
              )}
              <Btn kind="ghost" className="!h-6 !px-2 !text-[11.5px] !text-accent" onClick={() => setUi((u) => ({ ...u, panel: true, sec: { ...u.sec, detalle: true } }))}>
                Ver detalle
              </Btn>
            </div>
          )}
          {(showLegend || trafficRows.length > 0) && (
            <div className="absolute bottom-2 left-2 flex flex-col items-start gap-1.5 max-w-[calc(100%-1rem)]">
              {isOpen("enlaces") && trafficRows.length > 0 && (
                <TrafficTable
                  id={linksId}
                  rows={trafficRows}
                  byUtil={ui.color}
                  focus={focusLink}
                  onPick={pickLink}
                  onClose={closeLinks}
                />
              )}
              {showLegend && isOpen("leyenda") && (
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
                      {ui.color && <span className="mt-1 font-medium text-fg">Tráfico (color y grosor por utilización)</span>}
                      {ui.color && UTIL_LEGEND.map(([text, lv]) => (
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
                        Una flecha por sentido · rótulo con el % de uso del sentido más cargado (≈: aproximada; detalle al pasar el mouse y en "Enlaces")
                      </span>}
                    </>
                  )}
                </div>
              )}
              <div className="flex items-center gap-1.5">
                {showLegend && (
                  <button
                    type="button"
                    aria-expanded={isOpen("leyenda")}
                    aria-controls={legendId}
                    onClick={() => setUi((u) => ({ ...u, sec: { ...u.sec, leyenda: !u.sec.leyenda, enlaces: false } }))}
                    className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-line bg-panel text-[11.5px] text-muted hover:text-fg hover:bg-hover"
                  >
                    <ChevronUp size={13} aria-hidden className={`transition-transform ${isOpen("leyenda") ? "" : "rotate-180"}`} />
                    Leyenda
                  </button>
                )}
                {trafficRows.length > 0 && (
                  // Una sola tarjeta abierta a la vez: la leyenda y la tabla comparten la esquina.
                  <button
                    type="button"
                    aria-expanded={isOpen("enlaces")}
                    aria-controls={linksId}
                    title="Enlaces con tráfico, del más cargado al menos"
                    onClick={() => setUi((u) => ({ ...u, sec: { ...u.sec, enlaces: !u.sec.enlaces, leyenda: false } }))}
                    className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md border bg-panel text-[11.5px] hover:bg-hover ${isOpen("enlaces") ? "border-[var(--accent)] text-accent" : "border-line text-muted hover:text-fg"}`}
                  >
                    <ChevronUp size={13} aria-hidden className={`transition-transform ${isOpen("enlaces") ? "" : "rotate-180"}`} />
                    Enlaces
                    {trafficHot > 0 ? (
                      <span className="ml-0.5 rounded-full px-1.5 text-[10.5px] font-semibold text-white" style={{ background: "var(--danger)" }} title={`${trafficHot} sobre 70 %`}>
                        {trafficHot}
                      </span>
                    ) : (
                      <span className="ml-0.5 tabular-nums">{trafficRows.length}</span>
                    )}
                  </button>
                )}
              </div>
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

            <Collapsible title="Alcance del descubrimiento" summary={scopeSummary} open={isOpen("alcance")} onToggle={(v) => setOpen("alcance", v)}>
              <div className="space-y-2.5 text-[12px]">
                <p className="text-[11px] text-muted leading-snug">
                  Qué vecinos nuevos se agregan al descubrir. Los que ya están en el diagrama conservan su enlace. No cambia los comandos que se envían.
                </p>
                <div>
                  <Toggle checked={ui.scope.skipEndpoints} onChange={(skipEndpoints) => setScope({ skipEndpoints })} label="Sin teléfonos IP ni access points" />
                  <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">Según la plataforma y las capacidades que anuncian por CDP/LLDP.</p>
                </div>
                <Label text="Solo estas redes (CIDR, separadas por coma)">
                  <input
                    className="field font-mono !text-[12px]"
                    placeholder="10.0.0.0/8, 192.168.10.0/24"
                    maxLength={500}
                    aria-invalid={!!scopeErr}
                    value={ui.scope.cidrs}
                    onChange={(e) => setScope({ cidrs: e.target.value })}
                  />
                </Label>
                {scopeErr ? (
                  <p className="text-[11.5px] text-danger">{scopeErr}. Mientras tanto no se filtra por red.</p>
                ) : (
                  <p className="text-[11px] text-muted leading-snug">Un vecino sin IP de gestión informada se agrega igual.</p>
                )}
                <label className="flex items-center gap-2">
                  <span className="text-muted">Profundidad máxima</span>
                  <select className="field !h-7 !w-36 !text-[12px]" value={ui.scope.maxDepth} onChange={(e) => setScope({ maxDepth: Number(e.target.value) })}>
                    <option value={0}>Sin límite</option>
                    {[1, 2, 3, 4, 5, 6, 8, 10].map((d) => (
                      <option key={d} value={d}>
                        {plural(d, "salto", "saltos")}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </Collapsible>

            <Collapsible
              title="Filtros"
              summary={filtering ? `Mostrando ${shown.nodes.length} de ${view.nodes.length} equipos` : "Todo a la vista"}
              open={isOpen("filtros")}
              onToggle={(v) => setOpen("filtros", v)}
              right={
                filtering && (
                  <Btn kind="ghost" className="!px-1.5 !text-[11.5px]" title="Quitar todos los filtros" onClick={() => setFilter(NO_FILTER)}>
                    <X size={13} /> Quitar
                  </Btn>
                )
              }
            >
              <div className="space-y-2.5 text-[12px]">
                {chipGroup("Rol (estimado por plataforma y capacidades)", "roles", roleCounts, (k) => ROLE_LABEL[k])}
                {chipGroup("Fabricante", "vendors", vendorCounts, (k) => VENDOR_LABEL[k])}
                {chipGroup("Origen del enlace", "protos", protoCounts, (k) => (k === "manual" ? "Manual" : k))}
                {chipGroup("Estado", "states", stateCounts, (k) => STATE_LABEL[k])}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted">Solo a</span>
                  <select
                    className="field !h-7 !w-28 !text-[12px]"
                    aria-label="Saltos desde el equipo foco"
                    value={filter.hops}
                    onChange={(e) => {
                      const hops = Number(e.target.value);
                      setFilter((f) => ({ ...f, hops, focus: hops ? (f.focus ?? selected ?? nodesByName[0]?.id) : f.focus }));
                    }}
                  >
                    <option value={0}>sin límite</option>
                    {[1, 2, 3, 4, 5].map((d) => (
                      <option key={d} value={d}>
                        {plural(d, "salto", "saltos")}
                      </option>
                    ))}
                  </select>
                  <span className="text-muted">de</span>
                  <select
                    className="field !h-7 flex-1 min-w-0 !text-[12px]"
                    aria-label="Equipo foco"
                    disabled={!filter.hops}
                    value={filter.focus ?? ""}
                    onChange={(e) => setFilter((f) => ({ ...f, focus: e.target.value || undefined }))}
                  >
                    {nodesByName.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Toggle checked={ui.l2} onChange={(l2v) => setUi((u) => ({ ...u, l2: l2v }))} label="Puertos activos sin vecino" />
                  <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">
                    Dibuja un nodo "L2 desconocido" junto a cada equipo con interfaces activas sin vecino CDP/LLDP (requiere "Estado de puertos"). Con más de {MAX_L2_NODES} equipos así, solo el del equipo seleccionado.
                  </p>
                </div>
              </div>
            </Collapsible>

            <Collapsible
              title="Revisiones de enlaces"
              badge={issueList.length || undefined}
              summary={
                issueList.length
                  ? [checkCount.crit && plural(checkCount.crit, "crítica", "críticas"), checkCount.warn && plural(checkCount.warn, "aviso", "avisos")].filter(Boolean).join(" · ")
                  : "Sin hallazgos con lo leído"
              }
              open={isOpen("revisiones")}
              onToggle={(v) => setOpen("revisiones", v)}
            >
              <div className="space-y-2 text-[12px]">
                <p className="text-[11px] text-muted leading-snug">
                  Dúplex, velocidad, VLAN nativa, trunk contra access, miembros fuera del agregado, puertos caídos, errores CRC y enlaces que solo ve un lado. Usa lo leído con
                  "Estado de puertos" y lo que anuncia el vecino por CDP/LLDP; los errores son acumulados desde el último clear counters.
                </p>
                {issueList.length > 0 && (
                  <ul className="space-y-1 max-h-64 overflow-y-auto">
                    {issueList.map((x, i) => (
                      <li key={`${x.k}${x.kind}${i}`}>
                        <button
                          type="button"
                          onClick={() => focusOn(x.l.a)}
                          className="w-full flex items-start gap-1.5 text-left rounded-md px-1.5 py-1 hover:bg-hover"
                          title="Ver en el diagrama"
                        >
                          <TriangleAlert size={13} className={`mt-0.5 shrink-0 ${x.sev === "crit" ? "text-danger" : "text-warn"}`} aria-label={x.sev === "crit" ? "Crítica" : "Aviso"} />
                          <span className="min-w-0">
                            <span className="font-medium">{ISSUE_LABEL[x.kind]}</span>
                            <span className="block text-[11.5px] text-muted [overflow-wrap:anywhere]">{x.text}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
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
                  <Toggle checked={ui.color} onChange={(color) => setUi((u) => ({ ...u, color }))} label="Color por utilización" />
                  <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">Verde, amarillo desde 70 % y rojo desde 90 %, con grosor según la carga. Sin color, los enlaces se ven como en el diagrama normal.</p>
                </div>
                <div>
                  <Toggle checked={ui.arrows} onChange={(arrows) => setUi((u) => ({ ...u, arrows }))} label="Flechas de dirección" />
                  <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">Una punta por sentido sobre cada enlace. Sin flechas, el color (si está activo) sigue indicando la utilización.</p>
                </div>
                <div>
                  <Toggle checked={ui.rates} onChange={(rates) => setUi((u) => ({ ...u, rates }))} label="Rótulo en el enlace" />
                  <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">
                    Una etiqueta corta sobre cada enlace con el % de uso (o la tasa, si no se conoce la velocidad). Las tasas por sentido están en "Enlaces", abajo a la izquierda del mapa, y al pasar el mouse.
                  </p>
                </div>
                <div>
                  <Toggle checked={ui.anim && ui.arrows} onChange={(anim) => setUi((u) => ({ ...u, anim, arrows: anim || u.arrows }))} label="Animación" />
                  <p className="mt-0.5 pl-10 text-[11px] text-muted leading-snug">
                    Puntos que viajan por cada sentido del enlace, más rápido cuanto más carga (se pausa con la herramienta oculta). Con más de {FLOW_MAX} enlaces con
                    tráfico se animan los {FLOW_MAX} más cargados y el resto mantiene sus flechas.
                    {reducedMotion ? " El sistema pide reducir movimiento: queda desactivada." : ""}
                  </p>
                </div>
                {trafficOn && (
                  <div className="rounded-md border border-line px-2 py-1.5 space-y-0.5 text-[11.5px]">
                    {!traffic.status.last && <p className="text-muted">Leyendo…</p>}
                    {traffic.status.snmp.length > 0 && <p>SNMP: {traffic.status.snmp.join(", ")}</p>}
                    {traffic.status.cli.length > 0 && <p>Consola: {traffic.status.cli.join(", ")}</p>}
                    {traffic.status.none.length > 0 && (
                      <div className="space-y-1">
                        {/* Sin SNMP ni consola no hay tráfico: el motivo y la acción, a la vista. */}
                        <p className="text-warn">
                          Sin datos de tráfico de {traffic.status.none.join(", ")}: {trafficCli ? "conecta su sesión o crea su perfil SNMP." : "no tiene perfil SNMP."}
                        </p>
                        {!trafficCli && terminals.length > 0 && (
                          <button
                            onClick={() => setTrafficCli(true)}
                            className="h-7 px-2.5 rounded-md border border-line text-[12px] hover:bg-hover"
                            title="Envía show interfaces, display interface o show interfaces extensive a su sesión conectada en cada lectura (solo consulta)"
                          >
                            Leer por consola
                          </button>
                        )}
                      </div>
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
                        <span className="text-[11px] font-medium shrink-0" style={{ color: CONFIDENCE_COLOR[s.confidence] }} title={`Confianza ${s.confidence}`}>
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
                        <Btn kind="ghost" className="!h-6 !px-2 !text-[11px]" onClick={() => dismiss(s.id)}>
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
                {lifecycle && modelFromPlatform(sel.platform) && (
                  <p className="text-[11.5px]">
                    <LifecycleChip model={modelFromPlatform(sel.platform)!} name={sel.name} />
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
                      const linkIssues = checks.get(linkKey(l));
                      return (
                        <div key={i} className="flex items-start rounded-md hover:bg-hover">
                          <button onClick={() => setSelected(other?.id ?? null)} className="flex-1 min-w-0 text-left px-2 py-1">
                            <span className="font-mono text-[11.5px]">
                              {myPort || "?"} → {other?.name} {(mine ? l.bPort : l.aPort) || ""}
                            </span>
                            {!isPhysicalProto(l.proto) && <span className="ml-1.5 text-[11px] text-muted">{protoLabel(l)}</span>}
                            {linkIssues && (
                              <TriangleAlert
                                size={12}
                                className={`inline ml-1.5 -mt-0.5 ${worstSev(linkIssues) === "crit" ? "text-danger" : "text-warn"}`}
                                aria-label={linkIssues.map((i) => i.text).join(". ")}
                              >
                                <title>{linkIssues.map((i) => i.text).join("\n")}</title>
                              </TriangleAlert>
                            )}
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
                <Btn
                  className="w-full !text-[11.5px]"
                  title="Muestra solo los equipos a 2 saltos de este (se ajusta en Filtros)"
                  onClick={() => {
                    setFilter((f) => ({ ...f, hops: f.hops || 2, focus: sel.id }));
                    setOpen("filtros", true);
                  }}
                >
                  <ListFilter size={13} /> Ver su vecindario
                </Btn>
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
                {/* Equipo que solo se alcanza desde el actual: ssh/telnet en la misma pestaña (también ya explorado,
                    p. ej. para volver a leer su tráfico por consola). */}
                {sel.ip && term && mode === "cli" && nodeId(sel.name) !== nodeId(here ?? "") && (
                  <div className="space-y-1.5 pt-1.5 border-t border-line">
                    <p className="text-[11.5px] text-muted leading-snug">
                      ¿No llegas desde tu PC? Salta desde <span className="font-medium text-fg">{here}</span> en su misma pestaña.
                    </p>
                    <div className="flex items-center gap-2">
                      <select className="field !h-7 !text-[12px] !w-auto" aria-label="Protocolo del salto" value={proto} onChange={(e) => setProto(e.target.value as "ssh" | "telnet")}>
                        <option value="ssh">{vendor === "huawei" ? "stelnet" : "ssh"}</option>
                        <option value="telnet">telnet</option>
                      </select>
                      {proto === "ssh" && vendor !== "huawei" && (
                        <input
                          className="field !h-7 !text-[12px]"
                          placeholder={`Usuario${term.session.username ? ` (${term.session.username})` : ""}`}
                          aria-label="Usuario para el salto"
                          value={hopUser}
                          onChange={(e) => setHopUser(e.target.value)}
                        />
                      )}
                    </div>
                    <Btn className="w-full" disabled={busy} onClick={() => hopTo(sel)} title="Envía el comando de salto en la pestaña del equipo actual; te autenticas ahí">
                      Saltar desde {here}
                    </Btn>
                  </div>
                )}
                {sel.ip && (
                  <Btn className="w-full" title={`Copia ${sel.ip} (también ${isMac ? "⌘" : "Ctrl"}+C con el equipo seleccionado en el mapa, o clic derecho sobre él)`} onClick={() => copyText(sel.ip!, "IP")}>
                    <Copy size={13} /> Copiar IP
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
                  const open = () => {
                    onTopo(snapshot.topo);
                    setCompareId("");
                    setMsg(`Snapshot "${snapshot.name}" abierto`);
                  };
                  if (!topo.nodes.length) return open();
                  onConfirm({
                    title: `¿Reemplazar el diagrama por "${snapshot.name}"?`,
                    message: "El diagrama actual (equipos, enlaces manuales y posiciones) se pierde. Guarda un snapshot antes si lo necesitas.",
                    label: "Reemplazar",
                    danger: true,
                    defaultCancel: true,
                    action: open,
                  });
                }}
              >
                Abrir
              </Btn>
              <Btn
                kind="ghost"
                className="hover:!text-danger"
                title="Eliminar snapshot"
                onClick={() =>
                  onConfirm({
                    title: `¿Eliminar el snapshot "${snapshot.name}"?`,
                    message: "No se puede deshacer. El diagrama actual no cambia.",
                    label: "Eliminar",
                    danger: true,
                    defaultCancel: true,
                    action: () => {
                      onSnapshots(snapshots.filter((s) => s.id !== snapshot.id));
                      setCompareId("");
                    },
                  })
                }
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
                      − {anyName(l.a)} {l.aPort} ↔ {l.bPort} {anyName(l.b)}
                    </li>
                  ))}
                  {diff.addedLinks.map((l, i) => (
                    <li key={`al${i}`} className="text-ok">
                      + {anyName(l.a)} {l.aPort} ↔ {l.bPort} {anyName(l.b)}
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
