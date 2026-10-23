// Pruebas de topología: `node scripts/tests/topology.test.mjs` (Node 22.15+ con tipos TS).
// Salidas de ejemplo con direcciones de documentación (RFC 5737) y nombres ficticios.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// packs.ts importa "./highlight" sin extensión (como lo resuelve Vite): se completa con .ts.
registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      try {
        return next(`${specifier}.ts`, context);
      } catch {
        /* sigue con la resolución normal */
      }
    }
    return next(specifier, context);
  },
});

const T = await import("../../src/lib/topology.ts");
const { computeRisk } = await import("../../src/lib/packs.ts");

// ---------- Parsers de ruteo ----------

const iosOspf = `R1#show ip ospf neighbor

Neighbor ID     Pri   State           Dead Time   Address         Interface
192.0.2.2         1   FULL/DR         00:00:36    198.51.100.2    GigabitEthernet0/1
192.0.2.3         0   FULL/  -        00:00:33    198.51.100.6    GigabitEthernet0/2
192.0.2.4         1   2WAY/DROTHER    00:00:39    198.51.100.10   Vlan10
192.0.2.9         1   DOWN/  -           -        198.51.100.14   GigabitEthernet0/3
R1#`;
const ospf = T.parseCiscoOspf(iosOspf);
assert.equal(ospf.length, 3, "DOWN no se dibuja");
assert.deepEqual(
  ospf.map((n) => [n.name, n.ip, n.localPort, n.proto, n.byAddr]),
  [
    ["192.0.2.2", "198.51.100.2", "GigabitEthernet0/1", "OSPF", true],
    ["192.0.2.3", "198.51.100.6", "GigabitEthernet0/2", "OSPF", true],
    ["192.0.2.4", "198.51.100.10", "Vlan10", "OSPF", true],
  ],
);
assert.deepEqual(ospf[0].addrs, ["192.0.2.2", "198.51.100.2"]);

// NX-OS: Up Time en vez de Dead Time, con encabezado por VRF.
const nxOspf = ` OSPF Process ID 1 VRF default
 Total number of neighbors: 1
 Neighbor ID     Pri State            Up Time  Address         Interface
 192.0.2.21        1 FULL/DR          02:11:05 203.0.113.2     Eth1/49
`;
assert.deepEqual(T.parseCiscoOspf(nxOspf).map((n) => [n.name, n.ip, n.localPort]), [["192.0.2.21", "203.0.113.2", "Eth1/49"]]);

const junosOspf = `user@borde-01> show ospf neighbor
Address          Interface              State     ID               Pri  Dead
198.51.100.1     ge-0/0/0.0             Full      192.0.2.1        128    36
198.51.100.5     ge-0/0/1.0             2Way      192.0.2.5        128    38
198.51.100.9     ge-0/0/2.0             Init      192.0.2.6        128    31
`;
const jo = T.parseJunosOspf(junosOspf);
assert.deepEqual(jo.map((n) => [n.name, n.ip, n.localPort]), [
  ["192.0.2.1", "198.51.100.1", "ge-0/0/0.0"],
  ["192.0.2.5", "198.51.100.5", "ge-0/0/1.0"],
  ["192.0.2.6", "198.51.100.9", "ge-0/0/2.0"],
]);

const huaweiOspf = `<agg-hw01>display ospf peer brief

          OSPF Process 1 with Router ID 192.0.2.30
                  Peer Statistic Information
 ----------------------------------------------------------------------------
 Area Id          Interface                        Neighbor id      State
 0.0.0.0          GigabitEthernet1/0/0             192.0.2.31       Full
 0.0.0.1          Vlanif100                        192.0.2.32       Full
 ----------------------------------------------------------------------------
 Total Peer(s):     2
<agg-hw01>`;
const hw = T.parseHuaweiOspf(huaweiOspf);
assert.deepEqual(hw.map((n) => [n.name, n.ip, n.localPort]), [
  ["192.0.2.31", "192.0.2.31", "GigabitEthernet1/0/0"],
  ["192.0.2.32", "192.0.2.32", "Vlanif100"],
]);
assert.deepEqual(T.parseHuaweiOspf("Area Id no es tabla\n 0.0.0.0 x 192.0.2.1 Full"), [], "sin encabezado no se interpreta");

