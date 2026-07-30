/**
 * Renderiza diagramas Mermaid con tema claro/oscuro.
 */
(function () {
  let mermaidApi = null;
  let loading = null;

  async function loadMermaid() {
    if (mermaidApi) return mermaidApi;
    if (!loading) {
      loading = import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')
        .then((mod) => {
          mermaidApi = mod.default;
          return mermaidApi;
        });
    }
    return loading;
  }

  function backupSources() {
    document.querySelectorAll('pre.mermaid').forEach((el) => {
      if (!el.dataset.mermaidSource) {
        el.dataset.mermaidSource = el.textContent.trim();
      }
    });
  }

  function restoreSources() {
    document.querySelectorAll('pre.mermaid').forEach((el) => {
      if (el.dataset.mermaidSource) {
        el.textContent = el.dataset.mermaidSource;
        el.removeAttribute('data-processed');
        el.removeAttribute('id');
      }
    });
  }

  async function renderMermaid() {
    const nodes = document.querySelectorAll('pre.mermaid');
    if (!nodes.length) return;

    backupSources();
    const mermaid = await loadMermaid();
    const isLight = document.documentElement.dataset.theme === 'light';

    mermaid.initialize({
      startOnLoad: false,
      theme: isLight ? 'default' : 'dark',
      securityLevel: 'loose',
      fontFamily: 'Roboto, system-ui, sans-serif',
      flowchart: { curve: 'basis', padding: 20, htmlLabels: true },
      sequence: { actorMargin: 60, messageMargin: 40 },
    });

    restoreSources();
    await mermaid.run({ querySelector: 'pre.mermaid' });
  }

  window.dtunnelRenderMermaid = renderMermaid;

  function boot() {
    renderMermaid().catch((err) => console.warn('Mermaid:', err));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  document.addEventListener('dtunnel-theme-change', () => {
    renderMermaid().catch((err) => console.warn('Mermaid:', err));
  });
})();
