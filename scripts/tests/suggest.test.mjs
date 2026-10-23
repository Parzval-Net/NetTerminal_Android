// Pruebas de las sugerencias de comandos: `node scripts/tests/suggest.test.mjs` (Node 22.15+ con tipos TS).
// Usa el catálogo incluido (src/packs/*.json) y mide el tiempo de búsqueda sobre todas las plataformas.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";

// suggest.ts y packs.ts importan sin extensión (como lo resuelve Vite): se completa con .ts.
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

const S = await import("../../src/lib/suggest.ts");
const { buildCatalog, validatePack, computeRisk } = await import("../../src/lib/packs.ts");

// ---------- Catálogo incluido, igual que builtinPacks.ts ----------

const dir = new URL("../../src/packs/", import.meta.url);
const packs = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => {
    const r = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    const id = f.replace(/\.json$/, "");
    return validatePack({ format: "netterminal-commands", formatVersion: 1, id: `builtin-${id}`, name: r.name, vendor: id, vendorName: r.name, detectCommand: r.detectCommand, platforms: r.platforms ?? [], commands: r.commands }).pack;
  })
  .filter(Boolean);
const catalog = buildCatalog(packs, []);
const platforms = catalog.flatMap((v) => v.platforms.map((p) => p.id));
assert.ok(platforms.includes("iosxe") && platforms.includes("vrp8"));

// Ayudantes: un prompt de Cisco y teclas como las entrega term.onData.
const tail = (t) => () => t;
function atPrompt() {
  const t = new S.InputTracker();
  t.output("\r\ncore-sw01#", tail("\ncore-sw01#"));
  assert.equal(t.active, true);
  return t;
}
const type = (t, s) => {
  for (const ch of s) t.input(ch);
};

// ---------- Estado de la línea: sincronía ----------

{
  const t = new S.InputTracker();
  assert.equal(t.active, false, "sin prompt no se sugiere");
  t.input("s");
  assert.equal(t.active, false, "lo tecleado antes del prompt no activa nada por sí solo");
}
{
  const t = atPrompt();
  type(t, "show ver");
  assert.equal(t.buf, "show ver");
  // El eco del equipo (sin saltos de línea) no corta el seguimiento.
  t.output("show ver", tail("core-sw01#show ver"));
  assert.equal(t.active, true);
  t.input("\x7f");
  t.input("\x7f");
  assert.equal(t.buf, "show v");
  t.input("\r");
  assert.equal(t.buf, "", "Enter limpia");
  assert.equal(t.active, false, "tras Enter se espera el próximo prompt");
  t.output("\r\nCisco IOS XE Software\r\ncore-sw01#", tail("Cisco IOS XE Software\ncore-sw01#"));
  assert.equal(t.active, true, "vuelve con el prompt");
  assert.equal(t.buf, "");
}
// Teclas de control y navegación: desincronizan hasta el próximo prompt.
for (const [name, key] of [
  ["flecha izquierda", "\x1b[D"],
  ["flecha derecha", "\x1b[C"],
  ["flecha arriba", "\x1b[A"],
  ["Inicio", "\x1b[H"],
  ["Fin", "\x1b[F"],
  ["Ctrl+A", "\x01"],
  ["Ctrl+E", "\x05"],
  ["Ctrl+U", "\x15"],
  ["Ctrl+W", "\x17"],
  ["Ctrl+R", "\x12"],
  ["Tab", "\t"],
  ["Esc", "\x1b"],
  ["Ctrl+C", "\x03"],
  ["pegado", "show clock"],
  ["pegado entre corchetes", "\x1b[200~show clock\x1b[201~"],
]) {
  const t = atPrompt();
  type(t, "sh");
  t.input(key);
  assert.equal(t.active, false, `${name} desincroniza`);
  assert.equal(t.buf, "", `${name} vacía el búfer`);
  // Un "#" tecleado o escrito en el eco no se confunde con un prompt nuevo.
  t.input("#");
  t.output("sh#", tail("core-sw01#sh#"));
  assert.equal(t.active, false, `${name}: un # en la misma línea no es prompt`);
  // El próximo prompt (tras un salto de línea) vuelve a habilitar.
  t.output("\r\ncore-sw01#", tail("\ncore-sw01#"));
  assert.equal(t.active, true, `${name}: vuelve con el prompt`);
}
// ---------- Re-sincronía ----------

