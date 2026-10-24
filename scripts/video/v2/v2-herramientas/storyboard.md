# Video 2: Herramientas de red a fondo. Storyboard

Etapa de escritura: no se renderiza. El guion vive en `guion/NN-titulo.txt` (un párrafo = un bloque, numerado desde 0 como en `scripts/video/plugins/guion.mjs`). Las fuentes de cada afirmación están en `fuentes.md`.

## Formato general

- 1920x1080, tema claro, `fontSize` 15, `?video=1` (igual que el video de plugins: `scripts/video/plugins/mock-video.js`).
- Página `app`: la app real con el backend simulado (`scripts/screenshots/demo.html` + `mock.js`). Página `escenario`: láminas y diagramas (`scripts/video/plugins/escenario.html`, tipos `portada`, `capitulo`, `lista`, `columnas`, `tabla`, `flujo`, `codigo`).
- Títulos de capítulo: superpuestos sobre la app (franja inferior, 2 s) para no sumar tiempo. Si se usan láminas `capitulo`, que duren 2 s o menos (12 láminas x 2 s = 24 s).
- Callout: recuadro con borde de acento sobre el control (`hl`), texto corto en la franja inferior. Zoom: `zoom` 1.25 a 1.6 sobre el control que se nombra, `unzoom` al cambiar de zona.
- Datos: solo IPs de documentación (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24), nombres ficticios (`core-sw01`, `dist-sw01`, `rt-borde01`) y secretos de marcador (`<AUTH_PASS>`, `demo-...`). Nada de dominios reales: `ftp.example.net` o una IP de documentación.
- Sin rayas largas en textos de pantalla.

## Duraciones (150 palabras por minuto)

| # | Capítulo | Palabras | Duración | Inicio |
| --- | --- | ---: | ---: | ---: |
| 01 | Herramientas y módulos | 92 | 0:37 | 0:00 |
| 02 | Topología: vecinos CDP y LLDP | 238 | 1:35 | 0:37 |
| 03 | Topología sin CDP ni LLDP | 253 | 1:41 | 2:12 |
| 04 | Topología por SNMP y tráfico | 260 | 1:44 | 3:53 |
| 05 | Transferencias: conceptos | 176 | 1:10 | 5:37 |
| 06 | Servidores TFTP y HTTP | 186 | 1:14 | 6:48 |
| 07 | FTP: servidor y cliente FTPS | 142 | 0:57 | 8:02 |
| 08 | SFTP y SCP | 149 | 1:00 | 8:59 |
| 09 | Gestor de archivos | 159 | 1:04 | 9:58 |
| 10 | Cliente SNMP | ~238 | 1:35 | 11:02 |
| 11 | Monitoreo, diagnóstico, velocidad, subredes y Syslog | 126 | 0:50 | 12:37 |
| 12 | Respaldos y comparación | 100 | 0:40 | 13:27 |
| 13 | Cierre | 40 | 0:16 | 14:07 |
| | **Total** | **~2160** | **~14:23** | |

Nota: los dos videos anteriores salieron a unas 130 a 135 palabras por minuto efectivas (pausas incluidas: 1.819 palabras en 13:32 y 1.204 en 9:25). Si la voz mantiene ese ritmo, este guion dura unos 16 minutos. En ese caso, recortar primero 03 bloque 5, 05 bloque 3 y 11 bloque 3.

## Escenas existentes en `scripts/screenshots/mock.js`

