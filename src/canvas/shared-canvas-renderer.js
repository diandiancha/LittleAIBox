export const cardStateMap = new WeakMap();
export const streamHighlightState = new WeakMap();
export const highlightLanguageLoadPromises = new Map();
export const canvasAutoOpenedKeys = new Set();
export const canvasAutoOpenSuppressedGroups = new Set();
export const canvasGroupCardCounts = new Map();

const streamScrollRafMap = new WeakMap();
const canvasCardCacheGroups = new Map();

export function getCanvasGroupKey(container, options = {}) {
    return String(
        options.messageId ||
        options.message_id ||
        container?.dataset?.messageId ||
        container?.closest?.('.message')?.dataset?.messageId ||
        'default-message'
    );
}

export function getCanvasCardCache(groupKey) {
    if (!canvasCardCacheGroups.has(groupKey)) {
        canvasCardCacheGroups.set(groupKey, new Map());
    }
    return canvasCardCacheGroups.get(groupKey);
}

export function scheduleStreamScrollToBottom(scroller) {
    if (!scroller) return;
    if (streamScrollRafMap.has(scroller)) return;
    const rafId = requestAnimationFrame(() => {
        streamScrollRafMap.delete(scroller);
        scroller.scrollTop = scroller.scrollHeight;
    });
    streamScrollRafMap.set(scroller, rafId);
}

export function isSameCanvasIdentity(a, b) {
    if (!a || !b) return false;
    if (a.id && b.id) return String(a.id) === String(b.id);
    return String(a.type || '') === String(b.type || '')
        && String(a.title || '') === String(b.title || '');
}

export function getText(getMessage, key, fallback) {
    if (typeof getMessage !== 'function') return fallback;
    try {
        const value = getMessage(key);
        return value && value !== key ? value : fallback;
    } catch (_) {
        return fallback;
    }
}

export function formatCanvasTimeDisplay(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}`;
}

export function normalizeCanvasTimestamp(value) {
    if (value == null || value === '') return null;
    const ms = typeof value === 'number' ? value : Date.parse(value);
    if (!Number.isFinite(ms)) return null;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
}
