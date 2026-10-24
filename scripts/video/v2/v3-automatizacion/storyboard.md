# Video 3 · Automatización: scripts, plugins y programación

Storyboard para grabar con el mismo motor del video 2 (`scripts/video/plugins/`: app real con backend simulado en `demo.html` y láminas en `escenario.html`). Esta etapa es solo de escritura: no hay tomas grabadas ni audio.

- Narración: `guion/NN-*.txt` (un párrafo = un bloque `B0`, `B1`…, como en `guion.mjs`).
- Fuentes de cada afirmación: `fuentes.md`.
- Ejemplos que aparecen en pantalla: `docs/ejemplos/` (probados con `probar-ejemplos.mjs` de esta carpeta).
- Datos en pantalla: solo IPs de documentación (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24), equipos ficticios de `equipos-campus.js` (`core-sw01`, `acc-sw01`, `acc-sw02`, `rtr-borde01`, `sw-lab09`), usuario `operador`, rutas `/Users/operador/...`. Nunca un token real: el de MCP se muestra enmascarado o con un valor de relleno generado para la toma.

## Duración

Cálculo a 150 palabras por minuto, más pausas de pantalla. Total estimado: **12:58** (1.827 palabras de narración = 12:11, más 48 s de pausas).

| # | Capítulo | Palabras | Narración | Pausas | Total |
| --- | --- | --- | --- | --- | --- |
| 01 | Qué se puede automatizar | 173 | 1:09 | 3 s | 1:12 |
| 02 | Botones de la barra de comandos | 143 | 0:57 | 5 s | 1:02 |
| 03 | Plantillas con variables | 155 | 1:02 | 5 s | 1:07 |
| 04 | Comandos al conectar | 141 | 0:56 | 3 s | 0:59 |
| 05 | Instalar las herramientas | 229 | 1:32 | 5 s | 1:37 |
| 06 | Scripts de Python | 291 | 1:56 | 8 s | 2:04 |
| 07 | Plugins | 217 | 1:27 | 6 s | 1:33 |
| 08 | Packs de comandos | 143 | 0:57 | 4 s | 1:01 |
| 09 | Agentes de IA con MCP | 176 | 1:10 | 4 s | 1:14 |
| 10 | Buenas prácticas | 112 | 0:45 | 2 s | 0:47 |
| 11 | Cierre | 47 | 0:19 | 3 s | 0:22 |

La voz del video 2 (`say -v Paulina -r 175`) habla más rápido que 150 ppm: si se reutiliza, el total baja a unos 11:14 y conviene alargar las pausas en las escenas de código.

## Bloqueante antes de grabar el capítulo 05 en macOS

La app abierta desde el Dock o Finder hereda el PATH mínimo de launchd (`/usr/bin:/bin:/usr/sbin:/sbin`) y no lo amplía (`monitor.rs:133` y `scripts.rs:86` usan `Command::new` con el PATH del proceso). Simulado en este Mac con `env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin`: `python3` resuelve a `/usr/bin/python3` (el de las Command Line Tools de Apple) e `iperf3` **no se encuentra**. La terminal local sí los ve porque abre la shell como login shell (portable-pty agrega `-` al argv0) y carga el perfil del usuario.

Consecuencias: en macOS, `brew install iperf3` deja a Herramientas › Velocidad en "iperf3 no está instalado", y el Python de python.org (`/usr/local/bin`) o de Homebrew (`/opt/homebrew/bin`) no se usa. El bloque B2 y parte de B1 del capítulo 05 describen el comportamiento esperado tras corregirlo (agregar `/opt/homebrew/bin` y `/usr/local/bin` al PATH en macOS al iniciar, o leer el PATH de la shell de login). Si la corrección no está antes de grabar, reemplazar en `05-herramientas.txt`:

- B1, "En Windows y macOS, descárgalo desde python.org." por "En Windows, descárgalo desde python.org. En macOS, la app usa el python3 de las herramientas de línea de comandos de Apple: instálalas con xcode-select --install."
- B2, "En macOS, brew install iperf3." por "En macOS, brew install iperf3, y abre NetTerminal desde la terminal para que lo encuentre." (y grabar abriendo el binario desde la terminal).

