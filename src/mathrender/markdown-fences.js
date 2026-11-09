export function parseMarkdownFenceLine(line) {
    const match = String(line || '').match(/^(\s{0,3})((?:>\s*)*)([`~]{3,})([^\r\n]*)$/);
    if (!match) return null;

    const quotePrefix = match[2] || '';
    return {
        indent: match[1] || '',
        quotePrefix,
        quoteDepth: (quotePrefix.match(/>/g) || []).length,
        marker: match[3],
        markerChar: match[3][0],
        markerLength: match[3].length,
        info: match[4] || ''
    };
}

function isClosingFence(candidate, openFence, { requireSameQuoteDepth = true } = {}) {
    if (!candidate || !openFence) return false;
    if (candidate.markerChar !== openFence.markerChar) return false;
    if (candidate.markerLength < openFence.markerLength) return false;
    if (candidate.info.trim()) return false;
    return !requireSameQuoteDepth || candidate.quoteDepth === openFence.quoteDepth;
}

function shouldRepairMismatchedClose(lines, startIndex, openFence, mismatchedClose) {
    for (let index = startIndex; index < lines.length; index += 1) {
        const candidate = parseMarkdownFenceLine(lines[index]);
        if (!candidate) continue;
        if (isClosingFence(candidate, openFence)) return false;

        const startsNextPeerFence = candidate.quoteDepth === mismatchedClose.quoteDepth &&
            candidate.markerChar === openFence.markerChar &&
            candidate.info.trim();
        if (startsNextPeerFence) return true;
    }
    return true;
}

function findNextNonblankFence(lines, startIndex) {
    for (let index = startIndex; index < lines.length; index += 1) {
        if (!String(lines[index] || '').trim()) continue;
        return { index, fence: parseMarkdownFenceLine(lines[index]) };
    }
    return null;
}

export function normalizeMismatchedMarkdownFences(markdown) {
    const lines = String(markdown || '').split(/\r?\n/);
    let openFence = null;

    for (let index = 0; index < lines.length; index += 1) {
        const candidate = parseMarkdownFenceLine(lines[index]);
        if (!candidate) continue;

        if (!openFence) {
            openFence = candidate;
            continue;
        }

        if (isClosingFence(candidate, openFence)) {
            openFence = null;
            continue;
        }

        if (!isClosingFence(candidate, openFence, { requireSameQuoteDepth: false })) {
            continue;
        }

        if (!shouldRepairMismatchedClose(lines, index + 1, openFence, candidate)) {
            continue;
        }

        const nextFenceEntry = findNextNonblankFence(lines, index + 1);
        const isRepeatedMismatchedClose = nextFenceEntry?.fence &&
            isClosingFence(nextFenceEntry.fence, openFence, { requireSameQuoteDepth: false }) &&
            nextFenceEntry.fence.quoteDepth === candidate.quoteDepth;
        if (isRepeatedMismatchedClose) {
            lines[index] = '';
            continue;
        }

        lines[index] = `${openFence.indent}${openFence.quotePrefix}${candidate.marker}`;
        openFence = null;
    }

    return lines.join('\n');
}

export function findUnclosedMarkdownFence(markdown) {
    const lines = String(markdown || '').split(/\r?\n/);
    let openFence = null;

    for (const line of lines) {
        openFence = advanceMarkdownFenceState(openFence, line).openFence;
    }

    return openFence;
}

export function advanceMarkdownFenceState(openFence, line) {
    const candidate = parseMarkdownFenceLine(line);
    if (!candidate) {
        return { openFence, isFenceLine: false, opened: false, closed: false };
    }

    if (!openFence) {
        return { openFence: candidate, isFenceLine: true, opened: true, closed: false };
    }

    if (isClosingFence(candidate, openFence)) {
        return { openFence: null, isFenceLine: true, opened: false, closed: true };
    }

    return { openFence, isFenceLine: true, opened: false, closed: false };
}

export function findFencedCodeRanges(markdown) {
    const source = String(markdown || '');
    const ranges = [];
    const parts = source.split(/(\r?\n)/);
    let openFence = null;
    let blockStart = 0;
    let offset = 0;

    for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index] || '';
        if (index % 2 === 1) {
            offset += part.length;
            continue;
        }

        const state = advanceMarkdownFenceState(openFence, part);
        if (state.opened) blockStart = offset;
        openFence = state.openFence;
        offset += part.length;
        if (state.closed) ranges.push({ start: blockStart, end: offset });
    }

    if (openFence) ranges.push({ start: blockStart, end: source.length });
    return ranges;
}

export function buildMarkdownFenceLine(fence) {
    if (!fence) return '';
    return `${fence.indent}${fence.quotePrefix}${fence.markerChar.repeat(fence.markerLength)}`;
}