// EIGRP: formato actual (columna H) y antiguo (sin H).
const eigrpNew = `R1#show ip eigrp neighbors
EIGRP-IPv4 Neighbors for AS(100)
H   Address                 Interface              Hold Uptime   SRTT   RTO  Q  Seq
                                                   (sec)         (ms)       Cnt Num
1   198.51.100.18           Gi0/3                    13 01:02:03    1   100  0  42
0   198.51.100.22           Tu10                     11 3d04h      20   200  0  17
`;
const eigrpOld = `IP-EIGRP Neighbors for process 77
Address                 Interface     Holdtime Uptime   Q      Seq  SRTT  RTO
                                      (secs)   (h:m:s)  Count  Num  (ms)  (ms)
203.0.113.28            Ethernet1     13       0:00:41  0      11   4     20
`;
assert.deepEqual(T.parseEigrp(eigrpNew).map((n) => [n.name, n.localPort, n.proto]), [
  ["198.51.100.18", "Gi0/3", "EIGRP"],
  ["198.51.100.22", "Tu10", "EIGRP"],
]);
assert.deepEqual(T.parseEigrp(eigrpOld).map((n) => [n.name, n.localPort]), [["203.0.113.28", "Ethernet1"]]);
assert.deepEqual(T.parseEigrp(iosOspf), [], "solo con encabezado EIGRP");

const iosBgp = `R1#show ip bgp summary
BGP router identifier 192.0.2.1, local AS number 65010
BGP table version is 120, main routing table version 120
12 network entries using 2976 bytes of memory

Neighbor        V           AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd
192.0.2.2       4        65010     812     809      120    0    0 12:01:44       35
198.51.100.2    4        65010     500     498      120    0    0 1d02h          10
203.0.113.1     4        64500    1022     990      120    0    0 3d01h          12
203.0.113.5     4        64501       0       0        1    0    0 never    Idle (Admin)
`;
const b = T.parseBgpSummary(iosBgp);
assert.equal(b.routerId, "192.0.2.1");
assert.equal(b.localAs, "65010");
assert.deepEqual(b.peers.map((p) => [p.ip, p.remoteAs, p.state]), [
  ["192.0.2.2", "65010", "35"],
  ["198.51.100.2", "65010", "10"],
  ["203.0.113.1", "64500", "12"],
  ["203.0.113.5", "64501", "Idle (Admin)"],
]);
const nxBgp = `BGP summary information for VRF default, address family IPv4 Unicast
BGP router identifier 192.0.2.21, local AS number 65020
BGP table version is 67, IPv4 Unicast config peers 1, capable peers 1

Neighbor        V    AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd
203.0.113.9     4 65021     346     334       67    0    0 05:25:12 8
`;
assert.deepEqual(T.parseBgpSummary(nxBgp).peers.map((p) => p.ip), ["203.0.113.9"]);

