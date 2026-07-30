#!/usr/bin/env python3
import paramiko
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
cfg = dict(
    line.strip().split("=", 1)
    for line in (ROOT.parent.parent / "secretos" / ".env.dtunnel").read_text().splitlines()
    if line.strip() and not line.startswith("#") and "=" in line
)
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(cfg["SERVER_IP"], username=cfg.get("ROOT_USER", "root"), password=cfg["ROOT_PASSWORD"], timeout=30)
_, o, e = c.exec_command(
    'docker exec dtunnel_api node --input-type=module -e "'
    'import db from \'./src/db.js\'; '
    'console.log(JSON.stringify(db.prepare(\'SELECT id,subdomain,port,user_id,created_at FROM active_tunnels\').all()));"'
)
print(o.read().decode())
print(e.read().decode(), file=__import__('sys').stderr)
c.close()
