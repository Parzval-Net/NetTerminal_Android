/**
 * Contraseñas de vecinos alcanzados por salto (bóveda cifrada, ver credentials.rs): clave por IP y
 * usuario. Aquí solo hay validación y presentación; la contraseña nunca pasa por JS salvo cuando el
 * usuario la teclea en el campo oculto de HopPasswordDialog (va directo a Rust y se descarta).
 */
import { isIpv4, isIpv6 } from "./topology";

/** Un vecino con contraseña guardada (sin la contraseña). */
export interface HopCredInfo {
  ip: string;
  user: string;
  /** Último uso en un salto (segundos Unix); null si nunca se usó. */
  last_used: number | null;
}

/** Usuario de un comando de salto: mismas reglas que HOP_USER (topology.ts) y valid_hop_user (credentials.rs). */
export const validHopUser = (u: string) => /^[A-Za-z0-9][\w.@\\-]{0,63}$/.test(u);
export const isIpLiteral = (ip: string) => isIpv4(ip) || isIpv6(ip);

/** Clave para comparar entradas: IP en minúsculas y usuario tal cual (la cuenta distingue mayúsculas). */
export const hopCredKey = (ip: string, user: string) => `${ip.trim().toLowerCase()}|${user.trim()}`;

/** "nunca" o la fecha local del último uso. */
export const lastUsedText = (secs: number | null | undefined) => (secs ? new Date(secs * 1000).toLocaleString() : "nunca");