## Escenas

Convención: **App** = app real con backend simulado; **Lámina** = `escenario.html`; **Código** = lámina con editor y animación de tipeo (velocidad del video 2). La cámara usa el mismo `p.camara(zoom, x, y, ms)`.

### 01 · Qué se puede automatizar (`01-principios.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | Lámina | Portada "Automatización: scripts, plugins y programación". Debajo, siete íconos en fila que se encienden al nombrarlos: botones, plantillas, comandos al conectar, scripts, plugins, packs, agentes IA. Sello "Datos ficticios · IPs RFC 5737". |
| B1 | Lámina | Semáforo de tres niveles con las etiquetas reales de la app: "Consulta", "Cambia config/estado", "Puede cortar servicio". Aparece `configure terminal` y cae en el amarillo con la nota "no reconocido como consulta". |
| B2 | App | Notas con la línea `show version ; reload` (archivo de mock `riesgo-encadenado.txt` del video 2). ⌘↵ abre la confirmación roja "Puede cortar servicio en acc-sw01". Se cancela. |
| B3 | Lámina | Dos columnas. "Pasa por el motor de riesgo": Botones de texto, Notas, Catálogo, Enviar a varias sesiones. "No pasa": Scripts, Plugins, Comandos al conectar. Abajo, aparte: "Agentes IA → aprobación de cada comando". |
| B4 | Lámina | Frase sola: "Primero, solo lectura." |

### 02 · Botones (`02-botones.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | App | Pestaña `acc-sw01` conectada. Zoom a la barra de botones sobre la barra de estado (botones de fábrica: "terminal length 0", "Interfaces"). Inserto breve de Ajustes › Terminal › "Barra de botones". |
| B1 | App | Clic en "+". Modal "Nuevo botón": se tipea la etiqueta `Revisar puerto`, queda "Enviar texto" y se tipean dos líneas: `show interfaces {{interfaz}} status` y `show logging \| include {{interfaz}}`. Guardar. |
| B2 | App | Clic en "Revisar puerto" → "Completar plantilla" con `interfaz` = `Gi1/0/5` → confirmación "¿Enviar 2 líneas a acc-sw01?" → Enviar. La terminal muestra el puerto en `err-disabled` y las líneas `%PM-4-ERR_DISABLE` del log (respuestas de `equipos-campus.js`). |
| B3 | App | Clic derecho sobre el botón: menú "Editar" / "Eliminar". |

### 03 · Plantillas (`03-plantillas.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | App | ⌘J abre Notas con la nota `revision-puerto.txt` (contenido de `docs/ejemplos/plantillas/revision-puerto.txt`); `{{interfaz}}` resaltado en magenta. |
| B1 | App | Selección de las cuatro líneas, ⌘↵. "Completar plantilla" con `Gi1/0/5` y vista previa. Se envía (confirmación de 4 líneas) y la salida llega a `acc-sw01`. Inserto: una variable `{{password}}` muestra el campo oculto y "••••••" en la vista previa (sin enviar). |
| B2 | App | Selector de destino de Notas: "Todas las de una carpeta" › `Campus/Acceso` (`acc-sw01`, `acc-sw02`). |
| B3 | App | ⌘↵ de nuevo: la plantilla pide `interfaz` una vez y abre el diálogo de envío a varias sesiones con 2 equipos, riesgo "Consulta" y "Pausa entre equipos". Enviar. Panel de progreso con "Enviado" por equipo y el botón "Detener". Inserto: mismo diálogo con `clear counters {{interfaz}}` muestra "Para confirmar, escribe la cantidad de equipos (2)" (se cancela). |

### 04 · Comandos al conectar (`04-al-conectar.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | App | Editar sesión `acc-sw02` › "Opciones de terminal" › "Comandos al conectar (uno por línea)": se tipea `terminal length 0`. Guardar y conectar. |
| B1 | App | Conexión de `acc-sw02` en cámara lenta: banner, `Password:` (rótulo "espera: pedido de contraseña"), se escribe la contraseña (asteriscos simulados), aparece `acc-sw02#` y entonces se envía `terminal length 0` (rótulo "prompt detectado"). |
| B2 | Lámina | Tres viñetas: "En cada conexión y reconexión", "Sin motor de riesgo", "Nunca se importan (otros clientes ni JSON)". |

