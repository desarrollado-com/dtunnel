# Panel de administración dtunnel

Sitio estático desplegado en **`https://dtunnel-admin.desarrollado.com`**.

Consume la API en `https://dtunnel.desarrollado.com/api` (CORS habilitado). El token de sesión es por origen: hay que iniciar sesión en este subdominio aunque ya estés logueado en el sitio principal.

## Despliegue

```bash
python deploy/upload-admin.py
```

Requiere `DTUNNEL_ADMIN_PATH_PUBLIC` en `secretos/.env.dtunnel`.

## SSL (Hestia)

Si el certificado no está emitido:

```bash
python deploy/fix-admin-ssl.py
```

O en el panel: **Web → dtunnel-admin.desarrollado.com → SSL + Let's Encrypt**.
