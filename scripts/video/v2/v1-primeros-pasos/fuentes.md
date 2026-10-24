# Fuentes · Video 1: Primeros pasos y uso diario

Cada afirmación del guion con el archivo y la línea que la respaldan. Rutas relativas a la raíz del repositorio. Verificado sobre el commit `c0f706d` (v0.9.5).

Atajos: `src/lib/platform.ts`. Valores por defecto: `src/lib/settings.ts:121-181`. Los números de línea `L` corresponden a cada frase del guion (sin contar el título).

## 01 · Qué es NetTerminal e instalación

| L | Afirmación | Fuente |
| --- | --- | --- |
| 1-2 | SSH, Telnet, Serial y terminal local; macOS, Windows y Linux | `src/types/index.ts:1`, `src/components/SessionIcon.tsx:35-41`, `README.md:3` |
| 3 | Datos ficticios en la demo | `scripts/screenshots/mock.js:1-4` |
| 4 | Paquetes: .dmg, instalador de Windows (NSIS por usuario), AppImage, .deb | `src-tauri/tauri.conf.json:31-37`, `src-tauri/tauri.conf.json:48-49`, `docs/index.html:330-333` |
| 5 | Zip portable con los tres ejecutables, marcador `portable` y carpeta `data` | `.github/workflows/build.yml:181-197`, `README.md:110-119`; detección del modo portable en `src-tauri/src/session_store.rs:34-66` |
| 6 | Revisión al abrir (4 s después) y cada 6 horas; "Buscar ahora" en Acerca de | `src/App.tsx:285-307`, `src/components/SettingsModal.tsx:623-669`, `src/components/SettingsModal.tsx:672-700` |
| 7 | Aviso arriba con "Ver novedades" | `src/App.tsx:1080-1127` |
| 8 | "Actualizar y reiniciar": descarga con progreso, firma verificada, confirmación si hay sesiones abiertas | `src/App.tsx:308-325`, `src/App.tsx:1092-1101`, `src-tauri/src/updates.rs:1-5`, `src-tauri/src/updates.rs:117-119`, clave pública en `src-tauri/tauri.conf.json:59` |
| 9 | Portable y .deb: actualización manual | `src-tauri/src/updates.rs:56-62`, `src/App.tsx:1103-1110` |

## 02 · Sesiones y carpetas

| L | Afirmación | Fuente |
| --- | --- | --- |
| 1 | Carpetas y subcarpetas sin límite | `src/components/Sidebar.tsx:114-139`, `src/components/Sidebar.tsx:197-206` |
| 2 | En Windows y Linux el modificador es Ctrl+Shift | `src/lib/platform.ts:3-11` |
| 3 | Botón más y ⌘N; tipos SSH, Telnet, Serial, TCP, Local | `src/components/Sidebar.tsx:396-398`, `src/lib/platform.ts:71-72`, `src/components/SessionModal.tsx:139-152`, `src/components/SessionIcon.tsx:35-41` |
| 4 | Carpeta con barra para subcarpetas | `src/components/SessionModal.tsx:164-169` |
| 5 | Host, Puerto, Usuario y botón Guardar | `src/components/SessionModal.tsx:182-212`, `src/components/SessionModal.tsx:487-498` |
| 6 | Doble clic conecta; punto verde si está conectada | `src/components/Sidebar.tsx:337`, `src/components/Sidebar.tsx:351-360` |
| 7 | Menú: Conectar, Editar, Duplicar, Eliminar; la copia no lleva contraseña | `src/components/Sidebar.tsx:208-216`, `src/App.tsx:874-882` (`save_password: undefined`) |
| 8 | Menú de carpeta: Conectar todas, Nueva sesión aquí, Nueva subcarpeta, Renombrar | `src/components/Sidebar.tsx:197-206` |
| 9 | Arrastrar sesiones y carpetas | `src/components/Sidebar.tsx:218-248`, `src/components/Sidebar.tsx:257-263`, `src/components/Sidebar.tsx:330-334` |
| 10 | Filtro por nombre, IP, usuario o carpeta (también puerto serial) | `src/components/Sidebar.tsx:104-110`, `src/components/Sidebar.tsx:381-389` |
| 11 | Ajustes › Importar y exportar › Desde archivo… | `src/components/SettingsModal.tsx:63`, `src/components/SettingsModal.tsx:464-490` |
| 12 | Formatos ssh_config, PuTTY, SecureCRT, MobaXterm, CSV; vista previa; sin contraseñas ni túneles | `src/components/ImportDialog.tsx:23-31`, `src/components/ImportDialog.tsx:147-163`, `src/components/ImportDialog.tsx:168-215`, `src-tauri/src/importers.rs:371-383` |

