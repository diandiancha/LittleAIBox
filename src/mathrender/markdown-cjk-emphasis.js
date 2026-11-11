export function installCjkFriendlyEmphasis(markedApi) {
    if (!markedApi || typeof markedApi.use !== 'function' || markedApi.__cjkFriendlyEmphasisInstalled) {
        return markedApi;
    }

    const punctuationPattern = /[\p{P}\p{S}]/u;
    const whitespacePattern = /\s/u;
    const openingBracketPattern = /[\p{Ps}\p{Pi}]/u;
    const closingBracketPattern = /[\p{Pe}\p{Pf}]/u;
    const arithmeticOperatorPattern = /[+\-*/=^×÷＋－＝−]/u;
    const spacelessScriptPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\p{Script=Yi}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}\p{Script=Tai_Le}\p{Script=New_Tai_Lue}\p{Script=Tai_Tham}\p{Script=Tai_Viet}\p{Script=Javanese}\p{Script=Balinese}\u3006\u30FC\uFF70]/u;

    const isPunctuation = (ch) => !!ch && punctuationPattern.test(ch);
    const isWhitespace = (ch) => !!ch && whitespacePattern.test(ch);
    const isWordChar = (ch) => !!ch && !isWhitespace(ch) && !isPunctuation(ch);
    const isSpacelessScript = (ch) => !!ch && spacelessScriptPattern.test(ch);

    const charAt = (text, index) => {
        if (index < 0 || index >= text.length) return '';
        return String.fromCodePoint(text.codePointAt(index));
    };

    const lastChar = (text) => {
        const chars = Array.from(String(text || '').slice(-2));
        return chars.length ? chars[chars.length - 1] : '';
    };

    const countRun = (text, index, marker, limit) => {
        let end = index;
        while (end < limit && text[end] === marker) end += 1;
        return end - index;
    };

    const findClosingRun = (src, from, length, lineEnd) => {
        let index = from;
        while (index < lineEnd) {
            const ch = src[index];
            if (ch === '\\') {
                index += 2;
                continue;
            }
            if (ch === '`') {
                const run = countRun(src, index, '`', lineEnd);
                let search = index + run;
                let closeAt = -1;
                while (search < lineEnd) {
                    const next = src.indexOf('`', search);
                    if (next < 0 || next >= lineEnd) break;
                    const nextRun = countRun(src, next, '`', lineEnd);
                    if (nextRun === run) {
                        closeAt = next;
                        break;
                    }
                    search = next + nextRun;
                }
                index = closeAt >= 0 ? closeAt + run : index + run;
                continue;
            }
            if (ch === '*') {
                const run = countRun(src, index, '*', lineEnd);
                if (run === length) return index;
                index += run;
                continue;
            }
            index += 1;
        }
        return -1;
    };

    function tokenizer(src, tokens) {
        if (src[0] !== '*') return undefined;
        const lineBreakIndex = src.search(/[\r\n]/);
        const lineEnd = lineBreakIndex < 0 ? src.length : lineBreakIndex;
        const length = countRun(src, 0, '*', lineEnd);
        if (length > 3) return undefined;

        const closeAt = findClosingRun(src, length, length, lineEnd);
        if (closeAt <= length) return undefined;

        const inner = src.slice(length, closeAt);
        const first = charAt(inner, 0);
        const last = lastChar(inner);
        if (!first || isWhitespace(first) || isWhitespace(last)) return undefined;

        const previousToken = tokens && tokens.length ? tokens[tokens.length - 1] : null;
        const previous = previousToken && typeof previousToken.raw === 'string' ? lastChar(previousToken.raw) : '';
        const next = charAt(src, closeAt + length);
        if (closingBracketPattern.test(first) || openingBracketPattern.test(last)) return undefined;
        if (isWordChar(previous) && isWordChar(first) && !isSpacelessScript(previous) && !isSpacelessScript(first)) {
            return undefined;
        }

        const openingBlocked = isPunctuation(first) && isWordChar(previous);
        const closingBlocked = isPunctuation(last) && isWordChar(next);
        const looksLikeBracketedArithmetic = isWordChar(previous)
            && isWordChar(next)
            && openingBracketPattern.test(first)
            && closingBracketPattern.test(last)
            && arithmeticOperatorPattern.test(inner);
        if (looksLikeBracketedArithmetic) return undefined;

        const accepted = length === 1
            ? (openingBlocked && isSpacelessScript(previous)) || (closingBlocked && isSpacelessScript(next))
            : openingBlocked || closingBlocked || (length === 2 && inner.includes('*'));
        if (!accepted) return undefined;

        const raw = src.slice(0, closeAt + length);
        const childTokens = this.lexer.inlineTokens(inner);
        if (length === 1) return { type: 'em', raw, text: inner, tokens: childTokens };
        if (length === 2) return { type: 'strong', raw, text: inner, tokens: childTokens };
        return {
            type: 'em',
            raw,
            text: inner,
            tokens: [{ type: 'strong', raw, text: inner, tokens: childTokens }]
        };
    }

    markedApi.use({
        extensions: [{
            name: 'cjkFriendlyEmphasis',
            level: 'inline',
            start(src) {
                const index = src.indexOf('*');
                return index < 0 ? undefined : index;
            },
            tokenizer
        }]
    });
    markedApi.__cjkFriendlyEmphasisInstalled = true;
    return markedApi;
}
