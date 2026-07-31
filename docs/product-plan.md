# Plan de producto dtunnel

Servicio self-hosted tipo [Tunnelmole](https://github.com/robbie-cahill/tunnelmole-client): URL pública para un servidor web local, sin abrir puertos en el router. Soporta HTTP, HTTPS, assets estáticos, JSON y WebSocket (WSS).

## Dominios

| Host | Uso |
|------|-----|
| `dtunnel.desarrollado.com` | Landing, docs, login, dashboard, API `/api/*` |
| `dtunnel-admin.desarrollado.com` | Panel superadmin (origen y sesión separados) |
| `install.desarrollado.com` | Instalador curl (`/dtunnel/install`) |
| `*.dtunnel.desarrollado.com` | Túneles activos |

**Ruta web Hestia (principal):** `/home/desarrollado/web/dtunnel.desarrollado.com/public_html`  
**Ruta web Hestia (admin):** `/home/desarrollado/web/dtunnel-admin.desarrollado.com/public_html`  
**Instalador curl:** `/home/desarrollado/web/install.desarrollado.com/public_html/dtunnel/`

## Enlaces

| Recurso | URL |
|---------|-----|
| Sitio | https://dtunnel.desarrollado.com |
| Instalador | https://install.desarrollado.com/dtunnel/install |
| npm | https://www.npmjs.com/package/@desarrollado/dtunnel | CLI v2.0.3 |
| Changelog | https://dtunnel.desarrollado.com/changelog.html | API v2.1.0 |
| Admin | https://dtunnel-admin.desarrollado.com | Panel superadmin |
| Estado | https://dtunnel.desarrollado.com/status.html | Monitorización pública |
| GitHub | https://github.com/desarrollado-com/dtunnel | |

## Arquitectura (v2)

```
Internet → Nginx (Hestia, TLS)
              ├─ dtunnel.desarrollado.com → public_html + /api → API Node :3001
              ├─ dtunnel-admin.desarrollado.com → admin-web (estático)
              └─ *.dtunnel → gateway nativo :18080 ← WebSocket ← CLI Node
```

| Capa | Tecnología |
|------|------------|
| Túnel | Node.js nativo (WebSocket + gateway HTTP) |
| Legacy | frp (`frps` / `frpc`) opcional con `--frp` |
| Edge TLS | Hestia + Let's Encrypt |
| API | Node.js + SQLite + nodemailer (SMTP) |
| CLI | `@desarrollado/dtunnel` + instalador curl |
| Web | HTML/CSS estático + Material Design 3 |

## Experiencia de usuario

### Gratis (anónimo)

```bash
dtunnel --port 88080
```

→ `https://q9iga6.dtunnel.desarrollado.com` (subdominio aleatorio, 1 túnel por IP).

### Registrado

```bash
dtunnel login
dtunnel reserve mi-api
dtunnel --port 88080 --subdomain mi-api
```

→ URL persistente `https://mi-api.dtunnel.desarrollado.com`.

### Docker / hostname local

```bash
dtunnel config set localHost mi-proyecto
dtunnel --port 3000
```

Ver [docker-compose.example.md](docker-compose.example.md).

### Cuenta

- Registro con **verificación de email** (`verify-email.html`, reenvío en `verify-pending.html`).
- Recuperación de contraseña: [forgot-password.html](https://dtunnel.desarrollado.com/forgot-password.html).

## Roadmap

| Fase | Entregable | Estado |
|------|------------|--------|
| 0 | DNS, SSL, plantillas Hestia | Hecho |
| 1 | frps, nginx split, CLI aleatorio | Hecho |
| 2 | Landing `public_html` | Hecho |
| 3 | API auth + subdominios reservados | Hecho |
| 4 | Instalador curl + npm `@desarrollado/dtunnel` | Hecho |
| 5 | Panel superadmin (usuarios, planes, límites) | Hecho |
| 5b | Admin subdominio + SMTP recuperación contraseña | Hecho |
| 5c | Cambiar contraseña, suspender, cron purga | Hecho |
| 5d | Túnel nativo v2 (sin frpc) | Hecho |
| 5e | Verificación email + admin reenvío | Hecho |
| 5f | CLI `--host` / Docker | Hecho |
| 6 | Billing Wompi + cupones + checkout | En progreso |
| 6b | Organizaciones (planes empresa) + RBAC | En progreso |
| 6c | Dominios CNAME por plan | En progreso |

## Panel superadmin

URL: `https://dtunnel-admin.desarrollado.com`

Funciones:

- Resumen, usuarios (plan, límites, suspender, activación, reset password)
- CRUD planes, túneles activos, anónimos por IP, subdominios reservados
- Logs de auditoría, ajustes (límite anónimo, heartbeat, purga)
- Mantenimiento: purgar túneles obsoletos y logs antiguos

## Configuración (secretos)

En `secretos/.env.dtunnel` (nunca en git):

```env
ADMIN_EMAILS=admin@example.com
DTUNNEL_ADMIN_PATH_PUBLIC=/home/desarrollado/web/dtunnel-admin.desarrollado.com/public_html

SMTP_HOST=
SMTP_PORT=465
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=
SMTP_FROM_NAME=dtunnel
```

Tras cambiar `ADMIN_EMAILS` o SMTP: `python deploy/upload-api.py`.

## Modelo free vs registrado

| | Gratis | Registrado |
|---|--------|------------|
| URL | Aleatoria | Fija (reservada) |
| Túneles simultáneos | 1 por IP | 5 (según plan) |
| Subdominio custom | No | Sí |
| Caducidad | Al cerrar CLI | Mientras plan activo |

## Decisiones técnicas

- **Transporte por defecto:** túnel nativo Node (v2); frp legacy opcional.
- **Puerto gateway:** `18080` (Apache Hestia usa `8080`).
- **Admin separado:** subdominio + CORS (`CORS_ORIGINS`).
- **Secrets:** `secretos/.env.dtunnel` (nunca en git).

## Estructura del repo

```
dtunnel/
├── api/              # Auth, túneles, subdominios, SMTP, admin
├── admin-web/        # Panel superadmin
├── client/           # CLI npm @desarrollado/dtunnel
├── install/dtunnel/  # Instalador curl
├── web/              # Landing → public_html
├── server/           # frps (legacy) + plantillas Hestia
├── deploy/           # Despliegue VPS
└── docs/
```
