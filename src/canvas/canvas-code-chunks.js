export const CODE_CHUNK_LINES = 120;
const CHUNK_APPLY_BUDGET_MS = 4;
const CHUNK_FADE_CLASS_MS = 400;
const TAB_COLUMNS = 8;
const FALLBACK_LINE_PX = 28;
const supportsLineHeightUnit = typeof CSS !== 'undefined'
    && typeof CSS.supports === 'function'
    && CSS.supports('height', '1lh');

export function splitCodeTextIntoChunks(text) {
    const source = String(text || '');
    const chunks = [];
    let start = 0;
    let lineCount = 0;
    for (let i = 0; i < source.length; i += 1) {
        if (source.charCodeAt(i) !== 10) continue;
        lineCount += 1;
        if (lineCount === CODE_CHUNK_LINES) {
            chunks.push(source.slice(start, i + 1));
            start = i + 1;
            lineCount = 0;
        }
    }
    if (start < source.length || chunks.length === 0) {
        chunks.push(source.slice(start));
    }
    return chunks;
}

function splitHighlightedHtmlIntoChunks(html) {
    const source = String(html || '');
    const chunks = [];
    const openTags = [];
    let prefix = '';
    let segmentStart = 0;
    let lineCount = 0;
    let i = 0;
    while (i < source.length) {
        const code = source.charCodeAt(i);
        if (code === 60) {
            const end = source.indexOf('>', i);
            if (end < 0) return null;
            const tag = source.slice(i, end + 1);
            if (tag.charCodeAt(1) === 47) {
                if (!openTags.length) return null;
                openTags.pop();
            } else if (tag.charCodeAt(tag.length - 2) !== 47) {
                const name = /^<([a-zA-Z][\w-]*)/.exec(tag)?.[1];
                if (!name) return null;
                openTags.push({ name, tag });
            }
            i = end + 1;
            continue;
        }
        if (code === 10) {
            lineCount += 1;
            if (lineCount === CODE_CHUNK_LINES) {
                let closing = '';
                for (let j = openTags.length - 1; j >= 0; j -= 1) closing += `</${openTags[j].name}>`;
                chunks.push(prefix + source.slice(segmentStart, i + 1) + closing);
                prefix = openTags.map(item => item.tag).join('');
                segmentStart = i + 1;
                lineCount = 0;
            }
        }
        i += 1;
    }
    if (openTags.length) return null;
    const tail = source.slice(segmentStart);
    if (tail || chunks.length === 0) {
        chunks.push(prefix + tail);
    }
    return chunks;
}

export function buildHighlightChunks(text, html) {
    if (typeof html !== 'string') return null;
    const chunks = splitHighlightedHtmlIntoChunks(html);
    if (!chunks || chunks.length !== splitCodeTextIntoChunks(text).length) return null;
    return chunks;
}

function isWideCharCode(code) {
    return code >= 0x1100 && (
        code <= 0x115f
        || (code >= 0x2e80 && code <= 0xa4cf)
        || (code >= 0xac00 && code <= 0xd7a3)
        || (code >= 0xf900 && code <= 0xfaff)
        || (code >= 0xfe30 && code <= 0xfe4f)
        || (code >= 0xff00 && code <= 0xff60)
        || (code >= 0xffe0 && code <= 0xffe6)
    );
}

function measureChunkText(text) {
    let lines = 1;
    let columns = 0;
    let maxColumns = 0;
    for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i);
        if (code === 10) {
            if (columns > maxColumns) maxColumns = columns;
            columns = 0;
            if (i < text.length - 1) lines += 1;
            continue;
        }
        if (code === 9) {
            columns += TAB_COLUMNS - (columns % TAB_COLUMNS);
            continue;
        }
        if (code >= 0xd800 && code <= 0xdbff) {
            columns += 2;
            i += 1;
            continue;
        }
        columns += isWideCharCode(code) ? 2 : 1;
    }
    return { lines, columns: Math.max(1, maxColumns, columns) };
}

function readLinePx(element) {
    try {
        const value = parseFloat(getComputedStyle(element).lineHeight);
        return Number.isFinite(value) && value > 0 ? value : 0;
    } catch (_) {
        return 0;
    }
}

function getIntrinsicSize(text, linePx) {
    const { lines, columns } = measureChunkText(text);
    const height = supportsLineHeightUnit ? `${lines}lh` : `${Math.ceil(lines * linePx)}px`;
    return `auto ${columns}ch auto ${height}`;
}

export function releaseCodeChunks(codeEl) {
    const state = codeEl?.__canvasChunkState;
    if (!state) return;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = 0;
    codeEl.__canvasChunkState = null;
}

