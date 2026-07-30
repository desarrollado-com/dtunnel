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
| npm | https://www.npmjs.com/package/@desarrollado/dtunnel | CLI v1.0.6 |
| Changelog | https://dtunnel.desarrollado.com/changelog.html | Plataforma v1.0.7 |
| Admin | https://dtunnel-admin.desarrollado.com | Panel superadmin |
| Estado | https://dtunnel.desarrollado.com/status.html | Monitorización pública |
| GitHub | https://github.com/desarrollado-com/dtunnel | |

## Arquitectura

```
Internet → Nginx (Hestia, TLS)
              ├─ dtunnel.desarrollado.com → public_html + /api → API Node
              ├─ dtunnel-admin.desarrollado.com → admin-web (estático)
              └─ *.dtunnel → frps :18080 ← frpc ← localhost:PORT
```

| Capa | Tecnología |
|------|------------|
| Broker | frp (`frps` / `frpc`) |
| Edge TLS | Hestia + Let's Encrypt |
| API | Node.js + SQLite + nodemailer (SMTP) |
| CLI | Node.js (`@desarrollado/dtunnel`) + bash (instalador curl) |
| Web | HTML/CSS estático + Material Design 3 |

## Experiencia de usuario

### Gratis (anónimo)

```bash
dtunnel --port 88080
```

→ `https://q9iga6.dtunnel.desarrollado.com` (subdominio aleatorio, 1 túnel por IP, sin reserva).

### Registrado

```bash
dtunnel login
dtunnel reserve mi-api
dtunnel --port 88080 --subdomain mi-api
```

→ URL persistente `https://mi-api.dtunnel.desarrollado.com`.

Recuperación de contraseña: [forgot-password.html](https://dtunnel.desarrollado.com/forgot-password.html).

## Roadmap

| Fase | Entregable | Estado |
|------|------------|--------|
| 0 | DNS, SSL, plantillas Hestia | Hecho |
| 1 | frps, nginx split, CLI aleatorio | Hecho |
| 2 | Landing `public_html` | Hecho |
| 3 | API auth + subdominios reservados | Hecho |
| 4 | Instalador curl + npm `@desarrollado/dtunnel` | Hecho |
| 5 | Panel superadmin (usuarios, planes, límites) | Hecho |
| 5b | Admin en subdominio + recuperación de contraseña SMTP | Hecho (v1.0.7) |
| 6 | Billing / pagos automáticos | Futuro |

## Panel superadmin

URL: `https://dtunnel-admin.desarrollado.com`

Requiere cuenta con `is_admin` o email listado en `ADMIN_EMAILS` (variable de entorno de la API). El login es independiente del sitio principal (localStorage por origen).

Funciones:

- Resumen de usuarios, túneles y subdominios
- Gestión de usuarios (plan, límites override, activar/desactivar, rol admin)
- CRUD de planes (precios, límites de túneles y subdominios)
- Cerrar túneles activos (con IP y último heartbeat)
- Ajuste del límite de túneles anónimos

Código: `admin-web/` · Despliegue: `python deploy/upload-admin.py`

## Configuración (secretos)

En `secretos/.env.dtunnel` (nunca en git):

```env
ADMIN_EMAILS=admin@example.com
DTUNNEL_ADMIN_PATH_PUBLIC=/home/desarrollado/web/dtunnel-admin.desarrollado.com/public_html

# SMTP (recuperación de contraseña)
SMTP_HOST=
SMTP_PORT=465
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=
SMTP_FROM_NAME=dtunnel
```

Tras cambiar `ADMIN_EMAILS` o SMTP, redesplegar la API: `python deploy/upload-api.py`.

## Modelo free vs registrado

| | Gratis | Registrado |
|---|--------|------------|
| URL | Aleatoria | Fija (reservada) |
| Túneles simultáneos | 1 por IP | 5 (según plan) |
| Subdominio custom | No | Sí |
| Caducidad | Al cerrar CLI | Mientras plan activo |

## Decisiones técnicas

- **Transporte:** frp (no reimplementar WebSocket propio).
- **Puerto frps vhost:** `18080` (Apache Hestia usa `8080`).
- **Plantilla nginx:** dos bloques `server` — apex → Apache, wildcard → frps.
- **Admin separado:** subdominio propio + CORS en API (`CORS_ORIGINS`).
- **Secrets:** `secretos/.env.dtunnel` (nunca en git).

## Estructura del repo

```
dtunnel/
├── api/              # Auth, túneles, subdominios, SMTP
├── admin-web/        # Panel superadmin
├── client/           # CLI npm @desarrollado/dtunnel
├── install/dtunnel/  # Instalador curl
├── web/              # Landing → public_html
├── server/           # frps + plantillas Hestia
├── deploy/           # Despliegue VPS
└── docs/
```
