# Versionado (SemVer)

Toda la plataforma dtunnel (API, web, admin, CLI npm) comparte el mismo número **X.Y.Z** salvo que el cambio sea exclusivo del CLI (se indica en el changelog).

## X.Y.Z

| Parte | Nombre | Cuándo subir | Ejemplo |
|-------|--------|--------------|---------|
| **X** | Mayor (Major) | Cambios grandes o que **rompen compatibilidad** con versiones anteriores | Rediseño de API, eliminar endpoints, cambio de protocolo de túnel |
| **Y** | Menor (Minor) | **Nuevas funciones** que mantienen compatibilidad | Trazas HTTP, `dtunnel logs`, panel RBAC, 2FA |
| **Z** | Parche (Patch) | **Corrección de errores** sin cambiar el comportamiento principal | Scroll del sidebar, toggle de tema roto |

## Reglas de publicación

1. Actualizar `VERSION` en la raíz del repo.
2. Sincronizar `api/package.json` y `client/package.json` con ese valor.
3. Añadir entrada en `CHANGELOG.md` y `client/CHANGELOG.md` (solo lo del CLI).
4. Actualizar `web/changelog.html`.
5. Publicar npm: `python deploy/publish-client.py` (o `npm publish` en `client/`).
6. Desplegar API (`upload-api.py` lee `VERSION` → `API_VERSION`).
7. Desplegar web y admin si hubo cambios en esos frontends.

## Comprobar versión en producción

```bash
curl -s https://dtunnel.desarrollado.com/api/health | jq .version
dtunnel version
```
