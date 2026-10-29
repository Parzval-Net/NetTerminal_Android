/**
 * "Saltar desde X" en una pestaña propia: se abre una pestaña nueva hacia el equipo pivote (con la
 * misma sesión que la pestaña activa), se espera su prompt real y recién ahí se envía el comando de
 * salto al vecino. La pestaña activa no se toca. Lógica pura (sin DOM ni backend) para poder probarla:
 * el estado se avanza con `stepHop` a partir de lo que muestra la pantalla de la pestaña.
 *
 * Nunca se envía a ciegas: con el prompt sin aparecer (login, contraseña, banner, "--More--") el
 * comando llegaría a medias al equipo ("how interfaces" por un carácter perdido). Las preguntas del
 * salto (llave del equipo, usuario, contraseña) las contesta el usuario: la herramienta no inventa
 * ni reutiliza la contraseña del pivote.
 */
import { promptName } from "./cliText";
import { nodeId } from "./topology";
import type { Session } from "../types";

/** Cuánto se espera el prompt del pivote (el usuario puede estar escribiendo su contraseña). */
export const PROMPT_WAIT_MS = 120_000;
/** Con el salto enviado: sin cambios en pantalla y sin pregunta pendiente, el equipo no responde. */
export const HOP_IDLE_MS = 45_000;
/** Tope de espera de una pregunta que contesta el usuario (contraseña, llave). */
export const USER_WAIT_MS = 600_000;
/** El prompt debe llevar este tiempo sin cambios antes de enviar: el banner o un redibujo no cuentan. */
export const PROMPT_STABLE_MS = 600;
/** Tras un error reconocido, la pantalla debe quedar quieta este tiempo para darlo por definitivo. */
export const ERROR_SETTLE_MS = 1_500;

/** Sesión de la pestaña de salto: la misma del pivote, sin reconectar sola ni repetir comandos de inicio. */
export function hopTabSession(base: Session, title: string): Session {
  return {
    ...base,
    name: title,
    // Una reconexión volvería al pivote y perdería el salto; los comandos de inicio compiten con el envío.
    auto_reconnect: false,
    on_connect: undefined,
    scp: undefined,
    tunnels: undefined,
  };
}

/** Título de la pestaña de salto: "vecino vía pivote". */
export const hopTabTitle = (neighbor: string, pivot: string) => `${neighbor} vía ${pivot}`.slice(0, 80);

/** Solo SSH y Telnet se pueden repetir en otra pestaña (un puerto serial o un shell local no). */
export const isReplayable = (s: Pick<Session, "type">) => s.type === "ssh" || s.type === "telnet";

export type HopScreen =
  | { kind: "prompt"; name: string }
  | { kind: "hostkey"; line: string; answer: "yes" | "y" }
  | { kind: "password"; line: string }
  | { kind: "username"; line: string }
  | { kind: "none" };

const HOSTKEY =
  /are you sure you want to continue connecting|\(yes\/no(?:\/\[fingerprint\])?\)\s*\??\s*$|continue to access it\?\s*\[y\/n\]|save the server's public key\?\s*\[y\/n\]|accept (?:the )?(?:host )?key/i;
const PASSWORD = /(?:password|passphrase|contraseña)(?: for [^:\n]*)?\s*:\s*$/i;
const USERNAME = /(?:username|user name|login(?: as)?|usuario)\s*:\s*$/i;

/** Última línea con texto, sin espacios al final. */
export function lastLine(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trimEnd();
    if (l.trim()) return l.slice(-200);
  }
  return "";
}

/** Qué hay al final de la pantalla: un prompt de equipo, una pregunta que contesta el usuario o nada reconocible. */
export function classifyHopScreen(text: string): HopScreen {
  const line = lastLine(text);
  if (!line) return { kind: "none" };
  if (HOSTKEY.test(line)) return { kind: "hostkey", line: line.trim(), answer: /\[y\/n\]/i.test(line) ? "y" : "yes" };
  if (PASSWORD.test(line)) return { kind: "password", line: line.trim() };
  if (USERNAME.test(line)) return { kind: "username", line: line.trim() };
  const name = promptName(line);
  return name ? { kind: "prompt", name } : { kind: "none" };
}

