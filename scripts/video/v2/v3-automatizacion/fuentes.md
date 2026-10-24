# Fuentes del video 3

Cada afirmación de la narración (`guion/`) con el código que la respalda. Rutas relativas a la raíz del repositorio; líneas según el commit de este guion. Lo que no está en el código va con su fuente externa oficial.

## 01 · Qué se puede automatizar

| Afirmación | Fuente |
| --- | --- |
| Tres niveles: Consulta, Cambia config/estado, Puede cortar servicio | `src/lib/packs.ts:10`, `src/lib/packs.ts:92-96` |
| Lo que no se reconoce como consulta se trata como cambio | `src/lib/packs.ts:288-291`, `src/lib/packs.ts:325-326` |
| Comandos encadenados (`;`, `&&`, `\|\|`, `&`) se evalúan por partes; `show version ; reload` es disruptivo | `src/lib/packs.ts:249-284`, `src/lib/packs.ts:316-324`; prueba en `scripts/video/v2/v3-automatizacion/probar-ejemplos.mjs` (sección 8) |
| Lo disruptivo siempre se confirma; el cambio, según "Confirmar envío de varias líneas" (activado por defecto) | `src/App.tsx:695-696`, `src/lib/settings.ts:145` |
| Notas y botones de texto pasan por el motor de riesgo | `src/App.tsx:670-675`, `src/App.tsx:693-696`, `src/App.tsx:990` |
| El catálogo confirma lo que no es consulta | `src/App.tsx:963-974` |
| El envío a varias sesiones calcula el riesgo y exige escribir la cantidad de equipos si no es consulta | `src/components/BroadcastDialog.tsx:32-41`, `src/components/BroadcastDialog.tsx:128-132` |
| Los scripts no pasan por el motor: escriben directo en la conexión | `src-tauri/src/scripts.rs:289-292` |
| Los plugins usan el mismo ejecutor que los scripts | `src-tauri/src/plugins.rs:461-472` |
| Los comandos al conectar se escriben sin evaluar riesgo | `src/components/TerminalView.tsx:285-295` |
| Agentes: aprobación por comando activada por defecto | `src/lib/settings.ts:154`, `src-tauri/src/mcp.rs:364` |

## 02 · Botones

| Afirmación | Fuente |
| --- | --- |
| La barra está sobre la barra de estado y viene activada; se activa en Ajustes › Terminal › Barra de botones | `src/lib/settings.ts:150`, `src/components/SettingsModal.tsx:408-410`, `src/components/ButtonBar.tsx:21` |
| Botones de fábrica "terminal length 0" e "Interfaces" | `src/lib/settings.ts:146-149` |
| "+" abre "Nuevo botón": Etiqueta, "Enviar texto" o "Script Python", comandos uno por línea con `{{variables}}` | `src/components/ButtonBar.tsx:73-79`, `src/components/MacroModal.tsx:40-82` |
| Solo se activan con una sesión conectada | `src/components/ButtonBar.tsx:53` |
| Al presionarlo se piden las variables (Completar plantilla) | `src/App.tsx:670-675`, `src/components/TemplateDialog.tsx:76` |
| Un bloque de varias líneas muestra un resumen; lo disruptivo siempre se confirma | `src/App.tsx:695-710` |
| Clic derecho: Editar / Eliminar | `src/components/ButtonBar.tsx:55-65` |

## 03 · Plantillas

| Afirmación | Fuente |
| --- | --- |
| Notas con ⌘J (Ctrl+Shift+J); enviar línea o selección con ⌘↵ (Ctrl+Enter) | `README.md:77`, `README.md:80` |
| Variables `{{nombre}}` | `src/components/TemplateDialog.tsx:4-12` |
| Se recuerdan los valores, salvo los que parecen secretos, que se piden ocultos, se enmascaran y no se guardan | `src/components/TemplateDialog.tsx:17`, `src/components/TemplateDialog.tsx:36-39`, `src/components/TemplateDialog.tsx:49`, `src/components/TemplateDialog.tsx:52-61`, `src/components/TemplateDialog.tsx:88` |
| Destinos: pestaña actual, pestañas elegidas, una carpeta, paneles visibles; el selector está en Notas | `src/components/BroadcastTarget.tsx:93-131`, `src/components/NotesPanel.tsx:635` |
| Las variables se piden una sola vez también al enviar a varias sesiones | `src/App.tsx:671-673` |
| Equipos destino, omitidos y riesgo antes de enviar | `src/components/BroadcastDialog.tsx:21-41`, `src/components/BroadcastDialog.tsx:92-94` |
| Escribir la cantidad de equipos si no es consulta | `src/components/BroadcastDialog.tsx:40-41`, `src/components/BroadcastDialog.tsx:130` |
| Envío en orden con pausa entre equipos y "Detener" | `src/lib/broadcast.ts:155-198`, `src/components/BroadcastDialog.tsx:113`, `src/components/BroadcastDialog.tsx:191` |

