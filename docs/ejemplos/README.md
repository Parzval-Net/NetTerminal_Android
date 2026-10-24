# Ejemplos: scripts, plugins, packs y plantillas

Ejemplos de solo lectura usados en los videos tutoriales de scripts y plugins (video 2) y de automatización (video 3). Usan IPs de documentación (RFC 5737), nombres ficticios y no incluyen credenciales.

| Archivo | Qué es | Cómo usarlo |
| --- | --- | --- |
| `scripts/resumen_equipo.py` | Script con la API `import netterminal as nt`: versión, interfaces y ping | Cópialo a la carpeta `scripts/` de la app (barra de botones › Scripts › Abrir carpeta de scripts) y ejecútalo con una sesión conectada |
| `scripts/primer_script.py` | Primer script: datos de la sesión (`nt.session`) y `nt.run` | Igual que el anterior |
| `scripts/ping_destinos.py` | `clear`, `sendline`, `wait_for` y `read`, con manejo de `nt.ScriptTimeout` | Igual que el anterior |
| `scripts/inventario_csv.py` | Inventario de switches Cisco IOS / IOS-XE (`show version`, `show interfaces status`) a `<carpeta de datos>/reportes/inventario.csv`, una fila por equipo | Ejecútalo en cada pestaña: cada ejecución agrega o actualiza la fila de ese equipo |
| `plugins/diagnostico-basico/` | Plugin 1.1.0 con tres acciones: versión, interfaces y ping | Herramientas › Plugins › Desde carpeta, revisa permisos y código, e instala |
| `plugins/revision-puertos/` | Plugin 1.0.0 de dos archivos (`main.py` + `analisis.py`), permisos `session` y `files`: resumen de puertos, puertos con errores y exportación a CSV | Igual que el anterior |
| `packs/consultas-campus.json` | Pack de comandos (`netterminal-commands` v1) | Catálogo (⌘L) › Packs de comandos › Importar pack |
| `packs/turno-puertos.json` | Pack para revisar un puerto reportado (estado, log y PoE) | Igual que el anterior |
| `plantillas/revision-puerto.txt` | Plantilla de Notas con la variable `{{interfaz}}` | Cópiala a una nota (⌘J), selecciona las líneas y envíalas con ⌘↵ |

Validación (Node 22.6+ y Python 3; en Node anterior a 22.18 agrega `--experimental-strip-types`):

- `node scripts/video/plugins/probar-ejemplos.mjs`: `resumen_equipo.py`, `diagnostico-basico` y `consultas-campus.json`.
- `node scripts/video/v2/v3-automatizacion/probar-ejemplos.mjs`: los scripts del video 3, cada acción de `revision-puertos`, `turno-puertos.json` y la plantilla, contra un campus simulado de cinco equipos (incluidos un router sin `show interfaces status` y un equipo que no responde). Revisa también el CSV que se escribe.

Ambas pruebas ejecutan los archivos reales con Python y el `netterminal.py` de la app, con el mismo protocolo que `scripts.rs`, y clasifican cada comando enviado con el motor de riesgo de la app. La revisión de instalación de los plugins la cubre el test de Rust `plugins::tests::example_plugins_pass_review`.

Para actualizar un plugin, sube `version` en `plugin.json` e instálalo de nuevo desde la carpeta: la revisión avisa que reemplaza la versión instalada. Si editas los archivos directamente en la carpeta de plugins de la app, queda bloqueado hasta que revises y apruebes el cambio.
