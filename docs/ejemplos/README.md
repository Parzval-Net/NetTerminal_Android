# Ejemplos: script, plugin y pack de comandos

Ejemplos de solo lectura (`show version`, `show interfaces`, `ping 192.0.2.1`) usados en el video tutorial de scripts y plugins. Usan IPs de documentación (RFC 5737) y no incluyen credenciales.

| Archivo | Qué es | Cómo usarlo |
| --- | --- | --- |
| `scripts/resumen_equipo.py` | Script de Python con la API `import netterminal as nt` | Cópialo a la carpeta `scripts/` de la app (barra de botones › Scripts › Abrir carpeta de scripts) y ejecútalo con una sesión conectada |
| `plugins/diagnostico-basico/` | Plugin 1.1.0 con tres acciones: versión, interfaces y ping | Herramientas › Plugins › Desde carpeta, revisa permisos y código, e instala |
| `packs/consultas-campus.json` | Pack de comandos (`netterminal-commands` v1) | Catálogo (⌘L) › Packs de comandos › Importar pack |

Validación: `node scripts/video/plugins/probar-ejemplos.mjs` ejecuta el script y cada acción del plugin con Python contra un equipo simulado, y pasa el pack por el mismo validador y motor de riesgo de la app. La revisión de instalación del plugin la cubre el test de Rust `plugins::tests::example_plugins_pass_review`.

Para actualizar el plugin, sube `version` en `plugin.json` e instálalo de nuevo desde la carpeta: la revisión avisa que reemplaza la versión instalada. Si editas los archivos directamente en la carpeta de plugins de la app, queda bloqueado hasta que revises y apruebes el cambio.