## 04 · Comandos al conectar

| Afirmación | Fuente |
| --- | --- |
| Solo en sesiones remotas: Opciones de terminal › "Comandos al conectar (uno por línea)" | `src/components/SessionModal.tsx:399-410` |
| `screen-length 0 temporary` en Huawei | `src-tauri/src/scripts.rs:27` |
| Espera el prompt (termina en `> # $ % ]`) con 200 ms de silencio, o 1,5 s de silencio | `src/lib/suggest.ts:25`, `src/components/TerminalView.tsx:269-283` |
| No envía sobre un pedido de usuario, contraseña, PIN, código u OTP | `src/lib/suggest.ts:30-31`, `src/components/TerminalView.tsx:279` |
| Hasta 2 minutos para el primer prompt; entre líneas espera el prompt (hasta 5 s) | `src/components/TerminalView.tsx:288-295` |
| Se ejecutan en cada conexión, también al reconectar | `src/components/TerminalView.tsx:298`, `src/components/TerminalView.tsx:397-400` (`connect()` llama a `runOnConnect` en cada intento) |
| Nunca se importan desde otros clientes ni desde JSON | `src-tauri/src/importers.rs:224`, `src/App.tsx:815`, `README.md:45` |

## 05 · Instalar las herramientas

| Afirmación | Fuente |
| --- | --- |
| Terminal local con ⌘T / Ctrl+Shift+T; shell de login en macOS/Linux, PowerShell en Windows | `README.md:84`, `src-tauri/src/connection.rs:638-651`; login shell en `portable-pty 0.9.0 src/cmdbuilder.rs:513-516` |
| Python 3 para scripts y plugins; se busca `py -3`, `python`, `python3` (Windows) o `python3`, `python` (macOS/Linux) y debe responder "Python 3" | `src-tauri/src/scripts.rs:85-105` |
| Se detecta una sola vez por ejecución de la app (OnceLock): tras instalar, reiniciar | `src-tauri/src/scripts.rs:87-88`, `src-tauri/src/scripts.rs:147` |
| Mensaje si falta: "No se encontró Python 3. Instálalo para usar scripts y plugins." | `src-tauri/src/scripts.rs:147` |
| Python desde python.org; en Windows el instalador actual es el Python install manager, que trae `py` y acepta `-3` como etiqueta | https://www.python.org/downloads/ , https://docs.python.org/3/using/windows.html |
| iperf3: la app ejecuta `iperf3 --version` cada vez que se abre Velocidad y muestra la versión o un aviso con `brew install iperf3`, `sudo apt install iperf3` y la indicación para Windows | `src-tauri/src/nettools.rs:129-133`, `src-tauri/src/nettools.rs:195-199`, `src/components/tools/PerfTool.tsx:184-203` |
| ESnet no distribuye binarios; iperf.fr enlaza compilaciones de terceros para Windows; Homebrew `brew install iperf3`; Debian/Ubuntu `apt-get install iperf3`; Fedora/RHEL `yum install iperf3` (dnf) | https://software.es.net/iperf/obtaining.html , https://iperf.fr/iperf-download.php |
| `iperf3.exe` junto a NetTerminal.exe o en el PATH | `src/components/tools/PerfTool.tsx:202` (Rust busca primero en la carpeta del ejecutable al resolver programas en Windows) |
| SSH, SCP y SFTP usan el OpenSSH del sistema (`ssh`, `scp`, `sftp`; `.exe` en Windows) | `src-tauri/src/connection.rs:845`, `src-tauri/src/connection.rs:897`, `src-tauri/src/connection.rs:958`, `README.md:36` |
| Error si falta: "Si es SSH, verifica que OpenSSH esté instalado." | `src-tauri/src/connection.rs:1066-1068` |
| Windows: OpenSSH Client como característica opcional; `Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0` en PowerShell como administrador; requisito: Windows 10 1809 o Server 2019 | https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse |
| Linux: paquetes `openssh-client` (Debian/Ubuntu) y `openssh-clients` (Fedora/RHEL) | Nombres de paquete de cada distribución (packages.debian.org/openssh-client, packages.fedoraproject.org/pkgs/openssh/openssh-clients) |
| Traceroute: `tracert` en Windows; `traceroute` o `tracepath` en macOS/Linux; error si no hay ninguno | `src-tauri/src/nettools.rs:109-126` |
| Telnet no requiere nada instalado | `README.md:38` |
| **Limitación macOS** (bloqueante): la app no amplía el PATH heredado de launchd; programas de `/opt/homebrew/bin` o `/usr/local/bin` no se encuentran si la app se abre desde el Dock | `src-tauri/src/monitor.rs:133-144` (sin PATH propio), `src-tauri/src/scripts.rs:94-102`; simulación `env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin` en esta máquina: `iperf3` no encontrado, `python3` → `/usr/bin/python3` |

