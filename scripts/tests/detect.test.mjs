// Detección de plataforma con salidas reales de equipos: `node scripts/tests/detect.test.mjs`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const { detectPlatform, appliesTo, commandFor } = await import("../../src/lib/packs.ts");
const forti = JSON.parse(readFileSync(new URL("../../src/packs/fortinet.json", import.meta.url), "utf8"));
const vendor = { id: "fortinet", name: "Fortinet", platforms: forti.platforms, commands: forti.commands };

// FortiGate 30E: no pasa de FortiOS 6.2 (serie y nombre ficticios).
const fgt30e = "FortiGate-30E # get system status\nVersion: FortiGate-30E v6.2.16,build1392,240129 (GA)\nVirus-DB: 93.06352(2025-12-16 06:22)\nSerial-Number: FGT30E0000000000\nHostname: fw-demo\n";
assert.equal(detectPlatform(vendor, fgt30e)?.id, "fos62");
assert.equal(detectPlatform(vendor, "Version: FortiGate-60F v7.4.5,build2702,240829 (GA.F)")?.id, "fos74");
assert.equal(detectPlatform(vendor, "Version: FortiGate-100F v6.4.15,build2095,240307 (GA.M)")?.id, "fos64");

// En 6.2 el SD-WAN usa virtual-wan-link y los comandos solo 7.x no aparecen.
const by = (cmd) => forti.commands.find((c) => c.cmd === cmd);
assert.equal(commandFor(by("diagnose sys sdwan health-check"), "fos62"), "diagnose sys virtual-wan-link health-check");
assert.equal(appliesTo(by("diagnose sys sdwan service"), "fos62"), true);
assert.equal(appliesTo(by("diagnose sys sdwan zone"), "fos62"), false);
assert.equal(commandFor(by("diagnose vpn ike log filter clear"), "fos62"), "diagnose vpn ike log-filter clear");
console.log("detect OK");