## 03 · Conexión rápida

| L | Afirmación | Fuente |
| --- | --- | --- |
| 1 | No guarda la sesión | `src/components/QuickConnectDialog.tsx:22`, `src/components/QuickConnectDialog.tsx:245` |
| 2 | Rayo junto al más; ⌘O | `src/components/Sidebar.tsx:391-395`, `src/lib/platform.ts:73-74`, `src/App.tsx:1417` |
| 3 | SSH, Telnet, TCP, Serial; TCP sin negociación Telnet (puerto 2001 por defecto) | `src/components/QuickConnectDialog.tsx:17-18`, `src/components/QuickConnectDialog.tsx:172` |
| 4 | Pestaña con rayo | `src/components/SessionIcon.tsx:32-33`, `src/components/StatusBar.tsx:104-108` |
| 5 | "Guardar como sesión…" en barra de estado y menú de la pestaña | `src/components/StatusBar.tsx:104-109`, `src/components/tabMenu.tsx:57-60` |
| 6 | La pestaña pasa a la sesión guardada sin reconectar | `src/App.tsx:794-798`, `src/App.tsx:908-911` |
| 7 | ⌘K: buscar sesión o usuario@host; "Conexiones rápidas recientes" | `src/lib/platform.ts:64-66`, `src/components/CommandPalette.tsx:84-98`, `src/components/CommandPalette.tsx:143`, `src/components/CommandPalette.tsx:161-168`, `src/components/QuickConnectDialog.tsx:82-84` |

## 04 · SSH, Telnet y Serial

| L | Afirmación | Fuente |
| --- | --- | --- |
| 1 | SSH con el OpenSSH del sistema; config, agente y llaves | `src/components/SessionModal.tsx:263-266`, `README.md:36` |
| 2 | Llave privada y jump host (`usuario@bastion:22`) | `src/components/SessionModal.tsx:216-230` |
| 3 | Túneles -L, -R, -D; escucha vacía = 127.0.0.1 | `src/components/SessionModal.tsx:644-720`, `src/types/index.ts:44-51` |
| 4 | Telnet propio; Serial con puerto, velocidad, paridad y flujo | `src-tauri/src/telnet.rs:1`, `src/components/SessionModal.tsx:270-358`, `src/components/SessionModal.tsx:23` |
| 5-6 | Detección del error de negociación y tecla L | `src/components/TerminalView.tsx:126`, `src/components/TerminalView.tsx:335-351`, `src/components/TerminalView.tsx:711-714` |
| 7 | "Permitir algoritmos legacy" en la sesión; "Activar algoritmos legacy automáticamente", apagado | `src/components/SessionModal.tsx:248-262`, `src/components/SettingsModal.tsx:374-379`, `src/lib/settings.ts:134`, `src/components/TerminalView.tsx:343-346` |
| 8 | Algoritmos débiles, solo redes confiables | `src/components/SettingsModal.tsx:376` |
| 9 | Contraseña en bóveda cifrada, campo solo escritura | `src/components/SessionModal.tsx:505-604`, `src-tauri/src/credentials.rs:1-5`, `src/components/CredentialSettings.tsx:40-55` |
| 10 | Se completa una sola vez, en el primer pedido (ventana de 60 s) | `src-tauri/src/autofill.rs:1-10`, `src-tauri/src/autofill.rs:102-117`, `src/components/SessionModal.tsx:534-538` |
| 11 | No completa tras rechazo, passphrase ni en el bastión | `src-tauri/src/autofill.rs:13-23`, `src-tauri/src/autofill.rs:102-111`, `src-tauri/src/autofill.rs:136`, `src-tauri/src/autofill.rs:208` |
| 12 | Llave en la barra de estado | `src/components/StatusBar.tsx:111-118` |

## 05 · Pestañas y vista dividida

