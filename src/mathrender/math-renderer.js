export { buildKatexConfigRuntimeLiteral, KATEX_CONFIG } from './math-renderer-config.js';
import { advanceMarkdownFenceState } from './markdown-fences.js';
import {
    findMathBlockLineIndexes,
    looksLikeChemicalEquation,
    normalizeChemicalBody,
    normalizeMarkdownForMath
} from './markdown-normalizer.js';

export class MathRenderer {
    constructor(katexConfig) {
        this.katexConfig = {
            ...katexConfig,
            preProcess: (tex) => this.normalizeMathBody(tex, { convertSimpleFraction: false })
        };
        this.partialConfig = {
            delimiters: katexConfig.delimiters,
            throwOnError: false,
            strict: false,
            trust: true,
            ignoredTags: katexConfig.ignoredTags,
            ignoredClasses: katexConfig.ignoredClasses,
            macros: katexConfig.macros,
            preProcess: (tex) => this.normalizeMathBody(tex, { convertSimpleFraction: false })
        };

        this.inlinePatternSource = MathRenderer.buildInlinePatternSource();
        this.displayLineRegex = MathRenderer.buildDisplayLineRegex();
    }

    static get COMMAND_PATTERN() {
        return '(?:frac|sqrt|sum|int|prod|lim|log|ln|sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|arcsin|arccos|arctan|pi|mu|nu|alpha|beta|gamma|delta|epsilon|lambda|theta|phi|psi|omega|chi|eta|zeta|xi|rho|sigma|tau|upsilon|kappa|varphi|varpi|varsigma|vartheta|Phi|Psi|Omega|Delta|Gamma|Lambda|Sigma|Pi|Theta|Chi|cdot|times|div|neq|leq|geq|approx|sim|infty|partial|nabla|in|notin|ni|subset|subseteq|supset|supseteq|to|rightarrow|leftarrow|Rightarrow|Leftarrow|iff|land|lor|mathbb|mathrm|mathbf|mathcal|boldsymbol|operatorname|overline|underline|widehat|widetilde|hat|vec|bar|tilde|dot|ddot|ce|binom|left|right|text|displaystyle|mathsf|mathtt|mathfrak|mathit)';
    }

    static get UNICODE_TEXT_CLASS() {
        return '\\p{L}\\p{N}\\p{M}\\p{P}\\p{S}\\p{Zs}';
    }

    static buildInlinePatternSource() {
        const chars = `${MathRenderer.UNICODE_TEXT_CLASS}0-9\\s+\\-*/^_=()\\\\.,·:;`;
        return `([${chars}]*\\\\${MathRenderer.COMMAND_PATTERN}[${chars}{}]*)`;
    }

    static buildDisplayLineRegex() {
        const chars = `${MathRenderer.UNICODE_TEXT_CLASS}0-9\\s\\\\{}^_*+\\-=/().,:;·`;
        return new RegExp(`^[${chars}]+$`, 'u');
    }

    preprocessMarkdown(text, options = {}) {
        return normalizeMarkdownForMath(text, options);
    }