// Salida que redibuja la línea (mensaje de syslog con "logging synchronous"): vuelve sola.
{
  const t = atPrompt();
  type(t, "show ip");
  t.output("\r\n%LINK-3-UPDOWN: Interface Gi1/0/3, changed state to down\r\n", tail("down\n"));
  assert.equal(t.active, false, "el mensaje asíncrono corta la sincronía");
  assert.equal(t.canResync, true, "lo tecleado sigue conocido");
  t.output("core-sw01#show ip", tail("down\ncore-sw01#show ip"));
  assert.equal(t.active, true, "la línea redibujada con prompt + lo tecleado re-sincroniza");
  assert.equal(t.buf, "show ip");
  type(t, " int");
  assert.equal(t.buf, "show ip int");
}
// Mensaje que redibuja la línea con otro contenido: no re-sincroniza.
{
  const t = atPrompt();
  type(t, "show ip");
  t.output("\r\n%SYS-5-CONFIG_I: Configured from console\r\ncore-sw01#show i", tail("console\ncore-sw01#show i"));
  assert.equal(t.active, false);
  // La terminal confirma con la línea real (por ejemplo tras borrar con "\b \b").
  assert.equal(t.resync("core-sw01#show i"), false);
  assert.equal(t.resync("core-sw01#show ip"), true, "la pantalla confirma prompt + lo tecleado");
}
// Prompt que llega después de teclear (typeahead): se recupera si la línea termina con lo tecleado.
{
  const t = atPrompt();
  type(t, "terminal length 0\r");
  type(t, "sh ver");
  assert.equal(t.active, false);
  t.output("\r\ncore-sw01#", tail("\ncore-sw01#"));
  assert.equal(t.active, false, "el prompt sin el eco todavía no basta");
  t.output("sh ver", tail("\ncore-sw01#sh ver"));
  assert.equal(t.active, true, "con el eco tras el prompt se sincroniza");
  assert.equal(t.buf, "sh ver");
}
{
  // Prompt y eco en el mismo bloque.
  const t = atPrompt();
  type(t, "\r");
  type(t, "dis cl");
  t.output("\r\n<HUAWEI>dis cl", tail("\n<HUAWEI>dis cl"));
  assert.equal(t.active, true);
  assert.equal(t.buf, "dis cl");
}
{
  // Tecla de control antes del prompt: lo tecleado es desconocido, no se adivina.
  const t = atPrompt();
  type(t, "\r");
  type(t, "sh");
  t.input("\x1b[A");
  type(t, "ow");
  t.output("\r\ncore-sw01#show", tail("\ncore-sw01#show"));
  assert.equal(t.active, false, "tras una flecha no se re-sincroniza con texto desconocido");
}
// Desplazamiento horizontal de IOS ("$") y caracteres anchos en el prompt.
{
  assert.equal(S.endsWithTyped("core-sw01#$terface brief", "show ip interface brief"), true);
  assert.equal(S.atPrompt("core-sw01#$terface brief", "show ip interface brief"), true);
  assert.equal(S.endsWithTyped("core-sw01#$rief", "show ip interface brief"), true);
  assert.equal(S.endsWithTyped("core-sw01#$xyz", "show ip interface brief"), false);
  assert.equal(S.atPrompt("用户@主机:~$ ip a", "ip a"), true, "prompt con caracteres anchos");
  assert.equal(S.atPrompt("Building configuration... ip a", "ip a"), false);
  const t = atPrompt();
  type(t, "show ip interface brief");
  t.output("\r\n", tail("\n"));
  assert.equal(t.resync("core-sw01#$terface brief"), true);
}
// Línea demasiado larga: se deja de seguir.
{
  const t = atPrompt();
  type(t, "x".repeat(300));
  assert.equal(t.active, false);
}

// ---------- Credenciales: nunca se sigue ----------

{
  // Contraseña tecleada antes de que aparezca el pedido: se descarta al verlo.
  const t = atPrompt();
  type(t, "enable\r");
  type(t, "Secreto123");
  t.output("\r\nPassword: ", tail("\nPassword: "));
  assert.equal(t.cred, true);
  assert.equal(t.buf, "", "lo tecleado se borra al aparecer el pedido de credenciales");
  assert.equal(t.resync("Password: Secreto123"), false, "con credenciales no se re-sincroniza");
  type(t, "#");
  assert.equal(t.buf, "");
}

