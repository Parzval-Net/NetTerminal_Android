/**
 * Backend simulado para capturas de pantalla (solo `npm run dev` + /scripts/screenshots/demo.html).
 * Todos los datos son ficticios: IPs de documentación (RFC 5737) y nombres genéricos.
 */
const cbs = new Map();
let nextId = 1;
const listeners = new Map(); // evento -> [callbackId]
const channels = new Map(); // conexión -> canales de datos
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
  ["router-antiguo", "ssh", "Laboratorio", "192.0.2.99", "admin", "cisco"],
  ["Shell local", "local", "", "", "", ""],
].map(([name, type, folder, host, username, highlight], i) => ({
  id: `s${i}`, name, type, folder, host, username, highlight: highlight || "default",
  port: type === "telnet" ? 23 : 22, serial_port: "/dev/tty.usbserial-0001", baud_rate: 9600,
  created_at: new Date(now - i * 86400000).toISOString(),
  // Demo: una sesión con contraseña guardada (indicador de llave en la barra de estado).
  ...(name === "sw-acceso-norte" ? { save_password: true } : {}),
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
// Notas protegidas simuladas: el contenido solo se entrega con la contraseña correcta
// (contraseña de demo, nunca vuelve al frontend). La llave "abierta" es solo el nombre.
const secureNotes = {
  "accesos-sitio-central": {
    password: "demo-clave-2026",
    content: `! Accesos de emergencia (datos ficticios)
! Consola fuera de banda
ssh admin@192.0.2.250
enable secret {{enable}}
!
snmp-server community {{comunidad}} RO 10
tacacs-server host 192.0.2.50 key {{tacacs}}`,
  },
};
let unlockedNote = null;
const NOTE_LOCKED = "La nota está bloqueada. Ingresa su contraseña para abrirla";

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

// Cada carga parte limpia.
localStorage.clear();
settings.appTheme = new URLSearchParams(location.search).get("theme") ?? "dark";
if (location.search.includes("big=")) settings.confirmClose = false;
if (location.search.includes("autolegacy=1")) settings.autoLegacySsh = true;
if (location.search.includes("scene=vertical") || location.search.includes("layout=vertical")) settings.tabLayout = "vertical";
// ?toast=1: una alerta por palabra clave activa que dispara un aviso (toast) y marca la primera pestaña.
if (location.search.includes("toast=1")) {
  settings.alertRules = [{ id: "qa-updown", name: "Interfaz cambió de estado", pattern: "%LINK-3-UPDOWN", regex: false, caseSensitive: true, enabled: true, folder: "", toast: true, sound: false, markTab: true, highlight: false }];
  const fire = setInterval(() => {
    if (channels.size < 2) return;
    clearInterval(fire);
    emit("alert-hit", { conn: [...channels.keys()][0], rule: "qa-updown", line: "%LINK-3-UPDOWN: Interface GigabitEthernet1/0/3, changed state to down" });
  }, 300);
}
// ?term=<id>: tema de terminal preseleccionado (capturas de temas).
settings.terminalTheme = new URLSearchParams(location.search).get("term") ?? "auto";
// ?logsdir=1: carpeta de logs elegida por el usuario (modo portable, con su aviso).
let logsDir = location.search.includes("logsdir=1") ? "/Volumes/USB/Logs-NOC" : "";
if (logsDir) settings.logsDir = logsDir;
const logsDirInfo = () => ({ path: logsDir || "~/NetTerminal/data/logs", default: "~/NetTerminal/data/logs", custom: !!logsDir, portable: !!logsDir });
if (location.search.includes("collapsed=1")) localStorage.setItem("vtabsCollapsed", "true");
const topology = {
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
};
// Segundo enlace del Port-channel y estado de puertos de ejemplo.
topology.links.push({ a: "core-sw01", aPort: "Gi1/0/2", b: "dist-sw01", bPort: "Gi1/0/47", proto: "CDP" });
topology.nodes[0].ports = {
  "gi1/0/1": { status: "connected", speed: "a-1000", desc: "UPLINK dist-sw01", group: "Po1" },
  "gi1/0/2": { status: "connected", speed: "a-1000", desc: "UPLINK dist-sw01", group: "Po1" },
  "te1/1/1": { status: "connected", speed: "10G", desc: "ISL core-sw02" },
};
settings.topology = topology;
// Snapshot anterior: tenía un acceso más que hoy ya no aparece.
settings.topoSnapshots = [{
  id: "s1", name: "Antes de la ventana de cambio", ts: now - 7 * 86400000,
  topo: {
    nodes: [...topology.nodes.filter((n) => n.id !== "ar-wan01"), { id: "sw-acceso-03", name: "sw-acceso-03", ip: "192.0.2.23", explored: false, x: 520, y: 420 }],
    links: [...topology.links.filter((l) => l.b !== "ar-wan01"), { a: "dist-sw01", aPort: "Gi1/0/3", b: "sw-acceso-03", bPort: "Gi1/0/24", proto: "CDP" }],
  },
}];


// Respaldos de configuración (Herramientas › Respaldos): dos versiones previas de core-sw01.
const connSessions = new Map(); // conexión -> sesión
const backupRuns = new Map(); // equipo -> respaldos hechos en esta carga
function fakeConfig(name, vendor, rev) {
  if (vendor === "huawei")
    return `#\n sysname ${name}\n#\nvlan batch 10 20${rev ? " 30" : ""}\n#\naaa\n local-user admin password irreversible-cipher $1a$demo$\n#\ninterface GigabitEthernet0/0/0\n ip address 198.51.100.1 255.255.255.0\n#\nsnmp-agent community read cipher %^%#demo%^%#\n#\nreturn`;
  const lines = [
    "!", `hostname ${name}`, "!", "enable secret 9 $9$demo$demo", "username admin privilege 15 secret 9 $9$demo", "!",
    "vlan 10", " name USUARIOS", "vlan 20", " name VOZ", ...(rev ? ["vlan 30", " name CAMARAS"] : []), "!",
  ];
  for (let i = 1; i <= 24; i++)
    lines.push(`interface GigabitEthernet1/0/${i}`, ` description ${i === 1 ? "UPLINK dist-sw01" : rev && i === 7 ? "CAMARA PISO 2" : "USUARIO"}`, ` switchport access vlan ${rev && i === 7 ? 30 : 10}`, " switchport mode access", i === 4 ? " shutdown" : " no shutdown", "!");
  lines.push("snmp-server community DEMO RO 10", "tacacs-server host 192.0.2.50 key 7 0822455D0A16", "!", "line vty 0 15", " transport input ssh", "!", "end");
  return lines.join("\n");
}
const backups = {
  "core-sw01": {
    "2026-10-14_093000.txt": fakeConfig("core-sw01", "cisco", 0).replace("enable secret 9 $9$demo$demo", "enable secret 9 ****").replace("DEMO", "****").replace("0822455D0A16", "****"),
    "2026-10-20_181500.txt": fakeConfig("core-sw01", "cisco", 1).replace("enable secret 9 $9$demo$demo", "enable secret 9 ****").replace("DEMO", "****").replace("0822455D0A16", "****"),
  },
};
const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

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

// SNMP simulado (Herramientas › SNMP): un switch con ifXTable y traps de ejemplo.
settings.snmpProfiles = [
  { id: "pcore", name: "core-sw01", host: "192.0.2.1", port: 161, version: "3", user: "monitoreo", level: "authPriv", authProto: "sha256", privProto: "aes", context: "", timeoutMs: 2000, retries: 1, saved: true },
];
const running = new Set();
const IFNAMES = ["Gi1/0/1", "Gi1/0/2", "Gi1/0/3", "Gi1/0/4", "Te1/1/1", "Te1/1/2", "Vlan10", "Vlan20"];
const IFDESC = ["UPLINK dist-sw01", "UPLINK dist-sw01", "Camara piso 2", "", "ISL core-sw02", "ISL core-sw02", "USUARIOS", "VOZ"];
const counterBase = IFNAMES.map((_, i) => 9_000_000_000 + i * 1_234_567_890);
const snmpStart = Date.now();
function snmpColumn(oid) {
  const col = (vals, type = "OCTET STRING") => vals.map((v, i) => ({ oid: `${oid}.${i + 1}`, type, value: String(v) }));
  const t = (Date.now() - snmpStart) / 1000;
  const map = {
    "1.3.6.1.2.1.31.1.1.1.1": () => col(IFNAMES),
    "1.3.6.1.2.1.31.1.1.1.18": () => col(IFDESC),
    "1.3.6.1.2.1.2.2.1.7": () => col(IFNAMES.map((_, i) => (i === 3 ? 2 : 1)), "INTEGER"),
    "1.3.6.1.2.1.2.2.1.8": () => col(IFNAMES.map((_, i) => (i === 3 || i === 2 ? 2 : 1)), "INTEGER"),
    "1.3.6.1.2.1.31.1.1.1.15": () => col(IFNAMES.map((n) => (n.startsWith("Te") ? 10000 : n.startsWith("Vlan") ? 1000 : 1000)), "Gauge32"),
    "1.3.6.1.2.1.31.1.1.1.6": () => col(counterBase.map((b, i) => Math.round(b + t * (i + 1) * 3_100_000)), "Counter64"),
    "1.3.6.1.2.1.31.1.1.1.10": () => col(counterBase.map((b, i) => Math.round(b / 2 + t * (i + 1) * 1_250_000)), "Counter64"),
    "1.3.6.1.2.1.25.3.3.1.2": () => col([12, 9], "INTEGER"),
  };
  return (map[oid] ?? (() => []))();
}
const SYS = {
  "1.3.6.1.2.1.1.1.0": "Cisco IOS XE Software, Version 17.12.4, Catalyst L3 Switch Software (CAT9K_IOSXE)",
  "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.9.1.2494",
  "1.3.6.1.2.1.1.3.0": "412345600 (47d 17h 30m 56.00s)",
  "1.3.6.1.2.1.1.4.0": "noc@example.com",
  "1.3.6.1.2.1.1.5.0": "core-sw01",
  "1.3.6.1.2.1.1.6.0": "Sala de equipos, piso 3",
};
function emitTraps() {
  const list = [
    { trap_oid: "1.3.6.1.6.3.1.1.5.3", version: "v2c", kind: "trap", src: "192.0.2.21", vbs: [{ oid: "1.3.6.1.2.1.2.2.1.1.3", type: "INTEGER", value: "3" }, { oid: "1.3.6.1.2.1.2.2.1.2.3", type: "OCTET STRING", value: "GigabitEthernet1/0/3" }] },
    { trap_oid: "1.3.6.1.6.3.1.1.5.4", version: "v3", kind: "trap", src: "192.0.2.21", user: "traps", note: "authPriv verificado · engine 800000090300aabbccddee", vbs: [{ oid: "1.3.6.1.2.1.2.2.1.1.3", type: "INTEGER", value: "3" }, { oid: "1.3.6.1.2.1.2.2.1.2.3", type: "OCTET STRING", value: "GigabitEthernet1/0/3" }] },
    { trap_oid: "1.3.6.1.6.3.1.1.5.1", version: "v2c", kind: "inform", src: "198.51.100.1", vbs: [] },
    { trap_oid: "1.3.6.1.6.3.1.1.5.3", version: "v1", kind: "v1", src: "192.0.2.22", vbs: [{ oid: "agent-addr", type: "IpAddress", value: "192.0.2.22" }, { oid: "1.3.6.1.2.1.2.2.1.1.24", type: "INTEGER", value: "24" }] },
  ];
  emit("snmp-trap", list.map((t, i) => ({ ts: Date.now() - (list.length - i) * 4000, uptime: "412345600 (47d 17h 30m 56.00s)", user: null, note: null, ...t })));
}

let recentTargets = ["ssh admin@192.0.2.50 22", "telnet 203.0.113.9 23"];
const cmdHistory = { s0: [{ cmd: "show ip interface brief", ts: now - 60000 }, { cmd: "show version", ts: now - 3600000 }] };

const handlers = {
  "plugin:event|listen": ({ event, handler }) => {
    listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    return handler;
  },
  "plugin:event|unlisten": () => null,
  list_sessions: () => sessions,
  update_sessions: ({ sessions: changed }) => {
    for (const c of changed) {
      const i = sessions.findIndex((x) => x.id === c.id);
      if (i >= 0) sessions[i] = c;
    }
    return sessions;
  },
  get_settings: () => settings,
  save_settings: () => null,
  app_version: () => "0.8.0",
  update_check: () => ({ current: "0.8.0", latest: "0.8.0", newer: false, url: "", notes: "", published: "", supported: true, reason: null }),
  app_repo: () => "Parzval-Net/Net_Terminal",
  cmdpacks_list: () => [],
  list_notes: () => [
    ...Object.keys(notes).map((name) => ({ name, modified: now, protected: false })),
    ...Object.keys(secureNotes).map((name) => ({ name, modified: now - 3600000, protected: true })),
  ],
  read_note: ({ name }) => {
    if (secureNotes[name]) throw "La nota está protegida con contraseña";
    return notes[name] ?? "";
  },
  // Notas protegidas: mismas reglas que el backend (contraseña mínima, nunca se devuelve).
  note_unlock: ({ name, password }) => {
    const n = secureNotes[name];
    unlockedNote = null;
    if (!n || n.password !== password) throw "Contraseña incorrecta o archivo de la nota alterado";
    unlockedNote = name;
    return n.content;
  },
  note_protect: ({ name, password }) => {
    if ([...password].length < 8) throw "La contraseña debe tener al menos 8 caracteres";
    secureNotes[name] = { password, content: notes[name] ?? "" };
    delete notes[name];
    unlockedNote = name;
    return null;
  },
  note_save_secure: ({ name, content }) => {
    if (unlockedNote !== name) throw NOTE_LOCKED;
    secureNotes[name].content = content;
    return null;
  },
  note_touch: ({ name }) => unlockedNote === name,
  note_lock: () => ((unlockedNote = null), null),
  note_unprotect: ({ name }) => {
    if (unlockedNote !== name) throw NOTE_LOCKED;
    notes[name] = secureNotes[name].content;
    delete secureNotes[name];
    unlockedNote = null;
    return null;
  },
  note_change_password: ({ name, old, new: next }) => {
    if (secureNotes[name]?.password !== old) throw "Contraseña incorrecta o archivo de la nota alterado";
    secureNotes[name].password = next;
    return null;
  },
  list_scripts: () => [],
  // Búsqueda en notas: texto plano sin distinguir mayúsculas, como el backend.
  search_notes: ({ query }) => {
    const q = (query ?? "").trim().toLowerCase();
    if (q.length < 2) return [];
    // Las protegidas solo coinciden por nombre y sin contenido.
    const locked = Object.keys(secureNotes).filter((n) => n.toLowerCase().includes(q)).map((name) => ({ name, line: 0, snippet: "", protected: true }));
    return Object.entries(notes).flatMap(([name, text]) =>
      text.split("\n").flatMap((l, i) => (l.toLowerCase().includes(q) ? [{ name, line: i + 1, snippet: l.trim().slice(0, 160), protected: false }] : [])),
    ).concat(locked).slice(0, 200);
  },
  // Importación: vista previa ficticia (IPs de documentación).
  import_sessions_file: () => ({
    format: "putty",
    sessions: [
      { id: "", name: "core-sw03", type: "ssh", host: "192.0.2.3", port: 22, username: "admin", folder: "PuTTY", created_at: "" },
      { id: "", name: "consola-lab", type: "serial", serial_port: "COM3", baud_rate: 9600, folder: "PuTTY", created_at: "" },
    ],
    warnings: ["core-sw03: la llave .ppk de PuTTY no se importa (OpenSSH usa otro formato)"],
  }),
  add_sessions: ({ sessions: list }) => (sessions.push(...list.map((x, i) => ({ ...x, id: `imp${Date.now()}${i}` }))), [...sessions]),
  recent_targets: () => [...recentTargets],
  recent_target_add: ({ target }) => {
    recentTargets = [target, ...recentTargets.filter((t) => t.toLowerCase() !== target.toLowerCase())].slice(0, 20);
    return recentTargets;
  },
  recent_targets_clear: () => ((recentTargets = []), null),
  cmd_history: ({ key }) => cmdHistory[key] ?? [],
  cmd_history_add: ({ key, command }) => {
    cmdHistory[key] = [{ cmd: command, ts: Date.now() }, ...(cmdHistory[key] ?? []).filter((e) => e.cmd !== command)].slice(0, 50);
    return true;
  },
  cmd_history_clear: ({ key }) => (key ? delete cmdHistory[key] : Object.keys(cmdHistory).forEach((k) => delete cmdHistory[k]), null),
  plugins_list: () => [],
  tftp_files: () => [["c9300-universalk9.17.12.04.SPA.bin", 1_163_845_632], ["AR6100-V300R022C10SPC100.cc", 168_820_736], ["FGT_200F-v7.4.5.out", 92_340_224]],
  local_ips: () => [{ name: "en0", ip: "192.0.2.250" }],
  server_running: () => [...running],
  server_stop: ({ kind }) => (running.delete(kind), null),
  snmp_request: ({ oids }) => oids.map((oid) => (SYS[oid] ? { oid, type: oid.endsWith(".2.0") ? "OID" : oid.endsWith(".3.0") ? "Timeticks" : "OCTET STRING", value: SYS[oid] } : { oid, type: "noSuchObject", value: "No existe el objeto en este agente" })),
  snmp_walk_many: ({ oids }) => oids.map((oid) => ({ oid, rows: snmpColumn(oid), truncated: false, error: null })),
  snmp_walk: ({ oid }) => {
    const job = `job-${nextId++}`;
    setTimeout(() => {
      const rows = snmpColumn(oid);
      emit("tool-job", { job, kind: "line", text: "", data: { rows } });
      emit("tool-job", { job, kind: "result", text: "", data: { count: rows.length, truncated: false, cancelled: false, ms: 84 } });
      emit("tool-job", { job, kind: "done", text: "" });
    }, 300);
    return job;
  },
  snmp_secret_set: () => null,
  snmp_secret_has: () => true,
  snmp_secret_delete: () => null,
  snmp_trap_start: ({ port, bind }) => {
    running.add("snmptrap");
    setTimeout(emitTraps, 400);
    return `Receptor de traps escuchando en ${bind}:${port} (UDP)`;
  },
  ftp_server_info: () => (running.has("ftp") ? { user: "nt", pass: "k7m2q9xh4p", port: 21, write: false } : null),
  ftp_server_start: ({ port, allowWrite }) => (running.add("ftp"), { user: "nt", pass: "k7m2q9xh4p", port, write: allowWrite }),
  ftp_list: () => ({ cwd: "/firmware", tls: true, entries: [{ name: "cisco", size: 0, dir: true, date: "2026-10-01 09:00" }, { name: "c9300-universalk9.17.12.04.SPA.bin", size: 1_163_845_632, dir: false, date: "2026-09-12 18:20" }, { name: "AR6100-V300R022C10SPC100.cc", size: 168_820_736, dir: false, date: "2026-08-30 11:02" }] }),
  monitor_start: ({ cfg }) => startMonitor(cfg),
  monitor_stop: ({ id }) => (clearInterval(monitorTimers.get(id)), monitorTimers.delete(id), null),
  list_serial_ports: () => [{ port_name: "/dev/tty.usbserial-0001", port_type: "USB" }],
  tool_iperf_version: () => "iperf 3.17",
  data_dir: () => "~/NetTerminal/data",
  logs_dir_get: () => logsDirInfo(),
  logs_dir_set: ({ path }) => ((logsDir = path ?? ""), logsDirInfo()),
  device_run: ({ conn, command }) => {
    const s = connSessions.get(conn);
    const job = `job-${nextId++}`;
    const name = s?.name ?? "equipo";
    const rev = (backupRuns.get(name) ?? 0) % 2;
    backupRuns.set(name, (backupRuns.get(name) ?? 0) + 1);
    const prompt = s?.highlight === "huawei" ? `<${name}>` : `${name}#`;
    const body = /running-config|current-configuration/.test(command)
      ? `${s?.highlight === "huawei" ? "" : "Building configuration...\n\nCurrent configuration : 4211 bytes\n"}${fakeConfig(name, s?.highlight, rev)}`
      : "";
    const output = `${prompt}${command}\r\n${body.replace(/\n/g, "\r\n")}\r\n${prompt}`;
    setTimeout(() => {
      emit("tool-job", { job, kind: "result", text: "", data: { ok: true, output } });
      emit("tool-job", { job, kind: "done", text: "" });
    }, 600 + Math.random() * 600);
    return job;
  },
  backup_save: ({ device, content, mask }) => {
    const dev = device.replace(/[^\w.-]/g, "_");
    const file = `${stamp()}.txt`;
    const text = mask ? content.replace(/(secret \d |community |key 7 )\S+/g, "$1****") : content;
    backups[dev] = { ...(backups[dev] ?? {}), [file]: text };
    return file;
  },
  backup_list: () =>
    Object.entries(backups).map(([device, files]) => ({
      device,
      files: Object.keys(files).sort().reverse().map((name) => ({ name, size: files[name].length, modified: now / 1000 })),
    })),
  backup_read: ({ device, file }) => backups[device]?.[file] ?? "",
  save_note: ({ name, content }) => {
    if (secureNotes[name]) throw "La nota está protegida con contraseña";
    notes[name] = content;
    return null;
  },
  // Bóveda de contraseñas simulada: como el backend real, nunca devuelve una contraseña.
  // ?vault=portable simula el modo con contraseña maestra.
  cred_status: () => ({ ...vault, unlocked: vault.exists && vault.unlocked }),
  cred_set: ({ sessionId }) => ((vault.exists = true), vaultIds.add(sessionId), null),
  cred_has: ({ sessionId }) => vaultIds.has(sessionId),
  cred_delete: ({ sessionId }) => (vaultIds.delete(sessionId), null),
  vault_create: () => ((vault.exists = vault.unlocked = true), null),
  vault_unlock: ({ master }) => {
    if (master.length < 8) throw "Contraseña maestra incorrecta o archivo de credenciales alterado";
    vault.unlocked = true;
    return null;
  },
  vault_lock: () => ((vault.unlocked = false), null),
  vault_change: () => null,
  vault_reset: () => ((vault.exists = vault.unlocked = false), vaultIds.clear(), null),
  set_logging: ({ enabled }) => (enabled ? "~/NetTerminal/data/logs/core-sw01_20261021-101500.log" : null),
  // ?alert: simula un aviso de la primera alerta activa sobre la última sesión abierta.
  alerts_configure: ({ rules }) => {
    if (location.search.includes("alert") && rules.length)
      setTimeout(() => {
        const conn = [...channels.keys()].pop();
        if (conn) emit("alert-hit", { conn, rule: rules[0].id, line: "%LINK-3-UPDOWN: Interface GigabitEthernet1/0/3, changed state to down" });
      }, 1500);
    return null;
  },
  // Como el backend real: datos en binario y el cierre como texto por el mismo canal.
  connect: ({ id, session, onData }) => {
    connSessions.set(id, session);
    const text = terminalFor(session).replace(/\r?\n/g, "\r\n");
    const ch = { data: onData.id, index: 0 };
    channels.set(id, ch);
    const send = (t) => cbs.get(ch.data)?.({ index: ch.index++, message: enc.encode(t).buffer });
    // Equipo antiguo: sin "algoritmos legacy" OpenSSH rechaza la negociación.
    if (session.name === "router-antiguo" && !session.legacy_ssh) {
      setTimeout(() => {
        send("Unable to negotiate with 192.0.2.99 port 22: no matching host key type found. Their offer: ssh-rsa\r\n");
        cbs.get(ch.data)?.({ index: ch.index++, message: "El proceso terminó (código 255)" });
      }, 300);
      return null;
    }
    setTimeout(() => send(text), 150);
    // ?big=N: salida pesada (N líneas) para medir memoria y fugas.
    const big = Number(new URLSearchParams(location.search).get("big") ?? 0);
    for (let i = 0; i < big; i += 5000) {
      const lines = Array.from({ length: Math.min(5000, big - i) }, (_, k) => `linea ${i + k} GigabitEthernet1/0/${k % 48} up up 192.0.2.${k % 254}`);
      setTimeout(() => send(lines.join("\r\n") + "\r\n"), 300 + i / 50);
    }
    return null;
  },
  // Como el backend real: al cerrar se suelta el canal y el frontend recibe "end".
  disconnect: ({ id }) => {
    const ch = channels.get(id);
    if (ch) {
      if (!location.search.includes("noend")) {
        cbs.get(ch.data)?.({ end: true, index: ch.index });
      }
      channels.delete(id);
    }
    return null;
  },
};

const vaultPortable = location.search.includes("vault=portable");
const vault = { backend: vaultPortable ? "vault" : "keychain", exists: !vaultPortable, unlocked: !vaultPortable, portable: vaultPortable };
const vaultIds = new Set(["s6"]);

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
async function svgNode(name) {
  await wait(200);
  const t = [...document.querySelectorAll("svg text")].find((e) => e.textContent === name);
  t?.parentElement?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
  document.querySelector("svg")?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
  await wait(250);
}
const open = (l) => act("dblclick", l);
const key = (k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: `Key${k.toUpperCase()}`, metaKey: true, bubbles: true, cancelable: true }));
async function quickTo(host) {
  await click("Conexión rápida (SSH, Telnet, Serial) sin guardar");
  typeInto(document.querySelector('input[placeholder="10.0.0.1 o hostname"]'), host);
  await click("Conectar");
}
function typeInto(el, value) {
  if (!el) return console.warn("escena: campo no encontrado");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const scenes = {
  terminal: async () => { await open("ar-wan01"); await open("core-sw01"); await click("Catálogo de comandos"); },
  notes: async () => { await open("core-sw01"); await open("ar-wan01"); await click("Notas"); await click("plantilla-vlan.txt"); },
  monitor: async () => { await open("core-sw01"); await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); },
  topology: async () => { await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); await click("Topología"); await svgNode("core-sw01"); await click("Desde aquí"); await svgNode("sw-acceso-02"); await click("Hasta aquí"); },
  compare: async () => { await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); await click("Topología"); await wait(300); const s = [...document.querySelectorAll("select")].find((x) => [...x.options].some((o) => o.value === "s1")); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(s, "s1"); s.dispatchEvent(new Event("change", { bubbles: true })); await wait(300); },
  subnet: async () => { await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); await click("Subredes"); },
  speed: async () => { await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); await click("Velocidad"); },
  oscmds: async () => { await open("Shell local"); await click("Catálogo de comandos"); },
  about: async () => { await click("Ajustes"); await click("Acerca de"); },
  settings: async () => { await open("core-sw01"); await click("Ajustes"); },
  logs: async () => { await open("core-sw01"); await click("Ajustes"); await click("Logs"); },
  quick: async () => { await click("Conexión rápida (SSH, Telnet, Serial) sin guardar"); const h = document.querySelector('input[placeholder="10.0.0.1 o hostname"]'); if (h) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(h, "192.0.2.77"); h.dispatchEvent(new Event("input", { bubbles: true })); } },
  quickserial: async () => { await click("Conexión rápida (SSH, Telnet, Serial) sin guardar"); await click("Serial"); },
  // Pestaña abierta por conexión rápida: "Guardar como sesión…" en la barra de estado.
  quicktab: async () => { await click("Conexión rápida (SSH, Telnet, Serial) sin guardar"); const h = document.querySelector('input[placeholder="10.0.0.1 o hostname"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(h, "192.0.2.77"); h.dispatchEvent(new Event("input", { bubbles: true })); await click("Conectar"); },
  packs: async () => { await open("core-sw01"); await click("Catálogo de comandos"); await click("Packs de comandos"); },
  split: async () => { await open("core-sw01"); await open("ar-wan01"); await open("dist-sw01"); await open("sw-acceso-sur"); await click("Vista dividida: ver 2 o 4 pestañas a la vez"); await click("4 en cuadrícula (2x2)"); },
  backup: async () => { await open("core-sw01"); await open("ar-wan01"); await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); await click("Respaldos"); await click("Comparar A y B"); },
  legacy: async () => { await open("router-antiguo"); },
  credentials: async () => { await click("Ajustes"); await click("Credenciales"); },
  alerts: async () => { await open("core-sw01"); await click("Ajustes"); await click("Alertas"); },
  import: async () => { await click("Ajustes"); await click("Importar y exportar"); await click("Desde archivo…"); await click("Leer ~/.ssh/config"); },
  vertical: async () => { await open("core-sw01"); await open("ar-wan01"); await open("fw-perimetro"); await open("sw-acceso-norte"); },
  // Nota protegida: se elige, se desbloquea con la contraseña de demo y se abren sus opciones.
  "secure-note": async () => {
    await open("core-sw01");
    await click("Notas");
    await wait(400);
    const sel = [...document.querySelectorAll("select")].find((x) => [...x.options].some((o) => o.value === "accesos-sitio-central"));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, "accesos-sitio-central");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(400);
    const pw = document.querySelector('input[type="password"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(pw, "demo-clave-2026");
    pw.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(100);
    pw.form.requestSubmit();
    await wait(400);
    await click("Protección de la nota");
  },
  snmp: async () => { await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); await click("SNMP"); await click("IF-MIB (RFC 2863): ifXTable con contadores de 64 bits; ifTable si el agente no la tiene"); await wait(400); await click("Iniciar"); await wait(600); [...document.querySelectorAll("h3")].find((h) => h.textContent === "Conjuntos de OIDs")?.scrollIntoView(); },
  // Generador de configuración SNMP: Cisco IOS-XE, v3 authPriv, secretos como marcadores.
  snmpgen: async () => {
    await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); await click("SNMP"); await click("Generador de configuración"); await wait(300);
    const at = (ph) => document.querySelector(`input[placeholder="${ph}"]`);
    setVal(at("192.0.2.10, 198.51.100.0/24"), "192.0.2.10, 198.51.100.0/24");
    setVal(at("192.0.2.20"), "192.0.2.20");
    setVal(at("Loopback0"), "Loopback0");
    setVal(at("Santiago DC1 Rack 12"), "Sitio Central Rack 12");
    await wait(300);
    const h = [...document.querySelectorAll("h3")].find((x) => x.textContent === "Configuración generada");
    h?.scrollIntoView({ block: "center" });
    // Deja visible la fila de plataforma y algoritmos sobre el texto generado.
    let sc = h?.parentElement;
    while (sc && sc.scrollHeight <= sc.clientHeight) sc = sc.parentElement;
    if (sc) sc.scrollTop -= 90;
  },
  transfer: async () => { await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); await click("Transferencias"); await wait(400); [...document.querySelectorAll("h3")].find((h) => h.textContent === "Servidor TFTP")?.scrollIntoView(); },
  // ---- Escenas de QA visual del contenedor de la app ----
  empty: async () => {},
  palette: async () => { await wait(300); key("k"); await wait(300); },
  "palette-q": async () => { await wait(300); key("k"); await wait(300); typeInto(document.querySelector('[role="dialog"] input, .fixed input'), "core"); await wait(300); },
  ctxmenu: async () => { await open("core-sw01"); const row = find("core-sw02"); row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 160 })); await wait(300); },
  filter: async () => { typeInto(document.querySelector('input[placeholder^="Filtrar"]'), "sw-acceso"); await wait(300); },
  "filter-none": async () => { typeInto(document.querySelector('input[placeholder^="Filtrar"]'), "zzz"); await wait(300); },
  // Pestañas con estados mezclados: rápida inactiva, alerta, actividad y cerrada.
  quicktabs: async () => {
    await quickTo("192.0.2.77");
    await open("core-sw01");
    await open("router-antiguo");
    await open("ar-wan01");
    await wait(500);
  },
  "quick-active": async () => {
    await quickTo("192.0.2.77");
    await open("core-sw01");
    await wait(300);
    document.querySelector('[title^="192.0.2.77"]')?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await wait(500);
  },
  "lock-note": async () => {
    await open("core-sw01");
    await click("Notas");
    await wait(400);
    const sel = [...document.querySelectorAll("select")].find((x) => [...x.options].some((o) => o.value === "accesos-sitio-central"));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, "accesos-sitio-central");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(400);
  },
  find: async () => { await open("core-sw01"); await wait(400); key("f"); await wait(300); },
  paste: async () => {
    await open("core-sw01");
    await wait(600);
    const dt = new DataTransfer();
    dt.setData("text/plain", "interface Gi1/0/5\n description PRUEBA\n shutdown\n");
    document.querySelector(".xterm")?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    await wait(300);
  },
  toasts: async () => { await open("core-sw01"); await open("ar-wan01"); await wait(1200); },
  // Barra de difusión en curso: se arranca un envío ficticio directo en el módulo.
  bcastbar: async () => {
    await open("core-sw01"); await open("core-sw02");
    const m = await import("/src/lib/broadcast.ts");
    const mk = (id, name, host) => ({ id, session: { id, name, host, type: "ssh" } });
    m.runBroadcast([mk("a", "core-sw01", "192.0.2.1"), mk("b", "core-sw02", "192.0.2.2"), mk("c", "dist-sw01", "192.0.2.11")], [{ tab: mk("d", "Shell local"), reason: "Terminal local" }], "show clock", { lineDelayMs: 0, deviceDelayMs: 0 },
      () => ({ isConnected: () => true, send: () => new Promise((r) => setTimeout(r, 600000)) }));
    await wait(300);
    await click("Ver detalle");
  },
  macros: async () => { await open("core-sw01"); await wait(300); },
  broadcast: async () => { await open("core-sw01"); await open("core-sw02"); await open("Shell local"); await click("Notas"); await click("Elegir a qué sesiones se envía"); },
};
// Escenas de QA visual (modales, ajustes y herramientas).
const setVal = (el, v) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
};
const TOOLS = "Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins";
const settingsAt = (label) => async () => { await click("Ajustes"); await wait(300); await click(label); };
const tool = (label) => async () => { await click(TOOLS); await click(label); };
Object.assign(scenes, {
  "s-appearance": settingsAt("Apariencia"),
  "s-terminal": settingsAt("Terminal"),
  "s-highlight": settingsAt("Resaltado"),
  "s-logs": settingsAt("Logs"),
  "s-credentials": settingsAt("Credenciales"),
  "s-sessions": settingsAt("Importar y exportar"),
  "s-modules": settingsAt("Módulos"),
  "s-alerts": settingsAt("Alertas"),
  "s-ai": settingsAt("Agentes IA"),
  "s-about": settingsAt("Acerca de"),
  "s-search": async () => { await click("Ajustes"); await wait(300); setVal(document.querySelector('input[aria-label="Buscar ajuste"]'), "contraseña"); },
  "s-vault": async () => { await click("Ajustes"); await wait(300); await click("Credenciales"); },
  "session-new": async () => { await click("Nueva sesión"); },
  "session-edit": async () => { await wait(300); const row = [...document.querySelectorAll("[title]")].find((e) => e.title.startsWith("192.0.2.1")); row?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); const ed = row?.querySelector('[title="Editar"]') ?? find("Editar"); ed?.dispatchEvent(new MouseEvent("click", { bubbles: true })); },
  "quick-telnet": async () => { await click("Conexión rápida (SSH, Telnet, Serial) sin guardar"); await click("Telnet"); },
  confirm: async () => { await open("core-sw01"); await open("ar-wan01"); await wait(300); window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", metaKey: true, ctrlKey: true, bubbles: true })); },
  approval: async () => { await wait(800); emit("mcp-approval", { id: "a1", tool: "run_command", target: "core-sw01 (192.0.2.1)", detail: "configure terminal\ninterface GigabitEthernet1/0/4\n no shutdown\nend" }); },
  macro: async () => { await open("core-sw01"); await click("Nuevo botón"); },
  "cmd-editor": async () => { await open("core-sw01"); await click("Catálogo de comandos"); await click("Agregar un comando propio"); },
  // Nueva sesión con túneles, contraseña guardada y un error de validación visibles.
  "session-full": async () => {
    await click("Nueva sesión");
    await wait(300);
    const d = [...document.querySelectorAll("details")].find((x) => x.textContent.includes("Túneles SSH"));
    if (d) d.open = true;
    await click("Agregar túnel");
    await click("Agregar túnel");
    const pw = [...document.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith("Guardar contraseña"))?.querySelector("input");
    pw?.click();
    await wait(200);
    document.querySelector("form footer button[type=submit]")?.click();
  },
  // Alerta en edición con una expresión regular inválida (estado de error).
  "s-alerts-edit": async () => {
    await click("Ajustes"); await wait(300); await click("Alertas"); await click("Nueva alerta"); await wait(200);
    const boxes = [...document.querySelectorAll("label")].find((l) => l.textContent.trim() === "Expresión regular")?.querySelector("input");
    boxes?.click(); await wait(100);
    setVal(document.querySelector('input[placeholder="BGP.*Down"]'), "BGP.*(Down");
  },
  // Diálogo de difusión: varias pestañas elegidas y "Enviar todo" desde Notas.
  "bc-dialog": async () => {
    await scenes.broadcast(); await wait(300);
    document.querySelectorAll("input[name=bc-mode]")[1]?.click(); await wait(200);
    for (const c of document.querySelectorAll("input[type=checkbox]")) if (!c.checked && c.closest("label")?.textContent.includes("core-sw0")) c.click();
    await wait(200);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    [...document.querySelectorAll("button")].find((b) => /⇧Enter|Shift\+Enter/.test(b.title))?.click();
  },
  "t-monitor": tool("Monitoreo"),
  "t-diag": tool("Diagnóstico"),
  "t-topology": tool("Topología"),
  "t-subnet": tool("Subredes"),
  "t-perf": tool("Velocidad"),
  "t-transfer": tool("TFTP / HTTP"),
  "t-syslog": tool("Syslog"),
  "t-backup": scenes.backup,
  "t-plugins": tool("Plugins"),
});
// Acceso para el script de QA (CDP): pasos adicionales sobre una escena.
window.__demo = { click, open, wait, svgNode, emit, find, setVal };
const scene = new URLSearchParams(location.search).get("scene");
if (scene && scenes[scene]) window.addEventListener("load", () => wait(600).then(scenes[scene]));
