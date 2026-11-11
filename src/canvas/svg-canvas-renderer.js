import { buildCanvasPanZoomRuntimeScript } from './panzoom-canvas-runtime.js';

function sanitizeSvgSource(source = '') {
    const text = String(source || '');
    return text
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
        .replace(/\son[a-z]+\s*=\s*(['"])[\s\S]*?\1/gi, '')
        .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
        .replace(/<foreignObject[\s\S]*?>[\s\S]*?<\/foreignObject>/gi, '');
}

export const SVG_CANVAS_RENDERER = {
    types: ['svg'],
    previewEnabled: true,
    buildPreviewDocument({ text, baseHref, commonStyle }) {
        const sanitized = sanitizeSvgSource(text);
        const svgLiteral = JSON.stringify(sanitized);
        const sourceLiteral = JSON.stringify(String(text || ''));
        const panZoomScript = buildCanvasPanZoomRuntimeScript({
            hostSelector: 'body',
            targetSelector: '#svg-root',
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
    body {
      padding: 0;
      overflow: hidden;
      background: var(--canvas-preview-bg);
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
    }
    body.is-dragging { cursor: grabbing; }
    #svg-root {
      display: block;
      max-width: 100%;
      height: auto;
      transform-origin: 0 0;
      will-change: transform;
    }
    .svg-error {
      margin: 16px;
      padding: 12px;
      border: 1px solid #fca5a5;
      border-radius: 8px;
      background: #fff1f2;
      color: #991b1b;
      white-space: pre-wrap;
      font: 13px/1.5 var(--canvas-preview-code-font);
    }
    .svg-source {
      margin: 0 16px 16px;
      padding: 12px;
      border: 1px solid var(--canvas-preview-border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--canvas-preview-surface) 86%, var(--canvas-preview-border));
      color: var(--canvas-preview-text);
      overflow: auto;
      font: 12px/1.5 var(--canvas-preview-code-font);
    }
  </style>
</head>
<body>
  <svg id="svg-root"></svg>
  <script>
    (function () {
      const raw = ${svgLiteral};
      const root = document.getElementById('svg-root');
      const parser = new DOMParser();
      const doc = parser.parseFromString(raw, 'image/svg+xml');
      const errNode = doc.querySelector('parsererror');
      const showError = (message) => {
        const pre = document.createElement('pre');
        pre.className = 'svg-error';
        pre.textContent = message;
        const code = document.createElement('pre');
        code.className = 'svg-source';
        code.textContent = ${sourceLiteral};
        document.body.replaceChildren(pre, code);
      };

      if (errNode) {
        showError('SVG parse error:\\n' + (errNode.textContent || 'Invalid SVG'));
        return;
      }

      const svg = doc.documentElement;
      if (!svg || svg.nodeName.toLowerCase() !== 'svg') {
        showError('Preview error:\\nCanvas type is svg, but source has no <svg> root element.');
        return;
      }

      if (!svg.getAttribute('viewBox')) {
        const width = Number(svg.getAttribute('width'));
        const height = Number(svg.getAttribute('height'));
        if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
          svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
        }
      }
      if (!svg.getAttribute('width')) {
        svg.setAttribute('width', '100%');
      }
      if (!svg.getAttribute('height') && !svg.getAttribute('viewBox')) {
        svg.setAttribute('height', '320');
      }

      const renderedSvg = document.importNode(svg, true);
      renderedSvg.id = 'svg-root';
      root.replaceWith(renderedSvg);
      ${panZoomScript}
    })();
  </script>
</body>
</html>`;
    }
};
