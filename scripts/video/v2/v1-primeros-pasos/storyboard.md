# Storyboard · Video 1: Primeros pasos y uso diario

Etapa de escritura. No se renderiza nada todavía. Este documento define, por capítulo y por frase del guion, qué se hace en pantalla y en qué escena del demo. Las fuentes de cada afirmación están en `fuentes.md`.

## Resumen

| # | Capítulo | Archivo de guion | Palabras | Narración a 150 ppm |
| --- | --- | --- | --- | --- |
| 1 | Qué es NetTerminal e instalación | `guion/01-que-es-e-instalacion.txt` | 144 | 0:58 |
| 2 | Sesiones y carpetas | `guion/02-sesiones-y-carpetas.txt` | 159 | 1:04 |
| 3 | Conexión rápida | `guion/03-conexion-rapida.txt` | 92 | 0:37 |
| 4 | SSH, Telnet y Serial | `guion/04-ssh-telnet-serial.txt` | 203 | 1:21 |
| 5 | Pestañas y vista dividida | `guion/05-pestanas.txt` | 128 | 0:51 |
| 6 | Catálogo de comandos | `guion/06-catalogo.txt` | 116 | 0:46 |
| 7 | Sugerencias de comandos | `guion/07-sugerencias.txt` | 317 | 2:07 |
| 8 | Notas, plantillas y envío a varias sesiones | `guion/08-notas-y-difusion.txt` | 150 | 1:00 |
| 9 | Logs, alertas, historial y búsqueda | `guion/09-logs-alertas-historial.txt` | 109 | 0:44 |
| 10 | Apariencia y Ajustes | `guion/10-apariencia-y-ajustes.txt` | 81 | 0:32 |
| 11 | Cierre | `guion/11-cierre.txt` | 47 | 0:19 |
| | **Total** | | **1.546** | **10:18** |

**Cambio de orden respecto del pedido.** El catálogo (capítulo 6) va antes de las sugerencias (capítulo 7): las sugerencias solo funcionan con la plataforma detectada o fijada en el catálogo (`src/lib/suggest.ts:787`, `src/components/TerminalView.tsx:458-461`), y el aviso de plataforma remite a "Comandos (⌘L) › Detectar" (`TerminalView.tsx:558`). Así el espectador ya conoce Detectar cuando llega al autocompletado. Contraseñas guardadas quedan dentro del capítulo 4.

**Ritmo y duración final.** El tutorial anterior tuvo 1.758 palabras y duró 13:32 con voz a 185 ppm: unos 1,6 s de pausa por frase. Con 118 frases, ese mismo ritmo llevaría este video a unos 13 minutos. Para quedar entre 9 y 11 minutos:
- Las acciones de cada frase corren **mientras** suena la frase (paso `@` con tiempos relativos), no después.
- Pausa entre frases de 0,4 s como máximo, salvo donde se indica "respiro".
- Voz a 150 ppm (`RATE=150` en `tts.mjs`) si se usa Paulina. A 185 ppm la narración baja a ~8:20 y el video queda en ~9:30.

## Convenciones

- **Escena**: `scripts/screenshots/demo.html?scene=<nombre>&theme=light&video=1` más los parámetros indicados. `video=1` activa eco, respuestas y guardado de sesiones en el mock (`scripts/screenshots/mock.js:790`).
- **Prep**: pasos que se ejecutan antes de grabar la toma (no se ven).
- **Pasos**: mismo vocabulario de `scripts/video/storyboard.mjs`: `click`, `dbl`, `right`, `hover`, `field`, `type`, `key`, `hl`, `zoom`, `unzoom`, `set`, `scroll`, `wait`, `@`, `js`. Selectores: `title:`, `text:`, `has:`, `ph:`, `css:`.
- **Callout**: rótulo superpuesto (overlay) con flecha hacia el elemento. **Rótulo inferior**: texto fijo abajo, estilo subtítulo destacado. **Lámina**: pantalla completa fuera de la app (como `scripts/video/plugins/escenario.html`).
- **Atajos en pantalla**: la grabación es en macOS. Cada atajo se muestra con los dos sistemas: `⌘N · Ctrl+Shift+N`.
- **[MOCK+n]**: la demostración necesita la extensión n del mock (ver al final). **[REC+n]**: necesita la extensión n del grabador.
- **Placeholder de Host**: la app muestra "10.0.0.1 o hostname" (`src/components/SessionModal.tsx:188`, `src/components/QuickConnectDialog.tsx:134`), que no es una IP de documentación. Se reescribe a `192.0.2.10 o hostname` igual que en `scripts/video/plugins/mock-video.js:17-20` [MOCK+1]. Los selectores de este documento usan `ph:192.0.2.10 o hostname`.
- **Datos**: solo IPs 192.0.2.x, 198.51.100.x y 203.0.113.x, y nombres ficticios del mock (`mock.js:16-27`).

### Escenas existentes en `scripts/screenshots/mock.js`

