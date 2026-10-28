/**
 * Lectura del diagrama ya armado, sin enviar comandos: revisiones sobre enlaces (dúplex, velocidad,
 * VLAN nativa, miembros de agregados, errores, asimetrías), rol y fabricante de cada equipo, filtros,
 * búsqueda, puertos activos sin vecino y reglas de alcance del descubrimiento.
 */
import {
  type MacPort,
  type Neighbor,
  type PortInfo,
  type TopoLink,
  type TopoNode,
  type Topology,
  canonPort,
  isIpv4,
  isPhysicalProto,
  knownAddrs,
  linkKey,
  nodeId,
  portOf,
} from "./topology";

// ---------- Revisiones sobre enlaces ----------

export type IssueKind = "duplex" | "speed" | "native" | "mode" | "lag" | "errors" | "down" | "asym";
export type IssueSev = "warn" | "crit";

export interface LinkIssue {
  kind: IssueKind;
  sev: IssueSev;
  text: string;
}

export const ISSUE_LABEL: Record<IssueKind, string> = {
  duplex: "Dúplex",
  speed: "Velocidad",
  native: "VLAN nativa",
  mode: "Modo de puerto",
  lag: "Agregado",
  errors: "Errores",
  down: "Puerto caído",
  asym: "Asimetría",
};

/** Dúplex normalizado: "a-full", "Full", "full-duplex" -> full. */
export function normDuplex(s: string | undefined): "full" | "half" | undefined {
  if (!s) return undefined;
  if (/half/i.test(s)) return "half";
  if (/full/i.test(s)) return "full";
  return undefined;
}

/** Velocidad en Mb/s: "a-1000", "1000", "10G", "a-10G", "100M"; "auto" o vacío -> undefined. */
export function speedMbps(s: string | undefined): number | undefined {
  const m = s?.trim().replace(/^a-/i, "").match(/^(\d+(?:\.\d+)?)\s*([GMK])?(?:b(?:ps|\/s)?)?$/i);
  if (!m) return undefined;
  const v = Number(m[1]);
  const unit = (m[2] ?? "M").toUpperCase();
  return unit === "G" ? v * 1000 : unit === "K" ? v / 1000 : v;
}

/** Miembro fuera del agregado: Cisco D (down), s (suspendido), I (individual), r (módulo fuera); Huawei Down o Unselect. */
const LAG_OUT = /^(?:D|s|I|r)$/;
const LAG_OUT_HUAWEI = /^(?:down|unselect(?:ed)?)$/i;
export const lagOut = (flag: string | undefined) => !!flag && (LAG_OUT.test(flag) || LAG_OUT_HUAWEI.test(flag));

/** Estado de interfaz caída: notconnect, disabled, down/down, *down (admin). err-disabled va aparte. */
const DOWN = /^(?:notconnect|disabled|\*?down|admin(?:istratively)?[ -]?down|lowerlayerdown)/i;
const ERRDIS = /^err-?disabled/i;

const num = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : 0);

/**
 * Revisiones por enlace (clave linkKey). Usa solo lo leído: estado de puertos de cada extremo y lo
 * que anunció el vecino por CDP/LLDP. Sin datos de un lado, esa revisión no se informa.
 */