for (const prompt of ["Password:", "Password: ", "Enter passphrase for key '/home/u/.ssh/id_ed25519':", "[sudo] password for admin:", "Username:", "login:", "Contraseña:"]) {
  const t = new S.InputTracker();
  t.output(`\r\n${prompt}`, tail(`\n${prompt}`));
  assert.equal(t.cred, true, `credenciales: ${prompt}`);
  assert.equal(t.active, false);
  type(t, "secreto#");
  assert.equal(t.buf, "", "la contraseña no se guarda");
  // Ni aunque lo tecleado termine en algo con pinta de prompt.
  t.output("", tail(`\n${prompt}`));
  assert.equal(t.active, false);
}
{
  // Una contraseña cuyo eco oculto deja un prompt "#" en pantalla tras el salto de línea sí vuelve.
  const t = new S.InputTracker();
  t.output("\r\nPassword:", tail("\nPassword:"));
  type(t, "abc\r");
  t.output("\r\nrouter#", tail("\nrouter#"));
  assert.equal(t.cred, false);
  assert.equal(t.active, true);
  assert.equal(t.buf, "");
}

// ---------- Índice y búsqueda ----------

const ios = S.getIndex(catalog, "iosxe");
assert.ok(ios && ios.entries.length > 50);
assert.equal(S.getIndex(catalog, "iosxe"), ios, "el índice queda en caché");
assert.equal(S.getIndex(catalog, "no-existe"), null, "plataforma desconocida: nada");
for (let i = 1; i < ios.entries.length; i++) assert.ok(ios.entries[i - 1].key <= ios.entries[i].key, "índice ordenado");
assert.ok(ios.entries.every((e) => !/[\r\n]/.test(e.cmd)), "sin comandos de varias líneas");

{
  const g = S.ghostFor(ios, "show ver");
  assert.ok(g, "show ver tiene sugerencia");
  assert.equal(g.entry.risk, "read");
  assert.ok(("show ver" + g.rest).startsWith("show version"));
  assert.equal(S.ghostFor(ios, "s"), null, "un carácter no basta para el texto gris");
  assert.ok(S.ghostFor(ios, "SHOW VER"), "sin distinguir mayúsculas");
  assert.equal(S.ghostFor(ios, "zzzz"), null);
}
// Lista: máximo 8, todas empiezan con lo tecleado, en el orden del catálogo.
{
  const list = S.lookup(ios, "show ", 8);
  assert.equal(list.length, 8);
  for (const e of list) assert.ok(e.key.startsWith("show "));
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].order <= list[i].order);
  const all = ios.entries.filter((e) => e.key.startsWith("show ")).sort((a, b) => a.order - b.order);
  assert.deepEqual(list, all.slice(0, 8), "son las 8 primeras del catálogo");
  assert.equal(S.lookup(ios, "", 8).length, 8, "con la línea vacía también lista");
}

// ---------- Marcadores: se inserta hasta el marcador ----------

