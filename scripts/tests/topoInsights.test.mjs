// Pruebas de revisiones, filtros, búsqueda, L2 desconocido y alcance de la topología:
// `node scripts/tests/topoInsights.test.mjs` (Node 22.15+ con tipos TS).
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { fastEnough } from "./timing.mjs";

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
const I = await import("../../src/lib/topoInsights.ts");

// ---------- Lectura de puertos: dúplex, VLAN, miembros de agregado y errores ----------
const STATUS = `
Port      Name               Status       Vlan       Duplex  Speed Type
Gi1/0/1   uplink-core        connected    trunk      a-full a-1000 10/100/1000BaseTX
Gi1/0/2   impresora piso 2   connected    10         a-full a-1000 10/100/1000BaseTX
Gi1/0/3                      notconnect   1            auto   auto 10/100/1000BaseTX
Gi1/0/4                      connected    20         a-full  a-100 10/100/1000BaseTX
Gi1/0/5                      connected    trunk      a-full a-1000 10/100/1000BaseTX
Gi1/0/6                      connected    trunk      a-full a-1000 10/100/1000BaseTX
Vl10                         connected    routed       auto   auto
sw1#`;
const ETHERCHANNEL = `
Group  Port-channel  Protocol    Ports
------+-------------+-----------+-----------------------------------------------
1      Po1(SU)         LACP      Gi1/0/5(D)  Gi1/0/6(P)
sw1#`;
const ERRORS = `
Port        Align-Err     FCS-Err    Xmit-Err     Rcv-Err  UnderSize  OutDiscards
Gi1/0/1             0           0           0           0          0            0
Gi1/0/6             0         152           0         152          0            0

Port      Single-Col  Multi-Col   Late-Col  Excess-Col  Carri-Sen      Runts     Giants
Gi1/0/1            0          0          0          77          0          0          0
sw1#`;
const ports = T.parsePortInfo([STATUS, ETHERCHANNEL, ERRORS]);
assert.deepEqual(
  { ...ports["gi1/0/1"] },
  { status: "connected", speed: "a-1000", desc: "uplink-core", vlan: "trunk", duplex: "a-full", crc: "0" },
);
assert.equal(ports["gi1/0/5"].lag, "D");
assert.equal(ports["gi1/0/6"].lag, "P");
assert.equal(ports["gi1/0/6"].crc, "152");
// La segunda tabla (colisiones) no pisa los FCS.
assert.equal(ports["gi1/0/1"].crc, "0");

const HUAWEI_BRIEF = `
Interface                   PHY   Protocol  InUti OutUti   inErrors  outErrors
GigabitEthernet0/0/1        up    up           0%     0%          12          0
GigabitEthernet0/0/2        down  down         0%     0%           0          0
<HW>`;
const hw = T.parsePortInfo([HUAWEI_BRIEF]);
assert.equal(hw["gi0/0/1"].inErr, "12");
assert.equal(hw["gi0/0/1"].status, "up/up");

// ---------- CDP/LLDP: VLAN nativa, dúplex y capacidades del vecino ----------
const cdp = (dev, ip, platform, caps, local, remote, extra = "") => `-------------------------
Device ID: ${dev}
Entry address(es):
  IP address: ${ip}
Platform: ${platform},  Capabilities: ${caps}
Interface: ${local},  Port ID (outgoing port): ${remote}
Holdtime : 150 sec
${extra}
`;
const SW1_CDP =
  cdp("sw2.lab", "10.0.0.2", "cisco WS-C2960X-48", "Switch IGMP", "GigabitEthernet1/0/1", "GigabitEthernet0/1", "Native VLAN: 10\nDuplex: half") +
  cdp("SEP001122334455", "10.0.0.50", "Cisco IP Phone 8845", "Host Phone Two-port Mac Relay", "GigabitEthernet1/0/4", "Port 1") +
  cdp("sw3", "192.168.1.5", "cisco C9300-48P", "Router Switch IGMP", "GigabitEthernet1/0/5", "TenGigabitEthernet1/1/1", "Native VLAN: 1\nDuplex: full") +
  cdp("sw3", "192.168.1.5", "cisco C9300-48P", "Router Switch IGMP", "GigabitEthernet1/0/6", "TenGigabitEthernet1/1/2", "Native VLAN: 1\nDuplex: full");
const n1 = T.parseNeighbors("cisco", [SW1_CDP]);
const sw2nb = n1.find((n) => n.name === "sw2.lab");
assert.equal(sw2nb.remoteNative, "10");
assert.equal(sw2nb.remoteDuplex, "half");
assert.equal(sw2nb.caps, "Switch IGMP");