// Combinado: BGP con IGP en común es directo (toma su interfaz); iBGP sin IGP es lógico; eBGP es directo.
const r = T.parseRoutingNeighbors([
  { cmd: "show ip ospf neighbor", out: iosOspf },
  { cmd: "show ip eigrp neighbors", out: "" },
  { cmd: "show ip bgp summary", out: iosBgp },
]);
assert.deepEqual(r.selfAddrs, ["192.0.2.1"]);
const bgpN = r.neighbors.filter((n) => n.proto === "BGP");
assert.deepEqual(
  bgpN.map((n) => [n.name, n.localPort, !!n.logical]),
  [
    ["192.0.2.2", "", true], // iBGP entre loopbacks
    ["198.51.100.2", "GigabitEthernet0/1", false], // misma IP que el vecino OSPF
    ["203.0.113.1", "", false], // eBGP (TTL 1)
  ],
  "Idle no se incluye",
);
// Comando con error o protocolo apagado: sin vecinos ni excepción.
assert.deepEqual(T.parseRoutingNeighbors([{ cmd: "show ip bgp summary", out: "% BGP not active\nR1#" }]).neighbors, []);
const hwR = T.parseRoutingNeighbors([{ cmd: "display ospf peer brief", out: huaweiOspf }]);
assert.deepEqual(hwR.selfAddrs, ["192.0.2.30"]);
const jR = T.parseRoutingNeighbors([{ cmd: "show ospf neighbor", out: junosOspf }]);
assert.equal(jR.neighbors.length, 3);

// CDP/LLDP deshabilitados se detectan como error (y activan el aviso en la interfaz).
assert.ok(T.isCliError("% CDP is not enabled\nR1#"));
assert.ok(T.isCliError("R1#show lldp neighbors detail\n% LLDP is not enabled\nR1#"));
assert.ok(T.isCliError("% BGP not active"));
assert.ok(!T.isCliError("Gi1/0/1  connected  descripcion: CDP is not enabled en el remoto"), "texto en una descripción no es error");
assert.deepEqual(T.parseNeighbors("cisco", ["% CDP is not enabled", "% LLDP is not enabled"]), []);

// Direcciones propias (IOS, NX-OS, Huawei, Junos).
const own = T.parseOwnAddresses([
  `Interface              IP-Address      OK? Method Status                Protocol
GigabitEthernet0/1     198.51.100.1    YES NVRAM  up                    up
GigabitEthernet0/2     unassigned      YES NVRAM  administratively down down
Loopback0              192.0.2.1       YES NVRAM  up                    up
R1#`,
  `IP Interface Status for VRF "default"(1)
Interface            IP Address      Interface Status
Eth1/49              203.0.113.1     protocol-up/link-up/admin-up`,
  `Interface                         IP Address/Mask      Physical   Protocol
Vlanif100                         198.51.100.33/29     up         up
NULL0                             unassigned           up         up(s)`,
  `Interface               Admin Link Proto    Local                 Remote
ge-0/0/0.0              up    up   inet     198.51.100.5/30
lo0.0                   up    up   inet     192.0.2.5           --> 0/0
em1.0                   up    up   inet     128.0.0.1/2
                                   inet     10.0.0.4/8
lo0.16384               up    up   inet     127.0.0.1           --> 0/0`,
]);
assert.deepEqual(own.sort(), ["10.0.0.4", "192.0.2.1", "192.0.2.5", "198.51.100.1", "198.51.100.33", "198.51.100.5", "203.0.113.1"].sort());

// ---------- Fusión por IP ----------

