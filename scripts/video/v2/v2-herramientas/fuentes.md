# Fuentes del guion (archivo:línea)

Rutas relativas a la raíz del repositorio, verificadas sobre `c0f706d` (v0.9.5). Formato: bloque del guion → respaldo en el código.

## 01 Herramientas y módulos
- ⌘E / Ctrl+Shift+E: `src/lib/platform.ts:7-11` (modificador), `src/lib/platform.ts:81` (`"e"` → tools); botón con título en `src/components/TabBar.tsx:264`.
- Lista de módulos: `src/components/tools/ToolsView.tsx:22-33`. Siguen vivos al cambiar de sección: `ToolsView.tsx:53-56`, `:175-181`. Punto verde "Servidor activo": `ToolsView.tsx:163-167`.
- Ajustes › Módulos y "Desactivar un módulo no borra su configuración": `src/components/SettingsModal.tsx:38-49`, `:332-344` (texto en `:335`). Visibles por defecto: `src/lib/settings.ts:156`.

## 02 Topología: vecinos
- Comandos de vecinos Cisco: `src/lib/topology.ts:89-95`; estado de puertos: `topology.ts:130-135`; alternativas NX-OS: `topology.ts:98-105`.
- "Descubrir con" Consola/SNMP: `src/components/tools/TopologyTool.tsx:787-792`; "Equipo (sesión conectada)" y "Fabricante": `:795-814`; fabricante desde la sesión: `:354-358`.
- "Estado de puertos" (marcado por defecto): `TopologyTool.tsx:299`, `:829-835`; "Descubrir vecinos": `:836-839`.
- Port-channel en enlaces paralelos: `TopologyTool.tsx:977-1029` (`grp ×n`), `src/lib/topology.ts:903`.
- Conectar y seguir la ruta, sesión guardada por IP o nombre, datos que se copian: `TopologyTool.tsx:626-660`, botón `:1471-1479`.
- Selector de equipo: solo cambia solo si la sesión elegida ya no existe: `TopologyTool.tsx:351-353` (por eso el guion pide elegir el equipo nuevo a mano).
- Desde aquí / Hasta aquí / Ruta / Copiar ruta: `TopologyTool.tsx:1444-1451`, `:1492-1524`; texto de ruta `src/lib/topology.ts:947-958`.
- Snapshot, Comparar con, verde y rojo punteado: `TopologyTool.tsx:662-668`, `:1626-1731`, `:955-979`; máximo 20: `:122`.
- "Abrir" reemplaza el diagrama: `TopologyTool.tsx:1675-1685`. Basurero sin confirmación: `:911-923`.
- Exportar (Imagen SVG, draw.io (editable), CSV de enlaces y puertos, Copiar como Mermaid al portapapeles): `TopologyTool.tsx:865-890`.

## 03 Topología sin CDP ni LLDP
- Tres fuentes, etiquetas y textos: `src/lib/topology.ts:1410-1432`; apagadas por defecto: `topology.ts:1434`, `src/lib/settings.ts:170`; apagada no envía comandos: `TopologyTool.tsx:395-429`.
- Comandos de ruteo: `topology.ts:111-116`; direcciones propias: `:122-127`.
- Equipo "visto por ruteo" con borde punteado: `TopologyTool.tsx:714-715`, `:1044-1069`; leyenda "Sesión BGP lógica": `topology.ts:974-981`, tooltip "Sesión lógica: no es un enlace físico" `TopologyTool.tsx:972`; fusión al explorar: README "Vecinos de ruteo" (`README.md` sección Topología) y `topology.ts:760` (`mergeNeighbors`).
- Descripciones (ejemplo "UPLINK a dist-sw01 Gi1/0/48", requiere Estado de puertos): `topology.ts:1420-1424`, `:1481-1498`, `:1504-1538`; aviso sin descripciones `TopologyTool.tsx:586-590`.
- MAC/OUI: comandos `topology.ts:1565-1570`; HSRP/VRRP `:1628-1636`; umbral 4 MAC `:1603`; clasificación alta/media/baja `:1793-1804`.
- Sugerencias nunca se dibujan solas; Confirmar / Descartar; botón Sugerencias con contador: `topology.ts:1439-1440`, `TopologyTool.tsx:902-910`, `:1283-1337`.
- Límites del OUI (tarjeta de red, teléfono IP, MAC aleatoria, tabla que envejece): `README.md` sección "Límites de MAC/OUI"; MAC local: `topology.ts:1619`.
- Manual (+ Equipo, + Enlace, campos): `TopologyTool.tsx:1527-1623`; "Se guardan con el diagrama, entran en snapshots, rutas y exportaciones": `:1622`. Leyenda de estilos: `topology.ts:963-981`, `TopologyTool.tsx:1111-1178`.

