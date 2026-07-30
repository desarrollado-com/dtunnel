#!/usr/bin/env python3
"""Sube web/ a public_html."""
from __future__ import annotations

import sys
import tarfile
from io import BytesIO
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parent.parent
SECRETS = ROOT.parent.parent / "secretos" / ".env.dtunnel"


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip()
    return env


def main() -> int:
    cfg = load_env(SECRETS)
    web = ROOT / "web"
    pub = cfg["DTUNNEL_PATH_PUBLIC"]
    user = cfg["DTUNNEL_USER"]

    buf = BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for f in web.rglob("*"):
            if f.is_file():
                tar.add(f, arcname=f.relative_to(web).as_posix())

    cl = paramiko.SSHClient()
    cl.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cl.connect(cfg["SERVER_IP"], username=cfg["ROOT_USER"], password=cfg["ROOT_PASSWORD"], timeout=30)
    cl.exec_command(f"mkdir -p {pub} && chown -R {user}:{user} {pub}")[1].channel.recv_exit_status()
    stdin, stdout, stderr = cl.exec_command(f"tar -xzf - -C {pub}")
    stdin.write(buf.getvalue())
    stdin.channel.shutdown_write()
    code = stdout.channel.recv_exit_status()
    if code != 0:
        print(stderr.read().decode(), file=sys.stderr)
        return 1
    cl.close()
    print(f"OK — web subida a {pub}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