const HUAWEI_LLDP = `GigabitEthernet0/0/1 has 1 neighbor(s):

Neighbor index : 1
Chassis type   :macAddress
Chassis ID     :00e0-fc12-3456
Port ID type   :interfaceName
Port ID        :GigabitEthernet0/0/24
System name    :core-hw
System description :Huawei Versatile Routing Platform Software VRP (R) software, Version 5.170 (S5720 V200R011C10SPC500)
System capabilities enabled   :bridge
Port VLAN ID(PVID)  :99
Management address  :10.0.0.9
`;
const hn = T.parseNeighbors("huawei", [HUAWEI_LLDP])[0];
assert.equal(hn.remoteNative, "99");
assert.equal(hn.caps, "bridge");

// ---------- Revisiones sobre enlaces ----------
let t = T.mergeNeighbors({ nodes: [], links: [] }, { name: "sw1", ip: "10.0.0.1", ports }, n1);
let checks = I.linkChecks(t);
const keyOf = (b, aPort) => T.linkKey(t.links.find((l) => (l.b === b || l.a === b) && (l.aPort === aPort || l.bPort === aPort)));
const kinds = (k) => (checks.get(k) ?? []).map((i) => `${i.kind}:${i.sev}`).sort();
// sw2 anuncia half dúplex; sw1 está en full.
assert.deepEqual(kinds(keyOf("sw2", "Gi1/0/1")), ["duplex:crit"]);
// Gi1/0/5 fuera del Po1; Gi1/0/6 con CRC.
assert.deepEqual(kinds(keyOf("sw3", "Gi1/0/5")), ["lag:crit"]);
assert.deepEqual(kinds(keyOf("sw3", "Gi1/0/6")), ["errors:warn"]);
assert.match(checks.get(keyOf("sw3", "Gi1/0/6"))[0].text, /152 errores CRC/);
// El teléfono: access (20) a 100 Mb/s, sin datos del otro lado: nada que comparar.
assert.equal(checks.get(keyOf("sep001122334455", "Gi1/0/4")), undefined);
// Asimetría: sw2 explorado sin informar a sw1.
t = T.mergeNeighbors(t, { name: "sw2" }, []);
checks = I.linkChecks(t);
assert.deepEqual(kinds(keyOf("sw2", "Gi1/0/1")), ["asym:warn", "duplex:crit"]);
// sw2 informa el enlace (y la VLAN nativa 1 de sw1): ya no hay asimetría, sí VLAN nativa distinta.
const SW2_CDP = cdp("sw1", "10.0.0.1", "cisco C9200L-24P", "Switch IGMP", "GigabitEthernet0/1", "GigabitEthernet1/0/1", "Native VLAN: 1\nDuplex: full");
t = T.mergeNeighbors(t, { name: "sw2" }, T.parseNeighbors("cisco", [SW2_CDP]));
checks = I.linkChecks(t);
assert.deepEqual(kinds(keyOf("sw2", "Gi1/0/1")), ["duplex:crit", "native:warn"]);
// Volver a leer sw1 conserva lo que anunció sw2 de su puerto (VLAN nativa 1 en Gi1/0/1).
t = T.mergeNeighbors(t, { name: "sw1", ip: "10.0.0.1", ports }, n1);
assert.equal(T.portOf(t.nodes.find((n) => n.id === "sw1"), "Gi1/0/1").native, "1");
assert.equal(I.worstSev(I.linkChecks(t).get(keyOf("sw2", "Gi1/0/1"))), "crit");

assert.equal(I.speedMbps("a-1000"), 1000);
assert.equal(I.speedMbps("10G"), 10000);
assert.equal(I.speedMbps("auto"), undefined);
assert.equal(I.normDuplex("a-half"), "half");

// ---------- Rol, fabricante y filtros ----------
const byId = (id) => t.nodes.find((n) => n.id === id);
assert.equal(I.nodeRole(byId("sw2")), "switch");
assert.equal(I.nodeRole(byId("sep001122334455")), "phone");
assert.equal(I.nodeRole({ name: "ap-01", platform: "cisco AIR-AP2802I-A-K9" }), "ap");
assert.equal(I.nodeRole({ name: "fw", platform: "FortiGate-100F" }), "firewall");
assert.equal(I.nodeRole({ name: "x", caps: "B,W" }), "ap");
assert.equal(I.nodeVendor(byId("sw3")), "cisco");
assert.equal(I.nodeVendor({ platform: "Huawei Versatile Routing Platform" }), "huawei");

const f = { ...I.NO_FILTER };
assert.equal(I.filterView(t, f), t);
assert.deepEqual(I.filterView(t, { ...f, roles: ["phone"] }).nodes.map((n) => n.id), ["sep001122334455"]);
const near = I.filterView(t, { ...f, hops: 1, focus: "sw2" });
assert.deepEqual(near.nodes.map((n) => n.id).sort(), ["sw1", "sw2"]);
assert.equal(near.links.length, 1);
assert.equal(I.filterView(t, { ...f, states: ["pendiente"] }).links.length, 0);

