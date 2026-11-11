// Build-time protocol shared by the browser bundle and Cloudflare Pages Functions.
export const PUBLIC_IMAGE_PROXY_PATH = '/api/public-image-proxy';

export const TRUSTED_IMAGE_ENDPOINT_PATHS = Object.freeze([
    '/api/image-get',
    '/api/docdata/image-get',
    PUBLIC_IMAGE_PROXY_PATH
]);

export const WIKIMEDIA_HOST_SUFFIXES = Object.freeze([
    'wikimedia.org',
    'wikimediausercontent.org'
]);

export const IMAGE_FILE_EXTENSION_SOURCE = 'png|jpe?g|webp|gif|bmp|svg|avif';
export const IMAGE_FALLBACK_PARAGRAPH_STEP = 3;
export const MAX_INLINE_IMAGE_PARTS_PER_RESPONSE = 4;
export const IMAGE_SLOT_TOKEN_PREFIX = '[[IMAGE_SLOT:';

export const STREAM_PROTOCOL_TAG_START_MARKERS = Object.freeze([
    '[IMG]',
    IMAGE_SLOT_TOKEN_PREFIX,
    '<canvasmode',
    '<span'
]);

export const STREAM_PROTOCOL_PARTIAL_MARKERS = Object.freeze([
    ...STREAM_PROTOCOL_TAG_START_MARKERS,
    '[/IMG]',
    '![',
    '</canvasmode',
    'data-stream-image-slot',
    '</span'
]);

const IMAGE_EXTENSION_ONLY_PATTERN = new RegExp(
    `^\\.(?:${IMAGE_FILE_EXTENSION_SOURCE})(?:[?#].*)?$`,
    'i'
);
const IMAGE_EXTENSION_PATTERN = new RegExp(
    `\\.(?:${IMAGE_FILE_EXTENSION_SOURCE})(?:$|[?#])`,
    'i'
);
const IMAGE_EXTENSION_MATCH_PATTERN = new RegExp(
    `\\.(?:${IMAGE_FILE_EXTENSION_SOURCE})(?=$|[?#\\s|])`,
    'gi'
);
const IMAGE_EXTENSION_WITH_TRAILING_TEXT_PATTERN = new RegExp(
    `\\.(?:${IMAGE_FILE_EXTENSION_SOURCE})\\s+\\S`,
    'i'
);
const BARE_IMAGE_FILENAME_PATTERN = new RegExp(
    `^[^/?#]+\\.(?:${IMAGE_FILE_EXTENSION_SOURCE})(?:[?#].*)?$`,
    'i'
);
const IMAGE_FORMAT_HINT_PATTERN = new RegExp(
    `(?:format)=?(?:${IMAGE_FILE_EXTENSION_SOURCE})`,
    'i'
);
const IMAGE_SLOT_TOKEN_PATTERN = /\[\[IMAGE_SLOT:[^\]]+\]\]/gi;
const HTML_IMAGE_SLOT_PATTERN = /<span\b[^>]*\bdata-stream-image-slot\s*=\s*["'][^"']+["'][^>]*>\s*<\/span>/gi;
const IMAGE_RENDER_PROTOCOL_PATTERN = /\[\[IMAGE_SLOT:[^\]]+\]\]|\[IMG\][\s\S]*?\[\/IMG\]|<span\b[^>]*\bdata-stream-image-slot\b|!\[[^\]]*\]\([^\s)]+/i;

export function hostMatchesSuffix(hostname, suffixes = []) {
    const host = String(hostname || '').trim().toLowerCase();
    if (!host) return false;
    return suffixes.some((suffixRaw) => {
        const suffix = String(suffixRaw || '').trim().toLowerCase();
        return !!suffix && (host === suffix || host.endsWith(`.${suffix}`));
    });
}

export function isWikimediaHost(hostname) {
    return hostMatchesSuffix(hostname, WIKIMEDIA_HOST_SUFFIXES);
}

export function isTrustedImageEndpointPath(rawPath = '') {
    const path = String(rawPath || '').trim().toLowerCase();
    if (!path) return false;
    return TRUSTED_IMAGE_ENDPOINT_PATHS.some((endpoint) =>
        path === endpoint
        || path.startsWith(`${endpoint}/`)
        || path.startsWith(`${endpoint}?`)
        || path.startsWith(`${endpoint}#`)
    );
}

export function isExtensionOnlyImagePath(value = '') {
    return IMAGE_EXTENSION_ONLY_PATTERN.test(String(value || '').trim());
}

