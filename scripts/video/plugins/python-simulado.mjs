// Ejecuta un script o plugin real con Python 3 y el netterminal.py de la app, respondiendo sus
// pedidos (mismo protocolo JSON por stdin/stdout que src-tauri/src/scripts.rs) con el equipo
// ficticio. Sin red ni equipos.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { respuesta } from "./equipo-ficticio.js";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * @param {string} path archivo .py
 * @param {{ action?: string, session?: boolean, host?: string, responder?: Function,
 *   dataDir?: string, sessionInfo?: object }} opts
 *   session=false simula un plugin sin el permiso "session" (la app rechaza leer o escribir en
 *   la sesión). `responder(cmd, host)` reemplaza al equipo ficticio y devuelve:
 *   - un arreglo de líneas: salida completa seguida del prompt;
 *   - `{ lento: true, parcial, resto }`: la primera espera vence (como expect::wait_for, con lo
 *     recibido) y `read()` entrega el resto y el prompt;
 *   - `{ mudo: true }`: el equipo no responde (wait_for vence, read() no trae nada);
 *   - null: comando desconocido (la prueba falla).
 * @returns {Promise<{ commands: string[], logs: string[] }>}
 */
export function ejecutar(path, { action, session = true, host = "core-sw01", responder = respuesta, dataDir, sessionInfo } = {}) {
  return new Promise((resolve, reject) => {
    const py = spawn("python3", ["-u", "-B", path], {
      cwd: ROOT,
      env: {
        ...process.env,
        PYTHONPATH: `${ROOT}src-tauri/src`,
        PYTHONIOENCODING: "utf-8",
        PYTHONDONTWRITEBYTECODE: "1",
        NT_DATA_DIR: dataDir ?? "/tmp/nt-ejemplos-no-se-usa",
        NT_SESSION: JSON.stringify(sessionInfo ?? { name: host, type: "ssh", host: "192.0.2.1", port: 22, username: "operador" }),
        ...(action ? { NT_ACTION: action } : {}),
      },
    });
    const commands = [];
    const logs = [];
    let pending = "";
    /** Lo que llega después de vencer la espera (equipo lento); null si no hay nada más. */
    let resto = null;
    let err = "";
    let fail = null;
    py.stderr.on("data", (d) => (err += d));
    createInterface({ input: py.stdout }).on("line", (line) => {
      const req = JSON.parse(line);
      let reply = { ok: true };
      if (["send", "wait", "read", "clear"].includes(req.op) && !session) reply = { ok: false, error: "Este plugin no declaró el permiso 'session'" };
      else if (req.op === "log") logs.push(req.msg);
      else if (req.op === "send") {
        const cmd = req.data.replace(/\r$/, "");
        commands.push(cmd);
        const out = responder(cmd, host);
        resto = null;
        if (!out) {
          fail = `El equipo ficticio no conoce: ${cmd}`;
          pending = `${cmd}\r\n${host}#`;
        } else if (out.mudo) {
          pending = `${cmd}\r\n`;
          resto = "";
        } else if (out.lento) {
          pending = `${cmd}\r\n${out.parcial.join("\r\n")}`;
          resto = `\r\n${out.resto.join("\r\n")}\r\n${host}#`;
        } else pending = `${cmd}\r\n${out.join("\r\n")}\r\n${host}#`;
      } else if (req.op === "wait") {
        if (new RegExp(req.pattern).test(pending)) reply = { ok: true, output: pending };
        else if (resto !== null) reply = { ok: false, error: "timeout", output: pending };
        else {
          fail = `El patrón ${req.pattern} no coincide`;
          reply = { ok: true, output: pending };
        }
        pending = "";
      } else if (req.op === "read") {
        reply = { ok: true, output: pending + (resto ?? "") };
        pending = "";
        resto = null;
      } else if (req.op === "clear") {
        pending = "";
        resto = null;
      }
      py.stdin.write(JSON.stringify(reply) + "\n");
    });
    py.on("close", (code) => {
      if (fail) reject(new Error(fail));
      else if (code === 0) resolve({ commands, logs });
      else reject(new Error(`${path} terminó con ${code}: ${err}`));
    });
  });
}
