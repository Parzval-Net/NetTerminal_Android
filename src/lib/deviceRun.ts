import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface JobEvent {
  job: string;
  kind: string;
  text: string;
  data?: { output: string };
}

/**
 * Ejecuta un comando en la sesión (responde --More-- y confirmaciones) y devuelve toda
 * su salida cuando vuelve el prompt. Los eventos que llegan antes de conocer el id del
 * trabajo se guardan y se procesan después, para no perder respuestas rápidas.
 */
export async function runOnDevice(conn: string, command: string, timeoutSecs = 60): Promise<string> {
  let job: string | null = null;
  const early: JobEvent[] = [];
  let output = "";
  let failure = "";
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => (resolveDone = r));

  const handle = (e: JobEvent) => {
    if (e.kind === "result" && e.data) output = e.data.output;
    if (e.kind === "error") failure = e.text;
    if (e.kind === "done") resolveDone();
  };

  const un = await listen<JobEvent>("tool-job", ({ payload }) => {
    if (job === null) early.push(payload);
    else if (payload.job === job) handle(payload);
  });
  try {
    job = await invoke<string>("device_run", { conn, command, timeoutSecs });
    early.filter((e) => e.job === job).forEach(handle);
    await done;
  } finally {
    un();
  }
  if (failure && !output) throw new Error(failure);
  return output;
}
