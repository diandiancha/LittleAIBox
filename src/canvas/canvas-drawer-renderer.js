import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { getCurrentLanguage, t } from '../i18n.js';
import {
    isChatPinnedToBottom,
    isChatPinnedToTop,
    preserveElementInViewDuringLayout,
    preservePinnedChatBottomDuringLayout,
    preservePinnedChatTopDuringLayout
} from '../scroll/chat-bottom-pin.js';
import { closeSideloading, isSideloadingPendingOpen, openSideloading } from '../sideloading/sideloading-controller.js';
import { createSideloadingHeader } from '../sideloading/sideloading-header.js';
import { SIDELOADING_ICONS } from '../sideloading/sideloading-icons.js';
import { preserveSelectionDuringUpdate, selectionIntersectsNode } from '../stream-selection-guard.js';
import {
    applyCodeChunkHighlight,
    buildHighlightChunks,
    isCodeChunkStateActive,
    markCodeChunksEdited,
    mountCodeChunks,
    releaseCodeChunks
} from './canvas-code-chunks.js';
import { canUseCanvasHighlightWorker, highlightInCanvasWorker } from './canvas-highlight-worker-client.js';
import {
    buildCanvasPreviewDocument,
    getCanvasPreviewThemeSignature,
    isCanvasPreviewEnabled
} from './canvas-renderer-registry.js';
import { closeStreamingJsxTags, truncateHighlightedHtml } from './canvas-stream-highlight.js';
import { normalizeCanvasType } from './canvas-utils.js';
import {
    canvasAutoOpenedKeys,
    canvasAutoOpenSuppressedGroups,
    canvasGroupCardCounts,
    cardStateMap,
    formatCanvasTimeDisplay,
    getCanvasCardCache,
    getCanvasGroupKey,
    getText,
    highlightLanguageLoadPromises,
    isSameCanvasIdentity,
    normalizeCanvasTimestamp,
    scheduleStreamScrollToBottom,
    streamHighlightState
} from './shared-canvas-renderer.js';

