(function () {
  const version = '1.0.7';
  const cliVersion = '1.0.6';
  document.querySelectorAll('[data-site-footer]').forEach((el) => {
    el.innerHTML = `
      <p>dtunnel v${version} (CLI ${cliVersion}) ·
        <a href="https://github.com/desarrollado-com/dtunnel" target="_blank" rel="noopener">GitHub</a> ·
        <a href="/changelog.html">Changelog</a> ·
        <a href="/status.html">Estado</a> ·
        <a href="/terminos.html">Términos</a> ·
        <a href="/privacidad.html">Privacidad</a> ·
        <a href="/uso-aceptable.html">Uso aceptable</a>
      </p>`;
  });
})();
