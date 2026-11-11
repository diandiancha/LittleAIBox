function buildReactRuntimeScript(initialPayloadJson = 'null') {
    return `
(function () {
const initialPayload = ${initialPayloadJson};
const rootEl = document.getElementById('root');
let reactRoot = null;
let runtimeHandlersReady = false;

function showError(error) {
  const pre = document.createElement('pre');
  pre.className = 'react-preview-error';
  pre.textContent = String(error && error.stack ? error.stack : error);
  rootEl.replaceChildren(pre);
}

function reportDone(loadSeq) {
  try {
    window.parent.postMessage({ type: '__canvas_render_done__', loadSeq: Number(loadSeq || 0) }, '*');
  } catch (_) {}
}

function setupRuntimeHandlers() {
  if (runtimeHandlersReady) return;
  runtimeHandlersReady = true;
  window.addEventListener('error', (event) => {
    if (event?.error) {
      showError(event.error);
    } else if (event?.message) {
      showError(event.message);
    }
    event.preventDefault();
  });
  window.addEventListener('unhandledrejection', (event) => {
    showError(event?.reason || 'Unhandled promise rejection');
    event.preventDefault();
  });
}

function syncThemeClass() {
  try {
    const parentTheme = window.parent?.document?.documentElement?.getAttribute('data-theme');
    if (String(parentTheme || '').toLowerCase() === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch (_) {
    document.documentElement.classList.remove('dark');
  }
}

function stripFence(source) {
  return String(source || '')
    .trim()
    .replace(/^\\\`\\\`\\\`[a-zA-Z0-9_-]*\\s*\\n/, '')
    .replace(/\\n\\\`\\\`\\\`$/, '')
    .trim();
}

function normalizeSource(source) {
  let code = stripFence(source);
  code = code
    .replace(/^\\s*import\\s+\\*\\s+as\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+['"]lucide-react['"];?\\s*$/gm, 'const $1 = LucideReact;')
    .replace(/^\\s*import\\s+\\{\\s*([^}]+)\\s*\\}\\s+from\\s+['"]lucide-react['"];?\\s*$/gm, (_, spec) => {
      const mapped = String(spec || '').replace(/\\bas\\b/g, ':');
      return 'const { ' + mapped + ' } = LucideReact;';
    });
  code = code
    .replace(/^\\s*import\\s+React\\s+from\\s+['"]react['"];?\\s*/gm, '')
    .replace(/^\\s*import\\s+\\{\\s*([^}]+)\\s*\\}\\s+from\\s+['"]react['"];?\\s*/gm, '')
    .replace(/^\\s*import\\s+\\{\\s*([^}]+)\\s*\\}\\s+from\\s+['"]react-dom['"];?\\s*/gm, '')
    .replace(/^\\s*import\\s+[^;]+from\\s+['"][^'"]+['"];?\\s*/gm, '');
  code = code.replace(/export\\s+default\\s+/, 'const App = ');
  return code;
}

function ensurePatchedCreateElement() {
  if (!window.React || window.React.__canvasCreateElementPatched) return;
  const originalCreateElement = window.React.createElement;
  window.React.createElement = function patchedCreateElement(type, ...args) {
    if (type == null) {
      throw new Error('React canvas rendered an undefined component. Check imported component names, especially lucide-react icons.');
    }
    return originalCreateElement.call(window.React, type, ...args);
  };
  window.React.__canvasCreateElementPatched = true;
}

function unmountPreviousRoot() {
  if (!reactRoot) {
    rootEl.replaceChildren();
    return;
  }
  try {
    reactRoot.unmount();
  } catch (_) {}
  reactRoot = null;
  rootEl.replaceChildren();
}

function renderReactPayload(payload) {
  const source = String(payload?.source || '');
  const loadSeq = Number(payload?.loadSeq || 0);
  setupRuntimeHandlers();
  try {
    syncThemeClass();
    if (!window.React || !window.ReactDOM || !window.Babel) {
      throw new Error('React runtime missing. Please check /libs/react.production.min.js, /libs/react-dom.production.min.js and /libs/babel.min.js');
    }

    unmountPreviousRoot();
    ensurePatchedCreateElement();

    const prepared = normalizeSource(source);
    const wrapped = \`
const { useState, useEffect, useMemo, useCallback, useRef, useContext, useReducer } = React;
const LucideReact = window.LucideReact || window.lucideReact || {};
window.lucideReact = LucideReact;
class ReactCanvasErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return React.createElement('pre', {
        className: 'react-preview-error'
      }, String(this.state.error && this.state.error.stack ? this.state.error.stack : this.state.error));
    }
    return this.props.children;
  }
}
\${prepared}
if (typeof App === 'undefined') {
  throw new Error('React canvas requires App component. Use "const App = ..." or "export default ...".');
}
window.__reactCanvasRoot = ReactDOM.createRoot(document.getElementById('root'));
window.__reactCanvasRoot.render(React.createElement(ReactCanvasErrorBoundary, null, React.createElement(App)));
\`;

    let output = '';
    try {
      output = window.Babel.transform(wrapped, {
        filename: 'index.tsx',
        sourceType: 'script',
        presets: [
          ['typescript', { isTSX: true, allExtensions: true }],
          ['react', { runtime: 'classic' }]
        ]
      }).code;
    } catch (_) {
      output = window.Babel.transform(wrapped, {
        presets: [['react', { runtime: 'classic' }]]
      }).code;
    }
    new Function('React', 'ReactDOM', output)(window.React, window.ReactDOM);
    reactRoot = window.__reactCanvasRoot || null;
  } catch (error) {
    showError(error);
  } finally {
    reportDone(loadSeq);
  }
}

if (initialPayload) {
  renderReactPayload(initialPayload);
} else {
  setupRuntimeHandlers();
}
})();
`;
}

