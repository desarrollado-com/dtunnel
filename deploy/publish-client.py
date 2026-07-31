#!/usr/bin/env python3
"""Publica @desarrollado/dtunnel en npm según VERSION en la raíz del repo."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLIENT = ROOT / "client"
VERSION_FILE = ROOT / "VERSION"
NPM_SECRETS = ROOT.parent.parent / "secretos" / ".env.npm"
NPM_CMD = "npm.cmd" if sys.platform == "win32" else "npm"


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.is_file():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip()
    return env


def main() -> int:
    if not VERSION_FILE.is_file():
        print(f"ERROR: No existe {VERSION_FILE}", file=sys.stderr)
        return 1
    version = VERSION_FILE.read_text(encoding="utf-8").strip()
    if not version:
        print("ERROR: VERSION vacío", file=sys.stderr)
        return 1

    pkg_path = CLIENT / "package.json"
    pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
    if pkg.get("version") != version:
        pkg["version"] = version
        pkg_path.write_text(json.dumps(pkg, indent=2) + "\n", encoding="utf-8")
        print(f"Sincronizado client/package.json → {version}")

    secrets = load_env(NPM_SECRETS)
    token = secrets.get("NPM_TOKEN") or os.environ.get("NPM_TOKEN")
    if not token:
        print("ERROR: Falta NPM_TOKEN en secretos/.env.npm o entorno", file=sys.stderr)
        return 1

    env = {**os.environ, "NPM_TOKEN": token}
    print(f"Publicando @desarrollado/dtunnel@{version}…")
    result = subprocess.run(
        [NPM_CMD, "publish", "--access", "public"],
        cwd=CLIENT,
        env=env,
        check=False,
    )
    if result.returncode != 0:
        return result.returncode
    print(f"OK — @desarrollado/dtunnel@{version} en npm")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
