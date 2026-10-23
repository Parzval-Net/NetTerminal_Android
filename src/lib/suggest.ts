/**
 * Sugerencias de comandos (beta): lógica pura, sin DOM ni xterm, para poder probarla.
 *
 * - InputTracker: estado de lo tecleado desde el último prompt. Ante cualquier duda
 *   (tecla de control, pegado, salida que redibuja la línea, pedido de credenciales) deja
 *   de seguir la línea hasta el próximo prompt. Nunca guarda ni registra el contenido.
 * - Índice por plataforma: arreglo ordenado de comandos del catálogo con búsqueda binaria
 *   por prefijo. Se construye la primera vez que se usa y queda en caché.
 * - Seguridad: el texto gris solo ofrece consultas; lo que inserta una sugerencia nunca
 *   incluye Enter, saltos de línea ni caracteres de control, y se corta en el primer
 *   marcador ({{interfaz}} o <interfaz>).
 */
import { type CatalogVendor, type Risk, appliesTo, commandFor, computeRisk } from "./packs";

/** Prompt típico de equipos y shells (también lo usan los comandos al conectar). */
export const PROMPT = /[>#$%\]]\s*$/;
/** Pedido de usuario, contraseña o passphrase: ahí no se sigue lo tecleado. */
export const CREDENTIALS = /(password|passphrase|contraseña|username|user name|login)[^\n]*:\s*$/i;

/** Tope de la línea seguida: una línea más larga deja de sugerir. */
const MAX_BUF = 256;

// ---------- Estado de la línea ----------

export class InputTracker {
  /** Lo tecleado desde el prompt (solo válido con `sync`). */
  buf = "";
  /** La línea en pantalla es exactamente prompt + buf. */
  sync = false;
  /** Pantalla con pedido de credenciales: no se sigue nada. */
  cred = false;
  /** Hubo teclas sin seguimiento desde el último salto de línea: un "#" tecleado no es un prompt. */
  private dirty = false;

  /** Deja de seguir la línea hasta el próximo prompt. */
  reset() {
    this.buf = "";
    this.sync = false;
    this.dirty = true;
  }

  /** Estado inicial (conexión nueva). */
  clear() {
    this.buf = "";
    this.sync = false;
    this.cred = false;
    this.dirty = false;
  }

  /** Se puede sugerir sobre la línea actual. */
  get active() {
    return this.sync && !this.cred;
  }

  /** Lo que la terminal envía al equipo por teclado (term.onData). */
  input(data: string) {
    if (!this.active) {
      // Sin seguimiento (o con credenciales en pantalla) no se guarda nada de lo tecleado.
      this.buf = "";
      this.sync = false;
      this.dirty = true;
      return;
    }
    if (data === "\r" || data === "\n" || data === "\r\n") {
      // Enter limpia; se vuelve a seguir cuando aparezca el próximo prompt.
      this.buf = "";
      this.sync = false;
      this.dirty = true;
      return;
    }
    if (data === "\x7f" || data === "\b") {
      const n = this.buf.length;
      const low = n > 1 && /[\udc00-\udfff]/.test(this.buf[n - 1]);
      this.buf = this.buf.slice(0, low ? n - 2 : n - 1);
      return;
    }
    if (isPrintable(data) && this.buf.length + data.length <= MAX_BUF) {
      this.buf += data;
      return;
    }
    // Flechas, Tab, Esc, Ctrl+A/E/U/W/R, Inicio/Fin, pegado o texto compuesto (IME).
    this.reset();
  }

  /** Texto insertado por una sugerencia (ya saneado con safeInsert). */
  insert(text: string) {
    if (!this.active || !text) return;
    if (!isPlainText(text) || this.buf.length + text.length > MAX_BUF) return this.reset();
    this.buf += text;
  }

  /**
   * Salida del equipo. El eco de lo tecleado no trae saltos de línea; un salto de línea
   * (salida nueva, mensaje asíncrono, línea redibujada) corta el seguimiento y se vuelve
   * a seguir solo si la pantalla termina en un prompt. `tail` entrega el final limpio de
   * la salida y solo se llama si hace falta.
   */
  output(chunk: string, tail: () => string) {
    const nl = /[\r\n]/.test(chunk);
    if (this.sync) {
      if (!nl) return;
      this.buf = "";
      this.sync = false;
    }
    if (nl) this.dirty = false;
    if (this.dirty) return;
    const t = tail();
    this.cred = CREDENTIALS.test(t);
    if (!this.cred && PROMPT.test(t)) {
      this.buf = "";
      this.sync = true;
    }
  }
}

/** Una tecla imprimible (un carácter, o un par sustituto). */
function isPrintable(data: string): boolean {
  if (data.length === 1) {
    const c = data.charCodeAt(0);
    return c >= 0x20 && c !== 0x7f && !(c >= 0x80 && c < 0xa0) && !(c >= 0xd800 && c <= 0xdfff);
  }
  return data.length === 2 && /^[\ud800-\udbff][\udc00-\udfff]$/.test(data);
}

/** Sin caracteres de control (C0, DEL, C1) ni saltos de línea. */
const CONTROL = /[\x00-\x1f\x7f-\x9f]/;
const isPlainText = (s: string) => !CONTROL.test(s);

// ---------- Índice por plataforma ----------

export interface SuggestEntry {
  /** Comando completo para la plataforma (puede traer marcadores). */
  cmd: string;
  /** cmd en minúsculas, para comparar el prefijo. */
  key: string;
  /** Parte que se puede insertar: hasta el primer marcador, sin él. */
  insert: string;
  /** Hay un marcador después de `insert`. */
  placeholder: boolean;
  risk: Risk;
  desc: string;
  /** Posición en el catálogo (desempate estable). */
  order: number;
}

export interface SuggestIndex {
  platform: string;
  /** Ordenado por `key`. */
  entries: SuggestEntry[];
}

/** {{variable}} de las plantillas o <marcador> de la documentación de los fabricantes. */
const PLACEHOLDER = /\{\{[^}]*\}\}|<[A-Za-z][\w .:/-]*>/;
const RANK: Record<Risk, number> = { read: 0, change: 1, disruptive: 2 };

