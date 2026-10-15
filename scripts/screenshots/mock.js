/**
 * Backend simulado para capturas de pantalla (solo `npm run dev` + /scripts/screenshots/demo.html).
 * Todos los datos son ficticios: IPs de documentación (RFC 5737) y nombres genéricos.
 */
const cbs = new Map();
let nextId = 1;
const listeners = new Map(); // evento -> [callbackId]
const enc = new TextEncoder();

function emit(event, payload) {
  for (const id of listeners.get(event) ?? []) cbs.get(id)?.({ event, id: 0, payload });
}

const now = Date.now();
const sessions = [
  ["core-sw01", "ssh", "Sitio Central/Core", "192.0.2.1", "admin", "cisco"],
  ["core-sw02", "ssh", "Sitio Central/Core", "192.0.2.2", "admin", "cisco"],
  ["dist-sw01", "ssh", "Sitio Central/Distribución", "192.0.2.11", "admin", "cisco"],
  ["ar-wan01", "ssh", "Sitio Central/WAN", "198.51.100.1", "netops", "huawei"],
  ["fw-perimetro", "ssh", "Sitio Central/Seguridad", "198.51.100.10", "admin", "fortinet"],
  ["mx-borde01", "ssh", "Sucursales/Norte", "203.0.113.1", "netops", "juniper"],
  ["sw-acceso-norte", "telnet", "Sucursales/Norte", "203.0.113.20", "", "cisco"],
  ["sw-acceso-sur", "ssh", "Sucursales/Sur", "203.0.113.40", "admin", "huawei"],
  ["Consola USB", "serial", "Laboratorio", "", "", ""],
  ["Shell local", "local", "", "", "", ""],
].map(([name, type, folder, host, username, highlight], i) => ({
  id: `s${i}`, name, type, folder, host, username, highlight: highlight || "default",
  port: type === "telnet" ? 23 : 22, serial_port: "/dev/tty.usbserial-0001", baud_rate: 9600,
  created_at: new Date(now - i * 86400000).toISOString(),
}));

const CISCO = `
\x1b[2mUltimo acceso: hace 2 horas desde 192.0.2.250\x1b[0m

core-sw01#show ip interface brief
Interface              IP-Address      OK? Method Status                Protocol
Vlan1                  unassigned      YES NVRAM  administratively down down
Vlan10                 192.0.2.1       YES NVRAM  up                    up
Vlan20                 192.0.2.65      YES NVRAM  up                    up
GigabitEthernet1/0/1   unassigned      YES unset  up                    up
GigabitEthernet1/0/2   unassigned      YES unset  up                    up
GigabitEthernet1/0/3   unassigned      YES unset  down                  down
GigabitEthernet1/0/4   unassigned      YES unset  administratively down down
TenGigabitEthernet1/1/1 unassigned     YES unset  up                    up
Port-channel1          unassigned      YES unset  up                    up
core-sw01#show running-config interface GigabitEthernet1/0/1
Building configuration...

Current configuration : 312 bytes
!
interface GigabitEthernet1/0/1
 description UPLINK a dist-sw01 Gi1/0/48
 switchport trunk allowed vlan 10,20,30
 switchport mode trunk
 channel-group 1 mode active
 spanning-tree guard root
 no shutdown
!
interface GigabitEthernet1/0/4
 description RESERVA
 shutdown
!
end

core-sw01#show logging | include LINK
*Oct 14 09:12:44.123: %LINK-3-UPDOWN: Interface GigabitEthernet1/0/3, changed state to down
*Oct 14 09:12:45.130: %LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet1/0/3, changed state to down
*Oct 14 09:20:02.441: %LINK-3-UPDOWN: Interface TenGigabitEthernet1/1/1, changed state to up
core-sw01#`;

const HUAWEI = `
Info: The max number of VTY users is 15, the number of current VTY users online is 1.
<ar-wan01>display interface brief
PHY: Physical
*down: administratively down
(l): loopback
(s): spoofing
InUti/OutUti: input utility/output utility
Interface                   PHY   Protocol  InUti OutUti   inErrors  outErrors
GigabitEthernet0/0/0        up    up        12%    8%          0          0
GigabitEthernet0/0/1        up    up         3%    2%          0          0
GigabitEthernet0/0/2        down  down        0%    0%          0          0
GigabitEthernet0/0/3        *down down        0%    0%          0          0
LoopBack0                   up    up(s)       0%    0%          0          0
NULL0                       up    up(s)       0%    0%          0          0
<ar-wan01>display ip routing-table protocol bgp
Route Flags: R - relay, D - download to fib
------------------------------------------------------------------------------
Public routing table : BGP
         Destinations : 2        Routes : 2

BGP routing table status : <Active>
         Destinations : 2        Routes : 2

Destination/Mask    Proto   Pre  Cost      Flags NextHop         Interface

     0.0.0.0/0      EBGP    255  0           D   198.51.100.254  GigabitEthernet0/0/0
   203.0.113.0/24   EBGP    255  0           D   198.51.100.254  GigabitEthernet0/0/0

<ar-wan01>`;

