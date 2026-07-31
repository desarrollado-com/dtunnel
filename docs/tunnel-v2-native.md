# Túnel nativo (único modo)

dtunnel usa **solo Node.js**: el CLI (`native-client.js`) mantiene un WebSocket con la API; el gateway HTTP en `:18080` reenvía el tráfico público.

## Por qué no hay frpc

El binario `frpc` (Go) generaba falsos positivos de antivirus en Windows. El túnel nativo evita descargas externas.

## Uso

```bash
dtunnel --port 3000
```

## Servidor

```env
TUNNEL_HTTP_PORT=18080
DOMAIN=dtunnel.desarrollado.com
```

Nginx wildcard → `127.0.0.1:18080`. La API expone el gateway al arrancar (`api/src/tunnel/native.js`).

## Migración desde frp

1. Desplegar API ≥ 2.6.0
2. `docker stop dtunnel_frps && docker rm dtunnel_frps`
3. Actualizar CLI: `npm install -g @desarrollado/dtunnel@latest`
4. Quitar `FRPS_*` y `TUNNEL_TRANSPORT` del `.env` de la API