export function linkChecks(t: Topology): Map<string, LinkIssue[]> {
  const byId = new Map(t.nodes.map((n) => [n.id, n]));
  const res = new Map<string, LinkIssue[]>();
  for (const l of t.links) {
    if (!isPhysicalProto(l.proto) && l.proto !== "manual") continue;
    const a = byId.get(l.a);
    const b = byId.get(l.b);
    if (!a || !b) continue;
    const pa = l.aPort ? portOf(a, l.aPort) : undefined;
    const pb = l.bPort ? portOf(b, l.bPort) : undefined;
    const issues: LinkIssue[] = [];
    const end = (n: TopoNode, port: string) => `${n.name} ${port}`;
    const da = normDuplex(pa?.duplex);
    const db = normDuplex(pb?.duplex);
    if (da && db && da !== db) issues.push({ kind: "duplex", sev: "crit", text: `Dúplex distinto: ${end(a, l.aPort)} ${da}, ${end(b, l.bPort)} ${db}` });
    else if (da === "half" || db === "half")
      issues.push({ kind: "duplex", sev: "warn", text: `Half dúplex en ${da === "half" ? end(a, l.aPort) : end(b, l.bPort)}` });
    const sa = speedMbps(pa?.speed);
    const sb = speedMbps(pb?.speed);
    if (sa && sb && sa !== sb) issues.push({ kind: "speed", sev: "warn", text: `Velocidad distinta: ${end(a, l.aPort)} ${pa!.speed}, ${end(b, l.bPort)} ${pb!.speed}` });
    if (pa?.native && pb?.native && pa.native !== pb.native)
      issues.push({ kind: "native", sev: "warn", text: `VLAN nativa distinta: ${end(a, l.aPort)} ${pa.native}, ${end(b, l.bPort)} ${pb.native}` });
    const trunkA = pa?.vlan === "trunk";
    const trunkB = pb?.vlan === "trunk";
    if (pa?.vlan && pb?.vlan && trunkA !== trunkB && (/^\d+$/.test(pa.vlan) || /^\d+$/.test(pb.vlan)))
      issues.push({ kind: "mode", sev: "warn", text: `Un extremo es trunk y el otro access: ${end(a, l.aPort)} ${pa.vlan}, ${end(b, l.bPort)} ${pb.vlan}` });
    for (const [n, port, p] of [
      [a, l.aPort, pa],
      [b, l.bPort, pb],
    ] as [TopoNode, string, PortInfo | undefined][]) {
      if (!p) continue;
      if (lagOut(p.lag)) issues.push({ kind: "lag", sev: "crit", text: `${end(n, port)} fuera de ${p.group ?? "su agregado"} (${p.lag})` });
      if (p.status && ERRDIS.test(p.status)) issues.push({ kind: "down", sev: "crit", text: `${end(n, port)} en err-disabled` });
      else if (p.status && DOWN.test(p.status)) issues.push({ kind: "down", sev: "warn", text: `${end(n, port)} caído (${p.status}); el vecino puede venir de la caché de CDP/LLDP` });
      const crc = num(p.crc);
      const inErr = num(p.inErr);
      if (crc) issues.push({ kind: "errors", sev: "warn", text: `${end(n, port)}: ${crc.toLocaleString("es-CL")} errores CRC/FCS acumulados` });
      else if (inErr) issues.push({ kind: "errors", sev: "warn", text: `${end(n, port)}: ${inErr.toLocaleString("es-CL")} errores de entrada acumulados` });
    }
    // Asimetría: ambos explorados por CDP/LLDP y solo uno informa el enlace.
    if (isPhysicalProto(l.proto) && a.explored && b.explored && l.seenBy?.length === 1) {
      const [who, other] = l.seenBy[0] === a.id ? [a, b] : [b, a];
      issues.push({ kind: "asym", sev: "warn", text: `${who.name} ve a ${other.name}, pero ${other.name} no informa a ${who.name} (CDP/LLDP apagado en un puerto o solo recepción)` });
    }
    if (issues.length) res.set(linkKey(l), issues);
  }
  return res;
}

export const worstSev = (issues: LinkIssue[] | undefined): IssueSev | undefined =>
  !issues?.length ? undefined : issues.some((i) => i.sev === "crit") ? "crit" : "warn";

// ---------- Rol y fabricante ----------

export type NodeRole = "router" | "switch" | "firewall" | "ap" | "phone" | "host" | "otro";
export const ROLE_LABEL: Record<NodeRole, string> = {
  router: "Router",
  switch: "Switch",
  firewall: "Firewall",
  ap: "Access point",
  phone: "Teléfono",
  host: "Servidor o PC",
  otro: "Sin clasificar",
};

