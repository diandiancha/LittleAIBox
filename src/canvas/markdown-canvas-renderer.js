import { buildMermaidConfig, buildVegaThemeConfig, getAppFontFamily, isDarkThemeRoot } from '../rendering/chart-theme-config.js';
import { wrapStandaloneMermaidDefinition } from '../rendering/mermaid-source-normalizer.js';
import { installCjkFriendlyEmphasis } from '../mathrender/markdown-cjk-emphasis.js';
import { parseMarkdownFenceLine } from '../mathrender/markdown-fences.js';
import { protectMarkdownMathPlaceholders } from '../mathrender/markdown-math-protection.js';
import { normalizeMarkdownForMath } from '../mathrender/markdown-normalizer.js';
import { findDisplayMathRegions } from '../mathrender/math-regions.js';
import { buildKatexConfigRuntimeLiteral, KATEX_CONFIG, MathRenderer } from '../mathrender/math-renderer.js';

const markdownCanvasMathRenderer = new MathRenderer(KATEX_CONFIG);
let mermaidRendererModulePromise = null;
let vegaRendererModulePromise = null;

function loadMermaidRendererModule() {
  if (!mermaidRendererModulePromise) {
    mermaidRendererModulePromise = import('../rendering/mermaid-renderer.js');
  }
  return mermaidRendererModulePromise;
}

function loadVegaRendererModule() {
  if (!vegaRendererModulePromise) {
    vegaRendererModulePromise = import('../rendering/vega-renderer.js');
  }
  return vegaRendererModulePromise;
}

const CANVAS_PREVIEW_RENDER_DONE_MESSAGE = '__canvas_render_done__';

