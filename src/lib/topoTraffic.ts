/**
 * Tráfico en los enlaces de la topología: contadores por SNMP (IF-MIB) o por consola, tasas por
 * diferencia entre lecturas (con vuelta de contadores de 32 bits y reinicios) y tráfico por
 * sentido de cada enlace. Solo lectura: por SNMP solo GET de los contadores y por consola solo
 * los comandos de TRAFFIC_COMMANDS (computeRisk === "read", con test).
 */
import type { LinkTraffic, TopoLink, TopoVendor } from "./topology";
import { canonPort, isCliError } from "./topology";
import { OID } from "./topoSnmp";

/** Lectura de contadores de una interfaz. */
export interface CounterSample {
  inOctets: bigint;
  outOctets: bigint;
  /** 64: ifHCInOctets/ifHCOutOctets o consola; 32: ifInOctets/ifOutOctets (dan la vuelta). */
  bits: 32 | 64;
  /** Velocidad en bits/s (ifHighSpeed x 10^6, ifSpeed o BW de la consola). */
  speed?: number;
  /** Momento de la lectura (ms). */
  ts: number;
}

/** Tasa de una interfaz en bits/s; null si no se puede calcular (primera lectura o reinicio). */
export interface PortRate {
  inBps: number | null;
  outBps: number | null;
  speed?: number;
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
  if (!prev || prev.bits !== cur.bits) return { inBps: null, outBps: null, speed, ts: cur.ts };
  const secs = (cur.ts - prev.ts) / 1000;
  return {
    inBps: rateBps(prev.inOctets, cur.inOctets, cur.bits, secs, speed),
    outBps: rateBps(prev.outOctets, cur.outOctets, cur.bits, secs, speed),
    speed,
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
  const speeds = [ra?.speed, rb?.speed].filter((x): x is number => !!x && x > 0);
  const speed = speeds.length ? Math.min(...speeds) : undefined;
  const util = speed ? Math.max(ab ?? 0, ba ?? 0) / speed : undefined;
  return { ab, ba, ...(speed ? { speed } : {}), ...(util !== undefined ? { util } : {}), ts: Math.max(ra?.ts ?? 0, rb?.ts ?? 0) };
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

/** Contadores por interfaz leídos de la consola (clave canonPort). */
export interface CliCounters {
  name: string;
  inOctets: bigint;
  outOctets: bigint;
  speed?: number;
}

const HEADER = /^(?:(\S+) is (?:administratively )?(?:up|down|deleted)\b|(\S+) current state\s*:|Physical interface:\s*([^,\s]+),)/;
/** Bloques por interfaz con tope: una salida enorme no congela la vista. */
const MAX_CLI_IFACES = 4096;
const MAX_CLI_LEN = 4_000_000;

function speedOf(block: string): number | undefined {
  const bw = block.match(/\bBW (\d{1,12}) Kbit/);
  if (bw) return Number(bw[1]) * 1e3;
  const hw = block.match(/^\s*Speed\s*:\s*(\d{1,7}),/m);
  if (hw) return Number(hw[1]) * 1e6;
  const jn = block.match(/\bSpeed\s*:\s*(\d{1,6}(?:\.\d{1,3})?)\s*([kmgt])bps/i);
  if (jn) return Number(jn[1]) * { k: 1e3, m: 1e6, g: 1e9, t: 1e12 }[jn[2].toLowerCase() as "k" | "m" | "g" | "t"];
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
  const lines = out.slice(0, MAX_CLI_LEN).split(/\r?\n/);
  let name: string | undefined;
  let buf: string[] = [];
  const flush = () => {
    if (name && res.size < MAX_CLI_IFACES) {
      const block = buf.join("\n");
      const c = countersOf(block);
      if (c) res.set(canonPort(name), { name, inOctets: c[0], outOctets: c[1], speed: speedOf(block) });
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