/** Texto que se puede insertar de un comando: se corta en el primer marcador. */
export function insertablePart(cmd: string): { insert: string; placeholder: boolean } {
  const m = PLACEHOLDER.exec(cmd);
  return m ? { insert: cmd.slice(0, m.index), placeholder: true } : { insert: cmd, placeholder: false };
}

/** Construye el índice de una plataforma (null si ningún fabricante la declara). */
export function buildIndex(vendors: CatalogVendor[], platform: string): SuggestIndex | null {
  const vendor = vendors.find((v) => v.platforms.some((p) => p.id === platform));
  if (!vendor) return null;
  const seen = new Set<string>();
  const entries: SuggestEntry[] = [];
  vendor.commands.forEach((c, order) => {
    if (!appliesTo(c, platform)) return;
    const cmd = commandFor(c, platform).trim();
    // Un comando de varias líneas exige Enter entre ellas: no se sugiere.
    if (!cmd || CONTROL.test(cmd)) return;
    const key = cmd.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const computed = computeRisk(cmd);
    const risk = RANK[computed] > RANK[c.risk] ? computed : c.risk;
    entries.push({ cmd, key, ...insertablePart(cmd), risk, desc: c.desc, order });
  });
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.order - b.order));
  return { platform, entries };
}

const cache = new WeakMap<CatalogVendor[], Map<string, SuggestIndex | null>>();

/** Índice de la plataforma, construido la primera vez y guardado mientras el catálogo no cambie. */
export function getIndex(vendors: CatalogVendor[], platform: string): SuggestIndex | null {
  let byPlatform = cache.get(vendors);
  if (!byPlatform) cache.set(vendors, (byPlatform = new Map()));
  let idx = byPlatform.get(platform);
  if (idx === undefined) {
    idx = buildIndex(vendors, platform);
    byPlatform.set(platform, idx);
  }
  return idx;
}