const MIN_PREVIEW_LOADING_MS = 1500;
const PREVIEW_RENDER_TIMEOUT_MS = 10000;
const DRAWER_CLOSE_PREVIEW_UNLOAD_DELAY_MS = 500;
const HIGHLIGHT_CACHE_LIMIT = 24;
const HIGHLIGHT_CACHE_CHAR_BUDGET = 8000000;
const HIGHLIGHT_WORKER_CHAR_THRESHOLD = 2000;
const PREVIEW_RENDER_DEBOUNCE_MS = 200;
const PREVIEW_RENDER_MESSAGE = '__canvas_render__';
const PREVIEW_RENDER_DONE_MESSAGE = '__canvas_render_done__';
const PREVIEW_OPEN_LINK_MESSAGE = '__canvas_open_link__';
const PREVIEW_MESSAGE_SOURCE = 'littleaibox-canvas-preview';
const PREVIEW_PAYLOAD_NAME_PREFIX = '__littleaibox_canvas_payload__';
const PREVIEW_BOOTSTRAP_SCRIPT = `<script>
(function() {
    if (window.__canvasPreviewReceiverInstalled) return;
    window.__canvasPreviewReceiverInstalled = true;

    function handleLinkIntercept(event) {
        var target = event.target;
        while (target && String(target.tagName || '').toUpperCase() !== 'A') {
            target = target.parentElement;
        }
        if (!target) return;

        var hrefRaw = target.getAttribute('href') || target.getAttribute('xlink:href') || '';
        var href = typeof hrefRaw === 'string' ? hrefRaw : (hrefRaw && hrefRaw.baseVal ? hrefRaw.baseVal : String(hrefRaw || ''));
        if (!href) return;

        if (target.hasAttribute('download')) return;

        var lowerHref = href.trim().toLowerCase();
        if (lowerHref.indexOf('javascript:') === 0 ||
            lowerHref.indexOf('mailto:') === 0 ||
            lowerHref.indexOf('tel:') === 0 ||
            lowerHref.indexOf('sms:') === 0) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        var firstChar = href.charAt(0);
        if (firstChar === '#' || firstChar === '?') {
            var targetValue = href.slice(1);
            if (firstChar === '#' && targetValue && targetValue.indexOf('/') === -1) {
                var el = document.getElementById(targetValue) || document.getElementsByName(targetValue)[0];
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth' });
                    return;
                }
            }
            try {
                if (firstChar === '#') {
                    window.location.hash = targetValue;
                } else {
                    window.location.search = href;
                }
            } catch (_) {}
            return;
        }

        try {
            var openUrl = target.href;
            if (typeof openUrl !== 'string' && openUrl && openUrl.baseVal) {
                openUrl = openUrl.baseVal;
            }
            try {
                window.parent.postMessage({
                    source: '${PREVIEW_MESSAGE_SOURCE}',
                    type: '${PREVIEW_OPEN_LINK_MESSAGE}',
                    url: String(openUrl || '')
                }, '*');
            } catch (_) {}
            window.open(openUrl, '_blank', 'noopener,noreferrer');
        } catch (_) {}
    }

    window.addEventListener('click', handleLinkIntercept, true);
    window.addEventListener('auxclick', handleLinkIntercept, true);

    window.addEventListener('submit', function(event) {
        event.preventDefault();
    }, true);

    function buildDoneScript(loadSeq) {
        return "\\n<scr" + "ipt>\\n" +
            "(function() {\\n" +
            "    function report() {\\n" +
            "        try { window.parent.postMessage({ type: '${PREVIEW_RENDER_DONE_MESSAGE}', loadSeq: " + Number(loadSeq || 0) + " }, '*'); } catch (_) {}\\n" +
            "    }\\n" +
            "    if (document.readyState === 'complete') { report(); }\\n" +
            "    else { window.addEventListener('load', report, { once: true }); }\\n" +
            "})();\\n" +
            "<\\/scr" + "ipt>";
    }

    function writePreviewPayload(payload) {
        var html = String(payload.html || '');
        var script = String(payload.script || '');
        var loadSeq = Number(payload.loadSeq || 0);
        window.name = '';
        window.__canvasPreviewReceiverInstalled = false;
        setTimeout(function() {
            document.open('text/html', 'replace');
            document.write(html + script + buildDoneScript(loadSeq));
            document.close();
        }, 0);
    }

    try {
        var existingName = String(window.name || '');
        if (existingName.indexOf('${PREVIEW_PAYLOAD_NAME_PREFIX}') === 0) {
            var payload = JSON.parse(existingName.slice(${PREVIEW_PAYLOAD_NAME_PREFIX.length}));
            writePreviewPayload(payload);
            return;
        }
    } catch (_) {
        window.name = '';
    }

    function clearPreviewTimers() {
        var highestTimeoutId = setTimeout(function() {}, 0);
        for (var i = 0; i <= highestTimeoutId; i += 1) {
            clearTimeout(i);
            clearInterval(i);
        }
    }
    window.addEventListener('message', function(event) {
        if (!event.data || event.data.type !== '${PREVIEW_RENDER_MESSAGE}') return;
        clearPreviewTimers();
        writePreviewPayload({
            html: String(event.data.html || ''),
            script: String(event.data.script || ''),
            loadSeq: Number(event.data.loadSeq || 0)
        });
    });
})();
<\/script>`;
const PREVIEW_BOOTSTRAP_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body></body>
${PREVIEW_BOOTSTRAP_SCRIPT}
</html>`;

let drawerState = null;
const highlightedSourceCache = new Map();
let highlightedSourceCacheChars = 0;
const canvasCodeScrollPositions = new Map();
const canvasEditedSourceMap = new Map();
const pendingStreamingCodeRenders = new WeakMap();
const codeScrollbarTimers = new WeakMap();
const pendingAutoOpenRafs = new Map();
let canvasCaretViewportTrackingConfigured = false;
function suppressAutoOpenForCard(card) {
    const groupKey = card?.dataset?.canvasGroupKey ||
        getCanvasGroupKey(card?.closest?.('.content') || card?.parentElement || card, {});
    if (groupKey) {
        canvasAutoOpenSuppressedGroups.add(groupKey);
    }

    const payloadId = card?.__canvasPayload?.id || 'first';
    const openKey = `${groupKey}::${payloadId}`;
    canvasAutoOpenedKeys.add(openKey);

    for (const key of Array.from(pendingAutoOpenRafs.keys())) {
        if (key === openKey || key.startsWith(`${groupKey}::`)) {
            const pending = pendingAutoOpenRafs.get(key);
            if (pending && typeof pending === 'object') {
                if (pending.firstRaf) cancelAnimationFrame(pending.firstRaf);
                if (pending.secondRaf) cancelAnimationFrame(pending.secondRaf);
            }
            pendingAutoOpenRafs.delete(key);
        }
    }
}

function dispatchCanvasDrawerEvent(name, detail = {}) {
    try {
        document.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (_) { }
}

function requestCanvasDrawerCloseFromUser(source = 'drawer') {
    const activeCard = drawerState?.activeCard || null;
    let handled = false;
    try {
        const event = new CustomEvent('lab:canvas-drawer-close-requested', {
            detail: {
                source,
                payloadId: drawerState?.activePayload?.id || ''
            },
            cancelable: true
        });
        document.dispatchEvent(event);
        handled = event.defaultPrevented === true;
    } catch (_) {
        handled = false;
    }
    if (handled) {
        suppressAutoOpenForCard(activeCard);
    }
    return handled;
}

function focusCanvasDrawerShell(ds = drawerState) {
    const drawer = ds?.drawer;
    if (!drawer || !drawer.isConnected) return;
    try {
        drawer.focus({ preventScroll: true });
    } catch (_) {
        try { drawer.focus(); } catch (_) { }
    }
}

function initializePreviewFrame(frame) {
    if (!frame || frame.dataset.bootstrapAttached === 'true') return;
    frame.dataset.bootstrapAttached = 'true';
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('tabindex', '-1');
    frame.addEventListener('load', () => {
        frame.dataset.bootstrapped = 'true';
    });
    frame.srcdoc = PREVIEW_BOOTSTRAP_HTML;
}

function createPreviewFrameFrom(previousFrame = null) {
    const frame = document.createElement('iframe');
    frame.className = previousFrame?.className || 'canvas-drawer-preview';
    frame.setAttribute('tabindex', '-1');
    if (previousFrame?.style?.cssText) {
        frame.style.cssText = previousFrame.style.cssText;
    }
    initializePreviewFrame(frame);
    return frame;
}

function resetDrawerPreviewFrame(ds = drawerState) {
    const previousFrame = ds?.previewEl;
    if (!previousFrame?.parentNode) return previousFrame || null;
    const frame = createPreviewFrameFrom(previousFrame);
    previousFrame.replaceWith(frame);
    ds.previewEl = frame;
    return frame;
}

function getCanvasPayloadKey(payload) {
    return String(payload?.id || '').trim();
}

function getCanvasPayloadSource(payload) {
    if (!payload) return '';
    const key = getCanvasPayloadKey(payload);
    if (key && canvasEditedSourceMap.has(key)) {
        return canvasEditedSourceMap.get(key) || '';
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'editedSource')) {
        return String(payload.editedSource || '');
    }
    return String(payload.source || '');
}

function setCanvasPayloadEditedSource(payload, source) {
    if (!payload) return;
    const text = String(source || '');
    payload.editedSource = text;
    const key = getCanvasPayloadKey(payload);
    if (key) {
        canvasEditedSourceMap.set(key, text);
    }
    if (drawerState?.activePayload === payload && drawerState.activeCard?.__canvasPayload) {
        drawerState.activeCard.__canvasPayload.editedSource = text;
    }
}

function storeActiveCodeScroll(ds = drawerState) {
    const key = getCanvasPayloadKey(ds?.activePayload);
    if (!key || !ds?.codeEl) return;
    canvasCodeScrollPositions.set(key, {
        left: ds.codeEl.scrollLeft || 0,
        top: ds.codeEl.scrollTop || 0
    });
}

function restoreCodeScrollForPayload(ds = drawerState, payload = null) {
    const key = getCanvasPayloadKey(payload || ds?.activePayload);
    if (!key || !ds?.codeEl) return;
    const hasSavedScroll = canvasCodeScrollPositions.has(key);
    const savedScroll = hasSavedScroll ? canvasCodeScrollPositions.get(key) : null;
    const nextScrollTop = hasSavedScroll
        ? (typeof savedScroll === 'number' ? savedScroll : savedScroll?.top || 0)
        : 0;
    const nextScrollLeft = hasSavedScroll
        ? (typeof savedScroll === 'number' ? 0 : savedScroll?.left || 0)
        : 0;
    requestAnimationFrame(() => {
        if (!ds?.codeEl || getCanvasPayloadKey(ds.activePayload) !== key) return;
        ds.codeEl.scrollTop = nextScrollTop;
        ds.codeEl.scrollLeft = nextScrollLeft;
    });
}

function getHighlightCache(cacheKey) {
    const entry = highlightedSourceCache.get(cacheKey);
    if (!entry) return null;
    highlightedSourceCache.delete(cacheKey);
    highlightedSourceCache.set(cacheKey, entry);
    return entry.chunks;
}

function setHighlightCache(cacheKey, chunks) {
    if (!cacheKey || !Array.isArray(chunks)) return;
    const previous = highlightedSourceCache.get(cacheKey);
    if (previous) {
        highlightedSourceCacheChars -= previous.chars;
        highlightedSourceCache.delete(cacheKey);
    }
    const chars = chunks.reduce((total, chunk) => total + chunk.length, cacheKey.length);
    if (chars > HIGHLIGHT_CACHE_CHAR_BUDGET) return;
    highlightedSourceCache.set(cacheKey, { chunks, chars });
    highlightedSourceCacheChars += chars;
    while (highlightedSourceCache.size > HIGHLIGHT_CACHE_LIMIT || highlightedSourceCacheChars > HIGHLIGHT_CACHE_CHAR_BUDGET) {
        const oldestKey = highlightedSourceCache.keys().next().value;
        highlightedSourceCacheChars -= highlightedSourceCache.get(oldestKey).chars;
        highlightedSourceCache.delete(oldestKey);
    }
}

function storeHighlightChunks(cacheKey, text, html) {
    const chunks = buildHighlightChunks(text, html);
    if (chunks) setHighlightCache(cacheKey, chunks);
    return chunks;
}

function prewarmCanvasHighlight(payload, { touch = false } = {}) {
    if (!payload?.isFinalRender) return;
    const language = resolveHighlightLanguage(payload.type);
    if (!canHighlightInWorker(language)) return;
    const text = normalizeCodeViewSource(getCanvasPayloadSource(payload));
    if (!text) return;
    const cacheKey = `${language}::${text}`;
    if (highlightedSourceCache.has(cacheKey)) {
        if (touch) getHighlightCache(cacheKey);
        return;
    }
    highlightInCanvasWorker(text, language, getHighlightLanguageDependencies(language)).then((htmlContent) => {
        storeHighlightChunks(cacheKey, text, htmlContent);
    });
}

function getCodeChunkScrollTop(preElement, payloadKey) {
    const ds = drawerState;
    const isSettled = ds?.codeEl === preElement
        && ds.drawer?.classList.contains('is-open')
        && !document.body.classList.contains('sideloading-anim');
    if (isSettled) return preElement.scrollTop || 0;
    const saved = payloadKey ? canvasCodeScrollPositions.get(payloadKey) : null;
    return typeof saved === 'number' ? saved : saved?.top || 0;
}

function highlightCodeChunks(preElement, codeEl, chunkState, { text, language, hljs, useWorker, cacheKey, renderKey }) {
    const apply = (chunks, syncVisible) => applyCodeChunkHighlight(chunkState, chunks, {
        scrollTop: getCodeChunkScrollTop(preElement, codeEl.__canvasPayloadKey),
        syncVisible,
        onComplete: () => {
            if (codeEl.__canvasChunkState === chunkState) codeEl.__canvasRenderKey = renderKey;
        }
    });
    const cachedChunks = getHighlightCache(cacheKey);
    if (cachedChunks) {
        apply(cachedChunks, true);
        return;
    }
    if (chunkState.highlightRequested) return;
    chunkState.highlightRequested = true;
    if (!useWorker) {
        const chunks = storeHighlightChunks(cacheKey, text, highlightCanvasSource(hljs, text, language));
        if (chunks) apply(chunks, true);
        return;
    }
    highlightInCanvasWorker(text, language, getHighlightLanguageDependencies(language)).then((htmlContent) => {
        let chunks = storeHighlightChunks(cacheKey, text, htmlContent);
        if (!chunks && text.length <= HIGHLIGHT_WORKER_CHAR_THRESHOLD && hljs && typeof hljs.highlight === 'function') {
            chunks = storeHighlightChunks(cacheKey, text, highlightCanvasSource(hljs, text, language));
        }
        if (chunks && isCodeChunkStateActive(chunkState)) apply(chunks, false);
    });
}

function scheduleCanvasHighlightPrewarm(card) {
    if (!card || card.__canvasHighlightPrewarmBound) return;
    card.__canvasHighlightPrewarmBound = true;
    const prewarmOnInteraction = () => prewarmCanvasHighlight(card.__canvasPayload, { touch: true });
    card.addEventListener('pointerenter', prewarmOnInteraction, { passive: true });
    card.addEventListener('pointerdown', prewarmOnInteraction, { passive: true });
    card.addEventListener('focusin', prewarmOnInteraction);
    scheduleNonBlockingHighlight(() => {
        if (card.isConnected) prewarmCanvasHighlight(card.__canvasPayload);
    });
}

function scheduleNonBlockingHighlight(fn) {
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        return window.requestIdleCallback(fn, { timeout: 180 });
    }
    return setTimeout(fn, 0);
}

function invalidateCodeRenderCacheForPayload(preElement, payloadKey = '') {
    if (!preElement) return;
    const scrollEl = preElement.querySelector(':scope > .canvas-code-scroll');
    const codeEl = scrollEl?.querySelector(':scope > code')
        || preElement.querySelector(':scope > code');
    if (!codeEl) return;

    const previousPayloadKey = String(codeEl.__canvasPayloadKey || '');
    const nextPayloadKey = String(payloadKey || '');
    if (previousPayloadKey === nextPayloadKey) return;

    const pendingHighlight = streamHighlightState.get(codeEl);
    if (pendingHighlight) {
        cancelAnimationFrame(pendingHighlight.rafId);
        streamHighlightState.delete(codeEl);
    }
    codeEl.__canvasPayloadKey = nextPayloadKey;
    codeEl.__canvasRenderKey = '';
    codeEl.__canvasRenderVersion = (codeEl.__canvasRenderVersion || 0) + 1;
}

function scheduleStreamingCodeRender(preElement, source, type, options) {
    const text = normalizeCodeViewSource(source);
    const payloadKey = options?.payloadKey || '';
    const pending = pendingStreamingCodeRenders.get(preElement);
    if (pending) {
        pending.source = text;
        pending.type = type;
        pending.options = options;
        pending.payloadKey = payloadKey;
        return;
    }

    const state = {
        source: text,
        type,
        options,
        payloadKey,
        rafId: requestAnimationFrame(() => {
            pendingStreamingCodeRenders.delete(preElement);
            if (!preElement.isConnected) return;
            if (state.payloadKey && getCanvasPayloadKey(drawerState?.activePayload) !== state.payloadKey) return;
            renderCodeToPre(preElement, state.source, state.type, {
                ...state.options,
                __scheduledStreamingRender: true
            });
        })
    };
    pendingStreamingCodeRenders.set(preElement, state);
}

function cancelStreamingCodeRender(preElement) {
    const pending = pendingStreamingCodeRenders.get(preElement);
    if (!pending) return;
    cancelAnimationFrame(pending.rafId);
    pendingStreamingCodeRenders.delete(preElement);
}

function showCodeScrollbarsTemporarily(element) {
    if (!element) return;
    element.classList.add('is-scrolling');
    const existingTimer = codeScrollbarTimers.get(element);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }
    codeScrollbarTimers.set(element, setTimeout(() => {
        element.classList.remove('is-scrolling');
        codeScrollbarTimers.delete(element);
    }, 850));
}

function configureAutoHideCodeScrollbars(element) {
    if (!element || element.__canvasAutoHideScrollbarsConfigured) return;
    element.__canvasAutoHideScrollbarsConfigured = true;
    const reveal = () => showCodeScrollbarsTemporarily(element);
    element.addEventListener('scroll', reveal, { passive: true });
    element.addEventListener('wheel', reveal, { passive: true });
    element.addEventListener('touchmove', reveal, { passive: true });
    element.addEventListener('keydown', reveal);
}

function countCodeLines(source) {
    const text = String(source || '');
    if (!text) return 1;
    return text.split(/\r\n|\r|\n/).length;
}

function normalizeCodeViewSource(source) {
    return String(source || '').replace(/(?:\r\n|\r|\n)+$/g, '');
}

function ensureCodeLineNumberGutter(preElement) {
    if (!preElement) return null;
    let gutter = preElement.querySelector(':scope > .canvas-code-line-numbers');
    if (!gutter) {
        gutter = document.createElement('div');
        gutter.className = 'canvas-code-line-numbers';
        gutter.setAttribute('aria-hidden', 'true');
        preElement.insertBefore(gutter, preElement.firstChild || null);
    }
    return gutter;
}

function ensureCodeScrollElement(preElement) {
    if (!preElement) return null;
    let scrollEl = preElement.querySelector(':scope > .canvas-code-scroll');
    if (!scrollEl) {
        scrollEl = document.createElement('div');
        scrollEl.className = 'canvas-code-scroll';
        const existingCode = preElement.querySelector(':scope > code');
        if (existingCode) {
            scrollEl.appendChild(existingCode);
        }
        const gutter = ensureCodeLineNumberGutter(preElement);
        if (gutter?.nextSibling) {
            preElement.insertBefore(scrollEl, gutter.nextSibling);
        } else {
            preElement.appendChild(scrollEl);
        }
    }
    return scrollEl;
}

function updateCodeLineNumbers(preElement, source) {
    const gutter = ensureCodeLineNumberGutter(preElement);
    if (!gutter) return;
    setCodeLineNumberCount(gutter, countCodeLines(source));
}

function setCodeLineNumberCount(gutter, lineCount) {
    const nextCount = Math.max(1, Number(lineCount) || 1);
    if (Number(gutter.dataset.lineCount || '0') === nextCount) return;
    const numbers = new Array(nextCount);
    for (let i = 0; i < nextCount; i += 1) {
        numbers[i] = i + 1;
    }
    gutter.textContent = numbers.join('\n');
    gutter.dataset.lineCount = String(nextCount);
}

function getActiveCanvasCodeElement() {
    const active = document.activeElement;
    if (!active || !active.isContentEditable) return null;
    if (!drawerState?.codeEl?.contains(active)) return null;
    return active;
}

function getSelectionRectInElement(element) {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.commonAncestorContainer)) return null;
    const rects = range.getClientRects();
    if (rects.length > 0) return rects[rects.length - 1];
    return range.getBoundingClientRect();
}

function scrollCanvasCodeCaretIntoView() {
    const editableCode = getActiveCanvasCodeElement();
    const scroller = drawerState?.codeEl;
    if (!editableCode || !scroller) return;
    const caretRect = getSelectionRectInElement(editableCode);
    if (!caretRect || (caretRect.width === 0 && caretRect.height === 0)) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const viewport = window.visualViewport || null;
    const viewportBottom = viewport
        ? viewport.offsetTop + viewport.height
        : window.innerHeight;
    const viewportTop = viewport ? viewport.offsetTop : 0;
    const padding = 28;
    const visibleTop = Math.max(scrollerRect.top, viewportTop) + padding;
    const visibleBottom = Math.min(scrollerRect.bottom, viewportBottom) - padding;
    const visibleLeft = Math.max(scrollerRect.left, 0) + padding;
    const visibleRight = Math.min(scrollerRect.right, window.innerWidth) - padding;

    if (caretRect.bottom > visibleBottom) {
        scroller.scrollTop += caretRect.bottom - visibleBottom;
    } else if (caretRect.top < visibleTop) {
        scroller.scrollTop -= visibleTop - caretRect.top;
    }

    if (caretRect.right > visibleRight) {
        scroller.scrollLeft += caretRect.right - visibleRight;
    } else if (caretRect.left < visibleLeft) {
        scroller.scrollLeft -= visibleLeft - caretRect.left;
    }
    showCodeScrollbarsTemporarily(scroller);
}

function scheduleCanvasCodeCaretIntoView(delay = 0) {
    if (!drawerState) return;
    if (drawerState.caretScrollTimer) {
        clearTimeout(drawerState.caretScrollTimer);
    }
    drawerState.caretScrollTimer = setTimeout(() => {
        drawerState.caretScrollTimer = null;
        requestAnimationFrame(scrollCanvasCodeCaretIntoView);
    }, delay);
}

function configureCanvasCaretViewportTracking() {
    if (canvasCaretViewportTrackingConfigured) return;
    canvasCaretViewportTrackingConfigured = true;
    const schedule = () => scheduleCanvasCodeCaretIntoView(60);
    window.addEventListener('resize', schedule, { passive: true });
    document.addEventListener('selectionchange', () => {
        if (getActiveCanvasCodeElement()) scheduleCanvasCodeCaretIntoView();
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', schedule, { passive: true });
        window.visualViewport.addEventListener('scroll', schedule, { passive: true });
    }
}

function configureEditableCodeElement(codeEl) {
    if (!codeEl || codeEl.__canvasEditableConfigured) return;
    codeEl.__canvasEditableConfigured = true;
    try {
        codeEl.contentEditable = 'plaintext-only';
    } catch (_) {
        codeEl.contentEditable = 'true';
    }
    codeEl.spellcheck = false;
    codeEl.setAttribute('role', 'textbox');
    codeEl.setAttribute('aria-multiline', 'true');
    codeEl.addEventListener('input', () => {
        markCodeChunksEdited(codeEl);
        if (!drawerState?.activePayload || codeEl.__canvasRendering) return;
        const nextSource = codeEl.textContent || '';
        setCanvasPayloadEditedSource(drawerState.activePayload, nextSource);
        updateCodeLineNumbers(drawerState.codeEl, nextSource);
        drawerState.previewRenderedSource = '';
        clearDrawerPreviewTimers(drawerState);
        if (drawerState.contentEl?.classList.contains('show-preview') && drawerState.activePayload?.canPreview) {
            scheduleDrawerPreviewTimer(drawerState, () => {
                if (!drawerState?.contentEl?.classList.contains('show-preview')) return;
                ensureDrawerPreviewRendered();
            }, 350);
        }
        scheduleCanvasCodeCaretIntoView();
    });
    codeEl.addEventListener('focus', () => {
        scheduleCanvasCodeCaretIntoView(80);
    });
    codeEl.addEventListener('keyup', () => {
        scheduleCanvasCodeCaretIntoView();
    });
    codeEl.addEventListener('pointerup', () => {
        scheduleCanvasCodeCaretIntoView();
    });
    codeEl.addEventListener('blur', () => {
        if (!drawerState?.activePayload) return;
        renderCodeToPre(drawerState.codeEl, getCanvasPayloadSource(drawerState.activePayload), drawerState.activePayload.type, {
            highlight: true,
            streaming: false,
            payloadKey: getCanvasPayloadKey(drawerState.activePayload)
        });
    });
    codeEl.addEventListener('paste', (event) => {
        const text = event.clipboardData?.getData('text/plain');
        if (typeof text !== 'string') return;
        event.preventDefault();
        document.execCommand('insertText', false, text);
    });
}

function canRenderCanvasPreview(type) {
    const normalizedType = normalizeCanvasType(type);
    return isCanvasPreviewEnabled(normalizedType);
}

function shouldAutoOpenPreview(type) {
    const normalizedType = normalizeCanvasType(type);
    return normalizedType === 'html'
        || normalizedType === 'markdown'
        || normalizedType === 'markmap'
        || normalizedType === 'svg'
        || normalizedType === 'p5js'
        || normalizedType === 'vue'
        || normalizedType === 'react';
}

function shouldSwitchOpenDrawerToPreview(payload) {
    return !!(
        drawerState?.drawer?.classList.contains('is-open') &&
        payload?.canPreview &&
        payload?.isFinalRender &&
        shouldAutoOpenPreview(payload.type)
    );
}

async function buildPreviewDocumentForFrame(type, source) {
    const html = await buildCanvasPreviewDocument({
        type,
        source
    });
    if (typeof html === 'string' && html.trim()) {
        return html;
    }
    const safeType = escapeHtml(type);
    return `<!doctype html><html><body><pre style="white-space:pre-wrap;margin:16px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#991b1b">Preview is not available for this canvas type: ${safeType}</pre></body></html>`;
}

function resolveHighlightLanguage(type = '') {
    const value = normalizeCanvasType(type);
    if (value === 'html') return 'xml';
    if (value === 'svg') return 'xml';
    if (value === 'vue') return 'javascript';
    if (value === 'react') return 'javascript';
    if (value === 'p5js') return 'javascript';
    if (value === 'vega' || value === 'vega-lite') return 'json';
    if (value === 'shell') return 'bash';
    if (value === 'text' || value === 'code') return 'plaintext';
    return value || 'plaintext';
}

function escapeHtml(source = '') {
    return String(source)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function getHighlightLanguageDependencies(language) {
    const lang = String(language || '').trim() || 'plaintext';
    if (lang === 'xml') {
        return ['xml', 'css', 'javascript'];
    }
    if (lang === 'javascript' || lang === 'typescript') {
        return [lang, 'xml', 'css'];
    }
    return [lang];
}

function hasHighlightLanguage(hljs, language) {
    const lang = String(language || '').trim() || 'plaintext';
    if (lang === 'plaintext') return true;
    return !!(hljs && typeof hljs.getLanguage === 'function' && hljs.getLanguage(lang));
}

function loadHighlightLanguage(language) {
    const lang = String(language || '').trim() || 'plaintext';
    if (lang === 'plaintext') return Promise.resolve(true);

    const hljs = window.hljs;
    if (hasHighlightLanguage(hljs, lang)) {
        return Promise.resolve(true);
    }
    if (highlightLanguageLoadPromises.has(lang)) {
        return highlightLanguageLoadPromises.get(lang);
    }

    const promise = new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = `/libs/languages/${lang}.min.js`;
        script.async = true;
        script.onload = () => resolve(hasHighlightLanguage(window.hljs, lang));
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
    });

    highlightLanguageLoadPromises.set(lang, promise);
    promise.finally(() => {
        if (!hasHighlightLanguage(window.hljs, lang)) {
            highlightLanguageLoadPromises.delete(lang);
        }
    });
    return promise;
}

function ensureHighlightLanguages(language) {
    return Promise.all(getHighlightLanguageDependencies(language).map(loadHighlightLanguage))
        .then(results => results.every(Boolean));
}

function areHighlightLanguagesReady(hljs, language) {
    return getHighlightLanguageDependencies(language).every(lang => hasHighlightLanguage(hljs, lang));
}

function highlightSourceFragment(hljs, source, language) {
    const text = String(source || '');
    const lang = String(language || '').trim() || 'plaintext';
    if (!hljs || typeof hljs.highlight !== 'function') {
        return escapeHtml(text);
    }
    try {
        const hasLang = typeof hljs.getLanguage === 'function' ? !!hljs.getLanguage(lang) : false;
        if (hasLang) {
            return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
        }
    } catch (_) { }
    return escapeHtml(text);
}

function canHighlightInWorker(language) {
    const lang = String(language || '').trim() || 'plaintext';
    return lang !== 'plaintext' && canUseCanvasHighlightWorker(getHighlightLanguageDependencies(lang));
}

function highlightCanvasSource(hljs, source, language) {
    const lang = String(language || '').trim() || 'plaintext';
    return highlightSourceFragment(hljs, source, lang);
}

function getStreamSafeBoundary(source, language) {
    const text = normalizeCodeViewSource(source);
    const lang = String(language || '').trim();
    if (lang === 'javascript' || lang === 'typescript') {
        return { safeSource: text, rawSuffix: '' };
    }

    if (lang !== 'html' && lang !== 'xml') {
        return { safeSource: text, rawSuffix: '' };
    }

    const lastLt = text.lastIndexOf('<');
    const lastGt = text.lastIndexOf('>');
    if (lastLt > lastGt) {
        const tail = text.slice(lastLt + 1);
        const looksLikeTag = /^\/?[A-Za-z][\w:-]*[\s\S]*$/.test(tail)
            || /^![\s\S]*$/.test(tail)
            || /^\?[\s\S]*$/.test(tail);

        if (looksLikeTag) {
            return {
                safeSource: text.slice(0, lastLt),
                rawSuffix: text.slice(lastLt)
            };
        }
    }

    return { safeSource: text, rawSuffix: '' };
}

function highlightMarkupStreamingAware(hljs, source, language) {
    const text = String(source || '');
    const lang = String(language || '').trim();
    if (lang !== 'html' && lang !== 'xml') {
        return highlightSourceFragment(hljs, text, lang);
    }

    const lower = text.toLowerCase();
    const lastStyleOpen = lower.lastIndexOf('<style');
    const lastStyleClose = lower.lastIndexOf('</style>');
    const lastScriptOpen = lower.lastIndexOf('<script');
    const lastScriptClose = lower.lastIndexOf('</script>');
    const inStyle = lastStyleOpen > lastStyleClose;
    const inScript = lastScriptOpen > lastScriptClose;

    if (inStyle) {
        const openEnd = text.indexOf('>', lastStyleOpen);
        if (openEnd >= 0) {
            const before = text.slice(0, openEnd + 1);
            const cssBody = text.slice(openEnd + 1);
            return highlightSourceFragment(hljs, before, 'xml')
                + highlightSourceFragment(hljs, cssBody, 'css');
        }
    }

    if (inScript) {
        const openEnd = text.indexOf('>', lastScriptOpen);
        if (openEnd >= 0) {
            const before = text.slice(0, openEnd + 1);
            const jsBody = text.slice(openEnd + 1);
            return highlightSourceFragment(hljs, before, 'xml')
                + highlightSourceFragment(hljs, jsBody, 'javascript');
        }
    }

    return highlightSourceFragment(hljs, text, 'xml');
}

function computeStreamHighlightMarkup(hljs, source, language) {
    const { safeSource, rawSuffix } = getStreamSafeBoundary(source, language);
    const highlighted = safeSource
        ? highlightMarkupStreamingAware(hljs, safeSource, language)
        : '';
    return highlighted + (rawSuffix ? escapeHtml(rawSuffix) : '');
}

function getTrailingCodeTextNode(container) {
    let node = container?.lastChild || null;
    let visited = 0;
    while (node && node !== container && visited++ < 128) {
        if (node.nodeType === 3) return node;
        if (node.lastChild) {
            node = node.lastChild;
            continue;
        }
        while (node && node !== container && !node.previousSibling) node = node.parentNode;
        node = node && node !== container ? node.previousSibling : null;
    }
    return null;
}

function updateCodeSourceText(codeEl, text) {
    if (codeEl.__canvasChunkState) {
        releaseCodeChunks(codeEl);
        preserveSelectionDuringUpdate(codeEl, () => { codeEl.textContent = text; });
        return;
    }
    const previous = codeEl.textContent || '';
    if (previous === text) return;
    if (text.startsWith(previous)) {
        const suffix = text.slice(previous.length);
        const trailing = getTrailingCodeTextNode(codeEl);
        if (trailing) trailing.appendData(suffix);
        else codeEl.appendChild(document.createTextNode(suffix));
    } else {
        preserveSelectionDuringUpdate(codeEl, () => { codeEl.textContent = text; });
    }
}

function scheduleStreamHighlight(codeEl, source, language) {
    if (!codeEl) return;
    const text = String(source || '');
    const payloadKey = codeEl.__canvasPayloadKey || '';
    const existing = streamHighlightState.get(codeEl);
    if (existing) {
        existing.source = text;
        existing.language = language;
        existing.payloadKey = payloadKey;
        return;
    }

    const state = { source: text, language, payloadKey, rafId: 0 };
    const run = async () => {
        if (streamHighlightState.get(codeEl) !== state) return;
        const finish = () => {
            if (streamHighlightState.get(codeEl) === state) streamHighlightState.delete(codeEl);
        };
        if (!codeEl.isConnected || (state.payloadKey && codeEl.__canvasPayloadKey !== state.payloadKey)) {
            finish();
            return;
        }
        if (drawerState?.codeEl?.contains(codeEl) && drawerState.pauseCodeHighlightUntilOpen) {
            finish();
            codeEl.__canvasRenderKey = '';
            return;
        }
        const source = state.source;
        const language = state.language;
        const hljs = window.hljs;
        const highlightSource = closeStreamingJsxTags(source, language);
        let htmlContent = null;
        if (canHighlightInWorker(language)) {
            htmlContent = await highlightInCanvasWorker(highlightSource, language, getHighlightLanguageDependencies(language), { streaming: true });
        } else if (highlightSource.length <= HIGHLIGHT_WORKER_CHAR_THRESHOLD && hljs) {
            htmlContent = computeStreamHighlightMarkup(hljs, highlightSource, language);
        }
        if (htmlContent != null && highlightSource !== source) {
            htmlContent = truncateHighlightedHtml(htmlContent, source.length);
        }
        if (streamHighlightState.get(codeEl) !== state) return;
        if (state.source !== source || state.language !== language) {
            state.rafId = requestAnimationFrame(run);
            return;
        }
        finish();
        if (!codeEl.isConnected || codeEl.__canvasPayloadKey !== state.payloadKey) return;
        if (htmlContent != null && document.activeElement !== codeEl && !selectionIntersectsNode(codeEl)
            && codeEl.textContent === source && codeEl.innerHTML !== htmlContent) {
            releaseCodeChunks(codeEl);
            codeEl.innerHTML = htmlContent;
        }
    };
    state.rafId = requestAnimationFrame(run);
    streamHighlightState.set(codeEl, state);
}

function renderCodeToPre(preElement, source, type, options = {}) {
    if (!preElement) return;
    invalidateCodeRenderCacheForPayload(preElement, options.payloadKey || '');
    if (options.streaming && !options.__scheduledStreamingRender) {
        scheduleStreamingCodeRender(preElement, source, type, options);
        return;
    }
    if (!options.streaming) {
        cancelStreamingCodeRender(preElement);
    }

    const text = normalizeCodeViewSource(source);
    const payloadKey = options.payloadKey || '';
    const language = resolveHighlightLanguage(type);
    const hljs = window.hljs;
    const shouldHighlight = options.highlight !== false
        && !(drawerState?.codeEl === preElement && drawerState.pauseCodeHighlightUntilOpen);
    const isStreaming = !!options.streaming;
    const renderKey = `${language}::${shouldHighlight ? 'hl' : 'plain'}::${isStreaming ? 'stream' : 'final'}::${text}`;
    const scrollEl = ensureCodeScrollElement(preElement);
    let codeEl = scrollEl?.querySelector(':scope > code');
    if (!codeEl) {
        codeEl = document.createElement('code');
        scrollEl?.appendChild(codeEl);
    } else {
        ensureCodeLineNumberGutter(preElement);
    }
    updateCodeLineNumbers(preElement, text);
    configureEditableCodeElement(codeEl);
    codeEl.__canvasPayloadKey = payloadKey;
    const className = `hljs language-${language}`;
    if (codeEl.className !== className) {
        codeEl.className = className;
    }

    if (!isStreaming && codeEl.__canvasRenderKey === renderKey) {
        return;
    }

    codeEl.__canvasRenderVersion = (codeEl.__canvasRenderVersion || 0) + 1;
    const renderVersion = codeEl.__canvasRenderVersion;

    const useWorker = shouldHighlight && canHighlightInWorker(language);
    if (shouldHighlight && !useWorker && hljs && !areHighlightLanguagesReady(hljs, language)) {
        if (codeEl.textContent !== text) {
            releaseCodeChunks(codeEl);
            codeEl.textContent = text;
        }
        ensureHighlightLanguages(language).then((ready) => {
            if (!ready || codeEl.__canvasRenderVersion !== renderVersion || !codeEl.isConnected) return;
            if (payloadKey && codeEl.__canvasPayloadKey !== payloadKey) return;
            renderCodeToPre(preElement, text, type, options);
        });
        return;
    }

    if (isStreaming) {
        updateCodeSourceText(codeEl, text);
        if (!shouldHighlight) {
            const pending = streamHighlightState.get(codeEl);
            if (pending) {
                cancelAnimationFrame(pending.rafId);
                streamHighlightState.delete(codeEl);
            }
            if (codeEl.textContent !== text) {
                codeEl.textContent = text;
            }
            codeEl.__canvasRenderKey = '';
            return;
        }
        scheduleStreamHighlight(codeEl, text, language);
        return;
    }

    const pending = streamHighlightState.get(codeEl);
    if (pending) {
        cancelAnimationFrame(pending.rafId);
        streamHighlightState.delete(codeEl);
    }

    const cacheKey = `${language}::${text}`;
    const canHighlight = shouldHighlight && (useWorker || (
        !!hljs && typeof hljs.highlight === 'function' && text.length <= HIGHLIGHT_WORKER_CHAR_THRESHOLD
    ));
    let chunkState = codeEl.__canvasChunkState;
    const canReuseChunks = chunkState?.cacheKey === cacheKey && codeEl.textContent === text;
    if (!canReuseChunks) {
        if (document.activeElement === codeEl && codeEl.textContent === text) {
            codeEl.__canvasRenderKey = renderKey;
            return;
        }
        chunkState = preserveSelectionDuringUpdate(codeEl, () => mountCodeChunks(codeEl, text, cacheKey));
    }
    if (!canHighlight) {
        codeEl.__canvasRenderKey = renderKey;
        return;
    }
    codeEl.__canvasRenderKey = `${renderKey}::chunks-pending`;
    highlightCodeChunks(preElement, codeEl, chunkState, { text, language, hljs, useWorker, cacheKey, renderKey });
}

function ensureDrawer(getMessage) {
    if (drawerState) return drawerState;
    const labels = {
        prev: getText(getMessage, 'common.previous', 'Previous'),
        next: getText(getMessage, 'common.next', 'Next'),
        copy: getText(getMessage, 'common.copy', 'Copy'),
        copied: getText(getMessage, 'status.copied', 'Copied'),
        preview: getText(getMessage, 'ui.preview', 'Preview'),
        code: getText(getMessage, 'ui.code', 'Code'),
        close: getText(getMessage, 'common.close', 'Close')
    };

    const drawer = document.createElement('div');
    drawer.className = 'canvas-drawer sideloading-panel';
    drawer.tabIndex = -1;
    drawer.innerHTML = `
        <div class="canvas-drawer-inner">
            <div class="loader-bar canvas-preview-loader"></div>
            <div class="canvas-drawer-content show-code">
                <pre class="canvas-drawer-code"></pre>
                <iframe class="canvas-drawer-preview" tabindex="-1"></iframe>
            </div>
        </div>
    `;
    const header = createSideloadingHeader({
        actions: [
            { drawerAction: 'prev', icon: 'prev', i18nKey: 'common.previous', title: labels.prev },
            { drawerAction: 'next', icon: 'next', i18nKey: 'common.next', title: labels.next },
            { type: 'divider' },
            { drawerAction: 'copy', icon: 'copy', i18nKey: 'common.copy', title: labels.copy },
            { type: 'divider' },
            {
                type: 'segment',
                actions: [
                    { drawerAction: 'code', icon: 'code', i18nKey: 'ui.code', title: labels.code, active: true },
                    { drawerAction: 'preview', icon: 'preview', i18nKey: 'ui.preview', title: labels.preview }
                ]
            },
            { type: 'divider' },
            { drawerAction: 'close', icon: 'close', i18nKey: 'common.close', title: labels.close }
        ]
    });
    drawer.querySelector('.canvas-drawer-inner')?.prepend(header.header);
    const previewFrame = drawer.querySelector('.canvas-drawer-preview');
    initializePreviewFrame(previewFrame);
    const host = document.querySelector('.app-container') || document.body;
    host.appendChild(drawer);

    drawerState = {
        host,
        drawer,
        labels,
        titleEl: header.titleText,
        langEl: header.type,
        codeEl: drawer.querySelector('.canvas-drawer-code'),
        previewEl: previewFrame,
        contentEl: drawer.querySelector('.canvas-drawer-content'),
        btnPrev: drawer.querySelector('[data-drawer-action="prev"]'),
        btnNext: drawer.querySelector('[data-drawer-action="next"]'),
        btnCopy: drawer.querySelector('[data-drawer-action="copy"]'),
        btnCode: drawer.querySelector('[data-drawer-action="code"]'),
        btnPreview: drawer.querySelector('[data-drawer-action="preview"]'),
        btnClose: drawer.querySelector('[data-drawer-action="close"]'),
        previewLoaderEl: drawer.querySelector('.canvas-preview-loader'),
        activeCard: null,
        activePayload: null,
        closeAnchorCard: null,
        previewLoading: false,
        previewLoadSeq: 0,
        drawerCloseSeq: 0,
        pauseCodeHighlightUntilOpen: false,
        previewCloseUnloadTimer: null,
        previewRenderedSource: '',
        previewPendingSource: '',
        previewTimers: new Set()
    };
    configureCanvasCaretViewportTracking();
    configureAutoHideCodeScrollbars(drawerState.codeEl);

    drawerState.btnCode.addEventListener('click', () => setDrawerMode('code'));
    drawerState.btnPreview.addEventListener('click', () => setDrawerMode('preview'));
    drawerState.btnClose.addEventListener('click', () => {
        if (requestCanvasDrawerCloseFromUser('toolbar')) return;
        closeDrawer(true);
    });
    drawerState.btnPrev.addEventListener('click', () => navigateDrawerCanvas(-1, getMessage));
    drawerState.btnNext.addEventListener('click', () => navigateDrawerCanvas(1, getMessage));
    drawerState.btnCopy.addEventListener('click', async () => {
        if (!drawerState?.activePayload) return;
        try {
            await navigator.clipboard.writeText(getCanvasPayloadSource(drawerState.activePayload));
            drawerState.btnCopy.classList.add('is-success');
            drawerState.btnCopy.innerHTML = SIDELOADING_ICONS.check;
            drawerState.btnCopy.title = labels.copied;
            drawerState.btnCopy.setAttribute('aria-label', labels.copied);
            setTimeout(() => {
                drawerState.btnCopy.classList.remove('is-success');
                drawerState.btnCopy.innerHTML = SIDELOADING_ICONS.copy;
                const latestCopyLabel = getText(getMessage, 'common.copy', 'Copy');
                drawerState.btnCopy.title = latestCopyLabel;
                drawerState.btnCopy.setAttribute('aria-label', latestCopyLabel);
            }, 2000);
        } catch (_) { }
    });

    return drawerState;
}

function getSessionCanvasCards() {
    if (!drawerState) return [];
    const scope = drawerState.host?.querySelector?.('.chat-container') || document.querySelector('.chat-container') || document;
    return Array.from(scope.querySelectorAll('.canvas-card')).filter(card => card?.__canvasPayload);
}

function getActiveCanvasIndex(cards) {
    if (!drawerState || !Array.isArray(cards) || cards.length === 0) return -1;
    const directIndex = cards.indexOf(drawerState.activeCard);
    if (directIndex >= 0) return directIndex;
    const activeId = drawerState.activePayload?.id;
    if (activeId) {
        return cards.findIndex(card => card.__canvasPayload?.id === activeId);
    }
    return -1;
}

function getCanvasLocalizedLabel(key, fallback) {
    try {
        const translated = t(getCurrentLanguage(), key);
        if (translated && translated !== key) return translated;
    } catch (_) { }
    return fallback;
}

function setCanvasCardToggleLabel(cardState, isActive) {
    if (!cardState?.toggleButton) return;
    const key = isActive ? cardState.closeKey : cardState.openKey;
    const fallback = isActive ? cardState.closeLabel : cardState.openLabel;
    cardState.toggleButton.setAttribute('data-i18n-key', key);
    cardState.toggleButton.textContent = getCanvasLocalizedLabel(key, fallback);
}

function syncDrawerCardUi(cards = null) {
    if (!drawerState) return;
    const canvasCards = Array.isArray(cards) ? cards : getSessionCanvasCards();
    const activeCard = drawerState.activeCard || null;
    const activeIndex = getActiveCanvasIndex(canvasCards);
    const hasPrev = activeIndex > 0;
    const hasNext = activeIndex >= 0 && activeIndex < canvasCards.length - 1;

    canvasCards.forEach((card) => {
        const isActive = !!activeCard && card === activeCard;
        card.classList.toggle('is-minimal', isActive);
        const cardState = cardStateMap.get(card);
        setCanvasCardToggleLabel(cardState, isActive);
    });

    drawerState.btnPrev.disabled = !hasPrev;
    drawerState.btnPrev.setAttribute('aria-disabled', hasPrev ? 'false' : 'true');
    drawerState.btnNext.disabled = !hasNext;
    drawerState.btnNext.setAttribute('aria-disabled', hasNext ? 'false' : 'true');
}

function navigateDrawerCanvas(step = 0, getMessage) {
    if (!drawerState || !step) return;
    const cards = getSessionCanvasCards();
    const activeIndex = getActiveCanvasIndex(cards);
    if (activeIndex < 0) return;
    const targetIndex = activeIndex + step;
    if (targetIndex < 0 || targetIndex >= cards.length) return;
    const targetCard = cards[targetIndex];
    const payload = targetCard?.__canvasPayload;
    if (!targetCard || !payload) return;
    openDrawer(targetCard, payload, getMessage);
}

function setDrawerMode(mode = 'code') {
    if (!drawerState) return;
    const isPreview = mode === 'preview' && !!drawerState.activePayload?.canPreview;
    drawerState.drawer?.classList.toggle('show-preview', isPreview);
    drawerState.drawer?.classList.toggle('show-code', !isPreview);
    drawerState.contentEl.classList.toggle('show-preview', isPreview);
    drawerState.contentEl.classList.toggle('show-code', !isPreview);
    drawerState.contentEl.classList.toggle('is-preview-loading', isPreview && !!drawerState.previewLoading);
    drawerState.btnCode.classList.toggle('active', !isPreview);
    drawerState.btnPreview.classList.toggle('active', isPreview);
    if (drawerState.codeEl) {
        drawerState.codeEl.style.pointerEvents = isPreview ? 'none' : 'auto';
        drawerState.codeEl.style.overflow = 'auto';
    }
    if (drawerState.previewEl) {
        drawerState.previewEl.style.pointerEvents = isPreview ? 'auto' : 'none';
        drawerState.previewEl.style.visibility = isPreview ? 'visible' : 'hidden';
    }
    drawerState.previewLoaderEl?.classList.toggle('loading', isPreview && !!drawerState.previewLoading);
    if (isPreview) {
        ensureDrawerPreviewRendered();
        requestAnimationFrame(() => focusCanvasDrawerShell(drawerState));
    }
}

function isDrawerInPreviewMode() {
    return !!drawerState?.contentEl?.classList.contains('show-preview');
}

function setDrawerPreviewLoading(loading) {
    if (!drawerState?.previewLoaderEl) return;
    drawerState.previewLoading = !!loading;
    drawerState.contentEl?.classList.toggle('is-preview-loading', !!loading && isDrawerInPreviewMode());
    drawerState.previewLoaderEl.classList.toggle('loading', !!loading && isDrawerInPreviewMode());
}

function clearDrawerPreviewTimers(ds = drawerState) {
    if (!ds?.previewTimers) return;
    ds.previewTimers.forEach((timerId) => clearTimeout(timerId));
    ds.previewTimers.clear();
}

function scheduleDrawerPreviewTimer(ds, fn, delay) {
    if (!ds) return null;
    if (!ds.previewTimers) ds.previewTimers = new Set();
    const timerId = setTimeout(() => {
        ds.previewTimers?.delete(timerId);
        fn();
    }, delay);
    ds.previewTimers.add(timerId);
    return timerId;
}

function completeDrawerPreviewRender(loadSeq, minVisibleMs = MIN_PREVIEW_LOADING_MS, markRendered = true) {
    const ds = drawerState;
    if (!ds || ds.previewLoadSeq !== loadSeq) return;
    if (ds.previewRenderSettledSeq === loadSeq) return;
    ds.previewRenderSettledSeq = loadSeq;
    if (markRendered && ds.previewPendingSource) {
        ds.previewRenderedSource = ds.previewPendingSource;
        ds.previewPendingSource = '';
    }

    const elapsed = Date.now() - (ds.previewLoadStartedAt || 0);
    const remaining = Math.max(0, minVisibleMs - elapsed);

    scheduleDrawerPreviewTimer(ds, () => {
        if (ds.previewLoadSeq !== loadSeq) return;
        setDrawerPreviewLoading(false);
        focusCanvasDrawerShell(ds);
    }, remaining);
}

window.addEventListener('message', (event) => {
    const data = event?.data || {};
    if (data.type !== PREVIEW_RENDER_DONE_MESSAGE) return;
    const frameWindow = drawerState?.previewEl?.contentWindow;
    if (frameWindow && event.source !== frameWindow) return;
    completeDrawerPreviewRender(Number(data.loadSeq || 0));
});

window.addEventListener('message', async (event) => {
    const data = event?.data || {};
    if (data.source !== PREVIEW_MESSAGE_SOURCE || data.type !== PREVIEW_OPEN_LINK_MESSAGE) return;
    const frameWindow = drawerState?.previewEl?.contentWindow;
    if (frameWindow && event.source !== frameWindow) return;

    const url = String(data.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return;

    try {
        if (Capacitor.isNativePlatform()) {
            await Browser.open({ url });
        }
    } catch (_) { }
});

function clearDeferredDrawerPreviewUnload(ds = drawerState) {
    if (!ds?.previewCloseUnloadTimer) return;
    clearTimeout(ds.previewCloseUnloadTimer);
    ds.previewCloseUnloadTimer = null;
}

function unloadDrawerPreviewFrame(ds = drawerState) {
    const frame = ds?.previewEl;
    if (!frame) return;
    clearDeferredDrawerPreviewUnload(ds);
    clearDrawerPreviewTimers(ds);
    ds.previewLoadSeq = (ds.previewLoadSeq || 0) + 1;
    ds.previewRenderedSource = '';
    ds.previewPendingSource = '';
    ds.previewLoading = false;
    ds.previewRenderSettledSeq = 0;
    frame.onload = null;
    frame.onerror = null;
    const frameHasPreview = !!(frame.dataset.previewMode || frame.dataset.previewHtml);
    delete frame.dataset.previewMode;
    delete frame.dataset.previewHtml;
    if (frameHasPreview) {
        resetDrawerPreviewFrame(ds);
    }
    ds.contentEl?.classList.remove('is-preview-loading');
    ds.previewLoaderEl?.classList.remove('loading');
}

function ensureDrawerPreviewRendered() {
    if (!drawerState?.activePayload?.canPreview) return;
    const ds = drawerState;
    const type = normalizeCanvasType(ds.activePayload.type || 'text');
    const source = getCanvasPayloadSource(ds.activePayload);
    const previewKey = `${type}::${getCanvasPreviewThemeSignature()}::${source}`;
    if (ds.previewRenderedSource === previewKey) return;
    if (ds.previewPendingSource === previewKey && ds.previewRenderSettledSeq !== ds.previewLoadSeq) return;
    clearDrawerPreviewTimers(ds);
    const loadSeq = ++ds.previewLoadSeq;
    ds.previewLoadStartedAt = Date.now();
    ds.previewRenderSettledSeq = 0;
    ds.previewPendingSource = previewKey;
    const shouldDebounceRender = !!ds.previewRenderedSource;
    setDrawerPreviewLoading(true);
    let frame = ds.previewEl;
    if (!frame) return;
    if (frame.dataset.previewMode || frame.dataset.previewHtml) {
        frame = resetDrawerPreviewFrame(ds);
    }
    initializePreviewFrame(frame);

    const attemptRender = async () => {
        if (ds.previewLoadSeq !== loadSeq) return;
        if (await renderFrame(frame, source, type, loadSeq)) {
            return;
        }
        scheduleDrawerPreviewTimer(ds, attemptRender, 50);
    };

    if (shouldDebounceRender) {
        scheduleDrawerPreviewTimer(ds, attemptRender, PREVIEW_RENDER_DEBOUNCE_MS);
    } else {
        attemptRender();
    }
    scheduleDrawerPreviewTimer(ds, () => {
        completeDrawerPreviewRender(loadSeq, 0, false);
    }, PREVIEW_RENDER_TIMEOUT_MS);
}

export function reloadCanvasDrawerPreview(options = {}) {
    if (!drawerState?.activePayload?.canPreview) return;
    const ds = drawerState;
    if (!ds.contentEl?.classList.contains('show-preview')) return;
    if (options?.onlyIfUnsettled === true && ds.previewRenderSettledSeq === ds.previewLoadSeq) return;
    if (options?.resetFrame === true) {
        clearDrawerPreviewTimers(ds);
        ds.previewLoadSeq = (ds.previewLoadSeq || 0) + 1;
        ds.previewRenderSettledSeq = 0;
        resetDrawerPreviewFrame(ds);
    }
    ds.previewRenderedSource = '';
    ensureDrawerPreviewRendered();
}

function syncDrawerPreviewAvailability() {
    if (!drawerState) return;
    const ds = drawerState;
    const canPreview = !!ds.activePayload?.canPreview;
    if (canPreview) {
        ds.btnPreview.disabled = false;
        ds.btnPreview.setAttribute('aria-disabled', 'false');
        return;
    }
    ds.btnPreview.disabled = true;
    ds.btnPreview.setAttribute('aria-disabled', 'true');
    unloadDrawerPreviewFrame(ds);
    setDrawerMode('code');
}

function closeDrawer(animated = false, options = {}) {
    if (!drawerState) {
        options.onSettled?.();
        return;
    }
    if (options.routeHandled === true && isSideloadingPendingOpen(drawerState.drawer)) {
        options.onSettled?.();
        return;
    }
    const wasOpen = drawerState.drawer?.classList.contains('is-open');
    storeActiveCodeScroll(drawerState);
    const shouldPreservePinnedBottom = isChatPinnedToBottom(drawerState.host);
    const shouldPreservePinnedTop = !shouldPreservePinnedBottom && isChatPinnedToTop(drawerState.host);
    const activeCard = drawerState.closeAnchorCard || drawerState.activeCard;
    if (wasOpen && options.routeHandled !== true) {
        suppressAutoOpenForCard(activeCard);
    }
    const closeSeq = (drawerState.drawerCloseSeq || 0) + 1;
    drawerState.drawerCloseSeq = closeSeq;
    drawerState.pauseCodeHighlightUntilOpen = false;
    if (drawerState.caretScrollTimer) {
        clearTimeout(drawerState.caretScrollTimer);
        drawerState.caretScrollTimer = null;
    }
    clearDeferredDrawerPreviewUnload(drawerState);
    const unloadPreviewAfterClose = () => {
        if (!drawerState || drawerState.drawerCloseSeq !== closeSeq) return;
        if (drawerState.drawer?.classList.contains('is-open')) return;
        unloadDrawerPreviewFrame(drawerState);
        drawerState.codeEl?.replaceChildren();
        drawerState.drawer?.classList.remove('is-closing-preview');
    };
    const isOpacitySwitch = options.closeMode === 'opacity';
    const isClosingPreview = animated && !isOpacitySwitch && drawerState.contentEl?.classList.contains('show-preview');
    if (isClosingPreview) {
        drawerState.drawer?.classList.add('is-closing-preview');
        drawerState.previewLoading = false;
        drawerState.previewLoaderEl?.classList.remove('loading');
        unloadDrawerPreviewFrame(drawerState);
    }
    const drawerEl = drawerState.drawer;
    if (shouldPreservePinnedBottom) {
        preservePinnedChatBottomDuringLayout(drawerState.host);
    } else if (shouldPreservePinnedTop) {
        preservePinnedChatTopDuringLayout(drawerState.host);
    } else {
        preserveElementInViewDuringLayout(drawerState.host, activeCard);
    }
    let settled = false;
    const handleCloseSettled = () => {
        if (settled) return;
        if (animated) {
            if (drawerState?.drawerCloseSeq !== closeSeq || drawerEl.classList.contains('is-open')) return;
            clearDeferredDrawerPreviewUnload(drawerState);
        }
        settled = true;
        unloadPreviewAfterClose();
        options.onSettled?.();
    };
    closeSideloading({
        drawer: drawerEl,
        host: drawerState.host,
        bodyOpenClass: 'canvas-drawer-open',
        animated,
        settleMs: DRAWER_CLOSE_PREVIEW_UNLOAD_DELAY_MS,
        mode: options.closeMode || 'slide',
        onSettled: handleCloseSettled
    });
    if (!isClosingPreview) {
        setDrawerPreviewLoading(false);
    }
    drawerState.activeCard = null;
    drawerState.activePayload = null;
    drawerState.closeAnchorCard = null;
    syncDrawerCardUi();
    if (wasOpen) {
        dispatchCanvasDrawerEvent('lab:canvas-drawer-closed', {
            routeHandled: options.routeHandled === true
        });
    }
}

export function isCanvasDrawerOpen() {
    const drawerOpen = !!(drawerState?.drawer?.classList.contains('is-open'));
    const bodyOpen = document?.body?.classList?.contains('canvas-drawer-open');
    const hasActivePayload = !!drawerState?.activePayload;
    const hasActiveCard = !!drawerState?.activeCard;
    return drawerOpen && !!bodyOpen && hasActivePayload && hasActiveCard;
}

export function closeCanvasDrawer(animated = true, options = {}) {
    closeDrawer(animated, options);
}

function preserveChatPositionForDrawerOpen(ds, card, wasOpen, forcePinnedBottom = false) {
    if (wasOpen) return;
    if (forcePinnedBottom) {
        preservePinnedChatBottomDuringLayout(ds.host);
        return;
    }
    const isPinnedToBottom = isChatPinnedToBottom(ds.host);
    if (isPinnedToBottom) {
        preservePinnedChatBottomDuringLayout(ds.host);
        return;
    }
    if (isChatPinnedToTop(ds.host)) {
        preservePinnedChatTopDuringLayout(ds.host);
        return;
    }
    preserveElementInViewDuringLayout(ds.host, card);
}

function scheduleAutoOpenDrawerAfterCardLayout(card, openKey, getMessage) {
    if (!card || !openKey) return;
    if (canvasAutoOpenedKeys.has(openKey)) return;
    if (pendingAutoOpenRafs.has(openKey)) return;

    const pending = {
        firstRaf: 0,
        secondRaf: 0
    };
    pendingAutoOpenRafs.set(openKey, pending);

    pending.firstRaf = requestAnimationFrame(() => {
        if (!card.isConnected) {
            pendingAutoOpenRafs.delete(openKey);
            return;
        }
        try {
            card.getBoundingClientRect();
        } catch (_) { }
        pending.secondRaf = requestAnimationFrame(() => {
            pendingAutoOpenRafs.delete(openKey);
            if (!card.isConnected) return;
            const payload = card.__canvasPayload;
            if (!payload) return;
            const groupKey = openKey.split('::')[0] || '';
            if (canvasAutoOpenSuppressedGroups.has(groupKey)) return;
            canvasAutoOpenedKeys.add(openKey);
            openDrawer(card, payload, getMessage, { autoOpenStreaming: true });
        });
    });
}

function openDrawer(card, payload, getMessage, options = {}) {
    const ds = ensureDrawer(getMessage);
    ds.drawerCloseSeq = (ds.drawerCloseSeq || 0) + 1;
    const openSeq = ds.drawerCloseSeq;
    clearDeferredDrawerPreviewUnload(ds);
    ds.drawer?.classList.remove('is-closing-preview');
    const wasOpen = ds.drawer.classList.contains('is-open');
    const shouldPauseCodeHighlight = !wasOpen && !payload.isFinalRender;
    ds.pauseCodeHighlightUntilOpen = shouldPauseCodeHighlight;
    if (shouldPauseCodeHighlight) {
        const codeEl = ds.codeEl.querySelector(':scope > .canvas-code-scroll > code');
        const pending = codeEl && streamHighlightState.get(codeEl);
        if (pending) {
            cancelAnimationFrame(pending.rafId);
            streamHighlightState.delete(codeEl);
        }
    }
    const activePayloadChanged = getCanvasPayloadKey(ds.activePayload) !== getCanvasPayloadKey(payload);
    const forcePinnedBottom = !!options.autoOpenStreaming;
    const wasChatPinnedToBottom = isChatPinnedToBottom(ds.host);
    const shouldKeepPinnedBottom = !wasOpen && (forcePinnedBottom || wasChatPinnedToBottom);
    const pinDeadline = performance.now() + DRAWER_CLOSE_PREVIEW_UNLOAD_DELAY_MS + 120;
    const canKeepPinnedBottom = () => shouldKeepPinnedBottom
        && ds.drawerCloseSeq === openSeq
        && ds.drawer.classList.contains('is-open')
        && document.visibilityState !== 'hidden'
        && performance.now() <= pinDeadline;
    if (!forcePinnedBottom) {
        suppressAutoOpenForCard(card);
    }
    if (activePayloadChanged) {
        storeActiveCodeScroll(ds);
        unloadDrawerPreviewFrame(ds);
    }
    preserveChatPositionForDrawerOpen(ds, card, wasOpen, forcePinnedBottom);
    ds.labels.prev = getText(getMessage, 'common.previous', 'Previous');
    ds.labels.next = getText(getMessage, 'common.next', 'Next');
    ds.labels.copy = getText(getMessage, 'common.copy', 'Copy');
    ds.labels.copied = getText(getMessage, 'status.copied', 'Copied');
    ds.labels.preview = getText(getMessage, 'ui.preview', 'Preview');
    ds.labels.code = getText(getMessage, 'ui.code', 'Code');
    ds.labels.close = getText(getMessage, 'common.close', 'Close');
    ds.btnPrev.title = ds.labels.prev;
    ds.btnPrev.setAttribute('aria-label', ds.labels.prev);
    ds.btnNext.title = ds.labels.next;
    ds.btnNext.setAttribute('aria-label', ds.labels.next);
    ds.btnCopy.title = ds.labels.copy;
    ds.btnCopy.setAttribute('aria-label', ds.labels.copy);
    ds.btnCode.title = ds.labels.code;
    ds.btnCode.setAttribute('aria-label', ds.labels.code);
    ds.btnPreview.title = ds.labels.preview;
    ds.btnPreview.setAttribute('aria-label', ds.labels.preview);
    ds.btnClose.title = ds.labels.close;
    ds.btnClose.setAttribute('aria-label', ds.labels.close);
    ds.activeCard = card;
    ds.activePayload = payload;
    if (!wasOpen) {
        ds.closeAnchorCard = card;
    }
    ds.titleEl.textContent = payload.title || '';
    ds.langEl.textContent = payload.type || 'text';
    renderCodeToPre(ds.codeEl, getCanvasPayloadSource(payload), payload.type, {
        highlight: true,
        streaming: !payload.isFinalRender,
        payloadKey: getCanvasPayloadKey(payload)
    });
    restoreCodeScrollForPayload(ds, payload);
    syncDrawerPreviewAvailability();
    if (payload.canPreview) {
        if (ds.contentEl.classList.contains('show-preview')) {
            ensureDrawerPreviewRendered();
        } else {
            setDrawerPreviewLoading(false);
        }
    }
    const dispatchOpened = ({ swapped = false } = {}) => {
        if (wasOpen && !activePayloadChanged) return;
        dispatchCanvasDrawerEvent('lab:canvas-drawer-opened', {
            payloadId: payload?.id || '',
            title: payload?.title || '',
            type: payload?.type || '',
            autoOpenStreaming: !!options.autoOpenStreaming,
            wasChatPinnedToBottom,
            replaceSideloadingHistory: swapped
        });
    };
    openSideloading({
        drawer: ds.drawer,
        host: ds.host,
        bodyOpenClass: 'canvas-drawer-open',
        animated: !wasOpen,
        settleMs: DRAWER_CLOSE_PREVIEW_UNLOAD_DELAY_MS,
        requestClose: ({ mode = 'slide', animated = true, routeHandled = true } = {}) => new Promise(resolve => {
            closeDrawer(animated, { routeHandled, closeMode: mode, onSettled: resolve });
        }),
        onOpen: ({ swapped = false } = {}) => {
            if (!wasOpen) {
                if (canKeepPinnedBottom()) {
                    preservePinnedChatBottomDuringLayout(ds.host);
                }
            }
            dispatchOpened({ swapped });
        },
        onSettled: () => {
            if (shouldPauseCodeHighlight && ds.drawerCloseSeq === openSeq && ds.drawer.classList.contains('is-open')) {
                ds.pauseCodeHighlightUntilOpen = false;
                const latestPayload = ds.activePayload;
                if (latestPayload) {
                    renderCodeToPre(ds.codeEl, getCanvasPayloadSource(latestPayload), latestPayload.type, {
                        highlight: true,
                        streaming: !latestPayload.isFinalRender,
                        payloadKey: getCanvasPayloadKey(latestPayload)
                    });
                }
            }
            if (canKeepPinnedBottom()) {
                preservePinnedChatBottomDuringLayout(ds.host, 120);
            }
        }
    });
    if (wasOpen) {
        const inPreview = ds.contentEl.classList.contains('show-preview');
        if (inPreview && payload.canPreview) {
            setDrawerMode('preview');
        } else {
            setDrawerMode('code');
        }
    } else {
        setDrawerMode('code');
    }
    syncDrawerCardUi();
}

export function openFirstCanvasDrawer(getMessage, canvasId = '') {
    const cards = getSessionCanvasCards();
    const targetId = String(canvasId || '').trim();
    const firstCard = targetId
        ? cards.find(card => card?.__canvasPayload?.id === targetId)
        : cards.find(card => card?.__canvasPayload);
    if (!firstCard) return false;
    openDrawer(firstCard, firstCard.__canvasPayload, getMessage);
    return true;
}

async function renderFrame(frame, source, type, loadSeq = 0) {
    if (!frame) return;
    const isStaleRender = () => (
        !drawerState ||
        drawerState.previewEl !== frame ||
        drawerState.previewLoadSeq !== loadSeq
    );
    const html = await buildPreviewDocumentForFrame(type, source);
    if (isStaleRender()) return true;
    if (!html) {
        unloadDrawerPreviewFrame(drawerState);
        return false;
    }
    frame.dataset.previewMode = 'postmessage';
    frame.dataset.previewHtml = String(html || '');
    const payload = { type: PREVIEW_RENDER_MESSAGE, html, script: PREVIEW_BOOTSTRAP_SCRIPT, loadSeq };
    if (frame.dataset.bootstrapped !== 'true' || !frame.contentWindow) {
        return false;
    }
    try {
        frame.contentWindow.postMessage(payload, '*');
        return true;
    } catch (_) {
        return false;
    }
}

function createCanvasCard(codeElement, options) {
    const source = codeElement.textContent || '';
    const labels = options.labels;
    const title = options.title || labels.defaultTitle;
    const type = normalizeCanvasType(options.type);
    const createdAt = normalizeCanvasTimestamp(options.createdAt || options.timestamp) || new Date();
    const isFinalRender = !!options.isFinalRender;
    const canPreview = canRenderCanvasPreview(type, source);
    const shouldEnablePreview = canPreview && isFinalRender;

    const card = document.createElement('div');
    card.className = 'canvas-card';
    card.dataset.canvasCard = 'true';
    if (options.groupKey) {
        card.dataset.canvasGroupKey = options.groupKey;
    }
    card.dataset.canvasFinal = isFinalRender ? 'true' : 'false';
    card.classList.toggle('is-streaming', !isFinalRender);

    const header = document.createElement('div');
    header.className = 'canvas-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'canvas-title';
    const titleText = document.createElement('span');
    titleText.className = 'canvas-title-text';
    titleText.textContent = title;
    const timeText = document.createElement('span');
    timeText.className = 'canvas-time';
    timeText.textContent = formatCanvasTimeDisplay(createdAt);
    titleWrap.append(titleText, timeText);

    const actions = document.createElement('div');
    actions.className = 'canvas-actions';
    const toolsActive = document.createElement('div');
    toolsActive.className = 'canvas-tools-active';

    const closePillButton = document.createElement('button');
    closePillButton.type = 'button';
    closePillButton.className = 'canvas-close-pill';
    closePillButton.setAttribute('data-i18n-key', 'common.open');
    closePillButton.textContent = getCanvasLocalizedLabel('common.open', labels.open);

    toolsActive.append(closePillButton);
    actions.append(toolsActive);

    header.append(titleWrap, actions);
    card.append(header);
    card.classList.add('is-card-only');

    const state = {
        id: options.id || `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        type,
        source,
        createdAt: createdAt.toISOString(),
        canPreview: shouldEnablePreview,
        isFinalRender
    };
    if (canvasEditedSourceMap.has(state.id)) {
        state.editedSource = canvasEditedSourceMap.get(state.id) || '';
    }
    card.__canvasPayload = state;
    scheduleCanvasHighlightPrewarm(card);

    closePillButton.addEventListener('click', () => {
        if (drawerState?.activeCard === card && drawerState?.drawer?.classList.contains('is-open')) {
            if (requestCanvasDrawerCloseFromUser('card')) return;
            closeDrawer(true);
            return;
        }
        openDrawer(card, card.__canvasPayload || state, options.getMessage);
    });
    cardStateMap.set(card, {
        toggleButton: closePillButton,
        openKey: 'common.open',
        closeKey: 'common.close',
        openLabel: labels.open,
        closeLabel: labels.close
    });

    if (drawerState?.drawer?.classList.contains('is-open') && isSameCanvasIdentity(drawerState.activePayload, state)) {
        const prevCanPreview = !!drawerState.activePayload?.canPreview;
        const prevPayload = drawerState.activePayload || {};
        const sourceChanged = getCanvasPayloadSource(prevPayload) !== getCanvasPayloadSource(state);
        const canPreviewChanged = !!prevPayload.canPreview !== !!state.canPreview;
        const finalChanged = !!prevPayload.isFinalRender !== !!state.isFinalRender;
        const activeCardChanged = drawerState.activeCard !== card;
        drawerState.activeCard = card;
        drawerState.activePayload = state;
        if (sourceChanged || finalChanged) {
            renderCodeToPre(drawerState.codeEl, getCanvasPayloadSource(state), state.type, {
                highlight: true,
                streaming: !state.isFinalRender,
                payloadKey: getCanvasPayloadKey(state)
            });
            restoreCodeScrollForPayload(drawerState, state);
            if (!state.isFinalRender && drawerState.codeEl) {
                scheduleStreamScrollToBottom(drawerState.codeEl);
            }
        }
        if (canPreviewChanged || finalChanged) {
            syncDrawerPreviewAvailability();
        }
        if (shouldSwitchOpenDrawerToPreview(state)) {
            setDrawerMode('preview');
        }
        if (drawerState.contentEl.classList.contains('show-preview') && state.canPreview && state.isFinalRender) {
            ensureDrawerPreviewRendered();
        }
        if (activeCardChanged || finalChanged) {
            syncDrawerCardUi();
        }
    }

    return card;
}

