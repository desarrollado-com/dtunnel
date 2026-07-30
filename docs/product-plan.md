# Plan de producto dtunnel

Servicio self-hosted tipo [Tunnelmole](https://github.com/robbie-cahill/tunnelmole-client): URL pública para un servidor web local, sin abrir puertos en el router. Soporta HTTP, HTTPS, assets estáticos, JSON y WebSocket (WSS).

## Dominios


| Host                         | Uso                                |
| ---------------------------- | ---------------------------------- |
| `dtunnel.desarrollado.com`   | Landing, docs, login, API `/api/*` |
| `install.desarrollado.com`   | Instalador curl (`/dtunnel/install`) |
| `*.dtunnel.desarrollado.com` | Túneles activos                      |


**Ruta web Hestia:** `/home/desarrollado/web/dtunnel.desarrollado.com/public_html`  
**Instalador curl:** `/home/desarrollado/web/install.desarrollado.com/public_html/dtunnel/`

## Enlaces

| Recurso | URL |
|---------|-----|
| Sitio | https://dtunnel.desarrollado.com |
| Instalador | https://install.desarrollado.com/dtunnel/install |
| npm | https://www.npmjs.com/package/@desarrollado/dtunnel | CLI v1.0.2 |
| Admin | https://dtunnel.desarrollado.com/admin.html | Panel superadmin |
| GitHub | https://github.com/desarrollado-com/dtunnel |

## Arquitectura

```
Internet → Nginx (Hestia, TLS wildcard)
              ├─ apex → public_html + /api → API Node
              └─ *.dtunnel → frps :18080 ← frpc ← localhost:PORT
```


| Capa     | Tecnología                      |
| -------- | ------------------------------- |
| Broker   | frp (`frps` / `frpc`)           |
| Edge TLS | Hestia + Let's Encrypt wildcard |
| API      | Node.js + SQLite                |
| CLI      | Node.js (`@desarrollado/dtunnel`) + bash (instalador curl) |
| Web      | HTML/CSS estático + [Material Design 3](https://m3.material.io/) |




## Experiencia de usuario



### Gratis (anónimo)

```bash
dtunnel --port 88080
```

→ `https://q9iga6.dtunnel.desarrollado.com` (subdominio aleatorio, 1 túnel, sin reserva).

### Registrado

```bash
dtunnel login
dtunnel --port 88080 --subdomain mi-api
```

→ URL persistente `https://mi-api.dtunnel.desarrollado.com`.

## Roadmap


| Fase | Entregable                                     | Estado |
| ---- | ---------------------------------------------- | ------ |
| 0    | DNS, SSL, plantillas Hestia                    | Hecho  |
| 1    | frps, nginx split, CLI aleatorio               | Hecho  |
| 2    | Landing `public_html`                          | Hecho  |
| 3    | API auth + subdominios reservados              | Hecho  |
| 4    | Instalador curl + npm `@desarrollado/dtunnel`  | Hecho  |
| 5    | Panel superadmin (usuarios, planes, límites)   | Hecho  |
| 6    | Billing / pagos automáticos                    | Futuro |




## Panel superadmin

URL: `https://dtunnel.desarrollado.com/admin.html`

Requiere cuenta con `is_admin` o email listado en `ADMIN_EMAILS` (variable de entorno de la API).

Funciones:
- Resumen de usuarios, túneles y subdominios
- Gestión de usuarios (plan, límites override, activar/desactivar, rol admin)
- CRUD de planes (precios, límites de túneles y subdominios)
- Cerrar túneles activos desde la base de datos
- Ajuste del límite de túneles anónimos

Configuración en `secretos/.env.dtunnel`:

```env
ADMIN_EMAILS=fg@desarrollado.com
```

Tras añadir el email, redesplegar la API (`python deploy/deploy.py`) y volver a iniciar sesión.

## Modelo free vs registrado


|                     | Gratis        | Registrado           |
| ------------------- | ------------- | -------------------- |
| URL                 | Aleatoria     | Fija (reservada)     |
| Túneles simultáneos | 1             | 5                    |
| Subdominio custom   | No            | Sí                   |
| Caducidad           | Al cerrar CLI | Mientras plan activo |




## Decisiones técnicas

- **Transporte:** frp (no reimplementar WebSocket propio).
- **Puerto frps vhost:** `18080` (Apache Hestia usa `8080`).
- **Plantilla nginx:** dos bloques `server` — apex → Apache, wildcard → frps.
- **Secrets:** `secretos/.env.dtunnel` (nunca en git).



## Estructura del repo

```
dtunnel/
├── api/              # Auth, túneles, subdominios
├── client/           # CLI npm @desarrollado/dtunnel
├── install/dtunnel/  # Instalador curl
├── web/              # Landing → public_html
├── server/           # frps + plantillas Hestia
├── deploy/           # Despliegue VPS
└── docs/
```

