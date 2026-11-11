import { buildCanvasPanZoomRuntimeScript } from './panzoom-canvas-runtime.js';

export const MARKMAP_CANVAS_RENDERER = {
    types: ['markmap'],
    previewEnabled: true,
    buildPreviewDocument({ text, baseHref, commonStyle }) {
        const encoded = JSON.stringify(String(text || ''));
        const panZoomScript = buildCanvasPanZoomRuntimeScript({
            hostSelector: 'body',
            targetSelector: '#markmap-svg',
            minScale: 0.2,
            maxScale: 6
        });
        return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <base href="${baseHref}">
  <style>
    ${commonStyle}
    html, body { height: 100%; background: var(--canvas-preview-bg); }
    body {
      width:100%;
      height:100vh;
      margin:0;
      padding:0;
      box-sizing:border-box;
      overflow:hidden;
      background:var(--canvas-preview-bg);
      cursor:grab;
      min-height: 0;
      color-scheme: light dark;
    }
    body,
    body *{
      user-select:none;
      -webkit-user-select:none;
    }
    body.is-dragging{cursor:grabbing}
    #markmap-svg{
      display:block;
      min-width:100%;
      min-height:100vh;
      background: transparent;
      overflow:visible;
      transform-origin:0 0;
      will-change:transform;
    }
    .markmap-error{
      margin:12px 0;
      padding:12px;
      border:1px solid #fca5a5;
      border-radius:8px;
      background:#fff1f2;
      color:#991b1b;
      white-space:pre-wrap;
      font:13px/1.5 var(--canvas-preview-code-font)
    }
  </style>
  <script src="/libs/d3.min.js"></script>
  <script src="/libs/markmap-lib.min.js"></script>
  <script src="/libs/markmap-view.min.js"></script>
</head>
<body>
  <svg id="markmap-svg"></svg>
  <div class="notice" id="markmap-note"></div>
  <script>
    (function () {
      const src = ${encoded};
      const noteEl = document.getElementById('markmap-note');
      const svgEl = document.getElementById('markmap-svg');

      function showError(message) {
        noteEl.className = 'markmap-error';
        noteEl.textContent = message;
      }

      function applyMarkmapTheme() {
        const styles = getComputedStyle(document.documentElement);
        const textColor = styles.getPropertyValue('--canvas-preview-text').trim() || '#111827';
        const surfaceColor = styles.getPropertyValue('--canvas-preview-surface').trim() || '#ffffff';
        const borderColor = styles.getPropertyValue('--canvas-preview-border').trim() || '#e5e7eb';
        svgEl.style.setProperty('--markmap-text-color', textColor);
        svgEl.style.setProperty('--markmap-code-color', textColor);
        svgEl.style.setProperty('--markmap-code-bg', surfaceColor);
        svgEl.style.setProperty('--markmap-circle-open-bg', surfaceColor);
        svgEl.style.setProperty('--markmap-table-border', '1px solid ' + borderColor);
      }

      if (!window.markmap || !window.markmap.Markmap || !window.markmap.Transformer || !window.d3) {
        showError('Markmap runtime missing. Please ensure /libs/d3.min.js, /libs/markmap-lib.min.js and /libs/markmap-view.min.js are available.');
        return;
      }

      try {
        const transformer = new window.markmap.Transformer();
        const transformed = transformer.transform(src || '# Markmap');
        const root = transformed && transformed.root ? transformed.root : null;
        if (!root) {
          throw new Error('Transformer did not produce a root node.');
        }

        const assets = transformer.getUsedAssets ? transformer.getUsedAssets(transformed.features || {}) : null;
        if (assets && Array.isArray(assets.styles) && typeof window.markmap.loadCSS === 'function') {
          window.markmap.loadCSS(assets.styles);
        }
        if (assets && Array.isArray(assets.scripts) && typeof window.markmap.loadJS === 'function') {
          window.markmap.loadJS(assets.scripts);
        }

        const mm = window.markmap.Markmap.create(svgEl, {
          autoFit: true,
          duration: 300,
          maxWidth: 360,
          pan: false,
          zoom: false,
          scrollForPan: false
        }, root);
        applyMarkmapTheme();
        if (mm && typeof mm.fit === 'function') {
          // First fit now, then fit again after layout/fonts settle to keep centered.
          mm.fit();
          requestAnimationFrame(() => {
            try { mm.fit(); } catch (_) { }
          });
          window.addEventListener('resize', () => {
            try { mm.fit(); } catch (_) { }
          });
        }

        noteEl.className = 'notice';
        noteEl.textContent = '';
        ${panZoomScript}
      } catch (error) {
        showError('Markmap render failed: ' + (error && error.message ? error.message : String(error)));
      }
    })();
  </script>
</body>
</html>`;
    }
};
