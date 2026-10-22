/** Topología desde CDP/LLDP: comandos por fabricante, lectura de salidas y grafo. */

export interface Neighbor {
  name: string;
  localPort: string;
  remotePort: string;
  ip?: string;
  platform?: string;
  proto: "CDP" | "LLDP";
  /** Agregado local (Port-channel, Eth-Trunk, ae) informado junto al vecino. */
  group?: string;
}

/** Estado de una interfaz local, leído con comandos de consulta. */
export interface PortInfo {
  status?: string;
  speed?: string;
  desc?: string;
  /** Port-channel / Eth-Trunk / ae al que pertenece. */
  group?: string;
}

export interface TopoNode {
  id: string; // nombre normalizado
  name: string;
  ip?: string;
  platform?: string;
  /** Equipo del que ya se leyeron sus vecinos. */
  explored: boolean;
  x: number;
  y: number;
  /** Interfaces locales indexadas por canonPort. */
  ports?: Record<string, PortInfo>;
}

export interface TopoLink {
  a: string;
  aPort: string;
  b: string;
  bPort: string;
  proto: string;
}

export interface Topology {
  nodes: TopoNode[];
  links: TopoLink[];
}

export interface TopoSnapshot {
  id: string;
  name: string;
  ts: number;
  topo: Topology;
}

export type TopoVendor = "cisco" | "huawei" | "juniper" | "fortinet";

/** Comandos de vecinos por fabricante (todos de solo lectura). */
export const NEIGHBOR_COMMANDS: Record<TopoVendor, string[]> = {
  cisco: ["show cdp neighbors detail", "show lldp neighbors detail"],
  huawei: ["display lldp neighbor"],
  juniper: ["show lldp neighbors"],
  // FortiOS 7.6.3+ cambió a "diagnose lldp rx neighbor": se prueba primero el clásico.
  fortinet: ["diagnose lldprx neighbor summary", "diagnose lldprx neighbor details"],
};

/** Comandos alternativos cuando el principal no existe en esa versión. */
export const FALLBACK_COMMANDS: Record<string, string> = {
  "diagnose lldprx neighbor summary": "diagnose lldp rx neighbor summary",
  "diagnose lldprx neighbor details": "diagnose lldp rx neighbor details",
  "show interfaces status": "show interfaces description",
  "show etherchannel summary": "show port-channel summary",
};

/** Comandos de estado de interfaces y agregados (opcionales, de solo lectura). */
export const PORT_COMMANDS: Record<TopoVendor, string[]> = {
  cisco: ["show interfaces status", "show etherchannel summary"],
  huawei: ["display interface brief", "display interface description", "display eth-trunk"],
  juniper: ["show interfaces descriptions"],
  fortinet: [],
};

/** Detalle de Junos por interfaz: trae la IP de gestión que la tabla resumida no muestra. */
export const junosDetailCommand = (iface: string) => `show lldp neighbors interface ${iface}`;

/** Respuesta de error del equipo (comando inexistente en esa versión o plataforma). */
export function isCliError(out: string): boolean {
  return /% ?Invalid (input|command)|% ?Unrecognized command|% ?Incomplete command|Error: ?Unrecognized command|Error: ?Wrong parameter|syntax error|unknown command|Unknown action|Command fail|Invalid command/i.test(
    out,
  );
}

/** Nombre normalizado: sin dominio ni número de serie entre paréntesis (CDP de NX-OS). */
export const nodeId = (name: string) =>
  name
    .trim()
    .replace(/\(.*\)$/, "")
    .split(".")[0]
    .toLowerCase();

