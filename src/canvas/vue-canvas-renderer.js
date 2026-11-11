function stripCodeFence(source = '') {
    return String(source || '')
        .trim()
        .replace(/^```[a-zA-Z0-9_-]*\s*\n/, '')
        .replace(/\n```$/, '')
        .trim();
}

function escapeHtml(source = '') {
    return String(source || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function normalizeVueSource(source = '') {
    let code = stripCodeFence(source);

    code = code
        .replace(/^\s*import\s+Vue\s+from\s+['"]vue['"];?\s*/gm, '')
        .replace(/^\s*import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]vue['"];?\s*/gm, '')
        .replace(/^\s*import\s+[^;]+from\s+['"][^'"]+['"];?\s*/gm, '');

    code = code.replace(/export\s+default\s+/, 'const App = ');

    return code;
}

function extractInlineStylesFromVueTemplate(source = '') {
    const styles = [];
    const stripped = String(source || '').replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => {
        const text = String(css || '').trim();
        if (text) styles.push(text);
        return '';
    });
    return {
        code: stripped,
        styles
    };
}

function looksLikeFullHtml(source = '') {
    return /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<script\s+src=/i.test(String(source || ''));
}

const VUE_RENDER_DONE_MESSAGE = '__canvas_render_done__';

function buildVueRuntimeScript(initialPayloadJson = 'null') {
    return `
(() => {
const initialPayload = ${initialPayloadJson};
let currentApp = null;
let runtimeHandlersReady = false;

function reportDone(loadSeq) {
  try {
    window.parent.postMessage({ type: '${VUE_RENDER_DONE_MESSAGE}', loadSeq: Number(loadSeq || 0) }, '*');
  } catch (_) {}
}

function showVuePreviewError(error) {
  const root = document.getElementById('app');
  const pre = document.createElement('pre');
  pre.className = 'vue-preview-error';
  pre.textContent = String(error && error.stack ? error.stack : error);
  root.replaceChildren(pre);
}

function setupRuntimeHandlers() {
  if (runtimeHandlersReady) return;
  runtimeHandlersReady = true;
  window.addEventListener('error', (event) => {
    if (event?.error) {
      showVuePreviewError(event.error);
    } else if (event?.message) {
      showVuePreviewError(event.message);
    }
    event.preventDefault();
  });
  window.addEventListener('unhandledrejection', (event) => {
    showVuePreviewError(event?.reason || 'Unhandled promise rejection');
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

function mountExtractedTemplateStyles(styles) {
  const styleId = 'canvas-vue-inline-style';
  const prev = document.getElementById(styleId);
  if (prev) prev.remove();
  if (!Array.isArray(styles) || styles.length === 0) return;
  const styleEl = document.createElement('style');
  styleEl.id = styleId;
  styleEl.textContent = styles.join('\\n\\n');
  document.head.appendChild(styleEl);
}

function renderLucideIcons() {
  try {
    const api = window.lucide;
    if (!api || typeof api.createIcons !== 'function') return;
    api.createIcons({
      attrs: {
        'stroke-width': 2
      }
    });
  } catch (_) {}
}

function cleanupPreviousApp() {
  if (currentApp) {
    try { currentApp.unmount(); } catch (_) {}
  }
  currentApp = null;
  const root = document.getElementById('app');
  if (root) root.replaceChildren();
  mountExtractedTemplateStyles([]);
}

function showFullHtmlNotice() {
  const root = document.getElementById('app');
  const box = document.createElement('div');
  box.className = 'vue-preview-empty';
  box.textContent = 'Detected full HTML document. Use canvas type="html" for full pages, and keep type="vue" for a single App component.';
  root.replaceChildren(box);
}

function renderVuePayload(payload) {
  const loadSeq = Number(payload?.loadSeq || 0);
  setupRuntimeHandlers();
  try {
    syncThemeClass();
    cleanupPreviousApp();

    if (!window.Vue) {
      throw new Error('Vue is not loaded. Please check /libs/vue.global.prod.js');
    }

    if (payload?.fullHtmlInput) {
      showFullHtmlNotice();
      return;
    }

    mountExtractedTemplateStyles(payload?.styles || []);

    const appFactory = new Function('Vue', 'lucide', \`
const {
  createApp,
  ref,
  reactive,
  computed,
  watch,
  watchEffect,
  onMounted,
  onUnmounted,
  nextTick
} = Vue;
\${String(payload?.source || '')}
if (typeof App === 'undefined') {
  throw new Error('Vue canvas requires an App component. Use "const App = {...}" or "export default {...}".');
}
return App;
\`);
    const App = appFactory(window.Vue, window.lucide || {});
    currentApp = window.Vue.createApp(App);
    currentApp.mixin({
      mounted() {
        renderLucideIcons();
      },
      updated() {
        renderLucideIcons();
      }
    });
    currentApp.mount('#app');
    renderLucideIcons();
  } catch (error) {
    showVuePreviewError(error);
  } finally {
    reportDone(loadSeq);
  }
}

if (initialPayload) {
  renderVuePayload(initialPayload);
} else {
  setupRuntimeHandlers();
}
})();
`;
}

function buildVueCanvasPreviewPayload({ text = '' } = {}) {
    const rawText = String(text || '');
    const normalizedSource = normalizeVueSource(rawText);
    const extracted = extractInlineStylesFromVueTemplate(normalizedSource);
    return {
        source: extracted.code,
        styles: extracted.styles,
        fullHtmlInput: looksLikeFullHtml(rawText)
    };
}

function buildVueCanvasPreviewDocument({ baseHref, commonStyle = '', initialPayload = null }) {
    const payloadLiteral = JSON.stringify(initialPayload || null);
    const base = escapeHtml(baseHref || '/');

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <base href="${base}">
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
    (function loadLucideRuntime() {
      const localScript = document.createElement('script');
      localScript.src = '/libs/lucide.min.js';
      document.head.appendChild(localScript);
    })();
  </script>
  <style>
    ${commonStyle}
    html,
    body,
    #app {
      width: 100%;
      min-height: 100%;
      margin: 0;
      padding: 0;
    }

    body {
      padding: 0;
      box-sizing: border-box;
    }

    * {
      box-sizing: border-box;
    }

    .vue-preview-error {
      white-space: pre-wrap;
      margin: 12px;
      padding: 12px;
      border: 1px solid #fecaca;
      background: #fff1f2;
      color: #991b1b;
      border-radius: 8px;
      font: 13px/1.5 var(--canvas-preview-code-font);
    }

    .vue-preview-empty {
      padding: 16px;
      border: 1px dashed var(--canvas-preview-border);
      border-radius: 12px;
      color: var(--canvas-preview-muted);
      background: var(--canvas-preview-surface);
      font-family: var(--canvas-preview-font);
    }
  </style>
  <link rel="stylesheet" href="/libs/phosphor-regular.css">
  <script src="/libs/vue.global.prod.js"></script>
</head>
<body>
  <div id="app"></div>
  <script>${buildVueRuntimeScript(payloadLiteral)}</script>
</body>
</html>`;
}

export const VUE_CANVAS_RENDERER = {
    types: ['vue'],
    previewEnabled: true,
    buildPreviewDocument({ text, baseHref, commonStyle = '' }) {
        return buildVueCanvasPreviewDocument({
            baseHref,
            commonStyle,
            initialPayload: buildVueCanvasPreviewPayload({ text })
        });
    }
};