function buildMarkdownRuntimeScript(initialPayloadJson = 'null') {
  const katexConfigJson = buildKatexConfigRuntimeLiteral();
  const protectMarkdownMathPlaceholdersRuntime = protectMarkdownMathPlaceholders.toString();
  const findDisplayMathRegionsRuntime = findDisplayMathRegions.toString();
  const installCjkFriendlyEmphasisRuntime = installCjkFriendlyEmphasis.toString();
  return `
    (function() {
    const katexConfig = ${katexConfigJson};
    const initialPayload = ${initialPayloadJson};
    const findDisplayMathRegions = ${findDisplayMathRegionsRuntime};
    const protectMarkdownMathPlaceholders = ${protectMarkdownMathPlaceholdersRuntime};
    const installCjkFriendlyEmphasis = ${installCjkFriendlyEmphasisRuntime};
    const article = document.getElementById('md');
    const scriptPromises = Object.create(null);
    let latexCopyReady = false;

    function setupLinkIntercept() {
      document.addEventListener('click', handleLinkIntercept, true);
      document.addEventListener('auxclick', handleLinkIntercept, true);
      document.addEventListener('submit', (event) => {
        event.preventDefault();
      }, true);
    }

    function handleLinkIntercept(event) {
      let target = event.target;
      while (target && String(target.tagName || '').toUpperCase() !== 'A') {
        target = target.parentElement;
      }
      if (!target) return;

      const hrefRaw = target.getAttribute('href') || target.getAttribute('xlink:href') || '';
      const href = typeof hrefRaw === 'string' ? hrefRaw : (hrefRaw && hrefRaw.baseVal ? hrefRaw.baseVal : String(hrefRaw || ''));
      if (!href) return;
      if (target.hasAttribute('download')) return;

      const lowerHref = href.trim().toLowerCase();
      if (lowerHref.indexOf('javascript:') === 0 ||
          lowerHref.indexOf('mailto:') === 0 ||
          lowerHref.indexOf('tel:') === 0 ||
          lowerHref.indexOf('sms:') === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const firstChar = href.charAt(0);
      if (firstChar === '#' || firstChar === '?') {
        try {
          const targetValue = firstChar === '#' ? href : new URL(href, window.location.href).hash;
          if (firstChar === '#') {
            window.location.hash = targetValue;
          } else {
            window.location.search = href;
          }
        } catch (_) {}
        return;
      }

      try {
        const openUrl = target.href || href;
        window.parent.postMessage({
          source: 'littleaibox-canvas-preview',
          type: '__canvas_open_link__',
          url: String(openUrl || '')
        }, '*');
        window.open(openUrl, '_blank', 'noopener,noreferrer');
      } catch (_) {}
    }

    function escapeHtml(source) {
      return String(source || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function parseMarkdown(source) {
      const markedApi = window.marked;
      if (markedApi && typeof markedApi.parse === 'function') {
        installCjkFriendlyEmphasis(markedApi);
        return markedApi.parse(String(source || ''), { breaks: true, gfm: true });
      }
      return escapeHtml(source).replace(/\\n/g, '<br>');
    }

    function sanitizeHtml(html) {
      if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
        return window.DOMPurify.sanitize(String(html || ''), {
          ADD_TAGS: ['div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'img', 'br', 'a', 'h4', 'ul', 'li'],
          ADD_ATTR: ['style', 'class', 'aria-hidden', 'src', 'alt', 'title', 'href', 'target', 'rel']
        });
      }
      return String(html || '');
    }

    function sanitizeRenderedLinks() {
      article.querySelectorAll('a[href]').forEach((link) => {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
      });
    }

    function loadScriptOnce(src) {
      if (scriptPromises[src]) return scriptPromises[src];
      scriptPromises[src] = new Promise((resolve, reject) => {
        const existing = Array.from(document.scripts).find((script) => script.getAttribute('src') === src);
        if (existing) {
          if (existing.dataset.loaded === 'true') {
            resolve();
            return;
          }
          existing.addEventListener('load', () => resolve(), { once: true });
          existing.addEventListener('error', () => reject(new Error('Failed to load ' + src)), { once: true });
          return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = false;
        script.addEventListener('load', () => {
          script.dataset.loaded = 'true';
          resolve();
        }, { once: true });
        script.addEventListener('error', () => reject(new Error('Failed to load ' + src)), { once: true });
        document.head.appendChild(script);
      });
      return scriptPromises[src];
    }

    async function ensureRuntimeDeps(payload) {
      await Promise.all([
        loadScriptOnce('/libs/purify.min.js'),
        loadScriptOnce('/libs/marked.min.js')
      ]);

      if (payload.hasMermaidFence) {
        await loadScriptOnce('/libs/mermaid.min.js');
      }
      if (payload.hasVegaFence) {
        await loadScriptOnce('/libs/vega.min.js');
        await loadScriptOnce('/libs/vega-lite.min.js');
        await loadScriptOnce('/libs/vega-embed.min.js');
      }
      if (payload.hasMathContent) {
        await loadScriptOnce('/libs/katex.min.js');
        await loadScriptOnce('/libs/mhchem.min.js');
        await loadScriptOnce('/libs/auto-render.min.js');
      }
    }

    function wrapTables() {
      article.querySelectorAll('table').forEach((table) => {
        if (table.parentElement && table.parentElement.classList.contains('table-wrapper')) return;
        const wrapper = document.createElement('div');
        wrapper.className = 'table-wrapper';
        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);
      });
    }

    function renderMermaidBlocks() {
      const codeBlocks = Array.from(article.querySelectorAll('pre > code'));
      const mermaidBlocks = codeBlocks.filter((code) => {
        const cls = String(code.className || '').toLowerCase();
        const src = String(code.textContent || '').trim();
        return cls.includes('language-mermaid') || cls.includes('lang-mermaid') || cls === 'mermaid' || /^mermaid\\b/i.test(src);
      });
      if (!window.mermaid || !mermaidBlocks.length) return;
      try {
        const mermaidConfig = window.__markdownCanvasPayload?.mermaidConfig || {};
        const mermaidCandidatesByIndex = window.__markdownCanvasPayload?.mermaidCandidates || [];
        window.mermaid.initialize(mermaidConfig);
        mermaidBlocks.forEach((code, index) => {
          const pre = code.closest('pre');
          if (!pre) return;
          const fallbackSource = String(code.textContent || '').trim();
          const candidates = Array.isArray(mermaidCandidatesByIndex[index]) && mermaidCandidatesByIndex[index].length
            ? mermaidCandidatesByIndex[index]
            : [fallbackSource];
          const renderId = 'md_mermaid_' + Date.now() + '_' + index;
          const renderCandidate = (candidateIndex) => {
            const source = candidates[candidateIndex];
            if (!source) return Promise.reject(new Error('Mermaid definition could not be rendered'));
            const parsePromise = typeof window.mermaid.parse === 'function'
              ? Promise.resolve(window.mermaid.parse(source))
              : Promise.resolve();
            return parsePromise
              .then(() => window.mermaid.render(renderId + '_' + candidateIndex, source))
              .catch((error) => {
                if (candidateIndex + 1 >= candidates.length) throw error;
                return renderCandidate(candidateIndex + 1);
              });
          };
          renderCandidate(0)
            .then(({ svg }) => {
              const wrap = document.createElement('div');
              wrap.className = 'md-mermaid';
              wrap.innerHTML = svg;
              pre.replaceWith(wrap);
            })
            .catch(() => {});
        });
      } catch (_) {}
    }

    function renderVegaBlocks() {
      const codeBlocks = Array.from(article.querySelectorAll('pre > code'));
      const vegaBlocks = codeBlocks.filter((code) => {
        const cls = String(code.className || '').toLowerCase();
        return cls.includes('language-vega-lite') || cls.includes('lang-vega-lite') || cls.includes('language-vega') || cls.includes('lang-vega');
      });
      if (!window.vegaEmbed || !vegaBlocks.length) return;
      const vegaThemeConfig = window.__markdownCanvasPayload?.vegaThemeConfig || {};
      vegaBlocks.forEach((code) => {
        const pre = code.closest('pre');
        if (!pre) return;
        const specText = String(code.textContent || '').trim();
        let spec = null;
        try { spec = JSON.parse(specText); } catch (_) { return; }
        const host = document.createElement('div');
        host.className = 'md-vega-host';
        pre.replaceWith(host);
        window.vegaEmbed(host, spec, { actions: false, renderer: 'svg', config: vegaThemeConfig }).catch((err) => {
          const msg = document.createElement('div');
          msg.className = 'md-vega-error';
          msg.textContent = 'Vega render failed: ' + String(err && err.message ? err.message : err);
          host.appendChild(msg);
        });
      });
    }

    function renderMathAndChemistry() {
      if (typeof window.renderMathInElement !== 'function') return;
      try {
        window.renderMathInElement(article, katexConfig);
      } catch (err) {
        const box = document.createElement('pre');
        box.className = 'md-math-error';
        box.textContent = 'Math render failed: ' + String(err && err.message ? err.message : err);
        article.appendChild(box);
      }
    }

    function restoreKatexForCopy(root) {
      if (!root || typeof root.querySelectorAll !== 'function') return;

      const displayMathNodes = Array.from(root.querySelectorAll('.katex-display'));
      displayMathNodes.forEach((node) => {
        const annotation = node.querySelector('annotation[encoding="application/x-tex"]');
        const tex = annotation ? annotation.textContent : node.textContent || '';
        node.replaceWith(document.createTextNode('$$' + tex + '$$'));
      });

      const inlineMathNodes = Array.from(root.querySelectorAll('.katex'))
        .filter(node => !node.closest('.katex-display'));
      inlineMathNodes.forEach((node) => {
        const annotation = node.querySelector('annotation[encoding="application/x-tex"]');
        const tex = annotation ? annotation.textContent : node.textContent || '';
        node.replaceWith(document.createTextNode('$' + tex + '$'));
      });
    }

    function buildCopyTextFromSelection(selection) {
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return '';
      const fragment = document.createDocumentFragment();

      for (let i = 0; i < selection.rangeCount; i += 1) {
        fragment.appendChild(selection.getRangeAt(i).cloneContents());
      }

      restoreKatexForCopy(fragment);

      const temp = document.createElement('div');
      temp.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none;';
      temp.appendChild(fragment);
      document.body.appendChild(temp);
      const text = temp.innerText;
      temp.remove();
      return text;
    }

    function setupLatexCopy() {
      if (latexCopyReady) return;
      latexCopyReady = true;
      document.addEventListener('copy', (event) => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

        let touchesArticle = false;
        for (let i = 0; i < selection.rangeCount; i += 1) {
          const range = selection.getRangeAt(i);
          try {
            if (range.intersectsNode(article)) {
              touchesArticle = true;
              break;
            }
          } catch (_) {}
        }
        if (!touchesArticle) return;

        const text = buildCopyTextFromSelection(selection);
        if (!text) return;
        event.preventDefault();
        event.clipboardData.setData('text/plain', text);
      });
    }

    function reportDone(loadSeq) {
      try {
        window.parent.postMessage({ type: '${CANVAS_PREVIEW_RENDER_DONE_MESSAGE}', loadSeq: Number(loadSeq || 0) }, '*');
      } catch (_) {}
    }

    let activeRenderToken = 0;

    async function renderMarkdownPayload(payload) {
      const renderToken = ++activeRenderToken;
      const normalizedPayload = payload && typeof payload === 'object' ? payload : {};
      window.__markdownCanvasPayload = normalizedPayload;
      try {
        await ensureRuntimeDeps(normalizedPayload);
        if (renderToken !== activeRenderToken) return;
        const raw = String(normalizedPayload.raw || '');
        const mathProtection = protectMarkdownMathPlaceholders(raw, { findRegions: findDisplayMathRegions });
        if (renderToken !== activeRenderToken) return;
        article.innerHTML = sanitizeHtml(mathProtection.restore(parseMarkdown(mathProtection.text), { escapeHtml: true }));
        if (renderToken !== activeRenderToken) return;
        sanitizeRenderedLinks();
        wrapTables();
        renderMermaidBlocks();
        renderVegaBlocks();
        renderMathAndChemistry();
        if (renderToken !== activeRenderToken) return;
        setupLatexCopy();
      } catch (err) {
        if (renderToken !== activeRenderToken) return;
        const box = document.createElement('pre');
        box.className = 'md-math-error';
        box.textContent = 'Markdown preview failed: ' + String(err && err.message ? err.message : err);
        article.replaceChildren(box);
      } finally {
        if (renderToken !== activeRenderToken) return;
        reportDone(normalizedPayload.loadSeq || 0);
      }
    }

    setupLinkIntercept();
    if (initialPayload) {
      renderMarkdownPayload(initialPayload);
    } else {
      setupLatexCopy();
    }
    })();
  `;
}