Escenas (`?scene=`): `terminal`, `notes`, `monitor`, `topology`, `compare`, `subnet`, `speed`, `oscmds`, `about`, `settings`, `logs`, `quick`, `quickserial`, `quicktab`, `packs`, `split`, `backup`, `legacy`, `credentials`, `alerts`, `import`, `vertical`, `secure-note`, `snmp`, `snmpgen`, `transfer`, `empty`, `palette`, `palette-q`, `ctxmenu`, `filter`, `filter-none`, `quicktabs`, `quick-active`, `lock-note`, `find`, `paste`, `toasts`, `bcastbar`, `macros`, `broadcast`, `s-appearance`, `s-terminal`, `s-highlight`, `s-logs`, `s-credentials`, `s-sessions`, `s-modules`, `s-alerts`, `s-ai`, `s-about`, `s-search`, `s-vault`, `session-new`, `session-edit`, `quick-telnet`, `confirm`, `approval`, `macro`, `cmd-editor`, `session-full`, `s-alerts-edit`, `bc-dialog`, `closeall-setup`, `closeall`, `closeall-menu`, `closeall-palette`, `t-monitor`, `t-diag`, `t-topology`, `topology-sources`, `topology-sources-off`, `topology-ospf`, `topology-manual`, `topology-mac`, `topology-snmp`, `topology-traffic`, `t-subnet`, `t-perf`, `t-transfer`, `t-syslog`, `t-backup`, `t-plugins`, `suggest`, `suggest-config`.

Parámetros: `theme=light|dark`, `video=1`, `update=1`, `autolegacy=1`, `noplatform=1`, `layout=vertical`, `collapsed=1`, `toast=1`, `alert`, `term=<tema>`, `logsdir=1`, `vault=portable`, `big=N`, `noend`.

Escenas usadas en este video: `empty`, `s-about`, `session-edit`, `legacy`, `s-terminal`, `credentials`, `suggest`, `suggest-config`, `s-appearance`. Las demás tomas parten de `empty` con prep.

---

## Capítulo 1 · Qué es NetTerminal e instalación (0:58)

Tarjeta de capítulo: "1 · Qué es NetTerminal e instalación". Subtítulo: "Cliente SSH, Telnet, Serial y terminal local".

**Toma 1a** · escena `empty&theme=light&video=1`

| Línea | Narración (inicio) | Pasos | Overlay |
| --- | --- | --- | --- |
| L1 | NetTerminal es un cliente… | `zoom text:SSH, Telnet y Serial sin complicaciones. 1.35` | Título en pantalla: "Video 1 · Primeros pasos y uso diario" |
| L2 | Reúne SSH, Telnet, Serial… | `unzoom`; `hl css:aside` → `@1800 hl css:main div.h-10.bg-chrome` → `@3200 hl css:main div.h-6.border-t` | Chips: "macOS · Windows · Linux" |
| L3 | Todo lo que verás usa datos ficticios. | sin acción | Rótulo inferior: "Datos ficticios · IPs de documentación (RFC 5737)" |

**Toma 1b** · lámina "Descargas" [REC+1]

| Línea | Pasos | Lámina |
| --- | --- | --- |
| L4 | Aparición secuencial de filas | Tabla: macOS `.dmg` · Windows `-setup.exe` (por usuario) · Linux `.AppImage` o `.deb` · Portable `NetTerminal-portable.zip` (texto de `docs/index.html:330-333`) |
| L5 | Árbol de carpeta animado | `NetTerminal/` → `NetTerminal.exe` · `NetTerminal.app` · `NetTerminal.AppImage` · `portable` · `data/` (de `README.md:112-119`). Rótulo: "Sin administrador: instalador de Windows por usuario, AppImage y portable" |

**Toma 1c** · escena `empty&theme=light&video=1&update=1` [MOCK+2]
Prep: `dbl text:core-sw01`, `dbl text:ar-wan01`, `wait 800`, `click title:Ajustes`, `click text:Acerca de`.

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L6 | `hl has:Versión 0.9.4`; `@1500 hl text:Buscar ahora`; `click text:Buscar ahora`; `wait 600`; `hl has:Hay una versión nueva` | Callout en "Buscar ahora": "Al abrir y cada 6 horas" |
| L7 | `key Escape` (cierra Ajustes); `hl has:Nueva versión`; `click text:Ver novedades`; `zoom has:Nueva versión 1.4` | |
| L8 | `unzoom`; `click text:Actualizar y reiniciar` → diálogo "¿Actualizar y reiniciar?" ("Se cerrarán 2 sesiones abiertas…"); `hl css:[role=alertdialog]`; `@2600 click css:[role=alertdialog] button:last-child`; `wait 800`; `hl has:Descargando…` | Callout: "Verifica la firma antes de instalar" |
| L9 | `hl title:Omitir esta versión` (solo resaltar) | Rótulo inferior: "Portable y .deb: el aviso ofrece Descargar; se actualiza a mano". Variante opcional [MOCK+3] con el aviso "Descargar" real |

Nota: con dos sesiones conectadas el diálogo dice "Se cerrarán 2 sesiones abiertas". Con una sola diría "Se cerrarán 1 sesión abierta" (error de concordancia, ver informe), por eso el prep abre dos.

---

## Capítulo 2 · Sesiones y carpetas (1:04)

Tarjeta: "2 · Sesiones y carpetas". Subtítulo: "Crear, ordenar, filtrar e importar".