export function mountCodeChunks(codeEl, text, cacheKey) {
    releaseCodeChunks(codeEl);
    const texts = splitCodeTextIntoChunks(text);
    const linePx = supportsLineHeightUnit ? 0 : readLinePx(codeEl);
    const deferred = supportsLineHeightUnit || linePx > 0;
    const fragment = document.createDocumentFragment();
    const elements = texts.map((chunkText) => {
        const element = document.createElement('span');
        element.className = deferred ? 'canvas-code-chunk is-deferred' : 'canvas-code-chunk';
        if (deferred) {
            element.style.containIntrinsicSize = getIntrinsicSize(chunkText, linePx);
        }
        element.textContent = chunkText;
        fragment.appendChild(element);
        return element;
    });
    codeEl.replaceChildren(fragment);
    const state = {
        codeEl,
        cacheKey,
        texts,
        elements,
        applied: new Array(elements.length).fill(false),
        htmlChunks: null,
        order: [],
        cursor: 0,
        rafId: 0,
        highlightRequested: false,
        onComplete: null
    };
    codeEl.__canvasChunkState = state;
    return state;
}

export function isCodeChunkStateActive(state) {
    return !!state && state.codeEl.__canvasChunkState === state && state.codeEl.isConnected;
}

function buildApplyOrder(state, scrollTop) {
    const count = state.elements.length;
    const chunkPx = (readLinePx(state.codeEl) || FALLBACK_LINE_PX) * CODE_CHUNK_LINES;
    const start = Math.min(count - 1, Math.max(0, Math.floor((Number(scrollTop) || 0) / chunkPx)));
    const visibleCount = Math.min(count - start, Math.ceil((window.innerHeight || 800) / chunkPx) + 1);
    const order = [];
    for (let i = start; i < start + visibleCount; i += 1) order.push(i);
    let before = start - 1;
    let after = start + visibleCount;
    while (before >= 0 || after < count) {
        if (after < count) order.push(after++);
        if (before >= 0) order.push(before--);
    }
    return { order, visibleCount };
}

function selectionTouchesElement(element) {
    const selection = window.getSelection?.();
    if (!selection?.rangeCount) return false;
    try {
        const range = selection.getRangeAt(0);
        return element.contains(range.startContainer)
            || element.contains(range.endContainer)
            || (!selection.isCollapsed && range.intersectsNode(element));
    } catch (_) {
        return false;
    }
}

function markChunkFresh(state, element) {
    if (!state.plainColor) {
        try {
            state.plainColor = getComputedStyle(state.codeEl).color || '';
        } catch (_) {
            state.plainColor = '';
        }
    }
    if (!state.plainColor) return;
    element.style.setProperty('--canvas-code-plain-color', state.plainColor);
    element.classList.add('is-fresh');
    setTimeout(() => element.classList.remove('is-fresh'), CHUNK_FADE_CLASS_MS);
}

function applyNextChunks(state, { limit = Infinity, deadline = Infinity, fade = false } = {}) {
    let appliedNow = 0;
    while (state.cursor < state.order.length && appliedNow < limit) {
        if (appliedNow > 0 && performance.now() > deadline) break;
        const index = state.order[state.cursor];
        state.cursor += 1;
        if (state.applied[index]) continue;
        const element = state.elements[index];
        if (element.parentNode !== state.codeEl) continue;
        if (element.textContent !== state.texts[index] || selectionTouchesElement(element)) continue;
        element.innerHTML = state.htmlChunks[index];
        if (fade) markChunkFresh(state, element);
        state.applied[index] = true;
        appliedNow += 1;
    }
    if (state.cursor >= state.order.length && state.applied.every(Boolean)) {
        state.onComplete?.();
    }
}

function isPausedForUserEdit(state) {
    if (!state.userEdited) return false;
    if (document.activeElement === state.codeEl) return true;
    state.userEdited = false;
    return false;
}

export function markCodeChunksEdited(codeEl) {
    const state = codeEl?.__canvasChunkState;
    if (!state) return;
    state.userEdited = true;
    if (state.rafId) {
        cancelAnimationFrame(state.rafId);
        state.rafId = 0;
    }
}

function scheduleChunkApply(state) {
    if (state.rafId || state.cursor >= state.order.length) return;
    state.rafId = requestAnimationFrame(() => {
        state.rafId = 0;
        if (!isCodeChunkStateActive(state) || isPausedForUserEdit(state)) return;
        applyNextChunks(state, {
            deadline: performance.now() + CHUNK_APPLY_BUDGET_MS,
            fade: state.fadeAsync
        });
        scheduleChunkApply(state);
    });
}

export function applyCodeChunkHighlight(state, htmlChunks, { scrollTop = 0, syncVisible = false, onComplete = null } = {}) {
    if (!isCodeChunkStateActive(state)) return;
    if (!Array.isArray(htmlChunks) || htmlChunks.length !== state.elements.length) return;
    if (isPausedForUserEdit(state)) return;
    state.htmlChunks = htmlChunks;
    state.fadeAsync = !syncVisible;
    state.onComplete = onComplete;
    const { order, visibleCount } = buildApplyOrder(state, scrollTop);
    state.order = order;
    state.cursor = 0;
    if (syncVisible) {
        applyNextChunks(state, { limit: visibleCount });
    }
    scheduleChunkApply(state);
}
