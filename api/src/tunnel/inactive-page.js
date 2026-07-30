/**
 * Página HTML para subdominios sin túnel activo (visitantes en el navegador).
 */
export function renderInactiveTunnelPage({ subdomain, domain, status, mainSite }) {
  const host = `${subdomain}.${domain}`;
  const titles = {
    offline: 'Túnel desconectado',
    reserved: 'Subdominio reservado',
    available: 'Subdominio disponible',
  };
  const title = titles[status] || 'Túnel no activo';

  const messages = {
    offline: `El subdominio <strong>${host}</strong> está registrado pero nadie está ejecutando el túnel en este momento. Si eres el dueño, abre tu terminal y ejecuta <code>dtunnel --port PUERTO -s ${subdomain}</code>.`,
    reserved: `El nombre <strong>${host}</strong> está reservado en una cuenta, pero el túnel no está activo ahora. Si es tuyo, inicia sesión y ejecuta <code>dtunnel --port PUERTO -s ${subdomain}</code>.`,
    available: `El subdominio <strong>${host}</strong> no tiene un túnel activo. Puedes <strong>reservarlo</strong> en tu cuenta o <strong>usarlo ahora</strong> con el CLI.`,
  };
  const message = messages[status] || messages.available;

  const cta = status === 'available'
    ? `<div class="actions">
        <a class="btn primary" href="${mainSite}/register.html">Crear cuenta y reservar</a>
        <a class="btn" href="${mainSite}/docs.html#inicio-rapido">Cómo abrir un túnel</a>
      </div>
      <p class="hint">Con cuenta: <code>dtunnel reserve ${subdomain}</code> y luego <code>dtunnel --port 88080 -s ${subdomain}</code></p>
      <p class="hint">Sin cuenta: <code>dtunnel --port 88080</code> (subdominio aleatorio)</p>`
    : `<div class="actions">
        <a class="btn primary" href="${mainSite}/login.html">Iniciar sesión</a>
        <a class="btn" href="${mainSite}/dashboard.html">Mi panel</a>
        <a class="btn" href="${mainSite}/docs.html">Documentación</a>
      </div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — ${host}</title>
  <style>
    :root { color-scheme: light dark; --bg: #121318; --card: #1e1f25; --text: #e3e2e9; --muted: #c4c6d0; --primary: #b6c4ff; --border: #44474f; }
    @media (prefers-color-scheme: light) {
      :root { --bg: #fbf8ff; --card: #fff; --text: #1a1b20; --muted: #44474f; --primary: #3c5ba9; --border: #c4c6d0; }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; display: grid; place-items: center; padding: 1.5rem; }
    .card { max-width: 520px; width: 100%; background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 2rem; box-shadow: 0 8px 32px rgba(0,0,0,.2); }
    .logo { font-size: .85rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin-bottom: .5rem; }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: .75rem; }
    .host { font-family: ui-monospace, monospace; font-size: .95rem; color: var(--primary); word-break: break-all; margin-bottom: 1rem; }
    p { line-height: 1.55; color: var(--muted); margin-bottom: 1rem; }
    code { background: color-mix(in srgb, var(--primary) 12%, transparent); padding: .15rem .35rem; border-radius: 4px; font-size: .85em; }
    .actions { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1.25rem 0; }
    .btn { display: inline-block; padding: .55rem 1rem; border-radius: 999px; text-decoration: none; font-size: .9rem; border: 1px solid var(--border); color: var(--text); }
    .btn.primary { background: var(--primary); color: #0f1118; border-color: transparent; font-weight: 600; }
    .hint { font-size: .85rem; }
    .status { display: inline-block; font-size: .75rem; padding: .2rem .55rem; border-radius: 999px; background: color-mix(in srgb, var(--primary) 18%, transparent); color: var(--primary); margin-bottom: 1rem; }
  </style>
</head>
<body>
  <main class="card">
    <div class="logo">dtunnel</div>
    <span class="status">${title}</span>
    <h1>Este túnel no está activo</h1>
    <p class="host">${host}</p>
    <p>${message}</p>
    ${cta}
    <p class="hint"><a href="${mainSite}" style="color:var(--primary)">dtunnel.desarrollado.com</a></p>
  </main>
</body>
</html>`;
}

export function wantsHtmlPage(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const path = (req.url || '/').split('?')[0];
  if (path !== '/' && !path.startsWith('/?')) return false;
  const accept = req.headers.accept || '';
  if (accept.includes('text/html')) return true;
  if (!accept || accept === '*/*') return true;
  return false;
}