function createCodeLikeElement(source = '') {
    const code = document.createElement('code');
    code.textContent = String(source || '');
    return code;
}

function applyCanvasCardPayload(card, payload, options = {}) {
    if (!card || !payload) return;
    const source = String(payload.source || '');
    const artifactType = normalizeCanvasType(payload.type);
    const cardTitle = String(payload.title || '');
    const createdAt = normalizeCanvasTimestamp(payload.createdAt || payload.created_at || payload.timestamp);
    const canPreview = canRenderCanvasPreview(artifactType, source);
    const shouldEnablePreview = canPreview && !!options.isFinalRender;
    const previousPayload = card.__canvasPayload || {};
    const prevSource = String(previousPayload.source || '');
    const prevCanPreview = !!previousPayload.canPreview;
    const prevIsFinalRender = !!previousPayload.isFinalRender;
    const prevActiveCard = drawerState?.activeCard || null;
    const incomingIdentity = {
        id: payload.id || previousPayload.id,
        type: artifactType,
        title: cardTitle
    };
    const drawerIsActive = !!(
        drawerState?.drawer?.classList.contains('is-open') &&
        isSameCanvasIdentity(drawerState.activePayload, incomingIdentity)
    );

    card.dataset.canvasFinal = options.isFinalRender ? 'true' : 'false';
    if (options.groupKey) {
        card.dataset.canvasGroupKey = options.groupKey;
    }
    card.classList.toggle('is-streaming', !options.isFinalRender);

    const nextPayload = previousPayload;
    nextPayload.id = payload.id || nextPayload.id;
    nextPayload.title = cardTitle;
    nextPayload.type = artifactType;
    nextPayload.source = source;
    if (nextPayload.id && canvasEditedSourceMap.has(nextPayload.id)) {
        nextPayload.editedSource = canvasEditedSourceMap.get(nextPayload.id) || '';
    }
    if (createdAt) nextPayload.createdAt = createdAt.toISOString();
    nextPayload.canPreview = shouldEnablePreview;
    nextPayload.isFinalRender = !!options.isFinalRender;
    card.__canvasPayload = nextPayload;

    const titleEl = card.querySelector('.canvas-title-text');
    if (titleEl && titleEl.textContent !== cardTitle) titleEl.textContent = cardTitle;
    const timeEl = card.querySelector('.canvas-time');
    if (timeEl && createdAt) {
        const nextTimeText = formatCanvasTimeDisplay(createdAt);
        if (timeEl.textContent !== nextTimeText) timeEl.textContent = nextTimeText;
    }

    if (drawerIsActive) {
        const sourceChanged = prevSource !== source;
        const canPreviewChanged = prevCanPreview !== !!nextPayload.canPreview;
        const finalChanged = prevIsFinalRender !== !!nextPayload.isFinalRender;
        const activeCardChanged = prevActiveCard !== card;

        drawerState.activeCard = card;
        drawerState.activePayload = nextPayload;

        if (sourceChanged || finalChanged) {
            renderCodeToPre(drawerState.codeEl, getCanvasPayloadSource(nextPayload), artifactType, {
                highlight: true,
                streaming: !options.isFinalRender,
                payloadKey: getCanvasPayloadKey(nextPayload)
            });
            restoreCodeScrollForPayload(drawerState, nextPayload);
            if (!options.isFinalRender && drawerState.codeEl) {
                scheduleStreamScrollToBottom(drawerState.codeEl);
            }
        }
        if (canPreviewChanged || finalChanged) {
            syncDrawerPreviewAvailability();
        }
        if (shouldSwitchOpenDrawerToPreview(nextPayload)) {
            setDrawerMode('preview');
        }
        if (drawerState.contentEl.classList.contains('show-preview') && nextPayload.canPreview && nextPayload.isFinalRender) {
            ensureDrawerPreviewRendered();
        }
        if (activeCardChanged || finalChanged) {
            syncDrawerCardUi();
        }
    }
}

