# Changelog

Todos los cambios notables de dtunnel se documentan en este archivo.

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versionado según [Semantic Versioning](https://semver.org/lang/es/). Política: [docs/versioning.md](docs/versioning.md).

## [2.6.1] - 2026-07-31

### Corregido

- **Consola admin en vivo** — plantilla Hestia `/api/` ahora reenvía `Upgrade`/`Connection` para WebSockets (`/admin/ws/console`, `/admin/ws/metrics`, trazas usuario).

### Añadido

- `scripts/smoke-test.mjs` — comprobaciones post-deploy (`npm run test:smoke` en `api/`).

## [2.6.0] - 2026-07-31

Versión **menor (Y)**: eliminación completa de frp/frpc.

### Eliminado

- Modo legacy `frpc` / `frps`, flags `--frp`, `--legacy`, comando `install-frpc`.
- Variables `FRPS_*`, `TUNNEL_TRANSPORT` y broker Docker `dtunnel_frps`.
- Módulo `client/bin/frpc-install.js`, `server/install.sh`, `server/docker-compose.yml`.

### Cambiado

- API y CLI usan únicamente túnel nativo (WebSocket + gateway HTTP en la API).
- Deploy simplificado: solo API Docker + plantillas Hestia → `:18080`.
- **Dashboard usuario** (`/dashboard.html`) — consola tipo admin: sidebar, paneles, tráfico en vivo, planes integrados.
- Páginas de auth (login, registro, verificación, recuperación) con el mismo diseño workspace.

## [2.5.0] - 2026-07-31

Versión **menor (Y)**: centro de seguridad admin, listas IP, detección de amenazas y workspace IDE.

### Añadido

- **Auditoría de seguridad** en admin: túneles + estado de lista negra, dispositivos, amenazas.
- Tablas `ip_blacklist`, `ip_whitelist`, `abuse_events`, `device_fingerprints`.
- Escáner de tráfico en túneles (SQLi, path traversal, sondeo panel, XSS).
- Auto-bloqueo de IP tras eventos críticos o 3+ incidentes/hora.
- API `/admin/security/*` — listas, eventos, dispositivos, bloqueo IP.
- Metadatos en apertura de túnel: IP (todos), User-Agent, versión CLI, huella de dispositivo.
- **Workspace dtunnel** — IDE web (Monaco) con plantilla Node + terminal simulada.
- Tutoriales interactivos paso a paso en panel Seguridad.

## [2.4.0] - 2026-07-31

Versión **menor (Y)**: consola admin unificada en tiempo real.

### Añadido

- **Consola en vivo** en dtunnel-admin: métricas, gráfico de túneles, feed unificado de trazas HTTP y auditoría.
- WebSocket `/api/admin/ws/console` — eventos `init`, `metrics`, `trace`, `audit`.
- Filtros (todo / HTTP / auditoría), pausar scroll y limpiar feed.

## [2.3.0] - 2026-07-31

Versión **menor (Y)**: planes públicos/privados y suscripciones.

### Añadido

- Planes **públicos** (`visibility=public`) en landing y **privados** (`private`) con tabla `plan_grants`.
- API: `GET /billing/plans`, `/billing/subscription`, `/billing/subscriptions`.
- Admin: panel **Suscripciones**, conceder/revocar acceso a planes privados por usuario.
- Página `/billing.html` — elegir plan, ver suscripción activa e historial.
- Plan seed **partner** (privado). Activación gratuita de plan `free` vía checkout.

## [2.2.0] - 2026-07-31

Versión **menor (Y)**: nuevas funciones; compatible con 2.1.x.

### Añadido

- **Trazas HTTP** — registro de solicitudes por túnel; historial y WebSocket en tiempo real (`/api/request-logs`, dashboard usuario, panel admin «Trazas HTTP»).
- **CLI** `dtunnel logs` y `dtunnel logs --follow [-s subdominio]`.
- Consola admin tipo cloud: analítica, sistema, organizaciones, cupones, roles RBAC con CRUD.
- Billing y organizaciones (API Wompi-ready), planes empresariales unificados.
- **2FA TOTP** para cuentas admin; impersonación de usuarios con auditoría.
- WebSocket de métricas en vivo en el panel admin (`/admin/ws/metrics`).
- Asignación de roles RBAC al editar usuarios en admin.

### Corregido

- Sidebar del admin sin scroll (ítems inferiores inaccesibles).
- Botón flotante de tema no respondía al clic.
- Roles y cupones en admin: formularios modales CRUD (antes solo lectura o `prompt`).

## [2.1.0] - 2026-07-30

### Añadido

- Verificación de email en registro (`POST /auth/verify-email`, `verify-email.html`).
- Reenvío de activación (`POST /auth/resend-verification`, `verify-pending.html`).
- Admin: botones reenviar activación y recuperar contraseña por usuario.
- Página 503 para subdominios inactivos (reservado / offline / disponible).
- Vista admin de túneles anónimos agrupados por IP.
- Logs de auditoría en panel admin.

### Cambiado

- Login y rutas autenticadas requieren email verificado (admins exentos).
- API version `2.1.0`; transporte nativo en producción.

## [2.0.2] - 2026-07-30

### Añadido (CLI)

- `--host` / `-H` y `DTUNNEL_LOCAL_HOST` para tunelar a hostnames Docker.
- `dtunnel config` y `config set localHost`.

## [2.0.1] - 2026-07-30

### Corregido (CLI)

- Sin crash de Node al fallar comandos en Windows.
- Reemplazo automático de túnel huérfano propio al reabrir subdominio reservado.

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

[2.0.0]: https://github.com/desarrollado-com/dtunnel/compare/v1.0.9...v2.0.0
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
