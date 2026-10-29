// Pruebas de "Saltar desde X" en pestaña propia (src/lib/hopTab.ts), la rueda del mapa
// (src/lib/mapZoom.ts) y las lecturas de tráfico por consola que no deben enviar a ciegas.
// Direcciones de documentación (RFC 5737) y nombres ficticios.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

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

const H = await import("../../src/lib/hopTab.ts");
const T = await import("../../src/lib/topology.ts");
const R = await import("../../src/lib/topoTraffic.ts");
const Z = await import("../../src/lib/mapZoom.ts");
const { atPrompt } = await import("../../src/lib/cliText.ts");

// ---------- Pantalla: prompt o pregunta ----------

const kind = (t) => H.classifyHopScreen(t).kind;
assert.deepEqual(H.classifyHopScreen("banner\r\ncore-sw01#"), { kind: "prompt", name: "core-sw01" });
assert.deepEqual(H.classifyHopScreen("<ar-wan01>"), { kind: "prompt", name: "ar-wan01" });
assert.equal(kind("Password: "), "password");
assert.equal(kind("Enter password:"), "password");
assert.equal(kind("Please input the password:"), "password");
assert.equal(kind("Username:"), "username");
assert.equal(kind("Please input the username:"), "username");
assert.equal(kind("core-sw01 login:"), "username");
assert.equal(kind("Authorized access only. Banner"), "none");
assert.equal(kind(" --More-- "), "none", "el paginador no es un prompt");
assert.equal(kind(""), "none");
assert.deepEqual(H.classifyHopScreen("Are you sure you want to continue connecting (yes/no/[fingerprint])? "), {
  kind: "hostkey",
  line: "Are you sure you want to continue connecting (yes/no/[fingerprint])?",
  answer: "yes",
});
assert.equal(H.classifyHopScreen("The server is not authenticated. Continue to access it? [Y/N]:").answer, "y", "Huawei contesta y");

// ---------- Eco y errores ----------

assert.equal(H.afterEcho("core#ssh -l noc 192.0.2.11\r\nPassword: ", "ssh -l noc 192.0.2.11"), "Password: ");
assert.equal(H.afterEcho("core#ssh -l noc 192.0.2.11", "ssh -l noc 192.0.2.11"), "", "sin salto de línea aún");
assert.equal(H.afterEcho("sin eco\nPassword:", "ssh x"), "sin eco\nPassword:");
assert.equal(H.afterEcho("core#telnet 192.0.2.5\nconnection refused\ncore#telnet 192.0.2.5\r\nTrying", "telnet 192.0.2.5"), "Trying", "el último intento");
assert.match(H.hopError("% Connection refused by remote host"), /conexión rechazada/);
assert.match(H.hopError("% Connection timed out; remote host not responding"), /tiempo de espera/);
assert.match(H.hopError("ssh: connect to host 192.0.2.9 port 22: No route to host"), /sin ruta/);
assert.match(H.hopError("Permission denied, please try again."), /autenticación/);
assert.match(H.hopError("[Connection to 192.0.2.5 closed by foreign host]"), /cerró/);
assert.equal(H.hopError("dist-sw01 uptime is 3 weeks"), null);

// ---------- Sesión de la pestaña de salto ----------

const base = { id: "s1", name: "core-sw01", type: "ssh", host: "192.0.2.1", port: 2222, username: "noc", identity_file: "~/.ssh/id", jump_host: "198.51.100.9", legacy_ssh: true, save_password: true, on_connect: "terminal length 0", auto_reconnect: true, created_at: "x" };
const hs = H.hopTabSession(base, H.hopTabTitle("dist-sw01", "core-sw01"));
assert.equal(hs.name, "dist-sw01 vía core-sw01");
assert.deepEqual([hs.id, hs.host, hs.port, hs.username, hs.identity_file, hs.jump_host, hs.legacy_ssh, hs.save_password], ["s1", "192.0.2.1", 2222, "noc", "~/.ssh/id", "198.51.100.9", true, true], "misma sesión y credenciales");
assert.deepEqual([hs.on_connect, hs.auto_reconnect], [undefined, false]);
assert.equal(base.on_connect, "terminal length 0", "la sesión original no cambia");
assert.ok(H.isReplayable({ type: "ssh" }) && H.isReplayable({ type: "telnet" }));
assert.ok(!H.isReplayable({ type: "serial" }) && !H.isReplayable({ type: "local" }));

