#!/usr/bin/env python3
"""Instala cron en el VPS para limpiar túneles obsoletos cada hora."""
from __future__ import annotations

import base64
import sys
from pathlib import Path

import paramiko

SECRETS = Path(__file__).resolve().parent.parent.parent.parent / "secretos" / ".env.dtunnel"
MARKER = "# dtunnel-purge"
CRON_LINE = (
    "0 * * * * docker exec dtunnel_api node --input-type=module -e "
    '"import { cleanupStaleTunnels } from \'./src/db.js\'; '
    "console.log(JSON.stringify({ removed: cleanupStaleTunnels(10, 24) }));\" "
    ">> /var/log/dtunnel-purge.log 2>&1"
)


def load_cfg() -> dict[str, str]:
    return dict(
        line.strip().split("=", 1)
        for line in SECRETS.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#") and "=" in line
    )


def main() -> int:
    cfg = load_cfg()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        cfg["SERVER_IP"],
        username=cfg.get("ROOT_USER", "root"),
        password=cfg["ROOT_PASSWORD"],
        timeout=30,
    )

    _, stdout, _ = client.exec_command("crontab -l 2>/dev/null || true", timeout=30)
    stdout.channel.recv_exit_status()
    existing = stdout.read().decode()

    if MARKER in existing:
        print("Cron de purga ya instalado.")
        client.close()
        return 0

    new_crontab = (existing.rstrip() + "\n\n" + MARKER + "\n" + CRON_LINE + "\n").lstrip()
    b64 = base64.b64encode(new_crontab.encode()).decode()
    _, stdout, stderr = client.exec_command(f"echo {b64} | base64 -d | crontab -", timeout=30)
    code = stdout.channel.recv_exit_status()
    err = stderr.read().decode()
    client.close()
    if code != 0:
        print(err or "Falló crontab", file=sys.stderr)
        return 1
    print("OK — cron instalado (purga horaria de túneles obsoletos)")
    print("  Log: /var/log/dtunnel-purge.log")
    return 0


if __name__ == "__main__":
    sys.exit(main())
