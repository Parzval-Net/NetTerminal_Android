# NetTerminal

Cliente de conexión liviano y multiplataforma (macOS, Windows, Linux) para el trabajo diario con equipos de red y servidores: **SSH, Telnet, Serial y terminal local**, con sesiones guardadas en carpetas y pestañas.

Construido con [Tauri 2](https://tauri.app) (backend en Rust) y xterm.js. Usa el WebView del sistema: la app pesa ~8 MB, usa ~90 MB de memoria en reposo (proceso de la app más los del WebView) y 0 % de CPU sin actividad (medido en macOS, v0.9.0).

![NetTerminal: sesiones en carpetas, terminal con resaltado por fabricante y catálogo de comandos](docs/screenshots/terminal.png)

**Ficha del producto:** [página](https://parzval-net.github.io/Net_Terminal/) · [PDF para compartir](docs/NetTerminal-ficha.pdf) · [Descargar la última versión](https://github.com/Parzval-Net/Net_Terminal/releases/latest)

## Capturas

> Capturas en modo claro con datos ficticios (IPs de documentación RFC 5737 y nombres genéricos). La app también tiene modo oscuro y 17 temas de terminal.

| | |
| --- | --- |
| **Notas y plantillas** con variables `{{vlan}}` que se envían a la sesión<br>![Notas](docs/screenshots/notas.png) | **Monitoreo** con gráfico de latencia, pérdida y alarma sonora<br>![Monitoreo](docs/screenshots/monitoreo.png) |
| **Topología CDP/LLDP** con ruta resaltada y Port-channel<br>![Topología](docs/screenshots/topologia.png) | **Comparación con un snapshot**: enlaces y equipos nuevos o perdidos<br>![Cambios de topología](docs/screenshots/topologia-cambios.png) |
| **Comandos de sistema operativo**: Windows, macOS y Linux por distribución<br>![Comandos de sistema](docs/screenshots/comandos-so.png) | **Packs de comandos**: 1.777 comandos, ampliables<br>![Packs](docs/screenshots/packs.png) |
| **Modo oscuro**: la interfaz sigue al sistema o se fija en claro u oscuro<br>![Modo oscuro](docs/screenshots/modo-oscuro.png) | **17 temas de terminal** con vista previa (Ámbar, Dracula, Nord, Tokyo Night…)<br>![Temas](docs/screenshots/ajustes.png) |
| **Pestañas verticales** opcionales, como en Edge o Firefox<br>![Pestañas verticales](docs/screenshots/pestanas-verticales.png) | **Contraseñas guardadas** en una bóveda cifrada, nunca visibles<br>![Credenciales](docs/screenshots/credenciales.png) |
| **Velocidad**: speedtest e iperf3 cliente/servidor<br>![Velocidad](docs/screenshots/velocidad.png) | **Vista dividida en modo oscuro**<br>![Vista dividida oscura](docs/screenshots/modo-oscuro-dividida.png) |
| **Vista dividida** 2x2 para seguir varios equipos a la vez<br>![Vista dividida](docs/screenshots/vista-dividida.png) | **Respaldos y comparación** de configuraciones con secretos enmascarados<br>![Respaldos](docs/screenshots/respaldos.png) |
| **Enviar a varias sesiones** con lista de equipos y control de riesgo<br>![Difusión](docs/screenshots/difusion.png) | **Alertas por palabra clave** en la salida<br>![Alertas](docs/screenshots/alertas.png) |
| **Importar sesiones** desde ssh_config, PuTTY, SecureCRT, MobaXterm o CSV<br>![Importar](docs/screenshots/importar.png) | **Calculadora de subredes** IPv4/IPv6 con división en subredes<br>![Subredes](docs/screenshots/subredes.png) |
| **Cliente SNMP** v1/v2c/v3 con conjuntos de OIDs y receptor de traps<br>![SNMP](docs/screenshots/snmp.png) | **Generador de configuración SNMP** de solo lectura para 6 plataformas<br>![Generador SNMP](docs/screenshots/snmp-generador.png) |
| **Transferencias**: TFTP, HTTP, FTP y SFTP con la carpeta compartida<br>![Transferencias](docs/screenshots/transferencias.png) | **Conexión rápida** sin guardar la sesión (ícono de rayo)<br>![Conexión rápida](docs/screenshots/conexion-rapida.png) |
| **Notas protegidas** con contraseña y bloqueo por inactividad<br>![Notas protegidas](docs/screenshots/notas-protegidas.png) | **Acerca de** con versión y actualizaciones<br>![Acerca de](docs/screenshots/acerca.png) |

## Funciones

| Área | Detalle |
| --- | --- |
| SSH | Usa el OpenSSH del sistema: respeta `~/.ssh/config`, agente, llaves y `known_hosts`. Jump host (ProxyJump), túneles locales, remotos y dinámicos por sesión (escucha en 127.0.0.1 por defecto) y opción de algoritmos legacy para equipos antiguos. Opcional y apagado por defecto: Ajustes › Terminal › "Activar algoritmos legacy automáticamente" reconecta una vez en modo compatible si el equipo exige ssh-rsa, SHA1 o CBC y lo deja guardado en la sesión. Usa algoritmos débiles: actívalo solo en redes de gestión confiables. |
| Telnet | Cliente nativo en Rust (negociación ECHO, SGA, tipo de terminal y tamaño de ventana). No requiere `telnet` instalado. |
| TCP crudo | Conexión TCP directa sin negociación Telnet, para servidores de consola (puertos 2001+). |
| Serial | Puertos detectados automáticamente, 1200 a 921600 baudios, 8N1/7E1, control de flujo, envío de Break. |
| Terminal | Pestañas que mantienen la sesión al cambiar, vista dividida (2 o 2x2), reconexión con Enter o automática con espera creciente, búsqueda en la salida, copiar al seleccionar y pegar con clic derecho (con confirmación si son varias líneas), zoom de fuente. |
| Enviar a varias sesiones | Desde Notas, catálogo o botones: pestaña actual, pestañas elegidas, una carpeta o los paneles visibles. Confirma con la lista de equipos y el riesgo de cada línea (los cambios exigen escribir la cantidad de equipos), envía en secuencia y se puede detener. |
| Alertas | Reglas por texto o expresión (globales o por carpeta) que avisan en pantalla, con sonido y marca en la pestaña. Máximo un aviso cada 10 s por regla y sesión; nunca envían comandos. Sin reglas no consumen nada. |
| Respaldos | Respaldo de configuración (solo comandos de consulta, hasta 3 equipos a la vez) en `data/backups`, con secretos enmascarados, y comparación entre fechas o entre equipos. |
| Importar | Sesiones desde `~/.ssh/config`, PuTTY (.reg), SecureCRT (XML), MobaXterm (.mobaconf/.mxtsessions) y CSV, con vista previa. Nunca importa contraseñas, comandos al conectar, proxies ni túneles. |
| Conexión rápida | Formulario SSH, Telnet, TCP crudo o Serial sin guardar la sesión, con el botón sobre la búsqueda de sesiones, el rayo junto al "+" de pestañas o ⌘O / Ctrl+Shift+O (ícono de rayo en la pestaña). "Guardar como sesión…" en el menú de la pestaña y en la barra de estado. |
| Historial | Destinos recientes en la conexión rápida (⌘K) y últimos comandos enviados a cada equipo desde Notas, catálogo o botones (nunca lo tecleado). |
| Notas | Panel lateral con notas en `.txt` (autoguardado, resaltado por fabricante), búsqueda en todas las notas y buscar/reemplazar. Envía la línea, la selección o todo a la sesión activa (con control de riesgo y pausa por línea opcional) y captura texto de la terminal. |
| Notas protegidas | Una nota se puede proteger con contraseña: queda cifrada en disco (`.ntenc`, XChaCha20-Poly1305 con llave Argon2id por nota) y se bloquea a mano, por inactividad (5 min por defecto), al cambiar de nota o al cerrar el panel. No aparece en la búsqueda de contenido. |
| Logs | Grabación de la sesión a texto plano (sin códigos de color) en la carpeta `logs` o en una carpeta que elijas (validada, archivos 600): nombre por patrón (`{session}`, `{host}`, `{folder}`, `{date}`, `{time}`), anexar o archivo nuevo, rotación diaria, hora por línea y secretos enmascarados (activado por defecto). El log continúa en el mismo archivo al reconectar. |
| Plantillas | Variables `{{nombre}}` en Notas: al enviar se piden los valores (se recuerdan los últimos, salvo las que parecen contraseñas o claves, que se piden ocultas y no se guardan). |
| Sesiones | Carpetas y subcarpetas ilimitadas, arrastrar y soltar, menú contextual (conectar todas, nueva sesión aquí, renombrar, duplicar), indicador de sesiones abiertas. |
| Contraseñas | Opcional por sesión (SSH, Telnet, TCP y Serial): se guarda en una bóveda cifrada de la app (`credentials.vault`) y se completa sola en el primer pedido de contraseña al conectar; en Telnet/Serial también envía el usuario. Campo solo de escritura (nunca se muestra), llave en el llavero del sistema o contraseña maestra en modo portable (Ajustes › Credenciales). |
| Botones y scripts | Barra de comandos rápidos (texto con `{{variables}}` o script). Scripts Python con API mínima `import netterminal as nt` (`run`, `send`, `wait_for`, `read`), similar a `crt.Screen` de SecureCRT. Incluye ejemplo de respaldo de configuración. |
| Agentes IA (MCP) | Servidor MCP local para Claude Code, Claude Desktop, Gemini CLI y Codex: listar sesiones, leer salida, ejecutar comandos con aprobación del usuario y modo solo lectura. Apagado por defecto. |
| Topología | Diagrama de vecinos CDP/LLDP (Cisco, Huawei, Juniper, Fortinet) con estado de puertos y Port-channel, ruta entre dos equipos, snapshots para comparar antes y después de un cambio, y exportación a SVG, draw.io, CSV o Mermaid. |
| Comandos (⌘L) | Catálogo de 1.777 comandos verificados con fuente oficial. Equipos de red: Cisco (IOS, IOS-XE, NX-OS, IOS-XR, ASA), Juniper (Junos, Evolved, EX sin ELS), Fortinet (FortiOS 6.4 a 7.6), Huawei (VRP5, VRP8, YunShan OS en AR5700/AR6700/AR8000), Check Point (R80.40 a R82, clish y expert) y WatchGuard (Fireware 12.x y 2025+). Sistemas operativos (consultas de red: interfaces, DNS, rutas, ARP, conexiones, tráfico, Wi-Fi, firewall): Windows 10/11/Server (PowerShell), macOS 12 a 27 y Linux (Debian, Ubuntu, RHEL/Rocky/Alma, Fedora, SUSE, Arch, Alpine). Sintaxis por plataforma detectada, nivel de riesgo, favoritos, comandos propios y packs importables. En la terminal local se abre el catálogo del sistema del PC. |
| Opciones por sesión | Comandos al conectar, reconexión automática, Enter como CR/LF/CRLF, eco local y codificación (UTF-8, Latin-1, Windows-1252). |
| Pestañas | Horizontales (por defecto) o verticales a la izquierda, con ancho ajustable y modo solo íconos. Renombrar, desconectar sin cerrar, copiar toda la salida, limpiar historial, reiniciar terminal e indicador de actividad en segundo plano. |
| Herramientas (⌘E) | Monitoreo ICMP/TCP con gráfico y alarma sonora; ping, traceroute y puertos; topología; calculadora de subredes; speedtest (Cloudflare, respeta el proxy del sistema) e iperf3; respaldos; transferencias (TFTP, HTTP, FTP y SFTP); Syslog; SNMP. Cada módulo se activa en Ajustes › Módulos. |
| SNMP | Cliente de consulta v1, v2c y v3 (USM): GET, GETNEXT, WALK acotado y cancelable y GETBULK. Solo lectura, sin SET. v3 con SHA-256 + AES-128 por defecto (RFC 7860 y RFC 3826), AES-192/256 en variantes net-snmp y Cisco, MD5/DES solo como legado. Conjuntos de OIDs (identidad, interfaces con contadores de 64 bits y tasas, almacenamiento, CPU, procesos, carga y memoria) con exportación CSV. Receptor de traps apagado por defecto: v1, v2c, informs confirmados y traps v3 verificados con el usuario del perfil. Community y contraseñas v3 solo en la bóveda cifrada, atadas al host y puerto del perfil. |
| Generador SNMP | Configuración de agente de solo lectura para Cisco IOS/IOS-XE, NX-OS, Huawei VRP, Junos, FortiOS y net-snmp (`snmpd.conf`): v3 authPriv por defecto, ACL por NMS, vista sin subárboles sensibles, traps o informs, interfaz de origen y sysContact/sysLocation. Nunca genera communities RW. Los secretos van como marcadores (`<AUTH_PASS>`) salvo que los escribas, y no se guardan. La sintaxis que depende de la versión del equipo queda marcada en un comentario para verificar. |
| FTP y SFTP | Servidor FTP de la carpeta compartida (usuario y contraseña nuevos en cada inicio, solo lectura por defecto, sin FTP bounce) y cliente FTP/FTPS con TLS verificado por los certificados del sistema. SFTP con el OpenSSH del sistema: en el gestor de archivos y como pestaña `sftp` interactiva. FTP no cifra: la app lo advierte y sugiere SCP/SFTP o HTTP. |
| Gestor de archivos | Dos paneles PC ↔ equipo sobre la sesión abierta: lista el flash, envía o trae archivos por TFTP/HTTP y respalda la configuración (Cisco, NX-OS, Huawei, Junos). La app escribe el `copy`, responde las confirmaciones y muestra el progreso. También por SCP cifrado o SFTP (pestaña donde escribes la contraseña), con verificación MD5 automática del firmware enviado y aviso de espacio insuficiente. |
| Plugins | Carpeta con `plugin.json` + script Python. Instalación con revisión de permisos y código; se bloquean si sus archivos cambian. |
| Ajustes | Agrupados en General, Sesiones y datos, Herramientas e Integraciones, con buscador. Actualizaciones y créditos ("Desarrollado en conjunto con Claude") en Acerca de. |
| Actualizaciones | Aviso de versión nueva desde GitHub Releases y botón "Actualizar y reiniciar": descarga, verifica la firma del proyecto e instala. Nunca instala sin confirmación y avisa si hay sesiones abiertas. En modo portable y en `.deb` la actualización sigue siendo manual. |
| Compartir | Exportar/importar sesiones y reglas de resaltado como JSON vía portapapeles. |
| Apariencia | Interfaz en modo sistema, claro u oscuro, con contraste WCAG AA en textos (4,5:1) y controles (3:1). 17 temas de terminal (Ámbar, Fósforo verde, Clásico, Dracula, Nord, Solarized, Gruvbox, One Dark, Tokyo Night, Catppuccin Mocha y Latte, Monokai, GitHub Dark, Rosé Pine, etc.), fuente, tamaño, interlineado y cursor configurables. |
| Resaltado | Coloreo de salida por regex para Cisco/Arista, Juniper, Huawei/H3C, Fortinet y reglas comunes (IPv4/IPv6, MAC, up/down, permit/deny, contadores de error > 0, syslog por severidad). Perfil por sesión, reglas propias con vista previa e importación/exportación JSON. |

## Atajos

| Acción | macOS | Windows / Linux |
| --- | --- | --- |
| Ajustes | ⌘, | Ctrl+, |
| Notas | ⌘J | Ctrl+Shift+J |
| Catálogo de comandos | ⌘L | Ctrl+Shift+L |
| Duplicar pestaña | ⌘D | Ctrl+Shift+D |
| Enviar línea o selección / todo (en Notas) | ⌘↵ / ⌘⇧↵ | Ctrl+Enter / Ctrl+Shift+Enter |
| Buscar sesión / conexión rápida | ⌘K | Ctrl+Shift+K |
| Nueva sesión | ⌘N | Ctrl+Shift+N |
| Conexión rápida sin guardar | ⌘O | Ctrl+Shift+O |
| Terminal local | ⌘T | Ctrl+Shift+T |
| Cerrar pestaña | ⌘W | Ctrl+Shift+W |
| Buscar en la salida | ⌘F | Ctrl+Shift+F |
| Mostrar/ocultar sesiones | ⌘B | Ctrl+Shift+B |
| Cambiar de pestaña | Ctrl+Tab · ⌘1…9 | Ctrl+Tab |
| Zoom | ⌘+ ⌘- ⌘0 | Ctrl+Shift++ Ctrl+Shift+- Ctrl+Shift+0 |
| Copiar / pegar | ⌘C / ⌘V | Ctrl+Shift+C / Ctrl+Shift+V |

En Windows/Linux los atajos usan Ctrl+Shift para no interferir con Ctrl+C, Ctrl+W, etc. dentro de la terminal.

Conexión rápida (⌘K): `ssh admin@192.0.2.1:2222`, `telnet 192.0.2.5 23`, `admin@router` o solo la IP. Para Serial o TCP crudo usa el formulario del rayo en la pantalla de inicio.

## Resaltado de sintaxis

Sigue el modelo de keyword highlighting de SecureCRT y de ChromaTerm: cada regla es una expresión regular con color, estilo y grupo de captura opcional. Los colores con nombre usan la paleta ANSI del tema activo, así el resaltado se ve bien en cualquier tema.

- Prioridad: reglas propias, luego fabricante, luego comunes.
- Solo se procesan líneas sin secuencias de escape previas y nunca en pantallas completas (vim, top, less), para no alterar salidas que ya traen color.
- Los logs se graban sin resaltado.
- "Personalizar" en un esquema copia sus reglas a tus reglas propias para cambiar colores.
- Exportar/Importar copia las reglas como JSON, útil para compartir un estándar en el equipo.

## Modo portable multisistema

Un solo archivo que corra en los tres sistemas no existe, porque cada uno usa un formato de ejecutable distinto. Lo que sí hay es una **carpeta portable** con los tres ejecutables y los datos compartidos:

```
NetTerminal/
  NetTerminal.exe         Windows
  NetTerminal.app         macOS
  NetTerminal.AppImage    Linux
  portable                marcador (archivo vacío)
  data/                   sesiones, ajustes, notas y logs, compartidos
```

El workflow `build` la genera como artefacto `NetTerminal-portable.zip`. En macOS, si la app se abre desde una ubicación en cuarentena, el sistema puede ejecutarla desde una ruta temporal y no detectar la carpeta portable. Para evitarlo, sin administrador: `xattr -dr com.apple.quarantine NetTerminal.app`.

## Modo portable (detalle)

Por defecto las sesiones se guardan en el directorio de configuración del sistema. Si junto al ejecutable existe un archivo llamado `portable` (o una carpeta `data`), todo se guarda en `./data`, ideal para llevarlo en un pendrive.

- **Windows**: `NetTerminal.exe` + archivo `portable` en la misma carpeta. Requiere WebView2, incluido en Windows 10 y 11.
- **Linux**: el `.AppImage` es autocontenido.
- **macOS**: `NetTerminal.app` es autocontenido.

## Ejecutar sin permisos de administrador

| Sistema | Cómo | Requisito previo |
| --- | --- | --- |
| Windows 10/11 | Zip portable (`NetTerminal.exe` + `portable`) o instalador NSIS, que instala solo para el usuario actual. No se genera MSI porque exige administrador. | WebView2, que viene incluido en Windows 11 y en Windows 10 actualizado. Si falta, el instalador lo descarga en modo por usuario. |
| macOS | Copiar `NetTerminal.app` a cualquier carpeta (`~/Applications`, un pendrive). | Sin firma de Apple, la primera vez se abre con clic derecho › Abrir. |
| Linux | `chmod +x NetTerminal.AppImage` y ejecutar. | Para usar el puerto serial, el usuario debe pertenecer al grupo `dialout` (o `uucp`). Agregarlo requiere administrador una sola vez. |

En equipos corporativos con AppLocker, Intune o Gatekeeper estricto, un binario sin firma puede quedar bloqueado aunque no pida administrador. Para distribuirlo internamente conviene firmarlo (certificado de firma de código en Windows, Developer ID en macOS).

## Seguridad

Auditoría del binario con REA (Ghidra y utilidades nativas de macOS) y revisión del código:

| Control | Estado |
| --- | --- |
| Binario PIE, stack no ejecutable, solo bibliotecas del sistema, sin RPATH | Verificado |
| Sin secretos ni conexiones salientes incrustadas, sin rutas locales (`--remap-path-prefix` en CI) | Verificado |
| Dependencias: `npm audit` y `cargo audit` sin vulnerabilidades (bloquean el CI) | Verificado |
| SSH: el host no puede inyectar opciones (`--` y validación); "argumentos extra" se valida con la misma semántica de getopt que ssh (flags agrupados incluidos) y bloquea ProxyCommand, LocalCommand, KnownHostsCommand, Match, Include, PKCS11Provider, SecurityKeyProvider, -F, -I, -E y argumentos sueltos; ni estos argumentos ni los comandos al conectar se importan desde JSON | Con tests |
| Motor de riesgo: comandos encadenados (`;`, `&&`, `\|\|`, `&`, `$(...)` y comillas invertidas) se evalúan por partes, así `show clock ; reload` no pasa como consulta | Con tests |
| Comandos ocultos: un `\r` o caracteres de control dentro de un comando (packs, MCP, pegado) se tratan como líneas separadas o se rechazan, así lo que se confirma es exactamente lo que llega al equipo; el pegado quita marcadores de "bracketed paste" | Con tests |
| Plugins: se rechaza código que la revisión no puede mostrar (bytecode .pyc, binarios nativos, .pth, archivos que no son UTF-8 o que declaran otra codificación) | Con tests |
| Host, jump host y usuario de SSH sin metacaracteres de shell (defensa ante CVE-2023-51385 en OpenSSH < 9.6, como el de Windows) | Con tests |
| Exportaciones CSV sin fórmulas ejecutables en Excel; Syslog sin inyección de líneas falsas en el log; CSP con `object-src`, `base-uri`, `form-action` y `frame-src` en `none` | Código |
| Repositorio y publicación: acciones fijadas a SHA, permisos mínimos, sin interpolación en scripts, secretos de firma solo en el paso que firma, el tag debe apuntar a `main` y coincidir con la versión, Dependabot y [SECURITY.md](SECURITY.md); historial revisado con gitleaks y workflows con zizmor | Verificado |
| Envío a varias sesiones: lista de equipos y riesgo por línea antes de enviar, confirmación escribiendo la cantidad de equipos para cambios, envío secuencial con "Detener"; los agentes MCP no pueden usarlo | Código |
| Logs y respaldos: secretos (password, secret, community, key, PSK) enmascarados por defecto; rutas saneadas dentro de la carpeta de datos; permisos 600 | Con tests |
| Importación: tope de 5 MB, validación de host, usuario y carpeta; se descartan contraseñas, `ssh_args`, comandos al conectar, proxies y túneles | Con tests |
| Túneles SSH: puertos y direcciones validados, escucha en 127.0.0.1 por defecto, aviso al usar 0.0.0.0 o túneles remotos, y doble validación con las reglas de argumentos extra | Con tests |
| Alertas: expresiones con el motor lineal de Rust (sin ReDoS), sin respuestas automáticas, límite de avisos por regla | Con tests |
| Envío desde Notas y botones: pasa por el mismo motor de riesgo que el catálogo; lo que puede cortar servicio se confirma siempre | Código |
| Reconexión automática con espera creciente (5 s a 60 s) para no gatillar bloqueos de cuenta en TACACS/RADIUS; "Conectar todas" abre en tandas de 5 | Código |
| Pegado: un bloque de varias líneas en un equipo remoto pide confirmación con vista previa (también con Cmd+V del menú nativo) | Código |
| TFTP: la escritura se habilita solo durante una extracción, máx. 16 sesiones simultáneas, retransmisiones descartadas, tope de 8 GB por archivo y temporales únicos | Código |
| Plugins: la revisión muestra todo el código Python; un plugin alterado no se reaprueba sin revisar su código; Python corre con `-B` y se borra `__pycache__` antes de ejecutar | Código |
| Actualizaciones: firma Ed25519 verificada antes de instalar, índice y paquetes solo desde los releases del repositorio oficial, instalación siempre con confirmación | Diseño |
| Datos: si `sessions.json` o `settings.json` no se pueden leer completos, se respalda el original (`*.corrupt-<fecha>.json`) y se conservan las sesiones válidas | Con tests |
| MCP: apagado por defecto, solo 127.0.0.1, token comparado en tiempo constante, validación de Origin y Host (DNS rebinding), cuerpo máx. 1 MB, aprobación por comando (siempre en terminal local), máx. 3 aprobaciones pendientes, modo solo lectura | Con tests |
| Prompt injection: la salida de equipos se declara como dato no confiable para el agente y cada comando se muestra completo antes de aprobar | Diseño |
| Resaltado: regex propias o importadas con riesgo de ReDoS se rechazan; los scripts usan el motor `regex` de Rust (tiempo lineal) | Con tests |
| Telnet: subnegociación acotada a 1 KB | Código |
| Datos: carpeta 700 y archivos 600 en macOS/Linux | Verificado |
| Contraseñas guardadas: bóveda XChaCha20-Poly1305 con cabecera autenticada; llave aleatoria de 256 bits en el llavero del sistema (Keychain, Administrador de credenciales, Secret Service) o, en modo portable o sin llavero, derivada con Argon2id (64 MiB, t=3) de una contraseña maestra con espera creciente ante intentos fallidos. Ningún comando devuelve una contraseña a la interfaz; se autocompleta una sola vez en 60 s, nunca tras "Permission denied"/"% Login invalid", en una passphrase de llave SSH, en la confirmación de llave de host ni en un segundo prompt, y solo si el destino coincide con la sesión guardada, argumentos extra de ssh incluidos (un `-o HostName`, `-J` o `-p` distinto cancela el autocompletado). Con jump host solo se responde el prompt que nombra al equipo de destino, nunca el del bastión. No pasa por logs, historial, MCP, scripts ni exportaciones; los búferes se borran de memoria | Con tests |
| Notas y scripts: nombres saneados, sin rutas fuera de su carpeta | Con tests |
| Enlaces OSC 8 en la salida del equipo: solo `http(s)` y se abren en el navegador del sistema | Código |
| Plantillas: variables con pinta de secreto (password, secret, key…) no se guardan, se piden en un campo oculto y se enmascaran en la vista previa | Código |
| SNMP: secretos atados al host y puerto del perfil (la community o el HMAC v3 no viajan a otro equipo); BER propio con topes de tamaño, OIDs y varbinds, con fuzzing | Con tests |
| Receptor de traps v3: solo se aceptan motores con firma válida, Ku precalculado y se descarta un noAuthNoPriv con un usuario que exige autenticación | Con tests |
| Servidor FTP: 60 s para iniciar sesión, máx. 8 clientes y 3 intentos, rutas confinadas, datos solo con la IP que inició sesión (RFC 2577); cliente FTP con tope de 4 MB por listado | Con tests |
| TFTP/HTTP: rutas sin `:` en Windows (unidades o flujos NTFS) ni enlaces simbólicos al crear carpetas, timeout acotado a 30 s; el servidor HTTP ya no se cierra con rutas UTF-8 mal formadas | Con tests |
| Ping y diagnóstico: un host entre corchetes no inyecta opciones (`[-f]`) | Con tests |

Pendiente para distribución corporativa: firmar con Developer ID + notarización (macOS) y certificado de firma de código (Windows). Las limitaciones conocidas están en [SECURITY.md](SECURITY.md#limitaciones-conocidas). Sin firma, AppLocker o Intune pueden bloquear la app. Los scripts Python ejecutan código local por diseño: en una carpeta portable compartida, revisa los scripts antes de ejecutarlos.

## Packs de comandos

El catálogo (⌘L) combina los packs incluidos (investigados con fuentes oficiales, con variantes por plataforma y versión) con packs que cada usuario puede crear, importar y compartir.

- **Plataforma:** el botón "Detectar" ejecuta `show version` / `display version` / `get system status` en la sesión y ajusta la sintaxis (por ejemplo IOS-XE frente a NX-OS, FortiOS 6.4 frente a 7.x).
- **Mis comandos:** "+ Propio" agrega comandos a un pack personal por fabricante.
- **Seguridad:** un pack es solo JSON y nunca se ejecuta al importarlo. La app recalcula el riesgo de cada comando y usa el mayor entre el declarado y el calculado.

Formato mínimo:

```json
{
  "format": "netterminal-commands",
  "formatVersion": 1,
  "id": "mi-equipo-campus",
  "name": "Campus: comandos frecuentes",
  "vendor": "cisco",
  "vendorName": "Cisco",
  "version": "1.0.0",
  "author": "Equipo de redes",
  "platforms": [{ "id": "iosxe", "label": "IOS-XE", "detect": "IOS[ -]XE" }],
  "commands": [
    {
      "cmd": "show interfaces {{interfaz}} | include rate",
      "desc": "Tasas de entrada y salida de la interfaz.",
      "cat": "Interfaces",
      "risk": "read",
      "platforms": ["iosxe"],
      "variants": [{ "platforms": ["nxos"], "cmd": "show interface {{interfaz}} | include rate" }],
      "source": "https://www.cisco.com/..."
    }
  ]
}
```

Categorías: Sistema, Hardware, Interfaces, Capa 2, Enrutamiento, MPLS / VPN, Seguridad, Alta disponibilidad, QoS, Diagnóstico, Logs, Configuración. Riesgo: `read`, `change` o `disruptive`.

## Topología CDP / LLDP

Herramientas › Topología lee los vecinos del equipo conectado y dibuja el diagrama. Solo ejecuta comandos de consulta:

| Fabricante | Vecinos | Estado de puertos (opcional) |
| --- | --- | --- |
| Cisco | `show cdp neighbors detail`, `show lldp neighbors detail` | `show interfaces status` (o `show interfaces description`), `show etherchannel summary` (o `show port-channel summary` en NX-OS) |
| Huawei | `display lldp neighbor` | `display interface brief`, `display interface description`, `display eth-trunk` |
| Juniper | `show lldp neighbors` y, para la IP de gestión, `show lldp neighbors interface X` (máx. 32) | `show interfaces descriptions` |
| Fortinet | `diagnose lldprx neighbor summary/details` (en 7.6.3+ `diagnose lldp rx neighbor …`, se prueba solo) | No disponible |

- **Seguir la ruta**: selecciona un vecino y pulsa "Conectar". Si el equipo coincide (por IP o nombre) con una sesión guardada, se usa esa sesión con su puerto, usuario y jump host; si no, se abre SSH o Telnet con los datos de la sesión de origen. La contraseña la escribes tú; al volver pulsas "Descubrir vecinos".
- **Ruta entre dos equipos**: "Desde aquí" y "Hasta aquí" resaltan el camino más corto y lo listan con los puertos de cada salto, listo para copiar en un ticket.
- **Enlaces paralelos y agregados**: varios enlaces entre el mismo par se dibujan separados y se rotulan con su Port-channel, Eth-Trunk o ae.
- **Snapshots**: guarda el diagrama con nombre (por ejemplo, antes de una ventana de cambio) y compáralo después: en verde lo nuevo, en rojo punteado lo que ya no aparece.
- **Exportar**: SVG (imagen), draw.io (editable), CSV (enlaces con estado, velocidad, descripción y agregado) o Mermaid.
- Check Point y WatchGuard no tienen descubrimiento: no hay comandos LLDP documentados y verificables para Gaia ni Fireware. Aparecen cuando otro equipo los reporta como vecinos.

## Crear un plugin

```
mi-plugin/
  plugin.json   {"id","name","version","description","permissions":["session"],"actions":[{"id","label"}]}
  main.py       import netterminal as nt; os.environ["NT_ACTION"] indica la acción
```

Permisos: `session` (leer y enviar comandos a la sesión), `network`, `files`. Son declarativos y se muestran al instalar. Ejemplo completo en [plugins/ejemplo-inventario](plugins/ejemplo-inventario).

## Publicar una versión

1. Sube la versión en `package.json`, `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json`.
2. `git tag v0.5.3 && git push origin v0.5.3`
3. El workflow compila los 3 sistemas, firma los paquetes de actualización y crea el Release con instaladores, zip portable y `latest.json`.
4. El workflow valida que el tag apunte a un commit de `main` y coincida con la versión de `tauri.conf.json`. El job que firma usa el environment `release`: apruébalo en la pestaña Actions para continuar.

Política de seguridad y reporte privado de vulnerabilidades: [SECURITY.md](SECURITY.md).

### Actualización con un clic

- Una sola fuente para avisar e instalar: el `latest.json` del último release del repositorio donde se compila la app (en CI, `NT_UPDATE_REPO = github.repository`; en local, `repository` de `Cargo.toml`). Se lee desde la CDN de releases, sin la API de GitHub ni su límite de consultas, al abrir la app y cada 6 horas.
- Solo se instalan paquetes firmados con la clave del proyecto (la clave pública va dentro de la app, en `tauri.conf.json`). Las novedades del aviso son las mismas del release.
- La clave privada y su contraseña viven solo en los secretos de GitHub Actions (`TAURI_SIGNING_PRIVATE_KEY` y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). Guarda un respaldo fuera del equipo: si se pierde, los usuarios tendrán que reinstalar a mano una vez para recibir una clave nueva.
- Plataformas: instalador de Windows, `.app` de macOS (incluida en el `.dmg`) y AppImage de Linux. El zip portable y el `.deb` mantienen el aviso con descarga manual.
- Las compilaciones locales no necesitan la clave; para generar paquetes firmados: `npx tauri build --config src-tauri/tauri.updater.conf.json` con las variables de entorno anteriores.

## Desarrollo

Requisitos: Rust estable, Node 20+ y los [prerrequisitos de Tauri](https://tauri.app/start/prerequisites/) de cada sistema operativo (en Linux además `libudev-dev` para serial y `libdbus-1-dev` para el llavero del sistema).

```bash
npm install
npm run tauri dev
```

Build del sistema actual:

```bash
npm run tauri build
```

Para generar los binarios de los tres sistemas operativos, ejecuta el workflow `build` en GitHub Actions (manual o al crear un tag `v*`).

### Regenerar las capturas

Con `npx vite --port 1430` en marcha, ejecuta `node scripts/screenshots/shoot.mjs` (requiere Google Chrome; acepta nombres de captura como argumentos y las variables `PORT`, `OUT`, `BASE` y `CDP_PORT`). Usa un backend simulado (`scripts/screenshots/mock.js`) con datos ficticios, nunca tus sesiones reales.

## Estructura

```
assets/icon.svg           Fuente del ícono (regenerar con: npx tauri icon assets/icon.png)
src/                      Frontend React
  components/             Sidebar, pestañas, terminal, modal, paleta, barra de estado
  lib/                    Atajos, temas, ajustes y motor de resaltado
src-tauri/src/
  connection.rs           Conexiones: PTY (local/SSH), Telnet, Serial y logs
  telnet.rs               Protocolo Telnet (con tests)
  session_store.rs        Persistencia de sesiones y modo portable
  notes.rs                Notas en texto plano (con tests)
  monitor.rs, nettools.rs Sondas, traceroute, iperf3, puertos, speedtest
  servers.rs, filexfer.rs TFTP/HTTP/Syslog y comandos de archivos en equipos
  ftpserver.rs, ftpclient.rs Servidor FTP de la carpeta compartida y cliente FTP/FTPS
  snmp.rs                 Cliente SNMP v1/v2c/v3 y receptor de traps (con tests)
  credentials.rs, seal.rs Bóveda cifrada y notas protegidas (XChaCha20-Poly1305, Argon2id)
  plugins.rs, updates.rs  Plugins con verificación SHA-256, aviso de versiones y actualización firmada
```