**Toma 2a** · escena `empty&theme=light&video=1` [MOCK+1]

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L1 | `hl css:aside nav`; `hover text:Sitio Central`; `@1600 hover text:Core` | |
| L2 | sin acción | Rótulo inferior grande: "⌘ en macOS = Ctrl+Shift en Windows y Linux" |
| L3 | `hl title:Nueva sesión`; `click title:Nueva sesión`; `wait 400`; `hl css:form .grid-cols-5` (SSH, Telnet, Serial, TCP, Local) | Atajo: `⌘N · Ctrl+Shift+N` |
| L4 | `field ph:Router core sw-acceso-centro`; `field ph:Raíz · usa / para subcarpetas Sucursales/Centro`; `zoom ph:Raíz · usa / para subcarpetas 1.4` | |
| L5 | `unzoom`; `field ph:192.0.2.10 o hostname 203.0.113.60`; `field ph:Según ~/.ssh/config admin`; `click text:Guardar`; `wait 500`; `hl text:sw-acceso-centro` | |
| L6 | `dbl text:core-sw01`; `wait 900`; `hl title:Pestaña abierta` | Callout en el punto: "Conectada" |
| L7 | `right text:core-sw02`; `wait 1200`; `click text:Duplicar`; `wait 500`; `hl text:core-sw02 (copia)` | Callout: "La copia no incluye la contraseña guardada" |
| L8 | `right text:Core`; `wait 2400` (menú: Conectar todas (2), Nueva sesión aquí, Nueva subcarpeta, Renombrar, Eliminar carpeta); `key Escape` | |
| L9 | `js` arrastrar `core-sw02 (copia)` sobre `Laboratorio` [REC+2]; `hl text:Laboratorio` | |
| L10 | `field ph:Filtrar… 198.51.100`; `wait 1500` (quedan ar-wan01 y fw-perimetro); `set ph:Filtrar… ""` | Callout: "Nombre, IP, usuario o carpeta" |
| L11 | `click title:Ajustes`; `click text:Importar y exportar`; `click text:Desde archivo…`; `hl has:Solo se importan datos de conexión` | |
| L12 | `click text:Leer ~/.ssh/config` [MOCK+4]; `wait 700`; `hl has:OpenSSH · 2 sesiones`; `click has:1 aviso`; `wait 400`; `hl has:los túneles no se importan`; `click text:Cancelar` | |

---

## Capítulo 3 · Conexión rápida (0:37)

Tarjeta: "3 · Conexión rápida". Subtítulo: "Conectar sin guardar la sesión".

**Toma 3a** · escena `empty&theme=light&video=1` [MOCK+1]

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L1 | `hl has:Conexión rápida sin guardar` (pantalla de inicio) | |
| L2 | `hl title:Conexión rápida sin guardar (⌘O)` (rayo del panel); `click` sobre él; `wait 400` | Atajo: `⌘O · Ctrl+Shift+O` |
| L3 | `click text:Telnet`; `@900 click text:TCP` (puerto pasa a 2001); `@1800 click text:Serial`; `@2700 click text:SSH` | Callout en TCP: "Sin negociación Telnet" |
| L4 | `field ph:192.0.2.10 o hostname 192.0.2.77`; `field ph:Según ~/.ssh/config admin`; `click text:Conectar`; `wait 700`; `hl has:192.0.2.77` (pestaña con rayo) | |
| L5 | `hl has:Guardar como sesión…` (barra de estado); `@1800 right has:192.0.2.77` (menú de la pestaña); `hl text:Guardar como sesión…` | |
| L6 | `click text:Guardar como sesión…`; `field ph:Router core sw-bodega` (el nombre parte en 192.0.2.77); `field ph:Raíz · usa / para subcarpetas Laboratorio`; `click text:Guardar`; `wait 500`; `hl text:sw-bodega` | Callout: "Misma pestaña, sin reconectar". Nota: el diálogo se titula "Editar sesión" (ver informe) |
| L7 | `key cmd+k`; `wait 400`; `hl has:Conexiones rápidas recientes`; `type admin@192.0.2.88`; `wait 900`; `key Escape` | Atajo: `⌘K · Ctrl+Shift+K` |

---

## Capítulo 4 · SSH, Telnet y Serial (1:21)

Tarjeta: "4 · SSH, Telnet y Serial". Subtítulo: "Jump host, túneles, equipos antiguos y contraseñas".

**Toma 4a** · escena `session-edit&theme=light&video=1` (abre "Editar sesión" de core-sw01) [MOCK+1]

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L1 | `hl has:Usa OpenSSH del sistema` | |
| L2 | `field ph:~/.ssh/id_ed25519 ~/.ssh/id_ed25519_lab`; `field ph:usuario@bastion:22 admin@198.51.100.5:22`; `zoom ph:usuario@bastion:22 1.3` | Callout: "Jump host / bastión (opcional)" |
| L3 | `unzoom`; `click has:Túneles SSH`; `click text:Agregar túnel`; `field ph:1080 8443`; `field ph:192.0.2.10 192.0.2.20`; `field ph:443 443`; `hl ph:127.0.0.1` | Callout en la dirección de escucha: "Vacío = 127.0.0.1". Ojo: el placeholder de destino del túnel ya es `192.0.2.10`; tras [MOCK+1] el de Host también, usar `css:` si choca |
| L4 | `click title:Cerrar`; `click title:Nueva sesión`; `click text:Serial`; `hl has:Velocidad`; `@1500 hl has:Paridad`; `@2500 hl has:Flujo`; `click title:Cerrar` | |

