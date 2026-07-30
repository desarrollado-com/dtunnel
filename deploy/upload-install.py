#!/usr/bin/env python3
"""Publica install/dtunnel/ para curl (install.desarrollado.com o espejo en dtunnel)."""
from __future__ import annotations

import shutil
import sys
import tarfile
from io import BytesIO
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parent.parent
SECRETS = ROOT.parent.parent / "secretos" / ".env.dtunnel"
INSTALL_SRC = ROOT / "install" / "dtunnel"


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip()
    return env


def upload_tree(cl: paramiko.SSHClient, local_dir: Path, remote_dir: str) -> None:
    buf = BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for f in local_dir.iterdir():
            if f.is_file():
                tar.add(f, arcname=f.name)
    cl.exec_command(f"mkdir -p {remote_dir}")[1].channel.recv_exit_status()
    stdin, stdout, stderr = cl.exec_command(f"tar -xzf - -C {remote_dir}")
    stdin.write(buf.getvalue())
    stdin.channel.shutdown_write()
    code = stdout.channel.recv_exit_status()
    if code != 0:
        raise RuntimeError(stderr.read().decode())


def sync_cli_script() -> None:
    src = ROOT / "client" / "dtunnel.sh"
    dst = INSTALL_SRC / "dtunnel"
    if not dst.exists() or src.read_text(encoding="utf-8") != dst.read_text(encoding="utf-8"):
        shutil.copy2(src, dst)
        print(f"==> Sincronizado {src.name} -> install/dtunnel/dtunnel")


def main() -> int:
    sync_cli_script()
    cfg = load_env(SECRETS)
    cl = paramiko.SSHClient()
    cl.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cl.connect(cfg["SERVER_IP"], username=cfg["ROOT_USER"], password=cfg["ROOT_PASSWORD"], timeout=30)

    targets = []

    install_path = cfg.get("DTUNNEL_INSTALL_PATH")
    if install_path:
        targets.append(f"{install_path}/dtunnel")

    # Espejo en dtunnel.desarrollado.com (siempre)
    public = cfg.get("DTUNNEL_PATH_PUBLIC", "")
    if public:
        targets.append(f"{public}/install/dtunnel")

    if not targets:
        print("ERROR: define DTUNNEL_PATH_PUBLIC o DTUNNEL_INSTALL_PATH en secretos/.env.dtunnel", file=sys.stderr)
        return 1

    for remote in dict.fromkeys(targets):
        print(f"==> Subiendo a {remote}")
        upload_tree(cl, INSTALL_SRC, remote)
        user = cfg.get("DTUNNEL_USER", "desarrollado")
        cl.exec_command(
            f"chmod 755 {remote}/install {remote}/dtunnel 2>/dev/null; "
            f"chown -R {user}:{user} {remote} 2>/dev/null || true"
        )[1].channel.recv_exit_status()

    cl.close()
    print("")
    print("URLs del instalador:")
    print("  https://install.desarrollado.com/dtunnel/install  (si DNS apunta al VPS)")
    print("  https://dtunnel.desarrollado.com/install/dtunnel/install  (espejo)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
