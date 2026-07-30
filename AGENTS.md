# dtunnel — guía para agentes

Workspace: túnel público + landing + API bajo `dtunnel.desarrollado.com`.

Repo: https://github.com/desarrollado-com/dtunnel

## Qué es

Self-hosted HTTP tunnel (Tunnelmole / ngrok style):

- **server/**: `frps` en VPS (Docker)
- **api/**: Node.js — auth, túneles, subdominios reservados
- **client/**: CLI npm `@desarrollado/dtunnel`
- **install/dtunnel/**: instalador curl (frpc + CLI bash)
- **web/**: landing → `public_html` en Hestia
- **deploy/**: scripts Python de despliegue (`deploy.py`, `upload-web.py`, `upload-install.py`)

## Comandos

```bash
# Desplegar todo al VPS
python deploy/deploy.py

# Publicar instalador curl
python deploy/upload-install.py

# Cliente local (desarrollo)
cd client && npm link
dtunnel --port 88080
```

## Reglas

1. Secrets en `secretos/.env.dtunnel` — nunca commitear.
2. `server/.env` y `api/.env` contienen tokens — están en `.gitignore`.
3. Plantilla Hestia: apex → Apache/API, wildcard → frps:18080.
4. No usar puerto 8080 para frps (conflicto Apache Hestia).

## Archivos clave

| Archivo | Propósito |
|---------|-----------|
| `docs/product-plan.md` | Plan de producto |
| `server/hestia/dtunnel.stpl` | Nginx split HTTPS |
| `api/src/index.js` | API REST |
| `client/bin/dtunnel.js` | CLI Node |
| `client/dtunnel.sh` | CLI bash (instalador curl) |
| `install/dtunnel/install` | Script instalador universal |
| `deploy/deploy.py` | Despliegue automatizado |
