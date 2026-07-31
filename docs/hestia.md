# Despliegue en HestiaCP

## Hecho (checklist)

- [x] Dominio web: `dtunnel.desarrollado.com`
- [x] Dominio admin: `dtunnel-admin.desarrollado.com` (sitio estático, plantilla `default`)
- [x] Dominio instalador: `install.desarrollado.com`
- [x] Alias: `*.dtunnel.desarrollado.com` (FQDN completo — forma correcta en Hestia)
- [x] DNS zona con registro `*` → IP del VPS
- [x] SSL: **Utilizar Let's Encrypt para obtener un certificado SSL** (Hestia gestiona DNS-01 para el comodín)
- [x] SAN del cert principal: `dtunnel.desarrollado.com`, `*.dtunnel.desarrollado.com`
- [x] SSL admin: certificado Let's Encrypt propio en `dtunnel-admin.desarrollado.com`

> En Hestia **no** uses solo `*` en Alias (puede romper el vhost). Usa `*.dtunnel.desarrollado.com`.
> No hace falta una opción aparte "SSL wildcard": el checkbox estándar de Let's Encrypt basta si el alias wildcard está bien y la zona DNS es la de Hestia.

## 1. SSL (referencia)

### Dominio principal (`dtunnel.desarrollado.com`)

Si hay que reemitir el cert:

1. **Web → dtunnel.desarrollado.com → Editar**
2. Alias: `*.dtunnel.desarrollado.com`
3. SSL: marcar **Habilitar SSL** + **Utilizar Let's Encrypt para obtener un certificado SSL**
4. Guardar (Hestia renueva/reemite si cambian los alias)

### Subdominio admin (`dtunnel-admin.desarrollado.com`)

Dominio web independiente (no usa la plantilla proxy `dtunnel`). Document root:

`/home/desarrollado/web/dtunnel-admin.desarrollado.com/public_html`

Si el certificado está vacío o sirve el cert por defecto del servidor:

```bash
python deploy/fix-admin-ssl.py
```

O manualmente:

```bash
v-add-letsencrypt-domain desarrollado dtunnel-admin.desarrollado.com
v-rebuild-web-domain desarrollado dtunnel-admin.desarrollado.com
nginx -t && systemctl reload nginx
```

## 2. Plantilla proxy Hestia → gateway nativo

El tráfico HTTPS de `*.dtunnel.desarrollado.com` debe llegar al **gateway de la API** en `127.0.0.1:18080` (`TUNNEL_HTTP_PORT`). No uses `8080` (Apache de Hestia).

Plantillas en el repo: `server/hestia/dtunnel.stpl` y `server/hestia/dtunnel.tpl`.

### Instalar plantillas (SSH root)

```bash
cp /opt/dtunnel/server/hestia/dtunnel.stpl /usr/local/hestia/data/templates/web/nginx/
cp /opt/dtunnel/server/hestia/dtunnel.tpl  /usr/local/hestia/data/templates/web/nginx/
```

### Asignar en el panel

**Web → dtunnel.desarrollado.com → Editar → Opciones avanzadas:**

| Campo | Valor |
|-------|--------|
| Plantilla Web APACHE2 | `default` |
| Plantilla Backend PHP-FPM | `default` |
| **Plantilla Proxy** | **`dtunnel`** |

Guardar y reconstruir:

```bash
v-rebuild-web-domain desarrollado dtunnel.desarrollado.com
nginx -t && systemctl reload nginx
```

Referencia manual alternativa: `server/nginx-hestia-snippet.conf`.

## 3. API en el VPS

```bash
cd /opt/dtunnel/api
docker compose up -d
docker ps | grep dtunnel_api
curl -fsS http://127.0.0.1:3001/health
bash ../server/verify-vps.sh
```

## 4. Firewall

| Puerto | Protocolo | Uso |
|--------|-----------|-----|
| 80, 443 | TCP | Hestia (ya abierto) |

**No** exponer `18080` ni `3001` públicamente (solo localhost; Nginx hace de edge).

## 5. Probar el túnel (tu PC / WSL)

Terminal 1 — servidor de prueba local:

```bash
python3 -m http.server 8080
```

Terminal 2 — cliente dtunnel:

```bash
dtunnel --port 8080
curl -I https://<subdominio>.dtunnel.desarrollado.com
```

Debe responder **200** (o el código de tu app).

## 6. Verificación automática (VPS)

```bash
cd /opt/dtunnel/server && bash verify-vps.sh
```

Comprueba: API Docker, puerto gateway `:18080`, plantillas Hestia y Nginx.

## 7. Troubleshooting

| Síntoma | Causa probable |
|---------|----------------|
| 502 Bad Gateway | API caída o Nginx no hace proxy a `:18080` |
| 404 en subdominio | CLI desconectado o subdominio distinto |
| LE error 400 | Alias debe ser `*.dtunnel.desarrollado.com` |

Logs:

```bash
docker logs -f dtunnel_api
tail -f /var/log/nginx/domains/dtunnel.desarrollado.com.error.log
```