function transformFencedCodeBlocks(markdown, transformBlock) {
  const lines = String(markdown || '').split(/\r?\n/);
  const output = [];
  let activeFence = null;

  const withFenceIndent = (line, indent) => {
    if (!indent || line === '') return line;
    return `${indent}${line}`;
  };

  const flushFence = () => {
    if (!activeFence) return;
    const { openingLine, closingLine, info, fence, bodyLines, complete } = activeFence;
    const body = bodyLines.join('\n');
    const replacement = typeof transformBlock === 'function'
      ? transformBlock({ info, body, fence, complete })
      : null;
    const replacementBody = typeof replacement === 'string'
      ? replacement
      : (replacement && typeof replacement.body === 'string' ? replacement.body : null);
    if (!complete) {
      if (replacement && typeof replacement === 'object' && replacement.unwrap === true && replacementBody !== null) {
        output.push(...replacementBody
          .split(/\r?\n/)
          .map(line => withFenceIndent(line, activeFence.indent)));
      } else {
        output.push(openingLine, ...bodyLines);
      }
      activeFence = null;
      return;
    }

    if (replacementBody !== null) {
      const indentedReplacement = replacementBody
        .split(/\r?\n/)
        .map(line => withFenceIndent(line, activeFence.indent));
      if (replacement && typeof replacement === 'object' && replacement.unwrap === true) {
        output.push(...indentedReplacement);
      } else {
        output.push(`${activeFence.indent}${fence}${info ? ` ${info}` : ''}`, ...indentedReplacement, `${activeFence.indent}${fence}`);
      }
    } else {
      output.push(openingLine, ...bodyLines, closingLine || `${activeFence.indent}${fence}`);
    }
    activeFence = null;
  };

  const diagramGlyphPattern = /[┌┐└┘├┤┬┴┼│─▼▲→←]/u;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const parsedFence = parseMarkdownFenceLine(line);
    const fenceMatch = parsedFence?.quoteDepth === 0 ? parsedFence : null;
    if (!activeFence) {
      if (!fenceMatch) {
        output.push(line);
        continue;
      }
      activeFence = {
        openingLine: line,
        closingLine: '',
        indent: fenceMatch.indent,
        fence: fenceMatch.marker,
        marker: fenceMatch.markerChar,
        length: fenceMatch.markerLength,
        info: fenceMatch.info.trim(),
        bodyLines: [],
        complete: false
      };
      continue;
    }

    if (fenceMatch &&
      fenceMatch.markerChar === activeFence.marker &&
      fenceMatch.markerLength >= activeFence.length &&
      fenceMatch.info.trim() === '') {
      let nextFenceIndex = -1;
      let nextFence = null;
      for (let scanIndex = index + 1; scanIndex < lines.length; scanIndex += 1) {
        const candidate = parseMarkdownFenceLine(lines[scanIndex]);
        if (candidate?.quoteDepth === 0) {
          nextFenceIndex = scanIndex;
          nextFence = candidate;
          break;
        }
      }

      const activeLanguage = activeFence.info.split(/\s+/)[0].toLowerCase();
      const nextLanguage = nextFence?.info.trim().split(/\s+/)[0].toLowerCase() || '';
      const gapLines = nextFenceIndex > index
        ? lines.slice(index + 1, nextFenceIndex)
        : [];
      const meaningfulGapLines = gapLines.filter(gapLine => gapLine.trim() !== '');
      const gapDiagramLines = meaningfulGapLines.filter(gapLine => diagramGlyphPattern.test(gapLine)).length;
      const gapHasMarkdownStructure = meaningfulGapLines.some(gapLine => (
        /^\s{0,3}#{1,6}\s+\S/.test(gapLine) ||
        /^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)\S/.test(gapLine) ||
        /^\s*\|.*\|\s*$/.test(gapLine)
      ));
      const hasDiagramGap = nextFenceIndex > index &&
        ['markdown', 'md', 'mdown'].includes(nextLanguage) &&
        gapDiagramLines >= 2 &&
        meaningfulGapLines.length <= 12 &&
        !gapHasMarkdownStructure;

      if (hasDiagramGap && ['scss', 'text', 'plaintext', 'ascii'].includes(activeLanguage)) {
        const bodyDiagramLines = activeFence.bodyLines.filter(bodyLine => diagramGlyphPattern.test(bodyLine)).length;
        if (bodyDiagramLines >= 2) {
          activeFence.bodyLines.push(...gapLines);
          activeFence.complete = true;
          activeFence.closingLine = line;
          flushFence();
          index = nextFenceIndex - 1;
          continue;
        }
      }

      activeFence.complete = true;
      activeFence.closingLine = line;
      flushFence();
      if (hasDiagramGap && ['markdown', 'md', 'mdown'].includes(activeLanguage)) {
        output.push('```text', ...gapLines, '```');
        index = nextFenceIndex - 1;
      }
      continue;
    }

    activeFence.bodyLines.push(line);
  }

  flushFence();
  return output.join('\n');
}