let t = { nodes: [], links: [] };
// R1 (CDP apagado) ve a R2 por OSPF y a un par iBGP.
t = T.mergeNeighbors(t, { name: "R1", ip: "192.0.2.1", addrs: ["198.51.100.1", "192.0.2.1"] }, r.neighbors);
const r2 = t.nodes.find((n) => n.id === "192.0.2.2");
assert.ok(r2?.addrOnly, "vecino por router-id, sin hostname");
assert.equal(r2.name, "192.0.2.2", "se rotula por IP");
assert.equal(r2.ip, "198.51.100.2");
assert.equal(t.links.filter((l) => l.proto === "OSPF").length, 3);
// El par iBGP 192.0.2.2 es el mismo router que el vecino OSPF: comparte nodo, enlace lógico aparte.
assert.equal(t.nodes.filter((n) => T.knownAddrs(n).includes("192.0.2.2")).length, 1, "sin duplicar el nodo");
const logical = t.links.find((l) => l.proto === "BGP" && l.logical);
assert.ok(logical && logical.b === "192.0.2.2");
// El BGP directo por 198.51.100.2 queda cubierto por el enlace OSPF del mismo puerto.
assert.equal(t.links.filter((l) => l.proto === "BGP" && !l.logical && l.b === "192.0.2.2").length, 0);
// Luego se explora R2: su nombre real reemplaza al nodo por IP, sin duplicar.
const before = t.nodes.length;
const r2Ospf = `Neighbor ID     Pri   State           Dead Time   Address         Interface
192.0.2.1         1   FULL/BDR        00:00:31    198.51.100.1    GigabitEthernet0/0
`;
t = T.mergeNeighbors(t, { name: "R2", ip: "192.0.2.2", addrs: ["198.51.100.2"] }, T.parseCiscoOspf(r2Ospf));
assert.equal(t.nodes.length, before, "R2 absorbe al nodo 192.0.2.2 y R1 se reconoce por su IP");
assert.ok(!t.nodes.some((n) => n.id === "192.0.2.2"));
const r2Node = t.nodes.find((n) => n.id === "r2");
assert.ok(r2Node.explored && !r2Node.addrOnly);
const r1r2 = t.links.filter((l) => l.proto === "OSPF" && [l.a, l.b].sort().join() === "r1,r2");
assert.equal(r1r2.length, 1, "el enlace OSPF visto desde ambos lados es uno solo");
assert.deepEqual([r1r2[0].aPort, r1r2[0].bPort], ["Gi0/1", "Gi0/0"], "completa la interfaz del otro extremo");
assert.equal(t.links.find((l) => l.logical)?.b, "r2", "la sesión lógica también se movió");
// CDP posterior confirma el enlace: pasa a CDP (más confiable), sin duplicarse.
t = T.mergeNeighbors(t, { name: "R2" }, [{ name: "R1.lab.example", localPort: "GigabitEthernet0/0", remotePort: "GigabitEthernet0/1", proto: "CDP" }]);
const confirmed = t.links.filter((l) => [l.a, l.b].sort().join() === "r1,r2" && !l.logical);
assert.equal(confirmed.length, 1);
assert.equal(confirmed[0].proto, "CDP");
// Un vecino CDP con IP absorbe un nodo conocido solo por esa dirección.
let t2 = T.mergeNeighbors({ nodes: [], links: [] }, { name: "R5" }, T.parseEigrp(eigrpOld));
assert.ok(t2.nodes.some((n) => n.id === "203.0.113.28"));
t2 = T.mergeNeighbors(t2, { name: "SW9" }, [{ name: "R6", localPort: "Gi1/0/1", remotePort: "Gi0/0", ip: "203.0.113.28", proto: "CDP" }]);
assert.ok(!t2.nodes.some((n) => n.id === "203.0.113.28"));
assert.ok(t2.links.some((l) => l.proto === "EIGRP" && (l.a === "r6" || l.b === "r6")));
// nodeId conserva las IPv4 completas (antes cortaba en el primer punto).
assert.equal(T.nodeId("192.0.2.7"), "192.0.2.7");
assert.equal(T.nodeId("sw01.lab.example"), "sw01");

// Ruta: la sesión lógica no es un salto físico mientras exista otro camino.
const lt = {
  nodes: ["a", "b", "c"].map((id, i) => ({ id, name: id, explored: true, x: i * 100 + 1, y: 1 })),
  links: [
    { a: "a", aPort: "Gi0/1", b: "b", bPort: "Gi0/1", proto: "OSPF" },
    { a: "b", aPort: "Gi0/2", b: "c", bPort: "Gi0/2", proto: "OSPF" },
    { a: "a", aPort: "", b: "c", bPort: "", proto: "BGP", logical: true },
  ],
};
assert.equal(T.shortestPath(lt, "a", "c").links.length, 2);
assert.equal(T.shortestPath({ ...lt, links: [lt.links[2]] }, "a", "c").links.length, 1, "sin otro camino se usa la sesión");
assert.match(T.pathToText(lt, T.shortestPath({ ...lt, links: [lt.links[2]] }, "a", "c")), /\? → \? {2}c {2}\(BGP lógica\)/);

