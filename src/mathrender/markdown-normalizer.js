import { advanceMarkdownFenceState, findFencedCodeRanges } from './markdown-fences.js';
import { findDisplayMathRegions } from './math-regions.js';

function splitFenceAwareLines(text, transformLine) {
    const lines = String(text || '').split(/\r?\n/);
    let fence = null;

    return lines.map((line, index) => {
        const fenceState = advanceMarkdownFenceState(fence, line);
        if (fenceState.isFenceLine) {
            fence = fenceState.openFence;
            return line;
        }

        if (fence) return line;
        return transformLine(line, {
            index,
            isLastLine: index === lines.length - 1
        });
    }).join('\n');
}

export function findMathBlockLineIndexes(text) {
    const source = String(text || '');
    const lineIndexes = new Set();
    if (!source.includes('$$') && !source.includes('\\[')) return lineIndexes;

    const fencedRanges = findFencedCodeRanges(source);
    const ranges = [...findDisplayMathRegions(source, fencedRanges).ranges];
    const bracketMathRegex = /\\\[[\s\S]*?\\\]/g;
    let match;
    while ((match = bracketMathRegex.exec(source)) !== null) {
        const start = match.index;
        if (fencedRanges.some(range => start >= range.start && start < range.end)) continue;
        ranges.push({ start, end: start + match[0].length });
    }
    if (!ranges.length) return lineIndexes;

    let lineStart = 0;
    source.split('\n').forEach((line, index) => {
        const lineEnd = lineStart + line.length;
        if (ranges.some(range => lineStart < range.end && lineEnd > range.start)) {
            lineIndexes.add(index);
        }
        lineStart = lineEnd + 1;
    });
    return lineIndexes;
}

export function normalizeLatexEnvironments(text) {
    const source = String(text || '');
    const fencedRanges = findFencedCodeRanges(source);
    const displayRegions = findDisplayMathRegions(source, fencedRanges);
    const protectedRanges = [
        ...fencedRanges,
        ...displayRegions.ranges,
        ...displayRegions.brokenRanges
    ];
    const inlineDollarRegex = /(?<!\$)\$(?!\$)(?:\\.|[^$\\\n])+(?<!\$)\$(?!\$)/g;
    const bracketMathRegex = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g;
    let match;

    while ((match = inlineDollarRegex.exec(source)) !== null) {
        protectedRanges.push({ start: match.index, end: match.index + match[0].length });
    }
    while ((match = bracketMathRegex.exec(source)) !== null) {
        protectedRanges.push({ start: match.index, end: match.index + match[0].length });
    }

    return source.replace(/\\begin\s*\{([A-Za-z0-9*]+)\}([\s\S]*?)\\end\s*\{\1\}/gmi, (full, envName, content, offset) => {
        const matchEnd = offset + full.length;
        const isProtected = protectedRanges.some(range => offset < range.end && matchEnd > range.start);
        if (isProtected) return full;

        const fixedContent = String(content || '').replace(/([^\\]|^)\\(\s)/g, '$1\\\\$2');
        return `$$\\begin{${envName}}${fixedContent}\\end{${envName}}$$`;
    });
}

export function promoteStandaloneInlineMath(text, options = {}) {
    const { deferTrailingLine = false } = options || {};
    return splitFenceAwareLines(text, (line, { isLastLine } = {}) => {
        if (deferTrailingLine && isLastLine) return line;

        const trimmed = line.trim();
        const match = trimmed.match(/^\$([^$\n]+)\$$/u);
        if (!match) return line;

        const before = line.slice(0, line.indexOf(trimmed));
        return `${before}$$${match[1]}$$`;
    });
}

export function normalizeChemicalBody(text) {
    return String(text || '').replace(/[\u00B7\u22C5\u2022]/gu, '\\cdot ');
}

