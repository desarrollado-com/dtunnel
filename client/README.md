# dtunnel

CLI para exponer un servidor local como URL pública `https://*.dtunnel.desarrollado.com`.

## Instalación

### Linux / macOS / WSL (recomendado)

Instala `frpc` y el CLI automáticamente:

```bash
curl -fsSL https://install.desarrollado.com/dtunnel/install | sudo bash
```

Auditar el script antes de ejecutar:

```bash
curl -fsSL https://install.desarrollado.com/dtunnel/install
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
