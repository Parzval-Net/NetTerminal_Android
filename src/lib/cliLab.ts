/**
 * CLI Lab: script multilínea que se ejecuta línea a línea en una o varias sesiones, leyendo la
 * respuesta de cada comando antes de seguir (idea tomada del CLI Code Lab de FortiOS 8.0).
 * Estado global mínimo, como la difusión: el resultado sigue disponible al cerrar la ventana.
 */
import { useSyncExternalStore } from "react";
import type { DeviceResult } from "./deviceRun";
import { commandError } from "./cliText";
import { pool } from "./backup";
import { store } from "./store";

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
  /** Texto que se muestra por línea (variables secretas enmascaradas); por defecto, la línea. */
  labels?: string[];
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

/** Error de CLI en la respuesta a `cmd` (sin mirar su eco), o null. */
export const cliError = commandError;

const runStore = store<LabRun | null>(null);
/** Ventana abierta o null (`n` cambia en cada apertura). */
const openStore = store<{ n: number } | null>(null);
export const useLabOpen = () => useSyncExternalStore(openStore.subscribe, openStore.get);
export const openLab = () => openStore.set({ n: (openStore.get()?.n ?? 0) + 1 });
export const closeLab = () => openStore.set(null);
let stopFlag = false;

export const useLabRun = () => useSyncExternalStore(runStore.subscribe, runStore.get);
export const isLabRunning = () => !!runStore.get()?.running;
/** El CLI Lab está ejecutando (o tiene en cola) esta pestaña: otro envío se mezclaría con sus líneas. */
export const labOwns = (tabId: string) =>
  !!runStore.get()?.running && !!runStore.get()?.items.some((i) => i.tabId === tabId && (i.status === "running" || i.status === "pending"));
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
    for (const [n, cmd] of lines.entries()) {
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
        step = { cmd: opts.labels?.[n] ?? cmd, ok: !err, output: r.output, note: err ?? undefined };
      } catch (e) {
        step = { cmd: opts.labels?.[n] ?? cmd, ok: false, output: "", note: String(e instanceof Error ? e.message : e) };
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

  await pool(
    items,
    Math.max(1, opts.parallel),
    async (item) => {
      await one(item);
      schedule();
    },
    () => stopFlag,
  );
  for (const item of items) if (item.status === "pending") item.status = "stopped";
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
