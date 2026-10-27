// Pruebas del resaltado por fabricante: `node scripts/tests/highlight.test.mjs` (Node 22.15+ con tipos TS).
// Cada caso es una línea real de salida y los tramos que deben quedar pintados, con el nombre de la
// regla que los pinta (el esquema del fabricante va antes que el común, como en la app).
import assert from "node:assert/strict";
import { fastEnough } from "./timing.mjs";

const { compile, effectiveRules, runs, schemes } = await import("../../src/lib/highlight.ts");

const rulesFor = (id) => compile(effectiveRules({ enabled: true, schemes: [id, "common"], custom: [] }));
/** Tramos pintados de una línea: [[texto, regla], ...]. */
function painted(line, rules) {
  return runs(line, rules).map(([s, e, i]) => [line.slice(s, e), rules[i].style]);
}
function expectSpans(id, line, want) {
  const rules = rulesFor(id);
  const got = runs(line, rules).map(([s, e]) => line.slice(s, e));
  for (const w of want) assert.ok(got.includes(w), `${id}: "${w}" sin pintar en ${JSON.stringify(line)} (pintado: ${JSON.stringify(got)})`);
}
function expectPlain(id, line, text) {
  const got = painted(line, rulesFor(id)).map(([t]) => t);
  assert.ok(!got.some((t) => t.includes(text)), `${id}: "${text}" no debería pintarse en ${JSON.stringify(line)} (pintado: ${JSON.stringify(got)})`);
}

// ---------- Cisco (IOS, IOS-XE, NX-OS, IOS-XR, ASA) ----------
expectSpans("cisco", "core-sw01#show interfaces status", ["core-sw01#"]);
expectSpans("cisco", "RP/0/RSP0/CPU0:xr01#show ipv4 interface brief", ["RP/0/RSP0/CPU0:xr01#"]);
expectSpans("cisco", "AppGigabitEthernet1/0/1 is up, line protocol is up", ["AppGigabitEthernet1/0/1", "up"]);
expectSpans("cisco", "port-channel10  1    eth  trunk  up      none", ["port-channel10"]);
expectSpans("cisco", "MgmtEth0/RSP0/CPU0/0  192.0.2.20  Up  Up  default", ["MgmtEth0/RSP0/CPU0/0", "192.0.2.20"]);
expectSpans("cisco", "FourHundredGigE0/0/0/0  unassigned  Shutdown  Down  default", ["FourHundredGigE0/0/0/0", "Down"]);
expectSpans("cisco", "*Oct 14 09:12:44: %LINK-3-UPDOWN: Interface GigabitEthernet1/0/3, changed state to down", ["%LINK-3-UPDOWN", "GigabitEthernet1/0/3", "down"]);
expectSpans("cisco", "%ASA-4-106023: Deny tcp src outside:198.51.100.7/443", ["%ASA-4-106023", "Deny"]);
// Una línea de salida que solo contiene "#" más adelante no es un prompt.
expectPlain("cisco", "  enlace #2 a core", "enlace #");

// ---------- Huawei VRP / H3C Comware ----------
expectSpans("huawei", "<HUAWEI>display interface brief", ["<HUAWEI>"]);
expectSpans("huawei", "MultiGE0/0/1  up  up", ["MultiGE0/0/1"]);
expectSpans("huawei", "Vbdif100  up  up", ["Vbdif100"]);
expectSpans("huawei", "Ten-GigabitEthernet1/0/49  DOWN", ["Ten-GigabitEthernet1/0/49", "DOWN"]);
expectSpans("huawei", "Bridge-Aggregation1  UP   2G(a)   F(a)   T    1", ["Bridge-Aggregation1"]);
expectSpans("huawei", "Vlan-interface10     UP   UP       192.0.2.1", ["Vlan-interface10"]);
expectSpans("huawei", "M-GigabitEthernet0/0/0  UP  UP  192.0.2.2", ["M-GigabitEthernet0/0/0"]);
expectSpans("huawei", "Oct 14 2026 09:12:44 HUAWEI %%01IFNET/4/LINK_STATE(l)[0]:The line protocol", ["%%01IFNET/4/LINK_STATE"]);
expectSpans("huawei", "%Oct 14 09:12:44:123 2026 H3C IFNET/3/PHY_UPDOWN: Physical state changed to down.", ["IFNET/3/PHY_UPDOWN"]);

