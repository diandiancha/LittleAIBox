const CANVAS_HIGHLIGHT_WORKER_URL = '/workers/canvas-highlight-worker.js';
const LANGUAGE_NAME_PATTERN = /^[a-z0-9_-]+$/i;

let highlightWorker = null;
let highlightWorkerDisabled = false;
let highlightRequestSeq = 0;
const pendingHighlightRequests = new Map();
const inflightHighlightByKey = new Map();

function resolvePendingRequest(requestId, html) {
    const pending = pendingHighlightRequests.get(requestId);
    if (!pending) return;
    pendingHighlightRequests.delete(requestId);
    inflightHighlightByKey.delete(pending.key);
    pending.resolve(typeof html === 'string' ? html : null);
}

function disableHighlightWorker() {
    highlightWorkerDisabled = true;
    if (highlightWorker) {
        try {
            highlightWorker.terminate();
        } catch (_) { }
        highlightWorker = null;
    }
    const pendingIds = Array.from(pendingHighlightRequests.keys());
    pendingIds.forEach(requestId => resolvePendingRequest(requestId, null));
}

function ensureHighlightWorker() {
    if (highlightWorkerDisabled) return null;
    if (highlightWorker) return highlightWorker;
    if (typeof Worker === 'undefined') {
        highlightWorkerDisabled = true;
        return null;
    }
    try {
        highlightWorker = new Worker(CANVAS_HIGHLIGHT_WORKER_URL);
    } catch (_) {
        highlightWorkerDisabled = true;
        return null;
    }
    highlightWorker.onmessage = (event) => {
        const data = event?.data || {};
        if (data.error === 'core-unavailable') {
            disableHighlightWorker();
            return;
        }
        resolvePendingRequest(data.requestId, data.error ? null : data.html);
    };
    highlightWorker.onerror = (event) => {
        event?.preventDefault?.();
        disableHighlightWorker();
    };
    return highlightWorker;
}

export function canUseCanvasHighlightWorker(languages = []) {
    if (highlightWorkerDisabled || typeof Worker === 'undefined') return false;
    return languages.length > 0
        && languages.every(lang => LANGUAGE_NAME_PATTERN.test(String(lang || '')));
}

export function highlightInCanvasWorker(source, language, dependencies = [], { streaming = false } = {}) {
    const text = String(source || '');
    const lang = String(language || '').trim() || 'plaintext';
    const key = `${lang}::${streaming ? 'stream' : 'final'}::${text}`;
    if (inflightHighlightByKey.has(key)) return inflightHighlightByKey.get(key);
    const worker = ensureHighlightWorker();
    if (!worker) return Promise.resolve(null);

    const requestId = ++highlightRequestSeq;
    const promise = new Promise(resolve => {
        pendingHighlightRequests.set(requestId, { resolve, key });
    });
    inflightHighlightByKey.set(key, promise);
    try {
        worker.postMessage({
            type: 'highlight',
            requestId,
            source: text,
            language: lang,
            dependencies,
            streaming
        });
    } catch (_) {
        resolvePendingRequest(requestId, null);
    }
    return promise;
}
