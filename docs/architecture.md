# Arquitectura dtunnel

```
┌─────────────┐     HTTPS      ┌──────────────────────────────────────────────────┐
│  Internet   │ ──────────────►│ VPS (HestiaCP)                                   │
│             │                │  Nginx :443                                      │
└─────────────┘                │    ├─ dtunnel.desarrollado.com → public_html + API │
                               │    ├─ dtunnel-admin.desarrollado.com → admin-web   │
                               │    └─ *.dtunnel → frps :18080                      │
                               │              ▲                                     │
                               │              │ TCP :7000                           │
┌─────────────┐                └──────────────┼─────────────────────────────────────┘
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

## Distribución del CLI

| Canal | URL |
|-------|-----|
| Instalador curl | `https://install.desarrollado.com/dtunnel/install` |
| Espejo curl | `https://dtunnel.desarrollado.com/install/dtunnel/install` |
| npm | `@desarrollado/dtunnel` en [npmjs.com](https://www.npmjs.com/package/@desarrollado/dtunnel) |
| Código fuente | [github.com/desarrollado-com/dtunnel](https://github.com/desarrollado-com/dtunnel) |

## Usuarios

- **Anónimo:** URL aleatoria, 1 túnel por IP.
- **Registrado:** reserva subdominio, hasta 5 túneles, URL persistente, recuperación de contraseña por email.

## Panel admin

Sitio estático en `dtunnel-admin.desarrollado.com` (`admin-web/`). Llama a `/api/admin/*` en el apex con JWT. CORS permite el origen admin.

Ver [product-plan.md](product-plan.md).
