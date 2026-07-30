# dtunnel

CLI para exponer un servidor local como URL pública `https://*.dtunnel.desarrollado.com`.

- **npm:** [@desarrollado/dtunnel](https://www.npmjs.com/package/@desarrollado/dtunnel)
- **Código:** [github.com/desarrollado-com/dtunnel](https://github.com/desarrollado-com/dtunnel)

## Instalación

### Linux / macOS / WSL (recomendado)

Instala `frpc` y el CLI automáticamente:

```bash
curl -O https://install.desarrollado.com/dtunnel/install && sudo bash install
```

Auditar el script antes de ejecutar:

```bash
curl https://install.desarrollado.com/dtunnel/install
```

### Node.js (desarrolladores / Windows sin WSL)

Requiere Node.js 16+. Instala también [frpc](https://github.com/fatedier/frp/releases) por separado.

```bash
npm install -g @desarrollado/dtunnel
```

## Uso

```bash
dtunnel --port 88080
dtunnel down
```

Ver [documentación](https://dtunnel.desarrollado.com/docs.html).
