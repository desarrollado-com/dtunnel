/**
 * Aplica tema guardado antes del paint (evita flash).
 */
(function () {
  const KEY = 'dtunnel-theme';
  function apply(theme) {
    document.documentElement.dataset.theme = theme;
  }
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') {
      apply(saved);
      return;
    }
  } catch { /* ignore */ }
  apply('dark');
})();
