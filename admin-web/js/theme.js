/**
 * FAB flotante: alternar tema claro / oscuro.
 */
(function () {
  const KEY = 'dtunnel-theme';

  function currentTheme() {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  }

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch { /* ignore */ }
    updateFab(theme);
    document.dispatchEvent(new CustomEvent('dtunnel-theme-change', { detail: { theme } }));
  }

  function updateFab(theme) {
    const icon = document.getElementById('theme-icon');
    const fab = document.getElementById('theme-toggle');
    if (!icon || !fab) return;
    const isDark = theme === 'dark';
    icon.textContent = isDark ? 'light_mode' : 'dark_mode';
    fab.setAttribute(
      'aria-label',
      isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro',
    );
    fab.setAttribute('title', isDark ? 'Tema claro' : 'Tema oscuro');
  }

  function bindFab(fab) {
    if (!fab || fab.dataset.themeBound === '1') return;
    fab.dataset.themeBound = '1';
    fab.addEventListener('click', () => {
      apply(currentTheme() === 'dark' ? 'light' : 'dark');
    });
  }

  function initThemeFab() {
    let fab = document.getElementById('theme-toggle');
    if (!fab) {
      fab = document.createElement('button');
      fab.type = 'button';
      fab.className = 'theme-fab';
      fab.id = 'theme-toggle';
      fab.innerHTML = '<span class="material-symbols-outlined" id="theme-icon">light_mode</span>';
      document.body.appendChild(fab);
    }
    bindFab(fab);
    updateFab(currentTheme());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initThemeFab);
  } else {
    initThemeFab();
  }
})();
