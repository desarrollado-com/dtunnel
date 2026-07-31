# Infraestructura edge (Hestia + nginx)

El tráfico de túneles `*.dtunnel.desarrollado.com` se enruta al **gateway nativo** de la API en `127.0.0.1:18080` (`TUNNEL_HTTP_PORT`).

## Contenido

| Ruta | Uso |
|------|-----|
| `hestia/dtunnel.tpl` | Plantilla proxy HTTP Hestia |
| `hestia/dtunnel.stpl` | Plantilla proxy HTTPS Hestia |
| `nginx-hestia-snippet.conf` | Referencia de snippet nginx |
| `verify-vps.sh` | Comprobaciones del VPS |

## Despliegue

1. Subir plantillas a Hestia (`deploy/deploy.py` lo hace automáticamente).
2. Aplicar plantilla `dtunnel` al dominio en Hestia.
3. La API Docker expone `:18080` en el host para el gateway HTTP de túneles.

No se usa `frps` ni `frpc`.
