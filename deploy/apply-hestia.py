#!/usr/bin/env python3
"""Aplica plantillas Hestia y reconstruye solo dtunnel.desarrollado.com (seguro)."""
from __future__ import annotations

import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parent.parent
SECRETS = ROOT.parent.parent / "secretos" / ".env.dtunnel"
HB = "/usr/local/hestia/bin"


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip()
    return env


def run(cl: paramiko.SSHClient, cmd: str, check: bool = True) -> int:
    print(f"  $ {cmd}")
    _, stdout, stderr = cl.exec_command(cmd, timeout=120)
    code = stdout.channel.recv_exit_status()
    out, err = stdout.read().decode(), stderr.read().decode()
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print(err.rstrip(), file=sys.stderr)
    if check and code != 0:
        raise RuntimeError(f"Fallo ({code}): {cmd}")
    return code


def upload_text(cl: paramiko.SSHClient, remote: str, content: str) -> None:
    import base64
    b64 = base64.b64encode(content.encode()).decode()
    run(cl, f"echo '{b64}' | base64 -d > {remote}")


def main() -> int:
    cfg = load_env(SECRETS)
    domain = cfg.get("DTUNNEL_DOMAIN", "dtunnel.desarrollado.com")
    user = cfg["DTUNNEL_USER"]

    cl = paramiko.SSHClient()
    cl.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cl.connect(cfg["SERVER_IP"], username=cfg["ROOT_USER"], password=cfg["ROOT_PASSWORD"])

    print("==> Subir plantillas dtunnel (sin connection_upgrade)")
    for name in ("dtunnel.stpl", "dtunnel.tpl"):
        content = (ROOT / "server" / "hestia" / name).read_text(encoding="utf-8")
        upload_text(cl, f"/usr/local/hestia/data/templates/web/nginx/{name}", content)

    print("==> nginx -t antes (debe OK)")
    if run(cl, "nginx -t", check=False) != 0:
        print("ADVERTENCIA: nginx ya fallaba antes de tocar dtunnel")

    print("==> Asignar plantilla solo a dtunnel")
    run(cl, f"{HB}/v-change-web-domain-proxy-tpl {user} {domain} dtunnel")

    print("==> nginx -t despues")
    if run(cl, "nginx -t", check=False) != 0:
        print("REVERTIR a default")
        run(cl, f"{HB}/v-change-web-domain-proxy-tpl {user} {domain} default")
        run(cl, f"{HB}/v-rebuild-web-domain {user} {domain}")
        run(cl, "nginx -t")
        cl.close()
        return 1

    print("==> reload nginx")
    run(cl, "systemctl reload nginx")
    cl.close()
    print("OK — plantilla dtunnel aplicada sin afectar otros dominios")
    return 0


if __name__ == "__main__":
    sys.exit(main())