| Escena | Qué deja en pantalla |
| --- | --- |
| `s-modules` | Ajustes, Módulos |
| `t-topology`, `topology` | Topología base (core, dist, accesos, Po1); `topology` deja la ruta core-sw01 a sw-acceso-02 resaltada |
| `compare` | Topología comparada con el snapshot "Antes de la ventana de cambio" |
| `topology-sources`, `topology-sources-off` | Diagrama con todos los tipos de enlace, fuentes activas o apagadas |
| `topology-ospf` | rt-borde01 con vecinos solo de ruteo (OSPF, EIGRP, BGP lógico) |
| `topology-manual` | Equipos y enlaces manuales y sugerencia por descripción |
| `topology-mac` | Tablas MAC: enlace MAC/OUI confirmado y sugerencias alta, media y baja |
| `topology-snmp` | Modo "SNMP (perfil)", perfil `pcore`, y "Descubrir por SNMP" pulsado |
| `topology-traffic` | Tráfico activado por SNMP, intervalo 15 s, animación (desactivar con `&anim=0`) |
| `transfer` | Transferencias con scroll al Servidor TFTP |
| `t-transfer` | **Rota**: busca la etiqueta "TFTP / HTTP", que ya no existe (hoy es "Transferencias") |
| `snmp` | SNMP: conjunto Interfaces cargado y receptor de traps iniciado (traps de ejemplo) |
| `snmpgen` | Generador: Cisco IOS-XE, v3, NMS 192.0.2.10 y 198.51.100.0/24, receptor 192.0.2.20 |
| `monitor` | Monitoreo con 3 sondas y 5 minutos de historia (`t-monitor` no genera muestras) |
| `t-diag`, `subnet`, `speed`, `t-syslog` | Pantallas vacías o con datos fijos |
| `backup`, `t-backup` | Respaldos con dos versiones de core-sw01 y comparación |

## Extensiones del backend simulado

Propuesta: un archivo `scripts/video/v2/v2-herramientas/mock-herramientas.js` que extiende `window.__mock`, igual que `scripts/video/plugins/mock-video.js`, para no tocar las capturas. Solo la corrección de `t-transfer` va en `mock.js`.

1. **Servidores de transferencia** (`server_start` no existe en el mock: hoy "Iniciar" no cambia nada).
   - `server_start({kind, port, allowWrite})`: agrega `kind` a `running` y responde `"TFTP escuchando en UDP 69"`.
   - Al iniciar HTTP en la toma del flujo de firmware, emitir eventos `transfer` cada 300 ms: `{id:"x1", proto:"http", client:"192.0.2.1:51544", file:"c9300-universalk9.17.12.04.SPA.bin", dir:"get", bytes, total:1163845632, done, error:null}` hasta completar.
   - `local_ips` con dos variantes: por defecto `[{name:"en0", ip:"192.0.2.250"}]`; con `&ips=multi`: `[{name:"bridge100", ip:"203.0.113.254"}, {name:"en0", ip:"192.0.2.250"}, {name:"utun4", ip:"198.51.100.77"}]` para mostrar que los comandos copiables usan la primera (bloque 06.1).
   - `tftp_add({path})` agrega el archivo a la lista de `tftp_files`; `tftp_delete` lo quita. `plugin:dialog|open` devuelve `/Users/operador/Descargas/c9300-universalk9.17.12.04.SPA.bin`.
   - FTP: `ftp_server_start` ya existe; agregar que cada llamada genere una contraseña distinta (`demo-k7m2q9`, `demo-p4x8r2`) para mostrar que cambia en cada inicio.
   - `ftp_get` y `ftp_put`: devuelven un `job` y emiten `transfer` con `proto:"ftp"` y luego `tool-job` `done`. Servidor del cliente: `203.0.113.30`, usuario `operador`, contraseña tecleada `demo-ftp-2026`.
2. **Gestor de archivos** (`device_run` hoy devuelve salida vacía salvo en respaldos).
   - `source_ip({host})` devuelve `"192.0.2.250"`.
   - `dir flash:` en core-sw01:
     ```
     Directory of flash:/

        16  -rw-     1163845632  Oct 20 2026 18:15:02 +00:00  c9300-universalk9.17.09.05.SPA.bin
        17  -rw-           7406  Oct 20 2026 18:15:40 +00:00  packages.conf
        18  drwx           4096  Oct 14 2026 09:30:00 +00:00  tracelogs

     11353194496 bytes total (8012345344 bytes free)
     ```
     (formato que reconoce `parseListing`, con espacio libre). Variante `&flash=lleno`: `(812345344 bytes free)` para el aviso "No hay espacio suficiente en el equipo".
   - `copy http://192.0.2.250:8080/<archivo> flash:<archivo>`: emitir `tool-job` `line` con `Destination filename [...]?`, `Accessing http://...`, `Loading ... !!!!!!!!`, `1163845632 bytes copied in 94.212 secs`, luego `result` con `{ok:true, output}` y `done`, junto con eventos `transfer` del mismo archivo.
   - `tftp_md5` devuelve `3f8a0c1e5b7d9f2a4c6e8b0d1f3a5c7e` (ficticio) y `verify /md5 flash:<archivo>` responde `verify /md5 (flash:<archivo>) = 3f8a0c1e5b7d9f2a4c6e8b0d1f3a5c7e`. Variante `&md5=malo` con otro hash para mostrar el rojo.
   - `copy running-config tftp://192.0.2.250/core-sw01_<fecha>.cfg`: `Address or name of remote host [192.0.2.250]?`, `!!`, `4211 bytes copied`.