function repairMissingDiagramOpeningFence(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const output = [];
  let activeFence = null;
  const diagramGlyphPattern = /[┌┐└┘├┤┬┴┼│─━▼▲→←]/u;
  const isDiagramLine = (value) => {
    const line = String(value || '').trim();
    return !!line && (diagramGlyphPattern.test(line) || /^\[[^\]\n]+\]/u.test(line));
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const candidate = parseMarkdownFenceLine(line);
    if (!candidate || candidate.quoteDepth !== 0) {
      output.push(line);
      continue;
    }

    const closesActiveFence = activeFence &&
      candidate.quoteDepth === activeFence.quoteDepth &&
      candidate.markerChar === activeFence.markerChar &&
      candidate.markerLength >= activeFence.markerLength &&
      candidate.info.trim() === '';
    if (closesActiveFence) {
      output.push(line);
      activeFence = null;
      continue;
    }

    if (!activeFence && candidate.info.trim() === '') {
      let diagramStart = output.length - 1;
      while (diagramStart >= 0 && isDiagramLine(output[diagramStart])) {
        diagramStart -= 1;
      }
      diagramStart += 1;
      const diagramLines = output.slice(diagramStart);
      const diagramLineCount = diagramLines.filter(value => diagramGlyphPattern.test(value)).length;
      const hasDiagramLabel = diagramLines.some(value => /[\p{L}\p{N}]/u.test(value));
      if (diagramLines.length >= 3 && diagramLineCount >= 2 && hasDiagramLabel) {
        output.splice(diagramStart, 0, '```text');
        output.push(line);
        continue;
      }
    }

    output.push(line);
    if (!activeFence) activeFence = candidate;
  }

  return output.join('\n');
}