### 05 · Instalar las herramientas (`05-herramientas.txt`)

Ver el bloqueante de macOS arriba.

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | App | ⌘T abre la terminal local. Pantalla dividida en tres columnas rotuladas macOS, Windows y Linux para el resto del capítulo. |
| B1 | Lámina + App | Columna por sistema con la fuente oficial: python.org/downloads (Windows y macOS), `sudo apt install python3` / `sudo dnf install python3` (Linux). En la terminal local se tipea `python3 --version` → `Python 3.12.x` (macOS/Linux) y en la columna Windows `py -3 --version`. Rótulo: "Instalaste con la app abierta → reinicia NetTerminal". Si la app no encuentra Python, toast real: "No se encontró Python 3. Instálalo para usar scripts y plugins." |
| B2 | App | Herramientas › Velocidad con `tool_iperf_version` = null: la tarjeta real "iperf3 no está instalado en este equipo" con `brew install iperf3`, `sudo apt install iperf3` y la línea de Windows. Corte a la misma sección con `iperf 3.17` en el título. Lámina lateral: "iperf.fr enlaza compilaciones de terceros · ESnet no distribuye binarios". En la terminal local: `iperf3 --version`. |
| B3 | Lámina + App | Columnas: macOS "incluido"; Linux `openssh-client` / `openssh-clients`; Windows: captura recreada de Configuración › Características opcionales › "Ver características" › OpenSSH Client, y el bloque `Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0` con el rótulo "PowerShell como administrador" (fuente: Microsoft Learn). En la terminal local: `ssh -V` → `OpenSSH_9.x`. |
| B4 | Lámina + App | Columnas: Windows `tracert` (incluido), macOS `traceroute` (incluido), Linux `traceroute` o `tracepath`. Herramientas › Diagnóstico con un traceroute a `192.0.2.1`. Rótulo final: "Telnet: cliente propio, sin instalar nada". |

Comandos de comprobación que se tipean (todos de consulta en el motor de riesgo):

```text
macOS / Linux                 Windows (PowerShell)
python3 --version             py -3 --version
iperf3 --version              iperf3 --version
ssh -V                        ssh -V
command -v traceroute         (tracert viene con Windows)
```

### 06 · Scripts de Python (`06-scripts.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | App | Barra de botones › "Scripts" › menú con `ejemplo_respaldo.py`, `inventario_csv.py`, `ping_destinos.py`, `primer_script.py` y "Abrir carpeta de scripts". Inserto de la carpeta (Finder simulado en lámina) con `netterminal.py`, `ejemplo_respaldo.py` y los tres ejemplos. |
| B1 | Código → App | Tipeo de `docs/ejemplos/scripts/primer_script.py` sin el docstring (código abajo). Corte a la app: Scripts › `primer_script.py` sobre `core-sw01`; el botón muestra "■ primer_script.py" mientras corre; toasts con las salidas reales. |
| B2 | Lámina | Diagrama: `run(cmd)` = `clear()` → `sendline(cmd)` → `wait_for(prompt)` → salida sin eco ni prompt. Al lado, `read(idle, timeout)`. |
| B3 | Código → App | Resaltado del bucle de `ping_destinos.py` (código abajo), con el bloque `except nt.ScriptTimeout` iluminado. App: la terminal muestra `!!!!!` para dos destinos y `.....` para 198.51.100.20; toasts "198.51.100.20: más de 8 s, esperando el final" y "Sin respuesta: 198.51.100.20". |
| B4 | Código → App | Desplazamiento por `inventario_csv.py` resaltando `leer_version`, `contar_puertos` y la escritura del CSV (sin tipeo completo: el archivo es largo). App: vista dividida 2x2 con `core-sw01`, `acc-sw01`, `acc-sw02`, `rtr-borde01`; el script se ejecuta en cada panel activo, uno por vez. |
| B5 | App + Lámina | Toast de `rtr-borde01`: "rtr-borde01: ISR4331/K9 17.09.05, sin show interfaces status". Corte a una lámina con el CSV como tabla (cinco filas del test, incluida `sw-lab09` con "sin respuesta a tiempo"). |
| B6 | Lámina | Dos tarjetas: "Script de consulta con error → CSV incompleto" (gris) y "Script de cambios con error → equipo sin servicio" (rojo). |

