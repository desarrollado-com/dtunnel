#!/usr/bin/env python3
import json
import paramiko
from pathlib import Path

SECRETS = Path(__file__).resolve().parent.parent.parent.parent / "secretos" / ".env.dtunnel"

def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip()
    return env

cfg = load_env(SECRETS)
user = cfg["DTUNNEL_USER"]
hb = "/usr/local/hestia/bin"
domain = "dtunnel-admin.desarrollado.com"

cl = paramiko.SSHClient()
cl.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cl.connect(cfg["SERVER_IP"], username=cfg["ROOT_USER"], password=cfg["ROOT_PASSWORD"], timeout=30)

def run(cmd: str) -> tuple[int, str, str]:
    print(f"==> {cmd}")
    _, stdout, stderr = cl.exec_command(cmd, timeout=120)
    code = stdout.channel.recv_exit_status()
    return code, stdout.read().decode(), stderr.read().decode()

code, out, err = run(f"{hb}/v-list-web-domains {user} json")
print(out[:2000])
if err:
    print(err)

code, out, err = run(f"{hb}/v-list-web-domain-ssl {user} {domain} json")
print(out or err)

ssl_data = json.loads(out) if out.strip().startswith("{") else {}
entry = ssl_data.get(domain, {})
if not entry.get("CRT"):
    print("SSL vacío — habilitando Let's Encrypt...")
    for cmd in [
        f"{hb}/v-add-letsencrypt-domain {user} {domain}",
        f"{hb}/v-rebuild-web-domain {user} {domain}",
        "nginx -t && systemctl reload nginx",
    ]:
        c, o, e = run(cmd)
        print(o or e)
        if c != 0:
            print(f"exit {c}")

cl.close()