3. **Topología en vivo** (capítulo 02, bloques 1 a 4).
   - Escena nueva `topology-live`: `settings.topology` vacío, sesiones core-sw01 y dist-sw01 conectables.
   - `device_run` con `show cdp neighbors detail` por equipo (formato Cisco con bloques `-------------------------`, `Device ID:`, `IP address:`, `Platform:`, `Interface: X,  Port ID (outgoing port): Y`). core-sw01: core-sw02 (Te1/1/1, 192.0.2.2), dist-sw01 por Gi1/0/1 y Gi1/0/2 (192.0.2.11). dist-sw01: core-sw01 por Gi1/0/48 y Gi1/0/47, sw-acceso-01 (192.0.2.21) y sw-acceso-02 (192.0.2.22) por Gi1/0/1 y Gi1/0/2.
   - `show lldp neighbors detail`: core-sw01 informa fw-perimetro (198.51.100.10, port1); dist-sw01 vacío.
   - `show interfaces status` y `show etherchannel summary` con Gi1/0/1 y Gi1/0/2 en Po1. El prompt final (`core-sw01#`) da el nombre del equipo.
   - Para dist-sw01 la sesión guardada existe (192.0.2.11): el botón dirá `Conectar con "dist-sw01"`. Para mostrar "Conectar y seguir la ruta" usar sw-acceso-01, que no tiene sesión guardada.
4. **Tráfico con los tres colores y "velocidad desconocida"** (capítulo 04, bloques 5 y 6). En `SNMP_IFS` ya hay verde (Te1/1/1, 24 %), amarillo (Gi1/0/1, 76 %) y rojo (Gi1/0/2, 94 %). Agregar `&unknownSpeed=1`: `ifHighSpeed` 0 en Gi1/0/10 de core-sw01, para que el enlace con fw-perimetro salga azul. Para "Sin fuente" en el estado, dejar un equipo explorado sin perfil (por ejemplo, sin `pdist`).
5. **SNMP**: `snmp_walk` de `1.3.6.1.2.1.1` (system) devuelve las filas de `SYS` con sufijo `.0`; `snmp_request` con `op:"getnext"` devuelve el OID siguiente y con `getbulk` 10 filas de `ifName`. `ifDescr` (`1.3.6.1.2.1.2.2.1.2`) y `ifOperStatus` también deben responder en el walk.
6. **Syslog**: `server_start` con `kind:"syslog"` y emisión del evento `syslog` con 6 mensajes `{ts, src:"192.0.2.1", severity, msg}` (por ejemplo `%LINK-3-UPDOWN: Interface GigabitEthernet1/0/3, changed state to down`, severidad 3; `%SYS-5-CONFIG_I: Configured from console by admin on vty0 (192.0.2.250)`, severidad 5).
7. **Diagnóstico**: `tool_ports` devuelve `[{port:22,open:true,rtt:3},{port:23,open:false,rtt:null,error:"rechazado"},{port:443,open:true,rtt:4}]` para 192.0.2.1.
8. **Corrección**: en `mock.js`, `"t-transfer": tool("TFTP / HTTP")` debe usar `tool("Transferencias")`.

## Diagramas para dibujar (página `escenario`)

