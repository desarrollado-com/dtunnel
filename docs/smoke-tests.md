# Smoke tests

Comprobaciones rápidas tras un deploy para detectar regresiones obvias.

## Ejecutar

```bash
# Desde api/ (requiere dependencia ws ya instalada)
npm run test:smoke

# URL personalizada
BASE_URL=https://dtunnel.desarrollado.com node scripts/smoke-test.mjs
```

## Qué verifica

| Check | Descripción |
|-------|-------------|
| `GET /api/health` | API viva y versión |
| `GET /api/plans` | Planes públicos |
| `GET /api/status` | Estado operativo |
| `WS /api/admin/ws/console` | Upgrade WebSocket (consola admin) |
| `WS /api/admin/ws/metrics` | Upgrade WebSocket (métricas) |
| `GET /` | Landing |
| `GET /dashboard.html` | Dashboard usuario |

## Cuándo ejecutar

- Después de `upload-api.py`, `upload-web.py` o `apply-hestia.py`
- Antes de un commit grande o release

## Limitaciones

No sustituye tests unitarios ni E2E con login. Solo valida que los endpoints públicos y el upgrade WS respondan.

## Changelog

Los cambios notables se documentan en [CHANGELOG.md](../CHANGELOG.md) y [web/changelog.html](../web/changelog.html).