function terminalFor(s) {
  if (s.highlight === "huawei") return HUAWEI;
  if (s.type === "local") return "\x1b[32muser@laptop\x1b[0m:\x1b[34m~\x1b[0m$ ";
  return CISCO.replaceAll("core-sw01", s.name);
}

const notes = {
  "plantilla-vlan.txt": `! Alta de VLAN en acceso (variables con {{...}})
vlan {{vlan}}
 name {{nombre}}
!
interface {{interfaz}}
 description {{descripcion}}
 switchport mode access
 switchport access vlan {{vlan}}
 spanning-tree portfast
 no shutdown
!
end
write memory`,
  "checklist-cambio.txt": "1. Respaldo de configuración\n2. show ip int brief (antes)\n3. Aplicar cambio\n4. Validar\n",
};

const settings = {
  monitors: [
    { id: "m1", name: "Gateway sitio central", kind: "icmp", host: "192.0.2.1", intervalMs: 1000, timeoutMs: 1000, threshold: 3, sound: true, repeatSec: 0, active: true },
    { id: "m2", name: "Firewall HTTPS", kind: "tcp", host: "198.51.100.10", port: 443, intervalMs: 1000, timeoutMs: 1000, threshold: 3, sound: false, repeatSec: 0, active: true },
    { id: "m3", name: "Enlace sucursal norte", kind: "icmp", host: "203.0.113.1", intervalMs: 1000, timeoutMs: 1000, threshold: 3, sound: true, repeatSec: 0, active: true },
  ],
  speedHistory: [
    { ts: new Date(now - 3 * 86400000).toISOString(), download_mbps: 412.3, upload_mbps: 188.1, latency_ms: 9.4, jitter_ms: 1.2, server: { colo: "SCL" } },
    { ts: new Date(now - 86400000).toISOString(), download_mbps: 448.9, upload_mbps: 201.7, latency_ms: 8.7, jitter_ms: 0.9, server: { colo: "SCL" } },
  ],
  updateLastCheck: now,
};

// Cada carga parte limpia; luego se siembra la topología de ejemplo.
localStorage.clear();
settings.appTheme = new URLSearchParams(location.search).get("theme") ?? "dark";
localStorage.setItem("topology", JSON.stringify({
  nodes: [
    { id: "core-sw01", name: "core-sw01", ip: "192.0.2.1", platform: "C9500-24Y4C", explored: true, x: 420, y: 80 },
    { id: "core-sw02", name: "core-sw02", ip: "192.0.2.2", platform: "C9500-24Y4C", explored: true, x: 720, y: 80 },
    { id: "dist-sw01", name: "dist-sw01", ip: "192.0.2.11", platform: "C9300-48P", explored: true, x: 260, y: 250 },
    { id: "ar-wan01", name: "ar-wan01", ip: "198.51.100.1", platform: "AR6140", explored: false, x: 820, y: 250 },
    { id: "fw-perimetro", name: "fw-perimetro", ip: "198.51.100.10", platform: "FortiGate-200F", explored: false, x: 540, y: 250 },
    { id: "sw-acceso-01", name: "sw-acceso-01", ip: "192.0.2.21", platform: "C9200L-24P", explored: false, x: 130, y: 420 },
    { id: "sw-acceso-02", name: "sw-acceso-02", ip: "192.0.2.22", platform: "C9200L-24P", explored: false, x: 390, y: 420 },
  ],
  links: [
    { a: "core-sw01", aPort: "Te1/1/1", b: "core-sw02", bPort: "Te1/1/1", proto: "CDP" },
    { a: "core-sw01", aPort: "Gi1/0/1", b: "dist-sw01", bPort: "Gi1/0/48", proto: "CDP" },
    { a: "core-sw01", aPort: "Gi1/0/10", b: "fw-perimetro", bPort: "port1", proto: "LLDP" },
    { a: "core-sw02", aPort: "Gi1/0/11", b: "ar-wan01", bPort: "GE0/0/1", proto: "LLDP" },
    { a: "dist-sw01", aPort: "Gi1/0/1", b: "sw-acceso-01", bPort: "Gi1/0/24", proto: "CDP" },
    { a: "dist-sw01", aPort: "Gi1/0/2", b: "sw-acceso-02", bPort: "Gi1/0/24", proto: "CDP" },
  ],
}));

