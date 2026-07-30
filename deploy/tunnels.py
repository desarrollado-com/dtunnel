#!/usr/bin/env python3
"""Operaciones de túneles en producción: listar y purgar huérfanos anónimos."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parent.parent
SECRETS = ROOT.parent.parent / "secretos" / ".env.dtunnel"


def load_cfg() -> dict[str, str]:
    return dict(
        line.strip().split("=", 1)
        for line in SECRETS.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#") and "=" in line
    )


def connect(cfg: dict[str, str]) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        cfg["SERVER_IP"],
        username=cfg.get("ROOT_USER", "root"),
        password=cfg["ROOT_PASSWORD"],
        timeout=30,
    )
    return client


def docker_node(client: paramiko.SSHClient, js: str) -> tuple[int, str, str]:
    cmd = f'docker exec dtunnel_api node --input-type=module -e "{js}"'
    _, stdout, stderr = client.exec_command(cmd, timeout=60)
    code = stdout.channel.recv_exit_status()
    return code, stdout.read().decode(), stderr.read().decode()


def cmd_list(_: argparse.Namespace) -> int:
    cfg = load_cfg()
    client = connect(cfg)
    code, out, err = docker_node(
        client,
        "import db from './src/db.js'; "
        "console.log(JSON.stringify(db.prepare("
        "'SELECT id,subdomain,port,user_id,client_ip,last_heartbeat,created_at FROM active_tunnels ORDER BY id'"
        ").all()));",
    )
    client.close()
    if code != 0:
        print(err or out, file=sys.stderr)
        return code
    rows = json.loads(out.strip() or "[]")
    if not rows:
        print("Sin túneles activos en la base de datos.")
        return 0
    for row in rows:
        owner = f"user:{row['user_id']}" if row["user_id"] is not None else "anon"
        ip = row.get("client_ip") or "—"
        hb = row.get("last_heartbeat") or "—"
        print(f"{row['id']:>3}  {row['subdomain']:<16}  port {row['port']:<5}  {owner}  {ip}  hb:{hb}")
    print(f"\nTotal: {len(rows)}")
    return 0


def cmd_purge_anon(_: argparse.Namespace) -> int:
    cfg = load_cfg()
    client = connect(cfg)
    code, out, err = docker_node(
        client,
        "import db from './src/db.js'; "
        "const r=db.prepare('DELETE FROM active_tunnels WHERE user_id IS NULL').run(); "
        "console.log(JSON.stringify({ deleted: r.changes }));",
    )
    client.close()
    if code != 0:
        print(err or out, file=sys.stderr)
        return code
    data = json.loads(out.strip() or "{}")
    print(f"Eliminados: {data.get('deleted', 0)} túnel(es) anónimo(s)")
    return 0


def cmd_purge_stale(_: argparse.Namespace) -> int:
    cfg = load_cfg()
    client = connect(cfg)
    code, out, err = docker_node(
        client,
        "import { cleanupStaleTunnels } from './src/db.js'; "
        "console.log(JSON.stringify({ removed: cleanupStaleTunnels(10, 24) }));",
    )
    client.close()
    if code != 0:
        print(err or out, file=sys.stderr)
        return code
    data = json.loads(out.strip() or "{}")
    print(f"Eliminados: {data.get('removed', 0)} túnel(es) obsoletos")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Operaciones de túneles en producción")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="Listar túneles activos en SQLite").set_defaults(func=cmd_list)
    sub.add_parser("purge-anon", help="Eliminar túneles anónimos huérfanos").set_defaults(func=cmd_purge_anon)
    sub.add_parser("purge-stale", help="Eliminar túneles sin heartbeat o muy antiguos").set_defaults(func=cmd_purge_stale)
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