/** El texto que sigue al eco del último `cmd` (lo que respondió el equipo); sin eco, todo el texto. */
export function afterEcho(text: string, cmd: string): string {
  const at = cmd ? text.lastIndexOf(cmd) : -1;
  if (at < 0) return text;
  const nl = text.indexOf("\n", at);
  return nl < 0 ? "" : text.slice(nl + 1);
}

const ERRORS: [RegExp, string][] = [
  [/connection refused/i, "conexión rechazada (¿SSH o Telnet apagado, puerto distinto o ACL?)"],
  [/connection timed out|timed out|no response from|not responding/i, "tiempo de espera agotado (sin respuesta del equipo)"],
  [/no route to host|network is unreachable|host is unreachable|destination (?:host )?unreachable/i, "sin ruta hacia el equipo"],
  [/unknown host|could not resolve|name or service not known|unrecognized host/i, "equipo desconocido"],
  [/host key verification failed|remote host identification has changed/i, "la llave del equipo no coincide"],
  [/authentication (?:failed|failure)|permission denied|access denied|login invalid|bad (?:passwords|secrets)|too many authentication/i, "autenticación rechazada"],
  [/unable to negotiate|no matching (?:key|host key|cipher|mac|kex)|ssh version mismatch|protocol (?:major )?version|failed to connect|unable to connect/i, "no se pudo negociar SSH con el equipo"],
  [/connection (?:closed by|reset by)|closed by foreign host/i, "el equipo cerró la conexión"],
  [/% ?invalid (?:input|command)|% ?unrecognized command|error: ?unrecognized command|% ?incomplete command/i, "el equipo no reconoce el comando de salto"],
];

/** Motivo de fallo reconocido en la respuesta del equipo (con la línea que lo dijo), o null. */
export function hopError(text: string): string | null {
  for (const [re, why] of ERRORS) {
    const m = text.match(re);
    if (m) {
      const line = text.split("\n").find((l) => re.test(l))?.replace(/\r/g, "").trim().slice(0, 120);
      return line ? `${why}: ${line}` : why;
    }
  }
  return null;
}

export type HopPhase = "await-prompt" | "sent" | "done" | "failed";

export interface HopJob {
  phase: HopPhase;
  /** Comando de salto (hopCommand) que se enviará o ya se envió. */
  cmd: string;
  /** Prompt esperado del pivote; sin él se acepta el primero que aparezca (la pestaña activa no estaba en un prompt). */
  pivot?: string;
  /** Nombre del equipo al que se salta. */
  neighbor: string;
  startedAt: number;
  sentAt?: number;
  /** Pie de la pantalla en la última lectura y desde cuándo no cambia. */
  tail: string;
  changedAt: number;
  /** Avisos ya dados (una vez cada uno): password, username, hostkey:<línea>, mismatch. */
  told: string[];
}

export type HopAction =
  | { kind: "send"; data: string }
  | { kind: "ask"; line: string; answer: "yes" | "y" }
  | { kind: "notify"; text: string }
  | { kind: "done"; at: string }
  | { kind: "fail"; reason: string };

export function newHopJob(p: { cmd: string; neighbor: string; pivot?: string; now: number }): HopJob {
  return { phase: "await-prompt", cmd: p.cmd, pivot: p.pivot, neighbor: p.neighbor, startedAt: p.now, tail: "", changedAt: p.now, told: [] };
}

const samePrompt = (a: string, b: string) => nodeId(a) === nodeId(b);

/**
 * Avanza el trabajo de salto con lo que muestra la pantalla de la pestaña. Devuelve el trabajo
 * nuevo y las acciones a ejecutar (enviar, preguntar al usuario, avisar, terminar).
 */
