import { normalizeCanvasType } from './canvas-utils.js';
import { HTML_CANVAS_RENDERER } from './html-canvas-renderer.js';
import { MARKDOWN_CANVAS_RENDERER } from './markdown-canvas-renderer.js';
import { MARKMAP_CANVAS_RENDERER } from './markmap-canvas-renderer.js';
import { P5_CANVAS_RENDERER } from './p5-canvas-renderer.js';
import { REACT_CANVAS_RENDERER } from './react-canvas-renderer.js';
import { SVG_CANVAS_RENDERER } from './svg-canvas-renderer.js';
import { VUE_CANVAS_RENDERER } from './vue-canvas-renderer.js';

export const CANVAS_RENDERERS = Object.freeze([
    HTML_CANVAS_RENDERER,
    SVG_CANVAS_RENDERER,
    MARKDOWN_CANVAS_RENDERER,
    MARKMAP_CANVAS_RENDERER,
    REACT_CANVAS_RENDERER,
    VUE_CANVAS_RENDERER,
    P5_CANVAS_RENDERER
]);

const CANVAS_RENDERER_BY_TYPE = new Map();
const PREVIEW_DOCUMENT_CACHE_LIMIT = 48;
const PREVIEW_DOCUMENT_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const previewDocumentCache = new Map();
let previewDocumentCacheBytes = 0;
for (const renderer of CANVAS_RENDERERS) {
    for (const type of renderer.types || []) {
        CANVAS_RENDERER_BY_TYPE.set(normalizeCanvasType(type), renderer);
    }
}

export function getCanvasRenderer(type = '') {
    return CANVAS_RENDERER_BY_TYPE.get(normalizeCanvasType(type)) || null;
}

export function isCanvasPreviewEnabled(type = '') {
    const renderer = getCanvasRenderer(type);
    return !!renderer?.previewEnabled;
}

export function getCanvasPreviewThemeSignature() {
    const root = document.documentElement;
    const rootStyles = window.getComputedStyle(root);
    return [
        root.getAttribute('data-theme') || '',
        rootStyles.getPropertyValue('--main-bg').trim(),
        rootStyles.getPropertyValue('--code-bg').trim(),
        rootStyles.getPropertyValue('--text-color').trim(),
        rootStyles.getPropertyValue('--secondary-text-color').trim(),
        rootStyles.getPropertyValue('--border-color').trim(),
        rootStyles.getPropertyValue('--app-font-family').trim(),
        rootStyles.getPropertyValue('--code-font-family').trim()
    ].join('|');
}

