import { decodeCanvasAttribute, encodeCanvasAttribute, getCanvasFenceLanguage, normalizeCanvasType } from './canvas/canvas-utils.js';
import { advanceMarkdownFenceState } from './mathrender/markdown-fences.js';
import { startVisibilityAwareTimeout } from './visibility-aware-timeout.js';
import { createStreamPacer } from './stream-pacer.js';
import { planStreamingContentUpdate, commitStreamingContentUpdate } from './stream-text-update.js';
import { selectionIntersectsNode } from './stream-selection-guard.js';
import { captureDisplayMathState, restoreDisplayMathState } from './mathrender/display-math-state.js';
import {
    findFirstStreamProtocolTagStart,
    getImageFallbackParagraph,
    getRecognizedImageExtensionMatches,
    getTrailingPartialProtocolMarkerLength,
    hasImageExtensionFollowedByText,
    hasRecognizedImageExtension,
    hasRecognizedImageFormatHint,
    isBareImageFilename,
    isExtensionOnlyImagePath,
    isTrustedImageEndpointPath,
    stripImageRenderProtocolMarkers,
    unwrapPublicImageProxyUrl as unwrapSharedPublicImageProxyUrl
} from '../shared-runtime/image-protocol.js';

function isTrustedRawImageSource(value = '') {
    const source = String(value || '').trim();
    if (!source) return false;
    return /^(?:https?:)?\/\//i.test(source)
        || /^data:image\/[a-z0-9.+-]+(?:;|,)/i.test(source)
        || /^(?:blob|cid):/i.test(source)
        || isTrustedImageEndpointPath(source);
}

