# dtunnel — guía para agentes

Workspace: túnel público + landing + API bajo `dtunnel.desarrollado.com`.

Repo: https://github.com/desarrollado-com/dtunnel

## Qué es

Self-hosted HTTP tunnel (Tunnelmole / ngrok style):

- **server/**: `frps` en VPS (Docker)
- **api/**: Node.js — auth, túneles, subdominios, SMTP (recuperación de contraseña)
- **admin-web/**: panel superadmin → `dtunnel-admin.desarrollado.com`
- **client/**: CLI npm `@desarrollado/dtunnel` (auto-instala `frpc` en `~/.dtunnel/bin/`)
- **install/dtunnel/**: instalador curl (frpc + CLI bash)
- **web/**: landing, docs, dashboard → `public_html` principal
- **deploy/**: scripts Python de despliegue

## Comandos

```bash
# Desplegar todo al VPS (server, api, web, admin-web)
python deploy/deploy.py

# Despliegues parciales
python deploy/upload-web.py
python deploy/upload-admin.py
python deploy/upload-api.py
python deploy/upload-install.py

# Operaciones en producción
python deploy/tunnels.py list
python deploy/tunnels.py purge-anon

# Cliente local (desarrollo)
cd client && npm link
dtunnel --port 88080
```

## Reglas

1. Secrets en `secretos/.env.dtunnel` — nunca commitear.
2. `server/.env` y `api/.env` contienen tokens — están en `.gitignore`.
3. Plantilla Hestia: apex → Apache/API, wildcard → frps:18080.
4. No usar puerto 8080 para frps (conflicto Apache Hestia).
5. Panel admin en subdominio separado; CORS en API incluye `dtunnel-admin.desarrollado.com`.

## Archivos clave

| Archivo | Propósito |
|---------|-----------|
| `docs/product-plan.md` | Plan de producto |
| `docs/monitoring.md` | UptimeRobot + cron de purga |
| `server/hestia/dtunnel.stpl` | Nginx split HTTPS |
| `api/src/index.js` | API REST |
| `admin-web/js/admin.js` | Panel superadmin |
| `client/bin/dtunnel.js` | CLI Node |
| `web/dashboard.html` | Cuenta de usuario |
| `deploy/deploy.py` | Despliegue completo |