- **D1 Vecinos CDP/LLDP**: dos switches unidos por un cable; sobre el cable, una burbuja "Soy dist-sw01, puerto Gi1/0/48, IP 192.0.2.11". Texto: "Cada equipo anuncia quién es y por qué puerto".
- **D2 Salto a salto**: core-sw01 (explorado) → dist-sw01 → sw-acceso-01, con tres pasos numerados: Descubrir vecinos, Conectar, Descubrir vecinos.
- **D3 Escalera de confianza (MAC/OUI)**: tres filas. Alta: MAC virtual HSRP `0000.0c07.acXX` o VRRP `0000.5e00.01XX`. Media: 4 o más MAC, o una sola MAC de fabricante de red. Baja: MAC de red con pocas más, o MAC local/aleatoria. Pie: "Son pistas: tú confirmas".
- **D4 Cómo leer el tráfico**: un enlace A (core-sw01) a B (dist-sw01) con dos carriles y dos flechas; etiqueta `↑ 120 Mb/s ↓ 35 Mb/s · 12 %`; leyenda: verde < 70 %, amarillo 70 a 89 %, rojo ≥ 90 %, azul velocidad desconocida; "↑ = de A hacia B; pasa el mouse para ver los nombres".
- **D5 Quién inicia la copia**: izquierda, "PC servidor (TFTP, HTTP, FTP)": PC ← flecha de descarga ← router que ejecuta `copy`; derecha, "Equipo servidor (SCP, SFTP)": PC → SSH → router.
- **D6 Tabla de protocolos** (tipo `tabla`): columnas Cifrado, Credenciales, Velocidad, Soporte en equipos. TFTP: no / no / baja / casi todos. HTTP: no / no / alta / muchos. FTP: no / en claro / alta / muchos. SCP/SFTP: sí / del equipo / alta / si el equipo tiene el servidor activo.
- **D7 PC como servidor TFTP**: PC 192.0.2.250 con carpeta compartida y "UDP 69" ← router core-sw01 192.0.2.1 con `copy tftp://192.0.2.250/c9300-...bin flash:`. Recuadro de advertencia: "Sin contraseña: apágalo al terminar".
- **D8 Flujo de firmware** (tipo `flujo`, 7 pasos): Agregar → Espacio libre → Iniciar HTTP/TFTP → Pegar copy → Avance → MD5 → Detener. Paso 8 en gris: "Arranque y reinicio: tú".
- **D9 SCP clásico**: OpenSSH 9 o superior usa SFTP por defecto; Cisco IOS-XE responde SCP clásico; la app agrega la opción de SCP clásico.
- **D10 SNMP gestor y agente**: NMS (PC) → UDP 161 → agente; agente → UDP 162 → receptor de traps. Advertencia: "Receptor en 127.0.0.1: el equipo no llega".
- **D11 Enmascarado en el diff**: dos líneas `enable secret 9 ****` iguales en A y B aunque la contraseña cambió.

## Tomas por capítulo

### 01 Herramientas y módulos (escena `empty`, luego `s-modules`)
- B0: lámina `portada` "Herramientas de red a fondo", chips: Topología, Transferencias, SNMP, Monitoreo, Respaldos.
- B1: app `empty`. Atajo `cmd+e`; callout "⌘E · Ctrl+Shift+E". `hl` del botón "Herramientas" de la barra de pestañas.
- B2: `hl` de la barra de módulos (nav de ToolsView). Zoom 1.4 al punto verde junto a Transferencias (requiere servidor iniciado en la preparación con la extensión 1).
- B3: escena `s-modules`. Zoom a la lista de interruptores; callout "Ocultar no borra la configuración".

### 02 Topología: vecinos (escena nueva `topology-live`, luego `topology` y `compare`)
- B0: lámina D1.
- B1: preparación: conectar core-sw01. Clic en Topología; `hl` "Descubrir con" (Consola (CLI)) y "Equipo (sesión conectada)".
- B2: `hl` "Estado de puertos", clic "Descubrir vecinos". Callout con el mensaje de estado "Ejecutando: show cdp neighbors detail". Zoom 1.5 al rótulo "Po1 ×2".
- B3: clic en sw-acceso-01; zoom al panel Detalle; `hl` "Conectar y seguir la ruta". Después clic en dist-sw01 para mostrar `Conectar con "dist-sw01"`. Callout "Sesión guardada: usa sus datos".
- B4: lámina D2 (3 s), vuelta a la app: selector "Equipo (sesión conectada)" abierto con la sesión nueva; clic "Descubrir vecinos". Callout de advertencia: "Cambia el equipo antes de descubrir".
- B5: escena `topology`. `hl` "Desde aquí" y "Hasta aquí"; zoom a la sección Ruta; `hover` en "Copiar ruta".
- B6: escena `compare`. Zoom a "Cambios respecto de..."; callout verde "nuevo", rojo punteado "ya no aparece". `hl` "Abrir" y el basurero con callout rojo "Sin confirmación".
- B7: clic en "Exportar"; menú abierto 2 s; `hl` "Copiar como Mermaid".

