# dtunnel

Túnel HTTP/HTTPS propio (estilo Tunnelmole / ngrok) bajo **`*.dtunnel.desarrollado.com`**.

**Plataforma (web + API + admin):** `2.6.0` · **CLI npm:** `2.3.0`

```
localhost:88080  →  CLI Node (WebSocket)  →  API gateway (VPS)  →  https://a7f3c2.dtunnel.desarrollado.com
```

Túnel **nativo** (solo Node.js + WebSocket en la API).
Repositorio: [github.com/desarrollado-com/dtunnel](https://github.com/desarrollado-com/dtunnel)  
Paquete npm: [@desarrollado/dtunnel](https://www.npmjs.com/package/@desarrollado/dtunnel)

## Instalación (usuarios)

### Linux / macOS / WSL

```bash
curl -O https://install.desarrollado.com/dtunnel/install && sudo bash install
dtunnel version
```

### Node.js (desarrolladores / Windows sin WSL)

Requiere Node.js 18+. v2 no descarga binarios externos; usa WebSocket nativo.

```bash
npm install -g @desarrollado/dtunnel
dtunnel version
```

## Actualizar

```bash
# Instalador curl (Linux/macOS/WSL)
curl -O https://install.desarrollado.com/dtunnel/install && sudo bash install

# npm
npm install -g @desarrollado/dtunnel@latest
```

Comprueba la versión: `dtunnel version`

## Uso

```bash
dtunnel --port 88080
dtunnel status
dtunnel --list up
dtunnel down
```

Documentación: [dtunnel.desarrollado.com/docs.html](https://dtunnel.desarrollado.com/docs.html)

## Estructura del repo

```
dtunnel/
├── api/              # API Node (auth, túneles, subdominios, admin, SMTP)
├── admin-web/        # Panel superadmin → dtunnel-admin.desarrollado.com
├── client/           # CLI npm @desarrollado/dtunnel
├── install/dtunnel/  # Instalador curl (CLI npm)
├── web/              # Landing, docs, dashboard → public_html principal
├── server/           # Plantillas Hestia + verificación VPS
├── deploy/           # Scripts de despliegue al VPS
└── docs/             # Arquitectura, Hestia, plan de producto
```

## Desarrollo y despliegue

Credenciales del VPS en `secretos/.env.dtunnel` (fuera de este repo, nunca commitear).

```bash
# Despliegue completo (API + web + plantillas Hestia)
python deploy/deploy.py

# Solo sitio público (landing, docs, dashboard, recuperación de contraseña)
python deploy/upload-web.py

# Solo panel admin (subdominio separado)
python deploy/upload-admin.py

# Solo instalador curl
python deploy/upload-install.py

# Solo API (rebuild Docker, SMTP/CORS en .env)
python deploy/upload-api.py

# SSL Let's Encrypt del subdominio admin (si hace falta)
python deploy/fix-admin-ssl.py

# Túneles en producción (listar / purgar huérfanos anónimos)
python deploy/tunnels.py list
python deploy/tunnels.py purge-anon
python deploy/tunnels.py purge-stale
python deploy/install-cron.py
```

Variables SMTP y admin en `secretos/.env.dtunnel`: `SMTP_*`, `ADMIN_EMAILS`, `DTUNNEL_ADMIN_PATH_PUBLIC`.

## Dominios

| Host | Uso |
|------|-----|
| `dtunnel.desarrollado.com` | Landing, login, dashboard, API `/api/*` |
| `dtunnel-admin.desarrollado.com` | Panel superadmin (origen separado) |
| `install.desarrollado.com` | Instalador curl |
| `*.dtunnel.desarrollado.com` | Túneles activos |
| [npmjs.com/@desarrollado/dtunnel](https://www.npmjs.com/package/@desarrollado/dtunnel) | CLI Node.js |

## Documentación

- [Plan de producto](docs/product-plan.md)
- [Changelog](CHANGELOG.md) · [web](https://dtunnel.desarrollado.com/changelog.html)
- [Hestia / infra](docs/hestia.md)
- [Monitorización](docs/monitoring.md)
- [Arquitectura](docs/architecture.md)
- [Docker Compose](docs/docker-compose.example.md)
- [Panel admin](admin-web/README.md)
