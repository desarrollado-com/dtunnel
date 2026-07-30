#!/usr/bin/env python3
"""Libera túneles anónimos huérfanos en producción (emergencia)."""
from __future__ import annotations

import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parent.parent
SECRETS = ROOT.parent.parent / "secretos" / ".env.dtunnel"


def main() -> int:
    cfg = dict(
        line.strip().split("=", 1)
        for line in SECRETS.read_text().splitlines()
        if line.strip() and not line.startswith("#") and "=" in line
    )
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(cfg["SERVER_IP"], username=cfg.get("ROOT_USER", "root"), password=cfg["ROOT_PASSWORD"], timeout=30)
    cmd = (
        "docker exec dtunnel_api node --input-type=module -e \""
        "import db from './src/db.js'; "
        "const r=db.prepare('DELETE FROM active_tunnels WHERE user_id IS NULL').run(); "
        "console.log('deleted', r.changes);\""
    )
    _, o, e = c.exec_command(cmd)
    print(o.read().decode() or e.read().decode())
    c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
