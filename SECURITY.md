# Política de seguridad

## Versiones soportadas

Solo la última versión publicada en [Releases](https://github.com/Parzval-Net/Net_Terminal/releases/latest) recibe correcciones de seguridad. Si usas una versión anterior, actualiza antes de reportar.

| Versión | Soporte |
| --- | --- |
| Última versión (`latest`) | Sí |
| Versiones anteriores | No |

## Cómo reportar una vulnerabilidad

No abras un issue público ni un PR con el detalle de la vulnerabilidad.

1. Entra a la pestaña **Security** del repositorio y usa **Report a vulnerability** ([enlace directo](https://github.com/Parzval-Net/Net_Terminal/security/advisories/new)). El reporte queda privado entre tú y el mantenedor.
2. Incluye la versión afectada, el sistema operativo, los pasos para reproducir y el impacto que observas. Si tienes una prueba de concepto, adjúntala en el reporte privado.
3. No incluyas contraseñas, IPs ni configuraciones reales de tus equipos de red.

Plazos de referencia: confirmación de recepción en 5 días hábiles y una evaluación inicial en 10 días hábiles. Una vez publicada la corrección se crea un GitHub Security Advisory y, si corresponde, se solicita un CVE.

## Modelo de confianza del actualizador

- La app solo instala actualizaciones firmadas con la clave del proyecto. La clave pública va dentro de la app (`src-tauri/tauri.conf.json`) y la firma se verifica antes de instalar; una descarga alterada se rechaza.
- El índice `latest.json` y los paquetes se descargan desde el Release más reciente de este repositorio. Quien controle la clave privada de firma puede publicar una actualización que las apps instaladas aceptarán, por eso esa clave vive solo en los secretos de GitHub Actions (environment `release`, con aprobación manual del mantenedor) y nunca en el repositorio.
- Los Releases se generan solo desde tags `v*` que apuntan a commits de `main` y cuya versión coincide con `tauri.conf.json`. Las acciones del workflow están fijadas a SHA y el token del workflow es de solo lectura salvo en el paso que crea el Release.
- Las instalaciones en modo portable y por `.deb` no se actualizan solas.

Si sospechas que la clave de firma o un Release fueron comprometidos, repórtalo de inmediato por el canal privado indicado arriba.
