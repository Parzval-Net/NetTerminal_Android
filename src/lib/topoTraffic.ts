/**
 * Tráfico en los enlaces de la topología: contadores por SNMP (IF-MIB) o por consola, tasas por
 * diferencia entre lecturas (con vuelta de contadores de 32 bits y reinicios) y tráfico por
 * sentido de cada enlace. Solo lectura: por SNMP solo GET de los contadores y por consola solo
 * los comandos de TRAFFIC_COMMANDS (computeRisk === "read", con test).
 */
import type { LinkTraffic, TopoLink, TopoVendor } from "./topology";
import { plainCli } from "./cliText";
import { canonPort, isCliError, knownAddrs, nodeId } from "./topology";
import type { TopoNode } from "./topology";
import { OID } from "./topoSnmp";

/** Lectura de contadores de una interfaz. */
export interface CounterSample {
  inOctets: bigint;
  outOctets: bigint;
  /** 64: ifHCInOctets/ifHCOutOctets o consola; 32: ifInOctets/ifOutOctets (dan la vuelta). */
  bits: 32 | 64;
  /** Velocidad en bits/s (ifHighSpeed x 10^6, ifSpeed, velocidad física o BW de la consola). */
  speed?: number;
  /** La velocidad es el "BW" configurado (puede ser menor que la real): no sirve para descartar tasas. */
  approx?: boolean;
  /** Momento de la lectura (ms). */
  ts: number;
}

/** Tasa de una interfaz en bits/s; null si no se puede calcular (primera lectura o reinicio). */
export interface PortRate {
  inBps: number | null;
  outBps: number | null;
  speed?: number;
  approx?: boolean;
  ts: number;
}

const TWO32 = 1n << 32n;

/**
 * Diferencia entre dos lecturas. Con 32 bits un valor menor se toma como una vuelta (2^32);
 * con 64 bits una vuelta es imposible en la práctica, así que es un reinicio (null).
 */
export function counterDelta(prev: bigint, cur: bigint, bits: 32 | 64): { d: bigint; wrapped: boolean } | null {
  if (cur >= prev) return { d: cur - prev, wrapped: false };
  if (bits === 32 && prev < TWO32 && cur < TWO32) return { d: cur + TWO32 - prev, wrapped: true };
  return null;
}

/** Margen sobre la velocidad para aceptar una tasa (ráfagas y redondeo de la velocidad). */
const OVER_SPEED = 1.5;

/**
 * Tasa en bits/s entre dos lecturas de un contador. Se descarta (null) si el contador se reinició
 * (equipo reiniciado o "clear counters") y, cuando se conoce la velocidad, si el resultado es
 * imposible: así un reinicio de un contador de 32 bits no se confunde con una vuelta.
 */
export function rateBps(prev: bigint, cur: bigint, bits: 32 | 64, seconds: number, speed?: number): number | null {
  if (!(seconds > 0)) return null;
  const delta = counterDelta(prev, cur, bits);
  if (!delta) return null;
  const bps = (Number(delta.d) * 8) / seconds;
  if (speed && bps > speed * OVER_SPEED) return null;
  return bps;
}

/** Tasas de una interfaz entre dos lecturas (de la misma fuente). */
export function portRate(prev: CounterSample | undefined, cur: CounterSample): PortRate {
  const speed = cur.speed && cur.speed > 0 ? cur.speed : undefined;
  const approx = speed && cur.approx ? { approx: true as const } : {};
  if (!prev || prev.bits !== cur.bits) return { inBps: null, outBps: null, speed, ...approx, ts: cur.ts };
  const secs = (cur.ts - prev.ts) / 1000;
  // Con el BW configurado la velocidad puede ser menor que la real: no se descarta por 1,5x.
  const limit = cur.approx ? undefined : speed;
  return {
    inBps: rateBps(prev.inOctets, cur.inOctets, cur.bits, secs, limit),
    outBps: rateBps(prev.outOctets, cur.outOctets, cur.bits, secs, limit),
    speed,
    ...approx,
    ts: cur.ts,
  };
}

/**
 * Tráfico de un enlace en ambos sentidos. A→B es lo que sale por el puerto de A (o, si A no se
 * lee, lo que entra por el de B); B→A, al revés. La velocidad es la menor informada. Sin al menos
 * una tasa calculada devuelve null (falta una segunda lectura).
 */