Código con tipeo, B1 (`primer_script.py`):

```python
import netterminal as nt

# Datos de la pestaña activa: nombre, tipo, host, puerto, usuario y puerto serial.
equipo = nt.session.get("name", "equipo")
print(f"Sesión: {equipo} ({nt.session.get('type')} a {nt.session.get('host')})")

# run() envía el comando, espera el prompt y devuelve solo la salida.
salida = nt.run("show version | include Version|uptime", timeout=30)
for linea in salida.splitlines():
    if linea.strip():
        print(linea.strip())
```

Código resaltado, B3 (`ping_destinos.py`, fragmento):

```python
for destino in DESTINOS:
    nt.clear()  # descarta la salida anterior
    nt.sendline(f"ping {destino}")  # envía el comando con Enter
    try:
        salida = nt.wait_for(PROMPT, timeout=8)  # espera el prompt, máximo 8 s
    except nt.ScriptTimeout as e:
        print(f"{destino}: más de 8 s, esperando el final")
        salida = e.output + nt.read(idle=3, timeout=30)
```

Código resaltado, B4 (`inventario_csv.py`, fragmento):

```python
try:
    nt.run("terminal length 0", timeout=10)  # sin paginación (--More--)
    fila.update(leer_version(nt.run("show version", timeout=30)))
    puertos = contar_puertos(nt.run("show interfaces status", timeout=30))
    if puertos is None:
        fila["resultado"] = "sin show interfaces status"
    else:
        fila.update(puertos)
        fila["resultado"] = "ok"
except nt.ScriptTimeout as e:
    fila["resultado"] = "sin respuesta a tiempo"
except RuntimeError as e:
    fila["resultado"] = f"error: {e}"
```

(El fragmento omite los `print` del archivo real para caber en pantalla; el texto que se muestra debe tomarse del archivo con esas dos líneas quitadas, nunca reescrito a mano.)

Salidas reales (de `probar-ejemplos.mjs`) para los toasts:

```text
primer_script.py   Sesión: core-sw01 (ssh a 192.0.2.1) | Cisco IOS XE Software, Version 17.12.04 | ... | core-sw01 uptime is 47 days, 17 hours, 30 minutes
ping_destinos.py   192.0.2.1: 100 % | 192.0.2.10: 100 % | 198.51.100.20: más de 8 s, esperando el final | 198.51.100.20: 0 % | Sin respuesta: 198.51.100.20
inventario_csv.py  acc-sw01: C9200L-24P-4G 17.09.05, ok | 2 equipos en .../reportes/inventario.csv
```

### 07 · Plugins (`07-plugins.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | App | Herramientas (⌘E) › Plugins, con `diagnostico-basico` 1.1.0 ya instalado (del video 2). |
| B1 | Código | Tipeo de `plugin.json` de `revision-puertos` (archivo completo) y luego resaltado de `main.py`: `ACCION = os.environ.get("NT_ACTION", "")`, el diccionario `ACCIONES` y la línea `from analisis import ...`. Árbol de archivos a la izquierda: `analisis.py`, `main.py`, `plugin.json`. |
| B2 | Código | Zoom a `"permissions": ["session", "files"]` con los textos de la app: "Leer y enviar comandos a la sesión conectada" (marcado "la app lo hace cumplir") y "Leer o escribir archivos en tu equipo" (marcado "declarativo"). |
| B3 | App | "Desde carpeta" (`window.__nextOpen = "/Users/operador/proyectos/revision-puertos"`). Inserto de lámina con los rechazos de la validación (cinco viñetas). |
| B4 | App | Tarjeta "Revisar antes de instalar: Revisión de puertos 1.0.0", "Autor declarado: Equipo de redes", permisos, "Código Python del plugin · 3 archivos" con `# ===== main.py =====` y, al desplazar, `# ===== analisis.py =====`. Clic en "Instalar y habilitar". Luego "Resumen de puertos" sobre `acc-sw01`: "Salida de plugins" con las líneas reales. |
| B5 | App | Reinstalación con `version` 1.0.1: "▲ Reemplazará la versión instalada de este plugin." Corte: plugin alterado (`tampered`) con "✕ Sus archivos cambiaron desde que lo aprobaste…", "Revisar código", "Aprobar estos cambios y habilitar". Final: papelera → "¿Desinstalar Revisión de puertos?" (se cancela). |

