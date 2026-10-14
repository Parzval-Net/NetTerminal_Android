/** Topología desde CDP/LLDP: comandos por fabricante, lectura de salidas y grafo. */

export interface Neighbor {
  name: string;
  localPort: string;
  remotePort: string;
  ip?: string;
  platform?: string;
  proto: "CDP" | "LLDP";
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

/** Comandos de vecinos por fabricante (todos de solo lectura). */
export const NEIGHBOR_COMMANDS: Record<string, string[]> = {
  cisco: ["show cdp neighbors detail", "show lldp neighbors detail"],
  huawei: ["display lldp neighbor"],
  juniper: ["show lldp neighbors"],
};

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
  for (const [re, s] of map) if (re.test(p)) return p.replace(re, s);
  return p;
}

/**
 * Forma canónica de una interfaz para comparar entre fabricantes:
 * GE0/0/1 (Huawei) = GigabitEthernet0/0/1 (Cisco) = Gi0/0/1 -> "gi0/0/1".
 */
export function canonPort(p: string): string {
  const s = p.trim().toLowerCase().replace(/\s+/g, "");
  const families: [RegExp, string][] = [
    [/^(hundredgig(abit)?e(thernet)?|hu|100ge)/, "hu"],
    [/^(fortygig(abit)?e(thernet)?|fo|40ge)/, "fo"],
    [/^(twentyfivegig(abit)?e(thernet)?|twe|25ge)/, "twe"],
    [/^(tengig(abit)?e(thernet)?|xgigabitethernet|xge|te|10ge)/, "te"],
    [/^(gigabitethernet|gige|gi|ge)/, "gi"],
    [/^(fastethernet|fa)/, "fa"],
    [/^(port-channel|po|eth-trunk|bundle-ether|be)/, "po"],
    [/^(ethernet|eth|et)/, "eth"],
  ];
  for (const [re, fam] of families) if (re.test(s)) return s.replace(re, fam);
  return s;
}

/** Hostname desde el prompt al final de la salida (Router#, <SW>, user@host>). */
export function promptName(output: string): string | null {
  const last = output.trimEnd().split("\n").pop() ?? "";
  const m =
    last.match(/^<([\w.\-]+)>\s*$/) ||
    last.match(/^\[~?\*?([\w.\-]+)[^\]]*\]\s*$/) ||
    last.match(/^[\w.\-]+@([\w.\-]+)[>#%]\s*$/) ||
    last.match(/^([\w.\-]+)(?:\([^)]*\))?[#>]\s*$/);
  return m ? m[1] : null;
}

function field(block: string, re: RegExp): string | undefined {
  return block.match(re)?.[1]?.trim() || undefined;
}

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
          ip: field(b, /(?:IP(?:v4)? [Aa]ddress|IP address):\s*(\d+\.\d+\.\d+\.\d+)/),
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
          ip: field(b, /Management Addresses:[\s\S]*?IP:\s*(\d+\.\d+\.\d+\.\d+)/),
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
        ip: field(nb, /Management address\s*:\s*(\d+\.\d+\.\d+\.\d+)/),
        platform: field(nb, /System description\s*:\s*([^\n]+)/),
        proto: "LLDP",
      });
    }
  }
  return res;
}

/** Junos "show lldp neighbors" (tabla resumida). */
export function parseJunosLldp(out: string): Neighbor[] {
  const res: Neighbor[] = [];
  for (const line of out.split("\n")) {
    // Local Interface  Parent Interface  Chassis Id  Port info  System Name
    const m = line.match(/^(\S+)\s+(\S+)\s+([0-9a-f]{2}(?::[0-9a-f]{2}){5})\s+(\S+)\s+(\S+)\s*$/i);
    if (m) res.push({ name: m[5], localPort: m[1], remotePort: m[4], proto: "LLDP" });
  }
  return res;
}

export function parseNeighbors(vendor: string, outputs: string[]): Neighbor[] {
  const all =
    vendor === "huawei"
      ? outputs.flatMap(parseHuaweiLldp)
      : vendor === "juniper"
        ? outputs.flatMap(parseJunosLldp)
        : outputs.flatMap((o) => [...parseCdp(o), ...parseCiscoLldp(o)]);
  // CDP y LLDP pueden reportar el mismo enlace: se conserva uno por puerto local.
  const seen = new Set<string>();
  return all.filter((n) => {
    const k = `${shortPort(n.localPort).toLowerCase()}|${nodeId(n.name)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Incorpora los vecinos de un equipo al grafo (sin duplicar enlaces en ambos sentidos). */
export function mergeNeighbors(t: Topology, device: { name: string; ip?: string; platform?: string }, neighbors: Neighbor[]): Topology {
  const nodes = [...t.nodes];
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
  for (const nb of neighbors) {
    const other = ensure(nb.name, { ip: nb.ip, platform: nb.platform });
    if (other.id === self.id) continue;
    const aPort = shortPort(nb.localPort);
    const bPort = shortPort(nb.remotePort);
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
  const byLevel = new Map<number, string[]>();
  for (const n of t.nodes) {
    const lv = level.get(n.id) ?? 0;
    byLevel.set(lv, [...(byLevel.get(lv) ?? []), n.id]);
  }
  const nodes = t.nodes.map((n) => {
    if (n.x || n.y) return n;
    const lv = level.get(n.id) ?? 0;
    const row = byLevel.get(lv)!;
    const i = row.indexOf(n.id);
    return { ...n, x: 140 + i * 240 - ((row.length - 1) * 240) / 2 + 400, y: 80 + lv * 170 };
  });
  return { nodes, links: t.links };
}

/** Diagrama en Mermaid (Confluence, GitLab, GitHub, Obsidian). */
export function toMermaid(t: Topology): string {
  const safe = (s: string) => s.replace(/"/g, "'");
  const lines = ["graph TD"];
  for (const n of t.nodes) lines.push(`  ${n.id.replace(/[^\w]/g, "_")}["${safe(n.name)}${n.ip ? `<br/>${n.ip}` : ""}"]`);
  for (const l of t.links) lines.push(`  ${l.a.replace(/[^\w]/g, "_")} ---|"${safe(l.aPort)} ↔ ${safe(l.bPort)}"| ${l.b.replace(/[^\w]/g, "_")}`);
  return lines.join("\n");
}

export function toCsv(t: Topology): string {
  const name = (id: string) => t.nodes.find((n) => n.id === id)?.name ?? id;
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return [
    "equipo_a,puerto_a,equipo_b,puerto_b,protocolo",
    ...t.links.map((l) => [name(l.a), l.aPort, name(l.b), l.bPort, l.proto].map(q).join(",")),
  ].join("\n");
}
