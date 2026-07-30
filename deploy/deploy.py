#!/usr/bin/env python3
"""Despliega dtunnel al VPS usando secretos/.env.dtunnel"""
from __future__ import annotations

import os
import secrets
import sys
import tarfile
import tempfile
from io import BytesIO
from pathlib import Path

import paramiko

SCRIPT_DIR = Path(__file__).resolve().parent
DTUNNEL_ROOT = SCRIPT_DIR.parent
SECRETS_FILE = DTUNNEL_ROOT.parent.parent / "secretos" / ".env.dtunnel"
REMOTE_OPT = "/opt/dtunnel"
DOMAIN = "dtunnel.desarrollado.com"


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, _, val = line.partition("=")
        env[key.strip()] = val.strip()
    return env


def ssh_connect(host: str, user: str, password: str) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username=user, password=password, timeout=30)
    return client


def run(client: paramiko.SSHClient, cmd: str, check: bool = True, timeout: int = 600) -> tuple[int, str, str]:
    print(f"  $ {cmd[:120]}{'...' if len(cmd) > 120 else ''}")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    code = stdout.channel.recv_exit_status()
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print(err.rstrip(), file=sys.stderr)
    if check and code != 0:
        raise RuntimeError(f"Comando falló ({code}): {cmd}")
    return code, out, err


def upload_tar(client: paramiko.SSHClient, local_root: Path, remote_dir: str, excludes: set[str]) -> None:
    buf = BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for item in local_root.rglob("*"):
            rel = item.relative_to(local_root).as_posix()
            if any(rel.startswith(ex) or ex in rel for ex in excludes):
                continue
            tar.add(item, arcname=rel)
    data = buf.getvalue()
    run(client, f"mkdir -p {remote_dir}")
    stdin, stdout, stderr = client.exec_command(f"tar -xzf - -C {remote_dir}", timeout=600)
    stdin.write(data)
    stdin.channel.shutdown_write()
    code = stdout.channel.recv_exit_status()
    if code != 0:
        raise RuntimeError(stderr.read().decode() or f"tar upload failed ({code})")


def upload_dir_as_tar(client: paramiko.SSHClient, local_dir: Path, remote_dir: str) -> None:
    buf = BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for item in local_dir.rglob("*"):
            if item.is_file():
                tar.add(item, arcname=item.relative_to(local_dir).as_posix())
    data = buf.getvalue()
    run(client, f"mkdir -p {remote_dir}")
    stdin, stdout, stderr = client.exec_command(f"tar -xzf - -C {remote_dir}", timeout=600)
    stdin.write(data)
    stdin.channel.shutdown_write()
    code = stdout.channel.recv_exit_status()
    if code != 0:
        raise RuntimeError(stderr.read().decode() or f"tar upload failed ({code})")


def upload_text(client: paramiko.SSHClient, remote_path: str, content: str) -> None:
    import base64
    b64 = base64.b64encode(content.encode()).decode()
    run(client, f"echo '{b64}' | base64 -d > {remote_path}")