// ---------- Flujo: esperar el prompt, enviar, preguntas ----------

const cmd = T.hopCommand("cisco", "iosxe", "ssh", "noc", "192.0.2.11");
assert.equal(cmd, "ssh -l noc 192.0.2.11");
const run = (job, frames, t0 = 0) => {
  // frames: [ms desde el inicio, pantalla]; devuelve las acciones en orden.
  const acts = [];
  for (const [ms, screen] of frames) {
    const r = H.stepHop(job, screen, t0 + ms);
    job = r.job;
    acts.push(...r.actions.map((a) => ({ ...a, ms })));
  }
  return { job, acts };
};
const fresh = (pivot = "core-sw01") => H.newHopJob({ cmd, neighbor: "dist-sw01", pivot, now: 0 });

// Nada se envía mientras el pivote no muestra su prompt (login, contraseña, banner).
let r = run(fresh(), [
  [0, ""],
  [400, "Connecting to 192.0.2.1..."],
  [800, "noc@192.0.2.1's password: "],
  [1200, "noc@192.0.2.1's password: "],
  [5000, "Last login: x\r\n --More-- "],
]);
assert.equal(r.acts.filter((a) => a.kind === "send").length, 0, "no se envía a ciegas");
assert.equal(r.acts.filter((a) => a.kind === "notify").length, 1, "un aviso de autenticación, una vez");
assert.equal(r.job.phase, "await-prompt");

// Con el prompt, se espera a que se estabilice y se envía una sola vez.
const prompt = "Welcome\r\ncore-sw01#";
r = run(fresh(), [
  [0, ""],
  [400, prompt],
  [800, prompt],
  [1100, prompt],
  [1500, prompt],
  [1900, prompt],
]);
const sends = r.acts.filter((a) => a.kind === "send");
assert.equal(sends.length, 1);
assert.equal(sends[0].data, "ssh -l noc 192.0.2.11\r");
assert.ok(sends[0].ms >= 400 + H.PROMPT_STABLE_MS, "después de PROMPT_STABLE_MS sin cambios");
assert.equal(r.job.phase, "sent");

// Un redibujo que cambia la pantalla reinicia la espera.
r = run(fresh(), [[0, "x\ncore-sw01#"], [300, "x\ncore-sw01#"], [500, "x\ny\ncore-sw01#"], [900, "x\ny\ncore-sw01#"]]);
assert.equal(r.acts.filter((a) => a.kind === "send").length, 0);

// Otro prompt (otro equipo): no se envía, se avisa y vence con un mensaje claro.
r = run(fresh("core-sw01"), [[0, "ar-wan01#"], [1000, "ar-wan01#"], [2000, "ar-wan01#"], [H.PROMPT_WAIT_MS + 1, "ar-wan01#"]]);
assert.equal(r.acts.filter((a) => a.kind === "send").length, 0);
assert.ok(r.acts.some((a) => a.kind === "notify" && /ar-wan01/.test(a.text) && /core-sw01/.test(a.text)));
const timeout = r.acts.find((a) => a.kind === "fail");
assert.match(timeout.reason, /No apareció el prompt de core-sw01/);
assert.match(timeout.reason, /no se envió el salto a dist-sw01/);
assert.equal(r.job.phase, "failed");

// Sin prompt conocido del pivote, sirve el primero que aparezca y queda registrado.
r = run(H.newHopJob({ cmd, neighbor: "dist-sw01", now: 0 }), [[0, "sw-x>"], [700, "sw-x>"]]);
assert.equal(r.job.pivot, "sw-x");