**Toma 4b** · escena `legacy&theme=light&video=1` (abre router-antiguo, 192.0.2.99)

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L5 | `wait 600`; `zoom has:Unable to negotiate 1.5` | Texto en terminal (mock): "Unable to negotiate with 192.0.2.99 port 22: no matching host key type found. Their offer: ssh-rsa" |
| L6 | `hl has:Presiona L`; `@2200 type L`; `wait 900`; `unzoom`; `hl has:Compatibilidad con equipos antiguos activada` | Tecla en pantalla: "L" |
| L7 | `hover text:router-antiguo`; `click title:Editar`; `hl has:Permitir algoritmos legacy`; `click title:Cerrar`; `key cmd+,`; `click text:Terminal`; `hl has:Activar algoritmos legacy automáticamente`; `key Escape` | |
| L8 | sin acción | Rótulo inferior en rojo: "Algoritmos débiles: solo redes de gestión confiables" |

**Toma 4c** · escena `empty&theme=light&video=1` [MOCK+5]
Prep: ninguna. sw-acceso-norte (Telnet, 203.0.113.20) ya tiene contraseña guardada en el mock (`mock.js:33`, `mock.js:939`).

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L9 | `hover text:sw-acceso-norte`; `click title:Editar`; `hl has:Guardar contraseña`; `@2000 hl has:Guardada`; `hl text:Cambiar`; `hl text:Borrar` | Callout: "Solo escritura: nunca se muestra" |
| L10 | `click title:Cerrar`; `dbl text:sw-acceso-norte`; `wait 1500` (Username/Password completados por el mock) | Rótulo: "Simulación del autocompletado" |
| L11 | sin acción | Lista en pantalla: "No se completa: contraseña rechazada · passphrase de llave · bastión del jump host · segundo pedido" |
| L12 | `hl title:Contraseña guardada: se completa sola en el primer pedido de contraseña al conectar`; `@2200 click title:Ajustes`; `click text:Credenciales`; `hl has:Bóveda cifrada` | |

---

## Capítulo 5 · Pestañas y vista dividida (0:51)

Tarjeta: "5 · Pestañas y vista dividida". Subtítulo: "Renombrar, dividir y cerrar con control".

**Toma 5a** · escena `empty&theme=light&video=1` [MOCK+1]
Prep: conexión rápida a 192.0.2.77 (como `quickTo` en `mock.js:992-996`), luego `dbl` core-sw01, ar-wan01, dist-sw01, fw-perimetro; `wait 800`; clic en la pestaña core-sw01.

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L1 | `click has:ar-wan01` (pestaña); `@900 click has:dist-sw01`; `@1800 click has:core-sw01`; `hl css:main div.h-10.bg-chrome` | |
| L2 | `dbl has:ar-wan01`; `type WAN principal\n`; `js window.__ntMockAsync()`; `wait 400`; `hl title:Salida nueva` | Callout: "Salida nueva en segundo plano" |
| L3 | `right has:core-sw01`; `hl text:Duplicar`; `@900 hl text:Reconectar`; `@1700 hl text:Desconectar`; `@2500 hl text:Copiar toda la salida` | |
| L4 | `click text:Pestañas verticales`; `wait 500`; `click title:Plegar pestañas a iconos`; `@1500 click title:Expandir pestañas`; `right has:core-sw01`; `click text:Pestañas horizontales` | Callout en el borde: "Arrastra para cambiar el ancho" |
| L5 | `click title:Vista dividida: ver 2 o 4 pestañas a la vez`; `click text:4 en cuadrícula (2x2)`; `wait 500`; `hl title:Pestaña del panel 1` (selector); `@2600` clic en el icono de vista dividida y `click text:Vista única` | |
| L6 | `right has:dist-sw01`; `hl text:Cerrar las demás`; `@900 hl text:Cerrar las de la derecha`; `@1800 hl text:Cerrar todas las pestañas`; `click text:Cerrar todas las pestañas` | |
| L7 | `zoom css:[role=alertdialog] 1.3`; `hl has:Se cortan`; `@2000 hl has:conexión rápida`; `@3200 hl text:Cancelar`; `key Escape`; `unzoom` | |
| L8 | `key cmd+shift+w`; `wait 700`; `key Escape` | Atajo: `⌘⇧W · Ctrl+Shift+Alt+W` |

---

## Capítulo 6 · Catálogo de comandos (0:46)

Tarjeta: "6 · Catálogo de comandos". Subtítulo: "1.776 comandos con fuente y riesgo".