export function hasRecognizedImageExtension(value = '') {
    return IMAGE_EXTENSION_PATTERN.test(String(value || ''));
}

export function getRecognizedImageExtensionMatches(value = '') {
    return String(value || '').match(IMAGE_EXTENSION_MATCH_PATTERN) || [];
}

export function hasImageExtensionFollowedByText(value = '') {
    return IMAGE_EXTENSION_WITH_TRAILING_TEXT_PATTERN.test(String(value || ''));
}

export function isBareImageFilename(value = '') {
    return BARE_IMAGE_FILENAME_PATTERN.test(String(value || '').trim());
}

export function hasRecognizedImageFormatHint(value = '') {
    return IMAGE_FORMAT_HINT_PATTERN.test(String(value || ''));
}

export function getImageFallbackParagraph(index = 0) {
    const normalizedIndex = Math.max(0, Number.parseInt(String(index), 10) || 0);
    return (normalizedIndex + 1) * IMAGE_FALLBACK_PARAGRAPH_STEP;
}

export function buildImageSlotToken(slotId = 'img_1') {
    const safeSlotId = String(slotId || '').replace(/[^a-zA-Z0-9_-]/g, '').trim() || 'img_1';
    return `${IMAGE_SLOT_TOKEN_PREFIX}${safeSlotId}]]`;
}

export function stripImageSlotMarkers(text = '') {
    return String(text || '')
        .replace(IMAGE_SLOT_TOKEN_PATTERN, '')
        .replace(HTML_IMAGE_SLOT_PATTERN, '');
}

export function stripImageRenderProtocolMarkers(text = '') {
    return stripImageSlotMarkers(String(text || '').replace(/\[IMG\][\s\S]*?\[\/IMG\]/gi, ''));
}

export function containsImageRenderProtocol(text = '') {
    return IMAGE_RENDER_PROTOCOL_PATTERN.test(String(text || ''));
}

export function getTrailingPartialProtocolMarkerLength(text = '') {
    const input = String(text || '');
    let hold = 0;
    for (const marker of STREAM_PROTOCOL_PARTIAL_MARKERS) {
        const max = Math.min(input.length, marker.length - 1);
        for (let index = max; index >= 1; index -= 1) {
            const suffix = input.slice(-index);
            const prefix = marker.slice(0, index);
            const matches = marker.startsWith('<')
                ? suffix.toLowerCase() === prefix.toLowerCase()
                : suffix === prefix;
            if (matches) {
                hold = Math.max(hold, index);
                break;
            }
        }
    }
    return hold;
}

export function findFirstStreamProtocolTagStart(text = '', additionalIndices = []) {
    const input = String(text || '');
    const lower = input.toLowerCase();
    const indices = STREAM_PROTOCOL_TAG_START_MARKERS.map((marker) =>
        marker.startsWith('<') ? lower.indexOf(marker) : input.indexOf(marker)
    );
    additionalIndices.forEach((index) => indices.push(Number(index)));
    const valid = indices.filter((index) => Number.isInteger(index) && index >= 0);
    return valid.length > 0 ? Math.min(...valid) : -1;
}

export function unwrapPublicImageProxyUrl(rawUrl = '', baseOrigin = 'https://littleaibox.com') {
    const input = String(rawUrl || '').trim();
    if (!input) return '';
    try {
        const parsed = new URL(input, baseOrigin);
        if (parsed.pathname !== PUBLIC_IMAGE_PROXY_PATH) return '';
        const original = String(parsed.searchParams.get('url') || '').trim();
        if (!original) return '';
        const decoded = decodeURIComponent(original);
        if (!/^https?:\/\//i.test(decoded)) return '';
        return decoded;
    } catch (_) {
        return '';
    }
}

export function buildPublicImageProxyUrlIfNeeded(rawUrl = '', baseOrigin = 'https://littleaibox.com') {
    const input = String(rawUrl || '').trim();
    if (!input) return '';
    try {
        const parsed = new URL(input, baseOrigin);
        if (!/^https?:$/i.test(parsed.protocol)) return '';
        if (parsed.pathname === PUBLIC_IMAGE_PROXY_PATH) return parsed.toString();
        if (!isWikimediaHost(parsed.hostname)) return '';
        return `${PUBLIC_IMAGE_PROXY_PATH}?url=${encodeURIComponent(parsed.toString())}`;
    } catch (_) {
        return '';
    }
}
