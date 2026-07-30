# Changelog

Todos los cambios notables de dtunnel se documentan en este archivo.

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versionado según [Semantic Versioning](https://semver.org/lang/es/).

## [1.0.3] - 2026-07-29

### Añadido

- Descarga automática de `frpc` a `~/.dtunnel/bin/` al abrir el primer túnel (CLI npm y bash).
- Comando `dtunnel install-frpc` para instalar o actualizar `frpc` manualmente.
- Módulo `client/bin/frpc-install.js` (detección de plataforma, Linux/macOS/Windows).
- Página web [`/changelog.html`](https://dtunnel.desarrollado.com/changelog.html) y este archivo de changelog.

### Cambiado

- Documentación actualizada: npm ya no requiere instalar `frpc` por separado.
- Panel admin: botones migrados a componentes Material Design 3.

### Web (desplegado en el mismo ciclo)

- Frontend migrado a [Material Design 3](https://m3.material.io/) (tokens, Roboto, Material Symbols, Material Web).

## [1.0.2] - 2026-07-21

### Añadido

- Comando `dtunnel version`.
- Comandos `dtunnel status` y `dtunnel --list up` (estado local + túneles de cuenta).
- Documentación de actualización del CLI en la web.

### Cambiado

- Paquete npm `@desarrollado/dtunnel` publicado como acceso público.

## [1.0.1] - 2026-07-21

### Añadido

- Primera publicación en npm: `@desarrollado/dtunnel`.
- Instalador curl universal (`install.desarrollado.com`).
- Panel superadmin (`/admin.html`): usuarios, planes, túneles activos, ajustes globales.
- API `/api/admin/*` con límites por plan y overrides por usuario.

## [1.0.0] - 2026-07-21

### Añadido

- Servicio self-hosted bajo `*.dtunnel.desarrollado.com`.
- Broker `frps` + API Node/SQLite en VPS.
- CLI: `dtunnel --port`, `login`, `register`, `reserve`, `down`.
- Landing y documentación en `web/`.

[1.0.3]: https://github.com/desarrollado-com/dtunnel/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/desarrollado-com/dtunnel/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/desarrollado-com/dtunnel/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/desarrollado-com/dtunnel/releases/tag/v1.0.0