/** Primera posición cuya clave es >= q. */
function lowerBound(entries: SuggestEntry[], q: string): number {
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (entries[mid].key < q) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Mejor primero: el orden del catálogo (cada pack parte por los comandos de uso diario,
 * como show version o display interface brief) y, si empata, el más corto.
 */
const better = (a: SuggestEntry, b: SuggestEntry) => a.order < b.order || (a.order === b.order && a.cmd.length < b.cmd.length);

/** El prefijo cae dentro de la parte insertable (o el comando no tiene marcadores). */
const fits = (e: SuggestEntry, q: string) => !e.placeholder || q.length <= e.insert.length;

/** Lo que se compara: la línea sin espacios iniciales, en minúsculas. */
export const queryOf = (buf: string) => buf.trimStart().toLowerCase();

/**
 * Hasta `limit` comandos que empiezan con lo tecleado, del mejor al peor. Con
 * `readOnly` solo se consideran consultas.
 */
export function lookup(idx: SuggestIndex, buf: string, limit: number, readOnly = false): SuggestEntry[] {
  const q = queryOf(buf);
  const out: SuggestEntry[] = [];
  const { entries } = idx;
  for (let i = lowerBound(entries, q); i < entries.length; i++) {
    const e = entries[i];
    if (!e.key.startsWith(q)) break;
    if ((readOnly && e.risk !== "read") || !fits(e, q)) continue;
    // Inserción ordenada en una lista corta (sin ordenar el rango completo).
    let j = out.length;
    if (j === limit && !better(e, out[j - 1])) continue;
    if (j === limit) out.pop(), j--;
    while (j > 0 && better(e, out[j - 1])) j--;
    out.splice(j, 0, e);
  }
  return out;
}

export interface Ghost {
  entry: SuggestEntry;
  /** Lo que se ve en gris (resto del comando, con su marcador). */
  rest: string;
  /** Lo que inserta Flecha derecha ("" si ya se llegó al marcador). */
  insert: string;
}

/** Mínimo de caracteres tecleados para mostrar texto gris. */
export const GHOST_MIN = 2;

/**
 * Sugerencia en gris: la mejor consulta que extiende lo tecleado. Lo que cambia
 * configuración o puede cortar servicio nunca se ofrece así.
 */
export function ghostFor(idx: SuggestIndex, buf: string): Ghost | null {
  const q = queryOf(buf);
  if (q.length < GHOST_MIN) return null;
  let best: SuggestEntry | null = null;
  const { entries } = idx;
  for (let i = lowerBound(entries, q); i < entries.length; i++) {
    const e = entries[i];
    if (!e.key.startsWith(q)) break;
    if (e.risk !== "read" || e.key.length === q.length || !fits(e, q)) continue;
    if (!best || better(e, best)) best = e;
  }
  if (!best) return null;
  return { entry: best, rest: best.cmd.slice(q.length), insert: remainderToInsert(best, buf) };
}

/** Texto que falta escribir para completar `entry` desde lo tecleado (nunca Enter). */
export function remainderToInsert(entry: SuggestEntry, buf: string): string {
  const q = queryOf(buf);
  if (!entry.key.startsWith(q) || q.length >= entry.insert.length) return "";
  return safeInsert(entry.insert.slice(q.length));
}

/** Última barrera: corta en el primer salto de línea y quita cualquier carácter de control. */
export function safeInsert(text: string): string {
  const cut = text.search(/[\r\n]/);
  return (cut >= 0 ? text.slice(0, cut) : text).replace(/[\x00-\x1f\x7f-\x9f]/g, "");
}

// ---------- Teclado ----------

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

/**
 * Qué hace una tecla con las sugerencias activas:
 * pass (va al equipo), accept (inserta el texto gris), open (abre la lista),
 * up/down (mueve la selección), pick (inserta el elegido), close (cierra la lista).
 */
export type KeyAction = "pass" | "accept" | "open" | "up" | "down" | "pick" | "close";

export function suggestKey(e: KeyLike, ctx: { enabled: boolean; listOpen: boolean; canAccept: boolean }): KeyAction {
  if (!ctx.enabled || e.isComposing) return "pass";
  // Tab siempre llega al equipo: se conserva el autocompletado nativo.
  if (e.key === "Tab") return "pass";
  const plain = !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
  if (ctx.listOpen) {
    if (plain && e.key === "ArrowUp") return "up";
    if (plain && e.key === "ArrowDown") return "down";
    if (plain && e.key === "Enter") return "pick";
    if (e.key === "Escape") return "close";
    return "pass";
  }
  if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === " " || e.code === "Space")) return "open";
  if (plain && e.key === "ArrowRight" && ctx.canAccept) return "accept";
  return "pass";
}
