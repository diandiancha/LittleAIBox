import { findDisplayMathRegions } from './math-regions.js';

export function protectMarkdownMathPlaceholders(markdown, options = {}) {
    const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const {
        normalizeMath = value => value,
        displayTokenPrefix = '%%DISPLAYMATH',
        inlineTokenPrefix = '%%INLINEMATH',
        tokenSuffix = '%%'
    } = options || {};
    const findRegions = (options && options.findRegions) || findDisplayMathRegions;

    const displayMath = [];
    const inlineMath = [];
    const source = String(markdown || '');

    const fenceLineRegex = /^(\s{0,3})((?:>\s*)*)([`~]{3,})([^\r\n]*)$/;
    const inlineCodeRegex = /(`+)[^\n]*?\1/g;

    const splitFencedSegments = (text) => {
        const segments = [];
        let buffer = [];
        let isCode = false;
        let openFence = null;

        const flush = () => {
            if (!buffer.length) return;
            segments.push({ text: buffer.join('\n'), isCode });
            buffer = [];
        };

        String(text).split('\n').forEach((line) => {
            const match = line.replace(/\r$/, '').match(fenceLineRegex);
            if (!match) {
                buffer.push(line);
                return;
            }

            const fence = {
                quoteDepth: (match[2].match(/>/g) || []).length,
                markerChar: match[3][0],
                markerLength: match[3].length,
                info: match[4] || ''
            };

            if (!openFence) {
                flush();
                isCode = true;
                openFence = fence;
                buffer.push(line);
                return;
            }

            buffer.push(line);
            const closesFence = fence.markerChar === openFence.markerChar &&
                fence.markerLength >= openFence.markerLength &&
                fence.quoteDepth === openFence.quoteDepth &&
                !fence.info.trim();
            if (closesFence) {
                openFence = null;
                flush();
                isCode = false;
            }
        });

        flush();
        return segments;
    };

    const replaceOutsideInlineCode = (text, replacer) => {
        let result = '';
        let lastIndex = 0;
        let match;

        inlineCodeRegex.lastIndex = 0;
        while ((match = inlineCodeRegex.exec(text)) !== null) {
            if (!match[0].includes('$')) continue;
            result += replacer(text.slice(lastIndex, match.index)) + match[0];
            lastIndex = match.index + match[0].length;
        }

        return result + replacer(text.slice(lastIndex));
    };

    const protectOutsideCode = (text, replacer) => splitFencedSegments(text)
        .map(segment => (segment.isCode ? segment.text : replaceOutsideInlineCode(segment.text, replacer)))
        .join('\n');

    const pushDisplayMath = (match) => {
        displayMath.push(normalizeMath(match));
        return `${displayTokenPrefix}${displayMath.length - 1}${tokenSuffix}`;
    };

    const pushInlineMath = (match) => {
        inlineMath.push(normalizeMath(match));
        return `${inlineTokenPrefix}${inlineMath.length - 1}${tokenSuffix}`;
    };

    const replaceDollarDisplayMath = (value) => {
        const input = String(value || '');
        const { ranges } = findRegions(input);
        if (!ranges.length) return input;

        let result = '';
        let cursor = 0;

        for (const range of ranges) {
            result += input.slice(cursor, range.start);
            result += pushDisplayMath(input.slice(range.start, range.end));
            cursor = range.end;
        }

        return result + input.slice(cursor);
    };

    let text = protectOutsideCode(source, replaceDollarDisplayMath);

    text = protectOutsideCode(text, value => value.replace(/\\\[([\s\S]*?)\\\]/g, pushDisplayMath));

    text = protectOutsideCode(text, value => value.replace(/\$([^$\n]+?)\$/g, pushInlineMath));

    text = protectOutsideCode(text, value => value.replace(/\\\(([^\n]*?)\\\)/g, pushInlineMath));

    const escapeMathHtml = (value) => String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const restore = (value, { maxPasses = 2, escapeHtml = false } = {}) => {
        let result = String(value || '');
        const displayRegex = new RegExp(`${escapeRegExp(displayTokenPrefix)}(\\d+)${escapeRegExp(tokenSuffix)}`, 'g');
        const inlineRegex = new RegExp(`${escapeRegExp(inlineTokenPrefix)}(\\d+)${escapeRegExp(tokenSuffix)}`, 'g');
        // HTML parsing must keep formula operators as text; KaTeX reads the decoded DOM text.
        const displayValues = escapeHtml ? displayMath.map(escapeMathHtml) : displayMath;
        const inlineValues = escapeHtml ? inlineMath.map(escapeMathHtml) : inlineMath;

        for (let i = 0; i < maxPasses; i++) {
            const restored = result
                .replace(displayRegex, (match, index) => displayValues[parseInt(index, 10)] ?? match)
                .replace(inlineRegex, (match, index) => inlineValues[parseInt(index, 10)] ?? match);
            if (restored === result) break;
            result = restored;
        }

        return result;
    };

    return {
        text,
        displayMath,
        inlineMath,
        hasMath: displayMath.length > 0 || inlineMath.length > 0,
        restore
    };
}