### 03 Topología sin CDP ni LLDP (escenas `topology-sources-off`, `topology-ospf`, `topology-manual`, `topology-mac`)
- B0: `topology-sources-off` con `&topoOpen=fuentes`. Zoom al panel: tres interruptores apagados; callout "Apagada = sin comandos".
- B1: `topology-ospf`. `hl` de un nodo con borde punteado; zoom a la etiqueta "OSPF"; callout "Sesión BGP lógica" sobre la línea punteada fina.
- B2: `topology-manual` con `&topoOpen=sugerencias`. Zoom a la sugerencia "UPLINK a sw-patio-01 Gi0/1".
- B3: `topology-mac` con `&topoOpen=sugerencias`. Lámina D3 a pantalla completa 4 s; luego zoom a las sugerencias con sus etiquetas alta, media, baja.
- B4: clic en el botón "Sugerencias"; `hl` "Confirmar" y "Descartar"; clic en Confirmar de la HSRP.
- B5: lámina `lista` con tres pistas falsas: descripción vieja, MAC Cisco de un teléfono IP, tabla MAC envejecida.
- B6: `topology-manual` con `&topoOpen=manual,leyenda`. Clic "+ Equipo", escribir `sw-bodega-01` / `192.0.2.70`; Cancelar. Zoom a la Leyenda.

### 04 Topología por SNMP y tráfico (escenas `topology-snmp`, `topology-traffic`)
- B0: `topology-snmp` sin pulsar (agregar `&noclick=1`). `hl` "Descubrir con" (SNMP (perfil)) y "Perfil SNMP del equipo (v2c o v3)".
- B1: clic "Descubrir por SNMP"; zoom al mensaje "core-sw01: N vecinos CDP/LLDP... por SNMP en X s". Callout "EIGRP: solo por consola".
- B2: `topology-traffic` con `&anim=0`, con `&topoOpen=trafico`. `hl` botón "Tráfico" y la sección "Tráfico en enlaces"; zoom al selector "Cada".
- B3: zoom al recuadro de estado ("SNMP: core-sw01, ..."). `hl` "También por consola" con callout "Ocupa la sesión unos segundos".
- B4: callout "Primera lectura: sin tasa" mientras aparece "La tasa aparece desde la segunda lectura". Zoom a los cuatro interruptores.
- B5: lámina D4 3 s; luego app con `&unknownSpeed=1`: zoom sucesivo a enlace verde, amarillo, rojo y azul. Abrir Leyenda.
- B6: zoom 1.6 a una etiqueta `↑ ... ↓ ...`; `hover` sobre el enlace para mostrar el tooltip "Tráfico: ↑ core-sw01 → dist-sw01 ...".

### 05 Transferencias: conceptos (página `escenario` casi completa)
- B0: lámina `capitulo` corta.
- B1: D5.
- B2 a B4: D6, revelando una fila por bloque.
- B5: app, escena `transfer` con scroll a "Archivos compartidos"; zoom a la línea "IPs de este PC".
- B6: app con `&ips=multi`; zoom a las tres IPs; callout "Usa la de gestión". Pie: "Firewall: solo redes privadas".

### 06 Servidores TFTP y HTTP (escena `transfer` + extensión 1)
- B0: clic "Iniciar" en Servidor TFTP; zoom al estado "Activo · UDP 69".
- B1: zoom 1.5 a los comandos copiables; callout "Primer archivo y primera IP: revísalos". Con `&ips=multi` se ve la IP equivocada.
- B2: `hl` "Permitir subidas"; aparece `copy running-config tftp://...`; callout "Se aplica al reiniciar el servidor".
- B3: Servidor HTTP: Iniciar, zoom a `copy http://192.0.2.250:8080/...`.
- B4: lámina corta: "Linux: 69 → 1069 · 21 → 2121 · 162 → 1162".
- B5: D8 (flujo); en paralelo, en la app: Agregar (diálogo simulado), Transferencias con barra de avance HTTP.
- B6: D7 a pantalla completa con el paso 8 en gris.

