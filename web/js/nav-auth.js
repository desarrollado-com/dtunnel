/** Sustituye Registrarse/Iniciar sesión por Mi cuenta si hay token. */
(function () {
  const actions = document.querySelector('.nav-actions[data-auth-nav]');
  if (!actions) return;
  const token = localStorage.getItem('dtunnel_token');
  if (!token) return;
  actions.innerHTML = `
    <a href="/dashboard.html#/overview" class="btn btn-primary">Mi cuenta</a>
    <button type="button" class="btn btn-ghost" id="nav-logout-btn">Salir</button>
  `;
  document.getElementById('nav-logout-btn')?.addEventListener('click', () => {
    localStorage.removeItem('dtunnel_token');
    localStorage.removeItem('dtunnel_email');
    localStorage.removeItem('dtunnel_is_admin');
    window.location.reload();
  });
})();
