import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, X } from "lucide-react";
import { SerialPortInfo, Session, SessionType } from "../types";
import { SessionIcon, typeLabel } from "./SessionIcon";
import { vendorSchemes } from "../lib/highlight";
import { normPath } from "../lib/folders";
import { useDragResize } from "../lib/useDragResize";

interface Props {
  initial?: Session;
  defaultFolder?: string;
  folders: string[];
  onClose: () => void;
  onSave: (s: Session, connect: boolean) => void;
}

const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
const DEFAULT_PORT: Partial<Record<SessionType, number>> = { ssh: 22, telnet: 23 };

export function SessionModal({ initial, defaultFolder, folders, onClose, onSave }: Props) {
  const [s, setS] = useState<Session>(
    initial ?? {
      id: "",
      name: "",
      type: "ssh",
      port: 22,
      baud_rate: 9600,
      data_bits: 8,
      stop_bits: 1,
      parity: "none",
      flow_control: "none",
      folder: defaultFolder,
      created_at: "",
    },
  );
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const set = <K extends keyof Session>(k: K, v: Session[K]) => setS((p) => ({ ...p, [k]: v }));

  const loadPorts = () =>
    invoke<SerialPortInfo[]>("list_serial_ports")
      .then((list) => {
        setPorts(list);
        setS((p) => (p.serial_port || !list[0] ? p : { ...p, serial_port: list[0].port_name }));
      })
      .catch(() => {});

  useEffect(() => {
    if (s.type === "serial") loadPorts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.type]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const changeType = (type: SessionType) =>
    setS((p) => ({
      ...p,
      type,
      port: p.port === DEFAULT_PORT[p.type] || !p.port ? DEFAULT_PORT[type] : p.port,
    }));

  const submit = (connect: boolean) => {
    const name =
      s.name.trim() ||
      (s.type === "serial" ? s.serial_port : s.type === "local" ? "Terminal local" : s.host) ||
      typeLabel[s.type];
    onSave({ ...s, name, folder: normPath(s.folder) || undefined }, connect);
  };

  const remote = s.type === "ssh" || s.type === "telnet";
  const win = useDragResize<HTMLFormElement>("sessionWindow");

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4" onMouseDown={onClose}>
      <form
        {...win.box}
        className="w-[460px] bg-panel border border-line rounded-xl shadow-pop resize overflow-hidden flex flex-col min-w-[360px] min-h-[260px] max-w-[96vw] max-h-[94vh]"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit(true);
        }}
      >
        <header {...win.handle} className="shrink-0 flex items-center justify-between px-5 h-12 border-b border-line select-none">
          <h2 className="text-[14px] font-semibold">{initial ? "Editar sesión" : "Nueva sesión"}</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-hover">
            {(["ssh", "telnet", "serial", "local"] as SessionType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => changeType(t)}
                className={`flex items-center justify-center gap-1.5 h-8 rounded-md text-[12.5px] font-medium ${
                  s.type === t ? "bg-panel shadow-sm text-fg" : "text-muted hover:text-fg"
                }`}
              >
                <SessionIcon type={t} size={14} />
                {typeLabel[t]}
              </button>
            ))}
          </div>

          <Row>
            <Field label="Nombre">
              <input
                className="field"
                value={s.name}
                placeholder={s.type === "serial" ? "Consola switch" : "Router core"}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field label="Carpeta">
              <input
                className="field"
                list="folders"
                value={s.folder ?? ""}
                placeholder="Raíz · usa / para subcarpetas"
                onChange={(e) => set("folder", e.target.value)}
              />
              <datalist id="folders">
                {folders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </Field>
          </Row>

          {remote && (
            <Row cols="3fr 1fr">
              <Field label="Host">
                <input
                  className="field"
                  required
                  autoFocus
                  value={s.host ?? ""}
                  placeholder="10.0.0.1 o hostname"
                  onChange={(e) => set("host", e.target.value)}
                />
              </Field>
              <Field label="Puerto">
                <input
                  className="field"
                  type="number"
                  min={1}
                  max={65535}
                  value={s.port ?? ""}
                  onChange={(e) => set("port", Number(e.target.value) || undefined)}
                />
              </Field>
            </Row>
          )}

          {s.type === "ssh" && (
            <>
              <Row>
                <Field label="Usuario">
                  <input
                    className="field"
                    value={s.username ?? ""}
                    placeholder="Según ~/.ssh/config"
                    onChange={(e) => set("username", e.target.value)}
                  />
                </Field>
                <Field label="Llave privada (opcional)">
                  <input
                    className="field"
                    value={s.identity_file ?? ""}
                    placeholder="~/.ssh/id_ed25519"
                    onChange={(e) => set("identity_file", e.target.value)}
                  />
                </Field>
              </Row>
              <Field label="Jump host / bastión (opcional)">
                <input
                  className="field"
                  value={s.jump_host ?? ""}
                  placeholder="usuario@bastion:22"
                  onChange={(e) => set("jump_host", e.target.value)}
                />
              </Field>
              <Field label="Argumentos extra de ssh (avanzado)">
                <input
                  className="field font-mono !text-[12px]"
                  value={s.ssh_args ?? ""}
                  placeholder="-L 8443:10.0.0.1:443 -A -o StrictHostKeyChecking=accept-new"
                  onChange={(e) => set("ssh_args", e.target.value)}
                />
              </Field>
              <label className="flex items-start gap-2.5 text-[12.5px]">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--accent)]"
                  checked={!!s.legacy_ssh}
                  onChange={(e) => set("legacy_ssh", e.target.checked)}
                />
                <span>
                  Permitir algoritmos legacy
                  <span className="block text-muted">
                    Equipos antiguos: DH group1/14/GEX-sha1, ssh-rsa, cifrados CBC/3DES y MAC hmac-sha1/md5.
                    Solo se activan los que soporte el OpenSSH instalado.
                  </span>
                </span>
              </label>
              <p className="text-[11.5px] text-muted">
                La contraseña se pide en la terminal y no se guarda. Usa OpenSSH del sistema, por lo que
                respeta tu ~/.ssh/config, agente y known_hosts.
              </p>
            </>
          )}

          {s.type === "serial" && (
            <>
              <Row cols="3fr 2fr">
                <Field label="Puerto">
                  <div className="flex gap-1.5">
                    <input
                      className="field"
                      list="serial-ports"
                      required
                      value={s.serial_port ?? ""}
                      placeholder={navigator.userAgent.includes("Windows") ? "COM3" : "/dev/ttyUSB0"}
                      onChange={(e) => set("serial_port", e.target.value)}
                    />
                    <datalist id="serial-ports">
                      {ports.map((p) => (
                        <option key={p.port_name} value={p.port_name}>
                          {p.port_type}
                        </option>
                      ))}
                    </datalist>
                    <button
                      type="button"
                      title="Detectar puertos"
                      onClick={loadPorts}
                      className="w-8 shrink-0 grid place-items-center rounded-md border border-line text-muted hover:text-fg hover:bg-hover"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                </Field>
                <Field label="Velocidad">
                  <select
                    className="field"
                    value={s.baud_rate ?? 9600}
                    onChange={(e) => set("baud_rate", Number(e.target.value))}
                  >
                    {BAUDS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </Field>
              </Row>
              <Row cols="1fr 1fr 1fr 1fr">
                <Field label="Datos">
                  <select
                    className="field"
                    value={s.data_bits ?? 8}
                    onChange={(e) => set("data_bits", Number(e.target.value))}
                  >
                    {[8, 7, 6, 5].map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Paridad">
                  <select
                    className="field"
                    value={s.parity ?? "none"}
                    onChange={(e) => set("parity", e.target.value as Session["parity"])}
                  >
                    <option value="none">None</option>
                    <option value="even">Even</option>
                    <option value="odd">Odd</option>
                  </select>
                </Field>
                <Field label="Stop">
                  <select
                    className="field"
                    value={s.stop_bits ?? 1}
                    onChange={(e) => set("stop_bits", Number(e.target.value))}
                  >
                    <option>1</option>
                    <option>2</option>
                  </select>
                </Field>
                <Field label="Flujo">
                  <select
                    className="field"
                    value={s.flow_control ?? "none"}
                    onChange={(e) => set("flow_control", e.target.value as Session["flow_control"])}
                  >
                    <option value="none">None</option>
                    <option value="software">XON/XOFF</option>
                    <option value="hardware">RTS/CTS</option>
                  </select>
                </Field>
              </Row>
              {ports.length === 0 && (
                <p className="text-[11.5px] text-muted">
                  No se detectaron adaptadores. Conecta el cable USB-serial y presiona actualizar.
                </p>
              )}
            </>
          )}
        </div>

        {s.type !== "local" && (
          <div className="px-5 pb-4 -mt-1">
            <label className="flex items-center justify-between gap-4">
              <span>
                Resaltado de sintaxis
                <span className="block text-[11.5px] text-muted">Colorea interfaces, IPs, estados y configuración</span>
              </span>
              <select
                className="field !w-48"
                value={s.highlight ?? "default"}
                onChange={(e) => set("highlight", e.target.value === "default" ? undefined : e.target.value)}
              >
                <option value="default">Según ajustes</option>
                {vendorSchemes.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
                <option value="off">Sin resaltado</option>
              </select>
            </label>
          </div>
        )}

        <footer className="flex justify-end gap-2 px-5 py-3 border-t border-line">
          <button
            type="button"
            onClick={() => submit(false)}
            className="px-3.5 h-8 rounded-md border border-line hover:bg-hover"
          >
            Guardar
          </button>
          <button type="submit" className="px-3.5 h-8 rounded-md bg-accent text-accent-fg font-medium hover:opacity-90">
            Guardar y conectar
          </button>
        </footer>
      </form>
    </div>
  );
}

function Row({ children, cols = "1fr 1fr" }: { children: React.ReactNode; cols?: string }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: cols }}>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="block mb-1 text-[11.5px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
