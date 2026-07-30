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

## 2. Plantilla proxy Hestia → frp

El tráfico HTTPS debe llegar a **frps** en `127.0.0.1:18080` (no uses `8080`: Apache de Hestia ya lo ocupa).

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

## 3. Instalar frps en el VPS (SSH)

```bash
# Subir o clonar dtunnel/server en el servidor
cd /opt/dtunnel/server   # ajustar ruta
cp .env.example .env
nano .env                # FRPS_TOKEN largo y aleatorio
bash install.sh
docker ps | grep dtunnel_frps
docker logs dtunnel_frps
bash verify-vps.sh
```

## 4. Firewall

| Puerto | Protocolo | Uso |
|--------|-----------|-----|
| 80, 443 | TCP | Hestia (ya abierto) |
| 7000 | TCP | frp — clientes `frpc` desde internet |

**No** exponer `18080` públicamente (solo localhost; Nginx hace de edge).

## 5. Probar el túnel (tu PC / WSL)

Terminal 1 — servidor de prueba local:

```bash
python3 -m http.server 8080
```

Terminal 2 — cliente dtunnel:

```bash
cd dtunnel/client
export DTUNNEL_SERVER=dtunnel.desarrollado.com
export DTUNNEL_TOKEN=<mismo FRPS_TOKEN del .env del servidor>
./dtunnel.sh up hola 8080
curl -I https://hola.dtunnel.desarrollado.com
```

Debe responder **200** (o el código de tu app).

## 6. Verificación automática (VPS)

Desde `server/` en el servidor:

```bash
bash verify-vps.sh
# opcional:
bash verify-vps.sh --domain dtunnel.desarrollado.com --user desarrollado
```

El script comprueba: `.env`, Docker/frps, puertos 7000/18080, plantillas Hestia, Nginx del dominio, DNS, HTTPS, firewall UFW.

## 7. Troubleshooting

| Síntoma | Causa probable |
|---------|----------------|
| 502 Bad Gateway | `frps` no corre o Nginx no hace proxy a `:18080` |
| Connection refused :7000 | Firewall o `frps` caído |
| 404 en subdominio | `frpc` no conectado o nombre distinto al subdominio |
| LE error 400 | Revisar que Alias sea `*.dtunnel.desarrollado.com` y zona DNS en Hestia |
| Admin: cert inválido | Falta `v-add-letsencrypt-domain` en `dtunnel-admin.desarrollado.com` |

Logs:

```bash
docker logs -f dtunnel_frps
tail -f /var/log/nginx/domains/dtunnel.desarrollado.com.error.log
```