const PHONE = /phone|\bsep[0-9a-f]{12}\b|polycom|yealink|avaya|mitel|\bcp-\d{4}|\bgxp\d|\bgrp\d/i;
const AP = /\bair-|access point|fortiap|\bfap-|\bc91\d\d|\bcw91|\bmr\d{2}\b|aruba ap|\biap-|\bap-?\d{3}\b|\bgwn76|\bwlanaccesspoint\b/i;
const FIREWALL = /fortigate|\bfgt|\basa\b|adaptive security|palo ?alto|\bpa-\d|\bsrx|check ?point|firepower|\bftd\b|sonicwall/i;
const SWITCH = /catalyst|\bws-c|\bc9[2-6]\d{2}|\bc[23]\d{3}\b|nexus|\bn[3579]k|\bs\d{4}\b|\bce\d{4}|\bex\d{4}|\bqfx|fortiswitch|\bgwn78|\baruba ?\d{4}|\bcx ?\d{4}|switch/i;
const ROUTER = /\bisr|\basr|\bcsr|\bc8[0-9]{3}|\bc1[01]\d{2}|ios[ -]?xr|\bne\d{2}|\bar\d{3,4}|\bmx\d|router/i;
const HOST = /linux|windows|vmware|esxi|server|ubuntu/i;

/** Capacidades como tokens: CDP "Router Switch IGMP", LLDP "B,R", Huawei "bridge,router". */
const capTokens = (caps: string | undefined) => new Set((caps ?? "").toLowerCase().split(/[\s,;]+/).filter(Boolean));

/** Rol estimado desde plataforma, nombre y capacidades anunciadas (sin comandos). */
export function nodeRole(n: Pick<TopoNode, "name" | "platform" | "caps">): NodeRole {
  const text = `${n.platform ?? ""} ${n.name}`;
  const caps = capTokens(n.caps);
  if (PHONE.test(text) || caps.has("phone") || caps.has("t") || caps.has("telephone")) return "phone";
  if (AP.test(text) || caps.has("w") || caps.has("wlanaccesspoint")) return "ap";
  if (FIREWALL.test(text)) return "firewall";
  if (SWITCH.test(n.platform ?? "")) return "switch";
  if (ROUTER.test(n.platform ?? "")) return "router";
  if (caps.has("switch") || caps.has("s") || caps.has("b") || caps.has("bridge")) return "switch";
  if (caps.has("router") || caps.has("r")) return "router";
  if (caps.has("host") || HOST.test(n.platform ?? "")) return "host";
  return "otro";
}

export type NodeVendor = "cisco" | "huawei" | "juniper" | "fortinet" | "aruba" | "grandstream" | "otro";
export const VENDOR_LABEL: Record<NodeVendor, string> = {
  cisco: "Cisco",
  huawei: "Huawei / H3C",
  juniper: "Juniper",
  fortinet: "Fortinet",
  aruba: "Aruba / HPE",
  grandstream: "Grandstream",
  otro: "Desconocido",
};

/** Fabricante según la plataforma informada (sin plataforma: desconocido). */
export function nodeVendor(n: Pick<TopoNode, "platform">): NodeVendor {
  const p = n.platform ?? "";
  if (/cisco|catalyst|nexus|\bios\b|ws-c|\bair-|\bc9\d{3}|\bisr|\basr|meraki/i.test(p)) return "cisco";
  if (/huawei|\bvrp\b|h3c|comware|yunshan/i.test(p)) return "huawei";
  if (/juniper|junos|\bex\d{4}|\bqfx|\bsrx|\bmx\d/i.test(p)) return "juniper";
  if (/forti/i.test(p)) return "fortinet";
  if (/aruba|procurve|\bhpe?\b/i.test(p)) return "aruba";
  if (/grandstream|\bgwn/i.test(p)) return "grandstream";
  return "otro";
}

export type NodeState = "explorado" | "pendiente" | "manual" | "ruteo";
export const STATE_LABEL: Record<NodeState, string> = { explorado: "Explorado", pendiente: "Sin explorar", manual: "Manual", ruteo: "Visto por ruteo" };
export const nodeState = (n: TopoNode): NodeState => (n.explored ? "explorado" : n.manual ? "manual" : n.addrOnly ? "ruteo" : "pendiente");