    wrapBareInlineLatexCommands(text) {
        try {
            const lines = text.split(/\r?\n/);
            const mathBlockLines = findMathBlockLineIndexes(text);
            let fence = null;
            const inlineRegex = new RegExp(this.inlinePatternSource, 'gu');
            const hasExplicitMathDelimiters = (line) =>
                line.includes('$') || line.includes('\\(') || line.includes('\\)') || line.includes('\\[') || line.includes('\\]');

            const maybeWrapMathSegment = (segment) => {
                const raw = String(segment || '');
                const trimmed = raw.trim();
                if (!trimmed) return null;
                if (trimmed.includes('`')) return null;
                if (/^(?:[-+*]\s+|\d+[.)]\s+)/u.test(trimmed)) return null;
                if (/[\u3400-\u9fff]/u.test(trimmed) && !trimmed.includes('\\')) return null;
                const classified = this.classifyMathLikeContent(trimmed);
                if (!classified?.shouldWrap || !classified.mathBody) return null;

                const strongMathSignal = /[_^]|(?:^|[^A-Za-z])\d+\s*[=+\-*/]|[=+\-*/]\s*\d+|[=+\-*/].*[_^]/u.test(trimmed);
                if (!strongMathSignal) return null;
                return `$$${classified.mathBody}$$`;
            };

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const fenceState = advanceMarkdownFenceState(fence, line);
                if (fenceState.isFenceLine) {
                    fence = fenceState.openFence;
                    continue;
                }

                if (fence) continue;
                if (mathBlockLines.has(i)) continue;
                if (hasExplicitMathDelimiters(line)) {
                    continue;
                }
                if (/\\begin\s*\{[A-Za-z0-9*]+\}/u.test(line)) {
                    continue;
                }

                const colonMatch = line.match(/^(\s*[^:：\n]{0,80}[：:]\s*)(.+)$/u);
                if (colonMatch) {
                    const wrapped = maybeWrapMathSegment(colonMatch[2]);
                    if (wrapped) {
                        lines[i] = `${colonMatch[1]}${wrapped}`;
                        continue;
                    }
                }

                const wholeLineWrapped = maybeWrapMathSegment(line);
                if (wholeLineWrapped) {
                    lines[i] = wholeLineWrapped;
                    continue;
                }

                if (!line.includes('\\')) continue;

                const trimmed = line.trim();
                inlineRegex.lastIndex = 0;
                if (trimmed && this.displayLineRegex.test(trimmed) && inlineRegex.test(trimmed)) {
                    lines[i] = `$$${trimmed}$$`;
                    continue;
                }

                const parts = line.split('`');
                for (let p = 0; p < parts.length; p += 2) {
                    parts[p] = parts[p].replace(inlineRegex, (match) => {
                        const trimmed = match.trim();
                        if (!trimmed) return match;
                        return `$${trimmed}$`;
                    });
                }
                lines[i] = parts.join('`');
            }
            return lines.join('\n');
        } catch (_) {
            return text;
        }
    }

    classifyMathLikeContent(trimmed) {
        if (!trimmed) {
            return { shouldWrap: false, mathBody: trimmed };
        }

        const commandRegex = this.commandRegex();
        commandRegex.lastIndex = 0;

        let looksLikeMath = trimmed.includes('\\') || commandRegex.test(trimmed);

        if (!looksLikeMath) {
            const superscriptPattern = /(?:^|[^A-Za-z0-9])([A-Za-z0-9])\s*\^\s*(?:\{?[A-Za-z0-9+\-*/]+\}?|[A-Za-z0-9])/u;
            const subscriptPattern = /(?:^|[^A-Za-z0-9])([A-Za-z0-9])\s*_\s*(?:\{?[A-Za-z0-9]+\}?)/u;
            const operatorPattern = /[=+\-*/]/u;
            const fractionPattern = /[A-Za-z0-9]\s*\/\s*[A-Za-z0-9]/u;
            const greekPattern = /[α-ωΑ-ΩπμθσρλντφψΩΦΛΣΠΘΧβγδεζηξρ]/u;
            const symbolPattern = /[∑∏√∞≈≠≤≥±÷×⋅·∈∉⊂⊃⊆⊇⊄⊈∪∩]/u;

            looksLikeMath =
                superscriptPattern.test(trimmed) ||
                subscriptPattern.test(trimmed) ||
                (operatorPattern.test(trimmed) && this.isAsciiMathContent(trimmed)) ||
                fractionPattern.test(trimmed) ||
                greekPattern.test(trimmed) ||
                symbolPattern.test(trimmed);
        }

        if (looksLikeMath) {
            return { shouldWrap: true, mathBody: this.normalizeMathBody(trimmed) };
        }

        if (this.isLikelyShortMathToken(trimmed)) {
            return { shouldWrap: true, mathBody: this.normalizeMathBody(trimmed) };
        }

        if (looksLikeChemicalEquation(trimmed)) {
            const needsCeWrap = !/^\\ce\{.*\}$/u.test(trimmed);
            const chemicalBody = normalizeChemicalBody(trimmed);
            return {
                shouldWrap: true,
                mathBody: needsCeWrap ? `\\ce{${chemicalBody}}` : chemicalBody
            };
        }

        return { shouldWrap: false, mathBody: trimmed };
    }

    isAsciiMathContent(text) {
        if (!text) return false;
        const asciiMathPattern = /^[A-Za-z0-9\\^_{}+\-*/().,:;= ]+$/u;
        return asciiMathPattern.test(text);
    }

    isLikelyShortMathToken(text) {
        if (!text) return false;
        const trimmed = text.trim();
        if (trimmed.length === 0 || trimmed.length > 2) return false;

        if (/^[A-Za-z0-9]$/u.test(trimmed) || /^[A-Za-z0-9][0-9]$/u.test(trimmed)) {
            return true;
        }

        const normalized = trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (normalized.length === 1 && /^[A-Za-z]$/u.test(normalized)) {
            return true;
        }

        if (/^[\u2070-\u209F]$/u.test(trimmed)) {
            return true;
        }

        return false;
    }

    normalizeMathBody(body, options = {}) {
        if (!body) return body;

        const { convertSimpleFraction = true } = options || {};
        let result = body;
        result = this.normalizeModelAdjacentSubscriptTokens(result);
        result = this.normalizeSlashedRelationOperators(result);

        const accentTransforms = [
            { regex: /([A-Za-z0-9])\u0302/gu, replacement: '\\hat{$1}' },
            { regex: /([A-Za-z0-9])\u0303/gu, replacement: '\\tilde{$1}' },
            { regex: /([A-Za-z0-9])\u0304/gu, replacement: '\\bar{$1}' },
            { regex: /([A-Za-z0-9])\u0307/gu, replacement: '\\dot{$1}' },
            { regex: /([A-Za-z0-9])\u0308/gu, replacement: '\\ddot{$1}' },
            { regex: /([A-Za-z0-9])\u20d7/gu, replacement: '\\vec{$1}' }
        ];
        accentTransforms.forEach(({ regex, replacement }) => {
            result = result.replace(regex, replacement);
        });

        const greekMap = {
            'π': '\\pi ',
            'Π': '\\Pi ',
            'θ': '\\theta ',
            'Θ': '\\Theta ',
            'λ': '\\lambda ',
            'Λ': '\\Lambda ',
            'σ': '\\sigma ',
            'Σ': '\\Sigma ',
            'μ': '\\mu ',
            'µ': '\\mu ',
            'φ': '\\phi ',
            'Φ': '\\Phi ',
            'ω': '\\omega ',
            'Ω': '\\Omega ',
            'α': '\\alpha ',
            'β': '\\beta ',
            'γ': '\\gamma ',
            'Γ': '\\Gamma ',
            'δ': '\\delta ',
            'Δ': '\\Delta ',
            'η': '\\eta ',
            'ρ': '\\rho ',
            'χ': '\\chi ',
            'ζ': '\\zeta ',
            'ξ': '\\xi ',
            'ν': '\\nu ',
            'τ': '\\tau ',
            'ψ': '\\psi ',
            'Ψ': '\\Psi ',
            'κ': '\\kappa '
        };
        result = result.replace(/[\u03B1-\u03C9\u0391-\u03A9\u00B5]/gu, ch => greekMap[ch] || ch);

        const subscriptDigits = {
            '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
            '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9'
        };
        result = result.replace(/([\u2080-\u2089]+)/gu, match => `_{${[...match].map(ch => subscriptDigits[ch] || '').join('')}}`);

        const superscriptDigits = {
            '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
            '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
            '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')'
        };
        result = result.replace(/([\u2070-\u2079\u207A-\u207E]+)/gu, match => `^{${[...match].map(ch => superscriptDigits[ch] || '').join('')}}`);
        result = this.normalizeBareNuclearMath(result);

        result = result.replace(/[\u00B7\u22C5\u2022]/gu, ' \\cdot ');
        result = result.replace(/×/gu, ' \\times ');
        result = result.replace(/÷/gu, ' \\div ');

        result = result.replace(/\s{2,}/g, ' ');

        const slashCount = (result.match(/\//g) || []).length;
        if (convertSimpleFraction && slashCount === 1) {
            const fractionMatch = result.match(/^\s*([^/]+?)\s*\/\s*([^/]+?)\s*$/u);
            if (fractionMatch) {
                const numerator = fractionMatch[1].trim();
                const denominator = fractionMatch[2].trim();
                if (numerator && denominator) {
                    result = `\\frac{${numerator}}{${denominator}}`;
                }
            }
        }

        return result.trim();
    }

    normalizeBareNuclearMath(tex) {
        if (!tex || tex.includes('\\ce')) return tex;

        const scriptAtom = String.raw`(?:\{[^{}\r\n]+\}|[+\-]?\d+m?|[A-Za-z](?:')?)`;
        const prescript = String.raw`(?:\^${scriptAtom}\s*_${scriptAtom}|_${scriptAtom}\s*\^${scriptAtom})`;
        const nucleus = String.raw`(?:[A-Z][a-z]?(?![a-z])|[enpxy](?![A-Za-z])|\\(?:alpha|beta|gamma)(?![A-Za-z]))`;
        const pattern = new RegExp(`(^|[\\s|([{（,，:：;；<>+=])(${prescript})\\s*(${nucleus})`, 'gu');
        let changed = false;
        const result = String(tex).replace(pattern, (full, boundary, scripts, symbol) => {
            changed = true;
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
            return `${boundary}\\ce{^{${massNumber}}_{${atomicNumber}}${symbol}}`;
        });

        if (!changed) return tex;
        return result
            .replace(/<->/gu, '\\leftrightarrow ')
            .replace(/->/gu, '\\rightarrow ')
            .replace(/<-/gu, '\\leftarrow ');
    }

    normalizeModelAdjacentSubscriptTokens(tex) {
        if (!tex) return tex;
        let result = tex;
        for (let i = 0; i < 6; i++) {
            const next = result
                .replace(/([A-Za-z])_\{([0-9]+)([A-Za-z])\}/gu, '$1_{$2}$3')
                .replace(/([A-Za-z])_([0-9]+)([A-Za-z])/gu, '$1_{$2}$3')
                .replace(/([A-Za-z])_\{([^{}\s]+)\}_\{([^{}\s]+)\}/gu, '$1_{$2,$3}');
            if (next === result) break;
            result = next;
        }
        return result;
    }

    normalizeSlashedRelationOperators(tex) {
        if (!tex) return tex;
        return tex
            .replace(/\\in\s*\\?\/\s*/gu, '\\notin ')
            .replace(/\\ni\s*\\?\/\s*/gu, '\\not\\ni ')
            .replace(/\\subseteq\s*\\?\/\s*/gu, '\\not\\subseteq ')
            .replace(/\\subset\s*\\?\/\s*/gu, '\\not\\subset ')
            .replace(/\\supseteq\s*\\?\/\s*/gu, '\\not\\supseteq ')
            .replace(/\\supset\s*\\?\/\s*/gu, '\\not\\supset ')
            .replace(/\u2208\s*\\?\/\s*/gu, '\\notin ')
            .replace(/\u2208\u0338/gu, '\\notin ')
            .replace(/\u2209/gu, '\\notin ')
            .replace(/\u220B\s*\\?\/\s*/gu, '\\not\\ni ')
            .replace(/\u220B\u0338/gu, '\\not\\ni ')
            .replace(/\u2286\s*\\?\/\s*/gu, '\\not\\subseteq ')
            .replace(/\u2282\s*\\?\/\s*/gu, '\\not\\subset ')
            .replace(/\u2282\u0338/gu, '\\not\\subset ')
            .replace(/\u2286\u0338/gu, '\\not\\subseteq ')
            .replace(/\u2287\s*\\?\/\s*/gu, '\\not\\supseteq ')
            .replace(/\u2283\s*\\?\/\s*/gu, '\\not\\supset ')
            .replace(/\u2283\u0338/gu, '\\not\\supset ')
            .replace(/\u2287\u0338/gu, '\\not\\supseteq ');
    }

    inlineRegex() {
        return new RegExp(this.inlinePatternSource, 'gu');
    }

    commandRegex() {
        return new RegExp(`\\\\${MathRenderer.COMMAND_PATTERN}`, 'u');
    }

    normalizeDelimited(texWithDelimiters) {
        try {
            let body = texWithDelimiters;
            let start = '', end = '';
            if (texWithDelimiters.startsWith('$$') && texWithDelimiters.endsWith('$$')) {
                start = '$$'; end = '$$';
                body = texWithDelimiters.slice(2, -2);
            } else if (texWithDelimiters.startsWith('$') && texWithDelimiters.endsWith('$')) {
                start = '$'; end = '$';
                body = texWithDelimiters.slice(1, -1);
            } else {
                return texWithDelimiters;
            }

            let normalized = this.normalizeMathBody(body, { convertSimpleFraction: false })
                .replace(/\u00AC\s*(\w)/g, '\\neg \\! $1')
                .replace(/([A-Za-z])\^(\d{1,2})(?=\d[spdfg])/gi, ($0, base, exp) => `${base}^{${exp}} `)
                .replace(/(?<!\\)_([A-Za-z0-9]+)/g, '_{$1}')
                .replace(/(?<!\\)\^([A-Za-z]|\d+)/g, '^{$1}')
                .replace(/\\text\{([^{}]*?)(?<!\\)_(\{[^{}]*\}|[A-Za-z0-9]+?)(\^(\{[^{}]*\}|[A-Za-z0-9]+))?\}/g, (full, base, rawSub, supGroup, rawSup) => {
                    const stripBraces = value => {
                        if (!value) return '';
                        const trimmed = value.trim();
                        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                            return trimmed.slice(1, -1);
                        }
                        return trimmed;
                    };
                    const wrapIfText = value => {
                        const trimmed = value.trim();
                        if (!trimmed) return '';
                        if (trimmed.startsWith('\\')) {
                            return trimmed;
                        }
                        if (/^[0-9+\-*/().]+$/.test(trimmed)) {
                            return trimmed;
                        }
                        if (/^[A-Za-z]$/.test(trimmed)) {
                            return trimmed;
                        }
                        return `\\text{${trimmed}}`;
                    };

                    const baseText = base.trim().replace(/\s+/g, ' ');
                    const subContent = stripBraces(rawSub);
                    const supContent = stripBraces(rawSup || '');
                    let rebuilt = `\\text{${baseText}}`;

                    if (subContent) {
                        rebuilt += `_{${wrapIfText(subContent)}}`;
                    }
                    if (supContent) {
                        rebuilt += `^{${wrapIfText(supContent)}}`;
                    }
                    return rebuilt;
                });

            normalized = this.normalizeModelAdjacentSubscriptTokens(normalized);

            return start + normalized + end;
        } catch (e) {
            return texWithDelimiters;
        }
    }

    static containsMath(text) {
        if (!text) return false;
        return text.includes('$') ||
            text.includes('\\(') ||
            text.includes('\\[') ||
            /\\begin\s*\{[A-Za-z0-9*]+\}/u.test(text);
    }

    renderMath(element, { isFinalRender, roots = null } = {}) {
        if (!window.renderMathInElement) {
            return;
        }

        try {
            if (element?.dataset?.plainText === 'true') {
                return;
            }
            const hasExplicitRoots = Array.isArray(roots);
            if (hasExplicitRoots && roots.length === 0) {
                // 没有 DOM 增量时通常无需再扫整条消息；只有尚未成功渲染的原始公式才回退一次。
                if (!MathRenderer.containsMath(element.textContent || '') || element.querySelector('.katex')) return;
                roots = null;
            }
            const requestedRoots = Array.isArray(roots) ? roots : [element];
            const renderRoots = requestedRoots
                .filter(root => root?.nodeType === 1 && (root === element || element.contains(root)))
                .filter((root, index, all) => !all.some((other, otherIndex) => (
                    otherIndex !== index && other !== root && other.contains(root)
                )));
            if (!renderRoots.length) return;

            const ignoredTags = new Set((this.katexConfig.ignoredTags || []).map(tag => tag.toLowerCase()));
            const ignoredClasses = this.katexConfig.ignoredClasses || [];
            renderRoots.forEach(root => {
                const textContent = root.textContent;
                if (!MathRenderer.containsMath(textContent)) return;

                if (!root.querySelector('.katex')) {
                    renderMathInElement(root, this.katexConfig);
                    return;
                }

                const textNodes = [];
                const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
                    acceptNode(node) {
                        if (node.nodeType === 1) {
                            if (node.classList.contains('katex') || ignoredTags.has(node.localName)
                                || ignoredClasses.some(name => node.classList.contains(name))) return NodeFilter.FILTER_REJECT;
                            return NodeFilter.FILTER_SKIP;
                        }
                        if (!MathRenderer.containsMath(node.data || '')) return NodeFilter.FILTER_REJECT;
                        return NodeFilter.FILTER_ACCEPT;
                    }
                });
                let node;
                while ((node = walk.nextNode())) textNodes.push(node);

                textNodes.forEach(textNode => {
                    try {
                        const span = document.createElement('span');
                        span.textContent = textNode.data;
                        textNode.parentNode.replaceChild(span, textNode);
                        renderMathInElement(span, this.partialConfig);
                    } catch (_) { }
                });
            });
        } catch (_) { }
    }

    renderElement(element, isFinalRender = false) {
        this.renderMath(element, { isFinalRender: !!isFinalRender });
    }
}
