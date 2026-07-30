/**
 * Descarga frpc a ~/.dtunnel/bin/ (misma versión que el instalador curl).
 */
import { createWriteStream, existsSync, mkdirSync, chmodSync, copyFileSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import https from 'https';
import http from 'http';

export const FRP_VERSION = process.env.FRP_VERSION || '0.61.1';

const CONFIG_DIR = join(homedir(), '.dtunnel');
const BIN_DIR = join(CONFIG_DIR, 'bin');
const IS_WIN = process.platform === 'win32';
const LOCAL_FRPC = join(BIN_DIR, IS_WIN ? 'frpc.exe' : 'frpc');

function detectPlatform() {
  const archMap = { x64: 'amd64', arm64: 'arm64', ia32: '386', arm: 'arm' };
  const arch = archMap[process.arch];
  if (!arch) throw new Error(`Arquitectura no soportada: ${process.arch}`);

  if (process.platform === 'linux') return { os: 'linux', arch, ext: 'tar.gz' };
  if (process.platform === 'darwin') return { os: 'darwin', arch, ext: 'tar.gz' };
  if (process.platform === 'win32') return { os: 'windows', arch, ext: 'zip' };
  throw new Error(`Sistema no soportado: ${process.platform}. Usa el instalador curl en Linux/macOS/WSL.`);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const go = (currentUrl) => {
      const lib = currentUrl.startsWith('https') ? https : http;
      lib.get(currentUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          go(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Descarga fallida: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      }).on('error', reject);
    };
    go(url);
  });
}

function extractZip(archive, workDir, archiveBase) {
  const tmp = join(workDir, 'extract');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  if (process.platform === 'win32') {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${archive.replace(/'/g, "''")}' -DestinationPath '${tmp.replace(/'/g, "''")}' -Force"`,
      { stdio: 'ignore' },
    );
  } else {
    execSync(`unzip -qo "${archive}" -d "${tmp}"`, { stdio: 'ignore' });
  }
  const src = join(tmp, archiveBase, IS_WIN ? 'frpc.exe' : 'frpc');
  if (!existsSync(src)) throw new Error('frpc no encontrado en el archivo');
  copyFileSync(src, LOCAL_FRPC);
}

export function findFrpcBinary() {
  if (existsSync(LOCAL_FRPC)) return LOCAL_FRPC;
  try {
    const cmd = IS_WIN ? 'where frpc' : 'which frpc';
    const p = execSync(cmd, { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    return p || null;
  } catch {
    return null;
  }
}

export async function ensureFrpcBinary({ quiet = false } = {}) {
  const existing = findFrpcBinary();
  if (existing) return existing;

  const { os, arch, ext } = detectPlatform();
  const archiveBase = `frp_${FRP_VERSION}_${os}_${arch}`;
  const url = `https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${archiveBase}.${ext}`;

  if (!quiet) {
    console.error(`==> Descargando frpc ${FRP_VERSION} (${os}_${arch})…`);
  }

  mkdirSync(BIN_DIR, { recursive: true });
  const workDir = join(CONFIG_DIR, '.frpc-download');
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const archivePath = join(workDir, `frp.${ext}`);
  await download(url, archivePath);

  if (ext === 'tar.gz') {
    const memberPath = `${archiveBase}/${IS_WIN ? 'frpc.exe' : 'frpc'}`;
    const extracted = join(workDir, memberPath);
    execSync(`tar -xzf "${archivePath}" -C "${workDir}" "${memberPath}"`, { stdio: 'ignore' });
    copyFileSync(extracted, LOCAL_FRPC);
  } else {
    extractZip(archivePath, workDir, archiveBase);
  }

  if (!IS_WIN) chmodSync(LOCAL_FRPC, 0o755);
  rmSync(workDir, { recursive: true, force: true });

  if (!quiet) {
    console.error(`==> frpc instalado en ${LOCAL_FRPC}`);
  }
  return LOCAL_FRPC;
}