**Toma 6a** · escena `suggest&noplatform=1&theme=light&video=1` (core-sw01 abierta, plataforma sin detectar)

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L1 | `key cmd+l`; `wait 500`; `zoom css:aside[style] header 1.3` | Atajo: `⌘L · Ctrl+Shift+L` |
| L2 | `unzoom`; `hl title:Catálogo` (select `aria-label="Catálogo"`) | Lámina lateral: "Equipos de red: Cisco · Juniper · Fortinet · Huawei · Check Point · WatchGuard / Sistemas operativos: Windows · macOS · Linux" |
| L3 | `hl text:Detectar`; `click text:Detectar`; `wait 900`; `hl has:Plataforma detectada` (aviso "Plataforma detectada: IOS-XE (16.x/17.x)") | Callout: "Ejecuta show version" |
| L4 | `hl title:La sintaxis y los comandos se ajustan a la plataforma` | |
| L5 | `field ph:Buscar comando o tarea (ej: vecinos, óptico, CPU) vecinos`; `wait 600` | |
| L6 | `set ph:Buscar comando o tarea (ej: vecinos, óptico, CPU) clear`; `wait 500`; `hl has:Cambia config/estado`; `@1600 hl has:Puede cortar servicio` | Leyenda: "Consulta · Cambia config/estado · Puede cortar servicio" |
| L7 | `set ph:Buscar… vecinos`; `hover has:show cdp neighbors`; `hl text:Ejecutar`; `@1300 hl text:Escribir`; `click text:Ejecutar` (consulta: se ejecuta sin diálogo) | |
| L8 | `click title:Agregar a favoritos`; `@1200 click text:Favoritos`; `@2200 hl title:Agregar un comando propio`; `@3200 hl title:Packs de comandos`; `key cmd+l` (cierra) | |

---

## Capítulo 7 · Sugerencias de comandos (2:07)

Tarjeta: "7 · Sugerencias de comandos". Subtítulo: "Autocompletado seguro para la CLI".

Requisitos de toda la toma: [REC+3] (teclas `ArrowRight`, `ArrowLeft` y `.`), zoom de cámara sobre la línea del cursor (escala 1.6 a 1.8), ritmo de tipeo lento (`type` con 110 ms) para que se vea el texto gris aparecer.

**Toma 7a** · escena `suggest&noplatform=1&theme=light&video=1`

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L1 | `key cmd+,`; `click text:Terminal`; `zoom has:Sugerencias de comandos 1.4`; `hl has:Sugerencias de comandos`; `key Escape`; `unzoom` | Rótulo: "Encendidas por defecto" |
| L2 | sin acción | Chips: "SSH · Telnet · Serial · TCP" y "Plataforma detectada o fijada" |
| L3 | `click css:.xterm`; `type sh`; `wait 300`; `zoom has:Detecta la plataforma 1.5` (aviso: "Detecta la plataforma para activar sugerencias: Comandos (⌘L) › Detectar"); `unzoom`; `key cmd+l`; `click text:Detectar`; `wait 900`; `key cmd+l`; `click css:.xterm`; `key Backspace` ×2 | Callout: "Una vez por pestaña" |

**Toma 7b** · misma página (plataforma ya detectada). Cámara fija sobre la terminal (zoom 1.6 a la línea del prompt).

| Línea | Pasos | Lo que se ve |
| --- | --- | --- |
| L4 | `type sh ver` | En gris: `sion` |
| L5 | `key ArrowRight`; `wait 400`; `key Enter` | Línea `sh version`; respuesta "Cisco IOS XE Software, Version 17.12.04". Tecla en pantalla: "→" |
| L6 | `type sh ip`; `wait 500`; `key ctrl+ArrowRight` → `sh ip interface `; `wait 700`; `key ctrl+ArrowRight` → `sh ip interface brief`; `key Enter` | Tecla en pantalla: "Ctrl+→ · Option+→". Salida de `show ip interface brief` del mock |
| L7 | `type sh int`; `key ctrl+.`; `wait 600` (lista: show interfaces transceiver detail, …, show interfaces status, …); `key ArrowDown` ×3 (verificar índice en ensayo); `key Enter` → `sh interfaces status`; `key Enter`; luego `type sh`, `key ctrl+.`, `key Escape`, `key Backspace` ×2 | Callout en el pie de la lista: "↑↓ elegir · Enter escribe sin ejecutar · Esc cerrar". Tecla: "Ctrl+." |
| L8 | `type sh clo`; `key Tab` [MOCK+6]; `wait 300`; `key Enter` | El equipo completa `clock`. Callout: "Tab va al equipo" |
| L9 | `type sh ip int br` (lento) ; `wait 600`; `key ArrowRight`; `key Enter` | En gris: `ief`. Rótulo grande: "sh ip int br = show ip interface brief" |
| L10 | `click has:ar-wan01` (pestaña) [MOCK+7]; `type dis int br`; `wait 600`; `key Backspace` ×10; `click has:core-sw01` | En gris: `ief`. Chips: "Cisco · Huawei · Juniper · Fortinet" |

**Toma 7c** · escena `suggest-config&theme=light&video=1` (core-sw01 en `core-sw01(config-if)#`, plataforma IOS-XE)