## 04 Topología por SNMP y tráfico
- Modo SNMP, perfil v2c o v3 (v1 excluido), secretos guardados: `TopologyTool.tsx:325-328`, `:460-466`, `:817-827`.
- "Descubrir por SNMP", GETBULK solo lectura, fuentes activas: `TopologyTool.tsx:460-503`, `:840-844`; plan `src/lib/topoSnmp.ts:144`; OSPF-MIB y BGP4-MIB (no hay EIGRP por SNMP): `topoSnmp.ts:90-100`, `src-tauri/src/snmp.rs:1969` (`TOPO_WALK_ROOTS`).
- LLDP y CDP vacíos: `TopologyTool.tsx:494-496`. Topes 10.000 filas, 20 s por tabla: `snmp.rs:2059`, `topoSnmp.ts:541-553`.
- Botón Tráfico y sección "Tráfico en enlaces": `TopologyTool.tsx:893-901`, `:1205-1281`; apagado al abrir: `:330-332`.
- Intervalos 15/30/60, 30 por defecto: `useTopoTraffic.ts:22-23`, `TopologyTool.tsx:163`. Solo equipos explorados y con enlace: `useTopoTraffic.ts:176-180`. Solo visible y ventana no oculta: `useTopoTraffic.ts:113`, `:172-173`, `:221-223`.
- Perfil por IP o nombre con secretos: `useTopoTraffic.ts:55-58`. "También por consola", comandos y riesgo `read`: `TopologyTool.tsx:1233-1239`, `src/lib/topoTraffic.ts:145-151`, `useTopoTraffic.ts:150-170`.
- Tasa desde la segunda lectura, contador reiniciado o tasa imposible descartada: `topoTraffic.ts:37-71`, `TopologyTool.tsx:1274-1276`.
- Opciones por defecto (color, flechas, velocidad activas; animación apagada): `TopologyTool.tsx:158-168`; Animación activa también las flechas: `:1253`.
- Umbrales 70 % y 90 %, sentido más cargado: `topology.ts:1126-1139`, `topoTraffic.ts:84-87`; grosor por carga: `TopologyTool.tsx:987`; azul = velocidad desconocida (`--accent`): `TopologyTool.tsx:192`, `:1151-1156`, `src/App.css:14`.
- Etiqueta "↑ … ↓ …" y ↑ de A hacia B; tooltip con nombres: `topology.ts:1154-1158`, `TopologyTool.tsx:966-970`, `:1163`.

## 05 Transferencias: conceptos
- Una carpeta para TFTP, HTTP y FTP (`data/tftp`): `src-tauri/src/lib.rs:562-565`, `src-tauri/src/ftpserver.rs:540`.
- "Archivos compartidos" con IPs de este PC: `src/components/tools/TransferTool.tsx:169-200`.
- Firewall y redes privadas; servidores escuchan solo mientras están activos: `TransferTool.tsx:113-116`.
- TFTP sin autenticación (servidor abierto a la red): `src/components/tools/FileManager.tsx:195-196`. TFTP en paso fijo (un bloque, espera ACK): RFC 1350, sección 2 (externo); implementación `src-tauri/src/servers.rs:566-590`.
- HTTP solo lectura, más rápido para imágenes grandes: `TransferTool.tsx:145`; solo GET/HEAD: `servers.rs:594-599`.
- FTP en claro: `src/components/tools/FtpPanels.tsx:73-75`.
- SCP/SFTP sobre OpenSSH: `src-tauri/src/connection.rs:866-950`.