// ---------- Filtros y vista a N saltos ----------

export interface TopoFilter {
  roles: NodeRole[];
  vendors: NodeVendor[];
  protos: string[];
  states: NodeState[];
  /** Solo equipos a N saltos del equipo foco (0: sin límite). */
  hops: number;
  focus?: string;
}
export const NO_FILTER: TopoFilter = { roles: [], vendors: [], protos: [], states: [], hops: 0 };
export const filterActive = (f: TopoFilter) => !!(f.roles.length || f.vendors.length || f.protos.length || f.states.length || (f.hops && f.focus));

/** Equipos a lo más `max` saltos de `from` (por los enlaces dados). */
export function withinHops(links: TopoLink[], from: string, max: number): Set<string> {
  const adj = new Map<string, string[]>();
  for (const l of links) {
    adj.set(l.a, [...(adj.get(l.a) ?? []), l.b]);
    adj.set(l.b, [...(adj.get(l.b) ?? []), l.a]);
  }
  const seen = new Set([from]);
  let frontier = [from];
  for (let d = 0; d < max && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) for (const o of adj.get(id) ?? []) if (!seen.has(o)) (seen.add(o), next.push(o));
    frontier = next;
  }
  return seen;
}

/** Subconjunto visible del diagrama. Los criterios de una misma lista se suman (o), las listas se cruzan (y). */
export function filterView(t: Topology, f: TopoFilter): Topology {
  if (!filterActive(f)) return t;
  let links = f.protos.length ? t.links.filter((l) => f.protos.includes(String(l.proto))) : t.links;
  let nodes = t.nodes.filter(
    (n) =>
      n.id === f.focus ||
      ((!f.roles.length || f.roles.includes(nodeRole(n))) &&
        (!f.vendors.length || f.vendors.includes(nodeVendor(n))) &&
        (!f.states.length || f.states.includes(nodeState(n)))),
  );
  let ids = new Set(nodes.map((n) => n.id));
  links = links.filter((l) => ids.has(l.a) && ids.has(l.b));
  if (f.hops && f.focus && ids.has(f.focus)) {
    const near = withinHops(links, f.focus, f.hops);
    nodes = nodes.filter((n) => near.has(n.id));
    ids = near;
    links = links.filter((l) => ids.has(l.a) && ids.has(l.b));
  }
  return { nodes, links };
}

// ---------- Búsqueda ----------

export interface SearchHit {
  id: string;
  /** Qué coincidió: "nombre", "IP", "interfaz", "MAC" o "descripción". */
  what: string;
  /** Texto a mostrar junto al equipo (la IP, la interfaz o la MAC encontrada). */
  detail: string;
}

/** Clave canónica para mostrar: "gi1/0/5" -> "Gi1/0/5". */
const portLabel = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);

const hexOnly = (s: string) => s.replace(/[.:\-\s]/g, "").toLowerCase();

