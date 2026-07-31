# Arquitectura dtunnel (v2 nativo)

```
┌─────────────┐     HTTPS      ┌──────────────────────────────────────────────────┐
│  Internet   │ ──────────────►│ VPS (HestiaCP)                                   │
│             │                │  Nginx :443                                      │
└─────────────┘                │    ├─ dtunnel.desarrollado.com → public_html + API │
                               │    ├─ dtunnel-admin.desarrollado.com → admin-web   │
                               │    └─ *.dtunnel → API gateway :18080               │
                               │              ▲                                     │
                               │              │ WebSocket /tunnel/ws               │
┌─────────────┐                └──────────────┼─────────────────────────────────────┘
│ Dev machine │  dtunnel CLI (native-client) ─┘
│ host:PORT   │  (127.0.0.1, mi-proyecto, etc.)
└─────────────┘
```

## Flujo (modo nativo, por defecto)

1. `dtunnel --port 3000` llama `POST /api/tunnels` → subdominio + `tunnelToken` + `wsUrl`.
2. CLI lanza `native-client.js` → WebSocket a `/tunnel/ws`.
3. Visitante abre `https://{sub}.dtunnel.desarrollado.com`.
4. Nginx wildcard → gateway HTTP `:18080` → reenvío por WS al CLI → `http://{localHost}:{port}`.

## Componentes

| Componente | Puerto | Público |
|------------|--------|---------|
| Nginx (Hestia) | 443 | Sí |
| API Node | 3001 | Solo vía `/api` en apex |
| Gateway túnel nativo | 18080 | Solo localhost (Nginx proxy) |
| WebSocket túnel | 3001 `/tunnel/ws` | Solo vía Nginx |

## Referencias

- [docker-compose.example.md](docker-compose.example.md)
- [hestia.md](hestia.md)