const monitorTimers = new Map();
function rtt(id, i) {
  const base = { m1: 2, m2: 6, m3: 28 }[id] ?? 10;
  return base + Math.abs(Math.sin(i / 7)) * base * 0.4 + Math.random() * base * 0.3;
}
function startMonitor(cfg) {
  // Solo la escena de monitoreo genera muestras (evita avisos de caída en otras capturas).
  if (monitorTimers.has(cfg.id) || !location.search.includes("scene=monitor")) return;
  // Historia previa de 5 minutos para que el gráfico se vea poblado.
  setTimeout(() => {
    for (let i = 300; i > 0; i--) {
      const down = cfg.id === "m3" && i > 120 && i < 135;
      emit("monitor-sample", { id: cfg.id, ts: Date.now() - i * 1000, ok: !down, rtt: down ? null : rtt(cfg.id, i), error: down ? "Tiempo de espera agotado" : null });
    }
  }, 300);
  let i = 0;
  monitorTimers.set(cfg.id, setInterval(() => emit("monitor-sample", { id: cfg.id, ts: Date.now(), ok: true, rtt: rtt(cfg.id, i++), error: null }), 1000));
}

const handlers = {
  "plugin:event|listen": ({ event, handler }) => {
    listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    return handler;
  },
  "plugin:event|unlisten": () => null,
  list_sessions: () => sessions,
  get_settings: () => settings,
  save_settings: () => null,
  app_version: () => "0.4.0",
  check_update: () => Promise.reject("demo"),
  cmdpacks_list: () => [],
  list_notes: () => Object.keys(notes).map((name) => ({ name, modified: now })),
  read_note: ({ name }) => notes[name] ?? "",
  list_scripts: () => [],
  plugins_list: () => [],
  tftp_files: () => [["c9300-universalk9.17.12.04.SPA.bin", 1_163_845_632], ["AR6100-V300R022C10SPC100.cc", 168_820_736], ["FGT_200F-v7.4.5.out", 92_340_224]],
  local_ips: () => [{ name: "en0", ip: "192.0.2.250" }],
  server_running: () => [],
  monitor_start: ({ cfg }) => startMonitor(cfg),
  monitor_stop: ({ id }) => (clearInterval(monitorTimers.get(id)), monitorTimers.delete(id), null),
  list_serial_ports: () => [{ port_name: "/dev/tty.usbserial-0001", port_type: "USB" }],
  tool_iperf_version: () => "iperf 3.17",
  data_dir: () => "~/NetTerminal/data",
  connect: ({ session, onData }) => {
    const text = terminalFor(session).replace(/\r?\n/g, "\r\n");
    let index = 0;
    setTimeout(() => cbs.get(onData.id)?.({ index: index++, message: enc.encode(text).buffer }), 150);
    return null;
  },
};

window.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
  transformCallback(fn) {
    const id = nextId++;
    cbs.set(id, fn);
    return id;
  },
  unregisterCallback: (id) => cbs.delete(id),
  convertFileSrc: (p) => p,
  async invoke(cmd, args = {}) {
    const h = handlers[cmd];
    return h ? h(args) : null;
  },
};
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };

// ---- Escenas para las capturas: demo.html?scene=<nombre> ----
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function find(label) {
  const all = [...document.querySelectorAll("button, [role=button], [title], div, span, a, li")];
  return (
    all.find((e) => e.title === label || e.title?.startsWith(label + " (")) ||
    all.find((e) => e.textContent?.trim() === label && e.children.length <= 2)
  );
}
async function act(type, label) {
  for (let i = 0; i < 40; i++) {
    const e = find(label);
    if (e) {
      const opts = { bubbles: true, cancelable: true, view: window, detail: type === "dblclick" ? 2 : 1 };
      e.dispatchEvent(new MouseEvent("mousedown", opts));
      e.dispatchEvent(new MouseEvent("mouseup", opts));
      e.dispatchEvent(new MouseEvent("click", opts));
      if (type === "dblclick") e.dispatchEvent(new MouseEvent("dblclick", opts));
      await wait(250);
      return;
    }
    await wait(100);
  }
  console.warn("escena: no encontrado", label);
}
const click = (l) => act("click", l);
const open = (l) => act("dblclick", l);

const scenes = {
  terminal: async () => { await open("ar-wan01"); await open("core-sw01"); await click("Catálogo de comandos"); },
  notes: async () => { await open("core-sw01"); await open("ar-wan01"); await click("Notas"); await click("plantilla-vlan.txt"); },
  monitor: async () => { await open("core-sw01"); await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); },
  topology: async () => { await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); await click("Topología"); },
  subnet: async () => { await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); await click("Subredes"); },
  speed: async () => { await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); await click("Velocidad"); },
  settings: async () => { await open("core-sw01"); await click("Ajustes"); },
  packs: async () => { await open("core-sw01"); await click("Catálogo de comandos"); await click("Packs de comandos"); },
};
const scene = new URLSearchParams(location.search).get("scene");
if (scene && scenes[scene]) window.addEventListener("load", () => wait(600).then(scenes[scene]));