// ---------- Fortinet (FortiGate, FortiSwitch, FortiAP, FortiExtender) ----------
expectSpans("fortinet", "S524DF4K15000024 # diagnose switch physical-ports summary", ["S524DF4K15000024 #"]);
expectSpans("fortinet", "   port1      up      1000-full     on", ["port1", "up"]);
expectSpans("fortinet", "        ==[wan1]", ["wan1"]);
expectSpans("fortinet", 'date=2026-10-14 level="warning" action="login" status="failed"', ['level="warning"']);
expectSpans("fortinet", 'date=2026-10-14 level="error" logdesc="Admin login failed"', ['level="error"']);
expectPlain("fortinet", "debug value 0x7fff", "x7");

// ---------- Aruba (AOS-CX, ArubaOS-Switch, ArubaOS) ----------
expectSpans("aruba", "core-cx(config-if)# no shutdown", ["core-cx(config-if)#", "no shutdown"]);
expectSpans("aruba", "1/1/48     --      routed  --       no      down    Administratively down", ["1/1/48", "down"]);
expectSpans("aruba", "lag1       10      trunk   --       yes     up      --", ["lag1", "up"]);
expectSpans("aruba", "2026-10-14T09:12:45 core-cx vsx-syncd[555]: Event|7911|LOG_ERR|AMM|-|VSX ISL is down", ["LOG_ERR", "down"]);
expectSpans("aruba", "  Trk1                | No        Yes     Down   1000FDx", ["Trk1", "Down"]);
expectSpans("aruba", "  1/A1     SFP+SR     | No        Yes     Up     10GigFD", ["1/A1"]);
expectSpans("aruba", "W 10/14/26 09:12:45 00077 ports: port 2 is now off-line", ["W"]);
expectSpans("aruba", "(Aruba7005) [mynode] (config) #ap-group default", ["(Aruba7005) [mynode] (config) #"]);
// Las fechas del log de ArubaOS-Switch no son puertos de AOS-CX.
expectPlain("aruba", "I 10/14/26 09:12:44 00076 ports: port 1 is now on-line", "10/14/26");

// ---------- Grandstream GWN78xx ----------
expectSpans("grandstream", "GWN7813# show interface brief", ["GWN7813#"]);
expectSpans("grandstream", "Ethernet 1/0/1    up      1000M-full   access  1", ["Ethernet 1/0/1", "up"]);
expectSpans("grandstream", "lag 1             up      2000M-full   trunk   1", ["lag 1"]);

// ---------- Check Point Gaia ----------
expectSpans("checkpoint", "[Expert@gw-01:0]# cphaprob state", ["[Expert@gw-01:0]#"]);
expectSpans("checkpoint", "gw-01:0> show interfaces all", ["gw-01:0>"]);
expectSpans("checkpoint", "1 (local)  192.0.2.1   100%   ACTIVE    gw-01", ["ACTIVE", "192.0.2.1"]);
expectSpans("checkpoint", "1 (local)  192.0.2.1   100%   ACTIVE(!)  gw-01", ["ACTIVE(!)"]);
expectSpans("checkpoint", "2          192.0.2.2   0%     STANDBY   gw-02", ["STANDBY"]);
expectSpans("checkpoint", "eth1-01  UP  10.1.1.1/24", ["eth1-01", "UP", "10.1.1.1/24"]);

// ---------- Todos los esquemas: patrones válidos y rápidos con líneas largas ----------
for (const sc of schemes) {
  const rules = rulesFor(sc.id);
  assert.equal(rules.length, sc.id === "common" ? sc.rules.length : sc.rules.length + schemes.find((x) => x.id === "common").rules.length, `${sc.id}: alguna regla no compila`);
  const long = "GigabitEthernet1/0/1 " + "a1/b2:c3 ".repeat(110);
  fastEnough(`resaltado ${sc.id} con línea larga`, 20, () => runs(long.slice(0, 999), rules));
}

console.log("highlight: ok");