## 06 · Scripts de Python

| Afirmación | Fuente |
| --- | --- |
| Carpeta `scripts/` en los datos; "Abrir carpeta de scripts" en el menú Scripts | `src-tauri/src/scripts.rs:52-67`, `src/components/ButtonBar.tsx:31-46`, `src-tauri/src/lib.rs:334` |
| La app deja `netterminal.py` (se actualiza solo si cambió) y `ejemplo_respaldo.py` | `src-tauri/src/scripts.rs:55-65` |
| `netterminal.py` solo usa la biblioteca estándar: no hay que instalar nada | `src-tauri/src/netterminal.py:4-5`, `src-tauri/src/netterminal.py:25-28` |
| Corre sobre la pestaña activa, que debe estar conectada | `src/App.tsx:548-557`, `src-tauri/src/scripts.rs:150-157` |
| `nt.session` con name, type, host, port, username, serial_port | `src-tauri/src/netterminal.py:21`, `src-tauri/src/scripts.rs:170-181` |
| `run()` = `clear` + `sendline` + `wait_for(prompt)`, sin eco ni prompt | `src-tauri/src/netterminal.py:110-120` |
| `print()` aparece como aviso en la app | `src-tauri/src/netterminal.py:64-83`, `src/App.tsx:238-244` |
| El botón Scripts muestra el script en curso y lo detiene | `src/components/ButtonBar.tsx:83-91`, `src-tauri/src/scripts.rs:262-266` |
| `wait_for` con tiempo máximo y `ScriptTimeout` con `.output` | `src-tauri/src/netterminal.py:41-60`, `src-tauri/src/netterminal.py:94-95`, `src-tauri/src/expect.rs:8-32` |
| `read(idle, timeout)` lee hasta que el equipo deja de enviar | `src-tauri/src/netterminal.py:98-99`, `src-tauri/src/expect.rs:34-48` |
| Nota técnica: `wait_for` devuelve todo lo acumulado, no solo hasta la coincidencia (por eso los ejemplos esperan el prompt y luego buscan en la salida) | `src-tauri/src/expect.rs:12-14` |
| Una sesión por script: no hay API para otras pestañas | `src-tauri/src/scripts.rs:116-125`, `src-tauri/src/scripts.rs:128-143` |
| `nt.data_dir` es la carpeta de datos | `src-tauri/src/netterminal.py:22`, `src-tauri/src/scripts.rs:169` |
| Los comandos de los ejemplos son de consulta | `scripts/video/v2/v3-automatizacion/probar-ejemplos.mjs` (`soloLectura(enviados)`) |
| Lo que envía un script no pasa por el motor de riesgo | `src-tauri/src/scripts.rs:289-292` |
| Ejemplos y salidas mostradas | `docs/ejemplos/scripts/primer_script.py`, `docs/ejemplos/scripts/ping_destinos.py`, `docs/ejemplos/scripts/inventario_csv.py`; salidas de `probar-ejemplos.mjs` |

## 07 · Plugins