| L | Afirmación | Fuente |
| --- | --- | --- |
| 1 | La sesión sigue activa al cambiar de pestaña | `src/App.tsx:1134-1135` (todas las terminales montadas), `README.md:41` |
| 2 | Doble clic renombra; marca "Salida nueva" | `src/components/TabBar.tsx:175`, `src/components/TabBar.tsx:185`, `src/components/TabBar.tsx:214-216` |
| 3 | Menú: Duplicar, Reconectar, Desconectar, Copiar toda la salida | `src/components/tabMenu.tsx:47-65` |
| 4 | Pestañas verticales; ancho ajustable; plegar a íconos | `src/components/tabMenu.tsx:38-44`, `src/components/VerticalTabs.tsx:41-48`, `src/components/VerticalTabs.tsx:134-135`, `src/components/VerticalTabs.tsx:327-336`, `src/lib/settings.ts:123` |
| 5 | Vista dividida: 2 lado a lado, 2 apiladas, 4 en cuadrícula; selector por panel | `src/lib/split.ts:12-16`, `src/components/tabMenu.tsx:85-91`, `src/components/TabBar.tsx:248-259`, `src/components/SplitPanes.tsx:46-52` |
| 6 | Cerrar las demás / de la derecha (de abajo en vertical) / todas | `src/components/tabMenu.tsx:67-83`, `src/lib/closeAll.ts:8-13` |
| 7 | Aviso con sesiones que se cortan, transferencias, conexiones rápidas; foco en Cancelar | `src/App.tsx:468-494`, `src/components/CloseManyMessage.tsx:15-75`, `src/lib/closeAll.ts:32-47`, `src/components/ConfirmDialog.tsx:9-10`, `src/components/ConfirmDialog.tsx:48-50` |
| 8 | ⌘⇧W / Ctrl+Shift+Alt+W | `src/lib/platform.ts:13-14`, `src/lib/platform.ts:55-60` |

## 06 · Catálogo de comandos

| L | Afirmación | Fuente |
| --- | --- | --- |
| 1 | ⌘L; 1.776 comandos (275+242+206+180+170+120+206+134+243) con fuente | `src/lib/platform.ts:83-84`, `src/packs/*.json` (conteo de `commands`), `README.md:57` |
| 2 | Fabricantes y sistemas operativos | `src/components/CommandsPanel.tsx:143-163`, `src/lib/packs.ts:89-90` |
| 3 | Detectar ejecuta el comando de detección (`show version` en Cisco) | `src/components/CommandsPanel.tsx:188-196`, `src/App.tsx:600-629`, `src/packs/cisco.json` (`detectCommand`) |
| 4 | La plataforma se guarda en la sesión | `src/App.tsx:591-598` |
| 5 | Búsqueda por comando o tarea | `src/components/CommandsPanel.tsx:200-209` |
| 6 | Riesgos: Consulta, Cambia config/estado, Puede cortar servicio | `src/lib/packs.ts:92-96`, `src/components/CommandsPanel.tsx:311-315` |
| 7 | Ejecutar confirma si no es consulta; Escribir sin Enter | `src/App.tsx:963-979`, `src/components/CommandsPanel.tsx:328-336` |
| 8 | Favoritos y "Propio"; Packs de comandos | `src/components/CommandsPanel.tsx:164-166`, `src/components/CommandsPanel.tsx:215-224`, `src/components/CommandsPanel.tsx:320-326` |

## 07 · Sugerencias de comandos

