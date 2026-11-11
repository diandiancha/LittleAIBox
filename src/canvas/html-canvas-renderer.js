function isStandaloneHtmlDocument(source) {
    const text = String(source || '').trim();
    if (!text) return false;
    return /<!doctype\s+html\b/i.test(text) || /<html[\s>]/i.test(text);
}

function buildHtmlPreviewSrcdoc(source, fallbackStyle = '') {
    const html = String(source || '');
    const fontFallback = String(fallbackStyle || '').trim()
        ? `<style id="canvas-font-fallback">\n${fallbackStyle}\n</style>`
        : '';
    const csp = [
        "default-src 'none'",
        "img-src 'self' data: blob: https:",
        "style-src 'self' 'unsafe-inline' https:",
        "script-src 'self' 'unsafe-inline' https:",
        "font-src 'self' data: https:",
        "connect-src 'none'",
        "frame-src 'none'",
        "form-action 'none'",
        "base-uri 'none'"
    ].join('; ');
    const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
    const storageShim = `<script>
;(() => {
  const createStore = () => {
    const data = Object.create(null);
    return {
      get length() { return Object.keys(data).length; },
      key(index) { return Object.keys(data)[Number(index)] || null; },
      getItem(key) { key = String(key); return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
      setItem(key, value) { data[String(key)] = String(value); },
      removeItem(key) { delete data[key]; },
      clear() { Object.keys(data).forEach((key) => delete data[key]); }
    };
  };
  for (const name of ['localStorage', 'sessionStorage']) {
    try { void window[name]; }
    catch (_) {
      try { Object.defineProperty(window, name, { value: createStore(), configurable: true }); } catch (_) {}
    }
  }
  try {
    const nativePostMessage = Window.prototype.postMessage;
    Window.prototype.postMessage = function(message, targetOrigin, transfer) {
      const safeOrigin = targetOrigin == null || targetOrigin === 'null' ? '*' : targetOrigin;
      return arguments.length > 2
        ? nativePostMessage.call(this, message, safeOrigin, transfer)
        : nativePostMessage.call(this, message, safeOrigin);
    };
  } catch (_) {}
})();
</script>`;
    const runtimeErrorOverlay = `<script>
;(() => {
  const shown = new Set();
  const shouldIgnorePreviewError = (message, filename, stack) => {
    const text = String(message || '');
    const file = String(filename || '');
    const trace = String(stack || '');
    if (/content[\\s_-]?main\\.js/i.test(file) || /content[\\s_-]?main\\.js/i.test(trace)) return true;
    if (/chrome-extension:|moz-extension:|safari-web-extension:/i.test(file + trace)) return true;
    if (/Invalid target origin ['"]null['"]/i.test(text) && /postMessage/i.test(text)) return true;
    if (/Cannot read properties of null \\(reading ['"]postMessage['"]\\)/i.test(text)) return true;
    return false;
  };
  const showError = (title, detail) => {
    try {
      const key = String(title || '') + '\\n' + String(detail || '');
      if (shown.has(key)) return;
      shown.add(key);
      const box = document.createElement('pre');
      box.style.cssText = 'white-space:pre-wrap;margin:12px;padding:12px;border:1px solid #fca5a5;background:#fff1f2;color:#991b1b;border-radius:8px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
      box.textContent = String(title || 'Preview error:') + '\\n' + String(detail || '');
      (document.body || document.documentElement).appendChild(box);
    } catch (_) {}
  };
  window.addEventListener('error', (event) => {
    const message = event?.message || '';
    const filename = event?.filename || '';
    const stack = event?.error?.stack || '';
    if (shouldIgnorePreviewError(message, filename, stack)) {
      event?.preventDefault?.();
      return true;
    }
    const detail = [message || 'Unknown error', filename ? ('at ' + filename + ':' + (event?.lineno || 0) + ':' + (event?.colno || 0)) : ''].filter(Boolean).join('\\n');
    showError('Preview error:', detail);
    return false;
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    const message = reason && (reason.message || String(reason)) || 'Unhandled promise rejection';
    const stack = reason && reason.stack || '';
    if (shouldIgnorePreviewError(message, '', stack)) {
      event?.preventDefault?.();
      return true;
    }
    showError('Unhandled promise rejection:', stack || message);
    return false;
  });
})();
</script>`;
    const renderTuning = `<style>
html, body {
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
</style>`;
    const headInject = `${meta}\n${fontFallback}\n${renderTuning}\n${storageShim}\n${runtimeErrorOverlay}`;

    if (/<html[\s>]/i.test(html) && !/<head[\s>]/i.test(html)) {
        return html.replace(/<html(\s[^>]*)?>/i, match => `${match}\n<head>${headInject}</head>`);
    }
    if (/<head[\s>]/i.test(html)) {
        return html.replace(/<head(\s[^>]*)?>/i, match => `${match}\n${headInject}`);
    }
    return `<!doctype html><html><head>${headInject}</head><body>${html}</body></html>`;
}

export const HTML_CANVAS_RENDERER = {
    types: ['html'],
    previewEnabled: true,
    buildPreviewDocument({ text, commonStyle = '' }) {
        return isStandaloneHtmlDocument(text)
            ? buildHtmlPreviewSrcdoc(text, commonStyle)
            : buildHtmlPreviewSrcdoc(`<main>${text}</main>`, commonStyle);
    }
};
