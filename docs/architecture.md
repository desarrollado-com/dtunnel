# Arquitectura dtunnel

```
┌─────────────┐     HTTPS      ┌──────────────────────────────────────────┐
│  Internet   │ ──────────────►│ VPS (HestiaCP)                           │
│             │                │  Nginx :443                              │
└─────────────┘                │    ├─ apex → public_html + /api → :3001  │
                               │    └─ *.dtunnel → frps :18080            │
                               │              ▲                           │
                               │              │ TCP :7000                  │
┌─────────────┐                └──────────────┼───────────────────────────┘
│ Dev machine │  frpc + dtunnel CLI ──────────┘
│ localhost:N │
└─────────────┘
```

## Flujo

1. `dtunnel --port 88080` llama `POST /api/tunnels` → subdominio aleatorio + token frp.
2. CLI lanza `frpc` con ese subdominio.
3. Visitante abre `https://{sub}.dtunnel.desarrollado.com`.
4. Nginx wildcard → frps → frpc → `127.0.0.1:88080`.

## Componentes

| Componente | Puerto | Público |
|------------|--------|---------|
| Nginx (Hestia) | 443 | Sí |
| API Node | 3001 | Solo vía `/api` en apex |
| frps vhost | 18080 | No (localhost) |
| frps control | 7000 | Sí (clientes) |

## Usuarios

- **Anónimo:** URL aleatoria, 1 túnel.
- **Registrado:** reserva subdominio, hasta 5 túneles, URL persistente.

Ver [product-plan.md](product-plan.md).
