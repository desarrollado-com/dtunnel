#!/usr/bin/env python3
"""Publica @desarrollado/dtunnel en npm (usa secretos/.env.npm)."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SECRETS = ROOT.parent.parent / "secretos" / ".env.npm"
CLIENT = ROOT / "client"


def load_token() -> str:
    for line in SECRETS.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("NPM_TOKEN="):
            return line.partition("=")[2].strip()
    raise SystemExit(f"NPM_TOKEN no encontrado en {SECRETS}")


def main() -> int:
    token = load_token()
    print(f"==> npm publish desde {CLIENT}")
    npm = "npm.cmd" if os.name == "nt" else "npm"
    npmrc = CLIENT / ".npmrc.publish"
    npmrc.write_text(f"//registry.npmjs.org/:_authToken={token}\n", encoding="utf-8")
    try:
        subprocess.run(
            [npm, "publish", "--access", "public", f"--userconfig={npmrc}"],
            cwd=CLIENT,
            check=True,
        )
    finally:
        if npmrc.exists():
            npmrc.unlink()
    print("OK — publicado en npm")
    return 0


if __name__ == "__main__":
    sys.exit(main())