## 06 Servidores TFTP y HTTP
- Puertos por defecto 69 y 8080: `src/lib/settings.ts:158-159`. Estado "Activo · UDP 69": `TransferTool.tsx:120`.
- Comandos copiables (copy tftp, tftp get, copy http) con primer archivo y primera IP: `TransferTool.tsx:92-93`, `:132-136`, `:154-158`. IPs ordenadas por nombre de interfaz: `src-tauri/src/nettools.rs:280-289`.
- "Permitir subidas" (persistente, aplica al iniciar): `TransferTool.tsx:65-79`, `:126`; rechazo de escritura: `servers.rs:434-436`; `allow_write` fijado al iniciar: `servers.rs:98-121`.
- Aviso de Linux 69 → 1069: `TransferTool.tsx:138-142`; error de privilegios: `servers.rs:287-289`.
- Lista "Transferencias" con avance: `TransferTool.tsx:202-232`. "Agregar": `TransferTool.tsx:81-90`, `lib.rs:598-607`.

## 07 FTP
- Puerto 21: `settings.ts:180`. Usuario fijo `nt` y contraseña aleatoria de 10 caracteres por inicio: `ftpserver.rs:56-63`, `:75`. Comandos con credenciales: `FtpPanels.tsx:55`, `:83-88`.
- Solo lectura; "Permitir subidas" solo por esta sesión de la app: `FtpPanels.tsx:34-35`, `:66-68`.
- Advertencia de FTP en claro y Linux 21 → 2121: `FtpPanels.tsx:73-75`, `:89`.
- Cliente: campos, contraseña no se guarda, Listar, traer: `FtpPanels.tsx:160-252`. FTPS explícito activo por defecto, certificados del sistema sin excepciones: `FtpPanels.tsx:107`, `:179-189`; `src-tauri/src/ftpclient.rs:1-8`, `:103-107`.

## 08 SFTP y SCP
- Usuario, puerto, llave, jump host y algoritmos legacy de la sesión: `connection.rs:866-949` (scp) y `:951-985` (sftp).
- SFTP interactivo, Abrir SFTP, known_hosts, comandos: `FtpPanels.tsx:256-287`; directorio local = carpeta compartida: `connection.rs:954-959`.
- SCP/SFTP desde el gestor abren pestaña con contraseña: `FileManager.tsx:300-310`, `src/App.tsx:939-954`.
- `ip scp server enable` y `feature sftp-server`: `FileManager.tsx:437-451`. SCP clásico (`-O`) con OpenSSH 9+: `connection.rs:899-905`; SFTP exige OpenSSH 8.7+: `connection.rs:907-913`.
- Botón MD5 (archivo seleccionado en el equipo que también existe en el PC): `FileManager.tsx:534-541`; comandos MD5: `src/lib/devicefs.ts:64`, `:82`, `:105`; hash local: `lib.rs:609-630`.

## 09 Gestor de archivos
- Dos paneles, sesión obligatoria: `FileManager.tsx:463-602`, `:299`.
- Perfil sugerido (nunca propone NX-OS): `devicefs.ts:141-145`; VRF en NX-OS: `devicefs.ts:74-84`, `FileManager.tsx:453-460`.
- IP según la ruta al equipo: `FileManager.tsx:113-116`, `lib.rs:648-649`.
- Leer archivos y espacio libre: `FileManager.tsx:178-188`, `:575-581`; `devicefs.ts:119-138`.
- Enviar, arrastrar, confirmaciones automáticas, aviso de espacio y sobrescritura: `FileManager.tsx:298-356`, `:524-526`; `src-tauri/src/filexfer.rs:1-3`, `:38-49`.
- Servidor iniciado según la operación y subidas TFTP temporales; el servidor queda activo: `FileManager.tsx:190-232`.
- Verificar MD5 después de enviar (activo por defecto) y rojo si no coincide: `FileManager.tsx:88`, `:144-158`, `:293-296`, `:431-436`.
- Respaldar config (copy running-config al PC): `devicefs.ts:63`, `:70`, `FileManager.tsx:542-549`.
- Respaldos del módulo en `data/backups`: `src-tauri/src/backups.rs:1`.

