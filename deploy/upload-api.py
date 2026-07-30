#!/usr/bin/env python3
"""Despliega solo la API (rebuild Docker)."""
from __future__ import annotations

import secrets
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parent.parent
SECRETS = ROOT.parent.parent / "secretos" / ".env.dtunnel"
REMOTE_OPT = "/opt/dtunnel/api"
DOMAIN = "dtunnel.desarrollado.com"


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip()
    return env


def build_api_env(cfg: dict[str, str], jwt_secret: str) -> str:
    domain = cfg.get("DTUNNEL_DOMAIN", DOMAIN)
    token = cfg["DTUNNEL_TOKEN"]
    admin_emails = cfg.get("ADMIN_EMAILS", "")
    app_url = f"https://{domain}"
    cors = f"https://{domain},https://dtunnel-admin.desarrollado.com"
    lines = [
        "PORT=3001",
        f"JWT_SECRET={jwt_secret}",
        f"FRPS_TOKEN={token}",
        f"FRPS_SERVER={domain}",
        "FRPS_PORT=7000",
        f"DOMAIN={domain}",
        "ANON_TUNNEL_LIMIT=1",
        "HEARTBEAT_TIMEOUT_MIN=10",
        "STALE_TUNNEL_HOURS=24",
        "USER_TUNNEL_LIMIT=5",
        f"ADMIN_EMAILS={admin_emails}",
        f"APP_URL={app_url}",
        f"CORS_ORIGINS={cors}",
        "API_VERSION=1.0.9",
    ]
    for key in ("SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM_NAME"):
        if cfg.get(key):
            lines.append(f"{key}={cfg[key]}")
    smtp_from_email = cfg.get("SMTP_FROM_EMAIL") or cfg.get("SMTP_FROM")
    if smtp_from_email:
        lines.append(f"SMTP_FROM_EMAIL={smtp_from_email}")
    if cfg.get("SMTP_FROM"):
        lines.append(f"SMTP_FROM={cfg['SMTP_FROM']}")
    return "\n".join(lines) + "\n"


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 600) -> str:
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
    return out


def read_remote_jwt(client: paramiko.SSHClient) -> str | None:
    _, stdout, _ = client.exec_command(
        f"grep -E '^JWT_SECRET=' {REMOTE_OPT}/.env 2>/dev/null | head -1",
        timeout=30,
    )
    stdout.channel.recv_exit_status()
    line = stdout.read().decode().strip()
    if line.startswith("JWT_SECRET="):
        return line.partition("=")[2]
    return None


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


def upload_text(client: paramiko.SSHClient, remote_path: str, content: str) -> None:
    import base64
    b64 = base64.b64encode(content.encode()).decode()
    run(client, f"echo '{b64}' | base64 -d > {remote_path}")


def main() -> int:
    cfg = load_env(SECRETS)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(cfg["SERVER_IP"], username=cfg.get("ROOT_USER", "root"), password=cfg["ROOT_PASSWORD"], timeout=30)
    jwt_secret = cfg.get("JWT_SECRET") or read_remote_jwt(client) or secrets.token_hex(32)
    api_env = build_api_env(cfg, jwt_secret)
    upload_api(client)
    upload_text(client, f"{REMOTE_OPT}/.env", api_env)
    run(client, f"cd {REMOTE_OPT} && docker compose build && docker compose up -d")
    import time
    time.sleep(4)
    run(client, "curl -fsS http://127.0.0.1:3001/health")
    client.close()
    print("OK — API desplegada")
    return 0


if __name__ == "__main__":
    sys.exit(main())
