# Changelog

Todos los cambios notables de dtunnel se documentan en este archivo.

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versionado según [Semantic Versioning](https://semver.org/lang/es/).

## [2.0.0] - 2026-07-30

### Añadido

- **Túnel nativo v2** — sin binario `frpc` (solo Node.js + WebSocket). Evita falsos positivos de antivirus.
- Gateway HTTP en la API (`:18080`) y WebSocket en `/tunnel/ws`.
- CLI `dtunnel` usa modo nativo por defecto; `--frp` / `--legacy` para el modo anterior.
- Documentación: `docs/tunnel-v2-native.md`.

### Cambiado

- API v2.0.0; `TUNNEL_TRANSPORT=native` por defecto.
- Deploy detiene `frps` antes de levantar la API (comparten puerto 18080).
- Plantillas Hestia: proxy WebSocket `/tunnel/` → API `:3001`.

### Deprecado

- `frpc` / `frps` siguen disponibles con `TUNNEL_TRANSPORT=frp` o `both` y `dtunnel --frp`.

## [1.0.9] - 2026-07-30

### Añadido

- `POST /api/auth/change-password` — cambiar contraseña desde el dashboard.
- Admin: suspender usuario y cerrar todos sus túneles (`POST /api/admin/users/:id/suspend`, `close-tunnels`).
- `deploy/tunnels.py purge-stale` y `deploy/install-cron.py` (purga horaria en VPS).

## [1.0.8] - 2026-07-30

### Añadido

- Botón **Cerrar** en túneles activos del dashboard (`DELETE /api/tunnels/:subdomain`).
- `deploy.py` y `deploy.sh` suben `admin-web/` en despliegue completo.
- Guía de monitorización: `docs/monitoring.md` (UptimeRobot, cron de purga).

### Cambiado

- `AGENTS.md` actualizado (admin-web, scripts de deploy).

## [1.0.7] - 2026-07-30

### Añadido

- Recuperación de contraseña por email (`/forgot-password.html`, `POST /api/auth/forgot-password`).
- Panel de administración en subdominio dedicado: `https://dtunnel-admin.desarrollado.com`.
- Dashboard de usuario: túneles activos y liberar subdominios reservados.
- `DELETE /api/subdomains/:name` para liberar nombres reservados.

### Cambiado

- `/admin.html` en el sitio principal redirige al panel admin separado.
- CORS de la API incluye el origen del panel admin.
- Deploy: `upload-admin.py` y variables SMTP/CORS en `.env` de la API.

## [1.0.6] - 2026-07-30

### Añadido

- Heartbeat de túneles (`POST /api/tunnels/:subdomain/heartbeat`) con limpieza automática.
- Rate limiting en registro, login y creación de túneles.
- Límite de túneles anónimos **por IP** (cada visitante su propio slot).
- `GET /api/status` para monitorización pública.
- Páginas legales: términos, privacidad, uso aceptable.
- Página `/status.html` de estado del servicio.

### Cambiado

- `DELETE /api/tunnels/anonymous` solo libera túneles de la IP del cliente.
- Limpieza de huérfanos basada en heartbeat (10 min) o antigüedad (24 h).

## [1.0.5] - 2026-07-30

### Añadido

- `DELETE /api/tunnels/anonymous` — libera túneles anónimos huérfanos en el servidor.

### Corregido

- La API reclama automáticamente el slot anónimo al crear un túnel sin sesión.
- CLI npm/bash reintenta tras liberar el slot anónimo si no hay `tunnel.json` local.
- Extracción de `frpc` en Windows (zip con estructura anidada).

### Web

- Documentación y dashboard: aclaración de subdominios, reservas y túneles activos.

## [1.0.4] - 2026-07-30

### Añadido

- `DELETE /api/tunnels/:subdomain` — libera el túnel en el servidor al hacer `dtunnel down`.
- Limpieza automática de túneles huérfanos en la API (más de 2 h sin actividad).
- `dtunnel --list up` muestra túneles huérfanos locales pendientes de liberar.

### Corregido

- `dtunnel down` ya no deja registros fantasma en la API (causaban "Límite de túneles alcanzado").
- `dtunnel --port` libera automáticamente un túnel local muerto antes de crear uno nuevo.

## [1.0.3] - 2026-07-29

### Añadido

- Descarga automática de `frpc` a `~/.dtunnel/bin/` al abrir el primer túnel (CLI npm y bash).
- Comando `dtunnel install-frpc` para instalar o actualizar `frpc` manualmente.
- Módulo `client/bin/frpc-install.js` (detección de plataforma, Linux/macOS/Windows).
- Página web [`/changelog.html`](https://dtunnel.desarrollado.com/changelog.html) y este archivo de changelog.

### Cambiado

- Documentación actualizada: npm ya no requiere instalar `frpc` por separado.
- Panel admin: botones migrados a componentes Material Design 3.

### Web (desplegado en el mismo ciclo)

- Frontend migrado a [Material Design 3](https://m3.material.io/) (tokens, Roboto, Material Symbols, Material Web).

## [1.0.2] - 2026-07-21

### Añadido

- Comando `dtunnel version`.
- Comandos `dtunnel status` y `dtunnel --list up` (estado local + túneles de cuenta).
- Documentación de actualización del CLI en la web.

### Cambiado

- Paquete npm `@desarrollado/dtunnel` publicado como acceso público.

## [1.0.1] - 2026-07-21

### Añadido

- Primera publicación en npm: `@desarrollado/dtunnel`.
- Instalador curl universal (`install.desarrollado.com`).
- Panel superadmin (`dtunnel-admin.desarrollado.com`): usuarios, planes, túneles activos, ajustes globales.
- API `/api/admin/*` con límites por plan y overrides por usuario.

## [1.0.0] - 2026-07-21

### Añadido

- Servicio self-hosted bajo `*.dtunnel.desarrollado.com`.
- Broker `frps` + API Node/SQLite en VPS.
- CLI: `dtunnel --port`, `login`, `register`, `reserve`, `down`.
- Landing y documentación en `web/`.

[1.0.9]: https://github.com/desarrollado-com/dtunnel/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/desarrollado-com/dtunnel/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/desarrollado-com/dtunnel/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/desarrollado-com/dtunnel/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/desarrollado-com/dtunnel/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/desarrollado-com/dtunnel/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/desarrollado-com/dtunnel/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/desarrollado-com/dtunnel/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/desarrollado-com/dtunnel/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/desarrollado-com/dtunnel/releases/tag/v1.0.0