{
  assert.deepEqual(S.insertablePart("show interfaces {{interfaz}} status"), { insert: "show interfaces ", placeholder: true });
  assert.deepEqual(S.insertablePart("display interface <interfaz>"), { insert: "display interface ", placeholder: true });
  assert.deepEqual(S.insertablePart("show clock"), { insert: "show clock", placeholder: false });
  const withVar = ios.entries.find((e) => e.placeholder && e.risk === "read");
  assert.ok(withVar, "el catálogo tiene consultas con variables");
  const typed = withVar.insert.slice(0, 4);
  const rest = S.remainderToInsert(withVar, typed);
  assert.equal(typed + rest, withVar.insert, "inserta justo hasta el marcador");
  assert.ok(!/\{\{|</.test(rest));
  assert.equal(S.remainderToInsert(withVar, withVar.insert), "", "en el marcador no inserta nada más");
  // Más allá del marcador ya no coincide.
  assert.ok(!S.lookup(ios, withVar.insert + "{{", 50).includes(withVar));
  const g = S.ghostFor(ios, withVar.insert.slice(0, withVar.insert.length - 1));
  if (g && g.entry === withVar) assert.ok(!g.insert.includes("{"));
}

// ---------- Riesgo: lo que cambia o corta servicio nunca va en gris ----------

let ghosts = 0;
for (const p of platforms) {
  const idx = S.getIndex(catalog, p);
  for (const e of idx.entries) {
    // Cada prefijo de cada comando del catálogo.
    for (let n = S.GHOST_MIN; n < e.cmd.length; n++) {
      const g = S.ghostFor(idx, e.cmd.slice(0, n));
      if (!g) continue;
      ghosts++;
      assert.equal(g.entry.risk, "read", `${p}: ${g.entry.cmd} no es consulta`);
      assert.equal(computeRisk(g.entry.cmd), "read", `${p}: computeRisk(${g.entry.cmd})`);
    }
  }
}
assert.ok(ghosts > 1000);
{
  // reload, write erase y shutdown aparecen en la lista con su riesgo, pero nunca en gris.
  for (const [p, q] of [["iosxe", "reload"], ["iosxe", "write erase"], ["vrp8", "reboot"], ["junos", "request system reboot"]]) {
    const idx = S.getIndex(catalog, p);
    const listed = S.lookup(idx, q, 8);
    const g = S.ghostFor(idx, q.slice(0, -1));
    assert.ok(!g || g.entry.risk === "read", `${q} no va en gris`);
    for (const e of listed) if (e.key.startsWith(q)) assert.notEqual(e.risk, "read", `${q} lleva riesgo`);
  }
  // Un pack que declara "reload" como consulta: el índice usa el riesgo calculado.
  const evil = validatePack({ format: "netterminal-commands", formatVersion: 1, id: "evil", name: "x", vendor: "evil", platforms: [{ id: "evilos", label: "x" }], commands: [{ cmd: "reload in 1", desc: "x", cat: "Sistema", risk: "read" }, { cmd: "show clock", desc: "x", cat: "Sistema", risk: "read" }] }).pack;
  const idx = S.buildIndex(buildCatalog([evil], []), "evilos");
  assert.equal(S.ghostFor(idx, "rel"), null);
  assert.equal(S.lookup(idx, "rel", 8)[0].risk, "disruptive");
  assert.equal(S.lookup(idx, "rel", 8, true).length, 0);
}

// ---------- Nunca se produce Enter ----------

{
  assert.equal(S.safeInsert("show clock\r\nreload\r"), "show clock");
  assert.equal(S.safeInsert("show\x1b[Aclock\x00\x7f"), "show[Aclock");
  assert.equal(S.safeInsert("a\nb"), "a");
  for (const p of platforms) {
    const idx = S.getIndex(catalog, p);
    for (const e of idx.entries) {
      for (const buf of ["", e.cmd.slice(0, 1), e.cmd.slice(0, 3)]) {
        const r = S.remainderToInsert(e, buf);
        assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(r), `${p}: ${JSON.stringify(r)}`);
      }
    }
  }
  // Un pack con un "\r" escondido se rechaza al validar; el índice tampoco lo aceptaría.
  const t = atPrompt();
  type(t, "sh");
  t.insert("ow clock\r");
  assert.equal(t.active, false, "insertar texto con control desincroniza");
}

// ---------- Teclado ----------

const k = (key, mods = {}) => ({ key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...mods });
const on = { enabled: true, listOpen: false, canAccept: true };
assert.equal(S.suggestKey(k("Tab"), on), "pass", "Tab va al equipo");
assert.equal(S.suggestKey(k("Tab"), { ...on, listOpen: true }), "pass", "Tab va al equipo con la lista abierta");
assert.equal(S.suggestKey(k("Tab", { shiftKey: true }), on), "pass");
assert.equal(S.suggestKey(k("ArrowRight"), on), "accept");
assert.equal(S.suggestKey(k("ArrowRight"), { ...on, canAccept: false }), "pass", "sin texto gris la flecha va al equipo");
assert.equal(S.suggestKey(k("ArrowRight", { shiftKey: true }), on), "pass");
// Tecla de lista: Ctrl+. por defecto (libre en xterm y en macOS); Alt+/ y Ctrl+Espacio a elección.
assert.equal(S.suggestKey(k(".", { ctrlKey: true, code: "Period" }), on), "open");
assert.equal(S.suggestKey(k(":", { ctrlKey: true, shiftKey: true, code: "Period" }), on), "pass", "con Shift no");
assert.equal(S.suggestKey(k(" ", { ctrlKey: true }), on), "pass", "Ctrl+Espacio no abre por defecto (macOS lo usa)");
assert.equal(S.suggestKey(k(" ", { ctrlKey: true }), { ...on, listKey: "ctrl+space" }), "open");
assert.equal(S.suggestKey(k("/", { altKey: true, code: "Slash" }), { ...on, listKey: "alt+slash" }), "open");
assert.equal(S.suggestKey(k("/", { altKey: true, code: "Slash" }), on), "pass");
assert.equal(S.suggestKey(k(".", { ctrlKey: true }), { ...on, enabled: false }), "pass", "apagado no intercepta nada");
for (const lk of Object.keys(S.LIST_KEYS)) assert.equal(S.suggestKey(k("Tab"), { ...on, listKey: lk }), "pass");
// Aceptar una palabra: Ctrl+→ (Windows/Linux) u Option+→ (macOS), solo con texto gris visible.
assert.equal(S.suggestKey(k("ArrowRight", { ctrlKey: true }), on), "word");
assert.equal(S.suggestKey(k("ArrowRight", { altKey: true }), on), "word");
assert.equal(S.suggestKey(k("ArrowRight", { ctrlKey: true }), { ...on, canAccept: false }), "pass", "sin texto gris va al equipo");
assert.equal(S.suggestKey(k("ArrowRight", { ctrlKey: true, altKey: true }), on), "pass");
assert.equal(S.suggestKey(k("ArrowRight", { metaKey: true }), on), "pass");
assert.equal(S.nextWord("erface brief"), "erface ");
assert.equal(S.nextWord(" brief"), " brief");
assert.equal(S.nextWord("brief"), "brief");
// Enter solo lo toma la lista (para elegir sin ejecutar); nunca hay una acción que lo envíe.
for (const mods of [{}, { ctrlKey: true }, { altKey: true }, { shiftKey: true }]) {
  assert.equal(S.suggestKey(k("Enter", mods), on), "pass");
  assert.notEqual(S.suggestKey(k("Tab", mods), { ...on, listOpen: true }), "pick");
}
assert.equal(S.suggestKey(k("ArrowRight"), { ...on, enabled: false }), "pass");
assert.equal(S.suggestKey(k("ArrowDown"), { ...on, listOpen: true }), "down");
assert.equal(S.suggestKey(k("ArrowUp"), { ...on, listOpen: true }), "up");
assert.equal(S.suggestKey(k("Enter"), { ...on, listOpen: true }), "pick");
assert.equal(S.suggestKey(k("Escape"), { ...on, listOpen: true }), "close");
assert.equal(S.suggestKey(k("Enter"), on), "pass", "Enter sin lista va al equipo");
assert.equal(S.suggestKey(k("a"), { ...on, listOpen: true }), "pass");
assert.equal(S.suggestKey(k("ArrowRight", { isComposing: true }), on), "pass");

// ---------- Abreviaturas (Cisco, Huawei, Junos, FortiOS) ----------

const mkIndex = (vendor, cmds, platform = "testos") => {
  const pack = validatePack({
    format: "netterminal-commands",
    formatVersion: 1,
    id: `t-${vendor}`,
    name: "t",
    vendor,
    platforms: [{ id: platform, label: "t" }],
    commands: cmds.map((cmd) => ({ cmd, desc: "x", cat: "Sistema", risk: "read" })),
  }).pack;
  assert.ok(pack, "pack de prueba válido");
  return S.buildIndex(buildCatalog([pack], []), platform);
};
{
  const cases = [
    ["iosxe", "sh ip int br", "show ip interface brief", "ief"],
    ["iosxe", "sh ip int", "show ip interface brief", null],
    ["vrp8", "dis int br", "display interface brief", "ief"],
    ["junos", "sh int ter", "show interfaces terse", "se"],
    ["fos74", "get sys sta", "get system status", "tus"],
  ];
  for (const [p, typed, want, insert] of cases) {
    const idx = S.getIndex(catalog, p);
    assert.ok(idx.abbrev, `${p} acepta abreviaturas`);
    const list = S.lookup(idx, typed, 50);
    assert.ok(list.some((e) => e.key === want), `${p}: "${typed}" encuentra "${want}"`);
    if (insert !== null) {
      const g = S.ghostFor(idx, typed);
      assert.ok(g, `${p}: "${typed}" tiene texto gris`);
      assert.equal(g.entry.key, want);
      assert.equal(g.insert, insert, "solo se agrega texto al final");
      assert.equal(g.entry.risk, "read");
    }
  }
  const ios = S.getIndex(catalog, "iosxe");
  // Con espacio final, la siguiente palabra queda libre.
  assert.ok(S.lookup(ios, "sh ip int ", 50).every((e) => e.toks.length > 3 && e.toks[2].startsWith("int")));
  // Una palabra que no es prefijo de ninguna no coincide.
  assert.equal(S.lookup(ios, "sh zz int", 50).length, 0);
  assert.equal(S.ghostFor(ios, "xh ip int br"), null);
  // Espacios dobles al teclear se normalizan.
  assert.equal(S.ghostFor(ios, "sh  ip   int br")?.entry.key, "show ip interface brief");
  // Resaltado en la lista: lo que coincide de cada palabra.
  const e = ios.entries.find((x) => x.key === "show ip interface brief");
  assert.deepEqual(
    S.matchSpans(e, "sh ip int br").map((x) => (x.hit ? `[${x.text}]` : x.text)).join(""),
    "[sh]ow [ip] [int]erface [br]ief",
  );
  assert.equal(S.completionFor(e, "sh ip int br").insert, "ief");
  assert.equal(S.completionFor(e, "sh ip x br"), null);
}
{
  // Prefijo exacto primero, luego abreviaturas (aunque estén antes en el catálogo).
  const idx = mkIndex("cisco", ["show ipv6 rip", "show ipv6 route", "show ip route"]);
  const list = S.lookup(idx, "show ip r", 8);
  assert.equal(list[0].key, "show ip route", "el prefijo exacto va primero");
  assert.deepEqual(list.slice(1).map((x) => x.key), ["show ipv6 rip", "show ipv6 route"], "luego abreviaturas, en el orden del catálogo");
  assert.equal(S.ghostFor(idx, "show ip r").entry.key, "show ip route");
  assert.equal(S.ghostFor(idx, "show ip ri").entry.key, "show ipv6 rip", "sin prefijo exacto, la abreviatura");
  // Marcadores: la abreviatura no pasa del marcador y se inserta hasta él.
  const ph = mkIndex("cisco", ["show interfaces {{interfaz}} status", "show interfaces ae{{n}} extensive"]);
  const g = S.ghostFor(ph, "sh int");
  assert.equal(g.insert, "erfaces ", "inserta hasta el marcador");
  assert.equal(S.lookup(ph, "sh int gi1/0/1", 8).length, 0, "no coincide más allá del marcador");
  assert.equal(S.ghostFor(ph, "sh interfaces ae").insert, "", "en el marcador no inserta nada");
}
{
  // Shells y CLIs sin abreviaturas: solo prefijo exacto por palabra.
  const idx = mkIndex("linux", ["ip address show", "ip route show"]);
  assert.equal(idx.abbrev, false);
  assert.equal(S.ghostFor(idx, "ip addr")?.entry.key, "ip address show");
  assert.equal(S.ghostFor(idx, "i a"), null, "en Linux `i a` no es `ip address`");
  assert.equal(S.lookup(idx, "ip a s", 8).length, 0);
  for (const p of ["debian", "win11", "macos15", "r81", "fw12"]) assert.equal(S.getIndex(catalog, p).abbrev, false, `${p} sin abreviaturas`);
}

// ---------- Historial y favoritos ----------

{
  const idx = mkIndex("cisco", ["show version", "show vlan brief", "show vrf", "username {{usuario}} privilege 15 secret {{clave}}", "ping {{ip}} source {{interfaz}}"]);
  const u = new S.SuggestUsage();
  const none = new Set();
  const first = (w) => S.lookup(idx, "show v", 3, { weights: w }).map((e) => e.key);
  assert.deepEqual(first(u.weights(idx, none)), ["show version", "show vlan brief", "show vrf"], "sin historial, orden del catálogo");
  const vrf = idx.entries.find((e) => e.key === "show vrf");
  u.record("testos", vrf);
  u.record("testos", vrf);
  assert.equal(u.count("testos", "show vrf"), 2);
  assert.equal(first(u.weights(idx, none))[0], "show vrf", "lo usado sube");
  assert.equal(S.ghostFor(idx, "show v", u.weights(idx, none)).entry.key, "show vrf", "también en el texto gris");
  assert.equal(u.weights(idx, none), u.weights(idx, none), "pesos en caché mientras no cambie nada");
  // Favoritos: "fabricante:comando", igual que el panel de comandos.
  const favs = new Set(["cisco:show vlan brief"]);
  const fresh = new S.SuggestUsage();
  assert.equal(first(fresh.weights(idx, favs))[0], "show vlan brief", "el favorito sube");
  // Otra plataforma no se ve afectada.
  const other = mkIndex("cisco", ["show version", "show vrf"], "otheros");
  assert.equal(S.lookup(other, "show v", 2, { weights: u.weights(other, none) })[0].key, "show version");
  // Borrar.
  u.clear();
  assert.deepEqual(first(u.weights(idx, none)), ["show version", "show vlan brief", "show vrf"]);
  assert.equal(u.serialize(), JSON.stringify({ v: 1, p: {} }));
}
{
  // Ejecutado: se guarda la plantilla, nunca argumentos, nombres de equipo ni secretos.
  const idx = mkIndex("cisco", ["show version", "username {{usuario}} privilege 15 secret {{clave}}", "ping {{ip}} source {{interfaz}}", "show interfaces ae{{n}} extensive"]);
  const u = new S.SuggestUsage();
  const lines = ["username admin privilege 15 secret Sup3rS3cr3t!", "ping 10.20.30.40 source core-sw01-mgmt", "sh ver", "show interfaces ae7 extensive", "copy run tftp://10.9.9.9/core-sw01.cfg"];
  const hits = [];
  for (const line of lines) {
    const e = S.matchExecuted(idx, line);
    if (e) u.record("testos", e), hits.push(e.tpl);
  }
  assert.deepEqual(hits, ["username {{usuario}} privilege 15 secret {{clave}}", "ping {{ip}} source {{interfaz}}", "show version", "show interfaces ae{{n}} extensive"]);
  const stored = u.serialize();
  for (const secret of ["admin", "Sup3rS3cr3t", "10.20.30.40", "core-sw01", "10.9.9.9", "ae7"]) assert.ok(!stored.includes(secret), `el historial no guarda "${secret}"`);
  // Al cargar, se descarta lo que no tiene la forma esperada (o trae caracteres de control).
  const loaded = new S.SuggestUsage(JSON.stringify({ v: 1, p: { testos: { "show version": [3, 20000], "x\r\nreload": [9, 1], bad: "x" }, "../evil": { a: [1, 1] } } }));
  assert.equal(loaded.count("testos", "show version"), 3);
  assert.equal(loaded.count("testos", "x\r\nreload"), 0);
  assert.ok(!loaded.serialize().includes("evil"));
  assert.equal(new S.SuggestUsage("{no es json").serialize(), JSON.stringify({ v: 1, p: {} }));
  // Con tope: nunca crece sin límite.
  const capped = new S.SuggestUsage();
  const many = mkIndex("cisco", Array.from({ length: 120 }, (_, i) => `show test ${i}`));
  for (const e of many.entries) capped.record("testos", e);
  assert.ok(Object.keys(JSON.parse(capped.serialize()).p.testos).length <= 60);
  // Sin localStorage (Node) el almacén compartido funciona en memoria.
  S.usageStore().record("testos", idx.entries[0]);
  S.clearUsage();
  assert.equal(S.usageStore().count("testos", idx.entries[0].tpl), 0);
}

// ---------- Terminal local y SCP: nunca ----------

{
  assert.equal(S.suggestAllowed(true, { type: "local" }), false, "terminal local");
  assert.equal(S.suggestAllowed(true, { type: "ssh", scp: { dir: "up" } }), false, "transferencia SCP");
  assert.equal(S.suggestAllowed(false, { type: "ssh" }), false, "apagado");
  for (const type of ["ssh", "telnet", "serial", "tcp"]) assert.equal(S.suggestAllowed(true, { type }), true, type);
}

// ---------- Ajuste: salida de beta y migración ----------

{
  assert.equal(S.SUGGEST_DEFAULT, true, "encendidas por defecto (las pruebas de seguridad pasan)");
  assert.deepEqual(S.migrateSuggest(null), { commandSuggest: true, commandSuggestSet: false }, "instalación nueva");
  assert.deepEqual(S.migrateSuggest({ commandSuggest: false }), { commandSuggest: true, commandSuggestSet: false }, "beta sin tocar: el false guardado era el valor por defecto");
  assert.deepEqual(S.migrateSuggest({ commandSuggest: true }), { commandSuggest: true, commandSuggestSet: true }, "beta activada a mano: se respeta");
  assert.deepEqual(S.migrateSuggest({ commandSuggest: false, commandSuggestSet: true }), { commandSuggest: false, commandSuggestSet: true }, "apagada a mano: se respeta");
  assert.deepEqual(S.migrateSuggest({ commandSuggest: true, commandSuggestSet: true }), { commandSuggest: true, commandSuggestSet: true });
  assert.deepEqual(S.migrateSuggest({ commandSuggest: "x", commandSuggestSet: true }), { commandSuggest: true, commandSuggestSet: false }, "valor inválido: por defecto");
}

// ---------- Nunca Enter: texto gris, palabra y lista ----------

for (const p of platforms) {
  const idx = S.getIndex(catalog, p);
  for (const e of idx.entries) {
    const abbr = e.toks.map((t) => t.slice(0, 2)).join(" ");
    for (const buf of [abbr, e.cmd.slice(0, 4)]) {
      const g = S.ghostFor(idx, buf);
      if (g) {
        assert.equal(g.entry.risk, "read", `${p}: "${buf}" no ofrece ${g.entry.cmd} en gris`);
        assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(g.insert + S.nextWord(g.insert)), `${p}: ${JSON.stringify(g.insert)}`);
      }
      for (const x of S.lookup(idx, buf, 8)) assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(S.remainderToInsert(x, buf)));
    }
  }
}