def main() -> int:
    if not SECRETS_FILE.is_file():
        print(f"ERROR: No existe {SECRETS_FILE}", file=sys.stderr)
        return 1

    cfg = load_env(SECRETS_FILE)
    required = [
        "SERVER_IP", "ROOT_USER", "ROOT_PASSWORD",
        "DTUNNEL_USER", "DTUNNEL_PASSWORD", "DTUNNEL_TOKEN",
        "DTUNNEL_PATH_PUBLIC",
    ]
    for key in required:
        if not cfg.get(key):
            print(f"ERROR: Falta {key} en {SECRETS_FILE}", file=sys.stderr)
            return 1

    host = cfg["SERVER_IP"]
    root_user = cfg.get("ROOT_USER", "root")
    tunnel_user = cfg["DTUNNEL_USER"]
    public_path = cfg["DTUNNEL_PATH_PUBLIC"]
    port = cfg.get("DTUNNEL_PORT", "18080")
    token = cfg["DTUNNEL_TOKEN"]
    jwt_secret = cfg.get("JWT_SECRET") or secrets.token_hex(32)
    domain = cfg.get("DTUNNEL_DOMAIN", DOMAIN)

    server_env = f"FRPS_TOKEN={token}\nFRPS_VHOST_PORT={port}\nFRPS_BIND_PORT=7000\n"
    api_env = (
        f"PORT=3001\nJWT_SECRET={jwt_secret}\nFRPS_TOKEN={token}\n"
        f"FRPS_SERVER={domain}\nFRPS_PORT=7000\nDOMAIN={domain}\n"
        f"ANON_TUNNEL_LIMIT=1\nUSER_TUNNEL_LIMIT=5\n"
    )

    (DTUNNEL_ROOT / "server" / ".env").write_text(server_env, encoding="utf-8")

    print("==> Conectando como root")
    root = ssh_connect(host, root_user, cfg["ROOT_PASSWORD"])

    print("==> Docker (instalar si falta)")
    run(
        root,
        "command -v docker >/dev/null 2>&1 || (curl -fsSL https://get.docker.com | sh && systemctl enable --now docker)",
        timeout=900,
    )

    print("==> Subiendo server/ y api/")
    for sub in ("server", "api"):
        upload_tar(
            root,
            DTUNNEL_ROOT / sub,
            f"{REMOTE_OPT}/{sub}",
            {".env", "node_modules", "data", "frps.runtime.toml", "frps.runtime.json"},
        )

    print("==> Escribiendo .env remotos")
    upload_text(root, f"{REMOTE_OPT}/server/.env", server_env)
    upload_text(root, f"{REMOTE_OPT}/api/.env", api_env)

    print("==> Plantillas Hestia")
    for name in ("dtunnel.stpl", "dtunnel.tpl"):
        content = (DTUNNEL_ROOT / "server" / "hestia" / name).read_text(encoding="utf-8")
        upload_text(root, f"/usr/local/hestia/data/templates/web/nginx/{name}", content)

    print("==> Instalando frps")
    run(root, f"cd {REMOTE_OPT}/server && bash install.sh")

    print("==> Construyendo API")
    run(root, f"cd {REMOTE_OPT}/api && docker compose build && docker compose up -d")

    print("==> Reconstruyendo dominio Hestia (solo dtunnel)")
    hb = "/usr/local/hestia/bin"
    run(root, f"{hb}/v-change-web-domain-proxy-tpl {tunnel_user} {domain} dtunnel")
    run(root, f"{hb}/v-rebuild-web-domain {tunnel_user} {domain}")
    code, _, err = run(root, "nginx -t", check=False)
    if code != 0:
        print("ERROR: nginx -t falló — revirtiendo plantilla proxy a default", file=sys.stderr)
        run(root, f"{hb}/v-change-web-domain-proxy-tpl {tunnel_user} {domain} default")
        run(root, f"{hb}/v-rebuild-web-domain {tunnel_user} {domain}")
        raise RuntimeError(f"nginx -t falló; dominio revertido a default. Detalle: {err}")
    run(root, "systemctl reload nginx")

    print("==> Firewall 7000")
    run(root, "ufw allow 7000/tcp 2>/dev/null || true", check=False)

    print("==> Subiendo web/ a public_html")
    user_client = ssh_connect(host, tunnel_user, cfg["DTUNNEL_PASSWORD"])
    upload_dir_as_tar(user_client, DTUNNEL_ROOT / "web", public_path)
    user_client.close()

    print("==> Verificación")
    run(root, f"cd {REMOTE_OPT}/server && bash verify-vps.sh --domain {domain} --user {tunnel_user}", check=False)

    root.close()

    print("")
    print("Despliegue completado.")
    print(f"  Landing: https://{domain}")
    print(f"  API:     https://{domain}/api/health")
    print("  CLI:     cd client && npm link && dtunnel --port 88080")
    return 0


if __name__ == "__main__":
    sys.exit(main())