Salidas reales de las acciones en `acc-sw01`:

```text
Resumen de puertos   acc-sw01: 9 puertos · 5 connected, 1 disabled, 1 err-disabled, 2 notconnect | err-disabled: Gi1/0/5
Puertos con errores  Gi1/0/7: 304 errores | Gi1/0/2: 6 errores
Exportar a CSV       9 puertos exportados a /Users/operador/.../reportes/puertos-acc-sw01.csv
```

### 08 · Packs (`08-packs.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | App | ⌘L abre el catálogo con Cisco. Inserto de lámina con el JSON de `docs/ejemplos/packs/turno-puertos.json` (sin tipeo). |
| B1 | App | "+ Propio" → "Nuevo comando · Cisco": se tipea `clear counters {{interfaz}}`, explicación, categoría Interfaces, riesgo "Consulta". Aparece "▲ Por su contenido, la app lo tratará como "Cambia config/estado"." Se cambia a "Cambia config/estado" y "Guardar en Mis comandos". |
| B2 | App | Ventana "Packs de comandos": "Mis comandos (Cisco)" con el ícono "Exportar para compartir"; diálogo de guardado `user-cisco.json`. |
| B3 | App | "Importar pack" con `pack-riesgo-mal-declarado.json` (de esta carpeta): resumen "2 comandos · Consulta: 1 · Cambia config/estado: 1", "▲ 1 comandos declaraban menos riesgo del real; la app los ajustó." Cancelar. Luego importar `turno-puertos.json`: 3 comandos de consulta, se ven en el catálogo de Cisco. Zoom final a la nota del pie: "Al compartir un pack no incluyas IPs…". |

### 09 · Agentes de IA con MCP (`09-agentes-mcp.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | Lámina | Diagrama: agente (Claude Code, Gemini CLI, Codex) → `http://127.0.0.1:47821/mcp` + token → NetTerminal → equipos. Un candado en la flecha local. |
| B1 | App | Ajustes › Agentes IA. Primero se activa "Solo lectura", después "Activar servidor MCP": el campo Token se llena (enmascarado) y el estado muestra "Escuchando en http://127.0.0.1:47821/mcp". |
| B2 | App | "Configurar tu agente" › Claude Code › "Copiar" (token enmascarado en el bloque). Botón "Generar nuevo (invalida el anterior)" resaltado. Zoom a la barra de estado: "IA". |
| B3 | App | Se desactiva "Solo lectura". Diálogo de aprobación real (evento `mcp-approval` con `tool: "send_command"`, `target: "acc-sw01"`, `detail: "show interfaces status"`): "Un agente de IA quiere ejecutar en", foco en "Rechazar", texto "Se rechaza solo en 2 minutos". Se presiona Enter (no pasa nada, rótulo "Enter no aprueba") y luego clic en "Permitir". |
| B4 | Lámina | Lista de herramientas MCP: `list_sessions`, `list_connections`, `read_output` (siempre) y `send_command`, `open_session` (solo sin Solo lectura). Tachado: scripts, plugins, envío a varias sesiones. |

### 10 · Buenas prácticas (`10-buenas-practicas.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | Lámina | Lista numerada que se completa: Laboratorio · Consultas primero · Control de versiones (un `git log` ficticio con "revision-puertos 1.0.1"). |
| B1 | App | Formulario de sesión con "Guardar contraseña" marcado y el campo enmascarado; inserto de Ajustes › Credenciales. Rótulo: "Los scripts no acceden a la bóveda". |
| B2 | Lámina | "Revisa el código antes de ejecutarlo" con la tarjeta de revisión del plugin de fondo. |

