#!/usr/bin/env python3
import paramiko
from pathlib import Path

SECRETS = Path(__file__).resolve().parent.parent.parent.parent / "secretos" / ".env.dtunnel"
cfg = dict(
    line.strip().split("=", 1)
    for line in SECRETS.read_text().splitlines()
    if line.strip() and not line.startswith("#") and "=" in line
)
cl = paramiko.SSHClient()
cl.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cl.connect(cfg["SERVER_IP"], username=cfg["ROOT_USER"], password=cfg["ROOT_PASSWORD"], timeout=30)
for cmd in [
    "docker logs dtunnel_api --tail 50 2>&1",
    "ss -tlnp | grep 18080 || true",
    "ss -tlnp | grep 3001 || true",
    "docker ps -a | grep dtunnel",
]:
    print("==>", cmd)
    _, o, _ = cl.exec_command(cmd, timeout=30)
    o.channel.recv_exit_status()
    print(o.read().decode())
cl.close()
