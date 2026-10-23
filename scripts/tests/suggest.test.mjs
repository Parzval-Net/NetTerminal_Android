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
  assert.equal(t.buf, "", "sin seguimiento no se guarda lo tecleado");
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
// Salida que redibuja la línea (mensaje de syslog con "logging synchronous").
{
  const t = atPrompt();
  type(t, "show ip");
  t.output("\r\n%LINK-3-UPDOWN: Interface Gi1/0/3, changed state to down\r\ncore-sw01#show ip", tail("down\ncore-sw01#show ip"));
  assert.equal(t.active, false, "la línea redibujada desincroniza");
  assert.equal(t.buf, "");
}
// Línea demasiado larga: se deja de seguir.
{
  const t = atPrompt();
  type(t, "x".repeat(300));
  assert.equal(t.active, false);
}

// ---------- Credenciales: nunca se sigue ----------

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
assert.equal(S.suggestKey(k(" ", { ctrlKey: true }), on), "open");
assert.equal(S.suggestKey(k(" ", { ctrlKey: true }), { ...on, enabled: false }), "pass", "apagado no intercepta nada");
assert.equal(S.suggestKey(k("ArrowRight"), { ...on, enabled: false }), "pass");
assert.equal(S.suggestKey(k("ArrowDown"), { ...on, listOpen: true }), "down");
assert.equal(S.suggestKey(k("ArrowUp"), { ...on, listOpen: true }), "up");
assert.equal(S.suggestKey(k("Enter"), { ...on, listOpen: true }), "pick");
assert.equal(S.suggestKey(k("Escape"), { ...on, listOpen: true }), "close");
assert.equal(S.suggestKey(k("Enter"), on), "pass", "Enter sin lista va al equipo");
assert.equal(S.suggestKey(k("a"), { ...on, listOpen: true }), "pass");
assert.equal(S.suggestKey(k("ArrowRight", { isComposing: true }), on), "pass");

// ---------- Rendimiento ----------

{
  const total = catalog.reduce((n, v) => n + v.commands.length, 0);
  let t0 = performance.now();
  for (const p of platforms) S.buildIndex(catalog, p);
  const build = (performance.now() - t0) / platforms.length;
  const queries = [];
  for (const p of platforms) {
    const idx = S.getIndex(catalog, p);
    for (const e of idx.entries) for (let n = 1; n <= e.cmd.length; n += 2) queries.push([idx, e.cmd.slice(0, n)]);
  }
  // Calentamiento y medición.
  for (const [idx, q] of queries) S.ghostFor(idx, q);
  t0 = performance.now();
  for (const [idx, q] of queries) S.ghostFor(idx, q);
  const ghostUs = ((performance.now() - t0) * 1000) / queries.length;
  t0 = performance.now();
  for (const [idx, q] of queries) S.lookup(idx, q, 8);
  const listUs = ((performance.now() - t0) * 1000) / queries.length;
  let worst = 0;
  for (const p of platforms) {
    const idx = S.getIndex(catalog, p);
    const a = performance.now();
    for (let i = 0; i < 200; i++) S.lookup(idx, "s", 8);
    worst = Math.max(worst, ((performance.now() - a) * 1000) / 200);
  }
  console.log(
    `rendimiento: ${total} comandos, ${platforms.length} plataformas · índice ${build.toFixed(2)} ms/plataforma · ` +
      `texto gris ${ghostUs.toFixed(2)} µs · lista ${listUs.toFixed(2)} µs (${queries.length} búsquedas) · peor caso ("s") ${worst.toFixed(1)} µs`,
  );
  assert.ok(ghostUs < 200 && listUs < 500, "búsqueda bajo 0,5 ms");
}

console.log("suggest: OK");