function getCanvasPreviewContext() {
    const baseHref = `${window.location.origin}/`;
    const root = document.documentElement;
    const rootStyles = window.getComputedStyle(root);
    const isDarkTheme = String(root?.getAttribute('data-theme') || '').toLowerCase() === 'dark';
    const previewBg = (rootStyles.getPropertyValue('--main-bg') || '').trim() || (isDarkTheme ? '#1e1e1e' : '#ffffff');
    const previewSurface = (rootStyles.getPropertyValue('--main-bg') || '').trim() || (isDarkTheme ? '#111827' : '#ffffff');
    const previewText = (rootStyles.getPropertyValue('--text-color') || '').trim() || (isDarkTheme ? '#e5e7eb' : '#111827');
    const previewMuted = (rootStyles.getPropertyValue('--secondary-text-color') || '').trim() || (isDarkTheme ? '#94a3b8' : '#6b7280');
    const previewBorder = (rootStyles.getPropertyValue('--border-color') || '').trim() || (isDarkTheme ? '#334155' : '#e5e7eb');
    const previewSelection = (rootStyles.getPropertyValue('--selection-bg') || '').trim() || (isDarkTheme ? 'rgba(59, 130, 246, 0.40)' : 'rgba(26, 115, 232, 0.24)');
    const previewLink = isDarkTheme ? '#60a5fa' : '#2563eb';
    const previewLinkHover = isDarkTheme ? '#93c5fd' : '#1d4ed8';
    const previewFont = (rootStyles.getPropertyValue('--app-font-family') || '').trim() || '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const previewCodeFont = (rootStyles.getPropertyValue('--code-font-family') || '').trim() || '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    const scrollbarSize = (rootStyles.getPropertyValue('--app-scrollbar-size') || '').trim() || '10px';
    const scrollbarThumb = (rootStyles.getPropertyValue('--app-scrollbar-thumb') || '').trim() || (isDarkTheme ? 'rgba(203, 213, 225, 0.42)' : 'rgba(109, 119, 133, 0.28)');
    const scrollbarThumbHover = (rootStyles.getPropertyValue('--app-scrollbar-thumb-hover') || '').trim() || (isDarkTheme ? 'rgba(203, 213, 225, 0.58)' : 'rgba(109, 119, 133, 0.46)');
    const scrollbarTrack = (rootStyles.getPropertyValue('--app-scrollbar-track') || '').trim() || 'transparent';
    const scrollbarRadius = (rootStyles.getPropertyValue('--app-scrollbar-radius') || '').trim() || '999px';
    const scrollbarBorder = (rootStyles.getPropertyValue('--app-scrollbar-border') || '').trim() || '3px solid transparent';
    const commonStyle = `
:root {
  --canvas-preview-bg: ${previewBg};
  --canvas-preview-surface: ${previewSurface};
  --canvas-preview-text: ${previewText};
  --canvas-preview-muted: ${previewMuted};
  --canvas-preview-border: ${previewBorder};
  --canvas-preview-selection: ${previewSelection};
  --canvas-preview-link: ${previewLink};
  --canvas-preview-link-hover: ${previewLinkHover};
  --canvas-preview-font: ${previewFont};
  --canvas-preview-code-font: ${previewCodeFont};
  --canvas-preview-scrollbar-size: ${scrollbarSize};
  --canvas-preview-scrollbar-thumb: ${scrollbarThumb};
  --canvas-preview-scrollbar-thumb-hover: ${scrollbarThumbHover};
  --canvas-preview-scrollbar-track: ${scrollbarTrack};
  --canvas-preview-scrollbar-radius: ${scrollbarRadius};
  --canvas-preview-scrollbar-border: ${scrollbarBorder};
}
html,
body {
  font-family: var(--canvas-preview-font);
  scrollbar-color: var(--canvas-preview-scrollbar-thumb) var(--canvas-preview-scrollbar-track);
  scrollbar-width: thin;
  touch-action: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: auto;
}
::selection {
  background-color: var(--canvas-preview-selection);
  color: inherit;
  text-shadow: none;
}
::-webkit-scrollbar {
  width: var(--canvas-preview-scrollbar-size);
  height: var(--canvas-preview-scrollbar-size);
}
::-webkit-scrollbar-button {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
}
::-webkit-scrollbar-track,
::-webkit-scrollbar-corner {
  background: var(--canvas-preview-scrollbar-track);
}
::-webkit-scrollbar-thumb {
  background-color: var(--canvas-preview-scrollbar-thumb);
  border-radius: var(--canvas-preview-scrollbar-radius);
  border: var(--canvas-preview-scrollbar-border);
  background-clip: padding-box;
}
::-webkit-scrollbar-thumb:hover {
  background-color: var(--canvas-preview-scrollbar-thumb-hover);
}
pre,
code,
kbd,
samp {
  font-family: var(--canvas-preview-code-font);
}
`;
    return {
        baseHref,
        commonStyle,
        themeSignature: getCanvasPreviewThemeSignature()
    };
}

function estimatePreviewDocumentBytes(html) {
    return String(html || '').length * 2;
}

function deletePreviewDocumentCacheEntry(cacheKey) {
    const cached = previewDocumentCache.get(cacheKey);
    if (!cached) return;
    previewDocumentCacheBytes = Math.max(0, previewDocumentCacheBytes - cached.bytes);
    previewDocumentCache.delete(cacheKey);
}

function rememberPreviewDocument(cacheKey, html) {
    const bytes = estimatePreviewDocumentBytes(html);
    if (bytes > PREVIEW_DOCUMENT_CACHE_MAX_BYTES) return;

    deletePreviewDocumentCacheEntry(cacheKey);
    previewDocumentCache.set(cacheKey, { html, bytes });
    previewDocumentCacheBytes += bytes;

    while (
        previewDocumentCache.size > PREVIEW_DOCUMENT_CACHE_LIMIT ||
        previewDocumentCacheBytes > PREVIEW_DOCUMENT_CACHE_MAX_BYTES
    ) {
        const oldestKey = previewDocumentCache.keys().next().value;
        if (!oldestKey) break;
        deletePreviewDocumentCacheEntry(oldestKey);
    }
}

export async function buildCanvasPreviewDocument({ type = '', source = '' }) {
    const normalizedType = normalizeCanvasType(type);
    const text = String(source || '');
    const context = getCanvasPreviewContext();
    const cacheKey = `${normalizedType}::${context.themeSignature}::${text}`;
    if (previewDocumentCache.has(cacheKey)) {
        const cached = previewDocumentCache.get(cacheKey);
        previewDocumentCache.delete(cacheKey);
        previewDocumentCache.set(cacheKey, cached);
        return cached.html;
    }
    const renderer = getCanvasRenderer(normalizedType);
    if (!renderer?.previewEnabled || typeof renderer.buildPreviewDocument !== 'function') {
        return null;
    }

    const html = await renderer.buildPreviewDocument({
        type: normalizedType,
        text,
        baseHref: context.baseHref,
        commonStyle: context.commonStyle
    });
    if (typeof html === 'string' && html.trim()) {
        rememberPreviewDocument(cacheKey, html);
    }
    return html;
}