## 10 Cliente SNMP
- Solo lectura, sin SET: `SnmpTool.tsx:160-163`; README fila "SNMP".
- Valores por defecto del perfil (v3, authPriv, SHA-256, AES-128, puerto 161, 2000 ms): `src/lib/snmp.ts:26-40`. MD5/DES ocultos: `snmp.ts:54-70`, `SnmpTool.tsx:154-155`, `:279`.
- Advertencia v2c: `snmp.ts:73-79`.
- Bóveda y secretos atados a host y puerto: `SnmpTool.tsx:113-129`, `:280`; `src-tauri/src/snmp.rs:1747-1760`.
- GET, GETNEXT, WALK, GETBULK; WALK con GETBULK, Máx. filas y Detener: `SnmpTool.tsx:38-44`, `:349-372`, `:381-431`.
- Conjuntos de OIDs, Interfaces con 64 bits, Medir tasas (10 s): `snmp.ts:222-296`, `SnmpTool.tsx:48`, `:541-567`, `:609-613`.
- Receptor de traps apagado, 127.0.0.1 por defecto, puerto 162, aviso de Linux 1162: `SnmpTool.tsx:711-770`; `settings.ts:178-179`; `snmp.rs:1862-1878`.
- Generador: plataformas `src/lib/snmpconfig.ts:48-55`; NMS obligatorio `snmpconfig.ts:185-187`; marcadores `snmpconfig.ts:104`, `SnmpConfigGen.tsx:156-160`; comentarios "Verifica" `snmpconfig.ts:285`, `:312`, `:331`, `:380`, `:417`.

## 11 Monitoreo, diagnóstico, velocidad, subredes y Syslog
- Nueva sonda, ICMP/TCP, 1 s, 3 fallas, alarma al caer y al recuperarse: `MonitorTool.tsx:24-35`, `:66-86`, `:219-276`.
- Ping continuo, Traceroute, Puertos TCP: `DiagTool.tsx:84`, `:115`, `:133-150`.
- Speedtest Cloudflare ~95 MB; iperf3 instalado: `PerfTool.tsx:63-64`, `:188-205`, `:211-297`.
- Subredes IPv4/IPv6 y división solo IPv4: `SubnetTool.tsx:39`, `:64-75`.
- Syslog UDP 514, logging host, filtro, severidad, archivo diario: `settings.ts:160`, `SyslogTool.tsx:72-110`.

## 12 Respaldos y comparación
- Comandos de consulta por perfil: `src/lib/backup.ts:15-22`; hasta 3 a la vez: `BackupTool.tsx:27`, `:167`.
- Enmascarar secretos activo: `BackupTool.tsx:42`, `:202`, `:265`; enmascarado en disco: `backups.rs:99-211`.
- A y B, Comparar, agregadas/quitadas/iguales, pliegues, copiar y exportar: `BackupTool.tsx:272-345`, `DiffView.tsx:31-58`.

## 13 Cierre
- Resumen de lo anterior; sin afirmaciones nuevas.

## Fuentes externas
- RFC 1350, The TFTP Protocol (Revision 2), sección 2: cada paquete de datos espera su ACK antes del siguiente. https://www.rfc-editor.org/rfc/rfc1350
- RFC 5798 (VRRP, MAC virtual) y Cisco "Configuring HSRP" (MAC virtual), citadas en `src/lib/topology.ts:1621-1627`.
- Velocidad de narración de los videos anteriores: `docs/index.html` (duraciones 13:32 y 9:25) y conteo de palabras de `scripts/video/guion/*.txt` y `scripts/video/plugins/guion/*.txt`.