export function looksLikeChemicalEquation(text) {
    const value = String(text || '').trim();
    if (value.length < 3) return false;
    if (/[`$]/u.test(value) || /\\ce\s*\{/u.test(value)) return false;
    if (/\\[A-Za-z]/u.test(value)) return false;
    if (/[\u3400-\u9fff]/u.test(value)) return false;
    if (/^\d+\s*[.)、:：]\s*/u.test(value) || /^[-*+]\s+/u.test(value)) return false;
    if (/[A-Za-z]+\/[A-Za-z+]+/u.test(value)) return false;

    const hasConnector = /(<?[-=]+>|\u21cc|\u21c4|\u2194|\u2192|\u2190|\u27f6|\u27f5|\u27f7|\u21c6|\u21cb|\+|=)/u.test(value);
    if (!hasConnector) return false;

    const compoundMatches = value.match(/\b[A-Z][a-z]?(?:\d+(?:\.\d+)?)?(?:_\{[0-9+\-]+\}|_\d+)?(?:\([a-z]{1,3}\))?/g) || [];
    return compoundMatches.length >= 2;
}

export function wrapBareChemicalLines(text) {
    const mathBlockLines = findMathBlockLineIndexes(text);
    return splitFenceAwareLines(text, (line, { index } = {}) => {
        if (mathBlockLines.has(index)) return line;
        const trimmed = line.trim();
        if (!looksLikeChemicalEquation(trimmed)) return line;

        const leading = line.slice(0, line.indexOf(trimmed));
        const trailing = line.slice(line.indexOf(trimmed) + trimmed.length);
        return `${leading}$$\\ce{${normalizeChemicalBody(trimmed)}}$$${trailing}`;
    });
}

function findInlineCodeRanges(text) {
    const source = String(text || '');
    const ranges = [];
    const markerPattern = /`+/g;
    let match;

    while ((match = markerPattern.exec(source)) !== null) {
        const marker = match[0];
        const end = source.indexOf(marker, markerPattern.lastIndex);
        if (end < 0) break;
        ranges.push({ start: match.index, end: end + marker.length });
        markerPattern.lastIndex = end + marker.length;
    }

    return ranges;
}

function mergeRanges(ranges) {
    const sorted = ranges
        .filter(range => Number.isFinite(range?.start) && Number.isFinite(range?.end) && range.end > range.start)
        .sort((left, right) => left.start - right.start || left.end - right.end);
    const merged = [];

    sorted.forEach((range) => {
        const previous = merged[merged.length - 1];
        if (!previous || range.start > previous.end) {
            merged.push({ start: range.start, end: range.end });
            return;
        }
        previous.end = Math.max(previous.end, range.end);
    });

    return merged;
}

function wrapBareNuclidesInText(text) {
    const scriptAtom = String.raw`(?:\{[^{}\r\n]+\}|[+\-]?\d+m?|[A-Za-z](?:')?)`;
    const prescript = String.raw`(?:\^${scriptAtom}\s*_${scriptAtom}|_${scriptAtom}\s*\^${scriptAtom})`;
    const nucleus = String.raw`(?:[A-Z][a-z]?(?![a-z])|[enpxy](?![A-Za-z])|\\(?:alpha|beta|gamma)(?![A-Za-z]))`;
    const pattern = new RegExp(`(^|[\\s|([{（,，:：;；<>+=])(${prescript})\\s*(${nucleus})`, 'gu');

    return String(text || '').replace(pattern, (full, boundary, scripts, symbol) => {
        const compactScripts = String(scripts || '').replace(/\s+/g, '');
        const scriptPattern = /([_^])(\{[^{}\r\n]+\}|[+\-]?\d+m?|[A-Za-z](?:')?)/gu;
        let massNumber = '';
        let atomicNumber = '';
        let scriptMatch;
        while ((scriptMatch = scriptPattern.exec(compactScripts)) !== null) {
            const value = scriptMatch[2].startsWith('{')
                ? scriptMatch[2].slice(1, -1)
                : scriptMatch[2];
            if (scriptMatch[1] === '^') massNumber = value;
            if (scriptMatch[1] === '_') atomicNumber = value;
        }
        return boundary + '$' + `\\ce{^{${massNumber}}_{${atomicNumber}}${symbol}}` + '$';
    });
}

export function normalizeBareNuclearNotation(text) {
    const source = String(text || '');
    if (!source || (!source.includes('^') && !source.includes('_'))) return source;

    const fencedRanges = findFencedCodeRanges(source);
    const displayRegions = findDisplayMathRegions(source, fencedRanges);
    const protectedRanges = [
        ...fencedRanges,
        ...displayRegions.ranges,
        ...displayRegions.brokenRanges,
        ...findInlineCodeRanges(source)
    ];
    const inlineMathPatterns = [
        /(?<!\$)\$(?!\$)(?:\\.|[^$\\\n])+(?<!\$)\$(?!\$)/g,
        /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g
    ];

    inlineMathPatterns.forEach((pattern) => {
        let match;
        while ((match = pattern.exec(source)) !== null) {
            protectedRanges.push({ start: match.index, end: match.index + match[0].length });
        }
    });

    const ranges = mergeRanges(protectedRanges);
    let result = '';
    let cursor = 0;
    ranges.forEach((range) => {
        if (range.start > cursor) {
            result += wrapBareNuclidesInText(source.slice(cursor, range.start));
        }
        result += source.slice(range.start, range.end);
        cursor = Math.max(cursor, range.end);
    });
    result += wrapBareNuclidesInText(source.slice(cursor));
    return result;
}

export function normalizeMarkdownForMath(text, options = {}) {
    const {
        deferTrailingStandaloneMath = false,
        promoteStandaloneMath = true,
        wrapBareChemistry = false
    } = options || {};
    let result = normalizeLatexEnvironments(text);
    if (promoteStandaloneMath) {
        result = promoteStandaloneInlineMath(result, {
            deferTrailingLine: deferTrailingStandaloneMath
        });
    }
    result = normalizeBareNuclearNotation(result);
    if (wrapBareChemistry) {
        result = wrapBareChemicalLines(result);
    }
    return result;
}