### 07 FTP (escena `transfer`, scroll a Servidor FTP y Cliente FTP / FTPS)
- B0: `hl` Servidor FTP.
- B1: Iniciar; zoom a Usuario `nt` y Contraseña; Detener e Iniciar otra vez para mostrar que la contraseña cambia. `hl` "Permitir subidas".
- B2: zoom a la advertencia amarilla "FTP no cifra".
- B3 y B4: Cliente: escribir `203.0.113.30`, `operador`, contraseña; Listar; doble clic en `cisco`; clic en la flecha de descarga.
- B5: zoom a "FTPS explícito (TLS, certificado verificado)" y "Certificados del sistema, sin excepciones"; apagar el interruptor 1 s para mostrar la advertencia y volver a encenderlo.

### 08 SFTP y SCP
- B0: lámina D9 en versión simple (PC con OpenSSH → SSH → equipo).
- B1: escena `transfer`, sección SFTP interactivo; clic "Abrir SFTP"; pestaña nueva "SFTP core-sw01" con prompt `sftp>` simulado y `ls`, `get packages.conf`. Callout "get y put: carpeta compartida".
- B2: gestor de archivos, Protocolo "SCP (cifrado)"; zoom al texto "Requiere servidor SCP en el equipo (Cisco: ip scp server enable)".
- B3: D9 completa; callout `ip scp server enable` y `feature sftp-server`.
- B4: gestor con lista leída; seleccionar el archivo en el panel del equipo; `hl` botón "MD5"; operación "✓ MD5 ... ● Completado".

### 09 Gestor de archivos (escena `transfer` + extensión 2)
- B0: `hl` de los dos paneles.
- B1: abrir "Tipo de equipo" y elegir "Cisco NX-OS"; aparece el campo "VRF (management)"; volver a Cisco IOS. Zoom a "IP de este PC".
- B2: clic "Leer archivos"; zoom al pie "3 archivos · libre ...".
- B3: seleccionar la imagen y clic "Enviar"; abrir "Ver salida del equipo". Con `&flash=lleno`, mostrar el diálogo "No hay espacio suficiente en el equipo".
- B4: estado "Activo" del Servidor HTTP abajo; callout "Sigue encendido: detenlo".
- B5: operación MD5 en verde; con `&md5=malo`, en rojo "MD5 no coincide".
- B6: `hl` "Respaldar config"; callout "Sin enmascarar · no entra en Respaldos".

### 10 Cliente SNMP (escenas `snmp`, `snmpgen` + extensión 5)
- B0: lámina D10 (solo la mitad de consulta).
- B1: app SNMP, Destino SNMP; zoom a Versión, Nivel, Autenticación SHA-256, Privacidad AES-128; `hl` "Mostrar algoritmos heredados (MD5, DES)". Cambiar a v2c para mostrar la advertencia y volver a SNMPv3.
- B2: `hl` "Guardar secretos en la bóveda cifrada" y "Secretos en la bóveda · olvidar".
- B3: pulsar los botones de operación; botón rápido "system" (WALK) y Consultar; zoom a la tabla y al estado "N filas en X ms".
- B4: conjunto Interfaces; "Medir tasas"; zoom a Entrada y Salida.
- B5: lámina D10 completa con la advertencia; app: "Escuchar en" abierto, elegir `192.0.2.250 · en0`; Iniciar; traps de ejemplo.
- B6: escena `snmpgen`; zoom a "NMS autorizados", a `<AUTH_PASS>` en el texto generado y a una línea `! Verifica ...`.

### 11 Monitoreo y más (escenas `monitor`, `t-diag`, `speed`, `subnet`, `t-syslog`)
- B0: `monitor`; clic "Nueva sonda" para ver Tipo, Intervalo y "Caído tras"; Cancelar; zoom a la caída de "Enlace sucursal norte".
- B1: `t-diag` con el resultado de Puertos TCP (extensión 7).
- B2: `speed`; zoom a "Consume ~95 MB de datos por prueba".
- B3: `subnet`; elegir un "Nuevo prefijo".
- B4: `t-syslog` con mensajes (extensión 6); zoom a `logging host 192.0.2.250`; `hl` "Guardar en archivo diario".

### 12 Respaldos y comparación (escena `backup`)
- B0: `hl` lista de equipos, selector de perfil y "Respaldar".
- B1: lámina D11 2 s; app: zoom a "Enmascarar secretos".
- B2: `hl` botones A y B; clic "Comparar A y B"; zoom a "+N agregadas −N quitadas" y a un pliegue "líneas sin cambios"; `hl` "Exportar".

### 13 Cierre
- B0: lámina `lista` con cuatro puntos.
- B1: lámina final con el logo y el enlace del sitio.
