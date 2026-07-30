# Monitorización y mantenimiento

## Monitor externo (UptimeRobot u otro)

Configura alertas HTTP(S) sobre estos endpoints:

| Monitor | URL | Intervalo sugerido |
|---------|-----|-------------------|
| API health | `https://dtunnel.desarrollado.com/api/health` | 5 min |
| Página estado | `https://dtunnel.desarrollado.com/status.html` | 5 min |
| Admin login | `https://dtunnel-admin.desarrollado.com/login.html` | 15 min |

### UptimeRobot (gratis)

1. Crear cuenta en [uptimerobot.com](https://uptimerobot.com)
2. **Add New Monitor** → tipo **HTTP(s)**
3. URL: `https://dtunnel.desarrollado.com/api/health`
4. Intervalo: 5 minutos
5. Alertas: email o Telegram
6. Repetir para `/status.html` y el login del admin

La API responde:

```json
{ "ok": true, "service": "dtunnel-api", "version": "1.0.7" }
```

`GET /api/status` devuelve más detalle (túneles activos, usuarios) para dashboards internos.

## Purga de túneles huérfanos

Los túneles sin heartbeat se limpian automáticamente en la API (10 min sin ping, o 24 h de antigüedad). Para forzar limpieza manual:

```bash
python deploy/tunnels.py list
python deploy/tunnels.py purge-anon
```

### Cron en el VPS (opcional)

Cada hora, purgar túneles anónimos huérfanos:

```bash
# Como root, crontab -e
0 * * * * cd /opt/dtunnel && python3 deploy/tunnels.py purge-anon >> /var/log/dtunnel-purge.log 2>&1
```

> El script `tunnels.py` se ejecuta vía SSH desde tu PC por defecto. Para cron en el VPS, copia el script o usa `docker exec` contra la API (ver `deploy/tunnels.py`).

Alternativa directa en el servidor:

```bash
docker exec dtunnel_api node --input-type=module -e "
import { purgeStaleTunnels } from './src/db.js';
console.log(JSON.stringify(purgeStaleTunnels()));
"
```

## Logs útiles

```bash
docker logs -f dtunnel_api          # API Node
docker logs -f dtunnel_frps         # Broker frp
tail -f /var/log/nginx/domains/dtunnel.desarrollado.com.error.log
```

## SSL

Renovación automática con Let's Encrypt (Hestia). Si el admin falla TLS:

```bash
python deploy/fix-admin-ssl.py
```

Ver también [hestia.md](hestia.md).