export function enhanceCanvasBlocks(container, options = {}) {
    if (!container) return 0;

    const groupKey = getCanvasGroupKey(container, options);
    const cardCache = getCanvasCardCache(groupKey);

    const getMessage = options.getMessage;
    const labels = {
        defaultTitle: getText(getMessage, 'ui.canvasMode', 'Canvas'),
        copy: getText(getMessage, 'common.copy', 'Copy'),
        copied: getText(getMessage, 'status.copied', 'Copied'),
        copyFailed: getText(getMessage, 'toast.copyFailed', 'Copy failed'),
        preview: getText(getMessage, 'ui.preview', 'Preview'),
        code: getText(getMessage, 'ui.code', 'Code'),
        close: getText(getMessage, 'common.close', 'Close'),
        open: getText(getMessage, 'common.open', 'Open')
    };

    let count = 0;
    let firstCreatedCard = null;
    const aliveKeys = new Set();
    const artifacts = Array.isArray(options.canvasArtifacts) ? options.canvasArtifacts : [];
    const artifactMap = new Map();
    const fallbackCreatedAt = normalizeCanvasTimestamp(
        options.messageTimestamp || options.createdAt || options.created_at || options.timestamp
    );
    artifacts.forEach((artifact) => {
        if (!artifact?.id) return;
        artifactMap.set(String(artifact.id), artifact);
    });

    const slots = Array.from(container.querySelectorAll('.canvas-slot[data-canvas-id], [data-canvas-slot="1"][data-canvas-id]'));
    slots.forEach((slot, index) => {
        const artifactId = String(slot.getAttribute('data-canvas-id') || '').trim();
        const artifact = artifactMap.get(artifactId);
        if (!artifact) return;
        const cacheKey = `canvas-artifact-${artifactId}`;
        aliveKeys.add(cacheKey);
        const payload = {
            id: artifactId,
            type: normalizeCanvasType(artifact.type || 'text'),
            title: artifact.title || `${labels.defaultTitle}${slots.length > 1 ? ` ${index + 1}` : ''}`,
            source: String(artifact.source || ''),
            createdAt: artifact.createdAt || artifact.created_at || artifact.timestamp || fallbackCreatedAt?.toISOString()
        };
        let card = cardCache.get(cacheKey) || null;
        if (!card) {
            card = createCanvasCard(createCodeLikeElement(payload.source), {
                id: artifactId,
                labels,
                isFinalRender: options.isFinalRender,
                type: payload.type,
                title: payload.title,
                createdAt: payload.createdAt,
                groupKey,
                getMessage
            });
            cardCache.set(cacheKey, card);
        }
        applyCanvasCardPayload(card, payload, {
            isFinalRender: options.isFinalRender,
            groupKey
        });
        if (card.parentNode !== slot) {
            slot.replaceChildren(card);
        }
        if (!firstCreatedCard) firstCreatedCard = card;
        count += 1;
    });

    for (const key of Array.from(cardCache.keys())) {
        if (!aliveKeys.has(key)) {
            cardCache.delete(key);
        }
    }

    if (options.autoOpenStreaming && firstCreatedCard && !canvasAutoOpenSuppressedGroups.has(groupKey)) {
        const payload = firstCreatedCard.__canvasPayload;
        const openKey = `${groupKey}::${payload?.id || 'first'}`;
        if (payload && !canvasAutoOpenedKeys.has(openKey)) {
            scheduleAutoOpenDrawerAfterCardLayout(firstCreatedCard, openKey, getMessage);
        }
    }

    const previousCount = canvasGroupCardCounts.get(groupKey) || 0;
    canvasGroupCardCounts.set(groupKey, count);
    if (drawerState?.drawer?.classList.contains('is-open') && (options.isFinalRender || previousCount !== count)) {
        syncDrawerCardUi();
    }

    return count;
}
