import paramiko
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SECRETS = ROOT.parent.parent / "secretos" / ".env.dtunnel"

cfg = {}
for line in SECRETS.read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    k, _, v = line.partition("=")
    cfg[k.strip()] = v.strip()

cl = paramiko.SSHClient()
cl.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cl.connect(cfg["SERVER_IP"], username=cfg["ROOT_USER"], password=cfg["ROOT_PASSWORD"])

install_sh = (ROOT / "server" / "install.sh").read_bytes()
compose = (ROOT / "server" / "docker-compose.yml").read_bytes()

stdin, stdout, stderr = cl.exec_command("cat > /opt/dtunnel/server/install.sh && chmod +x /opt/dtunnel/server/install.sh")
stdin.write(install_sh)
stdin.channel.shutdown_write()
stdout.channel.recv_exit_status()

stdin, stdout, stderr = cl.exec_command("cat > /opt/dtunnel/server/docker-compose.yml")
stdin.write(compose)
stdin.channel.shutdown_write()
stdout.channel.recv_exit_status()

_, o, e = cl.exec_command("cd /opt/dtunnel/server && bash install.sh && sleep 2 && docker ps && docker logs dtunnel_frps --tail 8")
o.channel.recv_exit_status()
print(o.read().decode())
print(e.read().decode())
cl.close()