export function linkTraffic(l: TopoLink, rates: Map<string, Map<string, PortRate>>): LinkTraffic | null {
  const ra = l.aPort ? rates.get(l.a)?.get(canonPort(l.aPort)) : undefined;
  const rb = l.bPort ? rates.get(l.b)?.get(canonPort(l.bPort)) : undefined;
  const ab = ra?.outBps ?? rb?.inBps ?? null;
  const ba = ra?.inBps ?? rb?.outBps ?? null;
  if (ab === null && ba === null) return null;
  // La menor velocidad informada; una física (exacta) gana sobre un BW configurado.
  const known = [ra, rb].filter((r): r is PortRate => !!r?.speed && r.speed > 0);
  const exact = known.filter((r) => !r.approx);
  const pool = exact.length ? exact : known;
  const speed = pool.length ? Math.min(...pool.map((r) => r.speed!)) : undefined;
  const approx = !exact.length && known.length > 0;
  const util = speed ? Math.max(ab ?? 0, ba ?? 0) / speed : undefined;
  return {
    ab,
    ba,
    ...(speed ? { speed } : {}),
    ...(util !== undefined ? { util } : {}),
    ...(approx ? { approx: true } : {}),
    ts: Math.max(ra?.ts ?? 0, rb?.ts ?? 0),
  };
}

/**
 * Pestaña del equipo: la del salto que llegó a él (si la hay) o la que apunta a su IP o nombre. Una
 * pestaña de salto que está en otro equipo (via) no cuenta como la del equipo al que se conectó
 * ni por IP ni por nombre: su prompt es el del vecino.
 */
export function terminalFor<T extends { connId: string; name: string; host?: string }>(n: TopoNode, terminals: T[], via?: Record<string, string>): T | undefined {
  const hopped = new Set(Object.values(via ?? {}));
  return (
    (via?.[n.id] ? terminals.find((t) => t.connId === via[n.id]) : undefined) ??
    terminals.find((t) => !hopped.has(t.connId) && ((t.host && knownAddrs(n).includes(t.host)) || nodeId(t.name) === n.id))
  );
}

// ---------- SNMP ----------

/** Máximo de interfaces por equipo en una lectura (3 OID cada una: cabe en un GET de 192). */
export const MAX_TRAFFIC_IFACES = 64;

/** OIDs de contadores para un GET: 64 bits (ifXTable) o, si el agente no los tiene, 32 bits. */
export function counterOids(ifIndexes: number[], hc: boolean): string[] {
  const cols = hc ? [OID.ifHCInOctets, OID.ifHCOutOctets, OID.ifHighSpeed] : [OID.ifInOctets, OID.ifOutOctets, OID.ifSpeed];
  return ifIndexes.slice(0, MAX_TRAFFIC_IFACES).flatMap((i) => cols.map((c) => `${c}.${i}`));
}

export interface GetRow {
  oid: string;
  type: string;
  value: string;
}

const big = (v: string | undefined) => (v !== undefined && /^\d{1,20}$/.test(v) ? BigInt(v) : undefined);

/**
 * Contadores por ifIndex desde el GET. `hc` = false si ningún contador de 64 bits respondió
 * (noSuchObject/noSuchInstance): hay que pedir los de 32 bits.
 */
export function parseCounterGets(rows: GetRow[], ifIndexes: number[], hc: boolean, ts: number): { samples: Map<number, CounterSample>; hcMissing: boolean } {
  const val = new Map(rows.filter((r) => /^(Counter32|Counter64|Gauge32|INTEGER)$/.test(r.type)).map((r) => [r.oid, r.value]));
  const samples = new Map<number, CounterSample>();
  const [ci, co, cs] = hc ? [OID.ifHCInOctets, OID.ifHCOutOctets, OID.ifHighSpeed] : [OID.ifInOctets, OID.ifOutOctets, OID.ifSpeed];
  for (const i of ifIndexes) {
    const inO = big(val.get(`${ci}.${i}`));
    const outO = big(val.get(`${co}.${i}`));
    if (inO === undefined || outO === undefined) continue;
    const sp = Number(val.get(`${cs}.${i}`));
    // ifHighSpeed en Mb/s; ifSpeed en b/s (tope 4.294.967.295: sobre eso informa ifHighSpeed).
    const speed = Number.isFinite(sp) && sp > 0 ? (hc ? sp * 1e6 : sp) : undefined;
    samples.set(i, { inOctets: inO, outOctets: outO, bits: hc ? 64 : 32, speed, ts });
  }
  return { samples, hcMissing: hc && samples.size === 0 && ifIndexes.length > 0 };
}

