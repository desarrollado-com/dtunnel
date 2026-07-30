#!/usr/bin/env python3
"""Despliega solo la API (rebuild Docker)."""
from __future__ import annotations

import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parent.parent
SECRETS = ROOT.parent.parent / "secretos" / ".env.dtunnel"
REMOTE_OPT = "/opt/dtunnel/api"


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip()
    return env


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> None:
    print(f"==> {cmd}")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    code = stdout.channel.recv_exit_status()
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print(err.rstrip(), file=sys.stderr)
    if code != 0:
        raise RuntimeError(f"Falló ({code}): {cmd}")


def upload_api(client: paramiko.SSHClient) -> None:
    import tarfile
    from io import BytesIO

    buf = BytesIO()
    api_dir = ROOT / "api"
    excludes = {".env", "node_modules", "data", "test-tunnel-release.mjs"}
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for item in api_dir.rglob("*"):
            rel = item.relative_to(api_dir).as_posix()
            if any(rel.startswith(ex) or ex in rel for ex in excludes):
                continue
            if item.is_file():
                tar.add(item, arcname=rel)
    data = buf.getvalue()
    run(client, f"mkdir -p {REMOTE_OPT}")
    stdin, stdout, stderr = client.exec_command(f"tar -xzf - -C {REMOTE_OPT}", timeout=600)
    stdin.write(data)
    stdin.channel.shutdown_write()
    if stdout.channel.recv_exit_status() != 0:
        raise RuntimeError(stderr.read().decode() or "upload failed")


def main() -> int:
    cfg = load_env(SECRETS)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(cfg["SERVER_IP"], username=cfg.get("ROOT_USER", "root"), password=cfg["ROOT_PASSWORD"], timeout=30)
    upload_api(client)
    run(client, f"cd {REMOTE_OPT} && docker compose build && docker compose up -d")
    import time
    time.sleep(4)
    run(client, f"curl -fsS http://127.0.0.1:3001/health")
    client.close()
    print("OK — API desplegada")
    return 0


if __name__ == "__main__":
    sys.exit(main())