| Línea | Pasos | Lo que se ve |
| --- | --- | --- |
| L11 | `click css:.xterm`; `type sh`; `wait 800` | Sin texto gris. `hl` del prompt `(config-if)#` |
| L12 | `key ctrl+.`; `wait 400` | Aviso: "Modo configuración: escribe «do » antes de una consulta para ver sugerencias". Rótulo: "En (config-if)#, sh = shutdown" |
| L13 | `key Backspace` ×2; `type do sh ip int br`; `wait 500`; `key ArrowRight`; `key Enter` [MOCK+8] | En gris: `ief`; respuesta de `show ip interface brief`; el prompt sigue en `(config-if)#` |
| L14 | `type end\n` | Lámina lateral: "Cisco: do · Junos: run · Huawei: display completo · ASA: show completo" |
| L15 | `type rel`; `wait 900`; `key Backspace` ×3 | Sin texto gris. Callout: "reload: puede cortar servicio" |
| L16 | `type clear cou`; `key ctrl+.`; `wait 600`; `zoom has:Cambia config/estado 1.6` | Lista con `clear counters {{interfaz}}` y distintivo rojo "Cambia config/estado" |
| L17 | `unzoom`; `key Enter`; `wait 400`; `zoom css:[role=alertdialog] 1.3` | Diálogo "Este comando cambia configuración o estado", texto "Cambia config/estado en core-sw01. Se escribe en la línea sin ejecutarlo (sin Enter): clear counters", botón "Insertar" |
| L18 | `click text:Insertar`; `unzoom`; `wait 1200`; `key Backspace` ×15 | Línea `clear counters ` sin ejecutar. Rótulo: "Sin Enter: tú decides" |
| L19 | `type sh run`; `key ctrl+.`; `key ArrowDown` ×2 (verificar: `show running-config interface {{interfaz}}`); `key Enter`; `type Gi1/0/1`; `key Enter` [MOCK+9] | Se inserta `sh running-config interface ` y se detiene en la variable |
| L20 | `type sh int`; `key ctrl+.`; `wait 900`; `hl` primer ítem; `key Escape`; `key Backspace` ×6 | "show interfaces status" ahora aparece primero por el uso de L7 |
| L21 | sin acción | Lámina lateral: "Se guarda: show interfaces status (plantilla del catálogo) · No se guarda: argumentos, equipos ni secretos" |
| L22 | `key cmd+,`; `click text:Terminal`; `hl has:Tecla para abrir la lista`; `@1500 click text:Borrar historial de sugerencias`; `hl text:Historial borrado`; `key Escape` | |
| L23 | `dbl text:Shell local`; `type sh`; `wait 900` | Sin texto gris ni aviso. Callout: "Terminal local: sin sugerencias" |

---

## Capítulo 8 · Notas, plantillas y envío a varias sesiones (1:00)

Tarjeta: "8 · Notas y envío a varias sesiones". Subtítulo: "Plantillas con variables y control de riesgo".

**Toma 8a** · escena `empty&theme=light&video=1` [MOCK+10]
Prep: `dbl` core-sw01 y core-sw02; clic en la pestaña core-sw01.

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L1 | `key cmd+j`; `wait 500`; elegir la nota `consultas-diarias.txt` en el selector | Atajo: `⌘J · Ctrl+Shift+J` |
| L2 | clic en la línea 2 (`show ip interface brief`); `key cmd+Enter`; `wait 700`; `hl text:Todo` | Atajo: `⌘Enter · Ctrl+Enter`. Es la excepción a la regla "⌘ = Ctrl+Shift": en Windows y Linux, Ctrl+Shift+Enter envía Todo (`NotesPanel.tsx:608-611`) |
| L3 | elegir `plantilla-vlan.txt`; `hl` de `{{vlan}}`; `click text:Todo`; `wait 400` (diálogo "Completar plantilla"); `field` vlan `30`, nombre `CAMARAS`, interfaz `GigabitEthernet1/0/7`, descripcion `CAMARA PISO 2` | |
| L4 | `hl has:Los valores se recuerdan`; `click text:Continuar` | Opcional [MOCK+11]: mostrar `usuario-local.txt` con `{{clave}}` en campo oculto |
| L5 | `hl css:[role=alertdialog]` ("¿Enviar 13 líneas a core-sw01?", "Cambia config/estado."); `@2200 click text:Cancelar` | Rótulo: "En el ejemplo cancelamos" |
| L6 | elegir `accesos-sitio-central` → pantalla "Nota protegida con contraseña"; `field ph:Contraseña de la nota demo-clave-2026` + Enter; `click title:Protección de la nota`; `hl has:Bloqueo por inactividad`; `click title:Bloquear nota` | Callout: "5 min por defecto" |
| L7 | `click title:Elegir a qué sesiones se envía`; `click text:Pestañas elegidas`; marcar core-sw01 y core-sw02; cerrar el selector | |
| L8 | elegir `cambio-descripcion.txt`; `click text:Todo`; `wait 500`; `hl has:Destinos, en este orden`; `@1800 hl has:Texto completo` (marcas "cambio" por línea) | |
| L9 | `field css:[role=alertdialog] input[inputmode=numeric] 2`; `hl has:Enviar a 2 equipos`; `click has:Enviar a 2 equipos` | Callout: "Escribe la cantidad de equipos" |
| L10 | `wait 600`; `click text:Ver detalle`; `hl text:Detener`; `@2000 click text:Detener` | |

---

