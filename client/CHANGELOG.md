# Changelog — @desarrollado/dtunnel

Historial del paquete npm. Changelog completo del proyecto: [../CHANGELOG.md](../CHANGELOG.md).

## [1.0.4] - 2026-07-30

### Corregido

- `dtunnel down` libera el túnel en la API (evita límite fantasma).
- Auto-liberación de túneles locales huérfanos al abrir uno nuevo.

## [1.0.3] - 2026-07-29

### Añadido

- Auto-instalación de `frpc` en `~/.dtunnel/bin/` al primer túnel.
- Comando `dtunnel install-frpc`.
- Soporte Windows (descarga `.zip` de frp releases).

### Cambiado

- Ya no es necesario instalar `frpc` manualmente antes de usar el CLI.

## [1.0.2] - 2026-07-21

### Añadido

- `dtunnel version`, `dtunnel status`, `dtunnel --list up`.

## [1.0.1] - 2026-07-21

### Añadido

- Publicación inicial en npm.