// Pregunta de la llave: se le pregunta al usuario una sola vez (no se contesta sola).
const sentJob = (j) => ({ ...j, phase: "sent", sentAt: 1000, pivot: "core-sw01", tail: "", changedAt: 1000 });
const echo = "core-sw01#ssh -l noc 192.0.2.11\r\n";
r = run(sentJob(fresh()), [
  [1500, `${echo}Are you sure you want to continue connecting (yes/no)? `],
  [1900, `${echo}Are you sure you want to continue connecting (yes/no)? `],
]);
assert.equal(r.acts.filter((a) => a.kind === "ask").length, 1);
assert.equal(r.acts.filter((a) => a.kind === "send").length, 0, "nunca se contesta sola");

// Usuario y contraseña del vecino: los escribe el usuario; solo se avisa.
r = run(sentJob(fresh()), [[1500, `${echo}Password: `], [1900, `${echo}Password: `]]);
assert.equal(r.acts.filter((a) => a.kind === "notify" && /contraseña de dist-sw01/.test(a.text)).length, 1);
assert.ok(!r.acts.some((a) => a.kind === "send" || a.kind === "ask"));
assert.equal(r.job.phase, "sent");

// Éxito: el prompt es de otro equipo y está quieto.
r = run(sentJob(fresh()), [[1500, `${echo}Password: `], [2500, `${echo}Password: \r\nBanner\r\ndist-sw01#`], [2600, `${echo}Password: \r\nBanner\r\ndist-sw01#`], [3300, `${echo}Password: \r\nBanner\r\ndist-sw01#`]]);
assert.deepEqual(r.acts.filter((a) => a.kind === "done").map((a) => a.at), ["dist-sw01"]);
assert.equal(r.job.phase, "done");

// Rechazo: vuelve el prompt del pivote con el error.
r = run(sentJob(fresh()), [[1500, `${echo}% Connection refused by remote host\r\ncore-sw01#`]]);
assert.match(r.acts.find((a) => a.kind === "fail").reason, /conexión rechazada/);
// Tiempo agotado: error sin prompt, con la pantalla quieta.
r = run(sentJob(fresh()), [[1500, `${echo}Trying 192.0.2.11 ...`], [2000, `${echo}Trying 192.0.2.11 ...\r\n% Connection timed out; remote host not responding`], [4000, `${echo}Trying 192.0.2.11 ...\r\n% Connection timed out; remote host not responding`]]);
assert.match(r.acts.find((a) => a.kind === "fail").reason, /tiempo de espera/);
// Sin respuesta ni error: vence por inactividad.
r = run(sentJob(fresh()), [[1500, `${echo}Trying 192.0.2.11 ...`], [1500 + H.HOP_IDLE_MS + 10, `${echo}Trying 192.0.2.11 ...`]]);
assert.match(r.acts.find((a) => a.kind === "fail").reason, /no respondió/);
// Volvió al pivote sin error ni entrar al vecino.
r = run(sentJob(fresh()), [[1500, `${echo}core-sw01#`], [3200, `${echo}core-sw01#`]]);
assert.match(r.acts.find((a) => a.kind === "fail").reason, /volvió a core-sw01/);
// Un trabajo terminado no vuelve a actuar.
assert.deepEqual(H.stepHop(r.job, "core-sw01#", 9e9).actions, []);

// Huawei: stelnet, usuario y contraseña en el equipo.
const hw = T.hopCommand("huawei", "vrp8", "ssh", "", "192.0.2.21");
assert.equal(hw, "stelnet 192.0.2.21");
r = run(H.newHopJob({ cmd: hw, neighbor: "ar-sur01", pivot: "ar-wan01", now: 0 }), [[0, "<ar-wan01>"], [700, "<ar-wan01>"]]);
assert.equal(r.acts.find((a) => a.kind === "send").data, "stelnet 192.0.2.21\r");

// ---------- Rueda del mapa ----------