## Capítulo 9 · Logs, alertas, historial y búsqueda (0:44)

Tarjeta: "9 · Logs, alertas, historial y búsqueda".

**Toma 9a** · escena `empty&theme=light&video=1` [MOCK+12]
Prep: `dbl` core-sw01 y ar-wan01; clic en la pestaña core-sw01.

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L1 | `hl title:Grabar la sesión en un archivo de texto`; `click` sobre él; `wait 400`; `hl has:Grabando` | Callout con la ruta: `~/NetTerminal/data/logs/core-sw01_20261021-101500.log` |
| L2 | `key cmd+,`; `click text:Logs`; `hl has:Grabar logs automáticamente`; `@1200 hl has:Hora en cada línea del log`; `@2400 hl has:Nombre del archivo`; `@3600 hl has:Rotación diaria` | |
| L3 | `hl has:Ocultar secretos en los logs` | |
| L4 | `click text:Alertas`; `hl has:Interfaz cambió de estado`; `click text:Nueva alerta`; `hl has:Sesiones`; `@1800 hl has:Expresión regular`; `click text:Cancelar` (o cerrar el borrador) | Rótulo: "Trae 3 ejemplos, apagados" |
| L5 | `key Escape`; `js` emitir alerta (ver [MOCK+12]); `wait 600`; `hl` del aviso; `hl title:Alerta por palabra clave` | Callout: "Nunca envía comandos" |
| L6 | `click title:Historial de comandos enviados a este equipo`; `hl has:Últimos comandos enviados`; `@2200 key Escape` | |
| L7 | `key cmd+f`; `type UPDOWN\n`; `wait 800`; `key Escape` | Atajo: `⌘F · Ctrl+Shift+F` |

---

## Capítulo 10 · Apariencia y Ajustes (0:32)

Tarjeta: "10 · Apariencia y Ajustes".

**Toma 10a** · escena `s-appearance&theme=light&video=1`
Prep: `dbl text:core-sw01` antes de abrir Ajustes (para ver el tema aplicado detrás).

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L1 | `hl css:aside` (columna de secciones de Ajustes) | Atajo: `⌘, · Ctrl+,` |
| L2 | `click text:Oscuro`; `wait 900`; `click text:Claro` | |
| L3 | `click text:Ámbar`; `@900 click text:Dracula`; `@1800 click text:Tokyo Night`; `@2700 click text:Automático` | Rótulo: "17 temas + Automático" |
| L4 | `hl has:Fuente`; `@800 hl has:Tamaño`; `@1600 hl has:Interlineado`; `@2400 hl has:Cursor` | |
| L5 | `click text:Resaltado`; `hl has:Resaltar salida de la terminal` | |
| L6 | `field title:Buscar ajuste legacy` (o `css:input[aria-label="Buscar ajuste"]`); `wait 700`; `set` vacío; `click text:Módulos`; `hl css:main .space-y-5` | |
| L7 | `hl text:Los cambios se aplican al instante` | **No hacer clic en "Restablecer valores"** (ver informe) |

---

## Capítulo 11 · Cierre (0:19)

**Toma 11a** · escena `empty&theme=light&video=1`

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L1 | montaje rápido: `hl css:aside`, `hl has:Conexión rápida sin guardar`, `hl has:Herramientas de red` | |
| L2 | `hover title:Conexión rápida sin guardar (⌘O)` | Callout que replica el tooltip "Conexión rápida sin guardar (⌘O)" [REC+4] |
| L3 | lámina final | "Video 2 · Herramientas de red" y "Video 3 · Automatización" |
| L4 | logo de la pantalla de inicio | |

---

## Extensiones del mock

Se recomienda un archivo propio `scripts/video/v2/v1-primeros-pasos/mock-v1.js` que extienda `window.__mock` (como `scripts/video/plugins/mock-video.js`) y un `demo.html` que lo cargue, para no tocar las capturas.

