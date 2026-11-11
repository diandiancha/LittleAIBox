const LANGUAGE_NAME_PATTERN = /^[a-z0-9_-]+$/i;
const failedLanguages = new Set();
let highlightCoreReady = false;

function ensureHighlightCore() {
    if (highlightCoreReady) return true;
    try {
        importScripts('/libs/highlight.min.js');
    } catch (_) {
        return false;
    }
    if (!self.hljs || typeof self.hljs.highlight !== 'function') return false;
    if (!self.hljs.getLanguage('plaintext')) {
        try {
            self.hljs.registerLanguage('plaintext', () => ({ name: 'Plaintext', contains: [] }));
        } catch (_) { }
    }
    highlightCoreReady = true;
    return true;
}

function ensureLanguage(language) {
    const lang = String(language || '').trim();
    if (!lang || !LANGUAGE_NAME_PATTERN.test(lang)) return false;
    if (self.hljs.getLanguage(lang)) return true;
    if (failedLanguages.has(lang)) return false;
    try {
        importScripts(`/libs/languages/${lang}.min.js`);
    } catch (_) {
        failedLanguages.add(lang);
        return false;
    }
    return !!self.hljs.getLanguage(lang);
}

function escapeHtml(source = '') {
    return String(source)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function highlightSource(source, language) {
    const text = String(source || '');
    const lang = String(language || '').trim() || 'plaintext';
    const hljs = self.hljs;
    try {
        if (hljs.getLanguage(lang)) {
            return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
        }
    } catch (_) { }
    return escapeHtml(text);
}

function highlightStreamingSource(source, language) {
    let text = String(source || '');
    if (language !== 'xml') return highlightSource(text, language);
    let suffix = '';
    const lastLt = text.lastIndexOf('<');
    if (lastLt > text.lastIndexOf('>') && /^(?:\/?[A-Za-z][\w:-]*[\s\S]*|![\s\S]*|\?[\s\S]*)$/.test(text.slice(lastLt + 1))) {
        suffix = escapeHtml(text.slice(lastLt));
        text = text.slice(0, lastLt);
    }
    const lower = text.toLowerCase();
    for (const [tag, embeddedLanguage] of [['style', 'css'], ['script', 'javascript']]) {
        const open = lower.lastIndexOf(`<${tag}`);
        if (open <= lower.lastIndexOf(`</${tag}>`)) continue;
        const end = text.indexOf('>', open);
        if (end >= 0) {
            return highlightSource(text.slice(0, end + 1), 'xml')
                + highlightSource(text.slice(end + 1), embeddedLanguage) + suffix;
        }
    }
    return highlightSource(text, language) + suffix;
}

self.onmessage = (event) => {
    const data = event.data || {};
    if (data.type !== 'highlight') return;
    const { requestId, source, language, dependencies, streaming } = data;
    if (!ensureHighlightCore()) {
        self.postMessage({ requestId, error: 'core-unavailable' });
        return;
    }
    const languages = Array.isArray(dependencies) && dependencies.length ? dependencies : [language];
    languages.forEach(ensureLanguage);
    try {
        self.postMessage({ requestId, html: streaming ? highlightStreamingSource(source, language) : highlightSource(source, language) });
    } catch (error) {
        self.postMessage({ requestId, error: String(error?.message || error || 'highlight-failed') });
    }
};
