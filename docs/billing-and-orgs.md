# Billing, organizaciones y RBAC

Arquitectura para alinear precios públicos, planes empresariales, permisos y pagos con **Wompi**.

## Principio: una sola fuente de verdad

| Capa | Fuente |
|------|--------|
| Landing `/precios` | `GET /api/plans` (solo `visibility=public`) |
| Dashboard usuario | `GET /api/me` → límites del plan efectivo |
| Admin | CRUD `/api/admin/plans` |
| Checkout | `POST /api/billing/checkout` |

El tier **anónimo** no es un plan en DB: lo controla `anon_tunnel_limit` en ajustes.

## Modelo de planes

| Campo | Uso |
|-------|-----|
| `plan_type` | `personal` \| `enterprise` |
| `visibility` | `public` (landing + autoservicio) \| `private` (solo con acceso concedido) |
| `max_seats` | Usuarios por organización (empresa) |
| `features` (JSON) | `customCname`, `customCnameLimit`, `apiAccess`, `sso`, etc. |
| `wompi_product_id` | ID producto Wompi (opcional) |

Planes seed:

- **free** — personal, público
- **pro** — personal, público, CNAME x1
- **team** — enterprise, público, 25 asientos
- **partner** — personal, **privado** (ejemplo de plan con acceso restringido)

## Planes privados

1. Admin crea plan con `visibility: private`.
2. Concede acceso: `POST /api/admin/users/:id/plan-access` `{ planSlug }`.
3. El usuario ve el plan en `GET /api/billing/plans` y puede suscribirse en `/billing.html`.
4. El checkout rechaza planes privados sin acceso (`403`).

Tabla `plan_grants`: acceso por usuario, opcional `expires_at`.

## Suscripciones

- `GET /api/billing/subscription` — suscripción activa del usuario
- `GET /api/admin/subscriptions` — listado admin
- Tabla `subscriptions`: estados `pending`, `active`, `cancelled`
- Asignación de cortesía al cambiar plan en admin (`compSubscription`)

## Organizaciones (enterprise)

```
Usuario → organization_members → organizations → plan (team)
```

- Un plan empresarial se asigna a la **organización**, no al usuario individual.
- `users.primary_org_id` define el contexto activo para límites.
- API: `POST /api/orgs`, `GET /api/orgs/:id/members`, invitaciones.

## RBAC

Roles seed en tabla `roles`:

| Rol | Alcance | Uso |
|-----|---------|-----|
| `superadmin` | system | Todo (migración desde `is_admin`) |
| `support` | system | Solo lectura |
| `org_owner` | organization | Control total del workspace |
| `org_admin` | organization | Gestión sin facturación |
| `org_member` | organization | Túneles y subdominios |
| `org_billing` | organization | Solo pagos |

Permisos granulares: `tunnel.create`, `cname.configure`, `org.billing`, etc.

Admin: `GET /api/admin/roles`, asignación `PATCH /api/admin/users/:id/roles`.

## Wompi (preparado)

Variables en `.env`:

```env
WOMPI_ENV=sandbox|production
WOMPI_PUBLIC_KEY=
WOMPI_PRIVATE_KEY=
WOMPI_EVENTS_SECRET=
WOMPI_INTEGRITY_SECRET=
WOMPI_CURRENCY=COP
```

Flujo:

1. `GET /api/billing/config` — clave pública al frontend
2. `POST /api/billing/checkout` — crea suscripción `pending` + sesión Wompi (reference, signature)
3. Widget/redirect Wompi en el cliente
4. `POST /api/billing/webhooks/wompi` — activa suscripción y asigna plan

Cupones: tabla `coupons`, validación `POST /api/billing/coupons/validate`.

## Dominios CNAME

Si `features.customCname` del plan lo permite:

- `GET/POST/DELETE /api/custom-domains`
- Instrucciones DNS: CNAME `tu-dominio.com` → `mi-api.dtunnel.desarrollado.com`
- Verificación SSL: pendiente (fase siguiente)

## Próximos pasos recomendados

1. Configurar credenciales Wompi sandbox y probar checkout end-to-end
2. UI de checkout en dashboard + página `billing/success.html`
3. Verificación DNS automática para CNAME
4. Migrar `is_admin` → rol `superadmin` en `user_system_roles`
5. Facturación recurrente (suscripciones Wompi o cron + cobro)

## Seguridad avanzada

### 2FA (TOTP)

- Activación: `POST /api/auth/2fa/setup` → `POST /api/auth/2fa/enable`
- Login con 2FA: `requires2fa` + `POST /api/auth/2fa/verify`
- Códigos de respaldo de un solo uso

### Impersonación

- `POST /api/admin/users/:id/impersonate` (auditoría `user.impersonate_start`)
- Token JWT con claims `imp`, `impBy`, `impByEmail` (1 h)
- `POST /api/admin/impersonate/stop` restaura sesión admin

### Métricas en tiempo real

- WebSocket: `wss://dtunnel.desarrollado.com/api/admin/ws/metrics?token=JWT`
- Actualización cada 5 s en el panel admin (requiere proxy WebSocket en nginx)
