import { Capacitor } from '@capacitor/core';

export const isNativeApp = Capacitor.isNativePlatform();

function readApiOrigin(value) {
    const configured = String(value || '').trim();
    if (!configured) return '';
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('VITE_API_BASE_URL must be an HTTP(S) origin without credentials, path, query or fragment.');
    }
    return url.origin;
}

// A public checkout never selects the author's production service automatically.
// VITE_* settings are public build-time configuration, never secret storage.
export const API_BASE_URL = readApiOrigin(import.meta.env.VITE_API_BASE_URL);

const isApiPath = (pathname, method) =>
    pathname.startsWith('/api/')
    || pathname.startsWith('/auth/')
    || pathname.startsWith('/image-proxy')
    || pathname.startsWith('/image-get')
    || (pathname === '/' && !['GET', 'HEAD'].includes(method));

if (API_BASE_URL && API_BASE_URL !== window.location.origin) {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
        const rawUrl = typeof input === 'string' || input instanceof URL
            ? String(input)
            : input instanceof Request ? input.url : '';
        if (!rawUrl) return originalFetch(input, init);
        const url = new URL(rawUrl, window.location.href);
        const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        // Never redirect third-party or signed storage URLs to the API service.
        if (url.origin !== window.location.origin || !isApiPath(url.pathname, method)) {
            return originalFetch(input, init);
        }
        const target = API_BASE_URL + url.pathname + url.search;
        return originalFetch(input instanceof Request ? new Request(target, input) : target, init);
    };
}