function escapeHtmlTag(tag = '') {
    return String(tag || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function escapeUnsupportedRawImageTagsForMarkdown(markdown = '') {
    const input = String(markdown || '');
    if (!/<img\b/i.test(input)) return input;

    let output = '';
    let index = 0;
    let lineStart = true;
    let fence = null;
    let inlineTicks = 0;

    while (index < input.length) {
        if (lineStart) {
            const lineEnd = input.indexOf('\n', index);
            const currentLine = input.slice(index, lineEnd === -1 ? input.length : lineEnd).replace(/\r$/, '');
            const fenceState = advanceMarkdownFenceState(fence, currentLine);
            if (fenceState.isFenceLine) {
                fence = fenceState.openFence;
                const consumedLine = lineEnd === -1 ? input.slice(index) : input.slice(index, lineEnd + 1);
                output += consumedLine;
                index += consumedLine.length;
                lineStart = true;
                inlineTicks = 0;
                continue;
            }
        }

        if (fence) {
            const nextLine = input.indexOf('\n', index);
            const consumed = nextLine === -1 ? input.slice(index) : input.slice(index, nextLine + 1);
            output += consumed;
            index += consumed.length;
            lineStart = true;
            continue;
        }

        const char = input[index];
        if (char === '`') {
            let runLength = 1;
            while (input[index + runLength] === '`') runLength += 1;
            if (inlineTicks === 0) inlineTicks = runLength;
            else if (runLength === inlineTicks) inlineTicks = 0;
            output += input.slice(index, index + runLength);
            index += runLength;
            lineStart = false;
            continue;
        }

        if (inlineTicks === 0 && char === '<' && /^<img\b/i.test(input.slice(index))) {
            let cursor = index + 4;
            let quote = '';
            while (cursor < input.length) {
                const current = input[cursor];
                if (quote) {
                    if (current === quote) quote = '';
                } else if (current === '"' || current === "'") {
                    quote = current;
                } else if (current === '>') {
                    break;
                }
                cursor += 1;
            }
            if (cursor < input.length) {
                const tag = input.slice(index, cursor + 1);
                const srcMatch = tag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
                const source = srcMatch ? (srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? '') : '';
                output += isTrustedRawImageSource(source) ? tag : escapeHtmlTag(tag);
                index = cursor + 1;
                lineStart = false;
                continue;
            }
        }

        output += char;
        index += 1;
        lineStart = char === '\n';
        if (lineStart) inlineTicks = 0;
    }

    return output;
}

export function unwrapStreamPublicImageProxyUrl(rawUrl = '', baseOrigin = 'https://littleaibox.com') {
    return unwrapSharedPublicImageProxyUrl(rawUrl, baseOrigin);
}

export function createStreamRenderRuntime(deps = {}) {
    const {
        toAbsoluteImageUrl,
        toPublicImageProxyUrl,
        getToastMessage,
        elements,
        shouldAutoScroll,
        scheduleSmoothScrollToBottom,
        withStreamingAnchor,
        ensureMessageActionsVisible,
        renderMessageContent,
        scrollManager,
        getRenderSpeedForModel,
        getCurrentModelId,
        normalizeModelIdForRender,
        getIsRenderSurfaceVisible,
        backgroundMode = 'browser',
        getNativeBackgroundEpoch = () => 0,
        onStreamOutputStarted = () => { }
    } = deps;
    const isNativeBackgroundRuntime = backgroundMode === 'native';

    const runWithStreamingAnchor = (renderFn, options = {}) => {
        if (typeof withStreamingAnchor === 'function') {
            return withStreamingAnchor(renderFn, options);
        }
        return renderFn();
    };

    const replayMessageRender = (element, args) => renderMessageContent(
        element, args.content, args.citations, args.isFinalRender, args.options
    );
    // 所有消息来源共用每帧合并，选区不参与调度或阻止提交。
    function beginMessageRender(element, args) {
        if (args.isFinalRender) {
            delete element.__renderThrottle;
            return true;
        }

        const throttleState = element.__renderThrottle || (element.__renderThrottle = {
            pending: false,
            latestArgs: null
        });
        if (throttleState.pending) {
            throttleState.latestArgs = args;
            return false;
        }

        throttleState.pending = true;
        throttleState.latestArgs = null;
        requestAnimationFrame(() => {
            if (element.__renderThrottle !== throttleState) return;
            throttleState.pending = false;
            const latestArgs = throttleState.latestArgs;
            if (!latestArgs) return;
            throttleState.latestArgs = null;
            const render = () => replayMessageRender(element, latestArgs);
            if (typeof args.options?.withStreamingAnchor === 'function') {
                args.options.withStreamingAnchor(render, { fallback: false });
            } else {
                render();
            }
        });
        return true;
    }

    function updateMessageText(element, text) {
        const plan = planStreamingContentUpdate(element, element.textContent || '', text, { format: 'text' });
        commitStreamingContentUpdate(plan);
        return true;
    }

    const STREAM_RENDER_INTERVAL_MS = 30;
    const STREAM_INITIAL_BUFFER_CHARS = 18;
    const STREAM_RESUME_BUFFER_CHARS = 10;
    const STREAM_INITIAL_BUFFER_WAIT_MS = 140;
    const STREAM_RESUME_BUFFER_WAIT_MS = 90;
    const STREAMING_HORIZONTAL_RULE_TAIL_RE = /(?:^|\r?\n)[ \t]{0,3}([\*\-_])(?:[ \t]*\1){2,}[ \t]*$/;
    const EXPLICIT_HORIZONTAL_RULE_RE = /(?:^|\r?\n)[ \t]{0,3}([*\-_])(?:[ \t]*\1){2,}[ \t]*(?:\r?\n|$)/;
    const STREAM_MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\(([^)\s]+(?:\?[^)\s]*)?)\)/gi;
    const STREAM_BASE64_PATTERN = /^[A-Za-z0-9+/=\r\n]+$/;

    const state = {
        globalDisplayBuffer: '',
        globalContentDiv: null,
        globalCharQueue: [],
        explicitImageTagUrls: new Set(),
        imgWrappedTagUrls: new Set()
    };
    const resolvedImagePreloadCache = new Map();

    function toDisplayImageUrl(rawUrl = '') {
        const input = String(rawUrl || '').trim();
        if (!input) return '';
        if (typeof toPublicImageProxyUrl === 'function') {
            const proxied = String(toPublicImageProxyUrl(input) || '').trim();
            if (proxied) return proxied;
        }
        return input;
    }

    function unwrapPublicImageProxyUrl(rawUrl = '') {
        const baseOrigin = typeof window !== 'undefined' && window.location?.origin
            ? window.location.origin
            : 'https://littleaibox.com';
        return unwrapStreamPublicImageProxyUrl(rawUrl, baseOrigin);
    }

    const VOID_HTML_TAGS = new Set([
        'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
        'link', 'meta', 'param', 'source', 'track', 'wbr'
    ]);

    function hasBalancedHtmlPrefix(html) {
        const tagRegex = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
        const stack = [];
        let match;

        while ((match = tagRegex.exec(html)) !== null) {
            const name = match[2].toLowerCase();
            if (VOID_HTML_TAGS.has(name) || match[3] === '/') continue;

            if (match[1] === '/') {
                if (stack.pop() !== name) return false;
                continue;
            }
            stack.push(name);
        }

        return stack.length === 0;
    }

    function findLastCompleteDisplayMathEnd(html) {
        if (!html) return -1;

        const skipRanges = [];
        const skipTagRegex = /<(pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi;
        let skipMatch;
        while ((skipMatch = skipTagRegex.exec(html)) !== null) {
            skipRanges.push({ start: skipMatch.index, end: skipMatch.index + skipMatch[0].length });
        }
        const isInsideCode = (index) => skipRanges.some(range => index >= range.start && index < range.end);

        const indices = [];
        for (let i = 0; i < html.length - 1; i++) {
            if (html[i] === '$' && html[i + 1] === '$' && html[i - 1] !== '\\' && !isInsideCode(i)) {
                indices.push(i);
                i += 1;
            }
        }
        if (indices.length < 2) return -1;
        if (indices.length % 2 === 1) indices.pop();

        const closingIndex = indices[indices.length - 1];
        const end = closingIndex + 2;
        const tail = html.slice(end).match(/^(?:\s*(?:<\/p>|<\/div>|<br\s*\/?>))+/i);
        if (!tail) return -1;
        return end + tail[0].length;
    }

    function findLastCompleteStreamImageBlockEnd(html) {
        if (!html) return -1;
        const source = String(html);
        const anchorRegex = /<span\b[^>]*\bdata-stream-image-slot\b[^>]*>\s*<\/span\s*>|<img\b[^>]*>/gi;
        let anchorEnd = -1;
        let anchorMatch;
        while ((anchorMatch = anchorRegex.exec(source)) !== null) {
            anchorEnd = anchorMatch.index + anchorMatch[0].length;
        }
        if (anchorEnd < 0) return -1;

        const closeRegex = /<\/(?:p|li|ul|ol|figure|blockquote|div|h[1-6]|table)\s*>/gi;
        closeRegex.lastIndex = anchorEnd;
        let attempts = 0;
        let closeMatch;
        while ((closeMatch = closeRegex.exec(source)) !== null) {
            if (++attempts > 8) return -1;
            const blockEnd = closeMatch.index + closeMatch[0].length;
            if (!/\S/.test(source.slice(blockEnd))) return -1;
            if (hasBalancedHtmlPrefix(source.slice(0, blockEnd))) return blockEnd;
        }
        return -1;
    }

    function stripStreamingHorizontalRuleTail(text) {
        if (!text) return text;
        let end = text.length;
        while (end > 0) {
            const code = text.charCodeAt(end - 1);
            if (code === 10 || code === 13) {
                end--;
            } else {
                break;
            }
        }
        const withoutTrailingNewlines = text.slice(0, end);
        const match = withoutTrailingNewlines.match(STREAMING_HORIZONTAL_RULE_TAIL_RE);
        if (!match) {
            return text;
        }
        const removalStart = withoutTrailingNewlines.length - match[0].length;
        const trimmed = withoutTrailingNewlines.slice(0, removalStart);
        return trimmed + text.slice(end);
    }

    function containsExplicitHorizontalRule(text) {
        if (!text) return false;
        return EXPLICIT_HORIZONTAL_RULE_RE.test(text) || /<\s*hr\b/i.test(text);
    }

    function normalizeStreamImageUrl(value, options = {}) {
        const { fromExplicitImageTag = false } = options || {};
        if (typeof value !== 'string') return '';
        let candidate = value.trim();
        if (!candidate) return '';
        candidate = candidate.replace(/^[<("'`\[]+/, '').replace(/[>)"'`\]]+$/, '').trim();
        if (!candidate) return '';
        const originalCandidate = candidate;

        if (isExtensionOnlyImagePath(originalCandidate)) return '';

        if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(candidate)) {
            return candidate.replace(/\s+/g, '');
        }
        if (/^blob:/i.test(candidate)) {
            return candidate;
        }

        if (!fromExplicitImageTag && isBareImageFilename(originalCandidate)) {
            return '';
        }

        if (!/^https?:\/\//i.test(candidate)) {
            const absolute = toAbsoluteImageUrl ? toAbsoluteImageUrl(candidate) : candidate;
            candidate = (typeof absolute === 'string' && absolute.trim()) ? absolute.trim() : candidate;
        }

        if (!/^https?:\/\//i.test(candidate)) return '';
        try {
            const parsed = new URL(candidate);
            let pathBasename = String(parsed.pathname || '').split('/').pop() || '';
            try {
                pathBasename = decodeURIComponent(pathBasename);
            } catch (_) { }
            if (isExtensionOnlyImagePath(pathBasename)) return '';
            const hasEmptyDimensionParam = ['w', 'h', 'width', 'height'].some((key) =>
                parsed.searchParams.has(key) && !String(parsed.searchParams.get(key) || '').trim()
            );
            if (hasEmptyDimensionParam && !fromExplicitImageTag) {
                return '';
            }
            if (fromExplicitImageTag) {
                return parsed.toString();
            }
            const pathAndQuery = `${parsed.pathname}${parsed.search || ''}`;
            const queryText = (parsed.search || '').toLowerCase();
            const isKnownImageEndpoint = isTrustedImageEndpointPath(parsed.pathname);
            const hasImageHint = /(?:format|mime|content[-_]?type|response-content-type)=image(?:%2f|\/)?[a-z0-9.+-]*/i.test(queryText)
                || hasRecognizedImageFormatHint(queryText);
            if (!fromExplicitImageTag && !isKnownImageEndpoint) {
                let decodedPathAndQuery = pathAndQuery;
                try {
                    decodedPathAndQuery = decodeURIComponent(pathAndQuery);
                } catch (_) { }
                const imageExtensionMatches = getRecognizedImageExtensionMatches(decodedPathAndQuery);
                const hasTableTextFragment = /(^|[\s|])\|([\s|]|$)/.test(decodedPathAndQuery)
                    || hasImageExtensionFollowedByText(decodedPathAndQuery);
                if (imageExtensionMatches.length > 1 || hasTableTextFragment) return '';
            }
            if (!hasRecognizedImageExtension(pathAndQuery) && !hasImageHint && !isKnownImageEndpoint) return '';
            return parsed.toString();
        } catch (_) {
            return '';
        }
    }

    function buildStreamImageDataUrl(base64, mimeType = 'image/png') {
        if (typeof base64 !== 'string') return '';
        const trimmed = base64.trim();
        if (!trimmed) return '';
        if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed)) {
            return normalizeStreamImageUrl(trimmed);
        }
        if (trimmed.length < 64 || !STREAM_BASE64_PATTERN.test(trimmed)) return '';
        const safeMime = /^image\/[a-z0-9.+-]+$/i.test(String(mimeType || '')) ? String(mimeType) : 'image/png';
        return `data:${safeMime};base64,${trimmed.replace(/\s+/g, '')}`;
    }

    function blankPreservingLine(line = '') {
        const text = String(line || '');
        const newlineMatch = text.match(/(\r\n|\n|\r)$/);
        const newline = newlineMatch ? newlineMatch[0] : '';
        return ' '.repeat(text.length - newline.length) + newline;
    }

    function blankPreservingText(text = '') {
        const input = String(text || '');
        return input.replace(/[^\r\n]/g, ' ');
    }

    function stripMarkdownCodeBlocksForImageScan(text) {
        const input = String(text || '');
        if (!input) return '';

        const lines = input.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) || [];
        if (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
        }

        let openFence = null;
        const withoutFences = lines.map((line) => {
            const content = line.replace(/(\r\n|\n|\r)$/, '');
            const fenceState = advanceMarkdownFenceState(openFence, content);

            if (openFence) {
                openFence = fenceState.openFence;
                return blankPreservingLine(line);
            }

            if (fenceState.isFenceLine) {
                openFence = fenceState.openFence;
                return blankPreservingLine(line);
            }

            return line;
        }).join('');

        return withoutFences
            .replace(/<canvasmode\b[\s\S]*?<\/canvasmode>/gi, blankPreservingText)
            .replace(/`[^`\r\n]+`/g, blankPreservingText);
    }

    function collectStreamImageUrlsFromText(text, collector, options = {}) {
        if (typeof text !== 'string' || !text || !collector) return;
        const scanText = options.alreadySanitized
            ? text
            : stripMarkdownCodeBlocksForImageScan(text);
        if (!scanText.trim()) return;

        STREAM_MARKDOWN_IMAGE_PATTERN.lastIndex = 0;
        let mdMatch;
        while ((mdMatch = STREAM_MARKDOWN_IMAGE_PATTERN.exec(scanText)) !== null) {
            const normalized = normalizeStreamImageUrl(mdMatch[1]);
            if (normalized) collector.add(normalized);
        }
    }

    function collectStreamImageUrlsFromVisibleDelta(previousText, deltaText, collector) {
        if (typeof deltaText !== 'string' || !deltaText || !collector) return;
        const prefix = String(previousText || '');
        const combined = prefix + deltaText;
        const sanitized = stripMarkdownCodeBlocksForImageScan(combined);
        const sanitizedDelta = sanitized.slice(prefix.length);
        collectStreamImageUrlsFromText(sanitizedDelta, collector, { alreadySanitized: true });
    }

    function collectStreamImageUrlsFromPayload(value, collector, depth = 0) {
        if (!collector || depth > 5 || value == null) return;

        if (typeof value === 'string') {
            collectStreamImageUrlsFromText(value, collector);
            return;
        }

        if (Array.isArray(value)) {
            value.forEach((item) => collectStreamImageUrlsFromPayload(item, collector, depth + 1));
            return;
        }

        if (typeof value !== 'object') return;

        if (value.type === 'image_url') {
            const direct = typeof value.image_url === 'string'
                ? value.image_url
                : value.image_url?.url;
            const normalized = normalizeStreamImageUrl(direct || '');
            if (normalized) collector.add(normalized);
        }

        const urlCandidates = [
            value.url,
            value.image_url,
            value.imageUrl,
            value.uri
        ];
        urlCandidates.forEach((item) => {
            if (typeof item === 'string') {
                const normalized = normalizeStreamImageUrl(item);
                if (normalized) collector.add(normalized);
            } else if (item && typeof item === 'object' && typeof item.url === 'string') {
                const normalized = normalizeStreamImageUrl(item.url);
                if (normalized) collector.add(normalized);
            }
        });

        const possibleBase64 = [
            value.b64_json,
            value.base64,
            value.image_base64
        ];
        possibleBase64.forEach((b64) => {
            if (typeof b64 !== 'string') return;
            const dataUrl = buildStreamImageDataUrl(b64, value.mime_type || value.mimeType || 'image/png');
            if (dataUrl) collector.add(dataUrl);
        });

        Object.keys(value).forEach((key) => {
            collectStreamImageUrlsFromPayload(value[key], collector, depth + 1);
        });
    }

    function extractStreamDeltaText(data) {
        if (!data || typeof data !== 'object') return '';
        const delta = data.choices?.[0]?.delta;
        if (typeof delta?.content === 'string') return delta.content;

        if (Array.isArray(delta?.content)) {
            return delta.content
                .map((part) => {
                    if (typeof part === 'string') return part;
                    if (!part || typeof part !== 'object') return '';
                    if (typeof part.text === 'string') return part.text;
                    if (part.type === 'text' && typeof part.content === 'string') return part.content;
                    return '';
                })
                .join('');
        }

        if (typeof delta?.text === 'string') return delta.text;
        if (typeof data?.content === 'string') return data.content;
        if (typeof data?.text === 'string') return data.text;
        if (typeof data?.output_text === 'string') return data.output_text;
        return '';
    }

    function parsePossibleJsonEnvelope(rawText) {
        const text = String(rawText || '').trim();
        if (!text) return null;
        if (!(text.startsWith('{') && text.endsWith('}'))) {
            return null;
        }
        try {
            const parsed = JSON.parse(text);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (_) {
            return null;
        }
    }

    function normalizeStreamParts(parts) {
        if (!Array.isArray(parts) || parts.length === 0) return [];
        const seen = new Set();
        const result = [];
        parts.forEach((item) => {
            const fromExplicitImageTag = !!item?._fromExplicitImageTag;
            const url = normalizeStreamImageUrl(item?.image_url?.url || item?.url || '', {
                fromExplicitImageTag
            });
            if (!url) return;
            if (!fromExplicitImageTag && seen.has(url)) return;
            if (!fromExplicitImageTag) seen.add(url);
            const normalized = { type: 'image_url', image_url: { url } };
            if (fromExplicitImageTag) {
                normalized._fromExplicitImageTag = true;
            }
            result.push(normalized);
        });
        return result;
    }

    function normalizeStreamPlacement(value) {
        const rawText = String(value || '').trim();
        const raw = rawText.toLowerCase();
        if (!raw) return 'tail';
        if (raw === 'tail' || raw === 'end' || raw === 'append') return 'tail';
        if (raw === 'head' || raw === 'top' || raw === 'prepend') return 'head';
        const slotMatch = rawText.match(/^slot:([a-zA-Z0-9_-]+)$/);
        if (slotMatch) {
            return `slot:${slotMatch[1]}`;
        }
        const match = raw.match(/^after_paragraph:(\d+)$/);
        if (match) {
            const n = Math.max(1, parseInt(match[1], 10) || 1);
            return `after_paragraph:${n}`;
        }
        return 'tail';
    }

    function normalizeStreamLayout(layout) {
        if (!Array.isArray(layout) || layout.length === 0) return [];
        return layout
            .map((item, index) => {
                if (!item || typeof item !== 'object') return null;
                const imageId = String(item.image_id || `img_${index + 1}`).trim();
                const url = normalizeStreamImageUrl(item.url || item.image_url?.url || '');
                const placement = normalizeStreamPlacement(item.placement || item.position || item.insert_at);
                return {
                    image_id: imageId || `img_${index + 1}`,
                    url,
                    placement,
                    fallback_paragraph: Math.max(0, parseInt(String(item.fallback_paragraph || item.fallbackParagraph || '0'), 10) || 0)
                };
            })
            .filter(Boolean);
    }

    function getPlacementPriority(value) {
        const placement = normalizeStreamPlacement(value);
        if (placement.startsWith('slot:')) return 3;
        if (placement.startsWith('after_paragraph:') || placement === 'head') return 2;
        return 1;
    }

    function mergeIncomingImageLayout(existingLayout = [], incomingLayout = []) {
        const incoming = normalizeStreamLayout(incomingLayout);
        if (incoming.length === 0) return normalizeStreamLayout(existingLayout);

        const incomingIds = new Set(incoming.map(item => String(item?.image_id || '').trim()).filter(Boolean));
        const incomingUrls = new Set(incoming.map(item => String(item?.url || '').trim()).filter(Boolean));
        const preserved = normalizeStreamLayout(existingLayout).filter((item) => {
            const placement = String(item?.placement || '').toLowerCase();
            if (!placement.startsWith('slot:')) return false;
            const imageId = String(item?.image_id || '').trim();
            const url = String(item?.url || '').trim();
            if (imageId && incomingIds.has(imageId)) return false;
            if (url && incomingUrls.has(url)) return false;
            return true;
        });

        return normalizeStreamLayout([...preserved, ...incoming]);
    }

    function isSlotOnlyBlock(node) {
        if (!node || !node.querySelector) return false;
        const slot = node.querySelector('[data-stream-image-slot]');
        if (!slot) return false;
        const clone = node.cloneNode(true);
        clone.querySelectorAll('[data-stream-image-slot]').forEach(item => item.remove());
        return !String(clone.textContent || '').trim() && clone.querySelectorAll('img, video, table, pre, code').length === 0;
    }

    function getPlacementTargets(rootElement) {
        if (!rootElement) return [];
        return Array.from(
            rootElement.querySelectorAll('p, li, blockquote, pre, table, h1, h2, h3, h4, h5, h6')
        ).filter(node => !node.closest('.stream-image-attachments') && !isSlotOnlyBlock(node));
    }

    function createPendingImagePreviewContainer() {
        const phaseNow = (typeof performance !== 'undefined' && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();

        const item = document.createElement('div');
        item.className = 'image-preview-container image-preview-pending';
        item.dataset.pending = '1';

        const box = document.createElement('div');
        box.style.width = '280px';
        box.style.height = '210px';
        box.style.borderRadius = '8px';
        box.style.position = 'relative';
        box.style.overflow = 'hidden';
        box.style.background = 'linear-gradient(90deg, var(--stream-pending-bg-1) 25%, var(--stream-pending-bg-2) 37%, var(--stream-pending-bg-1) 63%)';
        box.style.backgroundSize = '400% 100%';
        box.style.animation = 'stream-pending-shimmer 1.4s ease infinite';
        box.style.animationDelay = `-${Math.floor(phaseNow % 1400)}ms`;
        box.style.display = 'flex';
        box.style.alignItems = 'center';
        box.style.justifyContent = 'center';

        const img = document.createElement('img');
        img.alt = 'image';
        img.dataset.pendingImg = '1';
        img.style.position = 'absolute';
        img.style.inset = '0';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.opacity = '0';
        img.style.transition = 'opacity 0.5s ease';
        img.style.pointerEvents = 'none';
        box.appendChild(img);

        const loadingSpinner = document.createElement('div');
        loadingSpinner.className = 'loading-spinner';
        loadingSpinner.style.margin = '0';
        loadingSpinner.dataset.pendingSpinner = '1';
        loadingSpinner.style.position = 'absolute';
        loadingSpinner.style.left = '50%';
        loadingSpinner.style.top = '50%';
        loadingSpinner.style.transform = 'translate(-50%, -50%)';
        loadingSpinner.style.zIndex = '2';
        loadingSpinner.style.transition = 'opacity 0.25s ease';

        loadingSpinner.innerHTML = `
        <svg class="spinner" viewBox="0 0 50 50" aria-hidden="true">
            <circle class="path" cx="25" cy="25" r="20" fill="none" stroke-width="5"></circle>
        </svg>
    `;
        const spinner = loadingSpinner.querySelector('.spinner');
        if (spinner) {
            spinner.style.width = '28px';
            spinner.style.height = '28px';
            spinner.style.display = 'block';
            spinner.style.overflow = 'visible';
            spinner.style.transformOrigin = '50% 50%';
            spinner.style.animation = 'spinner-rotate 1.4s linear infinite';
            spinner.style.animationDelay = `-${Math.floor(phaseNow % 1600)}ms`;
            spinner.style.animationPlayState = 'running';
            spinner.style.willChange = 'transform';
        }
        const path = loadingSpinner.querySelector('.path');
        if (path) {
            path.style.stroke = 'var(--accent-color)';
            path.style.strokeLinecap = 'round';
            path.style.strokeDasharray = '75, 150';
            path.style.strokeDashoffset = '0';
            path.style.animation = 'spinner-dash 1.4s ease-in-out infinite';
            path.style.animationDelay = `-${Math.floor(phaseNow % 1400)}ms`;
            path.style.animationPlayState = 'running';
        }

        box.appendChild(loadingSpinner);
        const btn = document.createElement('button');
        btn.className = 'image-overlay-btn';
        btn.type = 'button';
        btn.title = getToastMessage('ui.downloadImage');
        btn.dataset.action = 'download-image';
        btn.dataset.imageUrl = '';
        btn.dataset.originalUrl = '';
        btn.dataset.description = '';
        btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';
        btn.style.opacity = '0';
        btn.style.pointerEvents = 'none';
        box.appendChild(btn);
        item.appendChild(box);

        return item;
    }

    function preloadResolvedImage(targetUrl = '') {
        const originalUrl = String(targetUrl || '').trim();
        if (!originalUrl) return Promise.resolve(null);
        const cached = resolvedImagePreloadCache.get(originalUrl);
        if (cached) return cached;

        const displayUrl = toDisplayImageUrl(originalUrl);
        const candidates = [displayUrl];
        if (displayUrl !== originalUrl && /^https?:\/\//i.test(originalUrl)) {
            candidates.push(originalUrl);
        }

        const preloadPromise = new Promise((resolve) => {
            const tryCandidate = (index) => {
                const candidate = candidates[index];
                if (!candidate) {
                    resolve(null);
                    return;
                }
                const preloader = new Image();
                preloader.onload = async () => {
                    if (typeof preloader.decode === 'function') {
                        try { await preloader.decode(); } catch (_) { }
                    }
                    resolve({ originalUrl, displayUrl: candidate });
                };
                preloader.onerror = () => tryCandidate(index + 1);
                preloader.src = candidate;
            };
            tryCandidate(0);
        });
        resolvedImagePreloadCache.set(originalUrl, preloadPromise);
        return preloadPromise;
    }

    function applyLoadedImageToStableWrapper(wrapperNode, targetUrl = '', description = '', loadedDisplayUrl = '') {
        if (!wrapperNode) return false;
        const originalUrl = String(targetUrl || '').trim();
        const displayUrl = String(loadedDisplayUrl || '').trim() || toDisplayImageUrl(originalUrl);
        let preview = wrapperNode.querySelector('.image-preview-container');
        if (!preview) {
            preview = createPendingImagePreviewContainer();
            wrapperNode.appendChild(preview);
        }
        const box = preview.firstElementChild;
        const img = preview.querySelector('img');
        const button = preview.querySelector('[data-action="download-image"]');
        if (!box || !img || !button || !displayUrl) return false;

        const resolvedDescription = String(description || '').trim() || 'image';
        img.alt = resolvedDescription;
        img.dataset.imageUrl = displayUrl;
        img.dataset.originalUrl = originalUrl;
        delete img.dataset.pendingImg;
        img.src = displayUrl;
        img.style.opacity = '1';
        img.style.pointerEvents = 'auto';
        img.style.cursor = 'pointer';

        button.dataset.imageUrl = displayUrl;
        button.dataset.originalUrl = originalUrl;
        button.dataset.description = resolvedDescription;
        button.style.pointerEvents = 'auto';
        button.style.opacity = '';

        box.style.background = 'none';
        box.style.animation = 'none';
        preview.classList.remove('image-preview-pending');
        delete preview.dataset.pending;
        const spinner = preview.querySelector('[data-pending-spinner="1"]');
        if (spinner) {
            spinner.style.opacity = '0';
            spinner.style.pointerEvents = 'none';
        }

        delete wrapperNode.dataset.pending;
        delete wrapperNode.dataset.pendingSince;
        wrapperNode.dataset.signature = originalUrl;
        wrapperNode.dataset.signatureDescription = String(description || '');
        return true;
    }

    function finalizeStableImageWrapper(wrapperNode) {
        if (!wrapperNode || !wrapperNode.dataset.signature) return;
        wrapperNode.querySelectorAll('[data-pending-spinner="1"]').forEach((node) => node.remove());
    }

    function extractDisplayImageDescriptionFromMessageText(messageText = '') {
        const text = String(messageText || '').trim();
        if (!text) return '';
        const marker = getToastMessage('ui.imageDescription');
        const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`${escaped}\\s*[：:]\\s*(.+)$`, 'i');
        const m = text.replace(/<[^>]+>/g, ' ').replace(/\*\*/g, '').match(re);
        return m && m[1] ? m[1].trim() : '';
    }

    function getStreamImageAttachmentRegistry(rootElement) {
        if (!rootElement) return null;
        if (!(rootElement.__streamImageAttachmentRegistry instanceof Map)) {
            rootElement.__streamImageAttachmentRegistry = new Map();
        }
        return rootElement.__streamImageAttachmentRegistry;
    }

    function insertPendingImagePlaceholderByPlacement(rootElement, placement = 'after_paragraph:1', options = {}) {
        if (!rootElement) return;
        const {
            allowFallbackToTail = true,
            forceNew = false,
            pendingKey = ''
        } = options || {};
        const normalizedPlacement = normalizeStreamPlacement(placement);
        const slotForPending = normalizedPlacement.startsWith('slot:')
            ? normalizedPlacement.slice('slot:'.length).trim()
            : '';
        const keyText = String(pendingKey || '').trim();
        const wrapperRegistry = getStreamImageAttachmentRegistry(rootElement);
        let wrapper = null;
        if (!forceNew) {
            if (keyText) {
                wrapper = rootElement.querySelector(`.stream-image-attachments[data-pending-key="${keyText.replace(/"/g, '\\"')}"]`);
                if (!wrapper) wrapper = wrapperRegistry?.get(keyText) || null;
            } else {
                wrapper = slotForPending
                    ? rootElement.querySelector(`.stream-image-attachments[data-pending-slot="${slotForPending}"]`)
                    : rootElement.querySelector('.stream-image-attachments:not([data-pending-slot])');
            }
        }

        if (wrapper && rootElement.contains(wrapper)) return wrapper;

        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.className = 'stream-image-attachments';
            wrapper.style.marginTop = '12px';
            wrapper.dataset.pending = '1';
            wrapper.dataset.pendingSince = String(Date.now());
            if (slotForPending) {
                wrapper.dataset.pendingSlot = slotForPending;
            }
            if (keyText) {
                wrapper.dataset.pendingKey = keyText;
            }
            wrapper.appendChild(createPendingImagePreviewContainer());
        }
        if (keyText && wrapperRegistry) {
            wrapperRegistry.set(keyText, wrapper);
        }

        if (normalizedPlacement.startsWith('slot:')) {
            const slotId = normalizedPlacement.slice('slot:'.length).trim();
            if (slotId) {
                const anchor = rootElement.querySelector(`[data-stream-image-slot="${slotId}"]`);
                if (anchor) {
                    const anchorBlock = anchor.closest('p, li, blockquote, pre, table, h1, h2, h3, h4, h5, h6');
                    if (anchorBlock && anchorBlock.parentNode) {
                        anchorBlock.insertAdjacentElement('afterend', wrapper);
                    } else if (anchor.parentNode) {
                        anchor.insertAdjacentElement('afterend', wrapper);
                    }
                    return wrapper;
                }
            }
        }

        const paragraphTargets = getPlacementTargets(rootElement);

        if (normalizedPlacement.startsWith('after_paragraph:')) {
            const n = Math.max(1, parseInt(normalizedPlacement.split(':')[1], 10) || 1);
            const target = paragraphTargets[Math.min(n - 1, paragraphTargets.length - 1)];
            if (target && target.parentNode) {
                target.insertAdjacentElement('afterend', wrapper);
                return wrapper;
            }
        } else if (normalizedPlacement === 'head') {
            const firstNode = rootElement.firstElementChild;
            if (firstNode) {
                rootElement.insertBefore(wrapper, firstNode);
                return wrapper;
            }
        }

        if (allowFallbackToTail && wrapper.parentNode !== rootElement) {
            rootElement.appendChild(wrapper);
            return wrapper;
        }
        return null;
    }

    function clearPendingPlaceholdersInChatContainer() {
        const container = elements?.chatContainer || document.getElementById('chat-container');
        if (!container) return;
        const nodes = container.querySelectorAll('.stream-image-attachments[data-pending="1"], .image-preview-container.image-preview-pending');
        nodes.forEach((node) => node.remove());
    }

    function scheduleUnifiedRenderScroll(rootElement) {
        if (!rootElement) return;
        const chatContainer = elements?.chatContainer;
        if (!chatContainer) return;

        const requestScroll = () => {
            requestAnimationFrame(() => {
                if (shouldAutoScroll() && typeof scheduleSmoothScrollToBottom === 'function') {
                    scheduleSmoothScrollToBottom();
                }
                const messageElement = rootElement.closest?.('.message');
                if (messageElement && shouldAutoScroll()) {
                    ensureMessageActionsVisible(messageElement);
                }
            });
        };

        const images = Array.from(rootElement.querySelectorAll('img[data-image-url]'));
        if (images.length === 0) {
            requestScroll();
            return;
        }

        let pending = 0;
        let settled = false;
        const onOneSettled = () => {
            pending -= 1;
            if (pending <= 0 && !settled) {
                settled = true;
                requestScroll();
            }
        };

        images.forEach((img) => {
            if (img.complete) return;
            pending += 1;
            img.addEventListener('load', onOneSettled, { once: true });
            img.addEventListener('error', onOneSettled, { once: true });
        });

        if (pending === 0) {
            requestScroll();
            return;
        }

        setTimeout(() => {
            if (!settled) {
                settled = true;
                requestScroll();
            }
        }, 1500);
    }

    function syncStreamAttachments(element, imageParts, imageLayout = [], isFinalRender = false, options = {}) {
        if (!element) return;
        let normalizedParts = normalizeStreamParts(imageParts);
        let normalizedLayout = normalizeStreamLayout(imageLayout);

        if (isFinalRender && normalizedParts.length > 0) {
            const renderedImageUrls = new Set();
            const contentImages = Array.from(element.querySelectorAll('img'))
                .filter((img) => !img.closest('.stream-image-attachments'));
            contentImages.forEach((img) => {
                const src = String(img.getAttribute('src') || img.currentSrc || '').trim();
                if (!src) return;
                const normalized = normalizeStreamImageUrl(src, { fromExplicitImageTag: true });
                if (normalized) renderedImageUrls.add(normalized);
                const unwrapped = unwrapPublicImageProxyUrl(src);
                if (unwrapped) {
                    const normalizedOriginal = normalizeStreamImageUrl(unwrapped, { fromExplicitImageTag: true });
                    if (normalizedOriginal) renderedImageUrls.add(normalizedOriginal);
                }
            });

            if (renderedImageUrls.size > 0) {
                normalizedParts = normalizedParts.filter((part) => {
                    const url = String(part?.image_url?.url || '').trim();
                    if (!url) return true;
                    const displayUrl = toDisplayImageUrl(url);
                    return !renderedImageUrls.has(url) && !renderedImageUrls.has(displayUrl);
                });
                normalizedLayout = normalizedLayout.filter((item) => {
                    const url = String(item?.url || '').trim();
                    if (!url) return true;
                    const displayUrl = toDisplayImageUrl(url);
                    return !renderedImageUrls.has(url) && !renderedImageUrls.has(displayUrl);
                });
            }
        }
        const existingList = Array.from(element.querySelectorAll('.stream-image-attachments'));
        const attachmentRegistry = getStreamImageAttachmentRegistry(element);

        const placeExistingWrapper = (wrapper, placement) => {
            if (!wrapper) return false;
            const normalizedPlacement = normalizeStreamPlacement(placement);
            if (normalizedPlacement.startsWith('slot:')) {
                const slotId = normalizedPlacement.slice('slot:'.length).trim();
                const anchor = slotId ? element.querySelector(`[data-stream-image-slot="${slotId}"]`) : null;
                if (!anchor) return false;
                const anchorBlock = anchor.closest('p, li, blockquote, pre, table, h1, h2, h3, h4, h5, h6');
                if (anchorBlock?.parentNode) {
                    anchorBlock.insertAdjacentElement('afterend', wrapper);
                } else if (anchor.parentNode) {
                    anchor.insertAdjacentElement('afterend', wrapper);
                }
                return true;
            }

            if (normalizedPlacement.startsWith('after_paragraph:')) {
                const paragraphTargets = getPlacementTargets(element);
                const n = Math.max(1, parseInt(normalizedPlacement.split(':')[1], 10) || 1);
                const target = paragraphTargets[Math.min(n - 1, paragraphTargets.length - 1)];
                if (!target?.parentNode) return false;
                target.insertAdjacentElement('afterend', wrapper);
                return true;
            }

            if (normalizedPlacement === 'head') {
                const firstNode = element.firstElementChild;
                if (firstNode && firstNode !== wrapper) element.insertBefore(wrapper, firstNode);
                return true;
            }

            element.appendChild(wrapper);
            return true;
        };

        const insertResolvedImageByPlacement = (placement, targetUrl, options = {}) => {
            const { pendingKey = '', allowFallbackToTail = true } = options || {};
            const wrapper = insertPendingImagePlaceholderByPlacement(element, placement, {
                allowFallbackToTail,
                forceNew: false,
                pendingKey
            });
            if (!wrapper) return null;
            resolveExistingWrapperInPlace(wrapper, targetUrl, options);
            return wrapper;
        };

        const resolveExistingWrapperInPlace = (wrapperNode, targetUrl, options = {}) => {
            if (!wrapperNode || !targetUrl) return null;
            const nextDescription = String(options.description || '');
            if (wrapperNode.dataset.signature === targetUrl
                && !wrapperNode.dataset.pending
                && String(wrapperNode.dataset.signatureDescription || '') === nextDescription) {
                return wrapperNode;
            }
            if (wrapperNode.dataset.resolving === targetUrl
                && String(wrapperNode.dataset.resolvingDescription || '') === nextDescription) {
                return wrapperNode;
            }

            wrapperNode.dataset.resolving = targetUrl;
            wrapperNode.dataset.resolvingDescription = nextDescription;
            const resolutionPromise = preloadResolvedImage(targetUrl).then((loaded) => {
                if (!loaded) return;
                if (wrapperNode.dataset.resolving !== targetUrl
                    || String(wrapperNode.dataset.resolvingDescription || '') !== nextDescription) return;
                applyLoadedImageToStableWrapper(
                    wrapperNode,
                    targetUrl,
                    options.description || '',
                    loaded.displayUrl
                );
                delete wrapperNode.dataset.resolving;
                delete wrapperNode.dataset.resolvingDescription;
                scheduleUnifiedRenderScroll(element);
                return loaded;
            });
            wrapperNode.__streamImageResolutionPromise = resolutionPromise;
            return wrapperNode;
        };

        const finalizeImageLifecycle = (activeWrappers, staleWrappers, signature) => {
            const active = Array.from(activeWrappers || []).filter(Boolean);
            const stale = Array.from(staleWrappers || []).filter(Boolean);
            const resolutionTasks = [...active, ...stale]
                .map((wrapper) => wrapper.__streamImageResolutionPromise)
                .filter((task) => task && typeof task.then === 'function');

            Promise.allSettled(resolutionTasks).then(() => {
                if (element.dataset.streamImageLayoutSignature !== signature) return;
                active.forEach(finalizeStableImageWrapper);
                stale.forEach((node) => {
                    if (active.includes(node)) return;
                    const pendingKey = String(node.dataset.pendingKey || '').trim();
                    if (pendingKey && attachmentRegistry?.get(pendingKey) === node) {
                        attachmentRegistry.delete(pendingKey);
                    }
                    node.remove();
                });
            });
        };

        if (isFinalRender && options?.staticImageRender) {
            const staticLayout = (normalizedLayout.length === 0 && normalizedParts.length > 0)
                ? normalizedParts.map((part, idx) => ({
                    image_id: `img_${idx + 1}`,
                    url: part.image_url?.url || '',
                    placement: idx === 0 ? 'after_paragraph:1' : 'tail'
                }))
                : normalizedLayout;

            const staticSignature = JSON.stringify({
                mode: 'static',
                parts: normalizedParts.map((part) => part.image_url.url),
                layout: staticLayout.map((item) => ({
                    image_id: item.image_id,
                    url: item.url,
                    placement: item.placement
                }))
            });
            if (element.dataset.streamImageLayoutSignature === staticSignature) {
                return;
            }

            if (!normalizedParts.length) {
                element.dataset.streamImageLayoutSignature = staticSignature;
                const staleWrappers = new Set([
                    ...existingList,
                    ...(attachmentRegistry ? attachmentRegistry.values() : [])
                ]);
                finalizeImageLifecycle([], staleWrappers, staticSignature);
                return;
            }

            const layoutById = new Map();
            const layoutQueueByUrl = new Map();
            staticLayout.forEach((item) => {
                if (!item) return;
                const existing = layoutById.get(item.image_id);
                if (!existing || getPlacementPriority(item.placement) > getPlacementPriority(existing.placement)) {
                    layoutById.set(item.image_id, item);
                }
                if (item.url) {
                    const queue = layoutQueueByUrl.get(item.url) || [];
                    queue.push(item);
                    layoutQueueByUrl.set(item.url, queue);
                }
            });

            const paragraphTargets = getPlacementTargets(element);
            const staticUsedWrappers = new Set();
            const rememberStaticWrapper = (wrapper) => {
                if (!wrapper) return false;
                staticUsedWrappers.add(wrapper);
                return true;
            };

            normalizedParts.forEach((part, index) => {
                const byUrlQueue = layoutQueueByUrl.get(part.image_url.url);
                const peekByUrl = byUrlQueue && byUrlQueue.length > 0 ? byUrlQueue[0] : null;
                const imageId = String(peekByUrl?.image_id || `img_${index + 1}`).trim();
                const byId = layoutById.get(imageId) || null;
                let byUrl = null;
                if (byUrlQueue && byUrlQueue.length > 0) {
                    byUrl = byUrlQueue.shift();
                }
                const layoutItem = byUrl || byId || null;
                const placement = normalizeStreamPlacement(layoutItem?.placement || (index === 0 ? 'after_paragraph:1' : 'tail'));
                const staticKey = `history:${imageId}:${placement}:${index}`;

                if (placement.startsWith('slot:')) {
                    const slotId = placement.slice('slot:'.length).trim();
                    const anchor = slotId ? element.querySelector(`[data-stream-image-slot="${slotId}"]`) : null;
                    if (anchor) {
                        const wrapper = insertResolvedImageByPlacement(placement, part.image_url.url, {
                            allowFallbackToTail: false,
                            pendingKey: staticKey,
                            description: options.description || ''
                        });
                        if (rememberStaticWrapper(wrapper)) return;
                    }

                    const fallbackParagraph = Math.max(0, parseInt(String(layoutItem?.fallback_paragraph || '0'), 10) || 0);
                    if (fallbackParagraph > 0) {
                        const target = paragraphTargets[Math.min(fallbackParagraph - 1, paragraphTargets.length - 1)];
                        if (target && target.parentNode) {
                            const wrapper = insertResolvedImageByPlacement(`after_paragraph:${Math.max(1, fallbackParagraph)}`, part.image_url.url, {
                                allowFallbackToTail: false,
                                pendingKey: staticKey,
                                description: options.description || ''
                            });
                            if (rememberStaticWrapper(wrapper)) return;
                        }
                    }
                }

                if (placement.startsWith('after_paragraph:')) {
                    const wrapper = insertResolvedImageByPlacement(placement, part.image_url.url, {
                        allowFallbackToTail: true,
                        pendingKey: staticKey,
                        description: options.description || ''
                    });
                    if (rememberStaticWrapper(wrapper)) return;
                } else if (placement === 'head') {
                    const wrapper = insertResolvedImageByPlacement('head', part.image_url.url, {
                        allowFallbackToTail: true,
                        pendingKey: staticKey,
                        description: options.description || ''
                    });
                    if (rememberStaticWrapper(wrapper)) return;
                }

                const tailWrapper = insertResolvedImageByPlacement('tail', part.image_url.url, {
                    allowFallbackToTail: true,
                    pendingKey: staticKey,
                    description: options.description || ''
                });
                rememberStaticWrapper(tailWrapper);
            });

            element.dataset.streamImageLayoutSignature = staticSignature;
            const allManagedWrappers = new Set([
                ...element.querySelectorAll('.stream-image-attachments'),
                ...(attachmentRegistry ? attachmentRegistry.values() : [])
            ]);
            const staleWrappers = Array.from(allManagedWrappers).filter((node) => !staticUsedWrappers.has(node));
            finalizeImageLifecycle(staticUsedWrappers, staleWrappers, staticSignature);
            scheduleUnifiedRenderScroll(element);
            return;
        }

        if (!normalizedParts.length) {
            if (!isFinalRender && options.pendingPlaceholder && normalizedLayout.length > 0) {
                normalizedLayout.forEach((layoutItem, layoutIndex) => {
                    const pendingPlacement = layoutItem?.placement || 'after_paragraph:1';
                    const hasSlotPlacement = String(pendingPlacement || '').toLowerCase().startsWith('slot:');
                    const anchorReached = hasSlotPlacement || (options.pendingAnchorReached !== false);
                    const layoutKey = `stream:${String(layoutItem?.image_id || layoutIndex + 1)}:${pendingPlacement}`;
                    if (anchorReached) {
                        insertPendingImagePlaceholderByPlacement(element, pendingPlacement, {
                            allowFallbackToTail: false,
                            pendingKey: layoutKey
                        });
                    }
                });
                scheduleUnifiedRenderScroll(element);
                return;
            }
            if (isFinalRender) {
                const emptySignature = JSON.stringify({ parts: [], layout: normalizedLayout });
                element.dataset.streamImageLayoutSignature = emptySignature;
                const staleWrappers = new Set([
                    ...existingList,
                    ...(attachmentRegistry ? attachmentRegistry.values() : [])
                ]);
                finalizeImageLifecycle([], staleWrappers, emptySignature);
            }
            return;
        }

        if (isFinalRender && normalizedLayout.length > 0) {
            const layoutUrlSetForFinal = new Set(
                normalizedLayout
                    .map((item) => String(item?.url || '').trim())
                    .filter(Boolean)
            );
            const hasMissingLayoutUrls = layoutUrlSetForFinal.size > 0 && normalizedParts.some((part) => {
                const url = String(part?.image_url?.url || '').trim();
                return url && !layoutUrlSetForFinal.has(url);
            });
            if (hasMissingLayoutUrls) {
                normalizedParts = normalizedParts.filter((part) => {
                    const url = String(part?.image_url?.url || '').trim();
                    return url && layoutUrlSetForFinal.has(url);
                });
            }
        }

        const effectiveFinalLayout = (normalizedLayout.length === 0 && normalizedParts.length > 0)
            ? normalizedParts.map((part, idx) => ({
                image_id: `img_${idx + 1}`,
                url: part.image_url?.url || '',
                placement: idx === 0 ? 'after_paragraph:1' : 'tail'
            }))
            : normalizedLayout;
        if (!isFinalRender && options.pendingPlaceholder && normalizedParts.length > 0) {
            effectiveFinalLayout.forEach((layoutItem, index) => {
                const imageId = String(layoutItem?.image_id || `img_${index + 1}`).trim();
                const pendingPlacement = layoutItem?.placement || (index === 0 ? 'after_paragraph:1' : 'tail');
                const hasSlotPlacement = String(pendingPlacement || '').toLowerCase().startsWith('slot:');
                const slotId = hasSlotPlacement
                    ? String(pendingPlacement).slice(String(pendingPlacement).indexOf(':') + 1).trim()
                    : '';
                const slotAnchor = slotId
                    ? element.querySelector(`[data-stream-image-slot="${slotId}"]`)
                    : null;
                const anchorReached = hasSlotPlacement ? !!slotAnchor : (options.pendingAnchorReached !== false);
                const anchorLocked = !!slotAnchor?.closest('.locked-response-content');
                const pendingKey = `stream:${imageId}:${pendingPlacement}`;
                const layoutUrl = String(layoutItem?.url || '').trim();
                const matchingPart = normalizedParts.find((part) =>
                    String(part?.image_url?.url || '').trim() === layoutUrl
                ) || normalizedParts[index] || null;
                const streamReadyUrl = String(matchingPart?.image_url?.url || layoutUrl || '').trim();
                if (anchorReached) {
                    const streamWrapper = insertPendingImagePlaceholderByPlacement(element, pendingPlacement, {
                        allowFallbackToTail: false,
                        pendingKey
                    });

                    const canResolveNow = hasSlotPlacement ? anchorLocked : true;
                    if (streamWrapper && streamReadyUrl && canResolveNow) {
                        const resolved = resolveExistingWrapperInPlace(streamWrapper, streamReadyUrl, {
                            description: options.description || ''
                        });
                        if (resolved) {
                            resolved.dataset.pendingKey = pendingKey;
                        }
                    }
                }
            });
            return;
        }

        if (!isFinalRender) {
            return;
        }

        const layoutSignature = JSON.stringify({
            parts: normalizedParts.map((part) => part.image_url.url),
            layout: effectiveFinalLayout.map((item) => ({
                image_id: item.image_id,
                url: item.url,
                placement: item.placement
            }))
        });
        if (element.dataset.streamImageLayoutSignature === layoutSignature) {
            return;
        }

        const layoutById = new Map();
        const layoutQueueByUrl = new Map();
        effectiveFinalLayout.forEach((item) => {
            if (!item) return;
            const existing = layoutById.get(item.image_id);
            if (!existing || getPlacementPriority(item.placement) > getPlacementPriority(existing.placement)) {
                layoutById.set(item.image_id, item);
            }
            if (item.url) {
                const queue = layoutQueueByUrl.get(item.url) || [];
                queue.push(item);
                layoutQueueByUrl.set(item.url, queue);
            }
        });

        const paragraphTargets = getPlacementTargets(element);

        const usedWrappers = new Set();
        const escapeSelectorValue = (value) => String(value || '').replace(/"/g, '\\"');

        normalizedParts.forEach((part, index) => {
            const byUrlQueue = layoutQueueByUrl.get(part.image_url.url);
            const peekByUrl = byUrlQueue && byUrlQueue.length > 0 ? byUrlQueue[0] : null;
            const imageId = String(peekByUrl?.image_id || `img_${index + 1}`).trim();
            const byId = layoutById.get(imageId) || null;
            let byUrl = null;
            if (byUrlQueue && byUrlQueue.length > 0) {
                byUrl = byUrlQueue.shift();
            }
            const layoutItem = byUrl || byId || null;
            const placement = normalizeStreamPlacement(layoutItem?.placement || (index === 0 ? 'after_paragraph:1' : 'tail'));
            const streamPendingKey = `stream:${imageId}:${placement}`;
            const escapedStreamKey = escapeSelectorValue(streamPendingKey);
            const existingByKey = element.querySelector(`.stream-image-attachments[data-pending-key="${escapedStreamKey}"]`)
                || attachmentRegistry?.get(streamPendingKey)
                || null;

            if (existingByKey) {
                placeExistingWrapper(existingByKey, placement);
                const wrapper = resolveExistingWrapperInPlace(existingByKey, part.image_url.url, {
                    description: options.description || ''
                });
                if (wrapper) {
                    wrapper.dataset.pendingKey = streamPendingKey;
                    usedWrappers.add(wrapper);
                    return;
                }
            }

            if (placement.startsWith('slot:')) {
                const slotId = placement.slice('slot:'.length).trim();
                const anchor = slotId ? element.querySelector(`[data-stream-image-slot="${slotId}"]`) : null;
                if (anchor) {
                    const wrapper = insertResolvedImageByPlacement(placement, part.image_url.url, {
                        allowFallbackToTail: false,
                        pendingKey: streamPendingKey,
                        description: options.description || ''
                    });
                    if (wrapper) {
                        usedWrappers.add(wrapper);
                        return;
                    }
                }
                const fallbackParagraph = Math.max(0, parseInt(String(layoutItem?.fallback_paragraph || '0'), 10) || 0);
                if (fallbackParagraph > 0) {
                    const target = paragraphTargets[Math.min(fallbackParagraph - 1, paragraphTargets.length - 1)];
                    if (target && target.parentNode) {
                        const wrapper = insertResolvedImageByPlacement(`after_paragraph:${Math.max(1, fallbackParagraph)}`, part.image_url.url, {
                            allowFallbackToTail: false,
                            pendingKey: streamPendingKey,
                            description: options.description || ''
                        });
                        if (wrapper) {
                            usedWrappers.add(wrapper);
                            return;
                        }
                    }
                }
                return;
            }

            if (placement.startsWith('after_paragraph:')) {
                const wrapper = insertResolvedImageByPlacement(placement, part.image_url.url, {
                    allowFallbackToTail: true,
                    pendingKey: streamPendingKey,
                    description: options.description || ''
                });
                if (wrapper) {
                    usedWrappers.add(wrapper);
                    return;
                }
            } else if (placement === 'head') {
                const wrapper = insertResolvedImageByPlacement('head', part.image_url.url, {
                    allowFallbackToTail: true,
                    pendingKey: streamPendingKey,
                    description: options.description || ''
                });
                if (wrapper) {
                    usedWrappers.add(wrapper);
                }
                return;
            }

            const wrapper = insertResolvedImageByPlacement('tail', part.image_url.url, {
                allowFallbackToTail: true,
                pendingKey: streamPendingKey,
                description: options.description || ''
            });
            if (wrapper) {
                usedWrappers.add(wrapper);
            }
        });

        element.dataset.streamImageLayoutSignature = layoutSignature;
        const allManagedWrappers = new Set([
            ...element.querySelectorAll('.stream-image-attachments'),
            ...(attachmentRegistry ? attachmentRegistry.values() : [])
        ]);
        const staleWrappers = Array.from(allManagedWrappers).filter((node) => !usedWrappers.has(node));
        finalizeImageLifecycle(usedWrappers, staleWrappers, layoutSignature);

        scheduleUnifiedRenderScroll(element);
    }

    function flushBufferedContent() {
        if (!state.globalContentDiv) return;
        try {
            if (state.globalCharQueue.length > 0) {
                const remainingChars = state.globalCharQueue.splice(0, state.globalCharQueue.length).join('');
                state.globalDisplayBuffer += remainingChars;
            }
            const runForegroundRestoreAnchor = (renderFn, anchorOptions = {}) => runWithStreamingAnchor(renderFn, {
                ...anchorOptions,
                foregroundRestore: true
            });

            runWithStreamingAnchor(() => {
                renderMessageContent(state.globalContentDiv, state.globalDisplayBuffer, null, false, {
                    withStreamingAnchor: runForegroundRestoreAnchor
                });
            }, {
                foregroundRestore: true
            });
        } catch (error) {
            console.error('Background buffer render error:', error);
        }
    }

    function ensureStreamingRenderState({ element, finalSanitizedHtml, syntheticFenceAdded = false, hasCanvasArtifacts = false, isFinalRender = false }) {
        const renderState = element.__renderState || (element.__renderState = {
            lockedLength: 0,
            lockedHtml: '',
            lastLockedHtml: '',
            streamingHtml: '',
            lockedContainer: null,
            streamingContainer: null
        });

        const lowerHtml = String(finalSanitizedHtml || '').toLowerCase();
        const lastTableCloseIndex = lowerHtml.lastIndexOf('</table>');
        const lastPreCloseIndex = lowerHtml.lastIndexOf('</pre>');
        const tableLockEnd = lastTableCloseIndex === -1 ? -1 : lastTableCloseIndex + '</table>'.length;
        const codeLockEnd = lastPreCloseIndex === -1 ? -1 : lastPreCloseIndex + '</pre>'.length;
        const mathLockEnd = findLastCompleteDisplayMathEnd(finalSanitizedHtml);
        const streamImageLockEnd = findLastCompleteStreamImageBlockEnd(finalSanitizedHtml);

        const skipCodeLock = syntheticFenceAdded || hasCanvasArtifacts;
        const lockCandidates = skipCodeLock
            ? [tableLockEnd, mathLockEnd, streamImageLockEnd]
            : [tableLockEnd, codeLockEnd, mathLockEnd, streamImageLockEnd];
        const newLockEndRaw = lockCandidates
            .filter(candidate => candidate > 0)
            .sort((a, b) => b - a)
            .find(candidate => hasBalancedHtmlPrefix(finalSanitizedHtml.slice(0, candidate)));
        const newLockEnd = Math.max(0, newLockEndRaw ?? -1);

        if (renderState.lockedHtml && !finalSanitizedHtml.startsWith(renderState.lockedHtml)) {
            renderState.lockedLength = 0;
            renderState.lockedHtml = '';
        }

        if (!isFinalRender && newLockEnd > renderState.lockedLength) {
            renderState.lockedLength = newLockEnd;
            renderState.lockedHtml = finalSanitizedHtml.slice(0, newLockEnd);
        } else if (hasCanvasArtifacts && newLockEnd < renderState.lockedLength) {
            renderState.lockedLength = newLockEnd;
            renderState.lockedHtml = finalSanitizedHtml.slice(0, newLockEnd);
        }

        return renderState;
    }

    function applyStreamingLockedContent({ element, renderState, finalSanitizedHtml, isFinalRender }) {
        if (!element || !renderState || typeof finalSanitizedHtml !== 'string') return;
        let displayMathState = null;
        let streamingHtml = finalSanitizedHtml.slice(renderState.lockedLength);

        if (!isFinalRender && streamingHtml) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = streamingHtml;

            const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, null, false);
            let targetNode = null;
            while (true) {
                const n = walker.nextNode();
                if (!n) break;
                const parentTag = (n.parentNode && n.parentNode.tagName) ? n.parentNode.tagName.toUpperCase() : '';
                if (parentTag !== 'CODE' && parentTag !== 'PRE' && parentTag !== 'BLOCKQUOTE') {
                    targetNode = n;
                    break;
                }
            }

            if (targetNode && targetNode.textContent) {
                const before = targetNode.textContent;
                const after = before
                    .replace(/^\s*>(\s+)?/, '')
                    .replace(/^\s*([`~]{3,})\s*$/, '')
                    .replace(/^\s*([`~]{1,2})\s*$/, '')
                    .replace(/^\s*\]\>\s*/, '')
                    .replace(/^\s*\|\>\s*/, '')
                    .replace(/^\s*\]>\s*/, '');
                if (after !== before) {
                    targetNode.textContent = after;
                    streamingHtml = tempDiv.innerHTML;
                }
            }
        }

        if (!renderState.lockedContainer || !renderState.streamingContainer || !element.contains(renderState.lockedContainer)) {
            displayMathState = captureDisplayMathState(element, [element]);
            const attachmentRegistry = getStreamImageAttachmentRegistry(element);
            const preservedStreamImageNodes = new Set([
                ...element.querySelectorAll('.stream-image-attachments'),
                ...(attachmentRegistry ? attachmentRegistry.values() : [])
            ]);
            const preservedImageFragment = document.createDocumentFragment();
            preservedStreamImageNodes.forEach((node) => preservedImageFragment.appendChild(node));
            element.innerHTML = '';
            renderState.lockedContainer = document.createElement('div');
            renderState.lockedContainer.className = 'locked-response-content';
            renderState.lockedContainer.style.display = 'contents';
            renderState.streamingContainer = document.createElement('div');
            renderState.streamingContainer.className = 'streaming-response-content';
            renderState.streamingContainer.style.display = 'contents';
            element.appendChild(renderState.lockedContainer);
            element.appendChild(renderState.streamingContainer);
            element.appendChild(preservedImageFragment);
            renderState.lastLockedHtml = '';
            renderState.streamingHtml = '';
        }

        const lockedUpdate = planStreamingContentUpdate(renderState.lockedContainer, renderState.lastLockedHtml, renderState.lockedHtml, {
            preserveSelection: selectionIntersectsNode(renderState.lockedContainer)
        });
        const streamingUpdate = planStreamingContentUpdate(renderState.streamingContainer, renderState.streamingHtml, streamingHtml, {
            preserveSelection: selectionIntersectsNode(renderState.streamingContainer)
        });
        const mathRoots = new Set();
        const registerMathRoot = (update) => {
            if (!update || update.kind === 'unchanged') return;
            const root = update.kind === 'append-text'
                ? (update.textNode?.parentElement || update.container)
                : update.container;
            if (root?.nodeType === 1) mathRoots.add(root);
        };
        registerMathRoot(lockedUpdate);
        registerMathRoot(streamingUpdate);
        for (const update of [lockedUpdate, streamingUpdate]) {
            if (update.kind === 'append-text' && selectionIntersectsNode(update.textNode)) update.insertAfter = true;
        }
        const isNodeImmediatelyAfter = (node, target) => {
            if (!node || !target || !target.parentNode) return false;
            if (node.parentNode !== target.parentNode) return false;
            let cursor = target.nextSibling;
            while (cursor && cursor.nodeType === Node.TEXT_NODE && !String(cursor.textContent || '').trim()) {
                cursor = cursor.nextSibling;
            }
            return cursor === node;
        };

        const repositionPendingNode = (node, options = {}) => {
            if (!node || !node.isConnected) return;
            if (!options.force && !isFinalRender && scrollManager.isUserScrolling) return;

            let placement = '';
            const pendingSlot = String(node.dataset.pendingSlot || '').trim();
            if (pendingSlot) {
                placement = `slot:${pendingSlot}`;
            } else {
                const pendingKey = String(node.dataset.pendingKey || '').trim();
                if (pendingKey) {
                    const first = pendingKey.indexOf(':');
                    const second = first >= 0 ? pendingKey.indexOf(':', first + 1) : -1;
                    if (second >= 0 && second < pendingKey.length - 1) {
                        placement = pendingKey.slice(second + 1).trim();
                    }
                }
            }
            if (!placement) return;

            const normalizedPlacement = normalizeStreamPlacement(placement);
            if (normalizedPlacement.startsWith('slot:')) {
                const slotId = normalizedPlacement.slice('slot:'.length).trim();
                const anchor = slotId ? element.querySelector(`[data-stream-image-slot="${slotId}"]`) : null;
                if (!anchor) return;
                const anchorBlock = anchor.closest('p, li, blockquote, pre, table, h1, h2, h3, h4, h5, h6');
                const target = (anchorBlock && anchorBlock.parentNode) ? anchorBlock : (anchor.parentNode ? anchor : null);
                if (!target) return;
                if (isNodeImmediatelyAfter(node, target)) return;
                if (target === anchorBlock) {
                    anchorBlock.insertAdjacentElement('afterend', node);
                } else {
                    anchor.insertAdjacentElement('afterend', node);
                }
                return;
            }

            if (normalizedPlacement.startsWith('after_paragraph:')) {
                const n = Math.max(1, parseInt(normalizedPlacement.split(':')[1], 10) || 1);
                const paragraphTargets = getPlacementTargets(element);
                const target = paragraphTargets[Math.min(n - 1, paragraphTargets.length - 1)];
                if (target && target.parentNode) {
                    if (isNodeImmediatelyAfter(node, target)) return;
                    target.insertAdjacentElement('afterend', node);
                }
                return;
            }

            if (normalizedPlacement === 'head') {
                const firstNode = element.firstElementChild;
                if (firstNode && firstNode !== node) {
                    element.insertBefore(node, firstNode);
                }
            }
        };

        const removesNode = (update, node) => update.kind === 'replace-region'
            ? update.container.contains(node)
            : update.kind === 'replace-tail' && update.removedNodes.some(removed => removed === node || removed.contains?.(node));
        const replacedRoots = [lockedUpdate, streamingUpdate].flatMap(update => {
            if (update.kind === 'replace-region') return [update.container];
            if (update.kind === 'replace-tail') return update.removedNodes;
            return [];
        });
        displayMathState ||= captureDisplayMathState(element, replacedRoots);
        const attachmentRegistry = getStreamImageAttachmentRegistry(element);
        const anchoredImageNodes = new Set();

        Array.from(attachmentRegistry?.values() || []).forEach((node) => {
            if (!removesNode(lockedUpdate, node) && !removesNode(streamingUpdate, node)) return;
            anchoredImageNodes.add(node);
            element.appendChild(node);
        });

        if (renderState.lastLockedHtml !== renderState.lockedHtml) {
            commitStreamingContentUpdate(lockedUpdate);
            renderState.lastLockedHtml = renderState.lockedHtml;
        }

        if (renderState.streamingHtml !== streamingHtml) {
            commitStreamingContentUpdate(streamingUpdate);
            renderState.streamingHtml = streamingHtml;
        }

        anchoredImageNodes.forEach((node) => repositionPendingNode(node, { force: true }));
        Array.from(element.querySelectorAll('.stream-image-attachments[data-pending="1"]')).forEach(repositionPendingNode);
        return { displayMathState, mathRoots: Array.from(mathRoots) };
    }

    async function processStreamedResponse(response, contentDiv, options = {}) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullResponse = '';
        let persistedResponse = '';
        const collectedImageUrls = new Set();
        let finishReason = null;
        let finalCitations = null;
        let finalReasoning = '';
        let finalImageLayout = [];
        let metadataImageLayout = [];
        let provisionalImageParts = [];
        const explicitImageParts = [];
        const streamImageAnchors = [];
        let streamTagBuffer = '';
        let streamSlotCounter = 0;
        let pendingImageSlotId = '';
        let hasInlineImageSlots = false;
        const canvasState = {
            mode: 'chat',
            type: 'text',
            title: ''
        };
        let hasClearedThinkingIndicator = false;
        const provisionalImageLayout = normalizeStreamLayout(options?.provisionalImageLayout || []);
        const usePendingImagePlaceholder = options?.usePendingImagePlaceholder !== false;
        const streamIdleTimeoutMs = Number.isFinite(Number(options?.idleTimeoutMs))
            ? Math.max(0, Number(options.idleTimeoutMs))
            : 0;
        const requestedDisplayGate = options?.displayGate;
        let displayGateOpen = !requestedDisplayGate || typeof requestedDisplayGate.then !== 'function';
        const displayGatePromise = displayGateOpen
            ? Promise.resolve()
            : Promise.resolve(requestedDisplayGate).catch(() => undefined);
        let firstTokenAt = null;
        let receivedDone = false;
        let streamClosed = false;
        const nativeBackgroundEpochAtStart = isNativeBackgroundRuntime
            ? Number(getNativeBackgroundEpoch()) || 0
            : 0;

        const hasEnteredNativeBackground = () => isNativeBackgroundRuntime && (
            !getIsRenderSurfaceVisible()
            || (Number(getNativeBackgroundEpoch()) || 0) > nativeBackgroundEpochAtStart
        );

        state.globalDisplayBuffer = '';
        state.globalContentDiv = contentDiv;
        state.globalCharQueue = [];
        state.explicitImageTagUrls = new Set();
        state.imgWrappedTagUrls = new Set();
        const pinnedToBottom = scrollManager.isNearBottom(scrollManager.bottomThreshold);
        if (pinnedToBottom) {
            scrollManager.resetUserScrollState();
        }

        scrollManager.enterStreamingMode();

        const isDisplayGateOpen = () => {
            if (displayGateOpen) return true;
            if (!getIsRenderSurfaceVisible()) {
                if (isNativeBackgroundRuntime) {
                    displayGateOpen = true;
                }
                return true;
            }
            return false;
        };

        const clearThinkingIndicatorOnFirstBodyDelta = (chunk) => {
            if (!isDisplayGateOpen() || hasClearedThinkingIndicator) return;
            const raw = String(chunk || '');
            if (!raw) return;
            const stripped = stripImageRenderProtocolMarkers(raw).trim();
            if (!stripped) return;
            if (!getIsRenderSurfaceVisible()) {
                hasClearedThinkingIndicator = true;
                return;
            }
            if (contentDiv?.querySelector?.('.thinking-indicator-new')) {
                contentDiv.innerHTML = '';
            }
            hasClearedThinkingIndicator = true;
        };

        const charQueue = state.globalCharQueue;
        let isTyping = false;
        const renderModelId = getCurrentModelId();
        const renderSpeed = getRenderSpeedForModel(renderModelId);
        const streamPacer = createStreamPacer(normalizeModelIdForRender(renderModelId), renderSpeed);
        let renderSpeedAccumulator = 0;
        const streamRenderInterval = STREAM_RENDER_INTERVAL_MS;
        let hasTypingStarted = false;
        let typingStartTimer = null;

        const clearTypingStartTimer = () => {
            if (typingStartTimer === null) return;
            clearTimeout(typingStartTimer);
            typingStartTimer = null;
        };

        const drainQueuedTextWithoutRendering = () => {
            if (charQueue.length > 0) {
                state.globalDisplayBuffer += charQueue.splice(0, charQueue.length).join('');
            }
            isTyping = false;
            renderSpeedAccumulator = 0;
            streamPacer?.resetRenderClock();
            clearTypingStartTimer();
        };

        let lastRenderTime = 0;

        const deriveStreamAnchorParts = () => normalizeStreamParts(
            streamImageAnchors
                .filter((item) => item?.slotId && item?.url)
                .map((item) => ({
                    type: 'image_url',
                    image_url: { url: item.url },
                    _fromExplicitImageTag: true
                }))
        );

        const deriveStreamAnchorLayout = () => normalizeStreamLayout(
            streamImageAnchors.map((item, index) => ({
                image_id: item.slotId || `img_${index + 1}`,
                url: item.url || '',
                placement: `slot:${item.slotId || `img_${index + 1}`}`,
                fallback_paragraph: item.fallbackParagraph || getImageFallbackParagraph(index)
            }))
        );

        const syncStreamAnchorState = () => {
            streamImageAnchors.forEach((anchor) => {
                if (!anchor?.slotId || anchor.url) return;
                const fallbackLayout = metadataImageLayout.find((item) =>
                    String(item?.image_id || '').trim() === anchor.slotId
                    && String(item?.url || '').trim()
                ) || finalImageLayout.find((item) =>
                    String(item?.image_id || '').trim() === anchor.slotId
                    && String(item?.url || '').trim()
                );
                if (fallbackLayout?.url) {
                    anchor.url = fallbackLayout.url;
                    anchor.fallbackParagraph = fallbackLayout.fallback_paragraph || anchor.fallbackParagraph;
                }
            });
            const anchorParts = deriveStreamAnchorParts();
            const anchorLayout = deriveStreamAnchorLayout();
            if (anchorParts.length > 0) {
                provisionalImageParts = anchorParts;
            }
            if (anchorLayout.length > 0) {
                finalImageLayout = anchorLayout;
            }
        };

        const getOrCreateStreamImageAnchor = (slotIdRaw = '') => {
            const fallbackSlot = `img_${streamImageAnchors.length + 1}`;
            const slotId = String(slotIdRaw || fallbackSlot).replace(/[^a-zA-Z0-9_-]/g, '').trim() || fallbackSlot;
            let anchor = streamImageAnchors.find((item) => item.slotId === slotId);
            if (!anchor) {
                anchor = {
                    slotId,
                    url: '',
                    fallbackParagraph: getImageFallbackParagraph(streamImageAnchors.length)
                };
                streamImageAnchors.push(anchor);
            }
            return anchor;
        };

        const appendVisibleTextDelta = (chunk, options = {}) => {
            if (!chunk) return;
            clearThinkingIndicatorOnFirstBodyDelta(chunk);
            const splitByChar = options.splitByChar !== false;
            const persistChunk = Object.prototype.hasOwnProperty.call(options, 'persistChunk')
                ? options.persistChunk
                : chunk;
            const previousResponse = fullResponse;
            fullResponse += chunk;
            if (persistChunk) {
                persistedResponse += persistChunk;
            }
            collectStreamImageUrlsFromVisibleDelta(previousResponse, chunk, collectedImageUrls);
            if (splitByChar) {
                charQueue.push(...chunk.split(''));
            } else {
                charQueue.push(chunk);
            }
            streamPacer?.recordArrival(splitByChar ? chunk.length : 1);
            if (!firstTokenAt) {
                firstTokenAt = Date.now();
                onStreamOutputStarted();
            }
            if (!getIsRenderSurfaceVisible()) {
                drainQueuedTextWithoutRendering();
            } else if (!isTyping) {
                scheduleTypingStart();
            }
        };

        const pushStreamImageSlot = (slotOptions = {}) => {
            let urlRaw = slotOptions?.url || '';
            const imageIdRaw = slotOptions?.imageId || '';
            const slotIdRaw = slotOptions?.slotId || '';
            const sourceType = String(slotOptions?.sourceType || '').toLowerCase();
            const shouldAppendMarker = slotOptions?.appendMarker !== false;
            const autoIndex = imageIdRaw || slotIdRaw ? streamSlotCounter : ++streamSlotCounter;
            const imageId = String(imageIdRaw || `img_${autoIndex}`).trim();
            const slotId = String(slotIdRaw || imageId).trim() || imageId;
            hasInlineImageSlots = true;
            const authoritativeLayout = metadataImageLayout.find((item) =>
                String(item?.image_id || '').trim() === slotId
                && String(item?.url || '').trim()
            );
            if (authoritativeLayout?.url) {
                urlRaw = authoritativeLayout.url;
            }
            const url = normalizeStreamImageUrl(urlRaw || '', { fromExplicitImageTag: true });
            const anchor = getOrCreateStreamImageAnchor(slotId);
            if (authoritativeLayout?.fallback_paragraph) {
                anchor.fallbackParagraph = authoritativeLayout.fallback_paragraph;
            }
            if (url) {
                explicitImageParts.push({
                    type: 'image_url',
                    image_url: { url },
                    _fromExplicitImageTag: true
                });
                state.explicitImageTagUrls.add(url);
                if (sourceType === 'img') {
                    state.imgWrappedTagUrls.add(url);
                }
                anchor.url = url;
                anchor.fallbackParagraph = anchor.fallbackParagraph || getImageFallbackParagraph(streamImageAnchors.indexOf(anchor));
            }
            syncStreamAnchorState();
            if (shouldAppendMarker) {
                appendVisibleTextDelta(`\n\n<span data-stream-image-slot="${slotId}"></span>\n\n`, {
                    splitByChar: false
                });
            }
        };

        const isMarkdownImageStartAllowed = (text, index = 0) => {
            const previousChar = index > 0
                ? text[index - 1]
                : (fullResponse ? fullResponse[fullResponse.length - 1] : '');
            return !/[A-Za-z0-9_]/.test(previousChar || '');
        };

        const findMarkdownImageStart = (text) => {
            let index = text.indexOf('![');
            while (index >= 0) {
                if (isMarkdownImageStartAllowed(text, index)) {
                    return index;
                }
                index = text.indexOf('![', index + 2);
            }
            return -1;
        };

        const findNextTagStart = (text) => {
            const mdImageStart = findMarkdownImageStart(text);
            return findFirstStreamProtocolTagStart(text, [mdImageStart]);
        };

        const parseCanvasStartTag = (text) => {
            if (!/^<canvasmode\b/i.test(text)) return null;
            const end = text.indexOf('>');
            if (end === -1) return { needMore: true };
            const tag = text.slice(0, end + 1);
            const typeMatch = tag.match(/\btype\s*=\s*(["'])(.*?)\1/i);
            const titleMatch = tag.match(/\btitle\s*=\s*(["'])(.*?)\1/i);
            return {
                needMore: false,
                consumed: end + 1,
                rawTag: tag,
                type: normalizeCanvasType(typeMatch ? decodeCanvasAttribute(typeMatch[2]) : 'text'),
                title: titleMatch ? decodeCanvasAttribute(titleMatch[2]).trim() : ''
            };
        };

        const appendCanvasOpen = (meta = {}) => {
            canvasState.mode = 'canvas';
            canvasState.type = normalizeCanvasType(meta.type);
            canvasState.title = String(meta.title || '').trim();
            const title = encodeCanvasAttribute(canvasState.title.replace(/\s+/g, ' ').trim());
            const rawTag = meta.rawTag || `<canvasmode type="${canvasState.type}"${title ? ` title="${title}"` : ''}>`;
            appendVisibleTextDelta(rawTag, { splitByChar: false, persistChunk: rawTag });
        };

        const appendCanvasClose = () => {
            appendVisibleTextDelta('</canvasmode>', { splitByChar: false, persistChunk: '</canvasmode>' });
            canvasState.mode = 'chat';
            canvasState.type = 'text';
            canvasState.title = '';
        };

        const tryConsumeImageTag = (text) => {
            if (!text.startsWith('[IMG]')) return null;
            const end = text.indexOf('[/IMG]');
            if (end === -1) return { needMore: true };
            return {
                needMore: false,
                consumed: end + 6,
                url: text.slice(5, end).trim()
            };
        };

        const tryConsumeSlotTag = (text) => {
            if (!text.startsWith('[[IMAGE_SLOT:')) return null;
            const end = text.indexOf(']]');
            if (end === -1) return { needMore: true };
            return {
                needMore: false,
                consumed: end + 2,
                rawSlot: text.slice('[[IMAGE_SLOT:'.length, end).trim()
            };
        };

        const tryConsumeMarkdownImageTag = (text) => {
            if (!text.startsWith('![')) return null;
            if (!isMarkdownImageStartAllowed(text, 0)) return null;
            const closeBracket = text.indexOf(']');
            if (closeBracket === -1) return { needMore: true };
            const openParen = closeBracket + 1;
            if (text.length <= openParen) return { needMore: true };
            if (text[openParen] !== '(') return null;

            let cursor = openParen + 1;
            let inAngleWrappedUrl = false;
            if (text[cursor] === '<') {
                inAngleWrappedUrl = true;
                cursor += 1;
            }

            let depth = 1;
            let closeParen = -1;
            for (let i = cursor; i < text.length; i += 1) {
                const ch = text[i];
                const prev = i > 0 ? text[i - 1] : '';

                if (inAngleWrappedUrl) {
                    if (ch === '>' && prev !== '\\') {
                        inAngleWrappedUrl = false;
                    }
                    continue;
                }

                if (ch === '<') {
                    inAngleWrappedUrl = true;
                    continue;
                }

                if (ch === '(' && prev !== '\\') {
                    depth += 1;
                    continue;
                }
                if (ch === ')' && prev !== '\\') {
                    depth -= 1;
                    if (depth === 0) {
                        closeParen = i;
                        break;
                    }
                }
            }

            if (closeParen === -1) return { needMore: true };

            let rawUrl = text.slice(openParen + 1, closeParen).trim();
            if (rawUrl.startsWith('<') && rawUrl.endsWith('>') && rawUrl.length > 2) {
                rawUrl = rawUrl.slice(1, -1).trim();
            }
            if (!rawUrl) {
                return {
                    needMore: false,
                    consumed: closeParen + 1,
                    url: ''
                };
            }
            return {
                needMore: false,
                consumed: closeParen + 1,
                url: rawUrl,
                raw: text.slice(0, closeParen + 1)
            };
        };

        const parseBufferedStreamChunk = (incomingDelta = '') => {
            if (!incomingDelta) return;
            streamTagBuffer += incomingDelta;

            while (streamTagBuffer.length > 0) {
                if (canvasState.mode === 'canvas') {
                    const lower = streamTagBuffer.toLowerCase();
                    const endIndex = lower.indexOf('</canvasmode>');
                    if (endIndex !== -1) {
                        const artifactDelta = streamTagBuffer.slice(0, endIndex);
                        if (artifactDelta) appendVisibleTextDelta(artifactDelta);
                        appendCanvasClose();
                        streamTagBuffer = streamTagBuffer.slice(endIndex + '</canvasmode>'.length);
                        continue;
                    }

                    const closeTag = '</canvasmode>';
                    let hold = 0;
                    const max = Math.min(streamTagBuffer.length, closeTag.length - 1);
                    const lowerBuffer = streamTagBuffer.toLowerCase();
                    for (let i = max; i >= 1; i -= 1) {
                        if (lowerBuffer.endsWith(closeTag.slice(0, i))) {
                            hold = i;
                            break;
                        }
                    }
                    const safeLen = streamTagBuffer.length - hold;
                    if (safeLen > 0) {
                        appendVisibleTextDelta(streamTagBuffer.slice(0, safeLen));
                        streamTagBuffer = streamTagBuffer.slice(safeLen);
                    }
                    break;
                }

                const start = findNextTagStart(streamTagBuffer);

                if (start === -1) {
                    const hold = getTrailingPartialProtocolMarkerLength(streamTagBuffer);
                    const safeLen = streamTagBuffer.length - hold;
                    if (safeLen > 0) {
                        appendVisibleTextDelta(streamTagBuffer.slice(0, safeLen));
                        streamTagBuffer = streamTagBuffer.slice(safeLen);
                    }
                    break;
                }

                if (start > 0) {
                    const visiblePrefix = streamTagBuffer.slice(0, start);
                    if (pendingImageSlotId && visiblePrefix.trim()) {
                        pendingImageSlotId = '';
                    }
                    appendVisibleTextDelta(visiblePrefix);
                    streamTagBuffer = streamTagBuffer.slice(start);
                    continue;
                }

                const canvasTag = parseCanvasStartTag(streamTagBuffer);
                if (canvasTag) {
                    if (canvasTag.needMore) break;
                    appendCanvasOpen(canvasTag);
                    streamTagBuffer = streamTagBuffer.slice(canvasTag.consumed);
                    continue;
                }

                const imageTag = tryConsumeImageTag(streamTagBuffer);
                if (imageTag) {
                    if (imageTag.needMore) break;
                    const normalizedImageTagUrl = normalizeStreamImageUrl(imageTag.url || '', {
                        fromExplicitImageTag: true
                    });
                    if (normalizedImageTagUrl) {
                        if (pendingImageSlotId) {
                            pushStreamImageSlot({
                                url: normalizedImageTagUrl,
                                imageId: pendingImageSlotId,
                                slotId: pendingImageSlotId,
                                sourceType: 'img',
                                appendMarker: false
                            });
                            pendingImageSlotId = '';
                        } else {
                            pushStreamImageSlot({ url: normalizedImageTagUrl, sourceType: 'img' });
                        }
                    } else if (pendingImageSlotId) {
                        pendingImageSlotId = '';
                    }
                    streamTagBuffer = streamTagBuffer.slice(imageTag.consumed);
                    continue;
                }

                const markdownImageTag = tryConsumeMarkdownImageTag(streamTagBuffer);
                if (markdownImageTag) {
                    if (markdownImageTag.needMore) break;
                    const normalizedMarkdownUrl = normalizeStreamImageUrl(markdownImageTag.url || '');
                    if (normalizedMarkdownUrl) {
                        if (pendingImageSlotId) {
                            pushStreamImageSlot({
                                url: normalizedMarkdownUrl,
                                imageId: pendingImageSlotId,
                                slotId: pendingImageSlotId,
                                sourceType: 'markdown',
                                appendMarker: false
                            });
                            pendingImageSlotId = '';
                        } else {
                            pushStreamImageSlot({ url: normalizedMarkdownUrl, sourceType: 'markdown' });
                        }
                    } else {
                        appendVisibleTextDelta(markdownImageTag.raw || streamTagBuffer.slice(0, markdownImageTag.consumed));
                    }
                    streamTagBuffer = streamTagBuffer.slice(markdownImageTag.consumed);
                    continue;
                }

                const slotTag = tryConsumeSlotTag(streamTagBuffer);
                if (slotTag) {
                    if (slotTag.needMore) break;
                    const safeSlot = slotTag.rawSlot.replace(/[^a-zA-Z0-9_-]/g, '').trim() || `img_${streamSlotCounter + 1}`;
                    pushStreamImageSlot({ imageId: safeSlot, slotId: safeSlot });
                    pendingImageSlotId = safeSlot;
                    streamTagBuffer = streamTagBuffer.slice(slotTag.consumed);
                    continue;
                }

                if (/^<span\b/i.test(streamTagBuffer)) {
                    const htmlSlotTagRegex = /^<span\b[^>]*\bdata-stream-image-slot\s*=\s*["'“”‘’]?([a-zA-Z0-9_-]+)["'“”‘’]?[^>]*>\s*<\/span\s*>/i;
                    const htmlSlotMatch = streamTagBuffer.match(htmlSlotTagRegex);
                    if (htmlSlotMatch && htmlSlotMatch[0]) {
                        const rawSlot = String(htmlSlotMatch[1] || '').trim();
                        const safeSlot = rawSlot.replace(/[^a-zA-Z0-9_-]/g, '').trim() || `img_${streamSlotCounter + 1}`;
                        pushStreamImageSlot({ imageId: safeSlot, slotId: safeSlot });
                        pendingImageSlotId = safeSlot;
                        streamTagBuffer = streamTagBuffer.slice(htmlSlotMatch[0].length);
                        continue;
                    }
                    // Span tag is likely incomplete in current chunk; wait for more stream data.
                    break;
                }

                if (pendingImageSlotId && !/^\s/.test(streamTagBuffer[0] || '')) {
                    pendingImageSlotId = '';
                }
                appendVisibleTextDelta(streamTagBuffer[0]);
                streamTagBuffer = streamTagBuffer.slice(1);
            }
        };

        const startTyping = () => {
            if (!isDisplayGateOpen() || isTyping) return;
            clearTypingStartTimer();
            hasTypingStarted = true;
            isTyping = true;
            streamPacer?.resetRenderClock();
            const renderLoop = () => {
                if (!getIsRenderSurfaceVisible()) {
                    drainQueuedTextWithoutRendering();
                    return;
                }
                if (charQueue.length === 0) {
                    isTyping = false;
                    renderSpeedAccumulator = 0;
                    return;
                }

                let charsToRenderCount;
                if (streamPacer) {
                    charsToRenderCount = streamPacer.take(charQueue.length, receivedDone || streamClosed);
                } else {
                    let currentRenderSpeed = renderSpeed;
                    if (!receivedDone && charQueue.length < STREAM_RESUME_BUFFER_CHARS) {
                        currentRenderSpeed = Math.max(0.75, renderSpeed * 0.7);
                    } else if (charQueue.length > 160) {
                        currentRenderSpeed = Math.min(renderSpeed * 4, 8);
                    } else if (charQueue.length > 80) {
                        currentRenderSpeed = Math.min(renderSpeed * 2.5, 5);
                    } else if (charQueue.length > 36) {
                        currentRenderSpeed = Math.min(renderSpeed * 1.5, 3);
                    }

                    renderSpeedAccumulator += currentRenderSpeed;
                    charsToRenderCount = Math.floor(renderSpeedAccumulator);
                    renderSpeedAccumulator -= charsToRenderCount;
                }

                const charsToRender = charQueue.splice(0, charsToRenderCount).join('');
                state.globalDisplayBuffer += charsToRender;

                const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                const effectiveRenderInterval = streamRenderInterval;
                const shouldRenderNow = (now - lastRenderTime) >= effectiveRenderInterval
                    || charQueue.length === 0;
                if (shouldRenderNow && (!streamPacer || charsToRenderCount > 0)) {
                    try {
                        const layoutForRender = finalImageLayout.length > 0 ? finalImageLayout : provisionalImageLayout;
                        const anchorParts = hasInlineImageSlots ? deriveStreamAnchorParts() : [];
                        const imagePartsForRender = hasInlineImageSlots
                            ? anchorParts
                            : (provisionalImageParts.length > 0 ? provisionalImageParts : []);
                        runWithStreamingAnchor(() => {
                            renderMessageContent(contentDiv, {
                                content: state.globalDisplayBuffer,
                                reasoning: finalReasoning,
                                image_layout: layoutForRender,
                                image_parts: imagePartsForRender
                            }, null, false, {
                                pendingImagePlaceholder: usePendingImagePlaceholder,
                                withStreamingAnchor: runWithStreamingAnchor
                            });
                        });
                    } catch (renderError) {
                        console.error(`${getToastMessage('console.renderMessageContentFailed')}:`, renderError);
                        if (contentDiv) {
                            contentDiv.textContent = state.globalDisplayBuffer;
                        }
                    }
                    lastRenderTime = now;
                }

                if (streamPacer) {
                    // 配速器按实际时间控制吐字，直接跟随动画帧，避免额外定时等待。
                    requestAnimationFrame(renderLoop);
                } else {
                    setTimeout(() => {
                        if (getIsRenderSurfaceVisible()) {
                            requestAnimationFrame(renderLoop);
                        } else {
                            renderLoop();
                        }
                    }, renderSpeed === 1 ? 25 : 16);
                }
            };

            if (getIsRenderSurfaceVisible()) {
                requestAnimationFrame(renderLoop);
            } else {
                setTimeout(renderLoop, 0);
            }
        };

        const scheduleTypingStart = () => {
            if (!isDisplayGateOpen() || isTyping || charQueue.length === 0) return;
            const minBufferChars = hasTypingStarted
                ? (streamPacer?.resumeBufferChars ?? STREAM_RESUME_BUFFER_CHARS)
                : (streamPacer?.initialBufferChars ?? STREAM_INITIAL_BUFFER_CHARS);
            if (receivedDone || streamClosed || charQueue.length >= minBufferChars) {
                startTyping();
                return;
            }
            if (typingStartTimer !== null) return;
            const waitMs = hasTypingStarted
                ? (streamPacer?.resumeWaitMs ?? STREAM_RESUME_BUFFER_WAIT_MS)
                : (streamPacer?.initialWaitMs ?? STREAM_INITIAL_BUFFER_WAIT_MS);
            typingStartTimer = setTimeout(() => {
                typingStartTimer = null;
                if (!isTyping && charQueue.length > 0) {
                    startTyping();
                }
            }, waitMs);
        };

        displayGatePromise.then(() => {
            if (!displayGateOpen) displayGateOpen = true;
            if (firstTokenAt) {
                clearThinkingIndicatorOnFirstBodyDelta(fullResponse);
            }
            if (!getIsRenderSurfaceVisible()) {
                drainQueuedTextWithoutRendering();
            } else if (!isTyping && charQueue.length > 0) {
                scheduleTypingStart();
            }
        });

        const processLine = (dataStr) => {
            if (!dataStr) return;
            if (dataStr === '[DONE]') {
                receivedDone = true;
                return;
            }

            try {
                const data = JSON.parse(dataStr);
                collectStreamImageUrlsFromPayload(data, collectedImageUrls);
                if (Array.isArray(data.citations) && data.citations.length > 0) {
                    finalCitations = data.citations;
                }
                if (Array.isArray(data.image_layout) && data.image_layout.length > 0) {
                    const incomingLayout = normalizeStreamLayout(data.image_layout);
                    metadataImageLayout = mergeIncomingImageLayout(metadataImageLayout, incomingLayout);
                    if (hasInlineImageSlots && incomingLayout.length > 0) {
                        finalImageLayout = mergeIncomingImageLayout(finalImageLayout, incomingLayout);
                    } else {
                        finalImageLayout = incomingLayout;
                    }
                }
                if (Array.isArray(data.image_parts) && data.image_parts.length > 0) {
                    const incomingParts = normalizeStreamParts(data.image_parts);
                    provisionalImageParts = normalizeStreamParts([
                        ...provisionalImageParts,
                        ...incomingParts
                    ]);
                    if (provisionalImageParts.length > 0 && finalImageLayout.length === 0) {
                        finalImageLayout = provisionalImageParts.map((part, idx) => ({
                            image_id: `img_${idx + 1}`,
                            url: part.image_url?.url || '',
                            placement: idx === 0 ? 'after_paragraph:1' : 'tail'
                        }));
                    }
                }
                if (typeof data.reasoning_delta === 'string' && data.reasoning_delta) {
                    finalReasoning += data.reasoning_delta;
                }
                if (typeof data.reasoning === 'string' && data.reasoning.trim()) {
                    finalReasoning = data.reasoning;
                }
                if (data.type === 'metadata') {
                    if (data.citations || data.reasoning || (Array.isArray(data.image_parts) && data.image_parts.length > 0)) {
                        return;
                    }
                }

                const delta = extractStreamDeltaText(data) || '';
                if (delta) {
                    parseBufferedStreamChunk(delta);
                }

                if (data.choices?.[0]?.finish_reason) {
                    finishReason = data.choices[0].finish_reason;
                    receivedDone = true;
                }
            } catch (parseError) {
                console.warn(`${getToastMessage('console.parseStreamDataFailed')}:`, parseError, getToastMessage('console.originalData'), dataStr);
            }
        };

        const readWithIdleTimeout = () => {
            if (!streamIdleTimeoutMs) {
                return reader.read();
            }

            let cancelTimeout = () => { };
            const timeoutPromise = new Promise((_, reject) => {
                cancelTimeout = startVisibilityAwareTimeout(streamIdleTimeoutMs, () => {
                    try { reader.cancel('stream_idle_timeout'); } catch (_) { }
                    const timeoutError = new Error(getToastMessage('errors.networkConnectionFailed'));
                    timeoutError.name = 'StreamIdleTimeoutError';
                    timeoutError.isNetworkError = true;
                    reject(timeoutError);
                });
            });

            return Promise.race([
                reader.read(),
                timeoutPromise
            ]).finally(() => {
                cancelTimeout();
            });
        };

        while (true) {
            const { value, done } = await readWithIdleTimeout();

            if (done) {
                streamClosed = true;
                if (buffer.trim()) {
                    const dataStr = buffer.trim().startsWith('data: ') ? buffer.trim().substring(6) : buffer.trim();
                    processLine(dataStr);
                }
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.substring(6).trim();
                    if (dataStr === '[DONE]') {
                        receivedDone = true;
                        break;
                    }
                    processLine(dataStr);
                }
            }
        }

        if (streamTagBuffer) {
            appendVisibleTextDelta(streamTagBuffer, { splitByChar: canvasState.mode !== 'canvas' });
            streamTagBuffer = '';
        }
        if (canvasState.mode === 'canvas') {
            appendCanvasClose();
        }

        if (hasEnteredNativeBackground() && !getIsRenderSurfaceVisible()) {
            displayGateOpen = true;
            if (firstTokenAt) {
                clearThinkingIndicatorOnFirstBodyDelta(fullResponse);
            }
            drainQueuedTextWithoutRendering();
        } else if (getIsRenderSurfaceVisible()) {
            if (!displayGateOpen) {
                await displayGatePromise;
            }
            displayGateOpen = true;
            if (firstTokenAt) {
                clearThinkingIndicatorOnFirstBodyDelta(fullResponse);
            }
            if (!isTyping && charQueue.length > 0) startTyping();

            await new Promise(resolve => {
                const checkTyping = () => {
                    if (!isTyping && charQueue.length === 0) {
                        resolve();
                    } else {
                        setTimeout(checkTyping, 50);
                    }
                };
                checkTyping();
            });
        } else {
            drainQueuedTextWithoutRendering();
        }
        clearTypingStartTimer();
        scrollManager.exitStreamingMode();
        let responseForReturn = persistedResponse || fullResponse;
        const interrupted = !receivedDone && responseForReturn.length > 0;
        const collectedParts = Array.from(collectedImageUrls).map((url) => ({
            type: 'image_url',
            image_url: { url },
            ...(state.explicitImageTagUrls.has(url) ? { _fromExplicitImageTag: true } : {})
        }));
        const envelope = parsePossibleJsonEnvelope(responseForReturn);
        if (envelope) {
            if (typeof envelope.content === 'string' && envelope.content.trim()) {
                responseForReturn = envelope.content;
            }
            if ((!Array.isArray(finalCitations) || finalCitations.length === 0) && Array.isArray(envelope.citations) && envelope.citations.length > 0) {
                finalCitations = envelope.citations;
            }
            if ((!finalReasoning || !finalReasoning.trim()) && typeof envelope.reasoning === 'string' && envelope.reasoning.trim()) {
                finalReasoning = envelope.reasoning;
            }
            if (Array.isArray(envelope.image_layout) && envelope.image_layout.length > 0) {
                const incomingEnvelopeLayout = normalizeStreamLayout(envelope.image_layout);
                if (hasInlineImageSlots && incomingEnvelopeLayout.length > 0) {
                    finalImageLayout = mergeIncomingImageLayout(finalImageLayout, incomingEnvelopeLayout);
                } else {
                    finalImageLayout = incomingEnvelopeLayout;
                }
            }
            if (Array.isArray(envelope.image_parts) && envelope.image_parts.length > 0) {
                const envelopeParts = normalizeStreamParts(envelope.image_parts);
                if (envelopeParts.length > 0) {
                    provisionalImageParts = normalizeStreamParts([
                        ...provisionalImageParts,
                        ...envelopeParts
                    ]);
                }
            }
        }
        if (streamImageAnchors.length > 0) {
            streamImageAnchors.forEach((anchor, index) => {
                if (anchor?.url) return;
                const slotId = String(anchor?.slotId || '').trim();
                const layoutMatch = metadataImageLayout.find((item) =>
                    String(item?.image_id || '').trim() === slotId && String(item?.url || '').trim()
                ) || finalImageLayout.find((item) =>
                    String(item?.image_id || '').trim() === slotId && String(item?.url || '').trim()
                );
                const partMatch = provisionalImageParts[index] || provisionalImageParts[0] || null;
                const resolvedUrl = String(layoutMatch?.url || partMatch?.image_url?.url || '').trim();
                if (resolvedUrl) {
                    anchor.url = resolvedUrl;
                }
            });
            const anchorParts = deriveStreamAnchorParts();
            const anchorLayout = deriveStreamAnchorLayout();
            if (anchorParts.length > 0) {
                return {
                    fullResponse: responseForReturn,
                    finalCitations,
                    finishReason,
                    interrupted,
                    finalReasoning,
                    streamImageParts: anchorParts,
                    streamImageLayout: anchorLayout
                };
            }
        }
        const explicitUrlSet = new Set(
            explicitImageParts
                .map((part) => String(part?.image_url?.url || '').trim())
                .filter(Boolean)
        );
        const layoutUrlSet = new Set(
            finalImageLayout
                .map((item) => String(item?.url || '').trim())
                .filter(Boolean)
        );
        const imgWrappedUrlSet = new Set(
            Array.from(state.imgWrappedTagUrls || [])
                .map((url) => String(url || '').trim())
                .filter(Boolean)
        );
        const hasImgWrappedSignals = imgWrappedUrlSet.size > 0;
        const allowLooseCollected = (
            !hasInlineImageSlots
            && finalImageLayout.length === 0
            && provisionalImageParts.length === 0
        ) || (
                hasImgWrappedSignals
                && layoutUrlSet.size === 0
            );
        const filteredCollectedParts = collectedParts.filter((part) => {
            const url = String(part?.image_url?.url || '').trim();
            if (!url) return false;
            if (state.explicitImageTagUrls.has(url)) return false;
            if (allowLooseCollected) {
                if (hasImgWrappedSignals) {
                    return imgWrappedUrlSet.has(url);
                }
                return true;
            }
            return layoutUrlSet.has(url);
        });
        const filteredProvisionalParts = explicitUrlSet.size > 0
            ? provisionalImageParts.filter((part) => {
                const url = String(part?.image_url?.url || '').trim();
                return !url || !explicitUrlSet.has(url);
            })
            : provisionalImageParts;
        const knownImagePartUrls = new Set([
            ...explicitImageParts,
            ...provisionalImageParts,
            ...filteredCollectedParts
        ].map((part) => String(part?.image_url?.url || '').trim()).filter(Boolean));
        const layoutImageParts = finalImageLayout
            .map((item) => {
                const url = String(item?.url || '').trim();
                return url ? { type: 'image_url', image_url: { url } } : null;
            })
            .filter((part) => {
                const url = String(part?.image_url?.url || '').trim();
                return url && !knownImagePartUrls.has(url);
            })
            .filter(Boolean);
        const mergedStreamImageParts = explicitImageParts.length > 0
            ? normalizeStreamParts([
                ...explicitImageParts,
                ...filteredProvisionalParts,
                ...filteredCollectedParts,
                ...layoutImageParts
            ])
            : normalizeStreamParts([
                ...provisionalImageParts,
                ...filteredCollectedParts,
                ...layoutImageParts
            ]);
        return { fullResponse: responseForReturn, finalCitations, finishReason, interrupted, finalReasoning, streamImageParts: mergedStreamImageParts, streamImageLayout: finalImageLayout };
    }

    return {
        beginMessageRender,
        updateMessageText,
        ensureStreamingRenderState,
        findLastCompleteDisplayMathEnd,
        stripStreamingHorizontalRuleTail,
        containsExplicitHorizontalRule,
        applyStreamingLockedContent,
        restoreDisplayMathState,
        normalizeStreamParts,
        normalizeStreamPlacement,
        normalizeStreamLayout,
        syncStreamAttachments,
        clearPendingPlaceholdersInChatContainer,
        processStreamedResponse,
        flushBufferedContent
    };
}