// ---------- Equipos y enlaces manuales ----------

let m = { nodes: [], links: [] };
let res = T.addManualNode(m, { name: "sw-bodega-01", ip: "192.0.2.50", platform: "C9200L" });
assert.ok(res.topo, res.error);
m = res.topo;
assert.ok(m.nodes[0].manual && !m.nodes[0].explored);
assert.ok(T.addManualNode(m, { name: "SW-BODEGA-01" }).error, "nombre repetido");
assert.ok(T.addManualNode(m, { name: "otro", ip: "192.0.2.50" }).error, "IP repetida");
assert.ok(T.addManualNode(m, { name: "x", ip: "192.0.2.256" }).error, "IP fuera de rango");
assert.ok(T.addManualNode(m, { name: "x", ip: "192.0.2.010" }).error, "ceros a la izquierda");
assert.ok(T.addManualNode(m, { name: "x", ip: "hola" }).error);
assert.ok(T.addManualNode(m, { name: "x", ip: "2001:db8::1" }).topo, "IPv6 válida");
assert.ok(T.addManualNode(m, { name: "x", ip: "2001:db8:::1" }).error, "IPv6 inválida");
assert.ok(T.addManualNode(m, { name: "mal\nnombre" }).error, "salto de línea");
assert.ok(T.addManualNode(m, { name: "mal‮nombre" }).error, "override de dirección");
assert.ok(T.addManualNode(m, { name: "  " }).error, "vacío");
assert.ok(T.addManualNode(m, { name: "a".repeat(65) }).error, "largo");
assert.ok(T.addManualNode(m, { name: "ok", platform: "p".repeat(121) }).error, "plataforma larga");
m = T.addManualNode(m, { name: "ap-patio" }).topo;
res = T.addManualLink(m, { a: "sw-bodega-01", aPort: "GigabitEthernet1/0/5", b: "ap-patio", bPort: "" });
assert.ok(res.topo, res.error);
m = res.topo;
assert.deepEqual(m.links[0], { a: "sw-bodega-01", aPort: "Gi1/0/5", b: "ap-patio", bPort: "", proto: "manual" });
assert.ok(T.addManualLink(m, { a: "ap-patio", aPort: "", b: "sw-bodega-01", bPort: "Gi1/0/5" }).error, "duplicado en el otro sentido");
assert.ok(T.addManualLink(m, { a: "ap-patio", aPort: "", b: "ap-patio", bPort: "" }).error, "mismo equipo");
assert.ok(T.addManualLink(m, { a: "ap-patio", aPort: "Gi 1", b: "sw-bodega-01", bPort: "" }).error, "espacios");
assert.ok(T.addManualLink(m, { a: "nada", aPort: "", b: "sw-bodega-01", bPort: "" }).error, "equipo inexistente");
assert.ok(T.addManualLink(m, { a: "ap-patio", aPort: "x\u0007", b: "sw-bodega-01", bPort: "" }).error, "control");
// Editar enlace y equipo (renombrar mueve sus enlaces).
res = T.updateManualLink(m, m.links[0], { a: "sw-bodega-01", aPort: "Gi1/0/6", b: "ap-patio", bPort: "eth0" });
assert.ok(res.topo, res.error);
m = res.topo;
assert.equal(m.links[0].aPort, "Gi1/0/6");
res = T.updateManualNode(m, "ap-patio", { name: "ap-patio-02", ip: "198.51.100.77" });
assert.ok(res.topo, res.error);
m = res.topo;
assert.equal(m.links[0].b, "ap-patio-02");
assert.equal(m.nodes.find((n) => n.id === "ap-patio-02").ip, "198.51.100.77");
// Los descubiertos no se editan ni borran como manuales.
assert.ok(T.deleteManualNode(t, "r1").error);
assert.ok(T.deleteManualLink(t, t.links[0]).error);
// Ruta y diff incluyen lo manual.
assert.equal(T.shortestPath(m, "sw-bodega-01", "ap-patio-02").links.length, 1);
const d = T.diffTopology({ nodes: [], links: [] }, m);
assert.equal(d.addedLinks.length, 1);
assert.equal(d.addedNodes.length, 2);
// Borrar enlace y equipo.
assert.equal(T.deleteManualLink(m, m.links[0]).topo.links.length, 0);
const del = T.deleteManualNode(m, "sw-bodega-01").topo;
assert.equal(del.nodes.length, 1);
assert.equal(del.links.length, 0, "se van sus enlaces");
// Un equipo manual que luego se explora deja de ser manual.
const ex = T.mergeNeighbors(m, { name: "sw-bodega-01" }, []);
assert.ok(!ex.nodes.find((n) => n.id === "sw-bodega-01").manual);