/** Busca equipos por nombre, IP, interfaz (o su descripción) o MAC. Hasta `limit` resultados, los exactos primero. */
export function searchTopo(t: Topology, query: string, limit = 8): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: (SearchHit & { rank: number })[] = [];
  const qPort = canonPort(q);
  const qHex = /^[0-9a-f.:\-\s]{4,}$/i.test(q) ? hexOnly(q) : "";
  // Interfaz con enlace (como se dibuja), indexada una vez: recorrer los enlaces por equipo era cuadrático.
  const linkPorts = new Map<string, string>();
  for (const l of t.links) {
    if (l.aPort && canonPort(l.aPort) === qPort) linkPorts.set(l.a, l.aPort);
    if (l.bPort && canonPort(l.bPort) === qPort) linkPorts.set(l.b, l.bPort);
  }
  for (const n of t.nodes) {
    const name = n.name.toLowerCase();
    if (name.includes(q)) {
      hits.push({ id: n.id, what: "nombre", detail: n.ip ?? "", rank: name === q ? 0 : name.startsWith(q) ? 1 : 3 });
      continue;
    }
    const ip = knownAddrs(n).find((a) => a.startsWith(q) || a === q);
    if (ip) {
      hits.push({ id: n.id, what: "IP", detail: ip, rank: ip === q ? 0 : 2 });
      continue;
    }
    const linkPort = linkPorts.get(n.id);
    const portKey = linkPort || !n.ports || !Object.hasOwn(n.ports, qPort) ? undefined : qPort;
    if (linkPort || portKey) {
      hits.push({ id: n.id, what: "interfaz", detail: linkPort ?? portLabel(portKey!), rank: 2 });
      continue;
    }
    if (qHex) {
      const found = Object.values(n.macs ?? {}).flatMap((mp) => mp.macs.map((e) => [mp.port, e.mac] as const)).find(([, mac]) => hexOnly(mac).includes(qHex));
      if (found) {
        hits.push({ id: n.id, what: "MAC", detail: `${found[1]} en ${found[0]}`, rank: hexOnly(found[1]) === qHex ? 0 : 2 });
        continue;
      }
    }
    if (q.length >= 3) {
      const desc = Object.entries(n.ports ?? {}).find(([, p]) => p.desc?.toLowerCase().includes(q));
      if (desc) hits.push({ id: n.id, what: "descripción", detail: `${portLabel(desc[0])}: ${desc[1].desc}`, rank: 4 });
    }
  }
  return hits
    .sort((x, y) => x.rank - y.rank)
    .slice(0, limit)
    .map(({ rank: _r, ...h }) => h);
}

// ---------- Puertos activos sin vecino ("L2 desconocido") ----------

/** Interfaces lógicas o de gestión: no llevan un vecino físico. */
const LOGICAL_PORT = /^(?:vl|vlanif|vlan-interface|lo|loopback|inloopback|tu|tunnel|po|nve|mgmt|null|nu|bdi|vbdif|meth|m-gigabitethernet|ae|irb|me|fxp|em|dialer|virtual|cpu|sup|ap|bvi|vi|bridge-aggregation)\d/;
const PORT_UP = /^(?:connected|up\b)/i;

export interface UnknownL2 {
  /** Interfaces activas sin vecino, como las informa el equipo. */
  ports: string[];
  /** MAC vistas en esos puertos (si se leyó la tabla MAC). */
  macs: number;
  vendors: string[];
}

/**
 * Por equipo explorado, las interfaces físicas activas sin enlace en el diagrama (ni su agregado):
 * ahí hay algo conectado que no habla CDP/LLDP. No se guarda: se calcula al dibujar.
 */
export function unknownL2(t: Topology): Map<string, UnknownL2> {
  const linked = new Map<string, Set<string>>();
  for (const l of t.links) {
    if (l.aPort) linked.set(l.a, (linked.get(l.a) ?? new Set()).add(canonPort(l.aPort)));
    if (l.bPort) linked.set(l.b, (linked.get(l.b) ?? new Set()).add(canonPort(l.bPort)));
  }
  const res = new Map<string, UnknownL2>();
  for (const n of t.nodes) {
    if (!n.explored || !n.ports) continue;
    const mine = linked.get(n.id) ?? new Set<string>();
    const groups = new Set(Object.entries(n.ports).filter(([k, p]) => p.group && mine.has(k)).map(([, p]) => canonPort(p.group!)));
    for (const g of [...mine]) groups.add(g);
    const ports: string[] = [];
    let macs = 0;
    const vendors = new Set<string>();
    for (const [k, p] of Object.entries(n.ports)) {
      if (mine.has(k) || LOGICAL_PORT.test(k) || !p.status || !PORT_UP.test(p.status)) continue;
      if (p.group && groups.has(canonPort(p.group))) continue;
      const mp: MacPort | undefined = n.macs?.[k];
      ports.push(mp?.port ?? portLabel(k));
      if (mp) {
        macs += mp.total;
        for (const e of mp.macs) if (e.vendor) vendors.add(e.vendor);
      }
    }
    if (ports.length) res.set(n.id, { ports: ports.sort((x, y) => x.localeCompare(y, undefined, { numeric: true })), macs, vendors: [...vendors].slice(0, 6) });
  }
  return res;
}