// ---------- Rendimiento ----------

{
  const total = catalog.reduce((n, v) => n + v.commands.length, 0);
  let t0 = performance.now();
  for (const p of platforms) S.buildIndex(catalog, p);
  const build = (performance.now() - t0) / platforms.length;
  // Cada prefijo de cada comando, sus formas abreviadas y consultas patológicas (una letra por palabra).
  const queries = [];
  const usage = new S.SuggestUsage();
  for (const p of platforms) {
    const idx = S.getIndex(catalog, p);
    for (const e of idx.entries.slice(0, 40)) usage.record(p, e);
    const w = usage.weights(idx, new Set());
    for (const e of idx.entries) {
      for (let n = 1; n <= e.cmd.length; n++) queries.push([idx, e.cmd.slice(0, n), w]);
      for (const len of [1, 2, 3]) queries.push([idx, e.toks.map((t) => t.slice(0, len)).join(" "), w]);
    }
    for (const q of ["s", "s ", "s i", "s i i", "d", "d i", "g s", "sh i", "show "]) queries.push([idx, q, w]);
  }
  for (const [idx, q, w] of queries) S.ghostFor(idx, q, w), S.lookup(idx, q, 8, { weights: w });
  t0 = performance.now();
  for (const [idx, q, w] of queries) S.ghostFor(idx, q, w);
  const ghostUs = ((performance.now() - t0) * 1000) / queries.length;
  t0 = performance.now();
  for (const [idx, q, w] of queries) S.lookup(idx, q, 8, { weights: w });
  const listUs = ((performance.now() - t0) * 1000) / queries.length;
  // Peor caso por tecla (texto gris + lista): la mejor de 5 tandas de 4 por consulta, para no medir pausas del GC.
  let worst = 0;
  let worstQ = "";
  let worstArgs = null;
  for (const [idx, q, w] of queries) {
    let best = Infinity;
    for (let r = 0; r < 5; r++) {
      const a = performance.now();
      for (let i = 0; i < 4; i++) S.ghostFor(idx, q, w), S.lookup(idx, q, 8, { weights: w });
      best = Math.min(best, ((performance.now() - a) * 1000) / 4);
    }
    if (best > worst) (worst = best), (worstQ = `${idx.platform} "${q}"`), (worstArgs = [idx, q, w]);
  }
  // Con la máquina ocupada (otro build en paralelo) una tanda puede salir lenta: se vuelve a medir solo
  // la peor consulta con más tandas antes de concluir, para no fallar por carga ajena.
  if (worst >= 20 && worstArgs) {
    const [idx, q, w] = worstArgs;
    let best = Infinity;
    for (let r = 0; r < 50; r++) {
      const a = performance.now();
      for (let i = 0; i < 4; i++) S.ghostFor(idx, q, w), S.lookup(idx, q, 8, { weights: w });
      best = Math.min(best, ((performance.now() - a) * 1000) / 4);
    }
    worst = best;
  }
  console.log(
    `rendimiento: ${total} comandos, ${platforms.length} plataformas · índice ${build.toFixed(2)} ms/plataforma · ` +
      `texto gris ${ghostUs.toFixed(2)} µs · lista ${listUs.toFixed(2)} µs (${queries.length} búsquedas, con historial) · ` +
      `peor caso por tecla ${worst.toFixed(1)} µs (${worstQ})`,
  );
  assert.ok(worst < 20, `peor caso por tecla bajo 20 µs (${worst.toFixed(1)} µs)`);
}

console.log("suggest: OK");