// ---------- Heurística de descripciones ----------

const yes = [
  ["UPLINK a dist-sw01 Gi1/0/48", "dist-sw01", "Gi1/0/48"],
  ["to core-sw02 Te1/1/1", "core-sw02", "Te1/1/1"],
  ["Hacia fw-borde01 port2", "fw-borde01", "port2"],
  ["hacia sw-acceso-3", "sw-acceso-3", undefined],
  ["Enlace a rt_wan01 ge-0/0/1", "rt_wan01", "ge-0/0/1"],
  ["TRUNK TO dist-sw02", "dist-sw02", undefined],
  ["[to:core01]", "core01", undefined],
  ["Conexión con sw03-piso2, puerto Gi0/1", "sw03-piso2", undefined],
  ["uplink-to-agg01", "agg01", undefined],
  ["link to 192.0.2.9", "192.0.2.9", undefined],
];
for (const [desc, host, port] of yes) assert.deepEqual(T.parseDescriptionHint(desc), { host, port }, desc);
const no = [
  "Access to printers",
  "VLAN 10 a usuarios",
  "Puerto a impresora 3",
  "to be removed",
  "Reservado",
  "Uplink",
  "Trunk Gi1/0/1",
  "Enlace a ISP",
  "conectado a la red",
  "Hacia 2do piso",
  "Trunk a VLAN10",
  "to wi-fi users",
  "Hacia X",
  "",
];
for (const desc of no) assert.equal(T.parseDescriptionHint(desc), null, desc);

// Sugerencias: solo puertos sin enlace, nunca se dibujan solas, y se confirman como "descripción".
const s0 = {
  nodes: [
    {
      id: "acc-sw01", name: "acc-sw01", explored: true, x: 1, y: 1,
      ports: {
        "gi1/0/48": { desc: "UPLINK a dist-sw01 Gi1/0/1" },
        "gi1/0/47": { desc: "to core-sw09" },
        "gi1/0/1": { desc: "to dist-sw01 Gi1/0/2" },
        "gi1/0/2": { desc: "Access to printers" },
      },
    },
    { id: "dist-sw01", name: "dist-sw01", explored: true, x: 2, y: 2 },
  ],
  links: [{ a: "acc-sw01", aPort: "Gi1/0/1", b: "dist-sw01", bPort: "Gi1/0/2", proto: "CDP" }],
};
const sug = T.collectSuggestions(s0, { descriptions: true });
assert.deepEqual(
  sug.map((s) => [s.aPort, s.target, s.bPort, s.confidence, s.source, s.proto]),
  [
    ["Gi1/0/48", "dist-sw01", "Gi1/0/1", "alta", "descriptions", "descripción"],
    ["Gi1/0/47", "core-sw09", "", "baja", "descriptions", "descripción"],
  ],
);
assert.equal(s0.links.length, 1, "no dibuja nada por sí sola");
assert.deepEqual(T.collectSuggestions(s0, {}), [], "fuente apagada: sin sugerencias");
assert.deepEqual(T.collectSuggestions(s0, { descriptions: true }, new Set([sug[0].id])).length, 1, "descartadas");
let acc = T.acceptSuggestion(s0, sug[1]);
assert.ok(acc.topo, acc.error);
const nn = acc.topo.nodes.find((n) => n.id === "core-sw09");
assert.ok(nn?.manual, "el equipo nuevo queda como manual");
assert.equal(acc.topo.links.at(-1).proto, "descripción");
acc = T.acceptSuggestion(acc.topo, sug[0]);
assert.equal(T.collectSuggestions(acc.topo, { descriptions: true }).length, 0, "confirmadas ya no se sugieren");