function buildReactCanvasPreviewPayload({ text = '' } = {}) {
    return { source: String(text || '') };
}

function buildReactCanvasPreviewDocument({ baseHref, commonStyle = '', initialPayload = null }) {
    const sourceLiteral = JSON.stringify(initialPayload || null);
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <base href="${baseHref}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script>
    window.tailwind = window.tailwind || {};
    window.tailwind.config = {
      darkMode: 'class'
    };
    (function loadTailwindRuntime() {
      const localScript = document.createElement('script');
      localScript.src = '/libs/tailwind-play-cdn.min.js';
      document.head.appendChild(localScript);
    })();
  </script>
  <style>
    ${commonStyle}
    html, body, #root {
      width: 100%;
      min-height: 100%;
      margin: 0;
      padding: 0;
    }
    body {
      padding: 0;
      box-sizing: border-box;
    }
    * { box-sizing: border-box; }
    .react-preview-error {
      white-space: pre-wrap;
      margin: 12px;
      padding: 12px;
      border: 1px solid #fecaca;
      background: #fff1f2;
      color: #991b1b;
      border-radius: 8px;
      font: 13px/1.5 var(--canvas-preview-code-font);
    }
    .react-preview-empty {
      padding: 16px;
      border: 1px dashed var(--canvas-preview-border);
      border-radius: 12px;
      color: var(--canvas-preview-muted);
      background: var(--canvas-preview-surface);
      font-family: var(--canvas-preview-font);
    }
  </style>
  <link rel="stylesheet" href="/libs/phosphor-regular.css">
  <script src="/libs/react.production.min.js"></script>
  <script src="/libs/react-dom.production.min.js"></script>
  <script>
    window.react = window.React;
  </script>
  <script src="/libs/lucide-react.min.js"></script>
  <script src="/libs/babel.min.js"></script>
</head>
<body>
  <div id="root"></div>
  <script>${buildReactRuntimeScript(sourceLiteral)}</script>
</body>
</html>`;
}

export const REACT_CANVAS_RENDERER = {
    types: ['react'],
    previewEnabled: true,
    buildPreviewDocument({ text, baseHref, commonStyle = '' }) {
        return buildReactCanvasPreviewDocument({
            baseHref,
            commonStyle,
            initialPayload: buildReactCanvasPreviewPayload({ text })
        });
    }
};