const w = (o) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, shiftKey: false, ctrlKey: false, metaKey: false, ...o });
for (const dy of [100, -100, 4.000244140625 * 3, 12, 3, 7.3, 1, -250]) assert.equal(Z.wheelIntent(w({ deltaY: dy })), "zoom", `rueda ${dy}`);
assert.equal(Z.wheelIntent(w({ deltaY: -5, ctrlKey: true })), "pinch");
assert.equal(Z.wheelIntent(w({ deltaY: -5, metaKey: true })), "pinch");
assert.equal(Z.wheelIntent(w({ deltaY: 100, shiftKey: true })), "pan");
assert.equal(Z.wheelIntent(w({ deltaX: 30, deltaY: 4 })), "pan", "deslizar de lado");
assert.ok(Z.wheelFactor({ deltaY: -100, deltaMode: 0 }, false) > 1.15 && Z.wheelFactor({ deltaY: -100, deltaMode: 0 }, false) < 1.17, "un paso de rueda: 16 %");
assert.ok(Z.wheelFactor({ deltaY: 100, deltaMode: 0 }, false) < 1);
assert.ok(Z.wheelFactor({ deltaY: -1e6, deltaMode: 0 }, false) < 1.6, "con tope");
assert.ok(Z.wheelFactor({ deltaY: -3, deltaMode: 1 }, false) > 1.1, "por líneas");

// ---------- Tráfico por consola: pestaña del equipo y prompt ----------

assert.ok(atPrompt("core-sw01#show interfaces\r\ncore-sw01#   \r\n\r\n"));
assert.ok(atPrompt(undefined), "sin lectura de pantalla no se bloquea");
assert.ok(!atPrompt("Gi1/0/1 is up\r\n --More-- "), "el paginador come el primer carácter");
assert.ok(!atPrompt("noc@192.0.2.1's password: "));
assert.ok(!atPrompt("core-sw01#show int"), "comando del usuario a medias");

const node = (id, ip) => ({ id, name: id, ip, explored: true, x: 0, y: 0 });
const tabs = [
  { connId: "c1", name: "core-sw01", host: "192.0.2.1" },
  { connId: "c2", name: "dist-sw01 vía core-sw01", host: "192.0.2.1" },
];
assert.equal(R.terminalFor(node("core-sw01", "192.0.2.1"), tabs, {})?.connId, "c1");
assert.equal(R.terminalFor(node("dist-sw01", "192.0.2.11"), tabs, { "dist-sw01": "c2" })?.connId, "c2", "el equipo alcanzado por salto se lee por esa pestaña");
assert.equal(R.terminalFor(node("core-sw01", "192.0.2.1"), tabs.slice(1), { "dist-sw01": "c2" }), undefined, "la pestaña de salto no es la del pivote");
assert.equal(R.terminalFor(node("core-sw01", "192.0.2.1"), tabs.slice(1), {})?.connId, "c2", "sin salto en curso vuelve a ser la del pivote");

// ---------- Contadores con el rastro del paginador ----------

const page = (erase) => `core#show interfaces\r\nGigabitEthernet1/0/1 is up, line protocol is up\r\n  Full-duplex, 1000Mb/s, media type is X\r\n 10 packets input, 100 bytes, 0 no buffer\r\n 20 packets output, 200 bytes, 0 underruns\r\n --More-- ${erase}GigabitEthernet1/0/2 is up, line protocol is up\r\n  Full-duplex, 1000Mb/s, media type is X\r\n 11 packets input, 111 bytes, 0 no buffer\r\n 22 packets output, 222 bytes, 0 underruns\r\ncore#`;
for (const erase of ["\r         \r", "\b\b\b\b\b\b\b\b\b         \b\b\b\b\b\b\b\b\b", "\x1b[K"]) {
  const c = R.parseCliCounters(page(erase));
  assert.deepEqual([...c.keys()], ["gi1/0/1", "gi1/0/2"], "la interfaz que abre la página no se pierde");
  assert.equal(c.get("gi1/0/1").outOctets, 200n, "y sus contadores no se atribuyen a la anterior");
  assert.equal(c.get("gi1/0/2").inOctets, 111n);
}
// Dos lecturas separadas por el intervalo dan la tasa por sentido (1000 Mb/s, +30 MB en 30 s).
const rd = (a, b, ts) => ({ inOctets: a, outOctets: b, bits: 64, speed: 1e9, ts });
const rate = R.portRate(rd(1_000_000_000n, 2_000_000_000n, 0), rd(1_030_000_000n, 2_075_000_000n, 30_000));
assert.deepEqual([rate.inBps, rate.outBps], [8e6, 20e6]);
console.log("hopTab: ok");
