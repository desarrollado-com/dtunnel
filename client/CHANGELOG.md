# Changelog — @desarrollado/dtunnel

Historial del paquete npm. Changelog completo del proyecto: [../CHANGELOG.md](../CHANGELOG.md). Política SemVer: [../docs/versioning.md](../docs/versioning.md).

## [2.3.0] - 2026-07-31

### Eliminado

- Modo legacy `frpc`: `--frp`, `--legacy`, `install-frpc`, `frpc-install.js`.

### Cambiado

- Solo túnel nativo Node.js + WebSocket.

## [2.2.0] - 2026-07-31

Versión **menor (Y)**: nueva función compatible con 2.1.x.

### Añadido

- `dtunnel logs` — últimas trazas HTTP de tus túneles.
- `dtunnel logs --follow` / `-f` — seguimiento en tiempo real vía WebSocket.
- Filtro por subdominio: `dtunnel logs -s mi-api`.

## [2.1.0] - 2026-07-31

### Mejorado (rendimiento)

- Protocolo **binario** para cuerpos HTTP/WS ≥ 512 bytes (sin JSON+base64).
- Compresión **perMessageDeflate** en el WebSocket del túnel.
- Hasta **32** peticiones HTTP concurrentes (antes 16).
- HTTP keep-alive hacia el navegador (sin `Connection: close` en cada respuesta).

## [2.0.9] - 2026-07-31

### Añadido

- **WebSocket de aplicación** (HMR Next.js/Vite, NestJS `@WebSocketGateway`) a través del túnel HTTPS.
- Nginx: cabeceras `Upgrade` / `Connection` en subdominios wildcard.

## [2.0.8] - 2026-07-31

### Corregido

- Página en blanco en navegador: `fetch` descomprimía gzip pero reenviaba `Content-Encoding: gzip` (se elimina `Accept-Encoding` hacia localhost y se normalizan cabeceras de respuesta).

## [2.0.7] - 2026-07-31

### Corregido

- Concurrencia en túnel nativo: hasta 16 peticiones HTTP en paralelo (antes el handler async podía bloquear la carga del navegador).
- Gateway: `Content-Length` explícito y `Connection: close` para evitar páginas en blanco con keep-alive.

## [2.0.6] - 2026-07-31

### Mejorado

- Aviso si el puerto local no responde antes de abrir el túnel (evita 502 por puerto incorrecto, p. ej. Next en 3099).
- Heartbeat en Windows: `windowsHide` y cierre más seguro del proceso (menos crashes al salir).

## [2.0.5] - 2026-07-30

### Corregido

- Next.js en `next dev` devolvía 403 en `/_next/static/*` vía túnel: se eliminan `Origin`/`Referer` al reenviar a localhost (gateway + CLI).

## [2.0.4] - 2026-07-30

### Mejorado

- Reenvío de cabeceras `X-Forwarded-*` al backend local (mejor compatibilidad con Next.js y proxies).

## [2.0.3] - 2026-07-30

### Añadido

- Mensajes claros en `login` / `register` cuando falta verificación de email.
- `apiFetch` expone `err.code` para `EMAIL_NOT_VERIFIED`.

### Cambiado

- `register` no guarda token hasta que el email esté verificado.

## [2.0.2] - 2026-07-30

### Añadido

- `--host` / `-H` y `DTUNNEL_LOCAL_HOST` para tunelar a un hostname distinto de `127.0.0.1` (p. ej. servicio Docker `mi-proyecto`).
- `localHost` persistente en `~/.dtunnel/config.json` (`dtunnel config set localHost mi-proyecto`).
- Comando `dtunnel config` para ver y ajustar la configuración local.

## [2.0.1] - 2026-07-30

### Corregido

- Crash de Node.js al fallar un comando (sin `Assertion failed` en Windows).
- Si tu subdominio reservado quedó huérfano en el servidor, la API lo reemplaza automáticamente.
- Mensajes más claros para «Subdominio en uso», «no reservado» y «Inicia sesión».

## [2.0.0] - 2026-07-30

### Añadido

- **Túnel nativo v2** — solo Node.js + WebSocket; sin descargar `frpc` (evita falsos positivos de antivirus).
- `client/bin/native-client.js` — cliente del protocolo nativo.

### Cambiado

- Modo nativo por defecto; `--frp` / `--legacy` para el modo anterior con `frpc`.
- Requiere Node.js **>= 18**.

## [1.0.6] - 2026-07-30

### Añadido

- Proceso `tunnel-heartbeat.js` — mantiene el túnel vivo en la API cada 2 min.

### Cambiado

- Reclamo anónimo solo afecta túneles de la misma IP.

## [1.0.5] - 2026-07-30

### Corregido

- Reclama automáticamente el slot anónimo huérfano en el servidor (sin `tunnel.json` local).
- `dtunnel down` sin estado local libera túneles anónimos en la API.
- Extracción de `frpc` en Windows (búsqueda recursiva en el zip).

## [1.0.4] - 2026-07-30

### Corregido

- `dtunnel down` libera el túnel en la API (evita límite fantasma).
- Auto-liberación de túneles locales huérfanos al abrir uno nuevo.

## [1.0.3] - 2026-07-29

### Añadido

- Auto-instalación de `frpc` en `~/.dtunnel/bin/` al primer túnel.
- Comando `dtunnel install-frpc`.
- Soporte Windows (descarga `.zip` de frp releases).

### Cambiado

- Ya no es necesario instalar `frpc` manualmente antes de usar el CLI.

## [1.0.2] - 2026-07-21

### Añadido

- `dtunnel version`, `dtunnel status`, `dtunnel --list up`.

## [1.0.1] - 2026-07-21

### Añadido

- Publicación inicial en npm.