// ---------- Exportaciones con elementos manuales (escape) ----------

let e = { nodes: [], links: [] };
e = T.addManualNode(e, { name: '=cmd|"/c calc"!A1<b>&', ip: "192.0.2.60", platform: "<script>" }).topo;
e = T.addManualNode(e, { name: "end" }).topo;
const evil = e.nodes[0].id;
e = T.addManualLink(e, { a: evil, aPort: "Gi1/0/1", b: "end", bPort: "<x>" }).topo;
e.links.push({ a: evil, aPort: "Gi1/0/2", b: "end", bPort: "", proto: "BGP", logical: true });
const csv = T.toCsv(e);
assert.match(csv, /^"'=cmd\|""\/c calc""!A1<b>&"/m, "CSV: fórmula neutralizada y comillas duplicadas");
assert.match(csv, /"manual"$/m);
assert.match(csv, /"BGP lógica"$/m);
const mer = T.toMermaid(e);
assert.ok(!/<b>|<x>|"\/c/.test(mer), "Mermaid sin HTML ni comillas que cierren la etiqueta");
assert.match(mer, /n0 -\.-\|"Gi1\/0\/1 ↔ #lt;x#gt; \(manual\)"\| n1/);
assert.match(mer, /^ {2}n1\["end"\]$/m, "id por posición: 'end' no rompe la sintaxis");
const dio = T.toDrawio(e);
assert.ok(!/<b>|<x>|<script>/.test(dio), "draw.io escapado");
assert.match(dio, /value="=cmd\|&quot;\/c calc&quot;!A1&lt;b&gt;&amp;&#xa;192\.0\.2\.60"/);
assert.match(dio, /dashed=1;dashPattern=1\.5 4;/);
const svg = T.toSvg(e);
assert.ok(!/<b>|<x>|<script>/.test(svg), "SVG escapado");
assert.match(svg, /&lt;b&gt;&amp;/);
assert.match(svg, /Sesión BGP lógica/, "leyenda en el SVG exportado");
assert.match(svg, /stroke-dasharray="4 3"/, "equipo manual con borde punteado");

// ---------- Riesgo: todo comando que envía la herramienta es de consulta ----------

const sent = new Set([
  ...Object.values(T.NEIGHBOR_COMMANDS).flat(),
  ...Object.values(T.PORT_COMMANDS).flat(),
  ...Object.values(T.ROUTING_COMMANDS).flat(),
  ...Object.values(T.ADDRESS_COMMANDS).filter(Boolean),
  ...Object.values(T.FALLBACK_COMMANDS),
  T.junosDetailCommand("ge-0/0/0"),
]);
for (const cmd of sent) assert.equal(computeRisk(cmd), "read", cmd);
for (const cmd of ["show ip ospf neighbor", "show ip eigrp neighbors", "show ip bgp summary", "show bgp ipv4 unicast summary", "display ospf peer brief", "show ospf neighbor", "show ip interface brief", "display ip interface brief", "show interfaces terse"])
  assert.ok(sent.has(cmd), `falta ${cmd}`);

console.log("topology: ok");
