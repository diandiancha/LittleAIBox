const JSX_CAPABLE_LANGUAGES = new Set(['javascript', 'typescript']);
const JSX_TAG_PATTERN = /<(\/?)([A-Za-z][\w.:-]*)/g;

export function closeStreamingJsxTags(source, language) {
    const text = String(source || '');
    if (!JSX_CAPABLE_LANGUAGES.has(String(language || '').trim()) || text.indexOf('<') < 0) return text;
    const balance = new Map();
    for (const match of text.matchAll(JSX_TAG_PATTERN)) {
        const name = match[2];
        balance.set(name, (balance.get(name) || 0) + (match[1] ? -1 : 1));
    }
    let suffix = '';
    balance.forEach((count, name) => {
        if (count > 0) suffix += `</${name}>`;
    });
    return suffix ? `${text}\n${suffix}` : text;
}

export function truncateHighlightedHtml(html, textLength) {
    const source = String(html || '');
    const limit = Math.max(0, Number(textLength) || 0);
    const openTags = [];
    let count = 0;
    let i = 0;
    while (i < source.length && count < limit) {
        const code = source.charCodeAt(i);
        if (code === 60) {
            const end = source.indexOf('>', i);
            if (end < 0) break;
            const tag = source.slice(i, end + 1);
            if (tag.charCodeAt(1) === 47) {
                openTags.pop();
            } else if (tag.charCodeAt(tag.length - 2) !== 47) {
                openTags.push(/^<([a-zA-Z][\w-]*)/.exec(tag)?.[1] || 'span');
            }
            i = end + 1;
            continue;
        }
        if (code === 38) {
            const end = source.indexOf(';', i);
            if (end > i && end - i <= 10) {
                i = end + 1;
                count += 1;
                continue;
            }
        }
        i += 1;
        count += 1;
    }
    let result = source.slice(0, i);
    for (let j = openTags.length - 1; j >= 0; j -= 1) {
        result += `</${openTags[j]}>`;
    }
    return result;
}