### 11 · Cierre (`11-cierre.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | Lámina | Resumen en siete íconos (los mismos de la portada) con una frase cada uno. |
| B1 | Lámina | Árbol de `docs/ejemplos/` y logo. |

## Escenas simuladas y extensiones del backend que faltan

El motor del video 2 cubre botones, Notas, plantillas, packs, plugins y el diálogo de aprobación. Para este video hace falta:

1. **Campus multi-equipo en el navegador.** `mock-video.js` responde con `equipo-ficticio.js` (un solo equipo). Debe elegir la respuesta por el nombre de la sesión de cada conexión con `respuestaCampus(cmd, nombre)` de `equipos-campus.js`, y prompts por equipo. Sesiones: carpeta `Campus/Núcleo` (`core-sw01` 192.0.2.1), `Campus/Acceso` (`acc-sw01` 192.0.2.11, `acc-sw02` 192.0.2.12), `Campus/Borde` (`rtr-borde01` 198.51.100.1).
2. **Datos de scripts por equipo.** `datosVideo()` hoy guarda una ejecución por script. Para `inventario_csv.py` se necesita una por sesión (`D.scripts[script][nombre]`), generadas con `ejecutar(..., { responder: respuestaCampus, sessionInfo })` como en `probar-ejemplos.mjs`, y `run_script` del mock debe usar la de la pestaña activa.
3. **Ping lento.** La simulación de `run_script` escribe cada comando cada 900 ms; para `ping_destinos.py` el tercer destino debe tardar unos 10 s con `.` progresivos (o un corte con rótulo "10 s después").
4. **Plugin de varios archivos.** `vista()` en `datos.mjs` arma el listado solo con `main.py`. Para `revision-puertos` debe agregar `analisis.py` después de `main.py` (orden de `code_listing`, `plugins.rs:415`) y `files` con los tres archivos; también las versiones 1.0.0 y 1.0.1 y un estado `tampered`.
5. **Velocidad sin iperf3.** `tool_iperf_version` del mock de capturas devuelve `"iperf 3.17"`; la escena B2 del capítulo 05 necesita poder devolver `null`.
6. **Terminal local con comprobaciones.** Respuestas para `python3 --version`, `py -3 --version`, `iperf3 --version`, `ssh -V`, `command -v traceroute` en una pestaña `local` (hoy la terminal local del mock no responde comandos).
7. **Toast de Python ausente.** `run_script` debe poder fallar con "No se encontró Python 3. Instálalo para usar scripts y plugins." (`scripts.rs:147`).
8. **Comandos al conectar con login.** Conexión de `acc-sw02` que muestra `Password:`, espera la escritura y solo con `acc-sw02#` recibe `terminal length 0`. El mock debe ejecutar el `runOnConnect` real de `TerminalView` (basta con que el banner, el pedido de contraseña y el prompt lleguen por el canal de datos con pausas).
9. **MCP.** Handler `mcp_configure` que devuelva "Escuchando en http://127.0.0.1:47821/mcp", token de relleno fijo para la toma, y un disparador `mcp-approval` con `tool: "send_command"` (el de `scripts/screenshots/mock.js:1142` usa `"run_command"`, que no existe en `mcp.rs`; el texto del diálogo no cambia, pero conviene corregirlo).
10. **Láminas nuevas en `escenario.html`.** Semáforo de riesgo, columnas "pasa / no pasa", diagrama de `run()`, tabla CSV, diagrama MCP, tres columnas por sistema operativo con capturas recreadas de python.org, Características opcionales de Windows e iperf.fr (recreadas, sin logos ni marcas de terceros más allá del nombre).
11. **Explorador de archivos.** Lámina de Finder simulada para la carpeta de scripts y para `reportes/`.

## Pruebas antes de grabar

```bash
node scripts/video/v2/v3-automatizacion/probar-ejemplos.mjs   # Node < 22.18: agrega --experimental-strip-types
node scripts/video/plugins/probar-ejemplos.mjs                 # ejemplos del video 2 (siguen pasando)
cd src-tauri && cargo test --lib plugins::tests                # revisión de instalación de los tres plugins de ejemplo
```
