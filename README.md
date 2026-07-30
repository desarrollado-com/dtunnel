# dtunnel

Túnel HTTP/HTTPS propio (estilo Tunnelmole / ngrok) bajo **`*.dtunnel.desarrollado.com`**.

**Versión actual del CLI:** `1.0.2`

```
localhost:88080  →  frpc  →  frps (VPS)  →  https://a7f3c2.dtunnel.desarrollado.com
```

Repositorio: [github.com/desarrollado-com/dtunnel](https://github.com/desarrollado-com/dtunnel)  
Paquete npm: [@desarrollado/dtunnel](https://www.npmjs.com/package/@desarrollado/dtunnel)

## Instalación (usuarios)

### Linux / macOS / WSL

```bash
curl -O https://install.desarrollado.com/dtunnel/install && sudo bash install
dtunnel version
```

### Node.js (desarrolladores / Windows sin WSL)

Requiere Node.js 16+ y [frpc](https://github.com/fatedier/frp/releases) en PATH.

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
├── api/              # API Node (auth, túneles, subdominios, admin)
├── client/           # CLI npm @desarrollado/dtunnel
├── install/dtunnel/  # Instalador curl (frpc + CLI bash)
├── web/              # Landing, docs, admin → public_html en Hestia
├── server/           # frps (Docker) + plantillas Hestia
├── deploy/           # Scripts de despliegue al VPS
└── docs/             # Arquitectura, Hestia, plan de producto
```

## Desarrollo y despliegue

Credenciales del VPS en `secretos/.env.dtunnel` (fuera de este repo, nunca commitear).

```bash
# Desplegar broker + API + plantillas Hestia
python deploy/deploy.py

# Solo web + admin panel
python deploy/upload-web.py

# Solo instalador curl
python deploy/upload-install.py
```

## Dominios

| Host | Uso |
|------|-----|
| `dtunnel.desarrollado.com` | Landing, login, API, admin |
| `install.desarrollado.com` | Instalador curl |
| `*.dtunnel.desarrollado.com` | Túneles activos |
| [npmjs.com/@desarrollado/dtunnel](https://www.npmjs.com/package/@desarrollado/dtunnel) | CLI Node.js |

## Documentación

- [Plan de producto](docs/product-plan.md)
- [Hestia / infra](docs/hestia.md)
- [Arquitectura](docs/architecture.md)
