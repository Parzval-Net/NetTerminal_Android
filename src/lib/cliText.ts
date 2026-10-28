/**
 * Lectura de texto de CLI compartida (topología, ciclo de vida, respaldos, CLI Lab): prompt del
 * equipo y mensajes de error. El backend (filexfer.rs) reconoce los mismos prompts para saber
 * cuándo terminó un comando; las pruebas de ambos lados usan la misma lista.
 */

/**
 * Prompts reconocidos, con el nombre del equipo en el grupo 1:
 * - Huawei/H3C `<SW>`, `[SW-GigabitEthernet0/0/1]`, VRP8 `[~SW]` y con cambios sin commit `[*SW]`
 * - MikroTik `[admin@MikroTik] >` (también en un submenú `/interface>`), shell RHEL `[user@host ~]$`
 * - Junos, PAN-OS y shells `user@host>`, `user@host:~$`
 * - Cisco/Arista/Aruba/HPE `sw01#`, `sw01(config-if)#`, IOS-XR `RP/0/RSP0/CPU0:asr9k#`,
 *   FortiOS `fw01 #`, `fw01 (port1) #` y con VDOM `fw01 (root) (interface) #`
 */
const HUAWEI_BRACKET = 3;
const PROMPTS = [
  /^<([\w.-]+)>$/,
  /^\[[\w.-]+@([\w.-]+)\](?: \/[\w/-]*)? ?>$/,
  /^\[[\w.-]+@([\w.-]+)(?: [^\]]*)?\][#$]$/,
  // Tras el nombre, un separador explícito: "[\w.-]+[^\]]*" era cuadrático en una línea larga.
  /^\[[~*]{0,2}([\w.-]+)(?:[^\]\w.-][^\]]*)?\]$/,
  /^[\w.-]+@([\w.-]+)(?::\S*)?[>#%$]$/,
  /^(?:[\w/]+:)?([\w.-]+)(?: ?\([^()]*\)){0,3} ?[#>$%]$/,
];

/** Huawei/H3C: la vista se agrega al nombre con un guion ("[SW-01-GigabitEthernet0/0/1]"). */
const HUAWEI_VIEW =
  /-(?:(?:x|10|25|40|50|100|200|400)?ge|(?:x|ten|forty|hundred|twenty-five)?gigabitethernet|ethernet|eth-trunk|vlanif|loopback|null|tunnel|meth|ospf|ospfv3|bgp|isis|rip|vlan|aaa|ui-vty|ui-console|user-interface|acl|rsa|pki|ike|ipsec|policy|route-policy|traffic|qos|vpn-instance|stack|interface|mpls|dhcp|ntp|snmp|hwtacacs|radius|domain|port-group|lldp|wlan|bridge)\d*(?:[-/:.]\S*)?$/i;

/** Nombre del equipo según el prompt de la última línea con texto, o null. */
export function promptName(output: string): string | null {
  const lines = output.trimEnd().split("\n");
  const last = (lines[lines.length - 1] ?? "").replace(/\r/g, "").trim().slice(0, 160);
  for (const [i, re] of PROMPTS.entries()) {
    const m = last.match(re);
    if (m) return i === HUAWEI_BRACKET ? m[1].replace(HUAWEI_VIEW, "") : m[1];
  }
  return null;
}

/** La línea es un prompt de equipo o shell. */
export const isPrompt = (line: string) => promptName(line) !== null;

/**
 * Mensajes de error de CLI al comienzo de una línea: Cisco/Arista/Aruba (`% Invalid input`,
 * `% Incomplete command`, `% Ambiguous command`), Huawei/H3C (`Error: Unrecognized command`,
 * `Error: Wrong parameter`), FortiOS (`Command fail`, `command parse error`, `Unknown action`),
 * Junos (`syntax error`, `unknown command`, `error: …`), MikroTik (`bad command name`,
 * `syntax error`) y PAN-OS (`Unknown command`, `Invalid syntax`).
 */
const CLI_ERROR =
  /^\s*(?:%\s*(?:invalid|incomplete|ambiguous|unknown|unrecognized|bad|error|wrong)[^\n]*|error:[^\n]*|command fail[^\n]*|command parse error[^\n]*|unknown (?:action|command)[^\n]*|syntax error[^\n]*|invalid (?:input|command|syntax)[^\n]*|unrecognized command[^\n]*|bad command name[^\n]*|expected end of command[^\n]*)$/im;

/** Primera línea de error de la salida (desde `from`), recortada, o null. */
export function cliErrorLine(output: string, from = 0): string | null {
  const m = output.replace(/\r/g, "").slice(from).match(CLI_ERROR);
  return m ? m[0].trim().slice(0, 200) : null;
}

/**
 * Error de la respuesta a `cmd`, sin mirar el eco del comando (que puede contener "error:" en
 * un filtro como `show logging | i error:`).
 */
export function commandError(output: string, cmd: string): string | null {
  const text = output.replace(/\r/g, "");
  const at = cmd.trim() ? text.indexOf(cmd.trim()) : -1;
  const from = at < 0 ? 0 : text.indexOf("\n", at) + 1 || text.length;
  return cliErrorLine(text, from);
}