export async function buildMarkdownCanvasPreviewPayload({ text = '' } = {}) {
  const diagramFenceRepairedText = repairMissingDiagramOpeningFence(wrapStandaloneMermaidDefinition(text));
  const documentText = transformFencedCodeBlocks(diagramFenceRepairedText, ({ info, body }) => {
    const language = String(info || '').split(/\s+/)[0].toLowerCase();
    return ['markdown', 'md', 'mdown'].includes(language)
      ? { body, unwrap: true }
      : null;
  });
  const normalizedMathText = normalizeMarkdownForMath(documentText, { wrapBareChemistry: true });
  const hasMermaidFence = /```[^\n`]*\bmermaid\b[^\n`]*\n/i.test(normalizedMathText);
  const hasVegaFence = /```[^\n`]*\b(?:vega|vega-lite)\b[^\n`]*\n/i.test(normalizedMathText);
  const [mermaidModule, vegaModule] = await Promise.all([
    hasMermaidFence ? loadMermaidRendererModule() : Promise.resolve(null),
    hasVegaFence ? loadVegaRendererModule() : Promise.resolve(null)
  ]);
  const mermaidCandidates = [];
  const normalizedChartText = transformFencedCodeBlocks(normalizedMathText, ({ info, body, complete }) => {
    if (!complete) return null;
    const language = info.split(/\s+/)[0].toLowerCase();
    if (language === 'mermaid') {
      const candidates = typeof mermaidModule?.buildMermaidRenderCandidates === 'function'
        ? mermaidModule.buildMermaidRenderCandidates(body)
        : [];
      mermaidCandidates.push(candidates);
      return candidates[0] || null;
    }
    if (language === 'vega' || language === 'vega-lite') {
      try {
        if (typeof vegaModule?.prepareVegaSpecForRender !== 'function') return null;
        const spec = vegaModule.prepareVegaSpecForRender(body);
        return JSON.stringify(spec, null, 2);
      } catch (_) {
        return null;
      }
    }
    return null;
  });
  const normalizedText = markdownCanvasMathRenderer.wrapBareInlineLatexCommands(normalizedChartText);
  const hasMathContent = MathRenderer.containsMath(normalizedText);
  const isDarkTheme = isDarkThemeRoot(document?.documentElement);
  const fontFamily = getAppFontFamily();
  return {
    raw: normalizedText,
    hasMermaidFence,
    hasVegaFence,
    hasMathContent,
    mermaidConfig: buildMermaidConfig({ isDarkTheme, fontFamily }),
    vegaThemeConfig: buildVegaThemeConfig({ isDarkTheme, fontFamily }),
    mermaidCandidates
  };
}

