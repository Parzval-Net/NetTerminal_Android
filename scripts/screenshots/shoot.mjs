// Genera las capturas del README con datos ficticios, controlando Chrome por DevTools Protocol.
// Uso: `npx vite --port 1430` en otra terminal y luego `node scripts/screenshots/shoot.mjs`.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:1430/scripts/screenshots/demo.html";
const OUT = fileURLToPath(new URL("../../docs/screenshots/", import.meta.url));
const SHOTS = [
  // Todas en modo claro para que sean uniformes; el modo oscuro y los temas van aparte.
  ["terminal", "terminal", "light"],
  ["notas", "notes", "light"],
  ["monitoreo", "monitor", "light"],
  ["topologia", "topology", "light"],
  ["topologia-cambios", "compare", "light"],
  ["comandos-so", "oscmds", "light"],
  ["subredes", "subnet", "light"],
  ["velocidad", "speed", "light"],
  ["ajustes", "settings", "light"],
  ["packs", "packs", "light"],
  ["acerca", "about", "light"],
  ["vista-dividida", "split", "light"],
  ["respaldos", "backup", "light"],
  ["difusion", "broadcast", "light"],
  ["alertas", "alerts", "light"],
  ["importar", "import", "light"],
  ["pestanas-verticales", "vertical", "light"],
  ["credenciales", "credentials", "light"],
  ["modo-oscuro", "terminal", "dark"],
  ["pestanas-verticales-oscuro", "vertical", "dark"],
  ["modo-oscuro-dividida", "split", "dark"],
];
const only = process.argv.slice(2);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "nt-shots-"));
const port = 9333;
const chrome = spawn(CHROME, ["--headless=new", "--hide-scrollbars", "--window-size=1440,880", "--force-device-scale-factor=2", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => null);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) pending.get(m.id)(m), pending.delete(m.id);
  });
  const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });

  await send("Page.enable");
  await send("Runtime.enable");
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") console.error("ERROR en página:", m.params.exceptionDetails?.exception?.description?.split("\n")[0]);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") console.error("console.error:", m.params.args?.map((a) => a.value ?? a.description).join(" ").slice(0, 200));
  });
  mkdirSync(OUT, { recursive: true });
  for (const [name, scene, theme] of SHOTS) {
    if (only.length && !only.includes(name)) continue;
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    await send("Page.navigate", { url: `${BASE}?scene=${scene}&theme=${theme}` });
    await sleep(5000);
    const { result } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(result.data, "base64"));
    console.log(`${name}.png`);
  }
  ws.close();
} finally {
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