// ---------- Alcance del descubrimiento ----------

export interface TopoScope {
  /** No agrega teléfonos IP ni access points. */
  skipEndpoints: boolean;
  /** Redes permitidas (CIDR IPv4 separados por coma o espacio); vacío: todas. */
  cidrs: string;
  /** Profundidad máxima desde el primer equipo explorado (0: sin límite). */
  maxDepth: number;
}
export const NO_SCOPE: TopoScope = { skipEndpoints: false, cidrs: "", maxDepth: 0 };

const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);

/** "10.0.0.0/8, 192.168.1.0/24" -> rangos; error con el primer valor inválido. */
export function parseCidrs(s: string): { ranges: [number, number][]; error?: string } {
  const ranges: [number, number][] = [];
  for (const raw of s.split(/[\s,;]+/).filter(Boolean)) {
    const [ip, bits = "32"] = raw.split("/");
    const b = Number(bits);
    if (!isIpv4(ip) || !/^\d{1,2}$/.test(bits) || b > 32) return { ranges, error: `Red no válida: ${raw.slice(0, 40)}` };
    const size = 2 ** (32 - b);
    const start = Math.floor(ipNum(ip) / size) * size;
    ranges.push([start, start + size - 1]);
  }
  return { ranges };
}

export const inRanges = (ip: string, ranges: [number, number][]) => {
  const v = ipNum(ip);
  return ranges.some(([a, b]) => v >= a && v <= b);
};

/** Profundidad (saltos) de cada equipo desde el primer explorado. */
function depths(t: Topology): Map<string, number> {
  const root = t.nodes.find((n) => n.explored);
  const d = new Map<string, number>();
  if (!root) return d;
  const adj = new Map<string, string[]>();
  for (const l of t.links) {
    adj.set(l.a, [...(adj.get(l.a) ?? []), l.b]);
    adj.set(l.b, [...(adj.get(l.b) ?? []), l.a]);
  }
  d.set(root.id, 0);
  let frontier = [root.id];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) for (const o of adj.get(id) ?? []) if (!d.has(o)) (d.set(o, d.get(id)! + 1), next.push(o));
    frontier = next;
  }
  return d;
}

/**
 * Aplica el alcance a los vecinos leídos de `self` antes de incorporarlos. Solo descarta vecinos
 * nuevos: un equipo que ya está en el diagrama (manual o de otra lectura) conserva su enlace.
 */
export function scopeNeighbors(t: Topology, self: string, neighbors: Neighbor[], scope: TopoScope): { kept: Neighbor[]; skipped: string[] } {
  const { ranges } = parseCidrs(scope.cidrs);
  const known = new Set(t.nodes.map((n) => n.id));
  const selfId = nodeId(self);
  const d = scope.maxDepth ? depths(t) : undefined;
  // Un equipo que aún no está en el diagrama es la raíz (profundidad 0).
  const tooDeep = !!d && d.size > 0 && (d.get(selfId) ?? 0) + 1 > scope.maxDepth;
  const kept: Neighbor[] = [];
  const skipped: string[] = [];
  for (const nb of neighbors) {
    if (known.has(nodeId(nb.name)) || (nb.ip && t.nodes.some((n) => knownAddrs(n).includes(nb.ip!)))) {
      kept.push(nb);
      continue;
    }
    const role = nodeRole({ name: nb.name, platform: nb.platform, caps: nb.caps });
    if (scope.skipEndpoints && (role === "phone" || role === "ap")) skipped.push(`${nb.name} (${ROLE_LABEL[role].toLowerCase()})`);
    else if (ranges.length && nb.ip && isIpv4(nb.ip) && !inRanges(nb.ip, ranges)) skipped.push(`${nb.name} (${nb.ip} fuera de las redes)`);
    else if (tooDeep) skipped.push(`${nb.name} (más de ${scope.maxDepth} saltos)`);
    else kept.push(nb);
  }
  return { kept, skipped };
}
