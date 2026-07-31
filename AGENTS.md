# dtunnel — guía para agentes

Workspace: túnel público + landing + API bajo `dtunnel.desarrollado.com`.

Repo: https://github.com/desarrollado-com/dtunnel

## Qué es

Self-hosted HTTP tunnel (Tunnelmole / ngrok style):

- **api/**: Node.js — auth, túneles nativos (WebSocket + gateway :18080), admin, SMTP
- **admin-web/**: panel superadmin → `dtunnel-admin.desarrollado.com`
- **client/**: CLI npm `@desarrollado/dtunnel` (`native-client.js`)
- **install/dtunnel/**: instalador curl (CLI npm)
- **server/**: plantillas Hestia + `verify-vps.sh`
- **web/**: landing, docs, dashboard → `public_html` principal
- **deploy/**: scripts Python de despliegue

## Comandos

```bash
python deploy/deploy.py
python deploy/upload-api.py
python deploy/upload-web.py
python deploy/upload-admin.py

cd client && npm link
dtunnel --port 88080
```

## Reglas

1. Secrets en `secretos/.env.dtunnel` — nunca commitear.
2. `api/.env` en el VPS — no commitear.
3. Plantilla Hestia: apex → Apache/API, wildcard → gateway nativo `127.0.0.1:18080`.
4. No usar puerto 8080 para el gateway (conflicto Apache Hestia).
5. Panel admin en subdominio separado; CORS incluye `dtunnel-admin.desarrollado.com`.

## Archivos clave

| Archivo | Propósito |
|---------|-----------|
| `api/src/tunnel/native.js` | Gateway HTTP + WebSocket túnel |
| `api/src/index.js` | API REST |
| `client/bin/dtunnel.js` | CLI |
| `client/bin/native-client.js` | Proceso túnel local |
| `server/hestia/dtunnel.stpl` | Nginx split HTTPS |
| `deploy/deploy.py` | Despliegue completo |