// ---------- Consola ----------

/**
 * Comando de contadores por fabricante (solo consulta, uno por lectura y equipo):
 * - Cisco IOS/IOS-XE "show interfaces" ("N packets input, N bytes", "BW N Kbit"), Cisco IOS
 *   Command Reference, "show interfaces",
 *   https://www.cisco.com/E-Learning/bulk/public/tac/cim/cib/using_cisco_ios_software/cmdrefs/show_interfaces.htm
 *   NX-OS no reconoce "show interfaces": se prueba "show interface" (RX/TX "N input packets N bytes").
 * - Huawei VRP "display interface" ("current state", "Speed : 100", "Input: N packets, N bytes"),
 *   Huawei, "display interface gigabitethernet 0/0/1" (guía de AR),
 *   https://info.support.huawei.com/network/ptmngsys/Web/tsrev_ar/en/content/ar/13_edesk_pppoe_cannot_dialup_to_the_internet/edesk_pppoe_cannot_dialup_to_the_internet_edesk002.html
 * - Junos "show interfaces extensive" ("Physical interface:", "Speed:", "Traffic statistics:
 *   Input bytes / Output bytes"), Juniper, "show interfaces extensive",
 *   https://juniper.net/documentation/en_US/junos13.1/topics/reference/command-summary/show-interfaces-extensive.html
 * FortiOS queda fuera (sin comando de consulta verificado con contadores por interfaz).
 */
export const TRAFFIC_COMMANDS: Record<TopoVendor, string | undefined> = {
  cisco: "show interfaces",
  huawei: "display interface",
  juniper: "show interfaces extensive",
  fortinet: undefined,
};
export const TRAFFIC_FALLBACK: Record<string, string> = { "show interfaces": "show interface" };

/**
 * Comandos de contadores a probar para una sesión, en orden. Con la plataforma detectada (o
 * fijada en el catálogo) va el comando de su fabricante; si no, el del resaltado elegido; y si
 * tampoco hay resaltado ("Según ajustes"), Cisco y luego Huawei: antes un Huawei sin resaltado
 * recibía "show interfaces", fallaba y el enlace quedaba sin tráfico. Solo comandos de consulta.
 */
export function trafficCommands(platform: string | undefined, highlightVendor: TopoVendor | undefined): string[] {
  const p = platform ?? "";
  const vendor: TopoVendor | undefined = /^(vrp|yunshan)/.test(p)
    ? "huawei"
    : /^(junos|ex-legacy)/.test(p)
      ? "juniper"
      : /^fos/.test(p)
        ? "fortinet"
        : /^(ios|iosxe|iosxr|nxos)$/.test(p)
          ? "cisco"
          : highlightVendor;
  const base = vendor ? [TRAFFIC_COMMANDS[vendor]] : [TRAFFIC_COMMANDS.cisco, TRAFFIC_COMMANDS.huawei];
  const out: string[] = [];
  for (const c of base) {
    if (!c) continue;
    out.push(c);
    if (TRAFFIC_FALLBACK[c]) out.push(TRAFFIC_FALLBACK[c]);
  }
  return [...new Set(out)];
}

/** Contadores por interfaz leídos de la consola (clave canonPort). */
export interface CliCounters {
  name: string;
  inOctets: bigint;
  outOctets: bigint;
  speed?: number;
  /** La velocidad salió de "BW N Kbit" (configurable con "bandwidth"), no de la física. */
  speedApprox?: true;
}

const HEADER = /^(?:(\S+) is (?:administratively )?(?:up|down|deleted)\b|(\S+) current state\s*:|Physical interface:\s*([^,\s]+),)/;
/** Bloques por interfaz con tope: una salida enorme no congela la vista. */
const MAX_CLI_IFACES = 4096;
const MAX_CLI_LEN = 4_000_000;

/**
 * "--More--" (IOS, NX-OS), "---- More ----" (VRP) y "---(more)---" (Junos) con el borrado que envía el
 * equipo al avanzar de página: "\r" + espacios + "\r", retrocesos o ESC[K.
 */
