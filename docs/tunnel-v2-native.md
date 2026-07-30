# Túnel nativo v2 (sin frpc)

## Problema

El binario `frpc` (Go, descargado de GitHub) suele disparar **falsos positivos** de antivirus/troyano en Windows y algunos entornos corporativos.

## Solución v2

Cliente **100 % Node.js** — sin descargar ni ejecutar binarios externos.

```
Visitante → Nginx → :18080 (gateway nativo en API)
                      ↕ WebSocket
                 dtunnel CLI (native-client.js) → localhost:PUERTO
```

| Componente | v1 (legacy) | v2 (nativo) |
|------------|-------------|-------------|
| Cliente | `frpc` (Go) | `native-client.js` (Node) |
| Servidor | `frps` :18080 | API gateway :18080 |
| Control | TCP :7000 frp | WSS `/tunnel/ws` |
| Antivirus | A menudo bloquea | Solo Node.js |

## Uso CLI

```bash
# Por defecto: nativo v2 (requiere Node 18+)
dtunnel --port 3000

# Legacy con frpc (si el servidor tiene TUNNEL_TRANSPORT=both)
dtunnel --frp --port 3000
```

## Servidor

Variables en `.env` de la API:

```env
TUNNEL_TRANSPORT=native   # native | frp | both
TUNNEL_HTTP_PORT=18080
```

Con `native`, **detener frps** (ocupa el mismo puerto 18080):

```bash
docker stop dtunnel_frps
```

Nginx debe proxy `/tunnel/` al API para WebSocket (plantillas Hestia actualizadas).

## Migración

1. Desplegar API v2 con `TUNNEL_TRANSPORT=native`
2. Reconstruir dominio Hestia (plantilla con `/tunnel/`)
3. `docker stop dtunnel_frps`
4. Publicar CLI npm `@desarrollado/dtunnel@2.0.0`

Usuarios con instalador curl antiguo: actualizar a npm o nueva versión del instalador.