/** Abrevia interfaces largas para las etiquetas: GigabitEthernet1/0/1 -> Gi1/0/1. */
export function shortPort(p: string): string {
  const map: [RegExp, string][] = [
    [/^HundredGig(abit)?E(thernet)?/i, "Hu"],
    [/^FortyGig(abit)?E(thernet)?/i, "Fo"],
    [/^TwentyFiveGig(abit)?E(thernet)?/i, "Twe"],
    [/^TenGig(abit)?E(thernet)?/i, "Te"],
    [/^XGigabitEthernet/i, "XGE"],
    [/^GigabitEthernet/i, "Gi"],
    [/^FastEthernet/i, "Fa"],
    [/^Ethernet/i, "Eth"],
    [/^Port-channel/i, "Po"],
  ];
  // Junos agrega la unidad lógica ".0" que no aporta en el diagrama.
  const p2 = /^(ge|xe|et|ae|mge)-[\d/]+\.0$/.test(p) ? p.slice(0, -2) : p;
  for (const [re, s] of map) if (re.test(p2)) return p2.replace(re, s);
  return p2;
}

/**
 * Forma canónica de una interfaz para comparar entre fabricantes:
 * GE0/0/1 (Huawei) = GigabitEthernet0/0/1 (Cisco) = Gi0/0/1 -> "gi0/0/1".
 */
export function canonPort(p: string): string {
  const s = p
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^((?:ge|xe|et|ae|mge)-[\d/]+)\.0$/, "$1");
  const families: [RegExp, string][] = [
    [/^(hundredgig(abit)?e(thernet)?|hu|100ge)/, "hu"],
    [/^(fortygig(abit)?e(thernet)?|fo|40ge)/, "fo"],
    [/^(twentyfivegig(abit)?e(thernet)?|twe|25ge)/, "twe"],
    [/^(tengig(abit)?e(thernet)?|xgigabitethernet|xge|te|10ge)/, "te"],
    [/^(gigabitethernet|gige|gi|ge)(?=\d)/, "gi"],
    [/^(fastethernet|fa)/, "fa"],
    [/^(port-channel|po|eth-trunk|bundle-ether|be)(?=\d)/, "po"],
    [/^(ethernet|eth|et)(?=\d)/, "eth"],
  ];
  for (const [re, fam] of families) if (re.test(s)) return s.replace(re, fam);
  return s;
}