export function stepHop(job: HopJob, screen: string, now: number): { job: HopJob; actions: HopAction[] } {
  if (job.phase === "done" || job.phase === "failed") return { job, actions: [] };
  const tail = screen.replace(/\r/g, "").split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(-8).join("\n");
  let j: HopJob = tail === job.tail ? job : { ...job, tail, changedAt: now };
  const actions: HopAction[] = [];
  const tell = (key: string, text: string) => {
    if (j.told.includes(key)) return;
    j = { ...j, told: [...j.told, key] };
    actions.push({ kind: "notify", text });
  };
  const fail = (reason: string) => {
    j = { ...j, phase: "failed" };
    actions.push({ kind: "fail", reason });
  };

  if (j.phase === "await-prompt") {
    const s = classifyHopScreen(screen);
    if (s.kind === "prompt" && (!j.pivot || samePrompt(s.name, j.pivot))) {
      if (now - j.changedAt >= PROMPT_STABLE_MS) {
        j = { ...j, phase: "sent", pivot: j.pivot ?? s.name, sentAt: now, tail: "", changedAt: now };
        actions.push({ kind: "send", data: `${j.cmd}\r` });
      }
      return { job: j, actions };
    }
    if (s.kind === "prompt") {
      tell("mismatch", `El prompt de la pestaña es ${s.name} y se esperaba ${j.pivot}: no se envía el salto hasta que coincida.`);
    } else if (s.kind === "password" || s.kind === "username") {
      tell(s.kind, `Autentícate en el pivote ${j.pivot ?? ""} en esa pestaña: el salto a ${j.neighbor} se envía solo al aparecer su prompt.`.replace("  ", " "));
    } else if (s.kind === "hostkey") {
      tell(`hostkey:${s.line}`, `El pivote pide confirmar la llave del equipo (${s.line}). Revisa la huella y contesta en la pestaña.`);
    }
    if (now - j.startedAt > PROMPT_WAIT_MS) {
      fail(
        `No apareció el prompt de ${j.pivot ?? "el pivote"} en ${Math.round(PROMPT_WAIT_MS / 60_000)} min: no se envió el salto a ${j.neighbor}.` +
          (j.told.includes("mismatch") ? ` El prompt visible es de otro equipo.` : ""),
      );
    }
    return { job: j, actions };
  }

  // phase === "sent": lo que respondió el equipo después del eco del comando.
  const after = afterEcho(screen, j.cmd);
  const s = classifyHopScreen(after);
  const err = hopError(after);
  const quiet = now - j.changedAt;
  if (s.kind === "hostkey") {
    if (!j.told.includes(`hostkey:${s.line}`)) {
      j = { ...j, told: [...j.told, `hostkey:${s.line}`] };
      actions.push({ kind: "ask", line: s.line, answer: s.answer });
    }
    if (now - (j.sentAt ?? now) > USER_WAIT_MS) fail(`Sin respuesta a la pregunta de ${j.neighbor}.`);
    return { job: j, actions };
  }
  if (s.kind === "password" || s.kind === "username") {
    tell(s.kind, `Escribe ${s.kind === "password" ? "la contraseña" : "el usuario"} de ${j.neighbor} en la pestaña (no se reutiliza la del pivote).`);
    if (now - (j.sentAt ?? now) > USER_WAIT_MS) fail(`Sin respuesta al ${s.kind === "password" ? "pedido de contraseña" : "pedido de usuario"} de ${j.neighbor}.`);
    return { job: j, actions };
  }
  if (s.kind === "prompt") {
    if (!samePrompt(s.name, j.pivot ?? "")) {
      if (quiet >= PROMPT_STABLE_MS) {
        j = { ...j, phase: "done" };
        actions.push({ kind: "done", at: s.name });
      }
    } else if (err) fail(`No se pudo saltar a ${j.neighbor}: ${err}.`);
    else if (quiet >= ERROR_SETTLE_MS) fail(`El prompt volvió a ${s.name} sin entrar a ${j.neighbor}.`);
    return { job: j, actions };
  }
  if (err && quiet >= ERROR_SETTLE_MS) fail(`No se pudo saltar a ${j.neighbor}: ${err}.`);
  else if (quiet > HOP_IDLE_MS) fail(`${j.neighbor} no respondió en ${Math.round(HOP_IDLE_MS / 1000)} s (sin cambios en la pestaña).`);
  return { job: j, actions };
}