const PAGER = /[ \t]*-{2,}[ \t]*\(?more\)?(?: \d+%)?[ \t]*-{2,}[ \t]*(?:\r[ \t]*\r|\x08+[ \t]*\x08+|\x1b\[K)?/gi;

const UNIT = { k: 1e3, m: 1e6, g: 1e9, t: 1e12 } as const;

/**
 * Velocidad de la interfaz. Cisco informa la física junto al dúplex ("Full-duplex, 1000Mb/s",
 * "full-duplex, 10 Gb/s" en NX-OS, "Full Duplex, 1000Mbps") y además "BW N Kbit", que es
 * configurable con "bandwidth" y puede ser menor que la real: la física gana y, si solo hay BW,
 * la velocidad queda marcada como aproximada.
 */
function speedOf(block: string): { speed: number; approx?: true } | undefined {
  const phys = block.match(/\b(?:full|half)[- ]duplex,\s*(\d{1,6}(?:\.\d{1,3})?)\s*([kmgt])(?:b\/s|bps)/i);
  if (phys) return { speed: Number(phys[1]) * UNIT[phys[2].toLowerCase() as keyof typeof UNIT] };
  const bw = block.match(/\bBW (\d{1,12}) Kbit/);
  if (bw) return { speed: Number(bw[1]) * 1e3, approx: true };
  const hw = block.match(/^\s*Speed\s*:\s*(\d{1,7}),/m);
  if (hw) return { speed: Number(hw[1]) * 1e6 };
  const jn = block.match(/\bSpeed\s*:\s*(\d{1,6}(?:\.\d{1,3})?)\s*([kmgt])bps/i);
  if (jn) return { speed: Number(jn[1]) * UNIT[jn[2].toLowerCase() as keyof typeof UNIT] };
  return undefined;
}

function countersOf(block: string): [bigint, bigint] | null {
  // Junos: solo la interfaz física (antes de la primera interfaz lógica).
  const phys = block.split(/^\s*Logical interface\b/m)[0];
  const pairs: [RegExp, RegExp][] = [
    [/(\d{1,20}) packets input, (\d{1,20}) bytes/, /(\d{1,20}) packets output, (\d{1,20}) bytes/],
    [/(\d{1,20}) input packets\s+(\d{1,20}) bytes/, /(\d{1,20}) output packets\s+(\d{1,20}) bytes/],
    [/Input:\s*(\d{1,20}) packets,\s*(\d{1,20}) bytes/, /Output:\s*(\d{1,20}) packets,\s*(\d{1,20}) bytes/],
    [/Input\s+bytes\s*:\s*()(\d{1,20})/, /Output\s+bytes\s*:\s*()(\d{1,20})/],
  ];
  for (const [ri, ro] of pairs) {
    const i = phys.match(ri);
    const o = phys.match(ro);
    if (i && o) return [BigInt(i[2]), BigInt(o[2])];
  }
  return null;
}

/** Contadores de "show interfaces", "show interface" (NX-OS), "display interface" o Junos extensive. */
export function parseCliCounters(out: string): Map<string, CliCounters> {
  const res = new Map<string, CliCounters>();
  if (!out || isCliError(out)) return res;
  // Lo que dejó el paginador ("--More--" y su borrado con retrocesos o ESC[K) queda pegado a la
  // primera línea de cada página; si es el encabezado de una interfaz, esta se perdía y sus
  // contadores se atribuían a la anterior. Se lee como lo muestra la terminal.
  const lines = plainCli(out.slice(0, MAX_CLI_LEN).replace(PAGER, "")).split("\n");
  let name: string | undefined;
  let buf: string[] = [];
  const flush = () => {
    if (name && res.size < MAX_CLI_IFACES) {
      const block = buf.join("\n");
      const c = countersOf(block);
      const sp = speedOf(block);
      if (c) res.set(canonPort(name), { name, inOctets: c[0], outOctets: c[1], speed: sp?.speed, ...(sp?.approx ? { speedApprox: true as const } : {}) });
    }
    buf = [];
  };
  for (const line of lines) {
    const m = line.match(HEADER);
    if (m) {
      flush();
      name = m[1] ?? m[2] ?? m[3];
    }
    buf.push(line);
  }
  flush();
  return res;
}
