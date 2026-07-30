# dtunnel

CLI para exponer un servidor local como URL pública `https://*.dtunnel.desarrollado.com`.

**Versión actual:** `1.0.3`

- **npm:** [@desarrollado/dtunnel](https://www.npmjs.com/package/@desarrollado/dtunnel)
- **Código:** [github.com/desarrollado-com/dtunnel](https://github.com/desarrollado-com/dtunnel)

## Instalación

### Linux / macOS / WSL (recomendado)

```bash
curl -O https://install.desarrollado.com/dtunnel/install && sudo bash install
dtunnel version
```

### Node.js (desarrolladores / Windows sin WSL)

```bash
npm install -g @desarrollado/dtunnel
dtunnel version
```

Requiere Node.js 16+. `frpc` se descarga automáticamente al primer túnel (o con `dtunnel install-frpc`) en `~/.dtunnel/bin/`.

## Actualizar

```bash
# curl
curl -O https://install.desarrollado.com/dtunnel/install && sudo bash install

# npm
npm install -g @desarrollado/dtunnel@latest
```

## Uso

```bash
dtunnel --port 88080
dtunnel status
dtunnel --list up
dtunnel down
```

Ver [documentación](https://dtunnel.desarrollado.com/docs.html) · [changelog](https://dtunnel.desarrollado.com/changelog.html).
