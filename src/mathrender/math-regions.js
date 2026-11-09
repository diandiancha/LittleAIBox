export function findDisplayMathRegions(text, skipRanges = []) {
    const input = String(text || '');
    const ranges = [];
    const brokenRanges = [];
    const boundaryPattern = new RegExp([
        '^\\s{0,3}(?:',
        '#{1,6}[ \\t]+',
        '|<h[1-6]\\b',
        '|[`~]{3,}',
        '|(?:\\*\\*|__)\\s*\\d{1,3}[.)、．][ \\t]+',
        '|(?:\\*\\*|__)[^\\n]+(?:\\*\\*|__)[ \\t]*$',
        '|(?:-{3,}|\\*{3,}|_{3,})[ \\t]*$',
        ')'
    ].join(''), 'mi');

    const hasUnbalancedEnvironments = (value) => {
        const stack = [];
        const pattern = /\\(begin|end)\s*\{([A-Za-z0-9*]+)\}/g;
        let match;

        while ((match = pattern.exec(String(value || ''))) !== null) {
            if (match[1] === 'begin') {
                stack.push(match[2]);
                continue;
            }
            if (stack.pop() !== match[2]) return true;
        }

        return stack.length > 0;
    };

    const isSkipped = (index) => skipRanges.some(range => index >= range.start && index < range.end);
    const nextToken = (from) => {
        let index = input.indexOf('$$', from);
        while (index >= 0 && isSkipped(index)) {
            index = input.indexOf('$$', index + 2);
        }
        return index;
    };

    let pendingBrokenStart = -1;
    let searchFrom = 0;

    while (searchFrom < input.length) {
        const start = nextToken(searchFrom);
        if (start < 0) break;

        const end = nextToken(start + 2);
        if (end < 0) {
            if (pendingBrokenStart < 0) pendingBrokenStart = start;
            break;
        }

        const body = input.slice(start + 2, end);
        if (boundaryPattern.test(body) || hasUnbalancedEnvironments(body)) {
            if (pendingBrokenStart < 0) pendingBrokenStart = start;
            searchFrom = start + 2;
            continue;
        }

        if (pendingBrokenStart >= 0) {
            brokenRanges.push({ start: pendingBrokenStart, end: start });
            pendingBrokenStart = -1;
        }
        ranges.push({ start, end: end + 2 });
        searchFrom = end + 2;
    }

    if (pendingBrokenStart >= 0) {
        brokenRanges.push({ start: pendingBrokenStart, end: input.length });
    }

    return { ranges, brokenRanges };
}
