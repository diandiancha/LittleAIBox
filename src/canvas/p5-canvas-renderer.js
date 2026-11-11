const P5_RENDER_DONE_MESSAGE = '__canvas_render_done__';

function buildP5RuntimeScript(initialPayloadJson = 'null') {
    return `
(function () {
const initialPayload = ${initialPayloadJson};
const host = document.body;
let activeInstances = [];
let renderToken = 0;
let originalP5 = null;
let p5Wrapped = false;

const lifecycleNames = [
  'preload', 'setup', 'draw', 'windowResized',
  'mousePressed', 'mouseReleased', 'mouseDragged',
  'keyPressed', 'keyReleased'
];

function reportDone(loadSeq) {
  try {
    window.parent.postMessage({ type: '${P5_RENDER_DONE_MESSAGE}', loadSeq: Number(loadSeq || 0) }, '*');
  } catch (_) {}
}

function showError(message) {
  const pre = document.createElement('pre');
  pre.className = 'p5-error';
  pre.textContent = message;
  const existing = host.querySelector('.p5-error');
  if (existing) existing.remove();
  host.insertBefore(pre, host.firstChild || null);
}

function clearError() {
  const existing = host.querySelector('.p5-error');
  if (existing) existing.remove();
}

function resetLifecycleGlobals() {
  lifecycleNames.forEach((name) => {
    try { delete window[name]; } catch (_) { window[name] = undefined; }
  });
}

function cleanupPreviousRender() {
  activeInstances.forEach((instance) => {
    try {
      if (instance && typeof instance.remove === 'function') instance.remove();
    } catch (_) {}
  });
  activeInstances = [];
  Array.from(host.querySelectorAll('canvas, script[data-canvas-p5-script="true"], .p5-error')).forEach((node) => {
    try { node.remove(); } catch (_) {}
  });
  resetLifecycleGlobals();
}

function patchP5Constructor() {
  if (!window.p5 || p5Wrapped) return;
  originalP5 = window.p5;
  const WrappedP5 = function (...args) {
    const instance = Reflect.construct(originalP5, args, new.target || WrappedP5);
    activeInstances.push(instance);
    return instance;
  };
  try {
    Object.setPrototypeOf(WrappedP5, originalP5);
  } catch (_) {}
  WrappedP5.prototype = originalP5.prototype;
  Object.keys(originalP5).forEach((key) => {
    try { WrappedP5[key] = originalP5[key]; } catch (_) {}
  });
  window.p5 = WrappedP5;
  p5Wrapped = true;
}

function validateCanvas(source, runtimeErrors, loadSeq, token) {
  setTimeout(() => {
    if (token !== renderToken) return;
    const canvas = host.querySelector('canvas');
    if (!canvas && runtimeErrors.length) {
      showError('P5 runtime error:\\n' + runtimeErrors.join('\\n'));
      reportDone(loadSeq);
      return;
    }
    if (!canvas) {
      showError('No canvas generated. Ensure your code defines setup()/draw() or uses new p5(...).');
      reportDone(loadSeq);
      return;
    }
    if (canvas.width <= 2 || canvas.height <= 2) {
      showError('Canvas size is too small to render preview. Try using a fixed createCanvas(width, height) or keep windowResized().');
      reportDone(loadSeq);
      return;
    }
    clearError();
    reportDone(loadSeq);
  }, 160);
}

function renderP5Payload(payload) {
  const source = String(payload?.source || '');
  const loadSeq = Number(payload?.loadSeq || 0);
  const token = ++renderToken;

  if (!window.p5) {
    showError('P5 runtime missing: /libs/p5.min.js');
    reportDone(loadSeq);
    return;
  }

  patchP5Constructor();
  cleanupPreviousRender();

  const localConsoleError = console.error.bind(console);
  const runtimeErrors = [];
  console.error = function (...args) {
    try {
      const text = args.map(item => {
        if (item && item.message) return item.message;
        return String(item);
      }).join(' ');
      if (/p5/i.test(text)) runtimeErrors.push(text);
    } catch (_) {}
    localConsoleError(...args);
  };

  try {
    if (/new\\s+p5\\s*\\(/.test(source)) {
      new Function('window', 'document', source)(window, document);
    } else {
      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.dataset.canvasP5Script = 'true';
      script.text = String(source || '');
      host.appendChild(script);
      if (typeof window.setup === 'function' || typeof window.draw === 'function') {
        new window.p5();
      }
    }
    validateCanvas(source, runtimeErrors, loadSeq, token);
  } catch (error) {
    showError('P5 render failed:\\n' + (error && error.stack ? error.stack : String(error)));
    reportDone(loadSeq);
  } finally {
    console.error = localConsoleError;
  }
}

if (initialPayload) {
  renderP5Payload(initialPayload);
}
})();
`;
}

function buildP5CanvasPreviewPayload({ text = '' } = {}) {
    return { source: String(text || '') };
}

function buildP5CanvasPreviewDocument({ baseHref, commonStyle = '', initialPayload = null }) {
    const payloadLiteral = JSON.stringify(initialPayload || null);
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <base href="${baseHref}">
  <style>
    ${commonStyle}
    body{
      margin:0;
      padding:0;
      height:100vh;
      overflow:hidden;
      background:var(--canvas-preview-bg);
    }
    body canvas{
      display:block;
      max-width:none;
      height:auto;
    }
    .p5-error{
      margin:12px;
      padding:12px;
      border:1px solid #fca5a5;
      border-radius:8px;
      background:#fff1f2;
      color:#991b1b;
      white-space:pre-wrap;
      font:13px/1.5 var(--canvas-preview-code-font);
    }
  </style>
  <script src="/libs/p5.min.js"></script>
</head>
<body>
  <script>${buildP5RuntimeScript(payloadLiteral)}</script>
</body>
</html>`;
}

export const P5_CANVAS_RENDERER = {
    types: ['p5js'],
    previewEnabled: true,
    buildPreviewDocument({ text, baseHref, commonStyle = '' }) {
        return buildP5CanvasPreviewDocument({
            baseHref,
            commonStyle,
            initialPayload: buildP5CanvasPreviewPayload({ text })
        });
    }
};