| Id | Necesidad | Detalle exacto |
| --- | --- | --- |
| MOCK+1 | Placeholder con IP de documentación | MutationObserver que reemplaza `10.0.0.1` por `192.0.2.10` en `placeholder`, igual que `mock-video.js:17-20`. Mantener `confirmClose` en `true` (el de plugins lo apaga y el capítulo 5 necesita el aviso). |
| MOCK+2 | `update=1` coherente | Hoy `app_version` devuelve `0.9.5` y el aviso dice "tienes 0.9.1" (`mock.js:452`, `mock.js:917-922`). Con `update=1`: `app_version` → `"0.9.4"`; `update_check` → `{ current: "0.9.4", latest: "0.9.5", newer: checks++ > 0, supported: true, reason: null }` y `notes`: `"- Sugerencias de comandos al escribir\n- Topología por SNMP y tráfico en enlaces\n- Cerrar las demás, las de la derecha o todas las pestañas\n- Catálogo auditado y motor de riesgo reforzado"` (resumen del commit `c0f706d`, v0.9.5). |
| MOCK+3 | Aviso de actualización manual (opcional) | `update=1&updmanual=1`: `supported: false`, `reason: "En modo portable la actualización es manual: reemplaza los archivos de la carpeta."` (texto real de `src-tauri/src/updates.rs:58`). El aviso muestra "Descargar". |
| MOCK+4 | Importar desde ssh_config | `import_sessions_file` debe respetar `format: "openssh"` (hoy siempre devuelve PuTTY, `mock.js:510-517`). Fixture: `{ format: "openssh", sessions: [ { name: "bastion-dc", type: "ssh", host: "198.51.100.5", port: 22, username: "admin", folder: "SSH config" }, { name: "sw-lab-01", type: "ssh", host: "192.0.2.30", port: 22, username: "admin", jump_host: "admin@198.51.100.5:22", folder: "SSH config" } ], warnings: ["sw-lab-01: los túneles no se importan; agrégalos en la sesión si los necesitas"] }` (texto del aviso de `src-tauri/src/importers.rs:382`). |
| MOCK+5 | Login Telnet simulado con contraseña guardada | Para `sw-acceso-norte` en modo video, `connect` escribe: `"\r\nUser Access Verification\r\n\r\nUsername: admin\r\nPassword: \r\n\r\nsw-acceso-norte#"`. El autocompletado real ocurre en Rust (`src-tauri/src/autofill.rs`), así que el mock solo representa el resultado; se rotula como simulación. |
| MOCK+6 | Tab del equipo | En `handlers.write`, `"\t"`: completar la última palabra con un diccionario mínimo (`show`, `clock`, `version`, `interfaces`, `ip`, `interface`, `brief`, `running-config`) y hacer eco del resto más un espacio. `sh clo` + Tab → eco `ck `. |
| MOCK+7 | Huawei con plataforma | En la escena `suggest`, además `sessions[3].platform = "vrp8"` (ar-wan01). El índice VRP8 completa `dis int br` → `ief` (verificado con `src/lib/suggest.ts`). |
| MOCK+8 | `do` en configuración | En `respond`, si la conexión está en modo configuración y el comando empieza con `do `, quitar el prefijo, responder la consulta y no cambiar de modo. |
| MOCK+9 | `show running-config interface` | Responder `/^sh(ow)? run(ning-config)? int(erface)? (\S+)/` con el bloque de `GigabitEthernet1/0/1` que ya está en `CISCO` (`mock.js:51-58`), con `Building configuration...` y `end`. |
| MOCK+10 | Nota de consultas | `notes["consultas-diarias.txt"] = "show clock\nshow ip interface brief\nshow cdp neighbors"`. |
| MOCK+11 | Variable secreta (opcional) | `notes["usuario-local.txt"] = "! Usuario local de emergencia (datos ficticios)\nusername {{usuario}} privilege 15 secret {{clave}}\nend"`. `clave` coincide con `SECRET_VAR` (`src/components/TemplateDialog.tsx:17`) y se pide oculta. |
| MOCK+12 | Alerta a demanda | Parámetro `alertrule=1` que instale la regla `qa-updown` activa (como `toast=1`, `mock.js:177-183`) sin dispararla sola. En la toma: `window.__mock.emit("alert-hit", { conn: [...window.__mock.channels.keys()][0], rule: "qa-updown", line: "%LINK-3-UPDOWN: Interface GigabitEthernet1/0/3, changed state to down" })`. |

## Extensiones del grabador

| Id | Necesidad | Detalle |
| --- | --- | --- |
| REC+1 | Láminas | Capítulos 1, 6, 7 y 11 usan láminas o rótulos laterales. Reutilizar `scripts/video/plugins/escenario.html` o agregar un tipo de paso `card`. |
| REC+2 | Arrastrar y soltar | No hay paso `drag`. Opción con `js`: crear `new DataTransfer()`, `setData("application/x-nt-session", id)` y despachar `dragstart` en la fila origen, `dragover` y `drop` en la fila destino (tipos de `src/components/Sidebar.tsx:67-68`), con `move` del cursor entre ambos para que se vea. |
| REC+3 | Teclas faltantes | `scripts/video/record.mjs:55` no tiene `ArrowRight`, `ArrowLeft` ni `.`. Con `ctrl+.` hoy se enviaría `code: "Key."` y `windowsVirtualKeyCode: 46` (Delete). Agregar `ArrowRight: [39]`, `ArrowLeft: [37]` y `"." → { key: ".", code: "Period", windowsVirtualKeyCode: 190 }`. |
| REC+4 | Tooltips | Los `title` nativos no salen en el screencast. Replicarlos con un callout del overlay. |

## Léxico TTS a revisar

Términos nuevos frente al guion anterior (`scripts/video/tts.mjs:14-40`): `1.776` (el léxico solo tiene `1.777`), `Ctrl+→`, `Option+→`, `→`, `Ctrl+.`, `Ctrl+,`, `⌘⇧W`, `Ctrl+Shift+Alt+W`, `⌘K`, `⌘L`, `⌘J`, `⌘F`, `Ctrl+Shift`, `sh ip int br`, `sh`, `do`, `run`, `display`, `reload`, `CLI`, `IOS-XE`, `Junos`, `127.0.0.1`, `.dmg`, `.deb`, `AppImage`, `Sucursales/Centro`, `config/estado`, `passphrase`, `communities`, `legacy`, `jump host`, `Tokyo Night`, `Dracula`.
