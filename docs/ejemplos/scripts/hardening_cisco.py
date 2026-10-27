"""
Hardening base para Cisco IOS / IOS-XE (script de ejemplo de NetTerminal).

Aplica servicios mínimos, SSH v2 con llaves RSA de 2048 bits, timestamps, logging y NTP, y
guarda la configuración. Funciona en una o varias sesiones (destino elegido al lanzarlo).

Uso:
  1. Cópialo a la carpeta scripts/ de NetTerminal (barra de botones > Scripts > Abrir carpeta
     de scripts) y crea un botón de tipo "Script Python" que lo use.
  2. Lánzalo con las sesiones conectadas y en modo privilegiado (prompt #).
  3. Marca "permitir cambios"; si no, la app pide confirmar cada línea de configuración.

Antes de cambiar nada revisa que el equipo tenga un hostname propio (las llaves RSA lo
exigen). Si las llaves ya son de 2048 bits no las regenera; si son de otro tamaño, responde
"yes" al reemplazo. Los comandos que el equipo no soporta (por ejemplo clock calendar-valid en
un switch sin reloj de hardware) se informan y no detienen el resto.
"""
import re

import netterminal as nt

DOMINIO = "CSA.cl"
NTP = "192.168.60.1"
MODULO = 2048

# En orden de aplicación. None marca el punto donde se generan las llaves RSA.
COMANDOS = [
    "service password-encryption",
    "no ip http server",
    "no ip http secure-server",
    "no ip domain-lookup",
    "no service pad",
    "no service udp-small-servers",
    "no service tcp-small-servers",
    "no ip bootp server",
    "no ip http authentication",
    "no ip http timeout-policy idle",
    f"ip domain-name {DOMINIO}",
    None,
    "ip ssh version 2",
    "service timestamps debug datetime localtime",
    "service timestamps log datetime localtime",
    "service sequence-numbers",
    "logging buffered 52000",
    "logging trap 4",
    f"ntp server {NTP}",
    "ntp update-calendar",
    "clock calendar-valid",
]

# Dependen de la plataforma o la versión: si el equipo no los tiene, se informa y se sigue.
OPCIONALES = {
    "no ip http authentication",
    "no ip http timeout-policy idle",
    "ntp update-calendar",
    "clock calendar-valid",
}

PROMPT = r"#\s*$"
ERROR = re.compile(
    r"^\s*%\s*(?:Invalid|Incomplete|Ambiguous|Unknown|Unrecognized|Please define|.*not supported|.*failed).*",
    re.M | re.I,
)
HOSTNAME_FABRICA = {"router", "switch", "ios", "csr1000v", "cat9k"}


def error_de(salida):
    m = ERROR.search(salida)
    return m.group(0).strip() if m else None


def modulo_actual(s):
    """Tamaño de las llaves RSA según show ip ssh (None si no hay llaves o no lo informa)."""
    salida = s.run("show ip ssh", PROMPT)
    if re.search(r"SSH Disabled", salida, re.I):
        return None
    m = re.search(r"Modulus Size\s*:\s*(\d+)", salida, re.I)
    return int(m.group(1)) if m else None


def generar_llaves(s):
    s.clear()
    s.sendline(f"crypto key generate rsa general-keys modulus {MODULO}")
    salida = ""
    # Equipos lentos tardan bastante en generar 2048 bits.
    for _ in range(3):
        salida += s.wait_for(r"(\[yes/no\]:?\s*$|#\s*$)", timeout=300)
        if re.search(r"\[yes/no\]:?\s*$", salida):
            s.sendline("yes")
            continue
        break
    return error_de(salida)


def guardar(s):
    s.clear()
    s.sendline("write memory")
    salida = s.wait_for(r"(\[confirm\]\s*$|#\s*$)", timeout=120)
    if re.search(r"\[confirm\]\s*$", salida):
        s.sendline("")
        salida += s.wait_for(PROMPT, timeout=120)
    return error_de(salida)


def aplicar(s):
    nombre = s.name or nt.session.get("name", "equipo")
    s.run("terminal length 0")

    s.clear()
    s.sendline("")
    if not re.search(PROMPT, s.wait_for(r"[#>]\s*$", timeout=15)):
        raise RuntimeError("requiere modo privilegiado (enable): no se aplicó nada")

    host = re.search(r"^hostname\s+(\S+)", s.run("show running-config | include ^hostname", PROMPT, 60), re.M)
    if not host or host.group(1).lower() in HOSTNAME_FABRICA:
        raise RuntimeError("configura un hostname propio antes (las llaves RSA lo exigen): no se aplicó nada")

    modulo = modulo_actual(s)
    regenerar = modulo != MODULO
    nt.log(f"{nombre}: llaves RSA actuales {modulo or 'sin llaves'}; {'se generan' if regenerar else 'se mantienen'} {MODULO} bits")

    errores, omitidos = [], []
    s.run("configure terminal", PROMPT)
    try:
        for cmd in COMANDOS:
            if cmd is None:
                if regenerar and (e := generar_llaves(s)):
                    errores.append(f"crypto key generate rsa: {e}")
                continue
            e = error_de(s.run(cmd, PROMPT))
            if e:
                (omitidos if cmd in OPCIONALES else errores).append(f"{cmd}: {e}")
    finally:
        s.run("end", PROMPT)

    if errores:
        raise RuntimeError("no se guardó la configuración por errores en: " + "; ".join(errores))
    e = guardar(s)
    if e:
        raise RuntimeError(f"write memory: {e}")

    final = modulo_actual(s)
    ssh = s.run("show ip ssh | include version", PROMPT)
    resumen = f"OK. RSA {final or '?'} bits, {ssh.strip() or 'SSH sin datos'}"
    if omitidos:
        resumen += ". No soportados: " + "; ".join(c.split(":")[0] for c in omitidos)
    return resumen


if not nt.allow_changes:
    nt.log("Sin 'permitir cambios' la app pedirá confirmar cada línea de configuración.")

for equipo, resultado in nt.for_each(aplicar).items():
    if isinstance(resultado, Exception):
        print(f"{equipo}: ERROR, {resultado}")
    else:
        print(f"{equipo}: {resultado}")
