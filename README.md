# dtunnel

Túnel HTTP/HTTPS propio (estilo Tunnelmole / ngrok) bajo **`*.dtunnel.desarrollado.com`**.

```
localhost:88080  →  frpc  →  frps (VPS)  →  https://a7f3c2.dtunnel.desarrollado.com
```

Repositorio: [github.com/desarrollado-com/dtunnel](https://github.com/desarrollado-com/dtunnel)

## Instalación (usuarios)

### Linux / macOS / WSL

```bash
curl -O https://install.desarrollado.com/dtunnel/install && sudo bash install
```

### Node.js (desarrolladores / Windows sin WSL)

Requiere Node.js 16+ y [frpc](https://github.com/fatedier/frp/releases) en PATH.

```bash
npm install -g @desarrollado/dtunnel
```

### Uso

```bash
dtunnel --port 88080
dtunnel down
```

Documentación: [dtunnel.desarrollado.com/docs.html](https://dtunnel.desarrollado.com/docs.html)

## Estructura del repo

```
dtunnel/
├── api/              # API Node (auth, túneles, subdominios)
├── client/           # CLI npm @desarrollado/dtunnel
├── install/dtunnel/  # Instalador curl (frpc + CLI bash)
├── web/              # Landing y docs → public_html en Hestia
├── server/           # frps (Docker) + plantillas Hestia
├── deploy/           # Scripts de despliegue al VPS
└── docs/             # Arquitectura, Hestia, plan de producto
```

## Desarrollo y despliegue

Credenciales del VPS en `secretos/.env.dtunnel` (fuera de este repo, nunca commitear).

```bash
# Desplegar broker + API + plantillas Hestia
python deploy/deploy.py

# Solo web
python deploy/upload-web.py

# Solo instalador curl
python deploy/upload-install.py
```

## Dominios

| Host | Uso |
|------|-----|
| `dtunnel.desarrollado.com` | Landing, login, API |
| `install.desarrollado.com` | Instalador curl |
| `*.dtunnel.desarrollado.com` | Túneles activos |

## Documentación

- [Plan de producto](docs/product-plan.md)
- [Hestia / infra](docs/hestia.md)
- [Arquitectura](docs/architecture.md)