| Afirmación | Fuente |
| --- | --- |
| Carpeta con `plugin.json` y código Python con la API netterminal | `src-tauri/src/plugins.rs:1-2`, `src-tauri/src/plugins.rs:35-49` |
| Acciones como botones en Herramientas › Plugins | `src/components/tools/PluginsTool.tsx:270-276` |
| `NT_ACTION` (y `NT_PLUGIN_DIR`) | `src-tauri/src/plugins.rs:469` |
| Manifiesto: id (letras, números, `-`, `_`), entrada `.py`, permisos conocidos, al menos una acción | `src-tauri/src/plugins.rs:100-120` |
| Permisos `session`, `network`, `files`; solo `session` se hace cumplir | `src-tauri/src/plugins.rs:25`, `src-tauri/src/plugins.rs:460-470`, `src-tauri/src/scripts.rs:226-230` |
| Textos de los permisos | `src/components/tools/PluginsTool.tsx:34-38` |
| Python corre con los privilegios del usuario | `src-tauri/src/plugins.rs:10-12`, `src/components/tools/PluginsTool.tsx:155-159` |
| "Desde carpeta" e "Instalar .zip"; copia a un área temporal | `src/components/tools/PluginsTool.tsx:118-123`, `src-tauri/src/plugins.rs:265-292` |
| Rechazos: enlaces simbólicos, más de 200 archivos, más de 20 MB, bytecode y binarios, no UTF-8 | `src-tauri/src/plugins.rs:23-24`, `src-tauri/src/plugins.rs:122-151`, `src-tauri/src/plugins.rs:153-185`, `src-tauri/src/plugins.rs:316-350` |
| La revisión muestra todo el código Python, primero la entrada | `src-tauri/src/plugins.rs:413-433`, `src/components/tools/PluginsTool.tsx:131-173` |
| "Instalar y habilitar" y huella SHA-256 de todos los archivos | `src-tauri/src/plugins.rs:187-197`, `src-tauri/src/plugins.rs:352-370`, `src/components/tools/PluginsTool.tsx:169-171` |
| Sus acciones usan la pestaña activa; la salida aparece en "Salida de plugins" | `src/components/tools/PluginsTool.tsx:94-107`, `src/components/tools/PluginsTool.tsx:284-288` |
| Reinstalar avisa "Reemplazará la versión instalada" | `src-tauri/src/plugins.rs:285`, `src/components/tools/PluginsTool.tsx:133-135` |
| Archivos editados: bloqueado hasta revisar y aprobar | `src-tauri/src/plugins.rs:247-263`, `src-tauri/src/plugins.rs:449-452`, `src/components/tools/PluginsTool.tsx:237-260` |
| Interruptor para deshabilitar y papelera con confirmación para desinstalar | `src/components/tools/PluginsTool.tsx:190-233`, `src-tauri/src/plugins.rs:394-402` |
| El plugin de ejemplo pasa la revisión real (dos archivos `.py`, entrada primero) | `src-tauri/src/plugins.rs` test `example_plugins_pass_review` |

## 08 · Packs

| Afirmación | Fuente |
| --- | --- |
| Catálogo con ⌘L / Ctrl+Shift+L | `README.md:78` |
| Un pack es JSON, solo datos, nunca se ejecuta | `src/lib/packs.ts:1-7`, `src/components/PacksModal.tsx:87-90` |
| "Propio": comando, explicación, categoría, riesgo | `src/components/CommandsPanel.tsx:221-222`, `src/components/CommandEditor.tsx:48-81` |
| Aviso "Por su contenido, la app lo tratará como…" y uso del mayor riesgo | `src/components/CommandEditor.tsx:18-20`, `src/components/CommandEditor.tsx:83-85`, `src/lib/packs.ts:470-471` |
| `clear counters` se calcula como cambio | `src/lib/packs.ts:110` (no está en `READ_START`), `src/lib/packs.ts:326`; prueba en `probar-ejemplos.mjs` (secciones 6 y 8) |
| "Mis comandos", un pack por fabricante | `src/App.tsx:632-648` (`id = user-<fabricante>`) |
| Activar, desactivar, exportar en "Packs de comandos" | `src/components/PacksModal.tsx:152-190` |
| Al importar: comandos por riesgo, cuántos subió la app, si reemplaza el mismo id | `src/components/PacksModal.tsx:62-69`, `src/components/PacksModal.tsx:103-121` |
| Al compartir, usar variables en vez de IPs, nombres o credenciales | `src/components/PacksModal.tsx:197-201` |

## 09 · Agentes de IA con MCP

