import { TUNNEL_DOMAIN } from './config.js';

const STORAGE_KEY = 'dtunnel_workspace_project_v1';

const DEFAULT_PROJECT = {
  name: 'mi-proyecto-dtunnel',
  files: {
    'package.json': JSON.stringify({
      name: 'mi-proyecto-dtunnel',
      private: true,
      type: 'module',
      scripts: { start: 'node server.js', tunnel: 'dtunnel --port 3000' },
      dependencies: {},
    }, null, 2),
    'server.js': `import http from 'http';

const PORT = 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    message: 'Hola desde tu app local vía dtunnel',
    path: req.url,
    time: new Date().toISOString(),
  }));
});

server.listen(PORT, () => {
  console.log(\`Servidor en http://127.0.0.1:\${PORT}\`);
});
`,
    'README.md': `# Mi proyecto dtunnel

1. \`node server.js\` — servidor local
2. \`dtunnel --port 3000\` — URL pública en *.${TUNNEL_DOMAIN}

Edita server.js y vuelve a ejecutar.
`,
    'dtunnel.config.json': JSON.stringify({
      port: 3000,
      localHost: '127.0.0.1',
      subdomain: '',
    }, null, 2),
  },
};

let project = loadProject();
let activeFile = 'server.js';
let editor = null;
let monacoReady = null;

function loadProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return structuredClone(DEFAULT_PROJECT);
}

function saveProject() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
}

function languageForFile(name) {
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.md')) return 'markdown';
  if (name.endsWith('.html')) return 'html';
  return 'javascript';
}

function termPrint(text, cls = '') {
  const term = document.getElementById('ws-ide-terminal');
  if (!term) return;
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = text;
  term.appendChild(line);
  term.scrollTop = term.scrollHeight;
}

function simulateCommand(cmd) {
  const c = cmd.trim();
  termPrint(`$ ${c}`, 'in');
  if (!c) return;

  if (c === 'clear') {
    document.getElementById('ws-ide-terminal').innerHTML = '';
    return;
  }

  if (c.startsWith('node server.js') || c === 'npm start') {
    termPrint('Servidor en http://127.0.0.1:3000', 'out');
    termPrint('(simulado — en tu máquina ejecuta node server.js)', 'out');
    return;
  }

  if (c.startsWith('dtunnel')) {
    const portMatch = c.match(/--port\s+(\d+)/);
    const port = portMatch ? portMatch[1] : '3000';
    const sub = Math.random().toString(16).slice(2, 10);
    termPrint(`Túnel activo: https://${sub}.${TUNNEL_DOMAIN} → localhost:${port}`, 'out');
    termPrint('Copia la URL en el navegador para probar tu API.', 'out');
    return;
  }

  if (c === 'ls' || c === 'dir') {
    termPrint(Object.keys(project.files).join('  '), 'out');
    return;
  }

  if (c.startsWith('cat ') || c.startsWith('type ')) {
    const f = c.split(/\s+/)[1];
    termPrint(project.files[f] || `No existe: ${f}`, 'out');
    return;
  }

  termPrint(`Comando no soportado en simulador. Prueba: node server.js, dtunnel --port 3000, ls`, 'out');
}

function renderFileTree() {
  const sidebar = document.getElementById('ws-ide-files');
  if (!sidebar) return;
  sidebar.innerHTML = `<div style="padding:0.5rem 0.75rem;font-weight:500">${project.name}</div>`;
  Object.keys(project.files).sort().forEach((name) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `ws-ide-file${name === activeFile ? ' active' : ''}`;
    btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:1rem">description</span>${name}`;
    btn.addEventListener('click', () => openFile(name));
    sidebar.appendChild(btn);
  });
}

function renderTabs() {
  const tabs = document.getElementById('ws-ide-tabs');
  if (!tabs) return;
  tabs.innerHTML = Object.keys(project.files).map((name) => `
    <button type="button" class="ws-ide-tab${name === activeFile ? ' active' : ''}" data-tab="${name}">${name}</button>
  `).join('');
  tabs.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => openFile(btn.dataset.tab));
  });
}

function openFile(name) {
  if (editor && activeFile) {
    project.files[activeFile] = editor.getValue();
    saveProject();
  }
  activeFile = name;
  renderFileTree();
  renderTabs();
  if (!editor) return;
  if (window.monaco) {
    const model = editor.getModel();
    if (model) model.dispose();
    const uri = window.monaco.Uri.parse(`file:///${name}`);
    const newModel = window.monaco.editor.createModel(project.files[name] || '', languageForFile(name), uri);
    editor.setModel(newModel);
  } else {
    const fallback = document.getElementById('ws-ide-fallback');
    if (fallback) fallback.value = project.files[name] || '';
  }
}

function loadMonaco() {
  if (monacoReady) return monacoReady;
  monacoReady = new Promise((resolve, reject) => {
    if (window.monaco) {
      resolve(window.monaco);
      return;
    }
    if (!window.require) {
      reject(new Error('Monaco loader no disponible'));
      return;
    }
    window.require.config({
      paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' },
    });
    window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
  });
  return monacoReady;
}

async function initEditor() {
  const host = document.getElementById('ws-ide-editor');
  if (!host || editor) return;
  try {
    const monacoApi = await loadMonaco();
    window.monaco = monacoApi;
    editor = monacoApi.editor.create(host, {
      value: project.files[activeFile] || '',
      language: languageForFile(activeFile),
      theme: document.documentElement.dataset.theme === 'dark' ? 'vs-dark' : 'vs',
      fontSize: 13,
      minimap: { enabled: false },
      automaticLayout: true,
      wordWrap: 'on',
    });
    editor.onDidChangeModelContent(() => {
      project.files[activeFile] = editor.getValue();
      saveProject();
    });
  } catch (err) {
    host.innerHTML = `<textarea id="ws-ide-fallback" style="width:100%;height:100%;font-family:monospace">${project.files[activeFile] || ''}</textarea>`;
    host.querySelector('#ws-ide-fallback')?.addEventListener('input', (e) => {
      project.files[activeFile] = e.target.value;
      saveProject();
    });
  }
}

export function initWorkspace({ toast }) {
  document.getElementById('ws-new-project')?.addEventListener('click', () => {
    if (!confirm('¿Crear proyecto nuevo? Se perderán cambios no guardados en localStorage.')) return;
    project = structuredClone(DEFAULT_PROJECT);
    activeFile = 'server.js';
    saveProject();
    if (editor) openFile(activeFile);
    else renderFileTree();
    toast?.('Proyecto nuevo creado');
  });

  document.getElementById('ws-run-tunnel')?.addEventListener('click', () => {
    simulateCommand('node server.js');
    setTimeout(() => simulateCommand('dtunnel --port 3000'), 400);
  });

  document.getElementById('ws-ide-terminal-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('ws-ide-terminal-cmd');
    simulateCommand(input.value);
    input.value = '';
  });
}

export async function loadWorkspace({ toast }) {
  renderFileTree();
  renderTabs();
  await initEditor();
  const term = document.getElementById('ws-ide-terminal');
  if (term && !term.dataset.ready) {
    term.dataset.ready = '1';
    termPrint('Workspace dtunnel — terminal simulada', 'out');
    termPrint('Comandos: node server.js | dtunnel --port 3000 | ls | clear', 'out');
  }
}