export async function buildMarkdownCanvasPreviewDocument({ text = '', baseHref = '/', commonStyle = '' } = {}) {
  const payload = await buildMarkdownCanvasPreviewPayload({ text });
  return buildMarkdownCanvasPreviewHtmlDocument({
    baseHref,
    commonStyle,
    initialPayload: payload
  });
}

function buildMarkdownCanvasPreviewHtmlDocument({ baseHref = '/', commonStyle = '', initialPayload = null } = {}) {
  const isDarkTheme = isDarkThemeRoot(document?.documentElement);
  const themeName = isDarkTheme ? 'dark' : 'light';
  const runtimeScript = buildMarkdownRuntimeScript(JSON.stringify(initialPayload || null));
  return `<!doctype html>
<html data-theme="${themeName}">
<head>
  <meta charset="utf-8">
  <base href="${baseHref}">
  <link rel="stylesheet" href="/libs/github.min.css">
  <link rel="stylesheet" href="/libs/katex.min.css">
  <style>
    ${commonStyle}
    html, body {
      background: transparent !important;
      color: var(--canvas-preview-text);
      color-scheme: light dark;
      -webkit-font-smoothing: antialiased;
    }
    
    body {
      padding: 48px 64px 64px;
      overflow-x: hidden;
      overflow-y: auto;
      box-sizing: border-box;
    }
    
    .markdown-body-preview {
      width: 100%;
      max-width: 860px;
      margin: 0 auto;
      font-family: var(--canvas-preview-font);
      font-size: 16px;
      line-height: 1.8;
      color: var(--canvas-preview-text);
      background: transparent;
      word-wrap: break-word;
    }

    .markdown-body-preview h1, 
    .markdown-body-preview h2, 
    .markdown-body-preview h3, 
    .markdown-body-preview h4 {
      line-height: 1.35;
      margin-top: 2em;
      margin-bottom: 0.8em;
      font-weight: 600;
      color: var(--canvas-preview-text);
    }
    .markdown-body-preview h1:first-child, 
    .markdown-body-preview h2:first-child, 
    .markdown-body-preview h3:first-child { margin-top: 0; }
    
    .markdown-body-preview h1 { 
      font-size: 2.2em; 
      padding-bottom: 0.3em; 
      border-bottom: 1px solid var(--canvas-preview-border); 
    }
    .markdown-body-preview h2 { 
      font-size: 1.6em; 
      padding-bottom: 0.3em; 
      border-bottom: 1px solid var(--canvas-preview-border); 
    }
    .markdown-body-preview h3 { font-size: 1.3em; }
    .markdown-body-preview h4 { font-size: 1.1em; }

    .markdown-body-preview p,
    .markdown-body-preview ul,
    .markdown-body-preview ol {
      margin-top: 0;
      margin-bottom: 1.2em;
    }
    .markdown-body-preview ul, 
    .markdown-body-preview ol { padding-left: 2em; }

    .markdown-body-preview li { margin-top: 0.35em; }
    .markdown-body-preview li > p { margin-top: 0.35em; margin-bottom: 0.35em; }

    .markdown-body-preview a {
      color: var(--canvas-preview-link);
      text-decoration-color: color-mix(in srgb, var(--canvas-preview-link) 65%, transparent);
      text-underline-offset: 0.16em;
    }
    .markdown-body-preview a:hover,
    .markdown-body-preview a:focus-visible {
      color: var(--canvas-preview-link-hover);
      text-decoration-color: currentColor;
    }

    .markdown-body-preview code {
      padding: 0.2em 0.4em;
      margin: 0;
      font-size: 85%;
      background-color: color-mix(in srgb, var(--canvas-preview-muted) 15%, transparent);
      border-radius: 4px;
      font-family: var(--canvas-preview-code-font);
    }

    .markdown-body-preview blockquote {
      margin: 1.5em 0;
      padding: 0.8em 1.2em;
      color: var(--canvas-preview-muted);
      background: color-mix(in srgb, var(--canvas-preview-surface) 60%, transparent);
      border-left: 4px solid var(--canvas-preview-border);
      border-radius: 0 8px 8px 0;
    }
    .markdown-body-preview blockquote p:last-child { margin-bottom: 0; }
    .markdown-body-preview img {
      display: block;
      max-width: 100%;
      height: auto;
    }

    .markdown-body-preview pre {
      margin: 1.5em 0;
      padding: 16px;
      background: var(--canvas-preview-surface);
      border: 1px solid var(--canvas-preview-border);
      border-radius: 8px;
      overflow: auto;
      line-height: 1.5;
      touch-action: auto;
      -webkit-overflow-scrolling: touch;
    }
    .markdown-body-preview pre code {
      display: block;
      padding: 0;
      background-color: transparent;
      font-size: 90%;
      font-family: var(--canvas-preview-code-font);
      white-space: pre;
      overflow-wrap: normal;
      word-break: normal;
      min-width: max-content;
    }

    .markdown-body-preview table {
      border-spacing: 0;
      border-collapse: collapse;
      width: 100%;
      min-width: 600px;
      text-align: left;
      table-layout: auto;
    }
    .markdown-body-preview table thead th {
      font-weight: 600;
      background-color: #f8f9fa;
      color: var(--canvas-preview-text);
      border-bottom: 2px solid var(--canvas-preview-border);
    }
    .markdown-body-preview table th,
    .markdown-body-preview table td {
      padding: 8px 14px;
      border: 1px solid var(--canvas-preview-border);
      vertical-align: top;
      overflow-wrap: break-word;
      word-break: normal;
      white-space: normal;
    }
    .table-wrapper {
      overflow-x: auto;
      max-width: 100%;
      margin: 1.5em 0;
      border: 1px solid var(--canvas-preview-border);
      border-radius: 8px;
      touch-action: auto;
      -webkit-overflow-scrolling: touch;
    }
    .table-wrapper table { margin: 0; }

    .md-mermaid {
      margin: 16px 0;
      max-width: 100%;
      overflow: auto;
      touch-action: auto;
      -webkit-overflow-scrolling: touch;
    }
    .md-mermaid svg {
      display: block;
      max-width: 100%;
      height: auto !important;
      shape-rendering: geometricPrecision;
      text-rendering: optimizeLegibility;
    }
    .md-vega-host {
      width: 100%;
      max-width: 900px;
      margin: 16px auto;
      padding: 12px;
      box-sizing: border-box;
      border: 1px solid var(--canvas-preview-border);
      border-radius: 8px;
      background: var(--canvas-preview-surface);
      overflow: auto;
      touch-action: auto;
      -webkit-overflow-scrolling: touch;
    }
    .md-vega-host .vega-embed,
    .md-vega-host .vega-embed > div {
      max-width: 100%;
    }
    .md-vega-host svg,
    .md-vega-host canvas {
      display: block;
      max-width: 100%;
      height: auto !important;
    }
    .md-vega-host svg {
      width: 100%;
    }
    .md-vega-host svg {
      shape-rendering: geometricPrecision;
      text-rendering: optimizeLegibility;
    }
    .md-vega-error, .md-math-error { margin-top: 8px; padding: 10px; border: 1px solid #fca5a5; border-radius: 8px; background: #fff1f2; color: #991b1b; white-space: pre-wrap; font: 13px/1.5 var(--canvas-preview-code-font); }
    .katex-display {
      max-width: 100%;
      overflow-x: auto;
      overflow-y: hidden;
      padding: 4px 0;
      text-align: center;
      touch-action: auto;
      -webkit-overflow-scrolling: touch;
    }
    .katex-display > .katex {
      display: inline-block;
      min-width: max-content;
      text-align: left;
    }

    .markdown-body-preview pre,
    .table-wrapper,
    .md-mermaid,
    .md-vega-host,
    .katex-display {
      scrollbar-color: var(--canvas-preview-scrollbar-thumb) var(--canvas-preview-scrollbar-track);
      scrollbar-width: thin;
    }

    .markdown-body-preview pre::-webkit-scrollbar,
    .table-wrapper::-webkit-scrollbar,
    .md-mermaid::-webkit-scrollbar,
    .md-vega-host::-webkit-scrollbar,
    .katex-display::-webkit-scrollbar {
      height: var(--canvas-preview-scrollbar-size);
      width: var(--canvas-preview-scrollbar-size);
    }

    .markdown-body-preview pre::-webkit-scrollbar-button,
    .table-wrapper::-webkit-scrollbar-button,
    .md-mermaid::-webkit-scrollbar-button,
    .md-vega-host::-webkit-scrollbar-button,
    .katex-display::-webkit-scrollbar-button {
      display: none !important;
      width: 0 !important;
      height: 0 !important;
    }

    .markdown-body-preview pre::-webkit-scrollbar-track,
    .table-wrapper::-webkit-scrollbar-track,
    .md-mermaid::-webkit-scrollbar-track,
    .md-vega-host::-webkit-scrollbar-track,
    .katex-display::-webkit-scrollbar-track {
      background: var(--canvas-preview-scrollbar-track);
    }

    .markdown-body-preview pre::-webkit-scrollbar-thumb,
    .table-wrapper::-webkit-scrollbar-thumb,
    .md-mermaid::-webkit-scrollbar-thumb,
    .md-vega-host::-webkit-scrollbar-thumb,
    .katex-display::-webkit-scrollbar-thumb {
      background-color: var(--canvas-preview-scrollbar-thumb);
      border-radius: var(--canvas-preview-scrollbar-radius);
      background-clip: padding-box;
      border: var(--canvas-preview-scrollbar-border);
    }

    .markdown-body-preview pre::-webkit-scrollbar-thumb:hover,
    .table-wrapper::-webkit-scrollbar-thumb:hover,
    .md-mermaid::-webkit-scrollbar-thumb:hover,
    .md-vega-host::-webkit-scrollbar-thumb:hover,
    .katex-display::-webkit-scrollbar-thumb:hover {
      background-color: var(--canvas-preview-scrollbar-thumb-hover);
    }

    html[data-theme='dark'] .markdown-body-preview table thead th {
      background-color: var(--canvas-preview-surface);
    }

    @media (max-width: 720px) {
      body { padding: 32px 24px 48px; }
      .markdown-body-preview { max-width: 100%; }
    }
    @media (max-width: 480px) {
      body { padding: 24px 16px 36px; }
      .md-vega-host { max-width: 100%; margin: 12px auto; }
    }
  </style>
</head>
<body>
  <main id="md" class="markdown-body-preview"></main>
  <script>${runtimeScript}</script>
</body>
</html>`;
}

export const MARKDOWN_CANVAS_RENDERER = {
  types: ['markdown'],
  previewEnabled: true,
  buildPreviewDocument: buildMarkdownCanvasPreviewDocument
};