| L | Afirmación | Fuente |
| --- | --- | --- |
| 1 | Encendidas por defecto | `src/lib/suggest.ts:791-792`, `src/lib/settings.ts:135-137`, `src/components/SettingsModal.tsx:380-385` |
| 2 | SSH, Telnet, Serial y TCP con plataforma detectada o fijada | `src/lib/suggest.ts:786-787`, `src/components/TerminalView.tsx:457-462` |
| 3 | Aviso de plataforma una vez por pestaña | `src/components/TerminalView.tsx:450-451`, `src/components/TerminalView.tsx:555-559`, `src/components/TerminalView.tsx:577` |
| 4 | Texto gris solo para consultas, desde 2 caracteres | `src/lib/suggest.ts:473-498` |
| 5 | → acepta todo | `src/lib/suggest.ts:862-863`, `src/components/TerminalView.tsx:666-669` |
| 6 | Ctrl+→ (Option+→ en macOS) acepta una palabra | `src/lib/suggest.ts:522-525`, `src/lib/suggest.ts:864-865`, `src/components/TerminalView.tsx:670-672` |
| 7 | Ctrl+. abre hasta 8; flechas, Enter, Escape | `src/lib/settings.ts:137`, `src/lib/suggest.ts:820-839`, `src/lib/suggest.ts:854-861`, `src/components/TerminalView.tsx:632`, `src/components/TerminalView.tsx:1134` |
| 8 | Tab siempre va al equipo | `src/lib/suggest.ts:850-851`, `src/components/TerminalView.tsx:689-692` |
| 9 | Abreviaturas (`sh ip int br` → `show ip interface brief`) | `src/lib/suggest.ts:388-421`, `src/lib/suggest.ts:500-515`; verificado con el catálogo: `ghostFor("sh ip int br")` en iosxe devuelve `ief` |
| 10 | Abreviaturas solo en Cisco, Huawei, Juniper, Fortinet | `src/lib/suggest.ts:283-287` |
| 11-12 | Sin texto gris en configuración; `sh` = `shutdown` | `src/lib/suggest.ts:59-82`, `src/lib/suggest.ts:104-115` |
| 13-14 | Escapes `do` (Cisco), `run` (Junos), `display` completo (Huawei), `show` (ASA) | `src/lib/suggest.ts:84-102`, aviso en `src/components/TerminalView.tsx:631` |
| 15 | Sin texto gris si lo escrito ya puede ser riesgoso (`reload`) | `src/lib/suggest.ts:483-485`, `src/lib/suggest.ts:586-596` |
| 16 | Riesgosos solo en la lista, con distintivo rojo | `src/lib/suggest.ts:490`, `src/components/TerminalView.tsx:1126-1128` |
| 17 | Confirmación y escritura sin Enter (botón "Insertar") | `src/components/TerminalView.tsx:641-653`, `src/components/TerminalView.tsx:1018-1033` |
| 18 | Ninguna sugerencia envía Enter | `src/lib/suggest.ts:598-602`, `src/lib/suggest.ts:852-857` |
| 19 | Se inserta hasta la variable | `src/lib/suggest.ts:289-302` |
| 20 | Aceptados, ejecutados y favoritos suben | `src/lib/suggest.ts:432-439`, `src/lib/suggest.ts:716-733`, `src/components/TerminalView.tsx:666-669`, `src/components/TerminalView.tsx:728-735` |
| 21 | Historial local, solo plantillas | `src/lib/suggest.ts:604-623`, `src/lib/suggest.ts:736-771` |
| 22 | "Borrar historial de sugerencias" y "Tecla para abrir la lista" en Ajustes › Terminal | `src/components/SettingsModal.tsx:386-402`, `src/components/SettingsModal.tsx:707-724`, `src/lib/suggest.ts:773-782` |
| 23 | No funciona en la terminal local | `src/lib/suggest.ts:786-787` |

## 08 · Notas, plantillas y envío a varias sesiones

| L | Afirmación | Fuente |
| --- | --- | --- |
| 1 | ⌘J abre Notas; autoguardado | `src/lib/platform.ts:77-78`, `src/components/NotesPanel.tsx:636-639` |
| 2 | ⌘Enter / Ctrl+Enter envía línea o selección; Todo (⌘⇧Enter) | `src/components/NotesPanel.tsx:606-628`, `README.md:80` |
| 3 | Variables `{{...}}`: diálogo "Completar plantilla" con vista previa | `src/App.tsx:670-675`, `src/components/TemplateDialog.tsx:64-115` |
| 4 | Se recuerdan salvo secretos, que se piden ocultos | `src/components/TemplateDialog.tsx:16-17`, `src/components/TemplateDialog.tsx:38`, `src/components/TemplateDialog.tsx:55-57`, `src/components/TemplateDialog.tsx:77`, `src/components/TemplateDialog.tsx:88` |
| 5 | Resumen antes de enviar varias líneas o un cambio | `src/App.tsx:692-711`, `src/lib/settings.ts:145` |
| 6 | Nota protegida, cifrada, bloqueo por inactividad (5 min por defecto), al cambiar de nota y al cerrar el panel | `src/components/NoteLock.tsx:5-6`, `src/components/NoteLock.tsx:100-111`, `src/components/NoteLock.tsx:125-141`, `src/components/NotesPanel.tsx:28-34`, `src/components/NotesPanel.tsx:140`, `src/components/NotesPanel.tsx:186-187`, `src/components/NotesPanel.tsx:207` |
| 7 | Destinos: Pestaña actual, Pestañas elegidas, Todas las de una carpeta, Paneles visibles | `src/components/BroadcastTarget.tsx:76-134` |
| 8 | Lista de equipos, omitidos y riesgo por línea | `src/components/BroadcastDialog.tsx:20-104`, `src/lib/broadcast.ts:124-127` |
| 9 | Confirmar escribiendo la cantidad de equipos | `src/components/BroadcastDialog.tsx:37-40`, `src/components/BroadcastDialog.tsx:126-133` |
| 10 | Secuencial y con "Detener" | `src/components/BroadcastDialog.tsx:174-191`, `README.md:42` |