// ---------- Búsqueda ----------
assert.deepEqual(I.searchTopo(t, "10.0.0.2").map((h) => [h.id, h.what]), [["sw2", "IP"]]);
assert.deepEqual(I.searchTopo(t, "GigabitEthernet1/0/5").map((h) => [h.id, h.what]), [["sw1", "interfaz"]]);
assert.equal(I.searchTopo(t, "sw")[0].what, "nombre");
assert.equal(I.searchTopo(t, "sw2")[0].id, "sw2");
assert.deepEqual(I.searchTopo(t, "impresora").map((h) => h.id), ["sw1"]);
assert.deepEqual(I.searchTopo(t, "x"), []);
const withMac = {
  ...t,
  nodes: t.nodes.map((n) => (n.id === "sw1" ? { ...n, macs: { "gi1/0/2": { port: "Gi1/0/2", total: 1, macs: [{ mac: "a0b1.c2d3.e4f5", vendor: "HP" }] } } } : n)),
};
assert.deepEqual(I.searchTopo(withMac, "A0:B1:C2:D3:E4:F5").map((h) => [h.id, h.what, h.detail]), [["sw1", "MAC", "a0b1.c2d3.e4f5 en Gi1/0/2"]]);

// ---------- Puertos activos sin vecino ----------
const l2 = I.unknownL2(withMac);
// Gi1/0/2 está activo sin vecino (y tiene una MAC HP); Gi1/0/3 está caído, Vl10 es lógica.
assert.deepEqual(l2.get("sw1"), { ports: ["Gi1/0/2"], macs: 1, vendors: ["HP"] });
assert.equal(l2.has("sw2"), false);

// ---------- Alcance ----------
assert.equal(I.parseCidrs("10.0.0.0/8, 192.168.1.0/24").ranges.length, 2);
assert.match(I.parseCidrs("10.0.0.0/33").error, /no válida/);
assert.equal(I.inRanges("10.200.1.1", I.parseCidrs("10.0.0.0/8").ranges), true);
const empty = { nodes: [], links: [] };
let sc = I.scopeNeighbors(empty, "sw1", n1, { skipEndpoints: true, cidrs: "", maxDepth: 0 });
assert.deepEqual(sc.kept.map((n) => n.name).sort(), ["sw2.lab", "sw3", "sw3"]);
assert.match(sc.skipped[0], /SEP001122334455 \(teléfono\)/);
sc = I.scopeNeighbors(empty, "sw1", n1, { skipEndpoints: false, cidrs: "10.0.0.0/24", maxDepth: 0 });
assert.deepEqual(sc.kept.map((n) => n.name).sort(), ["SEP001122334455", "sw2.lab"]);
// Un equipo que ya está en el diagrama no se descarta.
sc = I.scopeNeighbors(t, "sw1", n1, { skipEndpoints: true, cidrs: "10.0.0.0/24", maxDepth: 0 });
assert.equal(sc.skipped.length, 0);
// Profundidad: sw2 está a 1 salto de sw1; con tope 1, sus vecinos nuevos quedan fuera.
sc = I.scopeNeighbors(t, "sw2", [{ name: "sw9", localPort: "Gi0/2", remotePort: "Gi0/1", proto: "CDP" }], { skipEndpoints: false, cidrs: "", maxDepth: 1 });
assert.deepEqual(sc.kept, []);
assert.match(sc.skipped[0], /más de 1 saltos/);

// ---------- Rendimiento: 2000 equipos y 4000 enlaces ----------
const big = { nodes: [], links: [] };
for (let i = 0; i < 2000; i++) {
  big.nodes.push({ id: `n${i}`, name: `n${i}`, ip: `10.${i >> 8}.${i & 255}.1`, explored: true, x: i, y: i, platform: "cisco C9300", ports: { "gi1/0/1": { status: "connected", duplex: "full", speed: "1000" }, "gi1/0/2": { status: "connected" } } });
  if (i) big.links.push({ a: `n${i - 1}`, aPort: "Gi1/0/1", b: `n${i}`, bPort: "Gi1/0/1", proto: "CDP", seenBy: [`n${i - 1}`] });
  if (i > 1) big.links.push({ a: `n${i - 2}`, aPort: "Gi1/0/3", b: `n${i}`, bPort: "Gi1/0/4", proto: "LLDP" });
}
fastEnough("revisiones 4000 enlaces", 40, () => I.linkChecks(big));
fastEnough("filtro a 3 saltos", 40, () => I.filterView(big, { ...I.NO_FILTER, roles: ["switch"], hops: 3, focus: "n1000" }));
fastEnough("búsqueda en 2000 equipos", 40, () => I.searchTopo(big, "gi1/0/9"));
fastEnough("L2 desconocido", 40, () => I.unknownL2(big));

console.log("topoInsights: ok");
