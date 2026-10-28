/**
 * CLI Lab: script multilínea que se ejecuta línea a línea en una o varias sesiones, leyendo la
 * respuesta de cada comando antes de seguir (idea tomada del CLI Code Lab de FortiOS 8.0).
 * Estado global mínimo, como la difusión: el resultado sigue disponible al cerrar la ventana.
 */
import { useSyncExternalStore } from "react";
import type { DeviceResult } from "./deviceRun";

export interface LabTarget {
  tabId: string;
  name: string;
  host?: string;
}

export type LabStatus = "pending" | "running" | "ok" | "error" | "stopped" | "skipped";

export interface LabStep {
  cmd: string;
  ok: boolean;
  output: string;
  /** Motivo del error: línea del equipo, pregunta rechazada o fallo de la sesión. */
  note?: string;
}

export interface LabItem extends LabTarget {
  status: LabStatus;
  steps: LabStep[];
  reason?: string;
}

export interface LabRun {
  items: LabItem[];
  lines: number;
  running: boolean;
  startedAt: number;
}

export interface LabOptions {
  stopOnError: boolean;
  /** Equipos a la vez (cada uno ejecuta sus líneas en orden). */
  parallel: number;
  /** Responder solas las preguntas del equipo (y/n, [confirm]). */
  answer: boolean;
  /** Conexión de la pestaña; undefined si ya no está conectada. */
  conn: (tabId: string) => string | undefined;
  exec: (conn: string, cmd: string, answer: boolean) => Promise<DeviceResult>;
}

/** Comandos de guardado por fabricante (catálogo integrado). FortiOS guarda solo al cerrar con "end". */
export const SAVE_COMMAND: Record<string, string | null> = {
  cisco: "write memory",
  huawei: "save",
  juniper: "commit",
  fortinet: null,
};

/** Las preguntas de los comandos de guardado ("Continue? [Y/N]") se responden aunque la opción esté apagada. */
const SAVE_LINE = /^(write( memory)?|wr( mem)?|copy (running-config|run) (startup-config|start)|save|commit( and-quit)?)$/i;

/** Líneas a ejecutar: sin vacías ni comentarios ("!" de Cisco, "#" de FortiOS/Junos, "//"). */
export function scriptLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() && !/^\s*(!|#|\/\/)/.test(l));
}

/** Mensajes de error de CLI conocidos (Cisco/Arista, Huawei/H3C, FortiOS, Junos). */
const CLI_ERROR =
  /^\s*(%\s*(invalid|incomplete|ambiguous|unknown|unrecognized|bad|error)[^\n]*|error:[^\n]*|command fail[^\n]*|command parse error[^\n]*|unknown action[^\n]*|syntax error[^\n]*|invalid input[^\n]*|\^?\s*unrecognized command[^\n]*|% ?wrong parameter[^\n]*)$/im;

/** Primera línea de error de la respuesta (sin el eco del comando), o null. */
export function cliError(output: string, cmd: string): string | null {
  const lines = output.replace(/\r/g, "").split("\n");
  const echo = lines.findIndex((l) => l.includes(cmd.trim()));
  const body = lines.slice(echo >= 0 ? echo + 1 : 0).join("\n");
  const m = body.match(CLI_ERROR);
  return m ? m[0].trim().slice(0, 200) : null;
}

function store<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (v: T) => {
      value = v;
      subs.forEach((f) => f());
    },
    subscribe: (f: () => void) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
  };
}

const runStore = store<LabRun | null>(null);
/** Ventana abierta (con el texto inicial, ej. desde Notas) o null. */
const openStore = store<{ text?: string; n: number } | null>(null);
export const useLabOpen = () => useSyncExternalStore(openStore.subscribe, openStore.get);
// `n` cambia en cada apertura: abrir desde Notas con la ventana ya abierta carga el texto nuevo.
export const openLab = (text?: string) => openStore.set({ text, n: (openStore.get()?.n ?? 0) + 1 });
export const closeLab = () => openStore.set(null);
let stopFlag = false;

export const useLabRun = () => useSyncExternalStore(runStore.subscribe, runStore.get);
export const isLabRunning = () => !!runStore.get()?.running;
export const stopLab = () => {
  stopFlag = true;
};
export const clearLab = () => {
  if (!runStore.get()?.running) runStore.set(null);
};

/**
 * Ejecuta `lines` en cada destino, en orden, con hasta `parallel` equipos a la vez. Con
 * `stopOnError`, el primer error detiene ese equipo (los demás siguen). "Detener" deja
 * sin ejecutar las líneas que faltan en todos.
 */
export async function runLab(targets: LabTarget[], lines: string[], opts: LabOptions): Promise<LabRun> {
  if (isLabRunning()) throw new Error("Ya hay un script en ejecución");
  stopFlag = false;
  const items: LabItem[] = targets.map((t) => ({ ...t, status: "pending", steps: [] }));
  const startedAt = Date.now();
  let queued = false;
  const publish = (running: boolean) => runStore.set({ items: items.map((x) => ({ ...x, steps: [...x.steps] })), lines: lines.length, running, startedAt });
  // Varios equipos terminan líneas a la vez: se publica una vez por cuadro.
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (runStore.get()?.running) publish(true);
    });
  };
  publish(true);

  const one = async (item: LabItem) => {
    item.status = "running";
    schedule();
    for (const cmd of lines) {
      if (stopFlag) {
        item.status = "stopped";
        return;
      }
      const conn = opts.conn(item.tabId);
      if (!conn) {
        item.status = "skipped";
        item.reason = "Se desconectó";
        return;
      }
      let step: LabStep;
      try {
        const r = await opts.exec(conn, cmd, opts.answer || SAVE_LINE.test(cmd.trim()));
        const err = r.declined ? `Pidió confirmación y se respondió que no: ${r.declined}` : cliError(r.output, cmd);
        step = { cmd, ok: !err, output: r.output, note: err ?? undefined };
      } catch (e) {
        step = { cmd, ok: false, output: "", note: String(e instanceof Error ? e.message : e) };
      }
      item.steps.push(step);
      schedule();
      if (!step.ok && opts.stopOnError) {
        item.status = "error";
        item.reason = `Línea ${item.steps.length}: ${step.note}`;
        return;
      }
    }
    item.status = item.steps.some((s) => !s.ok) ? "error" : "ok";
  };

  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      if (stopFlag) item.status = "stopped";
      else await one(item);
      schedule();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.parallel, items.length)) }, worker));
  publish(false);
  return runStore.get()!;
}

/** Texto plano de la ejecución, por equipo, para copiar o guardar. */
export function labReport(run: LabRun): string {
  return run.items
    .map((i) => {
      const head = `===== ${i.name}${i.host ? ` (${i.host})` : ""}: ${i.status.toUpperCase()}${i.reason ? ` · ${i.reason}` : ""}`;
      return [head, ...i.steps.map((s) => s.output.replace(/\r/g, "").trimEnd() || `${s.cmd}${s.note ? `\n${s.note}` : ""}`)].join("\n");
    })
    .join("\n\n");
}
