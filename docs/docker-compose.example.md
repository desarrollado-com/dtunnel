# Ejemplo: dtunnel con app en Docker Compose

Cuando tu app corre como servicio Docker (`mi-proyecto:3000`) y no en `localhost`,
ejecuta `dtunnel` en la **misma red** o usa `--host` / `localHost`.

## Opción A — dtunnel en el host (puerto publicado)

Si mapeas el puerto al host (`3000:3000`), basta con:

```bash
dtunnel --port 3000
```

## Opción B — dtunnel dentro de Compose (misma red)

```yaml
services:
  mi-proyecto:
    image: node:22-alpine
    working_dir: /app
    command: npm run dev
    expose:
      - "3000"

  dtunnel:
    image: node:22-alpine
    depends_on:
      - mi-proyecto
    environment:
      DTUNNEL_LOCAL_HOST: mi-proyecto
    volumes:
      - dtunnel-config:/root/.dtunnel
    command: >
      sh -c "npm install -g @desarrollado/dtunnel@latest &&
             dtunnel login &&
             dtunnel --port 3000 --host mi-proyecto -s mi-api"
    # Alternativa sin login interactivo: monta config.json con token ya guardado

volumes:
  dtunnel-config:
```

Comprueba desde el contenedor `dtunnel`:

```bash
docker compose exec dtunnel wget -qO- http://mi-proyecto:3000
```

## Configuración persistente

En el host o en un volumen `~/.dtunnel/config.json`:

```json
{
  "localHost": "mi-proyecto",
  "token": "...",
  "email": "tu@email.com"
}
```

O en la shell:

```bash
dtunnel config set localHost mi-proyecto
export DTUNNEL_LOCAL_HOST=mi-proyecto
dtunnel --port 3000
```