## 09 · Logs, alertas, historial y búsqueda

| L | Afirmación | Fuente |
| --- | --- | --- |
| 1 | Botón Log / Grabando; texto plano; continúa al reconectar | `src/components/StatusBar.tsx:121-129`, `src-tauri/src/logfile.rs:178`, `README.md:50` |
| 2 | Grabación automática, hora por línea, nombre, rotación diaria | `src/components/SettingsModal.tsx:435-460`, `src/components/SettingsModal.tsx:543`, `src/lib/settings.ts:171-173` |
| 3 | Ocultar secretos activado por defecto | `src/lib/settings.ts:174`, `src/components/SettingsModal.tsx:457` |
| 4 | Reglas por texto o regex, todas o una carpeta; 3 ejemplos apagados | `src/lib/alerts.ts:12-41`, `src/components/AlertSettings.tsx:76-131`, `src/lib/settings.ts:176` |
| 5 | Aviso, marca en pestaña; nunca envían comandos; máx. 1 aviso cada 10 s por regla y sesión | `src/lib/alerts.ts:7-11`, `src/App.tsx:262-272`, `src-tauri/src/triggers.rs:15` |
| 6 | Historial de comandos enviados (Notas, catálogo, botones), no teclas | `src/components/HistoryMenu.tsx:56-66`, `src-tauri/src/history.rs:1-3`, `src-tauri/src/history.rs:18`, `src/App.tsx:689-690` |
| 7 | ⌘F busca en la salida | `src/lib/platform.ts:85-86`, `src/components/TerminalView.tsx:1070-1092` |

## 10 · Apariencia y Ajustes

| L | Afirmación | Fuente |
| --- | --- | --- |
| 1 | ⌘, y Ctrl+, (sin Shift) | `src/lib/platform.ts:53`, `src/components/StatusBar.tsx:70` |
| 2 | Interfaz Sistema, Claro, Oscuro | `src/components/SettingsModal.tsx:222-232`, `src/lib/settings.ts:122` |
| 3 | Automático + 17 temas | `src/components/SettingsModal.tsx:245-265`, `src/lib/theme.ts:46-198` (17 `name`), `src/lib/settings.ts:124` |
| 4 | Fuente, tamaño, interlineado, cursor | `src/components/SettingsModal.tsx:267-326` |
| 5 | Resaltado por fabricante | `src/components/HighlightSettings.tsx:107`, `src/lib/settings.ts:139-140` |
| 6 | Buscador de ajustes; Módulos ocultan herramientas sin perder configuración | `src/components/SettingsModal.tsx:57-68`, `src/components/SettingsModal.tsx:179`, `src/components/SettingsModal.tsx:332-346` |
| 7 | Cambios al instante | `src/components/SettingsModal.tsx:511`, `src/lib/settings.ts:228-238` |

## 11 · Cierre

| L | Afirmación | Fuente |
| --- | --- | --- |
| 2 | Atajos en el `title` de cada botón | p. ej. `src/components/Sidebar.tsx:392-396`, `src/components/StatusBar.tsx:62-70`, `src/components/TabBar.tsx:242` |
| 3 | Herramientas de red y automatización existen como módulos | `src/lib/settings.ts:10`, `README.md:54`, `README.md:60` |