/** Hostname desde el prompt al final de la salida (Router#, <SW>, user@host>, FGT #). */
export function promptName(output: string): string | null {
  const last = output.trimEnd().split("\n").pop() ?? "";
  const m =
    last.match(/^<([\w.\-]+)>\s*$/) ||
    last.match(/^\[~?\*?([\w.\-]+)[^\]]*\]\s*$/) ||
    last.match(/^[\w.\-]+@([\w.\-]+)[>#%]\s*$/) ||
    last.match(/^([\w.\-]+)(?:\s\([^)]*\))?\s?[#$]\s*$/) ||
    last.match(/^([\w.\-]+)(?:\([^)]*\))?[#>]\s*$/);
  return m ? m[1] : null;
}

function field(block: string, re: RegExp): string | undefined {
  return block.match(re)?.[1]?.trim() || undefined;
}

const IPV4 = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;
const usableIp = (ip?: string) => (ip && ip !== "0.0.0.0" ? ip : undefined);

/** Cisco "show cdp neighbors detail" (IOS, IOS-XE, NX-OS). */
export function parseCdp(out: string): Neighbor[] {
  return out
    .split(/^-{5,}\s*$/m)
    .flatMap((b): Neighbor[] => {
      const name = field(b, /Device ID:\s*(\S+)/);
      const local = field(b, /Interface:\s*([^,\n]+),/);
      const remote = field(b, /Port ID \(outgoing port\):\s*(\S+)/);
      if (!name || !local || !remote) return [];
      return [
        {
          name,
          localPort: local,
          remotePort: remote,
          ip: usableIp(field(b, /(?:IP(?:v4)? [Aa]ddress|IP address):\s*(\d+\.\d+\.\d+\.\d+)/)),
          platform: field(b, /Platform:\s*([^,\n]+)/),
          proto: "CDP",
        },
      ];
    });
}

/** Cisco "show lldp neighbors detail". */
export function parseCiscoLldp(out: string): Neighbor[] {
  return out
    .split(/^-{5,}\s*$/m)
    .flatMap((b): Neighbor[] => {
      const local = field(b, /Local Intf:\s*(\S+)/);
      const remote = field(b, /Port id:\s*(\S+)/);
      const name = field(b, /System Name:\s*(\S+)/) ?? field(b, /Chassis id:\s*(\S+)/);
      if (!name || !local || !remote) return [];
      return [
        {
          name,
          localPort: local,
          remotePort: remote,
          ip: usableIp(field(b, /Management Addresses:[\s\S]*?IP:\s*(\d+\.\d+\.\d+\.\d+)/)),
          platform: field(b, /System Description:\s*\n\s*([^\n]+)/),
          proto: "LLDP",
        },
      ];
    });
}

/** Huawei VRP "display lldp neighbor" (detalle por interfaz). */
export function parseHuaweiLldp(out: string): Neighbor[] {
  const res: Neighbor[] = [];
  const blocks = out.split(/^(?=\S+ has \d+ neighbor)/m);
  for (const b of blocks) {
    const local = field(b, /^(\S+) has \d+ neighbor/m);
    if (!local) continue;
    for (const nb of b.split(/Neighbor index\s*:/).slice(1)) {
      const name = field(nb, /System name\s*:\s*(\S+)/) ?? field(nb, /Chassis ID\s*:\s*(\S+)/);
      const remote = field(nb, /Port ID\s*:\s*(\S+)/);
      if (!name || !remote) continue;
      res.push({
        name,
        localPort: local,
        remotePort: remote,
        ip: usableIp(field(nb, /Management address\s*:\s*(\d+\.\d+\.\d+\.\d+)/)),
        platform: field(nb, /System description\s*:\s*([^\n]+)/),
        proto: "LLDP",
      });
    }
  }
  return res;
}

/** Junos "show lldp neighbors" (tabla resumida). La columna Parent Interface indica el ae. */
export function parseJunosLldp(out: string): Neighbor[] {
  const res: Neighbor[] = [];
  for (const line of out.split("\n")) {
    // Local Interface  Parent Interface  Chassis Id  Port info  System Name
    const m = line.match(/^(\S+)\s+(\S+)\s+([0-9a-f]{2}(?::[0-9a-f]{2}){5})\s+(\S+)\s+(\S+)\s*$/i);
    if (!m) continue;
    const parent = m[2] === "-" ? undefined : m[2].replace(/\.0$/, "");
    res.push({ name: m[5], localPort: m[1], remotePort: m[4], proto: "LLDP", group: parent });
  }
  return res;
}

/** Junos "show lldp neighbors interface X": vecino con IP de gestión. */
export function parseJunosLldpDetail(out: string): Neighbor | null {
  const local = field(out, /Local Interface\s*:\s*(\S+)/);
  const name = field(out, /System name\s*:\s*(\S+)/);
  const portId = field(out, /Port ID\s*:\s*(\S+)/);
  const portDesc = field(out, /Port description\s*:\s*(\S+)/);
  if (!local || !name) return null;
  const parent = field(out, /Parent Interface\s*:\s*(\S+)/);
  const mgmt = out.split(/Management Info/i)[1];
  // El Port ID de Junos suele ser el índice SNMP: si es numérico, la descripción es más útil.
  const remote = portId && !/^\d+$/.test(portId) ? portId : (portDesc ?? portId ?? "?");
  return {
    name,
    localPort: local,
    remotePort: remote,
    ip: usableIp(mgmt ? field(mgmt, /Address\s*:\s*(\d+\.\d+\.\d+\.\d+)/) : undefined),
    platform: field(out, /System Description\s*:\s*([^\n]+)/),
    proto: "LLDP",
    group: parent && parent !== "-" ? parent.replace(/\.0$/, "") : undefined,
  };
}

/**
 * FortiOS "diagnose lldprx neighbor summary" y "details" (también la sintaxis 7.6.3+).
 * Resumen: 1 port 'wan1' 5 mac … chassis … port 'Te1/0/1' system 'Switch'
 * Detalle: lldprx.neighbor.1.address.1.addr: 192.0.2.1
 */
export function parseFortiLldp(outputs: string[]): Neighbor[] {
  const all = outputs.join("\n");
  const byIdx = new Map<string, Neighbor>();
  for (const m of all.matchAll(/^\s*(\d+)\s+port\s+'([^']+)'.*?\bport\s+'([^']+)'(?:\s+system\s+'([^']*)')?/gm)) {
    const [, idx, local, remote, system] = m;
    const chassis = all.slice(m.index ?? 0).match(/chassis\s+(\S+)/)?.[1];
    byIdx.set(idx, { name: system || chassis || `vecino-${idx}`, localPort: local, remotePort: remote, proto: "LLDP" });
  }
  for (const m of all.matchAll(/lldprx\.neighbor\.(\d+)\.address\.\d+\.addr:\s*(\S+)/g)) {
    const n = byIdx.get(m[1]);
    if (n && !n.ip && IPV4.test(m[2])) n.ip = usableIp(m[2]);
  }
  for (const m of all.matchAll(/lldprx\.neighbor\.(\d+)\.system\.desc\.data:\s*([^\n]+)/g)) {
    const n = byIdx.get(m[1]);
    if (n && !n.platform) n.platform = m[2].trim();
  }
  return [...byIdx.values()];
}

export function parseNeighbors(vendor: string, outputs: string[]): Neighbor[] {
  const valid = outputs.filter((o) => !isCliError(o));
  const all =
    vendor === "huawei"
      ? valid.flatMap(parseHuaweiLldp)
      : vendor === "juniper"
        ? [...valid.flatMap(parseJunosLldp), ...valid.flatMap((o) => parseJunosLldpDetail(o) ?? [])]
        : vendor === "fortinet"
          ? parseFortiLldp(valid)
          : valid.flatMap((o) => [...parseCdp(o), ...parseCiscoLldp(o)]);
  // CDP y LLDP (o resumen y detalle) pueden reportar el mismo enlace: uno por puerto local,
  // completando con los datos que traiga el duplicado (IP, plataforma, agregado).
  const byKey = new Map<string, Neighbor>();
  for (const n of all) {
    const k = `${canonPort(n.localPort)}|${nodeId(n.name)}`;
    const prev = byKey.get(k);
    if (!prev) byKey.set(k, { ...n });
    else {
      prev.ip ??= n.ip;
      prev.platform ??= n.platform;
      prev.group ??= n.group;
      if (/^\d+$/.test(prev.remotePort) && !/^\d+$/.test(n.remotePort)) prev.remotePort = n.remotePort;
    }
  }
  return [...byKey.values()];
}

/** Columnas de una tabla de ancho fijo a partir de su encabezado. */
function fixedColumns(header: string, names: string[]): { name: string; start: number }[] {
  return names
    .map((name) => ({ name, start: header.search(new RegExp(`\\b${name}\\b`)) }))
    .filter((c) => c.start >= 0)
    .sort((a, b) => a.start - b.start);
}

function sliceRow(line: string, cols: { name: string; start: number }[]): Record<string, string> {
  const row: Record<string, string> = {};
  cols.forEach((c, i) => {
    const end = i + 1 < cols.length ? cols[i + 1].start : line.length;
    row[c.name] = line.slice(c.start, end).trim();
  });
  return row;
}

/** Interpreta las salidas de PORT_COMMANDS y devuelve el estado por interfaz (clave canonPort). */
export function parsePortInfo(outputs: string[]): Record<string, PortInfo> {
  const ports: Record<string, PortInfo> = {};
  const put = (iface: string, info: PortInfo) => {
    if (!iface) return;
    const k = canonPort(iface);
    const cur = (ports[k] ??= {});
    for (const [key, v] of Object.entries(info) as [keyof PortInfo, string | undefined][]) if (v && !cur[key]) cur[key] = v;
  };
  for (const out of outputs.filter((o) => !isCliError(o))) {
    const lines = out.split(/\r?\n/);
    // Cisco "show interfaces status" (IOS/NX-OS): Port Name Status Vlan Duplex Speed Type
    let hi = lines.findIndex((l) => /^Port\s+Name\s+Status\s+Vlan/.test(l));
    if (hi >= 0) {
      // Port/Name/Status van alineadas a la izquierda; Duplex y Speed a la derecha, así que
      // desde Vlan en adelante se separa por espacios: vlan duplex speed tipo.
      const cols = fixedColumns(lines[hi], ["Port", "Name", "Status", "Vlan"]);
      const vlanAt = cols.find((c) => c.name === "Vlan")?.start ?? 0;
      for (const l of lines.slice(hi + 1)) {
        if (!/^\S/.test(l) || /^-+/.test(l) || /[#>]\s*$/.test(l)) continue;
        const r = sliceRow(l.slice(0, vlanAt), cols.filter((c) => c.name !== "Vlan"));
        const [, , speed] = l.slice(vlanAt).trim().split(/\s+/);
        put(r.Port, { status: r.Status, speed, desc: r.Name });
      }
      continue;
    }
    // Cisco "show interfaces description": Interface Status Protocol Description
    hi = lines.findIndex((l) => /^Interface\s+Status\s+Protocol\s+Description/.test(l));
    if (hi >= 0) {
      const cols = fixedColumns(lines[hi], ["Interface", "Status", "Protocol", "Description"]);
      for (const l of lines.slice(hi + 1)) {
        if (!/^\S/.test(l) || /[#>]\s*$/.test(l)) continue;
        const r = sliceRow(l, cols);
        put(r.Interface, { status: r.Protocol ? `${r.Status}/${r.Protocol}` : r.Status, desc: r.Description });
      }
      continue;
    }
    // Cisco "show etherchannel summary" / NX-OS "show port-channel summary"
    if (/\bPo\d+\(\w+\)/.test(out)) {
      let group: string | undefined;
      for (const l of lines) {
        const po = l.match(/\b(Po\d+)\(\w+\)/);
        if (po) group = po[1];
        // Las líneas que continúan la lista de miembros solo traen interfaces.
        else if (!/^\s+(\S+\(\w+\)\s*)+$/.test(l)) {
          group = undefined;
          continue;
        }
        if (!group) continue;
        for (const m of l.matchAll(/(\S+)\((\w+)\)/g)) if (!/^Po\d+$/.test(m[1])) put(m[1], { group });
      }
      continue;
    }
    // Huawei "display interface description": Interface PHY Protocol Description
    hi = lines.findIndex((l) => /^Interface\s+PHY\s+Protocol\s+Description/i.test(l));
    if (hi >= 0) {
      for (const l of lines.slice(hi + 1)) {
        const m = l.match(/^(\S*\d\S*)\s+(\S+)\s+(\S+)\s*(.*)$/);
        if (m) put(m[1], { status: `${m[2]}/${m[3]}`, desc: m[4].trim() || undefined });
      }
      continue;
    }
    // Huawei "display interface brief": Interface PHY Protocol InUti ...
    hi = lines.findIndex((l) => /^Interface\s+PHY\s+Protocol/.test(l));
    if (hi >= 0) {
      for (const l of lines.slice(hi + 1)) {
        const m = l.match(/^(\S*\d\S*)\s+(\S+)\s+(\S+)/);
        if (m) put(m[1], { status: `${m[2]}/${m[3]}` });
      }
      continue;
    }
    // Huawei "display eth-trunk"
    if (/Eth-Trunk\d+'s state information/i.test(out)) {
      let group: string | undefined;
      for (const l of lines) {
        const g = l.match(/(Eth-Trunk\d+)'s state information/i);
        if (g) group = g[1];
        const m = l.match(/^((?:\d+GE|XGE|GE|MultiGE|\S*Ethernet)\S*\d)\s+(Up|Down|Selected|Unselect|Unselected|Indep)\b/i);
        if (m && group) put(m[1], { group });
      }
      continue;
    }
    // Junos "show interfaces descriptions": Interface Admin Link Description
    hi = lines.findIndex((l) => /^Interface\s+Admin\s+Link\s+Description/.test(l));
    if (hi >= 0) {
      for (const l of lines.slice(hi + 1)) {
        const m = l.match(/^(\S+)\s+(up|down)\s+(up|down)\s+(.*)$/);
        if (m) put(m[1], { status: `${m[2]}/${m[3]}`, desc: m[4].trim() });
      }
    }
  }
  return ports;
}

/** Puerto de un nodo: información conocida (si se leyó su estado). */
export const portOf = (n: TopoNode | undefined, port: string): PortInfo | undefined => n?.ports?.[canonPort(port)];

/** Incorpora los vecinos de un equipo al grafo (sin duplicar enlaces en ambos sentidos). */
export function mergeNeighbors(
  t: Topology,
  device: { name: string; ip?: string; platform?: string; ports?: Record<string, PortInfo> },
  neighbors: Neighbor[],
): Topology {
  const nodes = t.nodes.map((n) => ({ ...n }));
  const links = [...t.links];
  const ensure = (name: string, extra: Partial<TopoNode> = {}) => {
    const id = nodeId(name);
    let n = nodes.find((x) => x.id === id);
    if (!n) {
      n = { id, name: name.replace(/\(.*\)$/, ""), explored: false, x: 0, y: 0 };
      nodes.push(n);
    }
    if (extra.ip && !n.ip) n.ip = extra.ip;
    if (extra.platform && !n.platform) n.platform = extra.platform;
    if (extra.explored) n.explored = true;
    return n;
  };
  const self = ensure(device.name, { ip: device.ip, platform: device.platform, explored: true });
  if (device.ports) self.ports = { ...self.ports, ...device.ports };
  for (const nb of neighbors) {
    const other = ensure(nb.name, { ip: nb.ip, platform: nb.platform });
    if (other.id === self.id) continue;
    const aPort = shortPort(nb.localPort);
    const bPort = shortPort(nb.remotePort);
    if (nb.group) {
      const k = canonPort(aPort);
      self.ports = { ...self.ports, [k]: { ...self.ports?.[k], group: self.ports?.[k]?.group ?? shortPort(nb.group) } };
    }
    // El mismo enlace visto desde el otro extremo (con otra nomenclatura de puertos).
    const dup = links.some(
      (l) =>
        (l.a === self.id && l.b === other.id && canonPort(l.aPort) === canonPort(aPort)) ||
        (l.b === self.id && l.a === other.id && (canonPort(l.bPort) === canonPort(aPort) || canonPort(l.aPort) === canonPort(bPort))),
    );
    if (!dup) links.push({ a: self.id, aPort, b: other.id, bPort, proto: nb.proto });
  }
  return layout({ nodes, links });
}

/** Disposición por niveles desde el primer equipo explorado; respeta nodos ya movidos. */
export function layout(t: Topology): Topology {
  const placed = t.nodes.filter((n) => n.x || n.y);
  if (placed.length === t.nodes.length) return t;
  const root = t.nodes.find((n) => n.explored) ?? t.nodes[0];
  if (!root) return t;
  const level = new Map<string, number>([[root.id, 0]]);
  const queue = [root.id];
  while (queue.length) {
    const id = queue.shift()!;
    for (const l of t.links) {
      const other = l.a === id ? l.b : l.b === id ? l.a : null;
      if (other && !level.has(other)) {
        level.set(other, level.get(id)! + 1);
        queue.push(other);
      }
    }
  }
  // Equipos sin camino a la raíz (otra isla) quedan en una fila al final.
  const maxLevel = Math.max(0, ...level.values());
  const byLevel = new Map<number, string[]>();
  for (const n of t.nodes) {
    const lv = level.get(n.id) ?? maxLevel + 1;
    byLevel.set(lv, [...(byLevel.get(lv) ?? []), n.id]);
  }
  const nodes = t.nodes.map((n) => {
    if (n.x || n.y) return n;
    const lv = level.get(n.id) ?? maxLevel + 1;
    const row = byLevel.get(lv)!;
    const i = row.indexOf(n.id);
    return { ...n, x: 140 + i * 240 - ((row.length - 1) * 240) / 2 + 400, y: 80 + lv * 170 };
  });
  return { nodes, links: t.links };
}

/** Grupo (Port-channel, Eth-Trunk, ae) de un enlace, visto desde cualquiera de sus extremos. */
export function linkGroup(t: Topology, l: TopoLink): string | undefined {
  const a = t.nodes.find((n) => n.id === l.a);
  const b = t.nodes.find((n) => n.id === l.b);
  return portOf(a, l.aPort)?.group ?? portOf(b, l.bPort)?.group;
}

/** Ruta más corta (en saltos) entre dos equipos. Devuelve los enlaces en orden, o null. */
export function shortestPath(t: Topology, from: string, to: string): { nodes: string[]; links: TopoLink[] } | null {
  if (from === to) return { nodes: [from], links: [] };
  const prev = new Map<string, { node: string; link: TopoLink }>();
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    for (const l of t.links) {
      const other = l.a === id ? l.b : l.b === id ? l.a : null;
      if (!other || seen.has(other)) continue;
      seen.add(other);
      prev.set(other, { node: id, link: l });
      if (other === to) {
        const nodes = [to];
        const links: TopoLink[] = [];
        let cur = to;
        while (cur !== from) {
          const p = prev.get(cur)!;
          links.unshift(p.link);
          nodes.unshift(p.node);
          cur = p.node;
        }
        return { nodes, links };
      }
      queue.push(other);
    }
  }
  return null;
}

/** Ruta en texto: equipo puerto → puerto equipo … (para pegar en un ticket). */
export function pathToText(t: Topology, path: { nodes: string[]; links: TopoLink[] }): string {
  const name = (id: string) => t.nodes.find((n) => n.id === id)?.name ?? id;
  const lines = [name(path.nodes[0])];
  path.links.forEach((l, i) => {
    const from = path.nodes[i];
    const [out, inn] = l.a === from ? [l.aPort, l.bPort] : [l.bPort, l.aPort];
    lines.push(`  ${out} → ${inn}  ${name(path.nodes[i + 1])}`);
  });
  return lines.join("\n");
}

/** Clave de un enlace independiente del sentido y de la nomenclatura de puertos. */
export const linkKey = (l: TopoLink) =>
  [`${l.a}|${canonPort(l.aPort)}`, `${l.b}|${canonPort(l.bPort)}`].sort().join("~");

export interface TopoDiff {
  addedLinks: TopoLink[];
  removedLinks: TopoLink[];
  addedNodes: string[];
  removedNodes: TopoNode[];
}

/** Diferencias entre una topología anterior (snapshot) y la actual. */
export function diffTopology(before: Topology, now: Topology): TopoDiff {
  const nowKeys = new Set(now.links.map(linkKey));
  const beforeKeys = new Set(before.links.map(linkKey));
  const nowIds = new Set(now.nodes.map((n) => n.id));
  const beforeIds = new Set(before.nodes.map((n) => n.id));
  return {
    addedLinks: now.links.filter((l) => !beforeKeys.has(linkKey(l))),
    removedLinks: before.links.filter((l) => !nowKeys.has(linkKey(l))),
    addedNodes: now.nodes.filter((n) => !beforeIds.has(n.id)).map((n) => n.id),
    removedNodes: before.nodes.filter((n) => !nowIds.has(n.id)),
  };
}

/** Diagrama en Mermaid (Confluence, GitLab, GitHub, Obsidian). */
export function toMermaid(t: Topology): string {
  // Nombres y puertos vienen de los equipos: sin comillas, HTML ni saltos de línea que cierren
  // la etiqueta y agreguen directivas (click, href) o marcado al renderizar el diagrama.
  const safe = (s: string) => s.replace(/"/g, "'").replace(/</g, "#lt;").replace(/>/g, "#gt;").replace(/[\r\n]+/g, " ");
  const id = (s: string) => s.replace(/[^\w]/g, "_");
  const lines = ["graph TD"];
  for (const n of t.nodes) lines.push(`  ${id(n.id)}["${safe(n.name)}${n.ip ? `<br/>${safe(n.ip)}` : ""}"]`);
  for (const l of t.links) {
    const g = linkGroup(t, l);
    lines.push(`  ${id(l.a)} ---|"${safe(l.aPort)} ↔ ${safe(l.bPort)}${g ? ` (${safe(g)})` : ""}"| ${id(l.b)}`);
  }
  return lines.join("\n");
}

export function toCsv(t: Topology): string {
  const node = (id: string) => t.nodes.find((n) => n.id === id);
  // Nombres y descripciones vienen de los equipos (CDP/LLDP): una celda que empieza con
  // = + - @ sería una fórmula al abrir el CSV en Excel. Se antepone ' (OWASP CSV injection).
  const q = (s: string | undefined) => {
    const v = s ?? "";
    const formula = /^[=@\t\r]/.test(v) || /^[+-](?!\d+(\.\d+)?$)./.test(v);
    return `"${(formula ? `'${v}` : v).replace(/"/g, '""')}"`;
  };
  return [
    "equipo_a,ip_a,puerto_a,estado_a,velocidad_a,descripcion_a,equipo_b,ip_b,puerto_b,estado_b,velocidad_b,descripcion_b,agregado,protocolo",
    ...t.links.map((l) => {
      const a = node(l.a);
      const b = node(l.b);
      const pa = portOf(a, l.aPort);
      const pb = portOf(b, l.bPort);
      return [
        a?.name ?? l.a, a?.ip, l.aPort, pa?.status, pa?.speed, pa?.desc,
        b?.name ?? l.b, b?.ip, l.bPort, pb?.status, pb?.speed, pb?.desc,
        linkGroup(t, l), l.proto,
      ]
        .map(q)
        .join(",");
    }),
  ].join("\n");
}

/** Archivo .drawio (diagrams.net) editable, con los puertos como etiquetas en cada extremo. */
export function toDrawio(t: Topology, w = 170, h = 54): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#xa;");
  const idx = new Map(t.nodes.map((n, i) => [n.id, `n${i}`]));
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  for (const n of t.nodes) {
    const label = esc(n.ip ? `${n.name}\n${n.ip}` : n.name);
    const style = `rounded=1;whiteSpace=wrap;html=0;fillColor=${n.explored ? "#eaf1ff" : "#f4f5f7"};strokeColor=${n.explored ? "#2563eb" : "#9aa1ab"};fontStyle=1;`;
    cells.push(
      `<mxCell id="${idx.get(n.id)}" value="${label}" style="${style}" vertex="1" parent="1"><mxGeometry x="${Math.round(n.x - w / 2)}" y="${Math.round(n.y - h / 2)}" width="${w}" height="${h}" as="geometry"/></mxCell>`,
    );
  }
  t.links.forEach((l, i) => {
    const s = idx.get(l.a);
    const d = idx.get(l.b);
    if (!s || !d) return;
    const g = linkGroup(t, l);
    cells.push(
      `<mxCell id="e${i}" value="${g ? esc(g) : ""}" style="endArrow=none;html=0;strokeColor=#6a7280;fontSize=10;" edge="1" parent="1" source="${s}" target="${d}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
      `<mxCell id="e${i}a" value="${esc(l.aPort)}" style="edgeLabel;html=0;fontSize=10;" vertex="1" connectable="0" parent="e${i}"><mxGeometry x="-0.7" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry></mxCell>`,
      `<mxCell id="e${i}b" value="${esc(l.bPort)}" style="edgeLabel;html=0;fontSize=10;" vertex="1" connectable="0" parent="e${i}"><mxGeometry x="0.7" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry></mxCell>`,
    );
  });
  return [
    '<mxfile host="NetTerminal">',
    '<diagram name="Topologia" id="topologia">',
    '<mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1200" math="0" shadow="0">',
    `<root>${cells.join("")}</root>`,
    "</mxGraphModel>",
    "</diagram>",
    "</mxfile>",
  ].join("\n");
}