| Afirmación | Fuente |
| --- | --- |
| Clientes: Claude Code, Gemini CLI, Codex, Claude Desktop | `src/components/AiSettings.tsx:24-60`, `src-tauri/src/mcp.rs:1-3` |
| Apagado por defecto | `src/lib/settings.ts:151`, `src-tauri/src/mcp.rs:6` |
| Ajustes › Agentes IA | `src/components/SettingsModal.tsx:66`, `src/components/SettingsModal.tsx:348` |
| Solo lectura: lista y lee, sin enviar comandos ni abrir sesiones (apagado por defecto: hay que activarlo) | `src/components/AiSettings.tsx:86-88`, `src-tauri/src/mcp.rs:298-318`, `src/lib/settings.ts:155`; test `read_only_hides_write_tools` |
| Token generado al activar (24 bytes aleatorios, 48 caracteres); mínimo 24 caracteres | `src/components/AiSettings.tsx:69-73`, `src/lib/settings.ts:192-196`, `src-tauri/src/mcp.rs:32`, `src-tauri/src/mcp.rs:71-73` |
| Solo 127.0.0.1; sin token, 401; Origin y Host locales | `src-tauri/src/mcp.rs:89-91`, `src-tauri/src/mcp.rs:177-187` |
| Configuración copiable por cliente; token enmascarado | `src/components/AiSettings.tsx:124-146` |
| Tratar el token como contraseña; "Generar nuevo (invalida el anterior)" | `src/components/AiSettings.tsx:117-119`, `src/components/AiSettings.tsx:149-152` |
| Indicador "IA" en la barra de estado | `src/components/StatusBar.tsx:56-60` |
| Diálogo con equipo y texto completo; Enter no aprueba; foco en Rechazar; rechazo automático a los 2 minutos | `src/components/ApprovalDialog.tsx:18-37`, `src/components/ApprovalDialog.tsx:51-75`, `src-tauri/src/mcp.rs:26`, `src-tauri/src/mcp.rs:112-131` |
| "Aprobar cada comando"; en la terminal local siempre se pide | `src/components/AiSettings.tsx:76-84`, `src-tauri/src/mcp.rs:363-364` |
| El comando aprobado es exactamente el que se muestra (sin caracteres ocultos) | `src-tauri/src/mcp.rs:211-229` |
| Herramientas disponibles: no hay scripts, plugins ni envío a varias sesiones | `src-tauri/src/mcp.rs:271-320` |
| La app declara al agente que la salida es dato no confiable | `src-tauri/src/mcp.rs:247-252`, `src-tauri/src/mcp.rs:289-290` |
| MCP es un protocolo abierto | https://modelcontextprotocol.io |

## 10 · Buenas prácticas

| Afirmación | Fuente |
| --- | --- |
| "Guardar contraseña" en la sesión: bóveda cifrada, se completa al conectar | `src/components/SessionModal.tsx:534`, `README.md:53`, `README.md:174` |
| Los scripts no acceden a la bóveda | `README.md:174` ("No pasa por logs, historial, MCP, scripts ni exportaciones"); `src-tauri/src/scripts.rs:170-181` (la sesión que recibe el script no trae contraseña) |
| Variables con nombre de secreto se piden ocultas | `src/components/TemplateDialog.tsx:17`, `src/components/TemplateDialog.tsx:88` |
| Revisar scripts de carpetas compartidas | `README.md:188` |

## 11 · Cierre

| Afirmación | Fuente |
| --- | --- |
| Ejemplos en `docs/ejemplos` | `docs/ejemplos/README.md` |

## Fuentes externas consultadas

- Python para Windows y macOS: https://www.python.org/downloads/ y https://docs.python.org/3/using/windows.html (Python install manager, comandos `py` y `python`, instalación con WinGet o MSIX).
- OpenSSH en Windows: https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse (Optional Features, `Get-WindowsCapability`, `Add-WindowsCapability`, requisito de administrador).
- iperf3: https://software.es.net/iperf/obtaining.html (ESnet no distribuye binarios) e https://iperf.fr/iperf-download.php (Homebrew, apt-get, yum y compilaciones de terceros para Windows).
- Apple, Command Line Tools (`xcode-select --install`, solo para el texto alternativo del bloqueante de macOS): https://developer.apple.com/documentation/xcode/installing-the-command-line-tools
